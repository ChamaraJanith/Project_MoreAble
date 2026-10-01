// Passenger SOS carries the CURRENT passenger and the CURRENT running journey.
//
// What an SOS says about who and where is taken from two places only:
//
//   who      the signed-in user (authStore) — never a profile left in the
//            journey store, never a made-up id
//   journey  a fresh GET /api/journeys/ongoing, through the same
//            syncActiveJourney the Active Journey screen uses — never a
//            remembered journey, a booking that is not running, or the bus
//            session saved on this device
//
// The real route answers from a seeded database; the real API client, sync,
// journey store, auth store and its logout run as they do in the app. Only
// GPS, the emergency API client, Expo-bound modules, the Firebase handle and
// the token check are stubbed. Sessions are opaque strings, not credentials.

import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import * as EmergencyAdminApi from '../../../src/features/admin/api/emergencyAdminApi';
import { resetActiveJourneySession, syncActiveJourney } from '../../../src/features/journey/services/activeJourneySync';
import { SOS_JOURNEY_SYNC_TIMEOUT_MS, triggerSOSAlert } from '../../../src/features/journey/services/sosService';
import * as BusSessionModule from '../../../src/shared/utils/busSession';
import { useAuthStore } from '../../../src/shared/store/authStore';
import { useJourneyStore } from '../../../src/shared/store/journeyStore';
import { SeedBooking, seedOngoingJourneys } from '../../testUtils/ongoingJourneySeed';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
}));

jest.mock('../../../src/features/admin/api/emergencyAdminApi', () => ({
    createEmergencyRequestApi: jest.fn(),
}));

jest.mock('../../../src/shared/utils/busSession', () => ({
    getBusSession: jest.fn(),
}));

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

jest.mock('../../../src/shared/utils/tokenStorage', () => ({
    saveTokens: jest.fn(async () => {}),
    getAccessToken: jest.fn(async () => null),
    getUserData: jest.fn(async () => null),
    clearTokens: jest.fn(async () => {}),
    isTokenExpired: jest.fn(() => false),
    saveSavedCredentials: jest.fn(async () => {}),
    getSavedCredentials: jest.fn(async () => null),
    clearSavedCredentials: jest.fn(async () => {}),
}));

const createEmergency = EmergencyAdminApi.createEmergencyRequestApi as jest.Mock;

// ------------------------------------------------------------------
// Two passengers on one device.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';
const SESSION_A = 'session-passenger-a';
const SESSION_B = 'session-passenger-b';
const SESSIONS: Record<string, string> = { [SESSION_A]: PASSENGER_A, [SESSION_B]: PASSENGER_B };

const userFor = (passengerId: string, name: string, phone: string, guardianMobile: string | null) =>
    ({
        uid: `uid-${passengerId}`,
        passengerId,
        userName: name,
        email: `${passengerId}@moreable.lk`,
        phoneNumber: phone,
        role: 'COMMUTER',
        guardianDetails: guardianMobile ? { fullName: `Guardian of ${name}`, mobileNo: guardianMobile } : null,
    }) as any;

const USER_A = userFor(PASSENGER_A, 'Passenger A', '0711000001', '0771000001');
const USER_B = userFor(PASSENGER_B, 'Passenger B', '0712000002', null);

const A_RUNNING: SeedBooking = { bookingId: 'BK-A', userId: PASSENGER_A, tripId: 'TRIP-00004', busId: 'BUS-8899', trip: 'running' };
const B_RUNNING: SeedBooking = { bookingId: 'BK-B', userId: PASSENGER_B, tripId: 'TRIP-00005', busId: 'BUS-7777', trip: 'running' };

/** Every identifier of A's journey and profile, for "none of this leaked" checks. */
const A_TRACES = /BK-A\b|TRIP-00004|BUS-8899|NB-8899|PAS-2026-00001|Passenger A|0711000001|0771000001/;
const DEMO_VALUES = /BKG-998877|WP-CBA-1234|Toyota Prius|DRV-112|CG-887|PAS-554|Nimal Silva/;
const RANDOM_PASSENGER_ID = /^PAS-\d{3}$/;

