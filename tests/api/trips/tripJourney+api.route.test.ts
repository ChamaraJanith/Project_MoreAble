// The persisted journey lifecycle, end to end (MOV-294).
//
// Drives the real endpoints over an in-memory Firestore:
//
//   bus device  -> POST /api/trips/:tripId/journey   (Start / End Journey)
//   bus device  -> GET  /api/trips?busId=             (what it sees on sign-in)
//   passenger   -> GET  /api/booking/history?include= (Activities)
//
// The point it pins: the journey is a property of the TRIP, persisted with the
// actual start time. Nothing a device does to its own session ends it — only
// End Journey, or its scheduled service's arrival + 30 minutes passing (an
// early start never moves that). And its location
// sharing follows the journey, not the sign-in: after the dashboard logs out
// the bus keeps reporting with the journey's own credential, and passengers
// keep receiving it.
//
// Letters refer to the lifecycle test plan (A–J).

import { GET as getHistory } from '../../../app/api/booking/history+api';
import { PUT as locationRoute } from '../../../app/api/buses/[busId]/location+api';
import { POST as journeyRoute } from '../../../app/api/trips/[tripId]/journey+api';
import { GET as getTrips } from '../../../app/api/trips/index+api';
import { groupActivities } from '../../../src/features/activities/utils/activityStatus';
import { buildAssignedTrips } from '../../../src/features/driver/utils/assignedTrips';
import { createJourneySharing } from '../../../src/features/driver/services/journeySharing';
import { findActiveJourney } from '../../../src/features/driver/utils/journeyControl';
import { TrackingScheduler } from '../../../src/features/driver/utils/locationTracker';
import { clearBusSession, saveBusSession } from '../../../src/shared/utils/busSession';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only token signing and checking are stubbed (`jose` is ESM-only under this
// project's Jest); header parsing, the 401 helper and every rule run for real.
// A journey-sharing token is modelled with exactly the claims the real one
// carries: this bus, this trip, and the narrow scope.
jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    generateJourneySharingToken: async (busId: string, tripId: string) => `sharing:${busId}:${tripId}`,
    verifyToken: (token: string) => mockVerifyToken(token),
}));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

const mockDeviceStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
    setItemAsync: async (key: string, value: string) => {
        mockDeviceStore.set(key, value);
    },
    getItemAsync: async (key: string) => mockDeviceStore.get(key) ?? null,
    deleteItemAsync: async (key: string) => {
        mockDeviceStore.delete(key);
    },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/** The token check: login sessions from TOKENS, sharing tokens by their claims. */
async function verify(token: string) {
    const sharing = /^sharing:([^:]+):(.+)$/.exec(token);
    if (sharing) return { role: 'BUS', busId: sharing[1], tripId: sharing[2], scope: 'JOURNEY_LOCATION' };
    return TOKENS[token] ?? null;
}

// ------------------------------------------------------------------
// Fixtures: route 177 is run by BUS-A (two turns) and BUS-B (one).
//
//   TRIP-A   BUS-A  06:00   booked by PASSENGER_A
//   TRIP-A2  BUS-A  08:30   booked by PASSENGER_C  (same bus, other turn)
//   TRIP-B   BUS-B  06:00   booked by PASSENGER_B  (same route, other bus)
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';
const PASSENGER_C = 'PAS-2026-00003';
const PASSENGER_NONE = 'PAS-2026-00004';

const TOKENS: Record<string, Record<string, unknown>> = {
    'bus-a-session': { role: 'BUS', busId: 'BUS-A' },
    'bus-b-session': { role: 'BUS', busId: 'BUS-B' },
    'passenger-session': { role: 'PASSENGER', passengerId: PASSENGER_A },
};

/** A Sri Lanka local time (UTC+05:30), whatever the machine's timezone. */
const lk = (localIso: string) => new Date(`${localIso}+05:30`);

/** 21 Sep 2026, 20:35 — after that day's 06:00 service, so it is the next day's. */
const START_8_35_PM = lk('2026-09-21T20:35:00');
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** The 06:00 -> 07:10 service TRIP-A's 20:35 start belongs to, and its end. */
const SERVICE_DEPARTURE = lk('2026-09-22T06:00:00');
const SERVICE_ARRIVAL = lk('2026-09-22T07:10:00');
const SERVICE_END = lk('2026-09-22T07:40:00');

