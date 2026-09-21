// The passenger journey lifecycle, end to end (MOV-298).
//
// One continuous story through the real endpoints over an in-memory Firestore,
// in the order a bus and its passengers actually use them:
//
//   bus device -> POST /api/trips/:tripId/journey  START   (MOV-294)
//   bus device -> PUT  /api/buses/:busId/location          (with the credential START returned)
//   passenger  -> GET  /api/journeys/ongoing[?include=route] (MOV-295 / MOV-296 / MOV-297)
//   passenger  -> POST /api/journeys/ongoing/end            (their own End Journey)
//   bus device -> POST /api/trips/:tripId/journey  END
//   passenger  -> GET  /api/journeys/completed
//   bus device -> START the same timetable trip again       (a new run)
//
// The per-rule suites (ongoingJourney*, passengerJourneyCompletion,
// tripJourney) pin each rule on its own. This one checks that they hold
// together across a whole day: several passengers finishing at different
// times and in different ways, the bus finishing the rest, and a second run
// of the same trip that must not bring anyone back.

import { PUT as reportLocation } from '../../../app/api/buses/[busId]/location+api';
import { GET as getCompleted } from '../../../app/api/journeys/completed+api';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { POST as endOwnJourney } from '../../../app/api/journeys/ongoing/end+api';
import { resolveJourneyDistanceKm } from '../../../app/api/journeys/search+api';
import { POST as tripJourney } from '../../../app/api/trips/[tripId]/journey+api';
import { clearOngoingRoadCache } from '../../../src/shared/server/ongoingJourneyRoute';
import { haversineDistanceKm } from '../../../src/shared/utils/geo';
import { normalizeLocation } from '../../../src/shared/utils/location';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The sharing credential START hands out is recognisable, so the device below
// reports its position with exactly the credential it was given.
jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    generateJourneySharingToken: async (busId: string, tripId: string) => `sharing:${busId}:${tripId}`,
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// No real routing service: a fixed road through the stops.
jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteThroughCoordinates: jest.fn(async () => ({
        distanceKm: 8.4,
        durationMinutes: 21,
        geometry: {
            type: 'LineString',
            coordinates: [
                [79.9696, 6.9061],
                [79.95, 6.907],
                [79.9281, 6.9076],
                [79.9181, 6.9022],
                [79.8943, 6.9094],
            ],
        },
    })),
    getRouteBetweenCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// BUS-A is assigned Trips A, B and C (TRIP-A/B/C) on route 177. Trip X of the
// story is TRIP-B — deliberately not the first — so picking the wrong one
// shows. Passengers A, B and C are booked on TRIP-B; D is booked on TRIP-A,
// same route and same bus; E has no booking yet.
// ------------------------------------------------------------------
const PASSENGERS = {
    A: 'PAS-2026-00001',
    B: 'PAS-2026-00002',
    C: 'PAS-2026-00003',
    D: 'PAS-2026-00004',
    E: 'PAS-2026-00005',
};
const ROUTE = '177_KADUWELA_KOLLUPITIYA';
const TRIP_X = 'TRIP-B';

const passengerToken = (id: string) => ({ uid: `uid-${id}`, passengerId: id, role: 'PASSENGER', email: `${id}@moreable.lk` });

const TOKENS: Record<string, unknown> = {
    'token-a': passengerToken(PASSENGERS.A),
    'token-b': passengerToken(PASSENGERS.B),
    'token-c': passengerToken(PASSENGERS.C),
    'token-d': passengerToken(PASSENGERS.D),
    'token-e': passengerToken(PASSENGERS.E),
    'token-bus-a': { uid: 'BUS-A', passengerId: 'BUS-A', role: 'BUS', email: '', busId: 'BUS-A' },
    'token-bus-b': { uid: 'BUS-B', passengerId: 'BUS-B', role: 'BUS', email: '', busId: 'BUS-B' },
    [`sharing:BUS-A:${TRIP_X}`]: { role: 'BUS', busId: 'BUS-A', tripId: TRIP_X, scope: 'JOURNEY_LOCATION' },
    'sharing:BUS-B:TRIP-Z': { role: 'BUS', busId: 'BUS-B', tripId: 'TRIP-Z', scope: 'JOURNEY_LOCATION' },
};

