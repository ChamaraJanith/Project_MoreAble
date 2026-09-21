// Securing the passenger's ongoing journey and live position (MOV-296).
//
// Only the verified passenger who booked the EXACT running trip may receive it,
// and only a position reported for that trip's CURRENT run:
//
//     verified PASSENGER session -> own CONFIRMED booking -> booking.tripId
//        -> running journey of that tripId -> fix stamped with tripId + run
//
// Nothing the client sends — passengerId, tripId, busId, routeId, in the URL,
// body or headers — changes whose journey, or which trip, comes back.
//
// `jose` is ESM-only under this project's CommonJS Jest, so, as in the other
// route tests, only verifyToken is stubbed. It returns null for a missing,
// malformed, expired or badly signed token; the route sees exactly that.

import { PUT as reportLocation } from '../../../app/api/buses/[busId]/location+api';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { authoriseOngoingJourneyAccess } from '../../../src/shared/server/ongoingJourneyAuthorization';
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

// ------------------------------------------------------------------
// Fixtures. Route 177, two buses, three trips:
//
//   TRIP-001  BUS-A  STARTED 30 min ago   <- the active journey
//   TRIP-002  BUS-A  not started          (same bus, same route, other turn)
//   TRIP-003  BUS-B  not started          (same route, other bus)
//
//   PASSENGER_A booked TRIP-001.
//   PASSENGER_B booked TRIP-002 (same bus + route as TRIP-001).
//   PASSENGER_C booked TRIP-003 (same route as TRIP-001).
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';
const PASSENGER_C = 'PAS-2026-00003';
const ROUTE = '177_KADUWELA_KOLLUPITIYA';

const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const STARTED_AT = minutesAgo(30);

const passenger = (passengerId: string) => ({
    uid: `uid-${passengerId}`,
    passengerId,
    role: 'PASSENGER',
    email: `${passengerId}@moreable.lk`,
});
const busSession = { uid: 'BUS-A', passengerId: 'BUS-A', role: 'BUS', email: '', busId: 'BUS-A' };
const sharingToken = { ...busSession, scope: 'JOURNEY_LOCATION', tripId: 'TRIP-001' };
const operator = { uid: 'uid-admin', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' };

function booking(bookingId: string, userId: string, tripId: string, busId: string, extra: Record<string, unknown> = {}) {
    return {
        bookingId,
        userId,
        passengerName: `Name of ${userId}`,
        tripId,
        routeId: ROUTE,
        busId,
        seatNumber: '05A',
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        boardingStatus: 'NOT_BOARDED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Kollupitiya',
            departureTime: '06:00',
            estimatedArrivalTime: '07:15',
        },
        vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
        qrPayload: JSON.stringify({ bookingId, tripId, seatNumber: '05A' }),
        fare: { distanceKm: 12, baseFare: 30, distanceFare: 60, totalFare: 90, currency: 'LKR', isEstimate: false },
        assistanceRequested: { wheelchairAssistance: true, boardingAssistance: true, walkingAssistance: false, prioritySeatAssistance: false },
        assistanceStatus: 'PENDING',
        specialRequests: 'Private note about my condition',
        guardianPhone: '+94770000000',
        createdAt: '2026-09-20T12:00:00.000Z',
        ...extra,
    };
}

const running = (busId: string, startedAt: string = STARTED_AT) => ({ status: 'STARTED', startedAt, endedAt: null, busId });

const fixForRun = (extra: Record<string, unknown> = {}) => ({
    id: 'BUS-A',
    busId: 'BUS-A',
    latitude: 6.9271,
    longitude: 79.8612,
    recordedAt: minutesAgo(1),
    tripId: 'TRIP-001',
    journeyStartedAt: STARTED_AT,
    ...extra,
});

