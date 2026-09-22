// Passenger bus ratings, after the passenger's own End Journey.
//
// Drives the real endpoints over an in-memory Firestore:
//
//   bus device -> POST /api/trips/:tripId/journey          (Start / End Journey, MOV-294)
//   passenger  -> POST /api/journeys/ongoing/end            (their own End Journey, MOV-297)
//   passenger  -> GET  /api/journeys/completed/rating       (Rate this bus: what is shown)
//   passenger  -> POST /api/journeys/completed/rating       (Rate this bus: submit)
//
// The rules it pins: only a passenger's own completed journey can be rated, and
// only for the bus and run its completion record names; one rating per
// passenger per run; a later run of the same bus can be rated again; skipping
// stores nothing; and rating — succeeding or failing — never touches the
// completed journey, the bus's journey, or anyone else's.

import { GET as getCompleted } from '../../../app/api/journeys/completed+api';
import { GET as getRating, POST as postRating } from '../../../app/api/journeys/completed/rating+api';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { POST as endOwnJourney } from '../../../app/api/journeys/ongoing/end+api';
import { POST as tripJourney } from '../../../app/api/trips/[tripId]/journey+api';
import { BUS_RATINGS_COLLECTION, busRatingDocumentId } from '../../../src/shared/server/busRating';
import { clearOngoingRoadCache } from '../../../src/shared/server/ongoingJourneyRoute';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { buildTestPassword } from '../../testUtils/testPassword';

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
    getRouteThroughCoordinates: jest.fn(async () => null),
    getRouteBetweenCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// TRIP-001 on route 177, run by BUS-A. Passengers A and B are both on it.
// BUS-Z is another bus in the fleet that A never travelled on.
// ------------------------------------------------------------------
const A = 'PAS-2026-00001';
const B = 'PAS-2026-00002';
const ROUTE = '177_KADUWELA_KOLLUPITIYA';
/** BUS-A's login credential on its fleet record, which no rating response may carry. Built at run time. */
const busAStoredValue = buildTestPassword();

const TOKENS: Record<string, unknown> = {
    'token-a': { uid: 'uid-a', passengerId: A, role: 'PASSENGER', email: 'a@moreable.lk' },
    'token-b': { uid: 'uid-b', passengerId: B, role: 'PASSENGER', email: 'b@moreable.lk' },
    'token-guest': { uid: 'uid-g', passengerId: 'GUEST', role: 'PASSENGER', email: '' },
    'token-admin': { uid: 'uid-admin', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' },
    'token-bus': { uid: 'BUS-A', passengerId: 'BUS-A', role: 'BUS', email: '', busId: 'BUS-A' },
    'token-sharing': { role: 'BUS', busId: 'BUS-A', tripId: 'TRIP-001', scope: 'JOURNEY_LOCATION' },
};

const FACILITIES_A = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: false,
    walkingAssistance: false,
    wheelchairSpace: { available: true, count: 2 },
    guardianSeats: { available: true, count: 2 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: false, count: 0 },
};

