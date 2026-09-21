// Booking history with live sharing (MOV-294).
//
// The Activities screen asks the history endpoint, per booking, whether the bus
// operating that booking's own trip is sharing its location. This drives the
// real route over an in-memory Firestore with two buses on the same route, and
// checks the match is made trip -> bus -> vehicleLocations, never by route —
// and that a caller who does not ask gets the response it always did.

import { GET as getHistory } from '../../../app/api/booking/history+api';
import { groupActivities } from '../../../src/features/activities/utils/activityStatus';
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
const PASSENGER_NONE = 'PAS-2026-00003';

/** 21 Sep 2026, 06:45 local — during both trips' scheduled window. */
const DURING_TRIP = new Date(2026, 8, 21, 6, 45, 0, 0);

function journey(departureTime: string, estimatedArrivalTime: string) {
    return {
        routeNumber: '177',
        routeName: 'Kaduwela - Kollupitiya',
        startLocation: 'Kaduwela',
        endLocation: 'Rajagiriya',
        departureTime,
        estimatedArrivalTime,
    };
}

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
        boardingStatus: 'NOT_BOARDED',
        journey: journey('06:30', '07:10'),
        vehicle: { numberPlate: `NB-${busId}`, busModel: 'Model', manufacturer: 'Maker' },
        createdAt: '2026-09-21T00:00:00.000Z',
        ...extra,
    };
}

function location(busId: string, secondsAgo = 20) {
    return {
        busId,
        latitude: 6.9271,
        longitude: 79.8612,
        recordedAt: new Date(DURING_TRIP.getTime() - secondsAgo * 1000).toISOString(),
    };
}

function seed(overrides: Record<string, any[]> = {}) {
    return createFakeFirestore({
        trips: [
            { tripId: 'TRIP-A', routeId: 'ROUTE-177', busId: 'BUS-A', departureTime: '06:30', estimatedArrivalTime: '07:10' },
            { tripId: 'TRIP-B', routeId: 'ROUTE-177', busId: 'BUS-B', departureTime: '06:30', estimatedArrivalTime: '07:10' },
        ],
        bookings: [
            booking('BK-A', PASSENGER_A, 'TRIP-A', 'BUS-A'),
            booking('BK-A-CANCELLED', PASSENGER_A, 'TRIP-A', 'BUS-A', { status: 'CANCELLED' }),
            booking('BK-B', PASSENGER_B, 'TRIP-B', 'BUS-B'),
        ],
        // Only BUS-A has started sharing from the Bus Dashboard.
        vehicleLocations: [location('BUS-A')],
        users: [],
        ...overrides,
    });
}

async function history(query: string) {
    const response = await getHistory(new Request(`http://localhost/api/booking/history?${query}`));
    const body = await response.json();
    return { status: response.status, body };
}

async function activitiesFor(passengerId: string) {
    const { body } = await history(`passengerId=${passengerId}&include=liveSharing`);
    return groupActivities(body.bookings, passengerId, DURING_TRIP);
}

beforeEach(() => {
    mockGetAdminDb.mockReset();
});

describe('GET /api/booking/history?include=liveSharing', () => {
    it("resolves each booking to the bus running its own trip", async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { status, body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);
        const active = body.bookings.find((b: any) => b.bookingId === 'BK-A');

        expect(status).toBe(200);
        expect(active.liveSharing).toMatchObject({ tripId: 'TRIP-A', busId: 'BUS-A', available: true });
    });

    it('1. the passenger who booked the sharing trip sees it as ongoing', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const groups = await activitiesFor(PASSENGER_A);

        expect(groups.ongoing.map((b) => b.bookingId)).toEqual(['BK-A']);
    });

    it('2 & 4. a passenger on the same route but another trip does not see it', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_B}&include=liveSharing`);
        const groups = groupActivities(body.bookings, PASSENGER_B, DURING_TRIP);

        // Only their own booking comes back, described by their own bus.
        expect(body.bookings.map((b: any) => b.bookingId)).toEqual(['BK-B']);
        expect(body.bookings[0].liveSharing).toEqual({ tripId: 'TRIP-B', busId: 'BUS-B', available: false });
        expect(groups.ongoing).toEqual([]);
    });

    it('3. a passenger with no booking sees nothing', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        expect(await activitiesFor(PASSENGER_NONE)).toEqual({ ongoing: [], completed: [] });
    });

    it('5. is not ongoing while the booked bus has not shared its location', async () => {
        mockGetAdminDb.mockReturnValue(seed({ vehicleLocations: [] }));

        expect((await activitiesFor(PASSENGER_A)).ongoing).toEqual([]);
    });

    it('5. is not ongoing when the booked bus last reported long ago', async () => {
        mockGetAdminDb.mockReturnValue(seed({ vehicleLocations: [location('BUS-A', 60 * 60)] }));

        expect((await activitiesFor(PASSENGER_A)).ongoing).toEqual([]);
    });

    it('6. becomes ongoing once the matching bus starts sharing', async () => {
        const db = seed();
        mockGetAdminDb.mockReturnValue(db);

        expect((await activitiesFor(PASSENGER_B)).ongoing).toEqual([]);

        // BUS-B's driver starts sharing — the same write PUT /api/buses/:busId/location makes.
        await db.collection('vehicleLocations').doc('BUS-B').set(location('BUS-B'));

        expect((await activitiesFor(PASSENGER_B)).ongoing.map((b) => b.bookingId)).toEqual(['BK-B']);
    });

    it('7. never attaches live data to a cancelled booking', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);
        const cancelled = body.bookings.find((b: any) => b.bookingId === 'BK-A-CANCELLED');

        expect(cancelled.liveSharing).toBeUndefined();
        expect((await activitiesFor(PASSENGER_A)).ongoing.map((b) => b.bookingId)).not.toContain('BK-A-CANCELLED');
    });

    it("follows the trip's current bus when the trip was reassigned after booking", async () => {
        mockGetAdminDb.mockReturnValue(
            seed({ bookings: [booking('BK-A', PASSENGER_A, 'TRIP-A', 'BUS-RETIRED')] })
        );

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(body.bookings[0].liveSharing).toMatchObject({ busId: 'BUS-A', available: true });
    });

    it('omits live data for a booking whose trip no longer exists', async () => {
        mockGetAdminDb.mockReturnValue(seed({ trips: [] }));

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);

        expect(body.bookings.every((b: any) => b.liveSharing === undefined)).toBe(true);
    });

    it('never returns the bus coordinates', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history(`passengerId=${PASSENGER_A}&include=liveSharing`);
        const sharing = body.bookings.find((b: any) => b.bookingId === 'BK-A').liveSharing;

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
        expect(body.bookings.every((b: any) => !('liveSharing' in b))).toBe(true);
    });

    it('ignores the include flag on the driver manifest (busId) query', async () => {
        mockGetAdminDb.mockReturnValue(seed());

        const { body } = await history('busId=BUS-A&include=liveSharing');

        expect(body.bookings.length).toBeGreaterThan(0);
        expect(body.bookings.every((b: any) => !('liveSharing' in b))).toBe(true);
    });
});