function trip(tripId: string, busId: string, departureTime: string, turnNumber: number) {
    return {
        tripId,
        routeId: 'ROUTE-177',
        busId,
        departureTime,
        estimatedArrivalTime: '07:10',
        turnNumber,
        status: 'ACTIVE',
    };
}

function booking(bookingId: string, userId: string, tripId: string, busId: string) {
    return {
        bookingId,
        userId,
        passengerName: userId,
        tripId,
        routeId: 'ROUTE-177',
        busId,
        seatNumber: '05A',
        status: 'CONFIRMED',
        boardingStatus: 'NOT_BOARDED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Rajagiriya',
            departureTime: '06:00',
            estimatedArrivalTime: '07:10',
        },
        vehicle: { numberPlate: `NB-${busId}`, busModel: 'Model', manufacturer: 'Maker' },
        createdAt: '2026-09-21T00:00:00.000Z',
    };
}

let db: ReturnType<typeof createFakeFirestore>;

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(START_8_35_PM);

    db = createFakeFirestore({
        trips: [
            trip('TRIP-A', 'BUS-A', '06:00', 1),
            trip('TRIP-A2', 'BUS-A', '08:30', 2),
            trip('TRIP-B', 'BUS-B', '06:00', 1),
        ],
        bookings: [
            booking('BK-A', PASSENGER_A, 'TRIP-A', 'BUS-A'),
            booking('BK-B', PASSENGER_B, 'TRIP-B', 'BUS-B'),
            booking('BK-C', PASSENGER_C, 'TRIP-A2', 'BUS-A'),
        ],
        // The location route only accepts positions for buses that exist.
        buses: [{ busId: 'BUS-A' }, { busId: 'BUS-B' }],
        vehicleLocations: [],
        users: [],
    });

    mockGetAdminDb.mockReset().mockReturnValue(db);
    mockVerifyToken.mockReset().mockImplementation(verify);
    mockDeviceStore.clear();
});

afterEach(() => {
    jest.useRealTimers();
});

const at = (msFromStart: number) => jest.setSystemTime(new Date(START_8_35_PM.getTime() + msFromStart));

async function journey(tripId: string, action: 'START' | 'END' | 'SHARE', token?: string) {
    const response = await journeyRoute(
        new Request(`http://localhost/api/trips/${tripId}/journey`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ action }),
        }),
        { tripId }
    );
    return { status: response.status, body: await response.json() };
}

/** What the passenger's Activities receives about their bus's location. */
async function liveSharingFor(passengerId: string, bookingId: string) {
    const response = await getHistory(
        new Request(`http://localhost/api/booking/history?passengerId=${passengerId}&include=liveSharing`)
    );
    const { bookings } = await response.json();
    return bookings.find((b: any) => b.bookingId === bookingId)?.liveSharing;
}

/** What Activities shows a passenger right now. */
async function ongoingFor(passengerId: string): Promise<string[]> {
    const response = await getHistory(
        new Request(`http://localhost/api/booking/history?passengerId=${passengerId}&include=liveSharing`)
    );
    const { bookings } = await response.json();
    return groupActivities(bookings, passengerId, new Date()).ongoing.map((b) => b.bookingId);
}

/** The trip document as stored. */
async function storedTrip(tripId: string): Promise<Record<string, any>> {
    return (await db.collection('trips').doc(tripId).get()).data() ?? {};
}

/** What a bus device finds when it signs in and opens Trip Control. */
async function deviceView(busId: string) {
    const response = await getTrips(new Request(`http://localhost/api/trips?busId=${busId}`));
    const { trips } = await response.json();
    return findActiveJourney(buildAssignedTrips(busId, trips, {}), new Date());
}