const STOPS = [
    { stopId: 'S1', name: 'Kaduwela', latitude: 6.9333, longitude: 79.9833 },
    { stopId: 'S2', name: 'Malabe', latitude: 6.9061, longitude: 79.9696 },
    { stopId: 'S3', name: 'Koswatta', latitude: 6.9076, longitude: 79.9281 },
    { stopId: 'S4', name: 'Battaramulla', latitude: 6.9022, longitude: 79.9181 },
    { stopId: 'S5', name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8943 },
    { stopId: 'S6', name: 'Kollupitiya', latitude: 6.9114, longitude: 79.8489 },
];

function booking(bookingId: string, userId: string, tripId: string, extra: Record<string, unknown> = {}) {
    return {
        bookingId,
        userId,
        passengerName: `Name of ${userId}`,
        tripId,
        routeId: ROUTE,
        busId: 'BUS-A',
        seatNumber: '05A',
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        boardingStatus: 'NOT_BOARDED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Malabe',
            endLocation: 'Rajagiriya',
            departureTime: '06:00',
            estimatedArrivalTime: '07:15',
        },
        vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
        qrPayload: JSON.stringify({ bookingId, tripId }),
        fare: {
            distanceKm: 8,
            baseFare: 30,
            distanceFare: 40,
            concessionDiscount: 14,
            concessionType: 'ACCESSIBILITY',
            totalFare: 56,
            currency: 'LKR',
            isEstimate: false,
        },
        assistanceRequested: { boardingAssistance: true, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: 'Private note about my condition',
        createdAt: '2026-09-20T12:00:00.000Z',
        ...extra,
    };
}

let db: ReturnType<typeof createFakeFirestore>;

function seed() {
    db = createFakeFirestore({
        trips: [
            { id: 'TRIP-A', tripId: 'TRIP-A', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', departureTime: '06:00', estimatedArrivalTime: '07:15' },
            { id: 'TRIP-B', tripId: 'TRIP-B', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', departureTime: '09:00', estimatedArrivalTime: '10:15' },
            { id: 'TRIP-C', tripId: 'TRIP-C', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', departureTime: '12:00', estimatedArrivalTime: '13:15' },
            { id: 'TRIP-Z', tripId: 'TRIP-Z', routeId: ROUTE, busId: 'BUS-B', status: 'ACTIVE', departureTime: '09:00', estimatedArrivalTime: '10:15' },
        ],
        routes: [
            {
                id: ROUTE,
                routeId: ROUTE,
                routeNumber: '177',
                stops: STOPS.map((stop) => stop.name),
                distanceKm: 20,
                segmentDurationsMinutes: [10, 12, 6, 9, 15],
            },
        ],
        stops: STOPS,
        buses: [{ busId: 'BUS-A' }, { busId: 'BUS-B' }],
        bookings: [
            booking('BK-A', PASSENGERS.A, TRIP_X),
            booking('BK-B', PASSENGERS.B, TRIP_X),
            booking('BK-C', PASSENGERS.C, TRIP_X, { journey: { ...booking('x', '', '').journey, startLocation: 'Kaduwela' } }),
            booking('BK-D', PASSENGERS.D, 'TRIP-A'),
        ],
        vehicleLocations: [],
    });
    mockGetAdminDb.mockReturnValue(db);
}

// ------------------------------------------------------------------
// Callers
// ------------------------------------------------------------------

function headers(token?: string): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function json(response: Response) {
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
}

const device = (tripId: string, action: 'START' | 'END', token = 'token-bus-a') =>
    tripJourney(
        new Request(`http://localhost/api/trips/${tripId}/journey`, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({ action }),
        }),
        { params: { tripId } }
    ).then(json);

const publish = (token: string, busId: string, latitude: number, longitude: number) =>
    reportLocation(
        new Request(`http://localhost/api/buses/${busId}/location`, {
            method: 'PUT',
            headers: headers(token),
            body: JSON.stringify({ latitude, longitude, recordedAt: new Date().toISOString() }),
        }),
        { params: { busId } }
    ).then(json);

const ongoing = (token: string, query = '') =>
    getOngoing(new Request(`http://localhost/api/journeys/ongoing${query}`, { headers: headers(token) })).then(json);

const completed = (token: string) =>
    getCompleted(new Request('http://localhost/api/journeys/completed', { headers: headers(token) })).then(json);

const endJourney = (token: string, body: unknown) =>
    endOwnJourney(
        new Request('http://localhost/api/journeys/ongoing/end', {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify(body),
        })
    ).then(json);

const bookingIds = (body: any) => (body.journeys ?? []).map((journey: any) => journey.booking.bookingId);

async function record(bookingId: string) {
    return (await db.collection('bookings').doc(bookingId).get()).data()?.passengerJourney;
}

async function tripRecord(tripId = TRIP_X) {
    return (await db.collection('trips').doc(tripId).get()).data()?.journey;
}

/** Moves the server clock, so every step of the story has its own time. */
function at(iso: string) {
    jest.setSystemTime(new Date(iso));
}

beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-22T03:30:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
    mockVerifyToken.mockImplementation(async (token: string) => TOKENS[token] ?? null);
    clearOngoingRoadCache();
    seed();
});

