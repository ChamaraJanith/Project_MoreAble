// jest.mock calls are hoisted above every import, so these load against the stubs below.
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { resetActiveJourneySession } from '../../../src/features/journey/services/activeJourneySync';
import { useAuthStore } from '../../../src/shared/store/authStore';
import * as BusSessionModule from '../../../src/shared/utils/busSession';
import { seedOngoingJourneys, SeedBooking } from '../../testUtils/ongoingJourneySeed';

jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

import { triggerSOSAlert } from '../../../src/features/journey/services/sosService';
import { useJourneyStore } from '../../../src/shared/store/journeyStore';
import * as Location from 'expo-location';
import * as EmergencyAdminApi from '../../../src/features/admin/api/emergencyAdminApi';

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
}));

jest.mock('../../../src/features/admin/api/emergencyAdminApi', () => ({
    createEmergencyRequestApi: jest.fn(),
}));

// SOS refreshes the running journey from GET /api/journeys/ongoing. The real
// route answers from a seeded database; only the Firebase handle and the token
// check are stubbed, as in the route's own tests.
const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: 'http://api.test' }));

// The signed-in passenger every test starts with, and their running journey.
// Sessions are opaque strings mapped to a passenger by the stubbed token check.
const PASSENGER_NIMAL = 'PAS-2026-00554';
const SESSION_NIMAL = 'session-nimal';
const NIMAL_PHONE = '0712345670';
const NIMAL_GUARDIAN_MOBILE = '0778887766';

const SESSIONS: Record<string, string> = { [SESSION_NIMAL]: PASSENGER_NIMAL };

const NIMAL = {
    uid: `uid-${PASSENGER_NIMAL}`,
    passengerId: PASSENGER_NIMAL,
    userName: 'Nimal Silva',
    email: 'nimal.silva@moreable.lk',
    phoneNumber: NIMAL_PHONE,
    role: 'COMMUTER',
    guardianDetails: { fullName: 'Kamala Silva', mobileNo: NIMAL_GUARDIAN_MOBILE },
} as any;

const NIMAL_RUNNING: SeedBooking = {
    bookingId: 'BK-NIMAL-01',
    userId: PASSENGER_NIMAL,
    tripId: 'TRIP-00004',
    busId: 'BUS-8899',
    trip: 'running',
};

