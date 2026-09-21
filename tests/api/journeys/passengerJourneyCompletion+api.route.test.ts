// Passenger journey completion and history (MOV-297).
//
// Drives the real endpoints over an in-memory Firestore:
//
//   bus device -> POST /api/trips/:tripId/journey      (Start / End Journey, MOV-294)
//   passenger  -> GET  /api/journeys/ongoing            (MOV-295 / MOV-296)
//   passenger  -> POST /api/journeys/ongoing/end        (their own End Journey)
//   passenger  -> GET  /api/journeys/completed          (Activities > Completed)
//
// The rule it pins: a passenger ending THEIR journey and the bus ending ITS
// journey are different events. The first completes one passenger and leaves
// the bus, its location sharing and every other passenger running. The second
// completes whoever is still ongoing, never touching anyone who already
// finished. And a completed journey never comes back when the same timetable
// trip is started again.

import { PUT as reportLocation } from '../../../app/api/buses/[busId]/location+api';
import { GET as getCompleted } from '../../../app/api/journeys/completed+api';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { POST as endOwnJourney } from '../../../app/api/journeys/ongoing/end+api';
import { POST as tripJourney } from '../../../app/api/trips/[tripId]/journey+api';
import { clearOngoingRoadCache } from '../../../src/shared/server/ongoingJourneyRoute';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    generateJourneySharingToken: async (busId: string, tripId: string) => `sharing:${busId}:${tripId}`,
    verifyToken: (token: string) => mockVerifyToken(token),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteThroughCoordinates: jest.fn(async () => ({
        distanceKm: 8.4,
        durationMinutes: 21,
        geometry: { type: 'LineString', coordinates: [[79.9696, 6.9061], [79.8943, 6.9094]] },
    })),
    getRouteBetweenCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// Trip X = TRIP-001 on route 177, run by BUS-A. Passengers A, B and C are all
// booked on it; A and B board at Malabe, C at Kaduwela. Everyone gets off at
// Rajagiriya. Passenger D is booked on another trip of the same bus.
// ------------------------------------------------------------------
const A = 'PAS-2026-00001';
const B = 'PAS-2026-00002';
const C = 'PAS-2026-00003';
const D = 'PAS-2026-00004';
const ROUTE = '177_KADUWELA_KOLLUPITIYA';