afterEach(() => {
    jest.useRealTimers();
});

// ------------------------------------------------------------------
describe('the whole lifecycle of one run, three passengers', () => {
    it('start → live → A ends → B ends → bus ends → C auto-completed, A and B untouched', async () => {
        // ---- Bus: Start Journey on the exact trip ----
        at('2026-09-22T03:30:00.000Z');
        const started = await device(TRIP_X, 'START');
        expect(started.status).toBe(200);
        // 09:00 Sri Lanka time: the 09:00 -> 10:15 service, which ends at 10:45 if nobody ends it.
        expect(started.body.journey).toEqual({
            status: 'STARTED',
            startedAt: '2026-09-22T03:30:00.000Z',
            endedAt: null,
            busId: 'BUS-A',
            scheduledDepartureAt: '2026-09-22T03:30:00.000Z',
            scheduledArrivalAt: '2026-09-22T04:45:00.000Z',
            expiresAt: '2026-09-22T05:15:00.000Z',
        });
        expect(started.body.sharingToken).toBe(`sharing:BUS-A:${TRIP_X}`);
        // Only Trip X was started; the bus's other trips were not touched.
        expect(await tripRecord('TRIP-A')).toBeUndefined();
        expect(await tripRecord('TRIP-C')).toBeUndefined();

        // ---- Bus: publishes with the credential it was just given ----
        at('2026-09-22T03:31:00.000Z');
        const fix = await publish(started.body.sharingToken, 'BUS-A', 6.9061, 79.9696);
        expect(fix.status).toBe(200);
        expect(fix.body.location).toMatchObject({ tripId: TRIP_X, journeyStartedAt: '2026-09-22T03:30:00.000Z' });

        // ---- Passengers: A, B and C are ongoing, with the bus on the map ----
        at('2026-09-22T03:31:10.000Z');
        for (const [token, id] of [['token-a', 'BK-A'], ['token-b', 'BK-B'], ['token-c', 'BK-C']]) {
            const { status, body } = await ongoing(token);
            expect(status).toBe(200);
            expect(bookingIds(body)).toEqual([id]);
            expect(body.journeys[0].activeJourney).toMatchObject({ tripId: TRIP_X, startedAt: '2026-09-22T03:30:00.000Z' });
            expect(body.journeys[0].liveStatus).toMatchObject({
                available: true,
                location: { busId: 'BUS-A', latitude: 6.9061, longitude: 79.9696 },
                locationAgeSeconds: 10,
            });
        }
        // D is on another trip of the same bus and route: nothing running for them.
        expect((await ongoing('token-d')).body.journeys).toEqual([]);

        // The Live Journey screen's first load: route, stops, fare, no breakdown.
        const live = (await ongoing('token-a', '?include=route')).body.journeys[0];
        expect(live.route.journeyStops).toEqual(['Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya']);
        expect(live.route.stopPoints.map((point: any) => point.name)).toEqual(['Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya']);
        expect(live.route.road.geometry.coordinates.length).toBeGreaterThan(2);
        expect(live.booking.fare).toEqual({ totalFare: 56, currency: 'LKR', isEstimate: false });

        // ---- Passenger A: End Journey ----
        at('2026-09-22T03:52:00.000Z');
        const endedA = await endJourney('token-a', { bookingId: 'BK-A', completedAt: '2000-01-01T00:00:00.000Z' });
        expect(endedA.status).toBe(200);
        expect(endedA.body.completion).toEqual({ completedAt: '2026-09-22T03:52:00.000Z', completionReason: 'PASSENGER' });
        const recordA = await record('BK-A');

        // A = completed; B, C = ongoing; bus = running; GPS = still reaching B and C.
        expect((await ongoing('token-a')).body.journeys).toEqual([]);
        expect(bookingIds((await ongoing('token-b')).body)).toEqual(['BK-B']);
        expect(bookingIds((await ongoing('token-c')).body)).toEqual(['BK-C']);
        expect(await tripRecord()).toMatchObject({ status: 'STARTED', endedAt: null });

        at('2026-09-22T03:53:00.000Z');
        expect((await publish(started.body.sharingToken, 'BUS-A', 6.9076, 79.9281)).body.location.tripId).toBe(TRIP_X);
        expect((await ongoing('token-b')).body.journeys[0].liveStatus.location).toMatchObject({ latitude: 6.9076, longitude: 79.9281 });

        // ---- Passenger B: End Journey ----
        at('2026-09-22T04:05:00.000Z');
        expect((await endJourney('token-b', { bookingId: 'BK-B' })).body.completion.completedAt).toBe('2026-09-22T04:05:00.000Z');
        const recordB = await record('BK-B');

        expect(bookingIds((await ongoing('token-c')).body)).toEqual(['BK-C']);
        expect(await tripRecord()).toMatchObject({ status: 'STARTED', endedAt: null });

        // ---- Bus: End Journey ----
        at('2026-09-22T04:40:00.000Z');
        const ended = await device(TRIP_X, 'END');
        expect(ended.body.journey).toMatchObject({ status: 'ENDED', endedAt: '2026-09-22T04:40:00.000Z' });

        // A and B keep their own times and reason; C finishes with the bus.
        expect(await record('BK-A')).toEqual(recordA);
        expect(await record('BK-B')).toEqual(recordB);
        expect(recordA).toMatchObject({ completedAt: '2026-09-22T03:52:00.000Z', completionReason: 'PASSENGER' });
        expect(recordB).toMatchObject({ completedAt: '2026-09-22T04:05:00.000Z', completionReason: 'PASSENGER' });
        expect(await record('BK-C')).toMatchObject({
            tripId: TRIP_X,
            journeyStartedAt: '2026-09-22T03:30:00.000Z',
            completedAt: '2026-09-22T04:40:00.000Z',
            completionReason: 'BUS_JOURNEY_ENDED',
            // C boarded at Kaduwela: their own stops, not A's.
            journeyStops: ['Kaduwela', 'Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya'],
        });
        // Nobody else was touched.
        expect(await record('BK-D')).toBeUndefined();

        // Nobody is ongoing; each has exactly one completed journey.
        for (const [token, id] of [['token-a', 'BK-A'], ['token-b', 'BK-B'], ['token-c', 'BK-C']]) {
            expect((await ongoing(token)).body.journeys).toEqual([]);
            expect(bookingIds((await completed(token)).body)).toEqual([id]);
        }

        // ---- A fix sent with the old credential after the end carries no run ----
        at('2026-09-22T04:41:00.000Z');
        const late = await publish(started.body.sharingToken, 'BUS-A', 6.9094, 79.8943);
        expect(late.status).toBe(200);
        expect(late.body.location.tripId).toBeUndefined();
        expect(late.body.location.journeyStartedAt).toBeUndefined();
    });

    it("keeps Journey Planning's distance for Kaduwela → Rajagiriya, not a straight line or the road's", async () => {
        const started = await device(TRIP_X, 'START');
        // GPS moves during the run; the recorded distance must not depend on it.
        await publish(started.body.sharingToken, 'BUS-A', 6.9333, 79.9833);
        await publish(started.body.sharingToken, 'BUS-A', 6.9094, 79.8943);
        await device(TRIP_X, 'END');

        const stops = ['Kaduwela', 'Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya'];
        const coordinates = new Map(STOPS.map((stop) => [normalizeLocation(stop.name), stop]));
        const planning = resolveJourneyDistanceKm({ journeyStops: stops, stops: STOPS.map((stop) => stop.name), distanceKm: 20 } as any, coordinates);
        const straightLine = haversineDistanceKm(STOPS[0], STOPS[4]);

        const distance = (await record('BK-C')).plannedDistanceKm;
        expect(distance).toBe(planning);
        expect(distance).not.toBeCloseTo(straightLine, 1);
        expect(distance).not.toBe(8.4); // the mocked road distance
        expect((await completed('token-c')).body.journeys[0].completion.plannedDistanceKm).toBe(planning);
    });
});

