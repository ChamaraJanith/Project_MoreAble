// The passenger's ongoing journey (MOV-295).
//
// Drives GET /api/journeys/ongoing against a seeded database. What matters is
// the match: the session's passenger -> their CONFIRMED booking -> that exact
// trip's running Start Journey (MOV-294) -> that bus's position reported FOR
// that trip. Never by route: two trips of route 177 run side by side here.
//
// Also covers the one write-side change it relies on: the location endpoint
// stamping a fix with the trip from the journey-sharing credential.

import { PUT as reportLocation } from '../../../app/api/buses/[busId]/location+api';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the token check is stubbed; header parsing and the 401 helper run for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures — the story's example.
//
//   TRIP-00004  route 177, 06:00, NB-8899 (BUS-8899)   STARTED 30 min ago
//   TRIP-00005  route 177, 06:30, NB-7777 (BUS-7777)   not started
//
//   Passenger A booked TRIP-00004. Passenger B booked TRIP-00005.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';

const session = (passengerId: string, extra: Record<string, unknown> = {}) => ({
    uid: `uid-${passengerId}`,
    passengerId,
    role: 'PASSENGER',
    email: `${passengerId}@moreable.lk`,
    ...extra,
});

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
    expiresAt: minutesAgo(-120),
});

function trip(tripId: string, busId: string, extra: Record<string, unknown> = {}) {
    return { tripId, routeId: '177_KADUWELA_KOLLUPITIYA', busId, departureTime: '06:00', status: 'ACTIVE', ...extra };
}

function seed(overrides: Record<string, any[]> = {}) {
    return createFakeFirestore({
        trips: [
            trip('TRIP-00004', 'BUS-8899', { journey: startedJourney('BUS-8899') }),
            trip('TRIP-00005', 'BUS-7777', { departureTime: '06:30' }),
        ],
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

async function ongoing(account: unknown, query = '') {
    mockVerifyToken.mockResolvedValue(account);
    const headers: Record<string, string> = account ? { Authorization: 'Bearer test-token' } : {};
    const response = await getOngoing(new Request(`http://localhost/api/journeys/ongoing${query}`, { headers }));
    return { status: response.status, body: await response.json() };
}

const bookingIds = (body: any) => body.journeys.map((journey: any) => journey.booking.bookingId);

const NOTHING = { success: true, message: 'No ongoing journey.', ongoing: false, journeys: [] };

beforeEach(() => {
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
});

describe('GET /api/journeys/ongoing — authentication', () => {
    it('refuses an unauthenticated request', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { status, body } = await ongoing(null);

        expect(status).toBe(401);
        expect(body.success).toBe(false);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses an invalid token', async () => {
        mockGetAdminDb.mockReturnValue(seed());
        mockVerifyToken.mockResolvedValue(null);

        const response = await getOngoing(
            new Request('http://localhost/api/journeys/ongoing', { headers: { Authorization: 'Bearer bad' } })
        );

        expect(response.status).toBe(401);
    });

    it('refuses a bus session and a journey-sharing credential', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const bus = await ongoing(session('BUS-8899', { role: 'BUS', busId: 'BUS-8899' }));
        const sharing = await ongoing(
            session('BUS-8899', { role: 'BUS', busId: 'BUS-8899', scope: 'JOURNEY_LOCATION', tripId: 'TRIP-00004' })
        );

        expect(bus.status).toBe(403);
        expect(sharing.status).toBe(403);
    });

    it('answers for the session passenger and ignores a passengerId in the URL', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await ongoing(session(PASSENGER_B), `?passengerId=${PASSENGER_A}`);

        expect(body).toEqual(NOTHING);
    });
});

