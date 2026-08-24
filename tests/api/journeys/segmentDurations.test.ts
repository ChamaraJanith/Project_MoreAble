// Stop-to-stop timings on the way to a passenger screen (MOV-88).
//
// MOV-88 needed a figure the project could not previously produce: how long a
// passenger boarding partway along a route actually travels for. Everything
// stored before it — a route's `estimatedDuration`, a trip's departure and
// arrival times — describes the WHOLE route, so a new field was added to carry
// real travelling minutes between consecutive stops.
//
// This file covers the retrieval half: that the search response carries those
// timings, aligned to the stop list a consumer will read them against, and that
// nothing about the route-level values it already returned has changed. The
// arithmetic that turns them into a journey duration is not repeated here — it
// belongs to `journeyTiming.test.ts` and to the passenger screens.
//
// No credential, session value or authentication data appears here. Journey
// search needs none, so none is fabricated.

import { normalizeSegmentDurations, POST } from '../../../app/api/journeys/search+api';
import { POST as createRoute } from '../../../app/api/routes/index+api';
import { toRecommendedJourneys } from '../../../src/features/journey/utils/journeyRecommendations';
import { Bus } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// Fixtures
//
//   Kaduwela --8m--> Malabe --6m--> Battaramulla --12m--> Rajagiriya --15m--> Borella --? --> Kollupitiya
// ------------------------------------------------------------------
const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';

const STOPS = [
    'Kaduwela',
    'Malabe',
    'Battaramulla',
    'Rajagiriya',
    'Borella',
    'Kollupitiya',
];

const SEGMENTS = [8, 6, 12, 15, 9];

function route(overrides: Partial<Route> = {}): Route & { id: string } {
    return {
        id: ROUTE_ID,
        routeId: ROUTE_ID,
        routeNumber: '177',
        routeName: 'Kaduwela - Kollupitiya',
        startLocation: 'Kaduwela',
        endLocation: 'Kollupitiya',
        stops: STOPS,
        distanceKm: 22.5,
        estimatedDuration: '1h 15m',
        segmentDurationsMinutes: SEGMENTS,
        status: 'ACTIVE',
        ...overrides,
    };
}

const bus: Bus & { id: string } = {
    id: 'BUS-00001',
    busId: 'BUS-00001',
    numberPlate: 'NB-1234',
    chassisNumber: 'CHS-BUS-00001',
    busModel: 'Ashok Leyland Viking',
    manufacturer: 'Ashok Leyland',
    manufactureYear: 2025,
    seatCapacity: 54,
    accessibilityFacilities: {
        wheelchairRamp: true,
        audioAnnouncement: true,
        lowFloorVehicle: true,
        walkingAssistance: true,
        wheelchairSpace: { available: true, count: 2 },
        guardianSeats: { available: true, count: 2 },
        prioritySeats: { available: true, count: 4 },
        elderlySeats: { available: true, count: 4 },
    },
    status: 'ACTIVE',
};

const trip: Trip & { id: string } = {
    id: 'TRIP-00001',
    tripId: 'TRIP-00001',
    routeId: ROUTE_ID,
    busId: 'BUS-00001',
    departureTime: '09:00',
    estimatedArrivalTime: '10:10',
    turnNumber: 1,
    status: 'ACTIVE',
};

function buildRequest(body: unknown): Request {
    return new Request('http://localhost/api/journeys/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** Runs the real endpoint, optionally for a mid-route pair of stops. */
async function search(
    stored: Route & { id: string },
    criteria: { origin?: string; destination?: string } = {}
): Promise<any> {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({ routes: [stored], buses: [bus], trips: [trip] })
    );

    const response = await POST(
        buildRequest({
            origin: criteria.origin ?? 'Kaduwela',
            destination: criteria.destination ?? 'Borella',
            travelDate: '2026-08-20',
            travelTime: '08:00',
        })
    );

    return response.json();
}

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
});

// ==================================================================
// A. THE TIMINGS REACH THE PASSENGER SCREEN
// ==================================================================
describe('the search response carries the route stop-to-stop timings', () => {
    it('returns them for a matched route', async () => {
        const matched = (await search(route())).routes[0];

        expect(matched.segmentDurationsMinutes).toEqual(SEGMENTS);
    });

    it('returns them aligned to the full stop list, not to the stops travelled', async () => {
        // A Malabe -> Borella search travels four of the six stops, but the
        // timings still describe every gap on the route. That is deliberate: the
        // passenger's boarding time depends on the gaps BEFORE they board, which
        // `journeyStops` excludes.
        const matched = (await search(route(), { origin: 'Malabe' })).routes[0];

        expect(matched.journeyStops).toEqual([
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
        ]);
        expect(matched.segmentDurationsMinutes).toHaveLength(matched.stops.length - 1);
        expect(matched.segmentDurationsMinutes).toEqual(SEGMENTS);
    });

    it('reports a route the operator has not timed as untimed', async () => {
        const matched = (
            await search(route({ segmentDurationsMinutes: null }))
        ).routes[0];

        expect(matched.segmentDurationsMinutes).toBeNull();
    });

    it('reports a route saved before the field existed as untimed', async () => {
        const stored = route();
        delete (stored as Partial<Route>).segmentDurationsMinutes;

        const matched = (await search(stored)).routes[0];

        expect(matched.segmentDurationsMinutes).toBeNull();
    });
});

