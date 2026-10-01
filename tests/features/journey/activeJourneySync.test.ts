// Home → Active Journey follows the passenger's actual running journey.
//
// GET /api/journeys/ongoing — the source Activities → Ongoing already uses — is
// the only thing that may mark a journey active. Every answer REPLACES what
// the Active Journey screen holds: a journey sets it, and an empty answer, an
// error or a missing token clears it, so an earlier or fabricated booking is
// never presented as running.
//
// Everything below the store is real: the real route answers from a seeded
// database, the real API client parses it, and syncActiveJourney writes the
// real store. Only `fetch` is pointed at the route instead of the network, and
// the token check is stubbed, as in the route's own tests.
//
// The project has no React renderer, so — like ongoingJourneyCard — the
// screen's wiring is pinned by reading app/active-journey.tsx.

import { readFileSync } from 'fs';
import { join } from 'path';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { selectActiveJourneyView, syncActiveJourney } from '../../../src/features/journey/services/activeJourneySync';
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

// activeJourneySync subscribes to the auth store; its token storage reaches
// into expo-secure-store, which this node-only Jest setup does not transform
// (the same stand-in as favouriteRoutesLogout.test.ts).
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

const ROOT = join(__dirname, '..', '..', '..');
const screenSource = readFileSync(join(ROOT, 'app/active-journey.tsx'), 'utf-8');

// ------------------------------------------------------------------
// Fixtures — the ongoing route's own story.
//
//   TRIP-00004  route 177, NB-8899 (BUS-8899)   STARTED 30 min ago
//   TRIP-00005  route 177, NB-7777 (BUS-7777)   not started
//
//   Passenger A booked TRIP-00004. Passenger B booked TRIP-00005.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';

// Opaque session handles: the stubbed verifyToken maps each to its passenger.
const SESSION_A = 'session-passenger-a';
const SESSION_B = 'session-passenger-b';

const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const STARTED_AT = minutesAgo(30);

function booking(bookingId: string, userId: string, tripId: string, busId: string, extra: Record<string, unknown> = {}) {
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
        ...extra,
    };
}

const startedJourney = (busId: string, startedAt: string = STARTED_AT) => ({
    status: 'STARTED',
    startedAt,
    endedAt: null,
    busId,
    scheduledDepartureAt: minutesAgo(25),
    scheduledArrivalAt: minutesAgo(-90),
    expiresAt: minutesAgo(-120),
});

function trip(tripId: string, busId: string, extra: Record<string, unknown> = {}) {
    return { tripId, routeId: '177_KADUWELA_KOLLUPITIYA', busId, departureTime: '06:00', status: 'ACTIVE', ...extra };
}

const RUNNING_TRIP_4 = trip('TRIP-00004', 'BUS-8899', { journey: startedJourney('BUS-8899') });
const IDLE_TRIP_5 = trip('TRIP-00005', 'BUS-7777', { departureTime: '06:30' });

function seed(overrides: Record<string, any[]> = {}) {
    return createFakeFirestore({
        trips: [RUNNING_TRIP_4, IDLE_TRIP_5],
        bookings: [
            booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899'),
            booking('BK-B', PASSENGER_B, 'TRIP-00005', 'BUS-7777'),
        ],
        vehicleLocations: [
            { id: 'BUS-8899', busId: 'BUS-8899', latitude: 6.9271, longitude: 79.8612, recordedAt: minutesAgo(1), tripId: 'TRIP-00004', journeyStartedAt: STARTED_AT },
        ],
        buses: [{ busId: 'BUS-8899' }, { busId: 'BUS-7777' }],
        ...overrides,
    });
}

const SESSIONS: Record<string, { passengerId: string }> = {
    [SESSION_A]: { passengerId: PASSENGER_A },
    [SESSION_B]: { passengerId: PASSENGER_B },
};

let fetchMock: jest.Mock;

beforeEach(() => {
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
    mockVerifyToken.mockImplementation(async (token: string) => {
        const known = SESSIONS[token];
        return known
            ? { uid: `uid-${known.passengerId}`, passengerId: known.passengerId, role: 'PASSENGER', email: `${known.passengerId}@moreable.lk` }
            : null;
    });

    // The client's request goes to the real route handler.
    fetchMock = jest.fn((url: string, init?: RequestInit) => getOngoing(new Request(url, init)));
    (global as any).fetch = fetchMock;

    useJourneyStore.setState(useJourneyStore.getInitialState(), true);
});

const journeyFields = () => {
    const { isJourneyStarted, bookingId, tripId, busId, vehicleDetails, driverId } = useJourneyStore.getState();
    return { isJourneyStarted, bookingId, tripId, busId, vehicleDetails, driverId };
};

const NO_JOURNEY = {
    isJourneyStarted: false,
    bookingId: null,
    tripId: null,
    busId: null,
    vehicleDetails: null,
    driverId: null,
};