describe('GET /api/journeys/ongoing — matching the active trip', () => {
    it('returns nothing for a passenger with no bookings', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { status, body } = await ongoing(session('PAS-2026-00099'));

        expect(status).toBe(200);
        expect(body).toEqual(NOTHING);
    });

    it("returns the passenger's booked trip once its bus has started it", async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { status, body } = await ongoing(session(PASSENGER_A));

        expect(status).toBe(200);
        expect(body.ongoing).toBe(true);
        expect(body.journeys).toHaveLength(1);

        const [journey] = body.journeys;
        expect(journey.booking).toMatchObject({
            bookingId: 'BK-A',
            tripId: 'TRIP-00004',
            routeId: '177_KADUWELA_KOLLUPITIYA',
            journey: { routeNumber: '177', startLocation: 'Kaduwela', endLocation: 'Kollupitiya', departureTime: '06:00' },
        });
        expect(journey.activeJourney).toEqual({
            tripId: 'TRIP-00004',
            startedAt: STARTED_AT,
            expiresAt: minutesAgo(-120),
        });
        expect(journey.busId).toBe('BUS-8899');
    });

    it('never returns another trip of the same route that is running (Passenger B)', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await ongoing(session(PASSENGER_B));

        expect(body).toEqual(NOTHING);
    });

    it('does not treat a future (not yet started) booking as ongoing', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({ bookings: [booking('BK-FUTURE', PASSENGER_A, 'TRIP-00005', 'BUS-7777')] })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body).toEqual(NOTHING);
    });

    it('does not return a journey that was ended', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                trips: [
                    trip('TRIP-00004', 'BUS-8899', {
                        journey: { ...startedJourney('BUS-8899'), status: 'ENDED', endedAt: minutesAgo(5) },
                    }),
                ],
            })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body).toEqual(NOTHING);
    });

    it('does not return a journey past its scheduled arrival + grace, however recently it started', async () => {
        const overdue = { ...startedJourney('BUS-8899', minutesAgo(30)), expiresAt: minutesAgo(1) };
        mockGetAdminDb.mockReturnValue(seed({ trips: [trip('TRIP-00004', 'BUS-8899', { journey: overdue })] }));

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body).toEqual(NOTHING);
    });

    it('does not return a booking already used on an earlier run of the trip', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                bookings: [
                    booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899', {
                        boardingStatus: 'BOARDED',
                        boardedAt: minutesAgo(26 * 60),
                    }),
                ],
            })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body).toEqual(NOTHING);
    });

    it('still returns a booking boarded on this run', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                bookings: [
                    booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899', {
                        boardingStatus: 'BOARDED',
                        boardedAt: minutesAgo(20),
                    }),
                ],
            })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(bookingIds(body)).toEqual(['BK-A']);
    });

    it('does not return a cancelled booking on the running trip', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({ bookings: [booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899', { status: 'CANCELLED' })] })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body).toEqual(NOTHING);
    });

    it('returns only the booking whose trip is running among several', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                bookings: [
                    booking('BK-OLD', PASSENGER_A, 'TRIP-00005', 'BUS-7777'),
                    booking('BK-A', PASSENGER_A, 'TRIP-00004', 'BUS-8899'),
                    booking('BK-CANCELLED', PASSENGER_A, 'TRIP-00004', 'BUS-8899', { status: 'CANCELLED' }),
                    booking('BK-MISSING-TRIP', PASSENGER_A, 'TRIP-GONE', 'BUS-8899'),
                    booking('BK-B', PASSENGER_B, 'TRIP-00004', 'BUS-8899'),
                ],
            })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(bookingIds(body)).toEqual(['BK-A']);
    });

    it('skips missing or malformed trip data without failing', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                trips: [trip('TRIP-BAD', 'BUS-8899', { journey: { status: 'STARTED', startedAt: 'not-a-date', endedAt: null } })],
                bookings: [
                    booking('BK-MISSING-TRIP', PASSENGER_A, 'TRIP-GONE', 'BUS-8899'),
                    booking('BK-BAD-JOURNEY', PASSENGER_A, 'TRIP-BAD', 'BUS-8899'),
                    booking('BK-NO-TRIP', PASSENGER_A, '', 'BUS-8899'),
                ],
            })
        );

        const { status, body } = await ongoing(session(PASSENGER_A));

        expect(status).toBe(200);
        expect(body).toEqual(NOTHING);
    });

    it('reports a database failure as an error without leaking its detail', async () => {
        mockGetAdminDb.mockReturnValue({
            collection: () => ({
                where: () => ({
                    get: async () => {
                        throw new Error('PERMISSION_DENIED: internal detail');
                    },
                }),
            }),
        });
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        const { status, body } = await ongoing(session(PASSENGER_A));

        expect(status).toBe(500);
        expect(body).toEqual({ success: false, message: 'Failed to retrieve your ongoing journey.' });
        consoleError.mockRestore();
    });
});