// ------------------------------------------------------------------
describe('the same timetable trip started again (run 2)', () => {
    async function runOne() {
        at('2026-09-22T03:30:00.000Z');
        const started = await device(TRIP_X, 'START');
        at('2026-09-22T03:40:00.000Z');
        await publish(started.body.sharingToken, 'BUS-A', 6.9061, 79.9696);
        at('2026-09-22T03:50:00.000Z');
        await endJourney('token-a', { bookingId: 'BK-A' });
        at('2026-09-22T04:40:00.000Z');
        await device(TRIP_X, 'END');
    }

    it('brings back no one from run 1 — same tripId, bus and route', async () => {
        await runOne();
        const before = { A: await record('BK-A'), B: await record('BK-B'), C: await record('BK-C') };

        at('2026-09-23T03:30:00.000Z');
        const restarted = await device(TRIP_X, 'START');
        expect(restarted.body.journey.startedAt).toBe('2026-09-23T03:30:00.000Z');

        for (const token of ['token-a', 'token-b', 'token-c']) {
            expect((await ongoing(token)).body.journeys).toEqual([]);
            expect((await completed(token)).body.journeys).toHaveLength(1);
        }
        expect({ A: await record('BK-A'), B: await record('BK-B'), C: await record('BK-C') }).toEqual(before);
    });

    it("never shows run 1's last position as run 2's bus", async () => {
        await runOne();

        at('2026-09-23T03:00:00.000Z');
        await db.collection('bookings').doc('BK-E').set(booking('BK-E', PASSENGERS.E, TRIP_X, { createdAt: new Date().toISOString() }));
        at('2026-09-23T03:30:00.000Z');
        const restarted = await device(TRIP_X, 'START');

        // The stored fix is run 1's: E's journey is shown, the bus is not.
        const before = (await ongoing('token-e')).body.journeys[0];
        expect(before.booking.bookingId).toBe('BK-E');
        expect(before.liveStatus.available).toBe(false);

        // The first fix of run 2 is shown.
        at('2026-09-23T03:31:00.000Z');
        await publish(restarted.body.sharingToken, 'BUS-A', 6.9076, 79.9281);
        expect((await ongoing('token-e')).body.journeys[0].liveStatus).toMatchObject({
            available: true,
            location: { latitude: 6.9076, longitude: 79.9281 },
        });
    });
});