const TOKENS: Record<string, unknown> = {
    'token-a': { uid: 'uid-a', passengerId: A, role: 'PASSENGER', email: 'a@moreable.lk' },
    'token-b': { uid: 'uid-b', passengerId: B, role: 'PASSENGER', email: 'b@moreable.lk' },
    'token-c': { uid: 'uid-c', passengerId: C, role: 'PASSENGER', email: 'c@moreable.lk' },
    'token-d': { uid: 'uid-d', passengerId: D, role: 'PASSENGER', email: 'd@moreable.lk' },
    'token-admin': { uid: 'uid-admin', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' },
    'token-bus': { uid: 'BUS-A', passengerId: 'BUS-A', role: 'BUS', email: '', busId: 'BUS-A' },
    'token-sharing': { role: 'BUS', busId: 'BUS-A', tripId: 'TRIP-001', scope: 'JOURNEY_LOCATION' },
};

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

const STOPS = [
    { stopId: 'S1', name: 'Kaduwela', latitude: 6.9333, longitude: 79.9833 },
    { stopId: 'S2', name: 'Malabe', latitude: 6.9061, longitude: 79.9696 },
    { stopId: 'S3', name: 'Koswatta', latitude: 6.9076, longitude: 79.9281 },
    { stopId: 'S4', name: 'Battaramulla', latitude: 6.9022, longitude: 79.9181 },
    { stopId: 'S5', name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8943 },
    { stopId: 'S6', name: 'Kollupitiya', latitude: 6.9114, longitude: 79.8489 },
];

let db: ReturnType<typeof createFakeFirestore>;

/**
 * 'HH:MM' in Sri Lanka time, `offsetMinutes` from now. These tests run on the
 * real clock, so TRIP-001's scheduled service is placed around it (an hour ago
 * to three hours ahead) and a Start Journey always lands inside it.
 */
const serviceClock = (offsetMinutes: number) =>
    new Date(Date.now() + (330 + offsetMinutes) * 60_000).toISOString().slice(11, 16);

function seed(extraBookings: any[] = []) {
    db = createFakeFirestore({
        trips: [
            { id: 'TRIP-001', tripId: 'TRIP-001', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', departureTime: serviceClock(-60), estimatedArrivalTime: serviceClock(180) },
            { id: 'TRIP-002', tripId: 'TRIP-002', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', departureTime: '09:00', estimatedArrivalTime: '10:15' },
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
        buses: [{ busId: 'BUS-A' }],
        bookings: [
            booking('BK-A', A, 'TRIP-001'),
            booking('BK-B', B, 'TRIP-001'),
            booking('BK-C', C, 'TRIP-001', { journey: { ...booking('x', C, 'x').journey, startLocation: 'Kaduwela' } }),
            booking('BK-D', D, 'TRIP-002'),
            ...extraBookings,
        ],
        vehicleLocations: [],
    });
    mockGetAdminDb.mockReturnValue(db);
}

function headers(token?: string): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function json(response: Response) {
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
}

const bus = (tripId: string, action: 'START' | 'END') =>
    tripJourney(
        new Request(`http://localhost/api/trips/${tripId}/journey`, {
            method: 'POST',
            headers: headers('token-bus'),
            body: JSON.stringify({ action }),
        }),
        { params: { tripId } }
    ).then(json);

const ongoing = (token: string) =>
    getOngoing(new Request('http://localhost/api/journeys/ongoing', { headers: headers(token) })).then(json);

const completed = (token: string, query = '') =>
    getCompleted(new Request(`http://localhost/api/journeys/completed${query}`, { headers: headers(token) })).then(json);

const endJourney = (token: string | undefined, body: unknown = {}) =>
    endOwnJourney(
        new Request('http://localhost/api/journeys/ongoing/end', {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify(body),
        })
    ).then(json);

const bookingIds = (body: any) => (body.journeys ?? []).map((journey: any) => journey.booking.bookingId);

async function stored(bookingId: string): Promise<any> {
    return (await db.collection('bookings').doc(bookingId).get()).data();
}

async function tripJourneyRecord(tripId = 'TRIP-001') {
    return (await db.collection('trips').doc(tripId).get()).data()?.journey;
}

beforeEach(() => {
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
describe('passenger End Journey — access (MOV-296 model)', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
    });

    it('refuses a request with no token, and records nothing', async () => {
        const { status } = await endJourney(undefined, { bookingId: 'BK-A' });

        expect(status).toBe(401);
        expect((await stored('BK-A')).passengerJourney).toBeUndefined();
    });

    it('refuses an invalid or expired token', async () => {
        const { status } = await endJourney('token-expired', { bookingId: 'BK-A' });
        expect(status).toBe(401);
    });

    it.each([
        ['an admin', 'token-admin'],
        ['a bus device', 'token-bus'],
        ['a journey-sharing credential', 'token-sharing'],
    ])('refuses %s', async (_, token) => {
        const { status } = await endJourney(token, { bookingId: 'BK-A' });

        expect(status).toBe(403);
        expect((await stored('BK-A')).passengerJourney).toBeUndefined();
    });

    it('lets the passenger complete their own ongoing journey', async () => {
        const { status, body } = await endJourney('token-a', { bookingId: 'BK-A' });

        expect(status).toBe(200);
        expect(body.alreadyCompleted).toBe(false);
        expect(body.completion.completionReason).toBe('PASSENGER');
    });

    it('works without naming the booking when only one journey is running', async () => {
        const { status } = await endJourney('token-a');
        expect(status).toBe(200);
    });

    it('asks which journey when several are running and none is named', async () => {
        seed([booking('BK-A2', A, 'TRIP-001', { seatNumber: '06A' }), booking('BK-A3', A, 'TRIP-002')]);
        await bus('TRIP-001', 'START');
        // TRIP-002 is run by the same bus, so it cannot run at once; give it its own.
        await db.collection('trips').doc('TRIP-002').update({ busId: 'BUS-Z', journey: { status: 'STARTED', startedAt: new Date().toISOString(), endedAt: null, busId: 'BUS-Z', expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString() } });

        const { status, body } = await endJourney('token-a');

        expect(status).toBe(409);
        expect(body.code).toBe('JOURNEY_NOT_SPECIFIED');
    });
});

// ------------------------------------------------------------------
describe('passenger End Journey — identity comes from the session only', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
    });

    it('ignores passengerId, userId, tripId, busId and routeId in the body', async () => {
        const { status } = await endJourney('token-b', {
            bookingId: 'BK-B',
            passengerId: A,
            userId: A,
            tripId: 'TRIP-002',
            busId: 'BUS-Z',
            routeId: 'OTHER',
        });

        expect(status).toBe(200);
        expect((await stored('BK-B')).passengerJourney.tripId).toBe('TRIP-001');
        expect((await stored('BK-B')).passengerJourney.busId).toBe('BUS-A');
        expect((await stored('BK-A')).passengerJourney).toBeUndefined();
    });

    it('stamps the server time, never a completedAt the client sent', async () => {
        const before = Date.now();
        await endJourney('token-a', { bookingId: 'BK-A', completedAt: '1999-01-01T00:00:00.000Z' });
        const after = Date.now();

        const completedAt = new Date((await stored('BK-A')).passengerJourney.completedAt).getTime();
        expect(completedAt).toBeGreaterThanOrEqual(before);
        expect(completedAt).toBeLessThanOrEqual(after);
    });

    it("cannot complete another passenger's journey", async () => {
        const { status, body, text } = await endJourney('token-b', { bookingId: 'BK-A' });

        expect(status).toBe(409);
        expect(body.code).toBe('NO_ONGOING_JOURNEY');
        expect(text).not.toContain(A);
        expect((await stored('BK-A')).passengerJourney).toBeUndefined();
        expect(bookingIds((await ongoing('token-a')).body)).toEqual(['BK-A']);
    });

    it('completes nothing for a passenger with no ongoing journey', async () => {
        const { status } = await endJourney('token-d', { bookingId: 'BK-D' });

        expect(status).toBe(409);
        expect((await stored('BK-D')).passengerJourney).toBeUndefined();
    });
});