// ==================================================================
describe('Start Journey', () => {
    it('persists the exact trip with the actual start time', async () => {
        const { status, body } = await journey('TRIP-A', 'START', 'bus-a-session');

        expect(status).toBe(200);
        expect(body.journey).toEqual({
            status: 'STARTED',
            startedAt: START_8_35_PM.toISOString(),
            endedAt: null,
            busId: 'BUS-A',
            scheduledDepartureAt: SERVICE_DEPARTURE.toISOString(),
            scheduledArrivalAt: SERVICE_ARRIVAL.toISOString(),
            expiresAt: SERVICE_END.toISOString(),
        });
        expect(body.expiresAt).toBe(SERVICE_END.toISOString());

        const stored = await storedTrip('TRIP-A');
        expect(stored.journey.startedAt).toBe(START_8_35_PM.toISOString());
    });

    it('D. shows a 06:00 trip started at 8:35 PM to its passenger immediately', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);
    });

    it('E, F, G. only the passenger who booked that exact trip sees it', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']); // E. exact booking
        expect(await ongoingFor(PASSENGER_B)).toEqual([]); // F. same route, other bus's trip
        expect(await ongoingFor(PASSENGER_C)).toEqual([]); // F. same bus, other turn
        expect(await ongoingFor(PASSENGER_NONE)).toEqual([]); // G. no booking
    });

    it('I. a trip that was never started is not ongoing', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        expect(await ongoingFor(PASSENGER_B)).toEqual([]);
        expect((await storedTrip('TRIP-B')).journey).toBeUndefined();
    });

    it('does not reset the start time when pressed again', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');
        at(2 * HOUR);

        const again = await journey('TRIP-A', 'START', 'bus-a-session');

        expect(again.status).toBe(200);
        expect(again.body.journey.startedAt).toBe(START_8_35_PM.toISOString());
    });

    it("refuses a second trip while the bus's first is running", async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        const second = await journey('TRIP-A2', 'START', 'bus-a-session');

        expect(second.status).toBe(409);
        expect(second.body.code).toBe('ANOTHER_JOURNEY_ACTIVE');
        expect(await ongoingFor(PASSENGER_C)).toEqual([]);
    });

    it('lets another bus run its own trip at the same time', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        expect((await journey('TRIP-B', 'START', 'bus-b-session')).status).toBe(200);
        expect(await ongoingFor(PASSENGER_B)).toEqual(['BK-B']);
    });

    it('only the bus assigned to the trip may start it', async () => {
        expect((await journey('TRIP-A', 'START')).status).toBe(401);
        expect((await journey('TRIP-A', 'START', 'bus-b-session')).status).toBe(403);
        expect((await journey('TRIP-A', 'START', 'passenger-session')).status).toBe(403);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
    });

    it('refuses a trip taken out of service, and unknown trips and actions', async () => {
        await db.collection('trips').doc('TRIP-A').update({ status: 'INACTIVE' });

        expect((await journey('TRIP-A', 'START', 'bus-a-session')).body.code).toBe('TRIP_INACTIVE');
        expect((await journey('TRIP-NOPE', 'START', 'bus-a-session')).status).toBe(404);
        expect((await journey('TRIP-A', 'PAUSE' as any, 'bus-a-session')).status).toBe(400);
    });

    it('refuses a trip whose scheduled times cannot be read, since it would have no end', async () => {
        await db.collection('trips').doc('TRIP-A').update({ estimatedArrivalTime: '' });

        expect((await journey('TRIP-A', 'START', 'bus-a-session')).body.code).toBe('TRIP_SCHEDULE_INVALID');
        expect((await storedTrip('TRIP-A')).journey).toBeUndefined();
    });
});

// ==================================================================
describe('The device session does not end the journey', () => {
    it('A. Start Journey, then sign out: the journey is still running for passengers', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        // Signing out makes no server call at all — the device just forgets its
        // session (the client side of this is pinned in tripControl.test.ts).
        // Hours later, nothing has changed on the trip.
        at(6 * HOUR);

        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);
        expect((await storedTrip('TRIP-A')).journey.status).toBe('STARTED');
    });

    it('B. signing in again finds the journey already started, with its original start time', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');
        at(3 * HOUR);

        const running = await deviceView('BUS-A');

        expect(running?.trip.tripId).toBe('TRIP-A');
        expect(running?.startedAt).toBe(START_8_35_PM.toISOString());
        expect(await deviceView('BUS-B')).toBeNull();
    });
});