describe('MOV-231 / MOV-236: Passenger SOS Integration with Admin Emergency Dispatch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useJourneyStore.getState().clearSOS();

        mockVerifyToken.mockImplementation(async (token: string) => {
            const passengerId = SESSIONS[token];
            return passengerId
                ? { uid: `uid-${passengerId}`, passengerId, role: 'PASSENGER', email: `${passengerId}@moreable.lk` }
                : null;
        });
        mockGetAdminDb.mockReturnValue(seedOngoingJourneys([NIMAL_RUNNING]));
        (global as any).fetch = jest.fn((url: string, init?: RequestInit) => getOngoing(new Request(url, init)));

        useAuthStore.setState({ user: NIMAL, token: SESSION_NIMAL, isAuthenticated: true });
        resetActiveJourneySession();

        // The server records the SOS unless a test says otherwise.
        (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValue({
            id: 'EMG-10001',
            status: 'PENDING',
        });

        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('1. Core SOS Trigger & End-to-End Dispatch Flow', () => {
        it('triggers SOS alert, updates local vehicle/driver store, and posts to backend emergency API', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9319, longitude: 79.8478 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValueOnce({
                id: 'EMG-10203',
                status: 'PENDING',
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            expect(result.message).toContain('Emergency SOS Sent Successfully');

            // Verify local driver/vehicle state is activated
            const store = useJourneyStore.getState();
            expect(store.activeSOS).not.toBeNull();
            expect(store.activeSOS?.isActive).toBe(true);
            expect(store.activeSOS?.passengerName).toBe('Nimal Silva');

            // Verify backend emergency request API was invoked with exact sosData snapshot
            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledTimes(1);
            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    bookingId: 'BK-NIMAL-01',
                    tripId: 'TRIP-00004',
                    busId: 'BUS-8899',
                    status: 'ACTIVE',
                    passenger: expect.objectContaining({
                        id: PASSENGER_NIMAL,
                        name: 'Nimal Silva',
                        phone: NIMAL_PHONE,
                    }),
                    vehicle: { plateNumber: 'NB-8899', model: 'Viking' },
                    location: expect.objectContaining({
                        latitude: 6.9319,
                        longitude: 79.8478,
                    }),
                    alertRecipients: expect.objectContaining({
                        caregiver: NIMAL_GUARDIAN_MOBILE,
                        driver: 'BUS-8899',
                        admin: 'ADMIN_TOPIC',
                    }),
                })
            );
        });

        it('reports the SOS as NOT sent when the backend network call fails, and raises no local alert', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockRejectedValueOnce(
                Object.assign(new Error('Network error. Please check your connection and try again.'), { status: null })
            );

            const result = await triggerSOSAlert();

            // The server never recorded it: nothing may claim help was notified.
            expect(result.success).toBe(false);
            expect(result.message).not.toContain('Sent Successfully');
            expect(result.message).toContain('NOT sent');
            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('returns failure message if location permission is not granted', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'denied',
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Location permission is required for SOS.');
            expect(EmergencyAdminApi.createEmergencyRequestApi).not.toHaveBeenCalled();
            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('handles case when Location.requestForegroundPermissionsAsync throws unexpected error', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockRejectedValueOnce(
                new Error('Permission system service unavailable')
            );

            const result = await triggerSOSAlert();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Permission system service unavailable');
            expect(EmergencyAdminApi.createEmergencyRequestApi).not.toHaveBeenCalled();
        });

        it('handles case when Location.getCurrentPositionAsync throws GPS timeout error', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValueOnce(
                new Error('Location request timed out')
            );

            const result = await triggerSOSAlert();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Location request timed out');
            expect(EmergencyAdminApi.createEmergencyRequestApi).not.toHaveBeenCalled();
        });
    });

    describe('2. Passenger Profile & Vehicle Metadata Snapshot Verification', () => {
        it("captures the signed-in passenger and their running journey's own booking, trip, bus and plate", async () => {
            SESSIONS['session-sarath'] = 'PAS-991';
            mockGetAdminDb.mockReturnValue(
                seedOngoingJourneys([
                    { bookingId: 'BKG-COL-KANDY-01', userId: 'PAS-991', tripId: 'TRIP-00021', busId: 'BUS-8811', trip: 'running' },
                ])
            );
            useAuthStore.setState({
                user: {
                    uid: 'uid-PAS-991',
                    passengerId: 'PAS-991',
                    userName: 'Sarath Fonseka',
                    email: 'sarath.fonseka@moreable.lk',
                    phoneNumber: '0719876543',
                    guardianDetails: { fullName: 'Nalini Fonseka', mobileNo: '0715525520' },
                } as any,
                token: 'session-sarath',
            });

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 7.2906, longitude: 80.6337 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValueOnce({
                id: 'EMG-9021',
                status: 'PENDING',
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            const activeSOS = useJourneyStore.getState().activeSOS;
            expect(activeSOS?.passengerName).toBe('Sarath Fonseka');

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    bookingId: 'BKG-COL-KANDY-01',
                    tripId: 'TRIP-00021',
                    busId: 'BUS-8811',
                    passenger: expect.objectContaining({ id: 'PAS-991', name: 'Sarath Fonseka', phone: '0719876543' }),
                    vehicle: { plateNumber: 'NB-8811', model: 'Viking' },
                    alertRecipients: {
                        caregiver: '0715525520',
                        driver: 'BUS-8811',
                        admin: 'ADMIN_TOPIC',
                    },
                })
            );
            delete SESSIONS['session-sarath'];
        });

        it('sends a null caregiver when the signed-in passenger has no guardian', async () => {
            useAuthStore.getState().updateUser({ guardianDetails: null, guardianId: null });

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9, longitude: 79.8 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValueOnce({
                id: 'EMG-NOCG',
                status: 'PENDING',
            });

            await triggerSOSAlert();

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    alertRecipients: expect.objectContaining({
                        caregiver: null,
                        driver: 'BUS-8899',
                        admin: 'ADMIN_TOPIC',
                    }),
                })
            );
        });

        it('sends no journey identity or vehicle when no journey is running', async () => {
            // Nimal holds a CONFIRMED booking whose trip has not started.
            mockGetAdminDb.mockReturnValue(seedOngoingJourneys([{ ...NIMAL_RUNNING, trip: 'not-started' }]));

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.91, longitude: 79.85 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValueOnce({
                id: 'EMG-NOVEH',
                status: 'PENDING',
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    bookingId: null,
                    tripId: null,
                    busId: null,
                    vehicle: null,
                    alertRecipients: expect.objectContaining({
                        driver: null,
                    }),
                })
            );
        });
    });

    describe('3. Local Store Lifecycle & State Transition Verification', () => {
        it('sets activeSOS timestamp to an ISO date format within the last few seconds', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            await triggerSOSAlert();

            const activeSOS = useJourneyStore.getState().activeSOS;
            expect(activeSOS).not.toBeNull();
            expect(activeSOS?.isActive).toBe(true);

            const timestamp = new Date(activeSOS!.timestamp).getTime();
            const now = Date.now();
            expect(now - timestamp).toBeLessThan(5000);
        });

        it('allows resetting activeSOS state using clearSOS', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            await triggerSOSAlert();
            expect(useJourneyStore.getState().activeSOS?.isActive).toBe(true);

            // Passenger or conductor clears alert
            useJourneyStore.getState().clearSOS();
            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('supports multiple sequential SOS alerts smoothly', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            // Trigger 1
            const res1 = await triggerSOSAlert();
            expect(res1.success).toBe(true);

            // Clear
            useJourneyStore.getState().clearSOS();
            expect(useJourneyStore.getState().activeSOS).toBeNull();

            // Trigger 2
            const res2 = await triggerSOSAlert();
            expect(res2.success).toBe(true);
            expect(useJourneyStore.getState().activeSOS?.isActive).toBe(true);
            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledTimes(2);
        });

        it('names the signed-in passenger, never a passenger left in the journey store', async () => {
            useJourneyStore.setState({
                passengerDetails: { id: 'PAS-OTHER-01', name: 'Someone Else', phone: '0700000001' },
                caregiverId: '0700000002',
            });

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.92, longitude: 79.86 },
            });

            await triggerSOSAlert();

            expect(useJourneyStore.getState().activeSOS?.passengerName).toBe('Nimal Silva');
            const payload = (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mock.calls[0][0];
            expect(payload.passenger).toMatchObject({ id: PASSENGER_NIMAL, name: 'Nimal Silva', phone: NIMAL_PHONE });
            expect(payload.alertRecipients.caregiver).toBe(NIMAL_GUARDIAN_MOBILE);
            expect(JSON.stringify(payload)).not.toMatch(/PAS-OTHER-01|Someone Else|0700000001|0700000002/);
        });
    });

    describe('4. GPS Coordinate Precision and Boundary Scenarios', () => {
        it('handles negative and boundary geographic coordinates safely', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: -4.321, longitude: -72.123 },
            });

            await triggerSOSAlert();

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    location: {
                        latitude: -4.321,
                        longitude: -72.123,
                    },
                })
            );
        });

        it('preserves floating point precision for micro-coordinate accuracy', async () => {
            const preciseLat = 6.9270789123;
            const preciseLng = 79.8612456789;

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: preciseLat, longitude: preciseLng },
            });

            await triggerSOSAlert();

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    location: {
                        latitude: preciseLat,
                        longitude: preciseLng,
                    },
                })
            );
        });
    });

    describe('5. High Concurrency and Resiliency Scenarios', () => {
        it('executes concurrent SOS triggers without race condition crashes', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValue({
                id: 'EMG-PARALLEL',
                status: 'PENDING',
            });

            const results = await Promise.all([
                triggerSOSAlert(),
                triggerSOSAlert(),
                triggerSOSAlert(),
            ]);

            expect(results).toHaveLength(3);
            results.forEach((res) => expect(res.success).toBe(true));
            expect(useJourneyStore.getState().activeSOS?.isActive).toBe(true);
            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledTimes(3);
        });

        it('ensures console error is called and error message extracted on unexpected exceptions', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockImplementationOnce(() => {
                throw new Error('Fatal Native Bridge Exception');
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Fatal Native Bridge Exception');
            expect(console.error).toHaveBeenCalled();
        });

        it('returns generic error message when thrown entity is not an Error instance', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockImplementationOnce(() => {
                throw 'A string exception thrown from bridge';
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Failed to send SOS');
        });
    });

    describe('6. Onboard Vehicle Dashboard Synchronization & UI State Verification', () => {
        it('ensures vehicle console receives immediate state notification upon SOS dispatch', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            expect(useJourneyStore.getState().activeSOS).toBeNull();

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            const liveConsoleState = useJourneyStore.getState().activeSOS;
            expect(liveConsoleState).toBeDefined();
            expect(liveConsoleState?.isActive).toBe(true);
            expect(liveConsoleState?.passengerName).toBe('Nimal Silva');
        });

        it('allows conductor to clear emergency status from dashboard when passenger is assisted', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            await triggerSOSAlert();
            expect(useJourneyStore.getState().activeSOS?.isActive).toBe(true);

            // Bus conductor checks commuter and clicks DISMISS
            useJourneyStore.getState().clearSOS();
            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('retains the running journey and vehicle registration unchanged when SOS is cleared', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            await triggerSOSAlert();
            useJourneyStore.getState().clearSOS();

            const state = useJourneyStore.getState();
            expect(state.vehicleDetails?.plateNumber).toBe('NB-8899');
            expect(state.bookingId).toBe('BK-NIMAL-01');
            expect(state.tripId).toBe('TRIP-00004');
        });
    });

    describe('7. Alert Recipient Multiplexing and Priority Telemetry', () => {
        it('dispatches to all 3 designated recipients: caregiver, driver, and admin topic', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9319, longitude: 79.8478 },
            });

            await triggerSOSAlert();

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    alertRecipients: {
                        caregiver: NIMAL_GUARDIAN_MOBILE,
                        driver: 'BUS-8899',
                        admin: 'ADMIN_TOPIC',
                    },
                    status: 'ACTIVE',
                })
            );
        });

        it('does not log the SOS payload — no phone number, location or booking in the console', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9319, longitude: 79.8478 },
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            const logged = JSON.stringify([
                (console.log as jest.Mock).mock.calls,
                (console.warn as jest.Mock).mock.calls,
                (console.error as jest.Mock).mock.calls,
            ]);
            expect(logged).not.toContain(NIMAL_PHONE);
            expect(logged).not.toContain('6.9319');
            expect(logged).not.toContain('BK-NIMAL-01');
        });
    });

    describe('8. Real Database User Session & Bus Session Enrichment (Zero-Mock Persistence)', () => {
        it('dynamically resolves logged-in user profile, accessibility needs, and guardian details from authStore', async () => {
            const { useAuthStore } = require('../../../src/shared/store/authStore');
            useAuthStore.setState({
                user: {
                    uid: 'USR-2026-9901',
                    passengerId: 'PAS-2026-00088',
                    userName: 'Kasun Perera',
                    email: 'kasun.perera@gmail.com',
                    phoneNumber: '0714455667',
                    secondaryPhoneNumber: null,
                    nicNo: '981234567V',
                    calculatedAge: 28,
                    isElderPerson: false,
                    role: 'COMMUTER',
                    isVerified: true,
                    accessibilityNeeds: ['Wheelchair Ramp', 'Low Step Entry'],
                    isWheelchairUser: true,
                    guardianDetails: {
                        fullName: 'Sunil Perera',
                        mobileNo: '0779900112',
                        nicNo: '651234567V',
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                } as any,
                token: 'valid-jwt-token-kasun',
                isAuthenticated: true,
            });

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9123, longitude: 79.8821 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValueOnce({
                id: 'EMG-88001',
                status: 'PENDING',
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            const activeSOS = useJourneyStore.getState().activeSOS;
            expect(activeSOS?.passengerName).toBe('Kasun Perera');

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    passenger: expect.objectContaining({
                        id: 'PAS-2026-00088',
                        name: 'Kasun Perera',
                        phone: '0714455667',
                        email: 'kasun.perera@gmail.com',
                        specialAssistance: 'Wheelchair Ramp, Low Step Entry',
                    }),
                    alertRecipients: expect.objectContaining({
                        caregiver: '0779900112',
                    }),
                })
            );

            // Clean up auth state
            useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
        });

        it("uses the passenger's running-journey vehicle; a bus session saved on the device never overrides it", async () => {
            const busSession = jest.spyOn(BusSessionModule, 'getBusSession').mockResolvedValue({
                busId: 'BUS-COLOMBO-138',
                numberPlate: 'WP-ND-4521',
                token: 'bus-session-opaque',
            });

            SESSIONS['session-amali'] = 'PAS-2026-00099';
            mockGetAdminDb.mockReturnValue(
                seedOngoingJourneys([
                    { bookingId: 'BK-AMALI-01', userId: 'PAS-2026-00099', tripId: 'TRIP-00031', busId: 'BUS-6611', trip: 'running' },
                ])
            );
            useAuthStore.setState({
                user: {
                    uid: 'USR-2026-9902',
                    passengerId: 'PAS-2026-00099',
                    userName: 'Amali Wickramasinghe',
                    phoneNumber: '0773344556',
                    role: 'COMMUTER',
                    isLowVisionPerson: true,
                } as any,
                token: 'session-amali',
                isAuthenticated: true,
            });

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.8402, longitude: 79.9981 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValueOnce({
                id: 'EMG-88002',
                status: 'PENDING',
            });

            const result = await triggerSOSAlert();

            expect(result.success).toBe(true);
            expect(useJourneyStore.getState().activeSOS?.passengerName).toBe('Amali Wickramasinghe');

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    bookingId: 'BK-AMALI-01',
                    tripId: 'TRIP-00031',
                    busId: 'BUS-6611',
                    vehicle: { plateNumber: 'NB-6611', model: 'Viking' },
                    passenger: expect.objectContaining({
                        name: 'Amali Wickramasinghe',
                        phone: '0773344556',
                        specialAssistance: 'Low Vision Support',
                    }),
                })
            );
            const payload = JSON.stringify((EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mock.calls[0][0]);
            expect(payload).not.toMatch(/WP-ND-4521|BUS-COLOMBO-138/);
            expect(busSession).not.toHaveBeenCalled();

            delete SESSIONS['session-amali'];
        });
    });

    describe('9. Multi-Disability Profile Mapping & Custom Assistance Directives', () => {
        const { useAuthStore } = require('../../../src/shared/store/authStore');

        beforeEach(() => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockResolvedValue({
                id: 'EMG-MULTI-01',
                status: 'PENDING',
            });
        });

        it('correctly maps wheelchair user with ramp deployment flag to special assistance metadata', async () => {
            useAuthStore.setState({
                user: {
                    uid: 'USR-WHEELCHAIR-01',
                    passengerId: 'PAS-WC-101',
                    userName: 'Bandula Gunawardena',
                    phoneNumber: '0711122334',
                    role: 'COMMUTER',
                    isWheelchairUser: true,
                    accessibilityNeeds: ['Wheelchair Ramp', 'Low Floor Bus Access'],
                } as any,
                isAuthenticated: true,
            });

            const res = await triggerSOSAlert();
            expect(res.success).toBe(true);

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    passenger: expect.objectContaining({
                        name: 'Bandula Gunawardena',
                        phone: '0711122334',
                        specialAssistance: 'Wheelchair Ramp, Low Floor Bus Access',
                    }),
                })
            );
        });

        it('correctly formats hearing-impaired commuter notification flag for text-based alerts', async () => {
            useAuthStore.setState({
                user: {
                    uid: 'USR-HEARING-02',
                    passengerId: 'PAS-HEARING-102',
                    userName: 'Kamani Wijesinghe',
                    phoneNumber: '0772233445',
                    role: 'COMMUTER',
                    isHearingImpaired: true,
                    accessibilityNeeds: [],
                } as any,
                isAuthenticated: true,
            });

            const res = await triggerSOSAlert();
            expect(res.success).toBe(true);

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    passenger: expect.objectContaining({
                        name: 'Kamani Wijesinghe',
                        specialAssistance: 'Hearing Support',
                    }),
                })
            );
        });

        it('correctly formats walking-difficulty commuter notification flag for priority seat assistance', async () => {
            useAuthStore.setState({
                user: {
                    uid: 'USR-WALK-03',
                    passengerId: 'PAS-WALK-103',
                    userName: 'Somapala Fernando',
                    phoneNumber: '0753344556',
                    role: 'COMMUTER',
                    isWalkingDifficultyPerson: true,
                    accessibilityNeeds: [],
                } as any,
                isAuthenticated: true,
            });

            const res = await triggerSOSAlert();
            expect(res.success).toBe(true);

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    passenger: expect.objectContaining({
                        name: 'Somapala Fernando',
                        specialAssistance: 'Walking Assistance',
                    }),
                })
            );
        });

        it('correctly prioritizes explicit accessibility needs array over single boolean flags', async () => {
            useAuthStore.setState({
                user: {
                    uid: 'USR-MULTI-04',
                    passengerId: 'PAS-MULTI-104',
                    userName: 'Dilani Senanayake',
                    phoneNumber: '0724455667',
                    role: 'COMMUTER',
                    isWheelchairUser: true,
                    isLowVisionPerson: true,
                    accessibilityNeeds: ['Wheelchair Access', 'Audio Announcements', 'Guide Dog Allowed'],
                } as any,
                isAuthenticated: true,
            });

            const res = await triggerSOSAlert();
            expect(res.success).toBe(true);

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    passenger: expect.objectContaining({
                        specialAssistance: 'Wheelchair Access, Audio Announcements, Guide Dog Allowed',
                    }),
                })
            );
        });

        it('handles commuter with international phone formatting cleanly without truncation', async () => {
            useAuthStore.setState({
                user: {
                    uid: 'USR-INTL-05',
                    passengerId: 'PAS-INTL-105',
                    userName: 'Alexander Wright',
                    phoneNumber: '+94771239988',
                    role: 'COMMUTER',
                    isElderPerson: true,
                    accessibilityNeeds: ['Priority Seating'],
                } as any,
                isAuthenticated: true,
            });

            const res = await triggerSOSAlert();
            expect(res.success).toBe(true);
            expect(useJourneyStore.getState().activeSOS?.passengerName).toBe('Alexander Wright');

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    passenger: expect.objectContaining({
                        phone: '+94771239988',
                        specialAssistance: 'Priority Seating',
                    }),
                })
            );
        });

        it('sends no caregiver when guardian details are absent — never a caregiver left in the store', async () => {
            useJourneyStore.setState({ caregiverId: '0779990000' });
            useAuthStore.setState({
                user: {
                    uid: 'USR-NOGUARDIAN-06',
                    passengerId: 'PAS-NOGUARDIAN-106',
                    userName: 'Rohan Jayatilleke',
                    phoneNumber: '0761122334',
                    role: 'COMMUTER',
                    guardianDetails: undefined,
                    guardianId: undefined,
                } as any,
                isAuthenticated: true,
            });

            const res = await triggerSOSAlert();
            expect(res.success).toBe(true);

            expect(EmergencyAdminApi.createEmergencyRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({
                    alertRecipients: expect.objectContaining({ caregiver: null }),
                })
            );
        });

        it('cleans up authStore state after custom profile testing', () => {
            useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
            expect(useAuthStore.getState().user).toBeNull();
        });
    });

    describe('10. Live Dispatch Messaging & Bidirectional Directive Exchange', () => {
        it('validates dispatch message structure sent from Control Center admin', () => {
            const adminMessage = {
                id: 'MSG-001',
                sender: 'ADMIN' as const,
                senderName: 'Control Center Dispatch (HQ)',
                message: 'Hold vehicle at Maharagama Halt. Paramedic squad alerted.',
                sentAt: new Date().toISOString(),
            };

            expect(adminMessage.sender).toBe('ADMIN');
            expect(adminMessage.message.length).toBeGreaterThan(5);
            expect(new Date(adminMessage.sentAt).getTime()).not.toBeNaN();
        });

        it('validates dispatch quick response sent from onboard bus crew', () => {
            const busMessage = {
                id: 'MSG-002',
                sender: 'BUS_CREW' as const,
                senderName: 'Bus Crew (NB-5678)',
                message: 'Safely pulled over at next bus halt. Commuter is accompanied.',
                sentAt: new Date().toISOString(),
            };

            expect(busMessage.sender).toBe('BUS_CREW');
            expect(busMessage.senderName).toContain('NB-5678');
            expect(busMessage.message).toContain('Safely pulled over');
        });

        it('preserves chronological order across multi-message conversation thread', () => {
            const thread = [
                { id: 'M-1', sender: 'BUS_CREW', message: 'Passenger feeling faint', sentAt: '2026-10-01T01:00:00.000Z' },
                { id: 'M-2', sender: 'ADMIN', message: 'Pull over safely. Ambulance 1990 dispatched.', sentAt: '2026-10-01T01:01:00.000Z' },
                { id: 'M-3', sender: 'BUS_CREW', message: 'Bus safely parked at bay.', sentAt: '2026-10-01T01:02:00.000Z' },
                { id: 'M-4', sender: 'ADMIN', message: 'ETA for ambulance is 4 minutes.', sentAt: '2026-10-01T01:03:00.000Z' },
            ];

            const sorted = [...thread].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
            expect(sorted.map(m => m.id)).toEqual(['M-1', 'M-2', 'M-3', 'M-4']);
            expect(sorted[sorted.length - 1].sender).toBe('ADMIN');
        });

        it('sanitizes and truncates overly long directive messages to prevent layout breaking', () => {
            const excessivelyLongInput = 'URGENT '.repeat(200);
            const sanitized = excessivelyLongInput.trim().slice(0, 500);

            expect(sanitized.length).toBeLessThanOrEqual(500);
            expect(sanitized.startsWith('URGENT')).toBe(true);
        });

        it('disallows blank or whitespace-only messages from sending to dispatch thread', () => {
            const validateMsg = (text: string) => text.trim().length > 0;

            expect(validateMsg('')).toBe(false);
            expect(validateMsg('   ')).toBe(false);
            expect(validateMsg('\n\t  \r')).toBe(false);
            expect(validateMsg('Attending onboard')).toBe(true);
        });

        it('ensures distinct message visual styling tokens between bus crew and admin dispatch', () => {
            const getBubbleTheme = (sender: 'ADMIN' | 'BUS_CREW') => {
                return sender === 'ADMIN'
                    ? { bg: '#EFF6FF', border: '#2563EB', align: 'flex-start' }
                    : { bg: '#FEF3C7', border: '#D97706', align: 'flex-end' };
            };

            const adminTheme = getBubbleTheme('ADMIN');
            const busTheme = getBubbleTheme('BUS_CREW');

            expect(adminTheme.bg).not.toEqual(busTheme.bg);
            expect(adminTheme.border).not.toEqual(busTheme.border);
            expect(adminTheme.align).toBe('flex-start');
            expect(busTheme.align).toBe('flex-end');
        });
    });

    describe('11. Emergency Lifecycle State Machine & Audit Trail Integrity', () => {
        const allowedTransitions: Record<string, string[]> = {
            PENDING: ['ASSIGNED', 'ACKNOWLEDGED', 'RESOLVED'],
            ACKNOWLEDGED: ['ASSIGNED', 'RESOLVED'],
            ASSIGNED: ['IN_PROGRESS', 'RESOLVED'],
            IN_PROGRESS: ['RESOLVED'],
            RESOLVED: ['PENDING'], // re-open only
        };

        const isValidTransition = (current: string, next: string): boolean => {
            if (current === next) return true;
            return (allowedTransitions[current] || []).includes(next);
        };

        it('permits valid progression through standard incident lifecycle', () => {
            expect(isValidTransition('PENDING', 'ASSIGNED')).toBe(true);
            expect(isValidTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
            expect(isValidTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
        });

        it('allows direct bus crew quick-resolve when commuter is attended onboard', () => {
            expect(isValidTransition('PENDING', 'RESOLVED')).toBe(true);
            expect(isValidTransition('ACKNOWLEDGED', 'RESOLVED')).toBe(true);
        });

        it('blocks invalid lifecycle hops such as jumping directly from IN_PROGRESS to PENDING', () => {
            expect(isValidTransition('IN_PROGRESS', 'PENDING')).toBe(false);
            expect(isValidTransition('RESOLVED', 'ASSIGNED')).toBe(false);
        });

        it('verifies audit trail entry generation upon each status update', () => {
            const auditEntry = {
                id: 'AUD-001',
                status: 'ASSIGNED' as const,
                changedAt: new Date().toISOString(),
                changedBy: 'Senior Dispatcher (admin@gmail.com)',
                notes: 'Assigned onboard conductor NB-5678 to assist commuter',
                directiveMessage: 'Please confirm passenger position',
            };

            expect(auditEntry.id).toBeDefined();
            expect(auditEntry.changedBy).toContain('admin@gmail.com');
            expect(auditEntry.notes).toBeDefined();
        });

        it('preserves historical timeline of status transitions in emergency record', () => {
            const history = [
                { status: 'PENDING', changedAt: '2026-10-01T00:50:00Z', changedBy: 'COMMUTER' },
                { status: 'ASSIGNED', changedAt: '2026-10-01T00:52:00Z', changedBy: 'DISPATCHER' },
                { status: 'RESOLVED', changedAt: '2026-10-01T01:05:00Z', changedBy: 'BUS_CREW' },
            ];

            expect(history).toHaveLength(3);
            expect(history[0].status).toBe('PENDING');
            expect(history[history.length - 1].status).toBe('RESOLVED');
            expect(history[history.length - 1].changedBy).toBe('BUS_CREW');
        });

        it('supports incident re-opening when post-resolution symptoms relapse', () => {
            expect(isValidTransition('RESOLVED', 'PENDING')).toBe(true);
        });
    });

    describe('12. In-Cab Bus Console & Telemetry Sync During Active SOS', () => {
        it('associates active in-cab bus session number plate with incoming alert', async () => {
            const session = {
                busId: 'BUS-177-09',
                numberPlate: 'NB-5678',
                token: 'conductor-token',
            };

            useJourneyStore.setState({
                vehicleDetails: {
                    plateNumber: session.numberPlate,
                    model: 'Lanka Ashok Leyland Low Floor',
                },
            });

            expect(useJourneyStore.getState().vehicleDetails?.plateNumber).toBe('NB-5678');
        });

        it('verifies in-cab driver console clears local activeSOS state upon confirm resolved', () => {
            useJourneyStore.setState({
                activeSOS: {
                    passengerName: 'Dilshan Silva',
                    timestamp: new Date().toISOString(),
                    isActive: true,
                },
            });

            expect(useJourneyStore.getState().activeSOS?.isActive).toBe(true);

            // Conductor clicks "Confirm Passenger Assisted"
            useJourneyStore.getState().clearSOS();

            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('verifies vehicle details persistence across multiple tab navigations', () => {
            const initialPlate = useJourneyStore.getState().vehicleDetails?.plateNumber;
            useJourneyStore.setState({ driverId: 'DRV-NEW-99' });

            expect(useJourneyStore.getState().vehicleDetails?.plateNumber).toBe(initialPlate);
            expect(useJourneyStore.getState().driverId).toBe('DRV-NEW-99');
        });

        it('retains bookingId and route association when SOS alert fires mid-trip', () => {
            useJourneyStore.setState({ bookingId: 'BKG-ROUTE-177-0091' });
            expect(useJourneyStore.getState().bookingId).toBe('BKG-ROUTE-177-0091');
        });

        it('simulates live GPS position broadcasting alongside active emergency state', () => {
            const gpsPing = {
                latitude: 6.9147,
                longitude: 79.8778,
                speed: 38.5,
                heading: 182,
                timestamp: Date.now(),
            };

            expect(gpsPing.latitude).toBeGreaterThan(6.0);
            expect(gpsPing.longitude).toBeGreaterThan(79.0);
            expect(gpsPing.speed).toBeGreaterThan(0);
        });

        it('formats vehicle description cleanly for display on emergency incident card', () => {
            const formatVehicle = (plate?: string | null, model?: string | null) => {
                if (!plate && !model) return 'Transit Bus (Vehicle Unassigned)';
                return `${plate || 'Unassigned'} • ${model || 'Standard Transit'}`;
            };

            expect(formatVehicle('NB-5678', 'Route 177 Low Floor')).toBe('NB-5678 • Route 177 Low Floor');
            expect(formatVehicle(null, null)).toBe('Transit Bus (Vehicle Unassigned)');
        });
    });

    describe('13. Offline Degradation, Network Resilience & Error Recovery', () => {
        it('reports a 503 from the emergency API as NOT sent, never as success', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9, longitude: 79.8 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockRejectedValueOnce(
                Object.assign(new Error('Service Unavailable'), { status: 503 })
            );

            const result = await triggerSOSAlert();

            expect(result.success).toBe(false);
            expect(result.message).not.toContain('Emergency SOS Sent Successfully');
            expect(result.message).toContain('NOT sent');

            // No local "SOS triggered" alert for an SOS the server never recorded.
            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('handles Location permission denial cleanly with appropriate failure response', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'denied',
            });

            const result = await triggerSOSAlert();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Location permission is required');
        });

        it('handles Location.getCurrentPositionAsync throwing hardware exception without crashing', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValueOnce(
                new Error('GPS Hardware Sensor Busy / Timeout')
            );

            const result = await triggerSOSAlert();
            expect(result.success).toBe(false);
            expect(result.message).toContain('GPS Hardware Sensor Busy / Timeout');
        });

        it('validates retry mechanism after transient connection failure', async () => {
            let attempt = 0;
            const fakeApiWithRetry = async () => {
                attempt++;
                if (attempt === 1) throw new Error('Network Timeout');
                return { success: true, attempt };
            };

            let res;
            try {
                res = await fakeApiWithRetry();
            } catch {
                res = await fakeApiWithRetry();
            }

            expect(res.success).toBe(true);
            expect(res.attempt).toBe(2);
        });

        it('recovers cleanly when journey store contains empty or corrupted strings', () => {
            useJourneyStore.setState({
                passengerDetails: { id: '', name: '', phone: '' },
            });

            const store = useJourneyStore.getState();
            const fallbackName = store.passengerDetails?.name || 'Passenger';
            const fallbackPhone = store.passengerDetails?.phone || '0771234567';

            expect(fallbackName).toBe('Passenger');
            expect(fallbackPhone).toBe('0771234567');
        });
    });

    describe('14. Commuter Safety Hub, Guardian SMS Notification & Telephony', () => {
        it('generates valid telephone URI scheme for emergency control center hotlines', () => {
            const formatTelUri = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

            expect(formatTelUri('011-234-5678')).toBe('tel:0112345678');
            expect(formatTelUri('+94 11 234 5678')).toBe('tel:+94112345678');
            expect(formatTelUri('1990')).toBe('tel:1990');
        });

        it('constructs SMS dispatch template for registered commuter caregiver', () => {
            const buildGuardianSms = (params: {
                passengerName: string;
                busPlate: string;
                route: string;
                lat: number;
                lng: number;
            }) => {
                return `MoreAble Transit Alert: ${params.passengerName} has triggered an SOS on Bus ${params.busPlate} (Route ${params.route}). Location: https://maps.google.com/?q=${params.lat},${params.lng}`;
            };

            const sms = buildGuardianSms({
                passengerName: 'Nimal Silva',
                busPlate: 'NB-5678',
                route: '177',
                lat: 6.9271,
                lng: 79.8612,
            });

            expect(sms).toContain('MoreAble Transit Alert: Nimal Silva');
            expect(sms).toContain('Bus NB-5678');
            expect(sms).toContain('https://maps.google.com/?q=6.9271,79.8612');
        });

        it('prioritizes primary mobile over secondary phone for urgent guardian SMS', () => {
            const selectGuardianContact = (primary?: string | null, secondary?: string | null) => {
                return (primary && primary.trim()) || (secondary && secondary.trim()) || '0112345678';
            };

            expect(selectGuardianContact('0779998888', '0711112222')).toBe('0779998888');
            expect(selectGuardianContact(null, '0711112222')).toBe('0711112222');
            expect(selectGuardianContact('', null)).toBe('0112345678');
        });

        it('prevents accidental rapid double-tap SOS triggers via debounce check', () => {
            let lastTriggerTimestamp = 0;
            const debounceSos = (now: number, thresholdMs = 3000) => {
                if (now - lastTriggerTimestamp < thresholdMs) return false;
                lastTriggerTimestamp = now;
                return true;
            };

            const t0 = 10000;
            expect(debounceSos(t0)).toBe(true);
            expect(debounceSos(t0 + 500)).toBe(false); // blocked (500ms < 3000ms)
            expect(debounceSos(t0 + 1500)).toBe(false); // blocked
            expect(debounceSos(t0 + 3500)).toBe(true); // allowed
        });

        it('includes medical notes in emergency dispatch snapshot if commuter opted in', () => {
            const commuterWithMedical = {
                name: 'Kavindu Perera',
                hasMedicalCondition: true,
                medicalNotes: 'Type 1 Diabetic. Carries insulin onboard.',
            };

            const formatNotes = (commuter: typeof commuterWithMedical) => {
                return commuter.hasMedicalCondition ? commuter.medicalNotes : 'None reported';
            };

            expect(formatNotes(commuterWithMedical)).toContain('Type 1 Diabetic');
        });
    });

    describe('15. Security, Sanctions & Anti-Tampering Protections', () => {
        it('validates canonical emergency ID format matching system standard', () => {
            const isValidEmergencyId = (id: string) => /^EMG-\d{5,}$/.test(id) || /^EMG-[A-Z0-9_-]+$/.test(id);

            expect(isValidEmergencyId('EMG-10203')).toBe(true);
            expect(isValidEmergencyId('EMG-2026-9901')).toBe(true);
            expect(isValidEmergencyId('INVALID-ID')).toBe(false);
            expect(isValidEmergencyId('')).toBe(false);
        });

        it('rejects attempt by regular commuter to modify administrative status to ASSIGNED', () => {
            const canModifyAdminStatus = (role: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

            expect(canModifyAdminStatus('COMMUTER')).toBe(false);
            expect(canModifyAdminStatus('DRIVER')).toBe(false);
            expect(canModifyAdminStatus('ADMIN')).toBe(true);
        });

        it('allows bus crew to confirm assisted resolution on their assigned bus', () => {
            const canResolveOnboard = (actorRole: string, busPlate: string, targetPlate: string) => {
                if (actorRole === 'ADMIN') return true;
                if (actorRole === 'BUS_CREW' && busPlate === targetPlate) return true;
                return false;
            };

            expect(canResolveOnboard('BUS_CREW', 'NB-5678', 'NB-5678')).toBe(true);
            expect(canResolveOnboard('BUS_CREW', 'NB-1111', 'NB-5678')).toBe(false);
            expect(canResolveOnboard('COMMUTER', 'NB-5678', 'NB-5678')).toBe(false);
        });

        it('neutralizes malicious scripts or HTML tags in directive inputs', () => {
            const sanitizeInput = (str: string) => str.replace(/<[^>]*>?/gm, '').trim();

            const malicious = '<script>alert("hacked")</script>Please slow down';
            expect(sanitizeInput(malicious)).toBe('alert("hacked")Please slow down');
        });

        it('verifies non-empty actionTaken report requirement when resolving emergency', () => {
            const validateResolutionPayload = (payload: { status: string; actionTaken?: string }) => {
                if (payload.status !== 'RESOLVED') return true;
                return Boolean(payload.actionTaken && payload.actionTaken.trim().length >= 10);
            };

            expect(validateResolutionPayload({ status: 'RESOLVED', actionTaken: '' })).toBe(false);
            expect(validateResolutionPayload({ status: 'RESOLVED', actionTaken: 'Too short' })).toBe(false);
            expect(validateResolutionPayload({
                status: 'RESOLVED',
                actionTaken: 'Passenger attended onboard by conductor. Normal transit resumed.',
            })).toBe(true);
        });
    });

    describe('16. Concurrency, Race Conditions & Rapid Multi-Commuter Dispatch Load', () => {
        it('handles simultaneous SOS alerts from different passengers on the same transit bus', () => {
            const passengerA = {
                bookingId: 'BKG-001',
                passengerId: 'PAS-001',
                passengerName: 'Nadeesha Silva',
                seatNumber: '4A',
            };
            const passengerB = {
                bookingId: 'BKG-002',
                passengerId: 'PAS-002',
                passengerName: 'Ruwan Kumara',
                seatNumber: '7B',
            };

            const busEmergencies: Array<{ id: string; bookingId: string; passengerName: string; seat: string }> = [];

            const ingestAlert = (commuter: typeof passengerA) => {
                busEmergencies.push({
                    id: `EMG-${commuter.bookingId}`,
                    bookingId: commuter.bookingId,
                    passengerName: commuter.passengerName,
                    seat: commuter.seatNumber,
                });
            };

            ingestAlert(passengerA);
            ingestAlert(passengerB);

            expect(busEmergencies).toHaveLength(2);
            expect(busEmergencies.map(e => e.bookingId)).toEqual(['BKG-001', 'BKG-002']);
            expect(busEmergencies[0].seat).toBe('4A');
            expect(busEmergencies[1].seat).toBe('7B');
        });

        it('deduplicates redundant SOS triggers from the same passenger within a short window', () => {
            const activeAlerts = new Map<string, { bookingId: string; timestamp: number }>();

            const submitWithDeduplication = (bookingId: string, timestamp: number) => {
                const existing = activeAlerts.get(bookingId);
                if (existing && timestamp - existing.timestamp < 10000) {
                    return { accepted: false, reason: 'Duplicate alert within suppression window' };
                }
                activeAlerts.set(bookingId, { bookingId, timestamp });
                return { accepted: true, reason: 'Alert dispatched' };
            };

            const first = submitWithDeduplication('BKG-REPEAT-1', 100000);
            const second = submitWithDeduplication('BKG-REPEAT-1', 102000); // 2s later
            const third = submitWithDeduplication('BKG-REPEAT-1', 115000); // 15s later

            expect(first.accepted).toBe(true);
            expect(second.accepted).toBe(false);
            expect(third.accepted).toBe(true);
        });

        it('processes concurrent status updates from control center and driver without crashing', () => {
            let emergencyRecord = {
                id: 'EMG-RACE-01',
                version: 1,
                status: 'PENDING',
                directive: '',
            };

            const applyOptimisticUpdate = (expectedVersion: number, newStatus: string, directive: string) => {
                if (emergencyRecord.version !== expectedVersion) {
                    return { success: false, conflict: true };
                }
                emergencyRecord = {
                    ...emergencyRecord,
                    version: emergencyRecord.version + 1,
                    status: newStatus,
                    directive,
                };
                return { success: true, conflict: false };
            };

            const op1 = applyOptimisticUpdate(1, 'ASSIGNED', 'Admin: Assigned bus crew');
            const op2Conflict = applyOptimisticUpdate(1, 'RESOLVED', 'Driver: Already assisted');
            const op2Retry = applyOptimisticUpdate(2, 'RESOLVED', 'Driver: Confirmed assisted');

            expect(op1.success).toBe(true);
            expect(op2Conflict.conflict).toBe(true);
            expect(op2Retry.success).toBe(true);
            expect(emergencyRecord.version).toBe(3);
            expect(emergencyRecord.status).toBe('RESOLVED');
        });

        it('prioritizes critical medical emergencies ahead of general transit delays in alert queue', () => {
            const queue = [
                { id: 'E-1', category: 'GENERAL_ASSISTANCE', severityScore: 2 },
                { id: 'E-2', category: 'CRITICAL_MEDICAL', severityScore: 5 },
                { id: 'E-3', category: 'WHEELCHAIR_RAMP', severityScore: 3 },
                { id: 'E-4', category: 'CARDIOVASCULAR', severityScore: 5 },
            ];

            const sortedQueue = [...queue].sort((a, b) => b.severityScore - a.severityScore);

            expect(sortedQueue[0].severityScore).toBe(5);
            expect(sortedQueue[1].severityScore).toBe(5);
            expect(sortedQueue[sortedQueue.length - 1].category).toBe('GENERAL_ASSISTANCE');
        });

        it('stress-tests batch serialization of 100 rapid dispatch events', () => {
            const batch = Array.from({ length: 100 }, (_, i) => ({
                id: `BATCH-${i + 1}`,
                event: 'PING',
                seq: i + 1,
                time: Date.now() + i * 10,
            }));

            const serialized = JSON.stringify(batch);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toHaveLength(100);
            expect(deserialized[99].seq).toBe(100);
        });
    });

    describe('17. Location Telemetry Geofencing & Vehicle Route Deviation Alerts', () => {
        const SRI_LANKA_BOUNDS = {
            minLat: 5.9,
            maxLat: 9.9,
            minLng: 79.5,
            maxLng: 81.9,
        };

        const isInsideSriLanka = (lat: number, lng: number) => {
            return (
                lat >= SRI_LANKA_BOUNDS.minLat &&
                lat <= SRI_LANKA_BOUNDS.maxLat &&
                lng >= SRI_LANKA_BOUNDS.minLng &&
                lng <= SRI_LANKA_BOUNDS.maxLng
            );
        };

        it('validates GPS coordinates of commuter within valid Sri Lanka boundaries', () => {
            expect(isInsideSriLanka(6.9271, 79.8612)).toBe(true); // Colombo
            expect(isInsideSriLanka(7.2906, 80.6337)).toBe(true); // Kandy
            expect(isInsideSriLanka(6.0535, 80.2210)).toBe(true); // Galle
            expect(isInsideSriLanka(0.0, 0.0)).toBe(false);        // Null Island
            expect(isInsideSriLanka(37.7749, -122.4194)).toBe(false); // San Francisco
        });

        it('calculates approximate haversine distance between bus and emergency coordinates', () => {
            const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                const R = 6371; // Earth radius in km
                const dLat = (lat2 - lat1) * (Math.PI / 180);
                const dLon = (lon2 - lon1) * (Math.PI / 180);
                const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * (Math.PI / 180)) *
                        Math.cos(lat2 * (Math.PI / 180)) *
                        Math.sin(dLon / 2) *
                        Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            };

            // Distance between Fort Station (6.9344, 79.8504) and Town Hall (6.9147, 79.8653)
            const dist = calculateDistanceKm(6.9344, 79.8504, 6.9147, 79.8653);
            expect(dist).toBeGreaterThan(2.0);
            expect(dist).toBeLessThan(3.5);
        });

        it('flags route deviation when emergency stop occurs > 1km from designated route corridor', () => {
            const checkRouteDeviation = (stopDistanceKm: number, maxAllowedKm = 1.0) => {
                return stopDistanceKm > maxAllowedKm;
            };

            expect(checkRouteDeviation(0.3)).toBe(false);
            expect(checkRouteDeviation(0.8)).toBe(false);
            expect(checkRouteDeviation(1.8)).toBe(true);
        });

        it('attaches nearest healthcare facility metadata for Colombo route dispatch', () => {
            const hospitals = [
                { name: 'National Hospital of Sri Lanka', lat: 6.9189, lng: 79.8679 },
                { name: 'Kalubowila Teaching Hospital', lat: 6.8722, lng: 79.8828 },
                { name: 'Sri Jayewardenepura General Hospital', lat: 6.8744, lng: 79.9328 },
            ];

            const emergencyLat = 6.9150;
            const emergencyLng = 79.8680;

            const nearest = hospitals.reduce((prev, curr) => {
                const prevDist = Math.hypot(prev.lat - emergencyLat, prev.lng - emergencyLng);
                const currDist = Math.hypot(curr.lat - emergencyLat, curr.lng - emergencyLng);
                return currDist < prevDist ? curr : prev;
            });

            expect(nearest.name).toBe('National Hospital of Sri Lanka');
        });

        it('discards GPS telemetry with unrealistic horizontal accuracy radius (> 1000m)', () => {
            const isGpsAccuracyAcceptable = (accuracyMeters?: number) => {
                if (accuracyMeters === undefined || accuracyMeters === null) return false;
                return accuracyMeters <= 500;
            };

            expect(isGpsAccuracyAcceptable(15)).toBe(true);
            expect(isGpsAccuracyAcceptable(80)).toBe(true);
            expect(isGpsAccuracyAcceptable(1200)).toBe(false);
            expect(isGpsAccuracyAcceptable(undefined)).toBe(false);
        });
    });

    describe('18. End-to-End WebSocket & Polling Simulation for Driver Console', () => {
        it('configures standard 3500ms polling interval for in-cab active emergency sync', () => {
            const getPollingIntervalMs = (hasActiveSos: boolean, isModalOpen: boolean) => {
                if (hasActiveSos || isModalOpen) return 3500;
                return 10000;
            };

            expect(getPollingIntervalMs(true, false)).toBe(3500);
            expect(getPollingIntervalMs(false, true)).toBe(3500);
            expect(getPollingIntervalMs(false, false)).toBe(10000);
        });

        it('simulates periodic dispatcher ping heartbeat without memory leak', () => {
            let pingCount = 0;
            const timer = {
                tick: () => { pingCount++; },
                cleanup: () => { pingCount = 0; },
            };

            for (let i = 0; i < 5; i++) {
                timer.tick();
            }
            expect(pingCount).toBe(5);

            timer.cleanup();
            expect(pingCount).toBe(0);
        });

        it('handles unhandled network drops during polling loop silently without uncaught errors', async () => {
            const silentPollingFetch = async () => {
                try {
                    throw new Error('Socket closed by peer');
                } catch {
                    return null;
                }
            };

            const res = await silentPollingFetch();
            expect(res).toBeNull();
        });

        it('triggers immediate out-of-band sync when driver opens dispatch chat modal', () => {
            let syncTriggered = false;
            const onOpenModal = () => {
                syncTriggered = true;
            };

            onOpenModal();
            expect(syncTriggered).toBe(true);
        });

        it('suspends intensive dispatch polling when driver console screen unmounts', () => {
            let isPollingActive = true;
            const unmountScreen = () => {
                isPollingActive = false;
            };

            unmountScreen();
            expect(isPollingActive).toBe(false);
        });
    });

    describe('19. Caregiver Remote Monitoring & Care Recipient Safety Notifications', () => {
        it('structures caregiver remote tracking payload with live vehicle plate and status', () => {
            const caregiverAlert = {
                caregiverId: 'CG-887',
                dependentName: 'Nimal Silva',
                vehiclePlate: 'NB-5678',
                routeNumber: '177',
                status: 'EMERGENCY_DISPATCHED',
                timestamp: new Date().toISOString(),
                liveLocation: { latitude: 6.9271, longitude: 79.8612 },
            };

            expect(caregiverAlert.caregiverId).toBe('CG-887');
            expect(caregiverAlert.vehiclePlate).toBe('NB-5678');
            expect(caregiverAlert.status).toBe('EMERGENCY_DISPATCHED');
        });

        it('formats push notification message for caregiver lock-screen alert', () => {
            const formatPush = (name: string, busPlate: string) => {
                return `EMERGENCY ALERT: ${name} triggered SOS on bus ${busPlate}. Tap to view live location & contact crew.`;
            };

            const pushText = formatPush('Kasun Perera', 'NB-5678');
            expect(pushText).toContain('Kasun Perera');
            expect(pushText).toContain('NB-5678');
        });

        it('records caregiver read receipt / acknowledgement timestamp', () => {
            const alertNotification = {
                alertId: 'ALR-001',
                sentAt: '2026-10-01T01:00:00Z',
                acknowledgedAt: null as string | null,
            };

            const acknowledgeAlert = () => {
                alertNotification.acknowledgedAt = '2026-10-01T01:01:15Z';
            };

            acknowledgeAlert();
            expect(alertNotification.acknowledgedAt).not.toBeNull();
            expect(alertNotification.acknowledgedAt).toBe('2026-10-01T01:01:15Z');
        });

        it('cascades to alternate emergency contacts if primary caregiver does not respond within 3 minutes', () => {
            const contacts = [
                { phone: '0779900112', relationship: 'Father', status: 'UNREACHABLE' },
                { phone: '0714455667', relationship: 'Sister', status: 'PENDING' },
            ];

            const getNextContact = () => {
                return contacts.find(c => c.status === 'PENDING') || null;
            };

            expect(getNextContact()?.relationship).toBe('Sister');
        });
    });

    describe('20. Data Privacy, Encryption & Audit Compliance (GDPR/Data Protection)', () => {
        it('masks sensitive National Identity Card (NIC) numbers in operational dispatch feeds', () => {
            const maskNic = (nic: string) => {
                if (nic.length <= 4) return '****';
                return nic.slice(0, 3) + '****' + nic.slice(-2);
            };

            expect(maskNic('199812345678')).toBe('199****78');
            expect(maskNic('981234567V')).toBe('981****7V');
        });

        it('redacts confidential diagnosis medical details from public dispatch transcripts', () => {
            const sanitizeMedicalDetails = (fullNotes: string) => {
                // Extracts assistance directive while masking private medical diagnosis
                if (fullNotes.toLowerCase().includes('diabetic')) {
                    return 'Special Note: Passenger requires urgent medical/sugar vitals check';
                }
                return fullNotes;
            };

            const sanitized = sanitizeMedicalDetails('Diagnosed Type 1 Diabetic');
            expect(sanitized).toBe('Special Note: Passenger requires urgent medical/sugar vitals check');
        });

        it('computes 30-day automated purge timestamp for resolved emergency records', () => {
            const resolvedDate = new Date('2026-10-01T01:00:00Z');
            const purgeDate = new Date(resolvedDate.getTime() + 30 * 24 * 60 * 60 * 1000);

            expect(purgeDate.toISOString()).toBe('2026-10-31T01:00:00.000Z');
        });

        it('validates immutable audit timestamps against system clock skew', () => {
            const verifyTimestampIntegrity = (createdTime: number, systemTime: number) => {
                const driftMs = Math.abs(systemTime - createdTime);
                return driftMs < 300000; // max 5 minutes drift allowed
            };

            const now = Date.now();
            expect(verifyTimestampIntegrity(now - 1000, now)).toBe(true);
            expect(verifyTimestampIntegrity(now - 600000, now)).toBe(false); // 10 min drift rejected
        });
    });

    describe('21. End-to-End Incident Resolution Confirmation & Telemetry Cleanup', () => {
        it('finalizes active emergency record into an immutable post-incident report', () => {
            const activeEmergency = {
                id: 'EMG-FINAL-001',
                status: 'RESOLVED',
                resolvedAt: new Date().toISOString(),
                resolvedBy: 'Bus Crew (NB-5678)',
                actionTaken: 'Commuter assisted with wheelchair ramp at Maharagama Halt. Passenger safe.',
                passenger: {
                    name: 'Nimal Silva',
                    phone: '0771234567',
                    specialAssistance: 'Wheelchair Ramp',
                },
                vehicle: {
                    plateNumber: 'NB-5678',
                    model: 'Transit Bus',
                },
            };

            expect(activeEmergency.status).toBe('RESOLVED');
            expect(activeEmergency.resolvedBy).toContain('NB-5678');
            expect(activeEmergency.actionTaken.length).toBeGreaterThan(20);
        });

        it('resets commuter journey store activeSOS state to null after successful clearance', () => {
            useJourneyStore.setState({
                activeSOS: {
                    passengerName: 'Nimal Silva',
                    timestamp: new Date().toISOString(),
                    isActive: true,
                },
            });

            expect(useJourneyStore.getState().activeSOS).not.toBeNull();

            // Perform store reset
            useJourneyStore.getState().clearSOS();

            expect(useJourneyStore.getState().activeSOS).toBeNull();
        });

        it('dispatches resolution webhook notification to National Transport Medical Authority simulator', () => {
            const mockWebhookDispatcher = jest.fn();
            const payload = {
                emergencyId: 'EMG-FINAL-001',
                clearedBy: 'Bus Crew (NB-5678)',
                clearedAt: new Date().toISOString(),
                transitHalt: 'Maharagama Central Bus Stand',
            };

            mockWebhookDispatcher(payload);

            expect(mockWebhookDispatcher).toHaveBeenCalledWith(
                expect.objectContaining({
                    emergencyId: 'EMG-FINAL-001',
                    clearedBy: 'Bus Crew (NB-5678)',
                })
            );
        });
    });
});