const viewNow = () => selectActiveJourneyView(useJourneyStore.getState(), false);

/** Passenger A, synced while TRIP-00004 is running. */
async function startWithRunningJourney() {
    mockGetAdminDb.mockReturnValue(seed());
    await expect(syncActiveJourney(SESSION_A)).resolves.toBe('active');
    expect(journeyFields().isJourneyStarted).toBe(true);
}

describe('1. initial store', () => {
    it('holds no active journey — no placeholder booking, vehicle, driver or trip', () => {
        const initial = useJourneyStore.getInitialState();

        expect(initial).toMatchObject(NO_JOURNEY);
        expect(initial.caregiverId).toBeNull();
        expect(initial.passengerDetails).toBeNull();
    });

    it('so the screen has nothing to show as running', () => {
        expect(selectActiveJourneyView(useJourneyStore.getInitialState(), false)).toEqual({ isLive: false, vehicleCard: null });
    });
});

describe('2/9. a real ongoing journey', () => {
    it('becomes the active journey, with its own booking, trip, bus and vehicle', async () => {
        await startWithRunningJourney();

        expect(journeyFields()).toEqual({
            isJourneyStarted: true,
            bookingId: 'BK-A',
            tripId: 'TRIP-00004',
            busId: 'BUS-8899',
            vehicleDetails: { plateNumber: 'NB-8899', model: 'Viking' },
            driverId: 'BUS-8899',
        });
    });

    it('is the same booking Activities → Ongoing receives from the same endpoint', async () => {
        mockGetAdminDb.mockReturnValue(seed());
        const response = await getOngoing(
            new Request('http://api.test/api/journeys/ongoing', { headers: { Authorization: `Bearer ${SESSION_A}` } })
        );
        const body = await response.json();

        await syncActiveJourney(SESSION_A);

        expect(body.journeys).toHaveLength(1);
        expect(useJourneyStore.getState().bookingId).toBe(body.journeys[0].booking.bookingId);
        expect(useJourneyStore.getState().tripId).toBe(body.journeys[0].activeJourney.tripId);
    });

    it('shows LIVE and the assigned vehicle/booking card for that journey', async () => {
        await startWithRunningJourney();

        expect(viewNow()).toEqual({
            isLive: true,
            vehicleCard: { plateNumber: 'NB-8899', model: 'Viking', bookingId: 'BK-A' },
        });
    });

    it('is asked for with the session token only, never a passenger or trip id', async () => {
        await startWithRunningJourney();

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://api.test/api/journeys/ongoing');
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_A}`);
    });
});

describe('3. the ongoing answer becomes empty', () => {
    it('clears the journey when the bus ends it', async () => {
        await startWithRunningJourney();

        mockGetAdminDb.mockReturnValue(
            seed({
                trips: [
                    trip('TRIP-00004', 'BUS-8899', { journey: { ...startedJourney('BUS-8899'), status: 'ENDED', endedAt: minutesAgo(5) } }),
                    IDLE_TRIP_5,
                ],
            })
        );

        await expect(syncActiveJourney(SESSION_A)).resolves.toBe('none');
        expect(journeyFields()).toEqual(NO_JOURNEY);
        expect(viewNow()).toEqual({ isLive: false, vehicleCard: null });
    });

    it('replaces the old run with the later one, never keeping the earlier booking', async () => {
        await startWithRunningJourney();

        // A's first journey is done; their later booking's trip has now started.
        mockGetAdminDb.mockReturnValue(
            seed({
                trips: [
                    trip('TRIP-00004', 'BUS-8899', { journey: { ...startedJourney('BUS-8899'), status: 'ENDED', endedAt: minutesAgo(5) } }),
                    trip('TRIP-00005', 'BUS-7777', { journey: startedJourney('BUS-7777', minutesAgo(2)) }),
                ],
                bookings: [
                    booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899'),
                    booking('BK-A2', PASSENGER_A, 'TRIP-00005', 'BUS-7777'),
                ],
            })
        );

        await expect(syncActiveJourney(SESSION_A)).resolves.toBe('active');
        expect(journeyFields()).toMatchObject({
            bookingId: 'BK-A2',
            tripId: 'TRIP-00005',
            busId: 'BUS-7777',
            vehicleDetails: { plateNumber: 'NB-7777', model: 'Viking' },
        });
    });

    it('lets only the newest request decide: a slow earlier "running" answer cannot revive a cleared journey', async () => {
        mockGetAdminDb.mockReturnValue(seed());
        let releaseSlow!: () => void;
        const slowGate = new Promise<void>((resolve) => (releaseSlow = resolve));

        fetchMock
            .mockImplementationOnce(async (url: string, init?: RequestInit) => {
                await slowGate;
                return getOngoing(new Request(url, init));
            })
            .mockImplementationOnce(async () => Response.json({ success: true, ongoing: false, journeys: [] }));

        const slow = syncActiveJourney(SESSION_A);
        await expect(syncActiveJourney(SESSION_A)).resolves.toBe('none');
        releaseSlow();

        await expect(slow).resolves.toBe('superseded');
        expect(journeyFields()).toEqual(NO_JOURNEY);
    });
});

describe('4. the ongoing request fails after a journey was active', () => {
    it('a server error does not leave the earlier journey LIVE', async () => {
        await startWithRunningJourney();

        mockGetAdminDb.mockImplementation(() => {
            throw new Error('database unavailable');
        });
        // The route logs the failure it turns into a 500.
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(syncActiveJourney(SESSION_A)).resolves.toBe('error');
        logged.mockRestore();
        expect(journeyFields()).toEqual(NO_JOURNEY);
        expect(viewNow().isLive).toBe(false);
    });

    it('a network failure does not leave the earlier journey LIVE', async () => {
        await startWithRunningJourney();

        fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

        await expect(syncActiveJourney(SESSION_A)).resolves.toBe('error');
        expect(journeyFields()).toEqual(NO_JOURNEY);
    });

    it('a rejected session does not leave the earlier journey LIVE', async () => {
        await startWithRunningJourney();

        await expect(syncActiveJourney('session-no-longer-valid')).resolves.toBe('error');
        expect(journeyFields()).toEqual(NO_JOURNEY);
    });
});

describe('5. no token after a journey was active', () => {
    it.each([null, undefined, ''])('clears the journey without asking the server (%p)', async (token) => {
        await startWithRunningJourney();
        fetchMock.mockClear();

        await expect(syncActiveJourney(token as any)).resolves.toBe('signed-out');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(journeyFields()).toEqual(NO_JOURNEY);
    });
});

describe('6. a future booking with no running journey', () => {
    it('does not populate Active Journey', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        // Passenger B holds a CONFIRMED booking on TRIP-00005, which has not started.
        await expect(syncActiveJourney(SESSION_B)).resolves.toBe('none');
        expect(journeyFields()).toEqual(NO_JOURNEY);
        expect(viewNow()).toEqual({ isLive: false, vehicleCard: null });
    });
});

describe('7. a bus or vehicle cannot make a passenger journey active', () => {
    it("a moving bus on the passenger's route, reporting for another trip, is not their journey", async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                vehicleLocations: [
                    { id: 'BUS-7777', busId: 'BUS-7777', latitude: 6.93, longitude: 79.86, recordedAt: minutesAgo(1), tripId: 'TRIP-00004', journeyStartedAt: STARTED_AT },
                ],
            })
        );

        await expect(syncActiveJourney(SESSION_B)).resolves.toBe('none');
        expect(journeyFields()).toEqual(NO_JOURNEY);
    });

    it('the screen does not read the bus session on this device', () => {
        expect(screenSource).not.toMatch(/busSession|getBusSession|BusSession/);
    });

    it("the vehicle shown is the ongoing journey's, never another plate", () => {
        expect(screenSource).not.toMatch(/numberPlate/);
        expect(screenSource).toContain('{vehicleCard.plateNumber}');
    });
});

describe('8. the Assigned Vehicle / Booking card', () => {
    /** The JSX from the card's comment to the end of its conditional block. */
    function vehicleCardBlock(): string {
        const start = screenSource.indexOf('Vehicle & Booking Details Card');
        expect(start).toBeGreaterThan(-1);
        return screenSource.slice(start, screenSource.indexOf('{/* 3.', start));
    }

    it('renders only behind the ongoing-journey view', () => {
        const block = vehicleCardBlock();
        expect(block).toMatch(/\{vehicleCard && \(/);
        expect(block).toContain('ASSIGNED VEHICLE');
        expect(block).not.toMatch(/vehicleDetails|bookingId \?/);
    });

    it('the view has no card while nothing is running, nor while a sync is in flight', async () => {
        expect(viewNow().vehicleCard).toBeNull();

        await startWithRunningJourney();
        expect(selectActiveJourneyView(useJourneyStore.getState(), true)).toEqual({ isLive: false, vehicleCard: null });
    });

    it('the LIVE badge and started state read the same view', () => {
        expect(screenSource).toContain("{isLive ? 'LIVE' : 'IDLE'}");
        expect(screenSource).toMatch(/\) : isLive \? \(/);
        expect(screenSource).not.toMatch(/isJourneyStarted \?/);
    });

    it('every visit re-syncs from the ongoing endpoint, replacing what is held', () => {
        expect(screenSource).toContain('syncActiveJourney(token)');
        expect(screenSource).not.toContain('getOngoingJourneys');
        expect(screenSource).not.toMatch(/useJourneyStore\.setState\(\{[^}]*isJourneyStarted/);
    });
});