// ------------------------------------------------------------------
describe('Trip Control rules the story relies on', () => {
    it('one journey per bus: Trip C cannot start while Trip X runs, and can once it ends', async () => {
        await device(TRIP_X, 'START');

        const refused = await device('TRIP-C', 'START');
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('ANOTHER_JOURNEY_ACTIVE');
        expect(await tripRecord('TRIP-C')).toBeUndefined();

        await device(TRIP_X, 'END');
        expect((await device('TRIP-C', 'START')).status).toBe(200);
    });

    it("another bus cannot start or end this bus's trip", async () => {
        expect((await device(TRIP_X, 'START', 'token-bus-b')).status).toBe(403);
        await device(TRIP_X, 'START');
        expect((await device(TRIP_X, 'END', 'token-bus-b')).status).toBe(403);
        expect(await tripRecord()).toMatchObject({ status: 'STARTED' });
    });

    it("a passenger's End Journey never ends the bus's journey, even when it is the last passenger", async () => {
        await device(TRIP_X, 'START');

        for (const [token, id] of [['token-a', 'BK-A'], ['token-b', 'BK-B'], ['token-c', 'BK-C']]) {
            expect((await endJourney(token, { bookingId: id })).status).toBe(200);
        }

        expect(await tripRecord()).toMatchObject({ status: 'STARTED', endedAt: null });
    });
});

