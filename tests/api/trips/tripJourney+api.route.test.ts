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
// End Journey, or 23 hours passing from the actual start.
//
// Letters refer to the lifecycle test plan (A–J).

import { GET as getHistory } from '../../../app/api/booking/history+api';
import { POST as journeyRoute } from '../../../app/api/trips/[tripId]/journey+api';
import { GET as getTrips } from '../../../app/api/trips/index+api';
import { groupActivities } from '../../../src/features/activities/utils/activityStatus';
import { buildAssignedTrips } from '../../../src/features/driver/utils/assignedTrips';
import { findActiveJourney } from '../../../src/features/driver/utils/journeyControl';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the token check is stubbed; header parsing and the 401 helper run for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

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

/** 21 Sep 2026, 20:35 local — long after the 06:00 scheduled departure. */
const START_8_35_PM = new Date(2026, 8, 21, 20, 35, 0, 0);
const HOUR = 60 * 60 * 1000;

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
        vehicleLocations: [],
        users: [],
    });

    mockGetAdminDb.mockReset().mockReturnValue(db);
    mockVerifyToken.mockReset().mockImplementation(async (token: string) => TOKENS[token] ?? null);
});

afterEach(() => {
    jest.useRealTimers();
});

const at = (msFromStart: number) => jest.setSystemTime(new Date(START_8_35_PM.getTime() + msFromStart));

async function journey(tripId: string, action: 'START' | 'END', token?: string) {
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
        });
        expect(body.expiresAt).toBe(new Date(START_8_35_PM.getTime() + 23 * HOUR).toISOString());

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
    it('C. End Journey: the passenger no longer sees it, without waiting 23 hours', async () => {
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

    it('H. 23 hours after the actual start it stops being ongoing if nobody ended it', async () => {
        await journey('TRIP-A', 'START', 'bus-a-session');

        at(23 * HOUR - 60 * 1000);
        expect(await ongoingFor(PASSENGER_A)).toEqual(['BK-A']);

        at(23 * HOUR);
        expect(await ongoingFor(PASSENGER_A)).toEqual([]);
        expect(await deviceView('BUS-A')).toBeNull();

        // And the bus is free to start a trip again.
        expect((await journey('TRIP-A2', 'START', 'bus-a-session')).status).toBe(200);
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