// ------------------------------------------------------------------
describe('passenger End ≠ bus End', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
    });

    it('completes only that passenger; the bus, its sharing and the others carry on', async () => {
        const startedBefore = await tripJourneyRecord();

        await endJourney('token-a', { bookingId: 'BK-A' });

        // A: out of Ongoing, into Completed.
        expect((await ongoing('token-a')).body.journeys).toEqual([]);
        expect(bookingIds((await completed('token-a')).body)).toEqual(['BK-A']);

        // B and C: still ongoing.
        expect(bookingIds((await ongoing('token-b')).body)).toEqual(['BK-B']);
        expect(bookingIds((await ongoing('token-c')).body)).toEqual(['BK-C']);
        expect((await stored('BK-B')).passengerJourney).toBeUndefined();

        // The bus's journey is untouched.
        expect(await tripJourneyRecord()).toEqual(startedBefore);
        expect((await tripJourneyRecord()).status).toBe('STARTED');
    });

    it("keeps the bus's location reaching the passengers still on board", async () => {
        await endJourney('token-a', { bookingId: 'BK-A' });

        const sharing = await reportLocation(
            new Request('http://localhost/api/buses/BUS-A/location', {
                method: 'PUT',
                headers: headers('token-sharing'),
                body: JSON.stringify({ latitude: 6.9076, longitude: 79.9281, recordedAt: new Date().toISOString() }),
            }),
            { params: { busId: 'BUS-A' } }
        );
        expect(sharing.status).toBe(200);

        const { body } = await ongoing('token-b');
        expect(body.journeys[0].liveStatus.available).toBe(true);
        expect(body.journeys[0].liveStatus.location).toMatchObject({ latitude: 6.9076, longitude: 79.9281 });
    });
});

// ------------------------------------------------------------------
describe('no duplicate completions', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
    });

    it('a repeated request reports the first completion and changes nothing', async () => {
        const first = await endJourney('token-a', { bookingId: 'BK-A' });
        const recorded = (await stored('BK-A')).passengerJourney;
        const second = await endJourney('token-a', { bookingId: 'BK-A' });

        expect(second.status).toBe(200);
        expect(second.body.alreadyCompleted).toBe(true);
        expect(second.body.completion.completedAt).toBe(first.body.completion.completedAt);
        expect((await stored('BK-A')).passengerJourney).toEqual(recorded);
        expect(bookingIds((await completed('token-a')).body)).toEqual(['BK-A']);
    });

    it('two taps at once leave one record', async () => {
        const [one, two] = await Promise.all([
            endJourney('token-a', { bookingId: 'BK-A' }),
            endJourney('token-a', { bookingId: 'BK-A' }),
        ]);

        expect([one.status, two.status]).toEqual([200, 200]);
        expect(bookingIds((await completed('token-a')).body)).toEqual(['BK-A']);
    });
});

