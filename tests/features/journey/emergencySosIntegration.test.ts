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

describe('MOV-231 / MOV-236: Passenger SOS Integration with Admin Emergency Dispatch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useJourneyStore.getState().clearSOS();
        useJourneyStore.setState({
            bookingId: 'BKG-998877',
            vehicleDetails: { plateNumber: 'WP-CBA-1234', model: 'Toyota Prius' },
            driverId: 'DRV-112',
            passengerDetails: { id: 'PAS-554', name: 'Nimal Silva', phone: '0771234567' },
            caregiverId: 'CG-887',
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
                    bookingId: 'BKG-998877',
                    status: 'ACTIVE',
                    passenger: expect.objectContaining({
                        name: 'Nimal Silva',
                        phone: '0771234567',
                    }),
                    vehicle: expect.objectContaining({
                        plateNumber: 'WP-CBA-1234',
                    }),
                    location: expect.objectContaining({
                        latitude: 6.9319,
                        longitude: 79.8478,
                    }),
                    alertRecipients: expect.objectContaining({
                        caregiver: 'CG-887',
                        driver: 'DRV-112',
                        admin: 'ADMIN_TOPIC',
                    }),
                })
            );
        });

        it('retains local vehicle alert even if backend network call fails', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });
            (EmergencyAdminApi.createEmergencyRequestApi as jest.Mock).mockRejectedValueOnce(
                new Error('Network offline')
            );

            const result = await triggerSOSAlert();

            // Local alert is still successfully initiated for driver & onboard safety
            expect(result.success).toBe(true);
            const store = useJourneyStore.getState();
            expect(store.activeSOS?.isActive).toBe(true);
            expect(store.activeSOS?.passengerName).toBe('Nimal Silva');
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
        it('captures custom passenger details and bus plate from journey store correctly', async () => {
            useJourneyStore.setState({
                bookingId: 'BKG-COL-KANDY-01',
                passengerDetails: { id: 'PAS-991', name: 'Sarath Fonseka', phone: '0719876543' },
                vehicleDetails: { plateNumber: 'WP-ND-8899', model: 'Ashok Leyland Super' },
                driverId: 'DRV-770',
                caregiverId: 'CG-552',
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
                    passenger: { id: 'PAS-991', name: 'Sarath Fonseka', phone: '0719876543' },
                    vehicle: { plateNumber: 'WP-ND-8899', model: 'Ashok Leyland Super' },
                    alertRecipients: {
                        caregiver: 'CG-552',
                        driver: 'DRV-770',
                        admin: 'ADMIN_TOPIC',
                    },
                })
            );
        });

        it('handles null caregiverId gracefully in alert recipients', async () => {
            useJourneyStore.setState({
                caregiverId: null,
            });

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
                        driver: 'DRV-112',
                        admin: 'ADMIN_TOPIC',
                    }),
                })
            );
        });

        it('handles null vehicleDetails gracefully when SOS is triggered outside a vehicle', async () => {
            useJourneyStore.setState({
                vehicleDetails: null,
                driverId: null,
            });

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

        it('falls back to "Unknown Passenger" if passengerDetails is null in store', async () => {
            useJourneyStore.setState({
                passengerDetails: null,
            });

            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.92, longitude: 79.86 },
            });

            await triggerSOSAlert();

            const activeSOS = useJourneyStore.getState().activeSOS;
            expect(activeSOS?.passengerName).toBe('Unknown Passenger');
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

        it('retains passenger details and vehicle registration unchanged when SOS is cleared', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9271, longitude: 79.8612 },
            });

            await triggerSOSAlert();
            useJourneyStore.getState().clearSOS();

            const state = useJourneyStore.getState();
            expect(state.passengerDetails?.name).toBe('Nimal Silva');
            expect(state.vehicleDetails?.plateNumber).toBe('WP-CBA-1234');
            expect(state.bookingId).toBe('BKG-998877');
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
                        caregiver: 'CG-887',
                        driver: 'DRV-112',
                        admin: 'ADMIN_TOPIC',
                    },
                    status: 'ACTIVE',
                })
            );
        });

        it('logs accurate console message with entire serialized SOS payload', async () => {
            (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
                status: 'granted',
            });
            (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({
                coords: { latitude: 6.9319, longitude: 79.8478 },
            });

            await triggerSOSAlert();

            expect(console.log).toHaveBeenCalledWith(
                'SOS Alert Triggered!',
                expect.objectContaining({
                    status: 'ACTIVE',
                    bookingId: 'BKG-998877',
                })
            );
        });
    });
});
