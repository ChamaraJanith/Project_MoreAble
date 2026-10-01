// Signing out, or one passenger replacing another, empties the Active Journey.
//
// The defect this covers: journeyStore holds the signed-in passenger's running
// journey and their own profile/caregiver details, and `logout()` left them
// there. On a shared device the next passenger started from the previous
// one's booking, trip, bus and vehicle — and a request still in flight for the
// previous passenger could land after the session ended and write their
// journey back.
//
// An integration test of the REAL seam, like favouriteRoutesLogout: the real
// auth store and its real `logout()`, the real journey store, the real
// activeJourneySync subscription, the real API client, and the real
// GET /api/journeys/ongoing answering from a seeded database. Only the modules
// that reach into Expo (`shared/api/config`, `shared/utils/tokenStorage`), the
// Firebase handle and the token check are stubbed.
//
// No credential appears anywhere: sessions are opaque strings handed to the
// auth store directly, and the stubbed token check maps each to its passenger.

import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { resetActiveJourneySession, syncActiveJourney } from '../../../src/features/journey/services/activeJourneySync';
import { useAuthStore } from '../../../src/shared/store/authStore';
import { useJourneyStore } from '../../../src/shared/store/journeyStore';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

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

// ------------------------------------------------------------------
// Fixtures — two passengers, each on their own trip of route 177.
//
//   TRIP-00004  NB-8899 (BUS-8899)   STARTED 30 min ago   Passenger A: BK-A
//   TRIP-00005  NB-7777 (BUS-7777)   started or not, per test   Passenger B: BK-B
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';

/** Opaque stand-ins for a signed-in session. Not credentials. */
const SESSION_A = 'session-passenger-a';
const SESSION_B = 'session-passenger-b';

const PASSENGERS: Record<string, string> = { [SESSION_A]: PASSENGER_A, [SESSION_B]: PASSENGER_B };

const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function booking(bookingId: string, userId: string, tripId: string, busId: string) {
    return {
        bookingId,
        userId,
        tripId,
        routeId: '177_KADUWELA_KOLLUPITIYA',
        busId,
        seatNumber: '05A',
        status: 'CONFIRMED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Kollupitiya',
            departureTime: '06:00',
            estimatedArrivalTime: '07:15',
        },
        vehicle: { numberPlate: busId.replace('BUS-', 'NB-'), busModel: 'Viking', manufacturer: 'Ashok Leyland' },
        createdAt: '2026-09-20T12:00:00.000Z',
    };
}

const startedJourney = (busId: string, startedAt: string) => ({
    status: 'STARTED',
    startedAt,
    endedAt: null,
    busId,
    scheduledDepartureAt: minutesAgo(25),
    scheduledArrivalAt: minutesAgo(-90),
    expiresAt: minutesAgo(-120),
});

function seed({ tripBRunning }: { tripBRunning: boolean }) {
    return createFakeFirestore({
        trips: [
            { tripId: 'TRIP-00004', routeId: '177_KADUWELA_KOLLUPITIYA', busId: 'BUS-8899', departureTime: '06:00', status: 'ACTIVE', journey: startedJourney('BUS-8899', minutesAgo(30)) },
            {
                tripId: 'TRIP-00005',
                routeId: '177_KADUWELA_KOLLUPITIYA',
                busId: 'BUS-7777',
                departureTime: '06:30',
                status: 'ACTIVE',
                ...(tripBRunning ? { journey: startedJourney('BUS-7777', minutesAgo(10)) } : {}),
            },
        ],
        bookings: [
            booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899'),
            booking('BK-B', PASSENGER_B, 'TRIP-00005', 'BUS-7777'),
        ],
        vehicleLocations: [],
        buses: [{ busId: 'BUS-8899' }, { busId: 'BUS-7777' }],
    });
}

// ------------------------------------------------------------------
// fetch: the ongoing request goes to the real route, optionally held open so a
// test can end the session while it is in flight. Anything else (logout's
// best-effort push de-registration) just succeeds.
// ------------------------------------------------------------------
let holdOngoing = false;
let held: (() => void)[] = [];
let fetchMock: jest.Mock;

function installFetch() {
    held = [];
    holdOngoing = false;
    fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
        if (!url.includes('/api/journeys/ongoing')) {
            return Response.json({ success: true });
        }
        if (holdOngoing) {
            await new Promise<void>((resolve) => held.push(resolve));
        }
        return getOngoing(new Request(url, init));
    });
    (global as any).fetch = fetchMock;
}