// ------------------------------------------------------------------
describe('live location from the wrong source', () => {
    beforeEach(async () => {
        await device(TRIP_X, 'START');
    });

    it("never shows a different bus's position, even one stamped with this trip and run", async () => {
        const run = await tripRecord();
        // BUS-B's own record claims Trip X's run. It is not the bus running Trip X.
        await db.collection('vehicleLocations').doc('BUS-B').set({
            busId: 'BUS-B',
            latitude: 6.95,
            longitude: 79.95,
            recordedAt: new Date().toISOString(),
            tripId: TRIP_X,
            journeyStartedAt: run.startedAt,
        });

        expect((await ongoing('token-a')).body.journeys[0].liveStatus.available).toBe(false);
    });

    it("cannot be written into this bus's record by another bus", async () => {
        const { status } = await publish('token-bus-b', 'BUS-A', 6.95, 79.95);

        expect(status).toBe(403);
        expect((await ongoing('token-a')).body.journeys[0].liveStatus.available).toBe(false);
    });

    it("is not stamped for Trip X by another bus's journey credential", async () => {
        // BUS-B running its own TRIP-Z reports into its own record, stamped TRIP-Z.
        await device('TRIP-Z', 'START', 'token-bus-b');
        const { body } = await publish('sharing:BUS-B:TRIP-Z', 'BUS-B', 6.95, 79.95);
        expect(body.location.tripId).toBe('TRIP-Z');

        expect((await ongoing('token-a')).body.journeys[0].liveStatus.available).toBe(false);
    });

    it('keeps the journey when the bus stops publishing, and reports how old the last fix is', async () => {
        const sharing = `sharing:BUS-A:${TRIP_X}`;
        await publish(sharing, 'BUS-A', 6.9061, 79.9696);

        jest.setSystemTime(new Date(Date.now() + 45 * 60_000));
        const journey = (await ongoing('token-a')).body.journeys[0];

        expect(journey.booking.bookingId).toBe('BK-A');
        expect(journey.liveStatus.available).toBe(true);
        expect(journey.liveStatus.locationAgeSeconds).toBe(45 * 60);
    });
});