// ==================================================================
describe('Ending a journey', () => {
    it('C. End Journey: the passenger no longer sees it, without waiting for the scheduled end', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');
        at(HOUR);

        const { status, body } = await journey('TRIP-A', 'END', 'bus-a-session');

        expect(status).toBe(200);
        expect(body.journey).toMatchObject({ status: 'ENDED', endedAt: new Date(START_8_35_PM.getTime() + HOUR).toISOString() });
        expect(body.active).toBe(false);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
        expect(await deviceView('BUS-A')).toBeNull();
    });

    it('C. can be ended after signing back in, and then another trip can start', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');
        at(5 * HOUR); // signed out and back in meanwhile

        expect((await journey('TRIP-A', 'END', 'bus-a-session')).status).toBe(200);
        expect((await journey('TRIP-A2', 'START', 'bus-a-session')).status).toBe(200);
        expect(await ongoingFor(PASSENGER_C)).toEqual(['BK-C']);
    });

    it('H. 30 minutes after the scheduled arrival it stops being ongoing if nobody ended it', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        jest.setSystemTime(new Date(SERVICE_END.getTime() - MINUTE));
        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);

        jest.setSystemTime(SERVICE_END);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
        expect(await deviceView('BUS-A')).toBeNull();

        // And the bus is free to start a trip again.
        expect((await journey('TRIP-A2', 'START', 'bus-a-session')).status).toBe(200);
    });

    it('H. an early start (02:52 for the 06:00) is still the 06:00 service, and ends at 07:40', async () => {
        const earlyStart = lk('2026-09-22T02:52:00');
        jest.setSystemTime(earlyStart);

        const { body } = await journey('TRIP-A', 'START', 'bus-a-session');

        // The actual start is recorded as it happened, but does not move the end.
        expect(body.journey.startedAt).toBe(earlyStart.toISOString());
        expect(body.journey.scheduledDepartureAt).toBe(SERVICE_DEPARTURE.toISOString());
        expect(body.expiresAt).toBe(SERVICE_END.toISOString());

        jest.setSystemTime(new Date(SERVICE_END.getTime() - MINUTE));
        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);

        jest.setSystemTime(SERVICE_END);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
        expect(await deviceView('BUS-A')).toBeNull();
    });
});