/** Lets every held ongoing request answer, and the sync behind it finish. */
async function releaseHeld() {
    held.splice(0).forEach((resolve) => resolve());
}

/** Puts a session on the auth store the way a completed login leaves it. */
function signIn(token: string) {
    const passengerId = PASSENGERS[token];
    useAuthStore.setState({
        token,
        isAuthenticated: true,
        user: { uid: `uid-${passengerId}`, passengerId, userName: `Passenger ${passengerId}`, email: `${passengerId}@moreable.lk` } as any,
    });
}

/** What the Active Journey screen writes from the signed-in user on mount. */
function hydrateProfile(name: string, guardianMobile: string) {
    useJourneyStore.setState({
        passengerDetails: { id: name, name, phone: '0700000000' },
        caregiverId: guardianMobile,
    });
}

const sessionFields = () => {
    const { isJourneyStarted, bookingId, tripId, busId, vehicleDetails, driverId, passengerDetails, caregiverId } =
        useJourneyStore.getState();
    return { isJourneyStarted, bookingId, tripId, busId, vehicleDetails, driverId, passengerDetails, caregiverId };
};

const EMPTY_SESSION = {
    isJourneyStarted: false,
    bookingId: null,
    tripId: null,
    busId: null,
    vehicleDetails: null,
    driverId: null,
    passengerDetails: null,
    caregiverId: null,
};

/** Passenger A, signed in, with their running journey synced and profile hydrated. */
async function passengerAWithRunningJourney() {
    signIn(SESSION_A);
    hydrateProfile('Passenger A', '0711111111');
    await expect(syncActiveJourney(SESSION_A)).resolves.toBe('active');
    expect(sessionFields()).toMatchObject({ bookingId: 'BK-A', tripId: 'TRIP-00004', busId: 'BUS-8899' });
}

beforeEach(() => {
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
    mockVerifyToken.mockImplementation(async (token: string) => {
        const passengerId = PASSENGERS[token];
        return passengerId
            ? { uid: `uid-${passengerId}`, passengerId, role: 'PASSENGER', email: `${passengerId}@moreable.lk` }
            : null;
    });
    mockGetAdminDb.mockReturnValue(seed({ tripBRunning: false }));
    installFetch();

    useAuthStore.setState({ token: null, isAuthenticated: false, user: null });
    resetActiveJourneySession();
    useJourneyStore.getState().clearSOS();
});

describe('1/2. logout', () => {
    it('clears the active journey immediately, with no further request', async () => {
        await passengerAWithRunningJourney();
        fetchMock.mockClear();

        await useAuthStore.getState().logout();

        expect(sessionFields()).toEqual(EMPTY_SESSION);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/journeys/ongoing'))).toHaveLength(0);
    });

    it("also clears the passenger's own profile and caregiver details", async () => {
        await passengerAWithRunningJourney();

        await useAuthStore.getState().logout();

        expect(useJourneyStore.getState().passengerDetails).toBeNull();
        expect(useJourneyStore.getState().caregiverId).toBeNull();
    });

    it('leaves an active SOS indicator as it was', async () => {
        await passengerAWithRunningJourney();
        useJourneyStore.getState().triggerLocalSOS('Passenger A');
        const sos = useJourneyStore.getState().activeSOS;

        await useAuthStore.getState().logout();

        expect(useJourneyStore.getState().activeSOS).toBe(sos);
    });

    it('leaves the rest of the logout behaviour as it was', async () => {
        await passengerAWithRunningJourney();

        await useAuthStore.getState().logout();

        const auth = useAuthStore.getState();
        expect(auth.token).toBeNull();
        expect(auth.user).toBeNull();
        expect(auth.isAuthenticated).toBe(false);
    });
});

describe('3. A → B, B has no ongoing journey', () => {
    it("B starts empty and stays empty; none of A's journey remains", async () => {
        await passengerAWithRunningJourney();
        await useAuthStore.getState().logout();

        signIn(SESSION_B);
        expect(sessionFields()).toEqual(EMPTY_SESSION);

        await expect(syncActiveJourney(SESSION_B)).resolves.toBe('none');
        expect(sessionFields()).toEqual(EMPTY_SESSION);
    });

    it('also holds when B replaces A without an explicit logout', async () => {
        await passengerAWithRunningJourney();

        signIn(SESSION_B);

        expect(sessionFields()).toEqual(EMPTY_SESSION);
    });
});