function booking(bookingId: string, userId: string, tripId: string, extra: Record<string, unknown> = {}) {
    return {
        bookingId,
        userId,
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
        fare: { distanceKm: 8, baseFare: 30, distanceFare: 40, totalFare: 70, currency: 'LKR', isEstimate: false },
        assistanceRequested: { boardingAssistance: false, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: '',
        createdAt: '2026-09-20T12:00:00.000Z',
        ...extra,
    };
}

let db: ReturnType<typeof createFakeFirestore>;

/** 'HH:MM' in Sri Lanka time, `offsetMinutes` from now, so Start Journey lands inside the service. */
const serviceClock = (offsetMinutes: number) =>
    new Date(Date.now() + (330 + offsetMinutes) * 60_000).toISOString().slice(11, 16);

function seed(extraBookings: any[] = []) {
    db = createFakeFirestore({
        trips: [
            { id: 'TRIP-001', tripId: 'TRIP-001', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', departureTime: serviceClock(-60), estimatedArrivalTime: serviceClock(180) },
        ],
        routes: [{ id: ROUTE, routeId: ROUTE, routeNumber: '177', stops: ['Kaduwela', 'Malabe', 'Rajagiriya', 'Kollupitiya'], distanceKm: 20 }],
        stops: [],
        buses: [
            {
                busId: 'BUS-A',
                numberPlate: 'NB-8899',
                chassisNumber: 'CH-1',
                busModel: 'Viking',
                manufacturer: 'Ashok Leyland',
                seatCapacity: 50,
                status: 'ACTIVE',
                password: busAStoredValue,
                accessibilityFacilities: FACILITIES_A,
            },
            { busId: 'BUS-Z', numberPlate: 'NC-1111', busModel: 'Lanka', manufacturer: 'Tata', status: 'ACTIVE' },
        ],
        bookings: [booking('BK-A', A, 'TRIP-001'), booking('BK-B', B, 'TRIP-001'), ...extraBookings],
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

const bus = (action: 'START' | 'END') =>
    tripJourney(
        new Request('http://localhost/api/trips/TRIP-001/journey', { method: 'POST', headers: headers('token-bus'), body: JSON.stringify({ action }) }),
        { params: { tripId: 'TRIP-001' } }
    ).then(json);

const endJourney = (token: string, bookingId: string) =>
    endOwnJourney(
        new Request('http://localhost/api/journeys/ongoing/end', { method: 'POST', headers: headers(token), body: JSON.stringify({ bookingId }) })
    ).then(json);

const rate = (token: string | undefined, body: unknown) =>
    postRating(
        new Request('http://localhost/api/journeys/completed/rating', {
            method: 'POST',
            headers: headers(token),
            body: typeof body === 'string' ? body : JSON.stringify(body),
        })
    ).then(json);

const ratingDetails = (token: string | undefined, bookingId: string) =>
    getRating(
        new Request(`http://localhost/api/journeys/completed/rating?bookingId=${encodeURIComponent(bookingId)}`, { headers: headers(token) })
    ).then(json);

const ongoing = (token: string) => getOngoing(new Request('http://localhost/api/journeys/ongoing', { headers: headers(token) })).then(json);
const completed = (token: string) => getCompleted(new Request('http://localhost/api/journeys/completed', { headers: headers(token) })).then(json);

async function stored(bookingId: string): Promise<any> {
    return (await db.collection('bookings').doc(bookingId).get()).data();
}

async function ratings(): Promise<any[]> {
    return (await db.collection(BUS_RATINGS_COLLECTION).get()).docs.map((doc) => doc.data());
}

async function tripJourneyRecord() {
    return (await db.collection('trips').doc('TRIP-001').get()).data()?.journey;
}

/** The bus starts TRIP-001 and passenger A ends their own journey on it. */
async function completeA() {
    await bus('START');
    const ended = await endJourney('token-a', 'BK-A');
    expect(ended.status).toBe(200);
    return (await stored('BK-A')).passengerJourney;
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
    jest.restoreAllMocks();
});

// ------------------------------------------------------------------
describe('POST /api/journeys/completed/rating — valid ratings', () => {
    it.each([1, 2, 3, 4, 5])('stores a %i-star rating for the passenger’s completed journey', async (stars) => {
        const completion = await completeA();

        const { status, body } = await rate('token-a', { bookingId: 'BK-A', busId: 'BUS-A', rating: stars });

        expect(status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.rating.rating).toBe(stars);
        expect(await ratings()).toHaveLength(1);
        expect((await ratings())[0].rating).toBe(stars);
        expect(completion.completionReason).toBe('PASSENGER');
    });

    it('associates the rating with the correct passenger, booking, bus and run', async () => {
        const completion = await completeA();

        await rate('token-a', { bookingId: 'BK-A', rating: 4 });
        const [rating] = await ratings();

        expect(rating).toEqual({
            id: busRatingDocumentId(A, 'TRIP-001', completion.journeyStartedAt),
            ratingId: busRatingDocumentId(A, 'TRIP-001', completion.journeyStartedAt),
            passengerId: A,
            bookingId: 'BK-A',
            busId: 'BUS-A',
            tripId: 'TRIP-001',
            journeyStartedAt: completion.journeyStartedAt,
            rating: 4,
            createdAt: expect.any(String),
        });
        // The run is exactly the one the completion record names.
        expect(rating.journeyStartedAt).toBe((await tripJourneyRecord()).startedAt);
        expect(Number.isNaN(new Date(rating.createdAt).getTime())).toBe(false);
    });

    it('rates without the client naming the bus: the bus comes from the completion record', async () => {
        await completeA();

        const { status } = await rate('token-a', { bookingId: 'BK-A', rating: 3 });

        expect(status).toBe(201);
        expect((await ratings())[0].busId).toBe('BUS-A');
    });

    it('ignores identity and run fields in the body', async () => {
        const completion = await completeA();

        await rate('token-a', {
            bookingId: 'BK-A',
            rating: 5,
            passengerId: B,
            userId: B,
            tripId: 'TRIP-999',
            journeyStartedAt: '2020-01-01T00:00:00.000Z',
            createdAt: '2020-01-01T00:00:00.000Z',
        });
        const [rating] = await ratings();

        expect(rating.passengerId).toBe(A);
        expect(rating.tripId).toBe('TRIP-001');
        expect(rating.journeyStartedAt).toBe(completion.journeyStartedAt);
        expect(rating.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('lets the passenger rate a journey that finished when the bus ended the run', async () => {
        await bus('START');
        await bus('END');
        expect((await stored('BK-A')).passengerJourney.completionReason).toBe('BUS_JOURNEY_ENDED');

        const { status } = await rate('token-a', { bookingId: 'BK-A', rating: 2 });

        expect(status).toBe(201);
    });
});

// ------------------------------------------------------------------
describe('POST /api/journeys/completed/rating — invalid ratings', () => {
    beforeEach(async () => {
        await completeA();
    });

    it.each([
        ['0', 0],
        ['6', 6],
        ['a negative value', -1],
        ['a fraction', 2.5],
        ['a numeric string', '5'],
        ['a word', 'five'],
        ['null', null],
        ['true', true],
        ['an array', [5]],
    ])('refuses %s, and stores nothing', async (_, value) => {
        const { status, body } = await rate('token-a', { bookingId: 'BK-A', rating: value });

        expect(status).toBe(400);
        expect(body.code).toBe('INVALID_RATING');
        expect(await ratings()).toEqual([]);
    });

    it('refuses a missing rating', async () => {
        const { status } = await rate('token-a', { bookingId: 'BK-A' });

        expect(status).toBe(400);
        expect(await ratings()).toEqual([]);
    });

    it('refuses a missing bookingId', async () => {
        const { status } = await rate('token-a', { rating: 4 });

        expect(status).toBe(400);
        expect(await ratings()).toEqual([]);
    });

    it('refuses a body that is not JSON', async () => {
        const { status } = await rate('token-a', 'not json');
        expect(status).toBe(400);
    });
});

// ------------------------------------------------------------------
describe('POST /api/journeys/completed/rating — access', () => {
    beforeEach(async () => {
        await completeA();
    });

    it('refuses a request with no token', async () => {
        const { status } = await rate(undefined, { bookingId: 'BK-A', rating: 5 });

        expect(status).toBe(401);
        expect(await ratings()).toEqual([]);
    });

    it('refuses an invalid or expired token', async () => {
        const { status } = await rate('token-expired', { bookingId: 'BK-A', rating: 5 });
        expect(status).toBe(401);
    });

    it.each([
        ['an admin', 'token-admin'],
        ['a bus device', 'token-bus'],
        ['a journey-sharing credential', 'token-sharing'],
        ['a guest session', 'token-guest'],
    ])('refuses %s', async (_, token) => {
        const { status } = await rate(token, { bookingId: 'BK-A', rating: 5 });

        expect(status).toBe(403);
        expect(await ratings()).toEqual([]);
    });

    it('does not let a passenger rate another passenger’s journey', async () => {
        const { status, body, text } = await rate('token-b', { bookingId: 'BK-A', rating: 1 });

        expect(status).toBe(404);
        expect(body.code).toBe('JOURNEY_NOT_FOUND');
        // Answers exactly like a booking that does not exist.
        expect((await rate('token-b', { bookingId: 'BK-NOPE', rating: 1 })).body).toEqual(body);
        expect(text).not.toContain(A);
        expect(await ratings()).toEqual([]);
    });

    it('does not let a passenger rate a bus they did not travel on', async () => {
        const { status, body } = await rate('token-a', { bookingId: 'BK-A', busId: 'BUS-Z', rating: 5 });

        expect(status).toBe(409);
        expect(body.code).toBe('BUS_MISMATCH');
        expect(await ratings()).toEqual([]);
    });

    it('does not let a passenger rate a journey that has not completed', async () => {
        // B is still ongoing on the same run.
        const { status, body } = await rate('token-b', { bookingId: 'BK-B', rating: 5 });

        expect(status).toBe(409);
        expect(body.code).toBe('JOURNEY_NOT_COMPLETED');
        expect(await ratings()).toEqual([]);
    });

    it('does not rate a completion record that names no bus', async () => {
        const record = (await stored('BK-A')).passengerJourney;
        await db.collection('bookings').doc('BK-A').update({ passengerJourney: { ...record, busId: '' } });

        const { status, body } = await rate('token-a', { bookingId: 'BK-A', busId: 'BUS-A', rating: 5 });

        expect(status).toBe(409);
        expect(body.code).toBe('BUS_NOT_RECORDED');
    });
});

// ------------------------------------------------------------------
describe('duplicate ratings', () => {
    it('refuses a second rating for the same completed journey and keeps the first', async () => {
        await completeA();
        await rate('token-a', { bookingId: 'BK-A', rating: 2 });

        const again = await rate('token-a', { bookingId: 'BK-A', rating: 5 });

        expect(again.status).toBe(409);
        expect(again.body.code).toBe('ALREADY_RATED');
        expect(await ratings()).toHaveLength(1);
        expect((await ratings())[0].rating).toBe(2);
    });

    it('treats several seats on the same run as one journey', async () => {
        seed([booking('BK-A2', A, 'TRIP-001', { seatNumber: '06A' })]);
        await bus('START');
        await endJourney('token-a', 'BK-A');
        expect((await stored('BK-A2')).passengerJourney).toBeDefined();

        expect((await rate('token-a', { bookingId: 'BK-A', rating: 4 })).status).toBe(201);
        const second = await rate('token-a', { bookingId: 'BK-A2', rating: 1 });

        expect(second.status).toBe(409);
        expect(await ratings()).toHaveLength(1);
    });

    it('lets the same passenger rate the same bus again on a different run', async () => {
        const first = await completeA();
        await rate('token-a', { bookingId: 'BK-A', rating: 1 });
        await bus('END');

        // A later run of the same timetable trip, same bus, booked afresh.
        jest.useFakeTimers({ now: new Date(Date.now() + 60 * 60_000), doNotFake: ['nextTick', 'setImmediate'] });
        await db.collection('bookings').doc('BK-A-NEW').set(booking('BK-A-NEW', A, 'TRIP-001', { createdAt: new Date().toISOString() }));
        await bus('START');
        expect((await endJourney('token-a', 'BK-A-NEW')).status).toBe(200);
        const second = (await stored('BK-A-NEW')).passengerJourney;
        expect(second.journeyStartedAt).not.toBe(first.journeyStartedAt);

        const { status } = await rate('token-a', { bookingId: 'BK-A-NEW', busId: 'BUS-A', rating: 5 });

        expect(status).toBe(201);
        const all = await ratings();
        expect(all).toHaveLength(2);
        expect(all.map((rating) => [rating.busId, rating.journeyStartedAt, rating.rating])).toEqual([
            ['BUS-A', first.journeyStartedAt, 1],
            ['BUS-A', second.journeyStartedAt, 5],
        ]);
    });
});

// ------------------------------------------------------------------
describe('skipping, and the journey staying completed', () => {
    it('stores no rating when the passenger ends their journey and skips', async () => {
        await completeA();
        // Opening the rating screen reads only.
        await ratingDetails('token-a', 'BK-A');

        expect(await ratings()).toEqual([]);
        expect((await stored('BK-A')).passengerJourney.status).toBe('COMPLETED');
    });

    it('leaves the completed journey, the bus’s journey and other passengers exactly as they were', async () => {
        const record = await completeA();
        const busJourney = await tripJourneyRecord();

        await rate('token-a', { bookingId: 'BK-A', rating: 5 });

        expect((await stored('BK-A')).passengerJourney).toEqual(record);
        expect(await tripJourneyRecord()).toEqual(busJourney);
        expect(busJourney.status).toBe('STARTED');
        expect((await ongoing('token-b')).body.journeys.map((journey: any) => journey.booking.bookingId)).toEqual(['BK-B']);
        expect((await stored('BK-B')).passengerJourney).toBeUndefined();
    });

    it('keeps the journey completed when saving the rating fails', async () => {
        const record = await completeA();
        const busJourney = await tripJourneyRecord();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        db.runTransaction.mockImplementationOnce(async () => {
            throw new Error('Firestore unavailable: internal detail');
        });

        const { status, text } = await rate('token-a', { bookingId: 'BK-A', rating: 4 });

        expect(status).toBe(500);
        expect(text).not.toContain('internal detail');
        expect(await ratings()).toEqual([]);
        expect((await stored('BK-A')).passengerJourney).toEqual(record);
        expect((await ongoing('token-a')).body.journeys).toEqual([]);
        expect((await completed('token-a')).body.journeys.map((journey: any) => journey.booking.bookingId)).toEqual(['BK-A']);
        expect(await tripJourneyRecord()).toEqual(busJourney);

        // And the passenger can still rate it afterwards.
        expect((await rate('token-a', { bookingId: 'BK-A', rating: 4 })).status).toBe(201);
    });
});

// ------------------------------------------------------------------
describe('GET /api/journeys/completed/rating', () => {
    it('shows the bus that ran the journey, with its recorded facilities and nothing private', async () => {
        const completion = await completeA();

        const { status, body, text } = await ratingDetails('token-a', 'BK-A');

        expect(status).toBe(200);
        expect(body.bus).toEqual({
            busId: 'BUS-A',
            numberPlate: 'NB-8899',
            busModel: 'Viking',
            manufacturer: 'Ashok Leyland',
            accessibilityFacilities: FACILITIES_A,
        });
        expect(body.journey).toEqual({
            bookingId: 'BK-A',
            tripId: 'TRIP-001',
            journeyStartedAt: completion.journeyStartedAt,
            completedAt: completion.completedAt,
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            origin: 'Malabe',
            destination: 'Rajagiriya',
        });
        expect(body.myRating).toBeNull();
        expect(text).not.toContain(busAStoredValue);
        expect(text).not.toContain('chassis');
    });

    it('reports the passenger’s own rating once given', async () => {
        await completeA();
        await rate('token-a', { bookingId: 'BK-A', rating: 3 });

        const { body } = await ratingDetails('token-a', 'BK-A');

        expect(body.myRating).toEqual({ rating: 3, createdAt: expect.any(String) });
    });

    it('names the bus from the booking and leaves facilities unknown when the bus record is gone', async () => {
        await completeA();
        await db.collection('buses').doc('BUS-A').delete();

        const { status, body } = await ratingDetails('token-a', 'BK-A');

        expect(status).toBe(200);
        expect(body.bus).toEqual({
            busId: 'BUS-A',
            numberPlate: 'NB-8899',
            busModel: 'Viking',
            manufacturer: 'Ashok Leyland',
            accessibilityFacilities: null,
        });
    });

    it('refuses another passenger’s booking, an unknown one, and a journey still ongoing', async () => {
        await completeA();

        expect((await ratingDetails('token-b', 'BK-A')).status).toBe(404);
        expect((await ratingDetails('token-a', 'BK-NOPE')).status).toBe(404);
        expect((await ratingDetails('token-b', 'BK-B')).status).toBe(409);
    });

    it('refuses a request with no token, and one from a non-passenger', async () => {
        await completeA();

        expect((await ratingDetails(undefined, 'BK-A')).status).toBe(401);
        expect((await ratingDetails('token-admin', 'BK-A')).status).toBe(403);
    });
});
