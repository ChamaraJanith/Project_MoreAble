// The live journey screen's data (MOV-297).
//
// GET /api/journeys/ongoing?include=route adds each journey's planned path —
// the passenger's stops in travel order, their stored coordinates and the OSRM
// road through them — so the tracking map can draw the bus against its road.
// The booking gains only its ticket price.
//
// What must not change (MOV-296): who may ask, whose journey comes back, which
// trip it is, and which position counts as live. `include=route` names nothing;
// the route is derived from the running trip on the server.

import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { clearOngoingRoadCache } from '../../../src/shared/server/ongoingJourneyRoute';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();
const mockRouteThrough = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// The public OSRM server is never called from a test.
jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteThroughCoordinates: (waypoints: unknown) => mockRouteThrough(waypoints),
    getRouteBetweenCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// Route 177 outbound: six stops. Passenger A boards at Malabe and gets off at
// Rajagiriya, on TRIP-001, which BUS-A started 30 minutes ago.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';
const ROUTE = '177_KADUWELA_KOLLUPITIYA';
const OTHER_ROUTE = '138_HOMAGAMA_PETTAH';

const ROUTE_STOPS = ['Kaduwela', 'Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya', 'Kollupitiya'];

const STOPS = [
    { stopId: 'S1', name: 'Kaduwela', latitude: 6.9333, longitude: 79.9833 },
    { stopId: 'S2', name: 'Malabe', latitude: 6.9061, longitude: 79.9696 },
    { stopId: 'S3', name: 'Koswatta', latitude: 6.9076, longitude: 79.9281 },
    { stopId: 'S4', name: 'Battaramulla', latitude: 6.9022, longitude: 79.9181 },
    { stopId: 'S5', name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8943 },
    { stopId: 'S6', name: 'Kollupitiya', latitude: 6.9114, longitude: 79.8489 },
];

const ROAD = {
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
};

const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const STARTED_AT = minutesAgo(30);

const passenger = (passengerId: string) => ({
    uid: `uid-${passengerId}`,
    passengerId,
    role: 'PASSENGER',
    email: `${passengerId}@moreable.lk`,
});

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
            concessionDiscountPercent: 20,
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

const running = (busId: string) => ({ status: 'STARTED', startedAt: STARTED_AT, endedAt: null, busId });

function seed(overrides: Record<string, any[]> = {}) {
    return createFakeFirestore({
        trips: [
            { id: 'TRIP-001', tripId: 'TRIP-001', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE', journey: running('BUS-A') },
            { id: 'TRIP-002', tripId: 'TRIP-002', routeId: ROUTE, busId: 'BUS-A', status: 'ACTIVE' },
        ],
        routes: [
            {
                id: ROUTE,
                routeId: ROUTE,
                routeNumber: '177',
                stops: ROUTE_STOPS,
                segmentDurationsMinutes: [10, 12, 6, 9, 15],
            },
            { id: OTHER_ROUTE, routeId: OTHER_ROUTE, routeNumber: '138', stops: ['Homagama', 'Maharagama', 'Pettah'] },
        ],
        stops: STOPS,
        bookings: [booking('BK-A', PASSENGER_A, 'TRIP-001'), booking('BK-B', PASSENGER_B, 'TRIP-002')],
        vehicleLocations: [
            {
                id: 'BUS-A',
                busId: 'BUS-A',
                latitude: 6.9074,
                longitude: 79.94,
                recordedAt: minutesAgo(1),
                tripId: 'TRIP-001',
                journeyStartedAt: STARTED_AT,
            },
        ],
        ...overrides,
    });
}

async function request(account: unknown, query = '?include=route') {
    mockVerifyToken.mockResolvedValue(account);
    const headers: Record<string, string> = account ? { Authorization: 'Bearer test-token' } : {};
    const response = await getOngoing(new Request(`http://localhost/api/journeys/ongoing${query}`, { headers }));
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
}

const NOTHING = { success: true, message: 'No ongoing journey.', ongoing: false, journeys: [] };

beforeEach(() => {
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
    mockRouteThrough.mockReset();
    mockRouteThrough.mockResolvedValue(ROAD);
    mockGetAdminDb.mockReturnValue(seed());
    clearOngoingRoadCache();
});

// ------------------------------------------------------------------
describe('the planned path', () => {
    it('is left out unless the screen asks for it', async () => {
        const { body } = await request(passenger(PASSENGER_A), '');

        expect(body.journeys).toHaveLength(1);
        expect(body.journeys[0]).not.toHaveProperty('route');
        expect(mockRouteThrough).not.toHaveBeenCalled();
    });

    it("covers the passenger's own stops, boarding to alighting, in travel order", async () => {
        const { body } = await request(passenger(PASSENGER_A));
        const route = body.journeys[0].route;

        expect(route.journeyStops).toEqual(['Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya']);
        expect(route.stops).toEqual(ROUTE_STOPS);
        expect(route.segmentDurationsMinutes).toEqual([10, 12, 6, 9, 15]);
    });

    it('carries the stored coordinates of every journey stop, in the same order', async () => {
        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].route.stopPoints).toEqual([
            { name: 'Malabe', latitude: 6.9061, longitude: 79.9696 },
            { name: 'Koswatta', latitude: 6.9076, longitude: 79.9281 },
            { name: 'Battaramulla', latitude: 6.9022, longitude: 79.9181 },
            { name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8943 },
        ]);
    });

    it('asks the routing service for the road through those stops, in order', async () => {
        const { body } = await request(passenger(PASSENGER_A));

        expect(mockRouteThrough).toHaveBeenCalledTimes(1);
        expect(mockRouteThrough.mock.calls[0][0].map((point: any) => point.name)).toEqual([
            'Malabe',
            'Koswatta',
            'Battaramulla',
            'Rajagiriya',
        ]);
        expect(body.journeys[0].route.road).toEqual(ROAD);
    });

    it('does not ask for the same road again while it is cached', async () => {
        await request(passenger(PASSENGER_A));
        await request(passenger(PASSENGER_A));

        expect(mockRouteThrough).toHaveBeenCalledTimes(1);
    });

    it('leaves a stop without coordinates off the map but keeps it in the stop list', async () => {
        mockGetAdminDb.mockReturnValue(seed({ stops: STOPS.filter((stop) => stop.name !== 'Koswatta') }));

        const { body } = await request(passenger(PASSENGER_A));
        const route = body.journeys[0].route;

        expect(route.journeyStops).toContain('Koswatta');
        expect(route.stopPoints.map((point: any) => point.name)).toEqual(['Malabe', 'Battaramulla', 'Rajagiriya']);
    });

    it('reports no road, rather than a straight line, when routing fails', async () => {
        mockRouteThrough.mockResolvedValue(null);

        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].route.road).toBeNull();
        expect(body.journeys[0].route.stopPoints).toHaveLength(4);
    });

    it('keeps the journey and its live position when the route cannot be read', async () => {
        mockGetAdminDb.mockReturnValue(seed({ routes: [] }));

        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].route).toBeNull();
        expect(body.journeys[0].liveStatus.available).toBe(true);
    });

    it("takes the route from the running trip, not the booking's copy", async () => {
        mockGetAdminDb.mockReturnValue(
            seed({ bookings: [booking('BK-A', PASSENGER_A, 'TRIP-001', { routeId: OTHER_ROUTE })] })
        );

        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].route.stops).toEqual(ROUTE_STOPS);
    });

    it('sends only the path, with no booking or passenger data inside it', async () => {
        const { body } = await request(passenger(PASSENGER_A));

        expect(Object.keys(body.journeys[0].route).sort()).toEqual(
            ['journeyStops', 'road', 'segmentDurationsMinutes', 'stopPoints', 'stops'].sort()
        );
    });
});