// ==================================================================
// B. MALFORMED STORED DATA CANNOT BECOME A WRONG TIME
//
// Firestore is schema-less, so a stored value can be anything. An entry that
// cannot be trusted must arrive as "not timed" — never as zero minutes, which
// would read as an instant hop between two stops.
// ==================================================================
describe('normalizeSegmentDurations', () => {
    it('keeps usable timings as they are', () => {
        expect(normalizeSegmentDurations([8, 6, 12, 15], 5)).toEqual([8, 6, 12, 15]);
    });

    it('accepts a genuine zero, which is a measurement', () => {
        expect(normalizeSegmentDurations([0, 6], 3)).toEqual([0, 6]);
    });

    it('turns an unusable entry into an untimed gap rather than into zero', () => {
        expect(normalizeSegmentDurations([8, '6', -3, Number.NaN], 5)).toEqual([
            8,
            null,
            null,
            null,
        ]);
    });

    it('pads a short list so an entry can never be read against the wrong stops', () => {
        expect(normalizeSegmentDurations([8, 6], 5)).toEqual([8, 6, null, null]);
    });

    it('drops entries beyond the number of gaps between stops', () => {
        expect(normalizeSegmentDurations([8, 6, 12, 15, 9, 4], 4)).toEqual([8, 6, 12]);
    });

    it('reports nothing usable as untimed rather than as a row of nulls', () => {
        expect(normalizeSegmentDurations([null, null], 3)).toBeNull();
        expect(normalizeSegmentDurations(['a', 'b'], 3)).toBeNull();
        expect(normalizeSegmentDurations([], 3)).toBeNull();
        expect(normalizeSegmentDurations(undefined, 3)).toBeNull();
        expect(normalizeSegmentDurations(null, 3)).toBeNull();
        expect(normalizeSegmentDurations('8,6', 3)).toBeNull();
        expect(normalizeSegmentDurations([8, 6], 1)).toBeNull();
    });
});

// ==================================================================
// C. THE ROUTE-LEVEL VALUES ARE UNCHANGED
//
// MOV-88 adds a passenger-journey duration; it does not redefine any existing
// one. `estimatedDuration` and a trip's stored times still describe the whole
// route, because the admin route list, admin route details and admin trip
// details all read them that way.
// ==================================================================
describe('nothing about the existing route-level data changed', () => {
    it('still returns the route own estimated duration verbatim', async () => {
        const matched = (await search(route())).routes[0];

        expect(matched.estimatedDuration).toBe('1h 15m');
    });

    it('still returns the trip scheduled times unmodified', async () => {
        const departure = (await search(route())).routes[0].trips[0].trip;

        expect(departure.departureTime).toBe('09:00');
        expect(departure.estimatedArrivalTime).toBe('10:10');
    });

    it('leaves the scheduled times alone for a mid-route search too', async () => {
        // The passenger-specific times are worked out on the screen, from these
        // values plus the timings — the response never rewrites them.
        const matched = (await search(route(), { origin: 'Malabe' })).routes[0];

        expect(matched.trips[0].trip.departureTime).toBe('09:00');
        expect(matched.trips[0].trip.estimatedArrivalTime).toBe('10:10');
        expect(matched.estimatedDuration).toBe('1h 15m');
    });

    it('still returns the stop list, journey stops and distance as before', async () => {
        const matched = (await search(route(), { origin: 'Malabe' })).routes[0];

        expect(matched.stops).toEqual(STOPS);
        expect(matched.journeyStops).toEqual([
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
        ]);
        expect(matched.distanceKm).toBe(22.5);
    });

    it('still carries the accessibility score for the ranking layer', async () => {
        const option = (await search(route())).routes[0].trips[0];

        expect(typeof option.bus.accessibilityScore).toBe('number');
    });
});


// ==================================================================
// D. WHAT AN OPERATOR SAVES IS WHAT A PASSENGER IS MEASURED BY
//
// The timings are useless if they cannot make the trip from the admin form to a
// passenger screen. This drives the real create endpoint and then the real
// search against the same store, so the whole path is covered rather than each
// end of it separately.
// ==================================================================
describe('timings entered by an operator reach the passenger', () => {
    it('measures a partial journey from timings saved through the routes API', async () => {
        const db = createFakeFirestore({ routes: [], buses: [bus], trips: [trip], stops: [] });
        mockGetAdminDb.mockReturnValue(db);

        const created = await createRoute(
            new Request('http://localhost/api/routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routeId: ROUTE_ID,
                    routeNumber: '177',
                    routeName: 'Kaduwela - Kollupitiya',
                    direction: 'OUTBOUND',
                    startLocation: 'Kaduwela',
                    endLocation: 'Kollupitiya',
                    startStopId: 'kaduwela',
                    endStopId: 'kollupitiya',
                    stops: STOPS,
                    distanceKm: 20,
                    estimatedDuration: '1h 15m',
                    segmentDurationsMinutes: SEGMENTS,
                    status: 'ACTIVE',
                }),
            })
        );

        expect(created.status).toBe(201);

        // Same store, now read back through the passenger's own path.
        mockGetAdminDb.mockReturnValue(db);

        const response = await POST(
            buildRequest({
                origin: 'Malabe',
                destination: 'Borella',
                travelDate: '2026-08-20',
                travelTime: '08:00',
            })
        );

        const json = await response.json();
        const [journey] = toRecommendedJourneys(json.routes ?? []);

        // 6 + 12 + 15, from the timings the operator just entered.
        expect(journey.timing.durationMinutes).toBe(33);
        expect(journey.display.durationLabel).toBe('33m');
    });
});