describe('4/7. A → B, B has a different ongoing journey', () => {
    it("B gets only B's journey, and A's never reappears on the way", async () => {
        mockGetAdminDb.mockReturnValue(seed({ tripBRunning: true }));
        await passengerAWithRunningJourney();

        const seen: (string | null)[] = [];
        const unsubscribe = useJourneyStore.subscribe((state) => seen.push(state.bookingId));

        await useAuthStore.getState().logout();
        signIn(SESSION_B);
        hydrateProfile('Passenger B', '0722222222');
        await expect(syncActiveJourney(SESSION_B)).resolves.toBe('active');
        unsubscribe();

        expect(seen).not.toContain('BK-A');
        expect(sessionFields()).toEqual({
            isJourneyStarted: true,
            bookingId: 'BK-B',
            tripId: 'TRIP-00005',
            busId: 'BUS-7777',
            vehicleDetails: { plateNumber: 'NB-7777', model: 'Viking' },
            driverId: 'BUS-7777',
            passengerDetails: { id: 'Passenger B', name: 'Passenger B', phone: '0700000000' },
            caregiverId: '0722222222',
        });
    });
});

describe("5/6. a request still in flight for the previous session", () => {
    it("cannot write A's journey after A logs out, with no screen left to start a newer request", async () => {
        signIn(SESSION_A);
        holdOngoing = true;
        const pending = syncActiveJourney(SESSION_A);

        await useAuthStore.getState().logout();
        await releaseHeld();

        await expect(pending).resolves.toBe('superseded');
        expect(sessionFields()).toEqual(EMPTY_SESSION);
    });

    it("cannot write A's journey after B has signed in, before B has synced", async () => {
        signIn(SESSION_A);
        holdOngoing = true;
        const pending = syncActiveJourney(SESSION_A);

        signIn(SESSION_B);
        await releaseHeld();

        await expect(pending).resolves.toBe('superseded');
        expect(sessionFields()).toEqual(EMPTY_SESSION);
    });

    it("lets B's own answer be the only one that lands, whichever finishes first", async () => {
        mockGetAdminDb.mockReturnValue(seed({ tripBRunning: true }));
        signIn(SESSION_A);
        holdOngoing = true;
        const pendingA = syncActiveJourney(SESSION_A);

        signIn(SESSION_B);
        holdOngoing = false;
        await expect(syncActiveJourney(SESSION_B)).resolves.toBe('active');

        // A's answer finally arrives, after B's.
        await releaseHeld();

        await expect(pendingA).resolves.toBe('superseded');
        expect(sessionFields()).toMatchObject({ bookingId: 'BK-B', tripId: 'TRIP-00005', busId: 'BUS-7777' });
    });

    it("a token replaced for the same passenger also invalidates the earlier request", async () => {
        signIn(SESSION_A);
        holdOngoing = true;
        const pending = syncActiveJourney(SESSION_A);

        useAuthStore.setState({ token: `${SESSION_A}-renewed` });
        await releaseHeld();

        await expect(pending).resolves.toBe('superseded');
        expect(sessionFields()).toEqual(EMPTY_SESSION);
    });
});

describe('8. one subscription, resetting only on a session change', () => {
    it('resets exactly once per token change, and never on unrelated auth updates', async () => {
        const reset = jest.spyOn(useJourneyStore.getState(), 'clearPassengerSession');

        signIn(SESSION_A);
        expect(reset).toHaveBeenCalledTimes(1);

        // Not a session change: the same token again, loading flags, profile edits.
        useAuthStore.setState({ token: SESSION_A });
        useAuthStore.setState({ isLoading: true });
        useAuthStore.setState({ isLoading: false });
        useAuthStore.getState().updateUser({ userName: 'Renamed' });
        expect(reset).toHaveBeenCalledTimes(1);

        signIn(SESSION_B);
        expect(reset).toHaveBeenCalledTimes(2);

        await useAuthStore.getState().logout();
        expect(reset).toHaveBeenCalledTimes(3);

        // Signed out stays signed out: no further reset.
        useAuthStore.setState({ isAuthenticated: false });
        expect(reset).toHaveBeenCalledTimes(3);

        reset.mockRestore();
    });

    it("an unrelated auth update does not clear a running journey", async () => {
        await passengerAWithRunningJourney();

        useAuthStore.getState().updateUser({ userName: 'Renamed' });
        useAuthStore.setState({ isLoading: true });

        expect(sessionFields()).toMatchObject({ isJourneyStarted: true, bookingId: 'BK-A' });
    });
});