// ------------------------------------------------------------------
describe('bus End Journey', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
    });

    it('completes everyone still ongoing, and leaves an earlier passenger completion alone', async () => {
        jest.useFakeTimers({ now: new Date(Date.now() + 60_000), doNotFake: ['nextTick', 'setImmediate'] });
        await endJourney('token-a', { bookingId: 'BK-A' });
        const aRecord = (await stored('BK-A')).passengerJourney;

        jest.setSystemTime(new Date(Date.now() + 20 * 60_000));
        const ended = await bus('TRIP-001', 'END');
        const busEndedAt = ended.body.journey.endedAt;

        // A: unchanged.
        expect((await stored('BK-A')).passengerJourney).toEqual(aRecord);
        expect(aRecord.completionReason).toBe('PASSENGER');
        expect(aRecord.completedAt).not.toBe(busEndedAt);

        // B and C: completed with the bus's end time.
        for (const id of ['BK-B', 'BK-C']) {
            const record = (await stored(id)).passengerJourney;
            expect(record.completionReason).toBe('BUS_JOURNEY_ENDED');
            expect(record.completedAt).toBe(busEndedAt);
            expect(record.journeyStartedAt).toBe(aRecord.journeyStartedAt);
        }

        for (const token of ['token-a', 'token-b', 'token-c']) {
            expect((await ongoing(token)).body.journeys).toEqual([]);
            expect((await completed(token)).body.journeys).toHaveLength(1);
        }
    });

    it('leaves bookings on other trips, cancelled bookings, and ones used on an earlier run alone', async () => {
        const startedAt = (await tripJourneyRecord()).startedAt;
        seed([
            booking('BK-CANCELLED', B, 'TRIP-001', { status: 'CANCELLED' }),
            booking('BK-EARLIER-RUN', C, 'TRIP-001', { boardedAt: new Date(new Date(startedAt).getTime() - 86_400_000).toISOString() }),
        ]);
        await bus('TRIP-001', 'START');

        await bus('TRIP-001', 'END');

        for (const id of ['BK-D', 'BK-CANCELLED', 'BK-EARLIER-RUN']) {
            expect((await stored(id)).passengerJourney).toBeUndefined();
        }
    });

    it('a repeated End changes no completion', async () => {
        await bus('TRIP-001', 'END');
        const bRecord = (await stored('BK-B')).passengerJourney;

        const again = await bus('TRIP-001', 'END');

        expect(again.status).toBe(200);
        expect((await stored('BK-B')).passengerJourney).toEqual(bRecord);
    });
});

// ------------------------------------------------------------------
describe('passenger and bus ending at about the same time', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
    });

    it('passenger first: keeps the passenger time; the bus completes only the others', async () => {
        await endJourney('token-a', { bookingId: 'BK-A' });
        const aRecord = (await stored('BK-A')).passengerJourney;

        await bus('TRIP-001', 'END');

        expect((await stored('BK-A')).passengerJourney).toEqual(aRecord);
        expect((await stored('BK-B')).passengerJourney.completionReason).toBe('BUS_JOURNEY_ENDED');
    });

    it('bus first: the passenger was already completed by the bus; no manual record is made', async () => {
        const ended = await bus('TRIP-001', 'END');

        const { status, body } = await endJourney('token-a', { bookingId: 'BK-A' });

        expect(status).toBe(200);
        expect(body.alreadyCompleted).toBe(true);
        expect(body.completion).toEqual({ completedAt: ended.body.journey.endedAt, completionReason: 'BUS_JOURNEY_ENDED' });
    });

    it('both at once: exactly one record per passenger', async () => {
        await Promise.all([endJourney('token-a', { bookingId: 'BK-A' }), bus('TRIP-001', 'END')]);

        const aRecord = (await stored('BK-A')).passengerJourney;
        expect(['PASSENGER', 'BUS_JOURNEY_ENDED']).toContain(aRecord.completionReason);
        expect(bookingIds((await completed('token-a')).body)).toEqual(['BK-A']);
        expect((await stored('BK-B')).passengerJourney.completionReason).toBe('BUS_JOURNEY_ENDED');
    });
});