// ------------------------------------------------------------------
describe('ticket price', () => {
    it('is the total only, never its breakdown', async () => {
        const { body, text } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].booking.fare).toEqual({ totalFare: 56, currency: 'LKR', isEstimate: false });
        for (const secret of ['baseFare', 'distanceFare', 'concession', 'ACCESSIBILITY', 'qrPayload', 'Private note', 'passengerName']) {
            expect(text).not.toContain(secret);
        }
    });

    it('is null when the booking carries no usable total', async () => {
        mockGetAdminDb.mockReturnValue(seed({ bookings: [booking('BK-A', PASSENGER_A, 'TRIP-001', { fare: { totalFare: 'free' } })] }));

        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].booking.fare).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('authorisation is unchanged by include=route (MOV-296 regression)', () => {
    it('still refuses an unauthenticated request before reading anything', async () => {
        const { status } = await request(null);

        expect(status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(mockRouteThrough).not.toHaveBeenCalled();
    });

    it('still refuses a non-passenger session', async () => {
        const { status } = await request({ uid: 'bus', busId: 'BUS-A', role: 'BUS' });

        expect(status).toBe(403);
        expect(mockRouteThrough).not.toHaveBeenCalled();
    });

    it('returns nothing, and routes nothing, for a passenger whose trip is not running', async () => {
        const { body } = await request(passenger(PASSENGER_B));

        expect(body).toEqual(NOTHING);
        expect(mockRouteThrough).not.toHaveBeenCalled();
    });

    it('ignores ids supplied alongside it', async () => {
        const { body, text } = await request(
            passenger(PASSENGER_B),
            `?include=route&passengerId=${PASSENGER_A}&tripId=TRIP-001&busId=BUS-A&routeId=${ROUTE}&bookingId=BK-A`
        );

        expect(body).toEqual(NOTHING);
        expect(text).not.toContain('BK-A');
    });

    it('still withholds a position left over from an earlier run', async () => {
        mockGetAdminDb.mockReturnValue(
            seed({
                vehicleLocations: [
                    {
                        id: 'BUS-A',
                        busId: 'BUS-A',
                        latitude: 6.9074,
                        longitude: 79.94,
                        recordedAt: minutesAgo(1),
                        tripId: 'TRIP-001',
                        journeyStartedAt: minutesAgo(600),
                    },
                ],
            })
        );

        const { body } = await request(passenger(PASSENGER_A));

        expect(body.journeys[0].liveStatus.available).toBe(false);
        expect(body.journeys[0].liveStatus).not.toHaveProperty('location');
        // The planned path is still there to show.
        expect(body.journeys[0].route.stopPoints).toHaveLength(4);
    });
});
