// Booking history enrichment (MOV-294).
//
// With `include=liveSharing`, each of a passenger's bookings is resolved
// through its OWN trip to two facts:
//
//   liveSharing   — whether the bus running that trip has a stored position
//                   (kept for live tracking, MOV-297; no coordinates)
//   activeJourney — whether that trip's journey was started and is running
//                   (what Activities > Ongoing is decided by)
//
// Both are matched trip -> trips/{tripId} -> bus, never by route. The journey
// lifecycle itself is covered end to end in tripJourney+api.route.test.ts.

import { GET as getHistory } from '../../../app/api/booking/history+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// ------------------------------------------------------------------
// Fixtures: route 177 is run by two buses on two trips.
//
//   TRIP-A -> BUS-A    booked by PASSENGER_A
//   TRIP-B -> BUS-B    booked by PASSENGER_B
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';

const NOW = new Date();
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function booking(bookingId: string, userId: string, tripId: string, busId: string, extra: Record<string, unknown> = {}) {
    return {
        bookingId,
        userId,
        passengerName: userId,
        tripId,
        routeId: 'ROUTE-177',
        busId,
        seatNumber: '05A',
        status: 'CONFIRMED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Rajagiriya',
            departureTime: '06:30',
            estimatedArrivalTime: '07:10',
        },
        vehicle: { numberPlate: `NB-${busId}`, busModel: 'Model', manufacturer: 'Maker' },
        createdAt: '2026-09-21T00:00:00.000Z',
        ...extra,
    };
}

function seed(overrides: Record<string, any[]> = {}) {
    return createFakeFirestore({
        trips: [
            {
                tripId: 'TRIP-A',
                routeId: 'ROUTE-177',
                busId: 'BUS-A',
                journey: { status: 'STARTED', startedAt: minutesAgo(30), endedAt: null, busId: 'BUS-A' },
            },
            { tripId: 'TRIP-B', routeId: 'ROUTE-177', busId: 'BUS-B' },
        ],
        bookings: [
            booking('BK-A', PASSENGER_A, 'TRIP-A', 'BUS-A'),
            booking('BK-A-CANCELLED', PASSENGER_A, 'TRIP-A', 'BUS-A', { status: 'CANCELLED' }),
            booking('BK-B', PASSENGER_B, 'TRIP-B', 'BUS-B'),
        ],
        vehicleLocations: [{ busId: 'BUS-A', latitude: 6.9271, longitude: 79.8612, recordedAt: minutesAgo(1) }],
        users: [],
        ...overrides,
    });
}

async function history(query: string) {
    const response = await getHistory(new Request(`http://localhost/api/booking/history?${query}`));
    return { status: response.status, body: await response.json() };
}

const bookingIn = (body: any, bookingId: string) => body.bookings.find((b: any) => b.bookingId === bookingId);

beforeEach(() => {
    mockGetAdminDb.mockReset();
});

describe('GET /api/booking/history?include=liveSharing — activeJourney', () => {
    it("reports the running journey of the booking's own trip", async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(bookingIn(body, 'BK-A').activeJourney).toEqual({
            tripId: 'TRIP-A',
            startedAt: minutesAgo(30),
            expiresAt: new Date(new Date(minutesAgo(30)).getTime() + 23 * 60 * 60_000).toISOString(),
        });
    });

    it('reports nothing for a booking on another trip of the same route', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_B}&include=liveSharing`);

        expect(body.bookings.map((b: any) => b.bookingId)).toEqual(['BK-B']);
        expect(bookingIn(body, 'BK-B').activeJourney).toBeUndefined();
    });

    it('reports nothing once the journey has ended', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                trips: [
                    {
                        tripId: 'TRIP-A',
                        busId: 'BUS-A',
                        journey: { status: 'ENDED', startedAt: minutesAgo(30), endedAt: minutesAgo(5), busId: 'BUS-A' },
                    },
                ],
            })
        );

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(bookingIn(body, 'BK-A').activeJourney).toBeUndefined();
    });

    it('never attaches a journey to a cancelled booking', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(bookingIn(body, 'BK-A-CANCELLED').activeJourney).toBeUndefined();
        expect(bookingIn(body, 'BK-A-CANCELLED').liveSharing).toBeUndefined();
    });
});

describe('GET /api/booking/history?include=liveSharing — liveSharing', () => {
    it("resolves each booking to the bus running its own trip", async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const a = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);
        const b = await history(`passengerId=${PASSENGER_B}&include=liveSharing`);

        expect(bookingIn(a.body, 'BK-A').liveSharing).toMatchObject({ tripId: 'TRIP-A', busId: 'BUS-A', available: true });
        expect(bookingIn(b.body, 'BK-B').liveSharing).toEqual({ tripId: 'TRIP-B', busId: 'BUS-B', available: false });
    });

    it("follows the trip's current bus when the trip was reassigned after booking", async () => {
        mockGetAdminDb.mockReturnValue(seed({ bookings: [booking('BK-A', PASSENGER_A, 'TRIP-A', 'BUS-RETIRED')] }));

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(body.bookings[0].liveSharing).toMatchObject({ busId: 'BUS-A', available: true });
    });

    it('omits both blocks for a booking whose trip no longer exists', async () => {
        mockGetAdminDb.mockReturnValue(seed({ trips: [] }));

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(body.bookings.every((b: any) => b.liveSharing === undefined && b.activeJourney === undefined)).toBe(true);
    });

    it('never returns the bus coordinates', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);
        const sharing = bookingIn(body, 'BK-A').liveSharing;

        expect(sharing).not.toHaveProperty('latitude');
        expect(sharing).not.toHaveProperty('longitude');
        expect(sharing).not.toHaveProperty('location');
    });
});

describe('GET /api/booking/history without include', () => {
    it('returns bookings exactly as before for the Booking tab', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_A}`);

        expect(body.success).toBe(true);
        expect(body.bookings.every((b: any) => !('liveSharing' in b) && !('activeJourney' in b))).toBe(true);
    });

    it('ignores the include flag on the driver manifest (busId) query', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history('busId=BUS-A&include=liveSharing');

        expect(body.bookings.length).toBeGreaterThan(0);
        expect(body.bookings.every((b: any) => !('liveSharing' in b) && !('activeJourney' in b))).toBe(true);
    });
});