function seed(overrides: Record<string, any[]> = {}) {
    return createFakeFirestore({
        trips: [
            { id: 'TRIP-001', tripId: 'TRIP-001', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', journey: running('BUS-A') },
            { id: 'TRIP-002', tripId: 'TRIP-002', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE' },
            { id: 'TRIP-003', tripId: 'TRIP-003', routeId: ROUTE, busId: 'BUS-B', status: 'ACTIVE' },
        ],
        bookings: [
            booking('BK-A', PASSENGER_A, 'TRIP-001', 'BUS-A'),
            booking('BK-B', PASSENGER_B, 'TRIP-002', 'BUS-A'),
            booking('BK-C', PASSENGER_C, 'TRIP-003', 'BUS-B'),
        ],
        vehicleLocations: [fixForRun()],
        buses: [{ busId: 'BUS-A' }, { busId: 'BUS-B' }],
        ...overrides,
    });
}

async function request(
    account: unknown,
    { query = '', headers = {}, authorization = 'Bearer test-token' }: { query?: string; headers?: Record<string, string>; authorization?: string | null } = {}
) {
    mockVerifyToken.mockResolvedValue(account);
    const response = await getOngoing(
        new Request(`http://localhost/api/journeys/ongoing${query}`, {
            headers: { ...(authorization ? { Authorization: authorization } : {}), ...headers },
        })
    );
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
}

const bookingIds = (body: any) => (body.journeys ?? []).map((journey: any) => journey.booking.bookingId);

const NOTHING = { success: true, message: 'No ongoing journey.', ongoing: false, journeys: [] };

beforeEach(() => {
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
    mockGetAdminDb.mockReturnValue(seed());
});

// ------------------------------------------------------------------
describe('authentication', () => {
    it('refuses a request with no token, before touching the database', async () => {
        const { status, body } = await request(null, { authorization: null });

        expect(status).toBe(401);
        expect(body).toEqual({ success: false, message: 'Authentication required.' });
        expect(mockVerifyToken).not.toHaveBeenCalled();
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses a non-Bearer Authorization header', async () => {
        const { status } = await request(passenger(PASSENGER_A), { authorization: 'Basic abc' });

        expect(status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid', 'Bearer not-a-jwt'],
        ['expired', 'Bearer expired.jwt.token'],
        ['tampered', 'Bearer header.payload.badsignature'],
    ])('refuses an %s token with a fixed message', async (_label, header) => {
        // verifyToken yields null for every one of these (jose throws, it catches).
        const { status, body, text } = await request(null, { authorization: header });

        expect(status).toBe(401);
        expect(body).toEqual({ success: false, message: 'Authentication required.' });
        expect(text).not.toContain(header.slice(7));
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('allows a valid passenger session', async () => {
        const { status, body } = await request(passenger(PASSENGER_A));

        expect(status).toBe(200);
        expect(bookingIds(body)).toEqual(['BK-A']);
    });
});

// ------------------------------------------------------------------
describe('session type', () => {
    it.each([
        ['bus/device session', busSession],
        ['journey-sharing credential', sharingToken],
        ['operator (admin) session', operator],
        ['session with no role', { ...passenger(PASSENGER_A), role: '' }],
        ['passenger role carrying a bus claim', { ...passenger(PASSENGER_A), busId: 'BUS-A' }],
        ['passenger role carrying a scope', { ...passenger(PASSENGER_A), scope: 'JOURNEY_LOCATION' }],
    ])('refuses a %s with 403 and no data', async (_label, account) => {
        const { status, body } = await request(account);

        expect(status).toBe(403);
        expect(body).toEqual({ success: false, message: 'Only a passenger account has ongoing journeys.' });
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it.each([['' ], ['   '], ['GUEST']])('refuses a passenger session whose passengerId is %p', async (passengerId) => {
        const { status, body } = await request({ ...passenger(PASSENGER_A), passengerId });

        expect(status).toBe(403);
        expect(body.journeys).toBeUndefined();
    });

    it('decides from the verified claims only', () => {
        expect(authoriseOngoingJourneyAccess(null)).toEqual({ allowed: false, status: 401, message: 'Authentication required.' });
        expect(authoriseOngoingJourneyAccess(passenger(` ${PASSENGER_A} `))).toEqual({ allowed: true, passengerId: PASSENGER_A });
    });
});

// ------------------------------------------------------------------
describe('passengerId tampering', () => {
    it('evaluates as the session passenger whatever passengerId the URL names', async () => {
        const asA = await request(passenger(PASSENGER_A), { query: `?passengerId=${PASSENGER_B}&userId=${PASSENGER_B}` });
        const asB = await request(passenger(PASSENGER_B), { query: `?passengerId=${PASSENGER_A}&userId=${PASSENGER_A}` });

        expect(bookingIds(asA.body)).toEqual(['BK-A']);
        expect(asB.body).toEqual(NOTHING);
    });

    it('ignores identity supplied in custom headers', async () => {
        const { body } = await request(passenger(PASSENGER_B), {
            headers: { 'X-Passenger-Id': PASSENGER_A, 'X-User-Id': PASSENGER_A },
        });

        expect(body).toEqual(NOTHING);
    });

    it('never returns a journey whose booking belongs to someone else', async () => {
        // Even a (hypothetically) mis-indexed query result is filtered by owner.
        const db = seed();
        const realCollection = db.collection;
        (db as any).collection = (name: string) => {
            const collection = realCollection(name);
            if (name !== 'bookings') return collection;
            return { ...collection, where: () => realCollection('bookings') };
        };
        mockGetAdminDb.mockReturnValue(db);

        const { body } = await request(passenger(PASSENGER_B));

        expect(body).toEqual(NOTHING);
    });
});

// ------------------------------------------------------------------
describe('exact trip authorisation', () => {
    it('allows the passenger who booked the active trip', async () => {
        const { body } = await request(passenger(PASSENGER_A));

        expect(body.ongoing).toBe(true);
        expect(body.journeys[0].activeJourney.tripId).toBe('TRIP-001');
        expect(body.journeys[0].booking.tripId).toBe('TRIP-001');
    });

    it('refuses a passenger with no booking on the active trip', async () => {
        const { body } = await request(passenger('PAS-2026-00099'));

        expect(body).toEqual(NOTHING);
    });

    it('refuses a passenger booked on another trip of the same route', async () => {
        const { body, text } = await request(passenger(PASSENGER_C));

        expect(body).toEqual(NOTHING);
        expect(text).not.toContain('TRIP-001');
    });

    it('refuses a passenger booked on another trip of the same bus', async () => {
        const { body, text } = await request(passenger(PASSENGER_B));

        expect(body).toEqual(NOTHING);
        expect(text).not.toContain('TRIP-001');
        expect(text).not.toContain('79.8612');
    });

    it('ignores a tripId, busId or routeId supplied by the client', async () => {
        const { body, text } = await request(passenger(PASSENGER_B), {
            query: '?tripId=TRIP-001&busId=BUS-A&routeId=' + ROUTE,
        });

        expect(body).toEqual(NOTHING);
        expect(text).not.toContain('79.8612');
    });

    it("returns only the passenger's own trip even when asked for another", async () => {
        const { body } = await request(passenger(PASSENGER_A), { query: '?tripId=TRIP-003' });

        expect(body.journeys.map((journey: any) => journey.activeJourney.tripId)).toEqual(['TRIP-001']);
    });

    it('refuses a cancelled booking on the active trip', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({ bookings: [booking('BK-A', PASSENGER_A, 'TRIP-001', 'BUS-A', { status: 'CANCELLED' })] })
        );

        const { body } = await request(passenger(PASSENGER_A));

        expect(body).toEqual(NOTHING);
    });
});

// ------------------------------------------------------------------
describe('live location', () => {
    it('returns the position when it was reported for this trip and run', async () => {
        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].liveStatus).toEqual({
            available: true,
            location: { busId: 'BUS-A', latitude: 6.9271, longitude: 79.8612, recordedAt: minutesAgo(1) },
            locationAgeSeconds: expect.any(Number),
        });
    });

    it.each([
        ['another trip of the same bus', fixForRun({ tripId: 'TRIP-002' })],
        ['no trip at all (sent outside a journey)', fixForRun({ tripId: undefined, journeyStartedAt: undefined })],
        ['an earlier run of the same trip', fixForRun({ recordedAt: minutesAgo(24 * 60), journeyStartedAt: minutesAgo(25 * 60) })],
        ['the right trip but no run stamp', fixForRun({ journeyStartedAt: undefined })],
    ])('never exposes a fix from %s', async (_label, fix) => {
        mockGetAdminDb.mockReturnValue(seed({ vehicleLocations: [fix] }));

        const { body, text } = await request(passenger(PASSENGER_A));

        expect(bookingIds(body)).toEqual(['BK-A']);
        expect(body.journeys[0].liveStatus).toEqual({
            available: false,
            message: 'Live location is not available for this vehicle yet.',
        });
        expect(text).not.toContain(String(fix.latitude));
    });
});

// ------------------------------------------------------------------
describe('data minimisation', () => {
    it('returns only allow-listed booking fields', async () => {
        const { body, text } = await request(passenger(PASSENGER_A));

        expect(Object.keys(body.journeys[0].booking).sort()).toEqual(
            [
                'boardingStatus',
                'bookingId',
                'busId',
                'fare',
                'journey',
                'pairedSeatNumber',
                'routeId',
                'seatNumber',
                'status',
                'tripId',
                'userId',
                'vehicle',
            ].sort()
        );
        // MOV-297: the ticket price only, never its breakdown.
        expect(body.journeys[0].booking.fare).toEqual({ totalFare: 90, currency: 'LKR', isEstimate: false });
        for (const secret of [
            'qrPayload',
            'baseFare',
            'distanceFare',
            'distanceKm',
            'concession',
            'specialRequests',
            'Private note',
            'guardianPhone',
            '+9477',
            'assistance',
            'passengerName',
        ]) {
            expect(text).not.toContain(secret);
        }
        expect(Object.keys(body.journeys[0].liveStatus.location).sort()).toEqual(
            ['busId', 'latitude', 'longitude', 'recordedAt'].sort()
        );
    });

    it("contains no other passenger's booking or journey", async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                bookings: [
                    booking('BK-A', PASSENGER_A, 'TRIP-001', 'BUS-A'),
                    booking('BK-A-FUTURE', PASSENGER_A, 'TRIP-002', 'BUS-A'),
                    booking('BK-B-SAME-TRIP', PASSENGER_B, 'TRIP-001', 'BUS-A'),
                    booking('BK-C', PASSENGER_C, 'TRIP-003', 'BUS-B'),
                ],
            })
        );

        const { body, text } = await request(passenger(PASSENGER_A));

        expect(bookingIds(body)).toEqual(['BK-A']);
        for (const other of ['BK-A-FUTURE', 'BK-B-SAME-TRIP', 'BK-C', PASSENGER_B, PASSENGER_C]) {
            expect(text).not.toContain(other);
        }
    });

    it('never echoes an internal error, token or secret', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockGetAdminDb.mockReturnValue({
            collection: () => ({
                where: () => ({
                    get: async () => {
                        throw new Error('FIRESTORE PERMISSION_DENIED private_key=-----BEGIN PRIVATE KEY-----');
                    },
                }),
            }),
        });

        const { status, body, text } = await request(passenger(PASSENGER_A), { authorization: 'Bearer secret-token-value' });

        expect(status).toBe(500);
        expect(body).toEqual({ success: false, message: 'Failed to retrieve your ongoing journey.' });
        for (const leak of ['PERMISSION_DENIED', 'PRIVATE KEY', 'secret-token-value', 'stack', 'at ']) {
            expect(text).not.toContain(leak);
        }
        consoleError.mockRestore();
    });
});