// ==================================================================
// The finalised rule: a scheduled service is started at most once.
//
// TRIP-A is 06:00 -> 07:10, so each day's service expires at 07:40. Times are
// Sri Lanka time on 22 Sep ("today") and 23 Sep ("tomorrow").
// ==================================================================
describe('Scheduled service occurrences', () => {
    const TOMORROW_DEPARTURE = lk('2026-09-23T06:00:00');
    const TOMORROW_END = lk('2026-09-23T07:40:00');

    async function startAt(localIso: string) {
        jest.setSystemTime(lk(localIso));
        return journey('TRIP-A', 'START', 'bus-a-session');
    }

    it("A, B. a 02:52 start is today's 06:00 service and expires at 07:40", async () => {
        const { status, body } = await startAt('2026-09-22T02:52:00');

        expect(status).toBe(200);
        expect(body.journey.scheduledDepartureAt).toBe(SERVICE_DEPARTURE.toISOString());
        expect(body.journey.scheduledArrivalAt).toBe(SERVICE_ARRIVAL.toISOString());
        expect(body.journey.expiresAt).toBe(SERVICE_END.toISOString());
    });

    it.each([
        ['C', '2026-09-22T06:01:00'],
        ['D', '2026-09-22T06:30:00'],
    ])('%s. a start at %s still expires at 07:40', async (_letter, localIso) => {
        const { body } = await startAt(localIso);

        expect(body.journey.startedAt).toBe(lk(localIso).toISOString());
        expect(body.journey.scheduledDepartureAt).toBe(SERVICE_DEPARTURE.toISOString());
        expect(body.expiresAt).toBe(SERVICE_END.toISOString());
    });

    it('E. a manual End before 07:40 ends it at that exact server time', async () => {
        await startAt('2026-09-22T06:01:00');
        jest.setSystemTime(lk('2026-09-22T07:05:00'));

        const { body } = await journey('TRIP-A', 'END', 'bus-a-session');

        expect(body.journey).toMatchObject({ status: 'ENDED', endedAt: lk('2026-09-22T07:05:00').toISOString() });
        expect(body.active).toBe(false);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
    });

    it("F, G, H. at 08:00, after today's service expired, Start goes to tomorrow's 06:00 as a new run", async () => {
        const first = (await startAt('2026-09-22T02:52:00')).body.journey;

        const { status, body } = await startAt('2026-09-22T08:00:00');

        expect(status).toBe(200);
        // F. today's finished 06:00 service is not reopened.
        expect(body.journey.scheduledDepartureAt).not.toBe(SERVICE_DEPARTURE.toISOString());
        // G. it is the next occurrence, with that occurrence's own expiry.
        expect(body.journey.scheduledDepartureAt).toBe(TOMORROW_DEPARTURE.toISOString());
        expect(body.expiresAt).toBe(TOMORROW_END.toISOString());
        // H. a different run: tripId + startedAt no longer names the first.
        expect(body.journey.startedAt).toBe(lk('2026-09-22T08:00:00').toISOString());
        expect(body.journey.startedAt).not.toBe(first.startedAt);
    });

    it("F. a service ended by hand is not started again, even before its 07:40 expiry", async () => {
        await startAt('2026-09-22T06:01:00');
        jest.setSystemTime(lk('2026-09-22T07:05:00'));
        await journey('TRIP-A', 'END', 'bus-a-session');

        const { body } = await startAt('2026-09-22T07:10:00');

        expect(body.journey.status).toBe('STARTED');
        expect(body.journey.scheduledDepartureAt).toBe(TOMORROW_DEPARTURE.toISOString());
        expect(body.expiresAt).toBe(TOMORROW_END.toISOString());
    });

    it('G. an upcoming occurrence can still be started early after the last one ended', async () => {
        await startAt('2026-09-22T06:01:00');
        jest.setSystemTime(lk('2026-09-22T07:05:00'));
        await journey('TRIP-A', 'END', 'bus-a-session');

        // Tomorrow 02:52: today's run is done, tomorrow's is upcoming.
        const { body } = await startAt('2026-09-23T02:52:00');

        expect(body.journey.scheduledDepartureAt).toBe(TOMORROW_DEPARTURE.toISOString());
        expect(body.expiresAt).toBe(TOMORROW_END.toISOString());
    });

    it('H. an early start of tomorrow, ended, moves the next start to the day after', async () => {
        await startAt('2026-09-22T20:35:00'); // tomorrow's 06:00, started early
        jest.setSystemTime(lk('2026-09-22T21:00:00'));
        await journey('TRIP-A', 'END', 'bus-a-session');

        const { body } = await startAt('2026-09-22T21:30:00');

        expect(body.journey.scheduledDepartureAt).toBe(lk('2026-09-24T06:00:00').toISOString());
        expect(body.expiresAt).toBe(lk('2026-09-24T07:40:00').toISOString());
    });

    it("I. an overnight 23:30 -> 00:45 trip expires at 01:15 the next day", async () => {
        await db.collection('trips').doc('TRIP-A').update({ departureTime: '23:30', estimatedArrivalTime: '00:45' });

        const { body } = await startAt('2026-09-22T22:00:00');

        expect(body.journey.scheduledDepartureAt).toBe(lk('2026-09-22T23:30:00').toISOString());
        expect(body.journey.scheduledArrivalAt).toBe(lk('2026-09-23T00:45:00').toISOString());
        expect(body.expiresAt).toBe(lk('2026-09-23T01:15:00').toISOString());

        jest.setSystemTime(lk('2026-09-23T01:14:00'));
        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);
        jest.setSystemTime(lk('2026-09-23T01:15:00'));
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);

        // And after it, the next night's service — not this one again.
        const next = await startAt('2026-09-23T01:20:00');
        expect(next.body.journey.scheduledDepartureAt).toBe(lk('2026-09-23T23:30:00').toISOString());
    });

    it('only the assigned bus may end it', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        expect((await journey('TRIP-A', 'END', 'bus-b-session')).status).toBe(403);
        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);
    });

    it('reports a trip that was never started', async () => {
        const { status, body } = await journey('TRIP-A', 'END', 'bus-a-session');

        expect(status).toBe(409);
        expect(body.code).toBe('JOURNEY_NOT_STARTED');
    });

    it('is safe to press twice', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');
        await journey('TRIP-A', 'END', 'bus-a-session');

        const again = await journey('TRIP-A', 'END', 'bus-a-session');

        expect(again.status).toBe(200);
        expect(again.body.journey.status).toBe('ENDED');
    });
});

// ==================================================================
describe('J. Callers that do not ask are unchanged', () => {
    it('the Booking tab history carries no journey data', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        const response = await getHistory(new Request(`http://localhost/api/booking/history?passengerId=${PASSENGER_A}`));
        const { bookings } = await response.json();

        expect(bookings.every((b: any) => !('activeJourney' in b) && !('liveSharing' in b))).toBe(true);
    });
});