describe('GET /api/journeys/ongoing — live location', () => {
    it("returns the bus's position when it was reported for this trip", async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body.journeys[0].liveStatus).toEqual({
            available: true,
            location: { busId: 'BUS-8899', latitude: 6.9271, longitude: 79.8612, recordedAt: minutesAgo(1) },
            locationAgeSeconds: expect.any(Number),
        });
    });

    it('returns the journey without a position when the bus has not reported', async () => {
        mockGetAdminDb.mockReturnValue(seed({ vehicleLocations: [] }));

        const { body } = await ongoing(session(PASSENGER_A));

        expect(bookingIds(body)).toEqual(['BK-A']);
        expect(body.journeys[0].liveStatus).toEqual({
            available: false,
            message: 'Live location is not available for this vehicle yet.',
        });
    });

    it("never shows a fix left over from the bus's previous trip, or one sent outside a journey", async () => {
        for (const fix of [
            { id: 'BUS-8899', busId: 'BUS-8899', latitude: 6.9, longitude: 79.9, recordedAt: minutesAgo(40), tripId: 'TRIP-00003' },
            { id: 'BUS-8899', busId: 'BUS-8899', latitude: 6.9, longitude: 79.9, recordedAt: minutesAgo(1) },
        ]) {
            mockGetAdminDb.mockReturnValue(seed({ vehicleLocations: [fix] }));

            const { body } = await ongoing(session(PASSENGER_A));

            expect(bookingIds(body)).toEqual(['BK-A']);
            expect(body.journeys[0].liveStatus.available).toBe(false);
            expect(body.journeys[0].liveStatus.location).toBeUndefined();
        }
    });

    it('keeps the journey ongoing when its position is old, and reports the age', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                vehicleLocations: [
                    { id: 'BUS-8899', busId: 'BUS-8899', latitude: 6.9, longitude: 79.9, recordedAt: minutesAgo(25), tripId: 'TRIP-00004', journeyStartedAt: STARTED_AT },
                ],
            })
        );

        const { body } = await ongoing(session(PASSENGER_A));

        expect(body.ongoing).toBe(true);
        expect(body.journeys[0].liveStatus.available).toBe(true);
        expect(body.journeys[0].liveStatus.locationAgeSeconds).toBeGreaterThanOrEqual(25 * 60);
    });
});

describe('PUT /api/buses/:busId/location — trip stamping', () => {
    function put(account: unknown, body: Record<string, unknown>) {
        mockVerifyToken.mockResolvedValue(account);
        return reportLocation(
            new Request('http://localhost/api/buses/BUS-8899/location', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
                body: JSON.stringify(body),
            }),
            { params: { busId: 'BUS-8899' } }
        );
    }

    const fix = { latitude: 6.93, longitude: 79.86, recordedAt: '2026-09-21T01:00:00.000Z' };

    it('stores the trip named by the journey-sharing credential', async () => {
        const db = seed({ vehicleLocations: [] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await put(
            session('BUS-8899', { role: 'BUS', busId: 'BUS-8899', scope: 'JOURNEY_LOCATION', tripId: 'TRIP-00004' }),
            { ...fix, tripId: 'TRIP-00005' }
        );
        const stored = (await db.collection('vehicleLocations').doc('BUS-8899').get()).data();

        expect(response.status).toBe(200);
        // The signed claim wins; the body's tripId is never trusted.
        expect(stored).toMatchObject({ busId: 'BUS-8899', tripId: 'TRIP-00004', journeyStartedAt: STARTED_AT });
    });

    it('stores no trip for a session that is not a journey-sharing credential', async () => {
        const db = seed({ vehicleLocations: [] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await put(session('BUS-8899', { role: 'BUS', busId: 'BUS-8899' }), {
            ...fix,
            tripId: 'TRIP-00004',
        });
        const stored = (await db.collection('vehicleLocations').doc('BUS-8899').get()).data();

        expect(response.status).toBe(200);
        expect(stored).toBeDefined();
        expect(stored?.tripId).toBeUndefined();
    });
});