// ------------------------------------------------------------------
describe('location write: which run a fix belongs to', () => {
    const fix = { latitude: 6.93, longitude: 79.86, recordedAt: '2026-09-21T01:00:00.000Z' };

    async function put(account: unknown, db: ReturnType<typeof createFakeFirestore>) {
        mockGetAdminDb.mockReturnValue(db);
        mockVerifyToken.mockResolvedValue(account);
        const response = await reportLocation(
            new Request('http://localhost/api/buses/BUS-A/location', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
                body: JSON.stringify({ ...fix, tripId: 'TRIP-002', journeyStartedAt: '2000-01-01T00:00:00.000Z' }),
            }),
            { params: { busId: 'BUS-A' } }
        );
        return { status: response.status, stored: (await db.collection('vehicleLocations').doc('BUS-A').get()).data() };
    }

    it("stamps the running journey's trip and server start, never the body's", async () => {
        const { status, stored } = await put(sharingToken, seed({ vehicleLocations: [] }));

        expect(status).toBe(200);
        expect(stored).toMatchObject({ tripId: 'TRIP-001', journeyStartedAt: STARTED_AT });
    });

    it('stamps nothing once that journey has ended', async () => {
        const db = seed({
            vehicleLocations: [],
            trips: [
                {
                    id: 'TRIP-001',
                    tripId: 'TRIP-001',
                    busId: 'BUS-A',
                    journey: { ...running('BUS-A'), status: 'ENDED', endedAt: minutesAgo(1) },
                },
            ],
        });

        const { status, stored } = await put(sharingToken, db);

        expect(status).toBe(200);
        expect(stored?.tripId).toBeUndefined();
        expect(stored?.journeyStartedAt).toBeUndefined();
    });

    it('stamps nothing when the running journey belongs to another bus', async () => {
        const db = seed({
            vehicleLocations: [],
            trips: [{ id: 'TRIP-001', tripId: 'TRIP-001', busId: 'BUS-A', journey: running('BUS-B') }],
        });

        const { stored } = await put(sharingToken, db);

        expect(stored?.tripId).toBeUndefined();
    });

    it('stamps nothing for an ordinary bus session', async () => {
        const { stored } = await put(busSession, seed({ vehicleLocations: [] }));

        expect(stored?.tripId).toBeUndefined();
        expect(stored?.journeyStartedAt).toBeUndefined();
    });
});