function signIn(token: string, user: any) {
    useAuthStore.setState({ token, user, isAuthenticated: true });
}

function grantGps() {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 6.9271, longitude: 79.8612 } });
}

/** The one payload sent to the emergency API. */
function sentPayload() {
    expect(createEmergency).toHaveBeenCalledTimes(1);
    return createEmergency.mock.calls[0][0];
}

const NO_JOURNEY_IDENTITY = { bookingId: null, tripId: null, busId: null, vehicle: null };

let fetchMock: jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => {
        const passengerId = SESSIONS[token];
        return passengerId
            ? { uid: `uid-${passengerId}`, passengerId, role: 'PASSENGER', email: `${passengerId}@moreable.lk` }
            : null;
    });
    mockGetAdminDb.mockReturnValue(seedOngoingJourneys([A_RUNNING]));
    fetchMock = jest.fn(async (url: string, init?: RequestInit) =>
        String(url).includes('/api/journeys/ongoing') ? getOngoing(new Request(url, init)) : Response.json({ success: true })
    );
    (global as any).fetch = fetchMock;
    (BusSessionModule.getBusSession as jest.Mock).mockResolvedValue({ busId: 'BUS-DEVICE-01', numberPlate: 'WP-DEV-0001', token: 'bus-session-opaque' });
    createEmergency.mockResolvedValue({ id: 'EMG-TEST', status: 'PENDING' });
    grantGps();

    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
    resetActiveJourneySession();
    useJourneyStore.getState().clearSOS();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    (console.warn as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
});