// ------------------------------------------------------------------
describe('the same timetable trip started again', () => {
    it('never brings back a journey the passenger completed', async () => {
        await bus('TRIP-001', 'START');
        await endJourney('token-a', { bookingId: 'BK-A' });
        const aRecord = (await stored('BK-A')).passengerJourney;

        // The run continues and ends; then the same trip is started as a new run.
        await bus('TRIP-001', 'END');
        jest.useFakeTimers({ now: new Date(Date.now() + 60 * 60_000), doNotFake: ['nextTick', 'setImmediate'] });
        const restarted = await bus('TRIP-001', 'START');
        expect(restarted.body.journey.startedAt).not.toBe(aRecord.journeyStartedAt);

        expect((await ongoing('token-a')).body.journeys).toEqual([]);
        expect((await ongoing('token-b')).body.journeys).toEqual([]);
        expect((await stored('BK-A')).passengerJourney).toEqual(aRecord);
    });

    it('treats a booking made for the new run as its own journey', async () => {
        await bus('TRIP-001', 'START');
        await endJourney('token-a', { bookingId: 'BK-A' });
        await bus('TRIP-001', 'END');

        jest.useFakeTimers({ now: new Date(Date.now() + 60 * 60_000), doNotFake: ['nextTick', 'setImmediate'] });
        await db.collection('bookings').doc('BK-A-NEW').set(booking('BK-A-NEW', A, 'TRIP-001', { createdAt: new Date().toISOString() }));
        await bus('TRIP-001', 'START');

        expect(bookingIds((await ongoing('token-a')).body)).toEqual(['BK-A-NEW']);
    });

    it('does not complete a booking made after the run ended when End is repeated', async () => {
        await bus('TRIP-001', 'START');
        await bus('TRIP-001', 'END');

        jest.useFakeTimers({ now: new Date(Date.now() + 60_000), doNotFake: ['nextTick', 'setImmediate'] });
        await db.collection('bookings').doc('BK-LATER').set(booking('BK-LATER', D, 'TRIP-001', { createdAt: new Date().toISOString() }));
        await bus('TRIP-001', 'END');

        expect((await stored('BK-LATER')).passengerJourney).toBeUndefined();
    });
});

// ------------------------------------------------------------------
describe('GET /api/journeys/completed', () => {
    beforeEach(async () => {
        await bus('TRIP-001', 'START');
        await endJourney('token-a', { bookingId: 'BK-A' });
    });

    it.each([
        ['no token', undefined, 401],
        ['an admin', 'token-admin', 403],
        ['a bus device', 'token-bus', 403],
        ['a journey-sharing credential', 'token-sharing', 403],
    ])('refuses %s', async (_, token, expected) => {
        const response = await getCompleted(new Request('http://localhost/api/journeys/completed', { headers: headers(token) }));
        expect(response.status).toBe(expected);
    });

    it("returns only the passenger's own completed journeys", async () => {
        expect(bookingIds((await completed('token-a')).body)).toEqual(['BK-A']);
        expect((await completed('token-b')).body.journeys).toEqual([]);
        expect((await completed('token-b', `?passengerId=${A}`)).body.journeys).toEqual([]);
    });

    it('preserves how and when it finished, the run, the fare paid and the planned distance', async () => {
        const { body } = await completed('token-a');
        const journey = body.journeys[0];

        expect(journey.completion).toMatchObject({
            status: 'COMPLETED',
            tripId: 'TRIP-001',
            busId: 'BUS-A',
            completionReason: 'PASSENGER',
            journeyStops: ['Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya'],
        });
        expect(journey.completion.journeyStartedAt).toBe((await tripJourneyRecord()).startedAt);
        expect(journey.booking.fare).toEqual({ totalFare: 56, currency: 'LKR', isEstimate: false });
        // Journey Planning's own measure: stop to stop along the passenger's
        // part of the route, not the route's 20 km total.
        expect(journey.completion.plannedDistanceKm).toBeGreaterThan(0);
        expect(journey.completion.plannedDistanceKm).toBeLessThan(20);
    });

    it("uses the route's recorded distance for a whole-route journey", async () => {
        seed([
            booking('BK-WHOLE', D, 'TRIP-001', {
                journey: { ...booking('x', D, 'x').journey, startLocation: 'Kaduwela', endLocation: 'Kollupitiya' },
            }),
        ]);
        await bus('TRIP-001', 'START');
        await endJourney('token-d', { bookingId: 'BK-WHOLE' });

        expect((await completed('token-d')).body.journeys[0].completion.plannedDistanceKm).toBe(20);
    });

    it('never returns the raw booking', async () => {
        const { body, text } = await completed('token-a');

        expect(Object.keys(body.journeys[0].booking).sort()).toEqual(
            // The MOV-296 allow-list (boardedAt is absent: this booking was never scanned).
            ['boardingStatus', 'bookingId', 'busId', 'fare', 'journey', 'pairedSeatNumber', 'routeId', 'seatNumber', 'status', 'tripId', 'userId', 'vehicle'].sort()
        );
        for (const secret of ['qrPayload', 'baseFare', 'concession', 'ACCESSIBILITY', 'Private note', 'passengerName', 'assistance']) {
            expect(text).not.toContain(secret);
        }
    });

    it('adds the planned path, with no live position, when asked', async () => {
        const { body } = await completed('token-a', '?include=route');
        const journey = body.journeys[0];

        expect(journey.route.journeyStops).toEqual(['Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya']);
        expect(journey.route.road).not.toBeNull();
        expect(journey).not.toHaveProperty('liveStatus');
    });
});