// ==================================================================
describe('The journey location-sharing credential', () => {
    it('is issued with Start Journey, for exactly this bus and trip', async () => {
        const { body } = await journey('TRIP-A', 'START', 'bus-a-session');

        expect(body.sharingToken).toBe('sharing:BUS-A:TRIP-A');
    });

    it('I. SHARE hands a signed-in device the running journey without creating or restarting it', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');
        at(4 * HOUR);

        const { status, body } = await journey('TRIP-A', 'SHARE', 'bus-a-session');

        expect(status).toBe(200);
        expect(body.sharingToken).toBe('sharing:BUS-A:TRIP-A');
        expect(body.journey.startedAt).toBe(START_8_35_PM.toISOString());
        expect((await storedTrip('TRIP-A')).journey.startedAt).toBe(START_8_35_PM.toISOString());
    });

    it('SHARE is refused when the journey is not running, and never starts one', async () => {
        const { status, body } = await journey('TRIP-A', 'SHARE', 'bus-a-session');

        expect(status).toBe(409);
        expect(body.code).toBe('JOURNEY_NOT_STARTED');
        expect((await storedTrip('TRIP-A')).journey).toBeUndefined();
    });

    it('cannot start, end or share a journey — it only reports location', async () => {
        const { body } = await journey('TRIP-A', 'START', 'bus-a-session');
        const sharingToken = body.sharingToken;

        expect((await journey('TRIP-A', 'END', sharingToken)).status).toBe(403);
        expect((await journey('TRIP-A2', 'START', sharingToken)).status).toBe(403);
        expect((await journey('TRIP-A', 'SHARE', sharingToken)).status).toBe(403);
        expect((await storedTrip('TRIP-A')).journey.status).toBe('STARTED');
    });

    it('is not issued once the journey has ended', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        const { body } = await journey('TRIP-A', 'END', 'bus-a-session');

        expect(body.sharingToken).toBeUndefined();
    });
});

// ==================================================================
describe('E. Passengers keep receiving the location while the dashboard is logged out', () => {
    it('Start Journey, log out, and the bus position still reaches the passenger', async () => {
        // The real publisher talks to the real location route.
        global.fetch = jest.fn(async (url: string, init: any) =>
            locationRoute(new Request(`http://localhost${url}`, init), {
                params: { busId: String(url).split('/')[3] },
            })
        ) as unknown as typeof fetch;

        const timers: (() => void)[] = [];
        const scheduler: TrackingScheduler = {
            setTimer: (run) => {
                timers.push(run);
                return run as any;
            },
            clearTimer: () => {},
        };
        const flush = () => new Promise((resolve) => setImmediate(resolve));
        let fix = { latitude: 6.9147, longitude: 79.9728, recordedAt: new Date().toISOString() };

        // The bus signs in and presses Start Journey.
        await saveBusSession({ busId: 'BUS-A', numberPlate: 'NB-8899', token: 'bus-a-session' });
        const { body } = await journey('TRIP-A', 'START', 'bus-a-session');
        const sharing = createJourneySharing({
            readLocation: async () => fix,
            scheduler,
        });
        await sharing.start({ tripId: 'TRIP-A', busId: 'BUS-A', token: body.sharingToken, expiresAt: body.expiresAt });
        await flush();

        expect(await liveSharingFor(PASSENGER_A, 'BK-A')).toMatchObject({ available: true, recordedAt: fix.recordedAt });

        // Device Dashboard logout: the sign-in is gone.
        await clearBusSession();

        // The next interval: the bus has moved, and reports it anyway.
        at(30 * 1000);
        fix = { latitude: 6.9102, longitude: 79.9411, recordedAt: new Date().toISOString() };
        timers.splice(0).forEach((run) => run());
        await flush();

        expect(sharing.isSharing('TRIP-A')).toBe(true);
        expect(await liveSharingFor(PASSENGER_A, 'BK-A')).toMatchObject({ available: true, recordedAt: fix.recordedAt });
        expect((await db.collection('vehicleLocations').doc('BUS-A').get()).data()).toMatchObject({
            latitude: 6.9102,
            longitude: 79.9411,
        });
        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);

        // Only End Journey stops it — which needs a sign-in again.
        await saveBusSession({ busId: 'BUS-A', numberPlate: 'NB-8899', token: 'bus-a-session' });
        await journey('TRIP-A', 'END', 'bus-a-session');
        await sharing.stop();

        expect(sharing.getSnapshot().isTracking).toBe(false);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
    });
});