describe('1. a real ongoing journey', () => {
    it('sends its exact booking, trip, bus and vehicle, for the signed-in passenger', async () => {
        signIn(SESSION_A, USER_A);

        await expect(triggerSOSAlert()).resolves.toEqual({ success: true, message: 'Emergency SOS Sent Successfully!' });

        expect(sentPayload()).toMatchObject({
            bookingId: 'BK-A',
            tripId: 'TRIP-00004',
            busId: 'BUS-8899',
            vehicle: { plateNumber: 'NB-8899', model: 'Viking' },
            passenger: { id: PASSENGER_A, name: 'Passenger A', phone: '0711000001' },
            alertRecipients: { caregiver: '0771000001', driver: 'BUS-8899', admin: 'ADMIN_TOPIC' },
        });
    });

    it('picks the running booking, not a newer future one', async () => {
        mockGetAdminDb.mockReturnValue(
            seedOngoingJourneys([
                { bookingId: 'BK-A-FUTURE', userId: PASSENGER_A, tripId: 'TRIP-00009', busId: 'BUS-5555', trip: 'not-started', createdAt: '2026-09-30T12:00:00.000Z' },
                A_RUNNING,
            ])
        );
        signIn(SESSION_A, USER_A);

        await triggerSOSAlert();

        expect(sentPayload()).toMatchObject({ bookingId: 'BK-A', tripId: 'TRIP-00004', busId: 'BUS-8899' });
        expect(JSON.stringify(sentPayload())).not.toMatch(/BK-A-FUTURE|TRIP-00009|BUS-5555/);
    });

    it('asks the ongoing endpoint afresh for this SOS', async () => {
        signIn(SESSION_A, USER_A);

        await triggerSOSAlert();

        const ongoingCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/journeys/ongoing'));
        expect(ongoingCalls).toHaveLength(1);
        expect((ongoingCalls[0][1].headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_A}`);
    });
});

describe('2/5. no ongoing journey', () => {
    it('a future and a completed booking send no journey identity and no vehicle', async () => {
        mockGetAdminDb.mockReturnValue(
            seedOngoingJourneys([
                { bookingId: 'BK-A-DONE', userId: PASSENGER_A, tripId: 'TRIP-00004', busId: 'BUS-8899', trip: 'ended' },
                { bookingId: 'BK-A-FUTURE', userId: PASSENGER_A, tripId: 'TRIP-00009', busId: 'BUS-5555', trip: 'not-started', createdAt: '2026-09-30T12:00:00.000Z' },
            ])
        );
        signIn(SESSION_A, USER_A);

        await expect(triggerSOSAlert()).resolves.toMatchObject({ success: true });

        expect(sentPayload()).toMatchObject({ ...NO_JOURNEY_IDENTITY, alertRecipients: { driver: null } });
        expect(JSON.stringify(sentPayload())).not.toMatch(/BK-A-DONE|BK-A-FUTURE|TRIP-0000|BUS-|NB-|WP-DEV-0001/);
        expect(JSON.stringify(sentPayload())).not.toMatch(DEMO_VALUES);
    });

    it('a journey that has ended since the screen last synced is not sent', async () => {
        signIn(SESSION_A, USER_A);
        await syncActiveJourney(SESSION_A);
        expect(useJourneyStore.getState().bookingId).toBe('BK-A');

        // The bus ends the run; the store still holds it until the next sync.
        mockGetAdminDb.mockReturnValue(seedOngoingJourneys([{ ...A_RUNNING, trip: 'ended' }]));

        await triggerSOSAlert();

        expect(sentPayload()).toMatchObject(NO_JOURNEY_IDENTITY);
    });

    it('a journey held in the store but never confirmed by the server is not sent', async () => {
        mockGetAdminDb.mockReturnValue(seedOngoingJourneys([{ ...A_RUNNING, trip: 'not-started' }]));
        signIn(SESSION_A, USER_A);
        useJourneyStore.setState({
            isJourneyStarted: true,
            bookingId: 'BK-STALE',
            tripId: 'TRIP-STALE',
            busId: 'BUS-STALE',
            vehicleDetails: { plateNumber: 'NB-STALE', model: 'Stale' },
            driverId: 'BUS-STALE',
        });

        await triggerSOSAlert();

        expect(JSON.stringify(sentPayload())).not.toContain('STALE');
        expect(sentPayload()).toMatchObject(NO_JOURNEY_IDENTITY);
    });
});

describe('3. no signed-in passenger', () => {
    it('refuses, sending nothing — no cached profile, no made-up id, no location prompt', async () => {
        useJourneyStore.setState({
            passengerDetails: { id: PASSENGER_A, name: 'Passenger A', phone: '0711000001' },
            caregiverId: '0771000001',
            isJourneyStarted: true,
            bookingId: 'BK-A',
        });

        const result = await triggerSOSAlert();

        expect(result).toEqual({ success: false, message: 'Please sign in to send an SOS.' });
        expect(createEmergency).not.toHaveBeenCalled();
        expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(useJourneyStore.getState().activeSOS).toBeNull();
    });

    it('a user without a session token is not treated as signed in', async () => {
        useAuthStore.setState({ user: USER_A, token: null, isAuthenticated: false });

        await expect(triggerSOSAlert()).resolves.toMatchObject({ success: false });
        expect(createEmergency).not.toHaveBeenCalled();
    });

    it('the passenger id always comes from the signed-in user', async () => {
        signIn(SESSION_A, { ...USER_A, passengerId: '' });

        await triggerSOSAlert();

        expect(sentPayload().passenger.id).toBe(`uid-${PASSENGER_A}`);
        expect(sentPayload().passenger.id).not.toMatch(RANDOM_PASSENGER_ID);
    });
});

describe("4. account switch — none of A's journey or profile reaches B's SOS", () => {
    async function aWithJourneyThenLogout() {
        signIn(SESSION_A, USER_A);
        await syncActiveJourney(SESSION_A);
        // What the Active Journey screen writes from A's profile.
        useJourneyStore.setState({
            passengerDetails: { id: PASSENGER_A, name: 'Passenger A', phone: '0711000001' },
            caregiverId: '0771000001',
        });
        expect(useJourneyStore.getState().bookingId).toBe('BK-A');

        await useAuthStore.getState().logout();
    }

    it('B with no running journey', async () => {
        await aWithJourneyThenLogout();
        signIn(SESSION_B, USER_B);

        await triggerSOSAlert();

        expect(sentPayload()).toMatchObject({
            ...NO_JOURNEY_IDENTITY,
            passenger: { id: PASSENGER_B, name: 'Passenger B', phone: '0712000002' },
            alertRecipients: { caregiver: null, driver: null },
        });
        expect(JSON.stringify(sentPayload())).not.toMatch(A_TRACES);
    });

    it('B with their own running journey', async () => {
        await aWithJourneyThenLogout();
        mockGetAdminDb.mockReturnValue(seedOngoingJourneys([A_RUNNING, B_RUNNING]));
        signIn(SESSION_B, USER_B);

        await triggerSOSAlert();

        expect(sentPayload()).toMatchObject({
            bookingId: 'BK-B',
            tripId: 'TRIP-00005',
            busId: 'BUS-7777',
            vehicle: { plateNumber: 'NB-7777', model: 'Viking' },
            passenger: { id: PASSENGER_B },
        });
        expect(JSON.stringify(sentPayload())).not.toMatch(A_TRACES);
    });

    it('a session that changes while the SOS is in progress sends nothing', async () => {
        signIn(SESSION_A, USER_A);
        (Location.getCurrentPositionAsync as jest.Mock).mockImplementationOnce(async () => {
            signIn(SESSION_B, USER_B);
            return { coords: { latitude: 6.9271, longitude: 79.8612 } };
        });

        const result = await triggerSOSAlert();

        expect(result).toEqual({ success: false, message: 'Your session changed. Please try again.' });
        expect(createEmergency).not.toHaveBeenCalled();
    });
});

describe('6. vehicle source', () => {
    it("the journey's vehicle is sent; the bus session saved on this device is never read", async () => {
        signIn(SESSION_A, USER_A);

        await triggerSOSAlert();

        expect(sentPayload().vehicle).toEqual({ plateNumber: 'NB-8899', model: 'Viking' });
        expect(JSON.stringify(sentPayload())).not.toMatch(/WP-DEV-0001|BUS-DEVICE-01/);
        expect(BusSessionModule.getBusSession).not.toHaveBeenCalled();
    });

    it('with no running journey the bus session does not stand in for a vehicle', async () => {
        mockGetAdminDb.mockReturnValue(seedOngoingJourneys([{ ...A_RUNNING, trip: 'not-started' }]));
        signIn(SESSION_A, USER_A);

        await triggerSOSAlert();

        expect(sentPayload().vehicle).toBeNull();
        expect(JSON.stringify(sentPayload())).not.toMatch(/WP-DEV-0001|BUS-DEVICE-01/);
    });
});

describe('7. when the fresh journey cannot be confirmed', () => {
    it('a failed refresh sends no journey identity, and the SOS still goes', async () => {
        signIn(SESSION_A, USER_A);
        await syncActiveJourney(SESSION_A);
        mockGetAdminDb.mockImplementation(() => {
            throw new Error('database unavailable');
        });

        await expect(triggerSOSAlert()).resolves.toMatchObject({ success: true });
        expect(sentPayload()).toMatchObject(NO_JOURNEY_IDENTITY);
    });

    it('a refresh that does not answer in time sends no journey identity, and the SOS still goes', async () => {
        signIn(SESSION_A, USER_A);
        await syncActiveJourney(SESSION_A);
        expect(useJourneyStore.getState().bookingId).toBe('BK-A');

        jest.useFakeTimers();
        fetchMock.mockImplementation(() => new Promise(() => {}));

        const pending = triggerSOSAlert();
        await jest.advanceTimersByTimeAsync(SOS_JOURNEY_SYNC_TIMEOUT_MS);

        await expect(pending).resolves.toMatchObject({ success: true });
        expect(sentPayload()).toMatchObject(NO_JOURNEY_IDENTITY);
    });
});
