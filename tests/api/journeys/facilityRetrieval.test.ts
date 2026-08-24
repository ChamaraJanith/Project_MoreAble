// How the backend fetches a vehicle's accessibility facilities (MOV-108).
//
// The retrieval path itself already exists and is well covered: MOV-109's
// `facilityDatabase.test.ts` proves every stored facility reaches the passenger
// intact, MOV-89's `recommendedRouteData.test.ts` proves each departure gets its
// own vehicle's record, and MOV-105's `transportDatabase.test.ts` proves the
// admin write and the passenger read meet in the same database. None of that is
// repeated here.
//
// What none of them looks at is HOW the read happens. `loadBus` caches the
// in-flight promise per `busId` rather than its result, deliberately: a route's
// departures are resolved concurrently, so caching only on completion would let
// every trip on the same vehicle start its own identical Firestore read before
// the first one returned. That behaviour is invisible to every existing
// assertion — a regression that dropped the memo, keyed it wrongly, or cached
// after resolution would leave every response byte-identical and quietly
// multiply the reads a single search costs.
//
// So this file counts them. It also covers the two guards on the way in: a trip
// naming a vehicle that no longer exists, and a trip naming no usable vehicle at
// all, neither of which may reach Firestore with a bad document path or spoil
// the cache for the vehicles that are fine.
//
// Nothing here re-implements a facility rule or writes down a score. The fleet
// comes from the shared fixtures, and no credential value appears — this path
// needs none.

import { POST as search } from '../../../app/api/journeys/search+api';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    FULLY_EQUIPPED,
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    NOT_EQUIPPED,
    PARTLY_EQUIPPED,
} from '../../testUtils/journeyFixtures';

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

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

const ROUTE_MAIN = 'ROUTE-177';
const ROUTE_ALT = 'ROUTE-138';

const routeMain = makeRoute(ROUTE_MAIN, ['Kaduwela', 'Malabe', 'Battaramulla', 'Borella'], {
    routeNumber: '177',
    distanceKm: 20,
});

// A second way to make the same journey, so one vehicle can work departures on
// two different matched routes within a single search.
const routeAlt = makeRoute(ROUTE_ALT, ['Kaduwela', 'Battaramulla', 'Borella'], {
    routeNumber: '138',
    distanceKm: 18,
});

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Borella', 6.9147, 79.8778),
];

/**
 * The fake database, with every read of a `buses` document recorded.
 *
 * Wraps rather than replaces `createFakeFirestore`, so the store behaves exactly
 * as it does for every other suite and only the bus reads are observed.
 */
function countingStore(seed: Record<string, any[]>) {
    const store = createFakeFirestore(seed);
    const busReads: string[] = [];

    const instrumented = {
        ...store,
        collection: (name: string) => {
            const collection = store.collection(name);

            if (name !== 'buses') return collection;

            return {
                ...collection,
                doc: (id: string) => {
                    const doc = collection.doc(id);

                    return {
                        ...doc,
                        get: async () => {
                            busReads.push(id);
                            return doc.get();
                        },
                    };
                },
            };
        },
    };

    return { store: instrumented, busReads };
}

interface Fleet {
    routes?: any[];
    buses: any[];
    trips: any[];
}

async function searchWith(fleet: Fleet) {
    const { store, busReads } = countingStore({
        routes: fleet.routes ?? [routeMain],
        buses: fleet.buses,
        trips: fleet.trips,
        stops: STOP_DOCS,
    });

    mockGetAdminDb.mockReturnValue(store);

    const response = await search(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-08-25',
                travelTime: '05:00',
            }),
        })
    );

    return { response, json: await response.json(), busReads };
}

/** Every departure across every returned route, by trip id. */
const optionsOf = (json: any): any[] =>
    (json.routes ?? []).flatMap((match: any) => match.trips ?? []);

const optionFor = (json: any, tripId: string) =>
    optionsOf(json).find((option: any) => option.trip.tripId === tripId);

/** How many times one vehicle's document was fetched. */
const readsOf = (busReads: string[], busId: string) =>
    busReads.filter((id) => id === busId).length;

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
});

// ==================================================================
// ONE READ PER VEHICLE, HOWEVER MANY DEPARTURES IT WORKS
// ==================================================================
describe('fetching the vehicle behind each departure', () => {
    it('reads a vehicle document once no matter how many of its departures match', async () => {
        const { json, busReads } = await searchWith({
            buses: [makeBus('BUS-BUSY', 'NB-8001', FULLY_EQUIPPED)],
            trips: [
                makeTrip('TRIP-1', ROUTE_MAIN, 'BUS-BUSY', '06:00'),
                makeTrip('TRIP-2', ROUTE_MAIN, 'BUS-BUSY', '07:00'),
                makeTrip('TRIP-3', ROUTE_MAIN, 'BUS-BUSY', '08:00'),
                makeTrip('TRIP-4', ROUTE_MAIN, 'BUS-BUSY', '09:00'),
            ],
        });

        expect(optionsOf(json)).toHaveLength(4);
        // The in-flight promise is cached, not the resolved value: four
        // concurrently resolved departures still cost one read.
        expect(readsOf(busReads, 'BUS-BUSY')).toBe(1);

        // And every one of them still carries that vehicle's facilities.
        for (const option of optionsOf(json)) {
            expect(option.bus.accessibilityFacilities).toEqual(FULLY_EQUIPPED);
        }
    });

    it('reads each distinct vehicle exactly once', async () => {
        const { busReads } = await searchWith({
            buses: [
                makeBus('BUS-A', 'NB-8002', FULLY_EQUIPPED),
                makeBus('BUS-B', 'NB-8003', PARTLY_EQUIPPED),
                makeBus('BUS-C', 'NB-8004', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('TRIP-A1', ROUTE_MAIN, 'BUS-A', '06:00'),
                makeTrip('TRIP-B1', ROUTE_MAIN, 'BUS-B', '06:30'),
                makeTrip('TRIP-A2', ROUTE_MAIN, 'BUS-A', '07:00'),
                makeTrip('TRIP-C1', ROUTE_MAIN, 'BUS-C', '07:30'),
                makeTrip('TRIP-B2', ROUTE_MAIN, 'BUS-B', '08:00'),
            ],
        });

        expect(readsOf(busReads, 'BUS-A')).toBe(1);
        expect(readsOf(busReads, 'BUS-B')).toBe(1);
        expect(readsOf(busReads, 'BUS-C')).toBe(1);
        // One read per vehicle, not per departure — a per-trip read would be 5.
        expect(busReads).toHaveLength(3);
    });

    it('reuses one read across the different routes a vehicle serves', async () => {
        // Two matched routes are enriched concurrently. The memo belongs to the
        // request, not to a route, so a vehicle working both is fetched once.
        const { json, busReads } = await searchWith({
            routes: [routeMain, routeAlt],
            buses: [makeBus('BUS-SHARED', 'NB-8005', PARTLY_EQUIPPED)],
            trips: [
                makeTrip('TRIP-MAIN', ROUTE_MAIN, 'BUS-SHARED', '06:00'),
                makeTrip('TRIP-ALT', ROUTE_ALT, 'BUS-SHARED', '06:30'),
            ],
        });

        expect(json.count).toBe(2);
        expect(readsOf(busReads, 'BUS-SHARED')).toBe(1);

        expect(optionFor(json, 'TRIP-MAIN').bus.accessibilityFacilities).toEqual(PARTLY_EQUIPPED);
        expect(optionFor(json, 'TRIP-ALT').bus.accessibilityFacilities).toEqual(PARTLY_EQUIPPED);
    });
});

// ==================================================================
// THE GUARDS ON THE WAY IN
// ==================================================================
describe('departures whose vehicle cannot be fetched', () => {
    it('never asks Firestore for a vehicle a trip does not name', async () => {
        const { json, busReads } = await searchWith({
            buses: [makeBus('BUS-REAL', 'NB-8006', FULLY_EQUIPPED)],
            trips: [
                makeTrip('TRIP-NO-BUS', ROUTE_MAIN, '', '06:00'),
                makeTrip('TRIP-REAL', ROUTE_MAIN, 'BUS-REAL', '07:00'),
            ],
        });

        // An empty document path makes the real Firestore throw rather than
        // return nothing, so the guard has to come before the read.
        expect(busReads).toEqual(['BUS-REAL']);

        // The departure is still offered, simply without a vehicle.
        expect(optionFor(json, 'TRIP-NO-BUS').bus).toBeNull();
        expect(optionFor(json, 'TRIP-REAL').bus.accessibilityFacilities).toEqual(FULLY_EQUIPPED);
    });

    it('does not let a deleted vehicle disturb the ones still in the fleet', async () => {
        const { response, json, busReads } = await searchWith({
            buses: [makeBus('BUS-REAL', 'NB-8007', PARTLY_EQUIPPED)],
            trips: [
                makeTrip('TRIP-GONE', ROUTE_MAIN, 'BUS-DELETED', '06:00'),
                makeTrip('TRIP-REAL', ROUTE_MAIN, 'BUS-REAL', '07:00'),
                makeTrip('TRIP-GONE-AGAIN', ROUTE_MAIN, 'BUS-DELETED', '08:00'),
            ],
        });

        expect(response.status).toBe(200);
        // The missing vehicle is looked up once and remembered as missing.
        expect(readsOf(busReads, 'BUS-DELETED')).toBe(1);
        expect(readsOf(busReads, 'BUS-REAL')).toBe(1);

        expect(optionFor(json, 'TRIP-GONE').bus).toBeNull();
        expect(optionFor(json, 'TRIP-GONE-AGAIN').bus).toBeNull();
        expect(optionFor(json, 'TRIP-REAL').bus.accessibilityFacilities).toEqual(PARTLY_EQUIPPED);
    });

    it('reads a vehicle whose record has no facility block just once, like any other', async () => {
        const { json, busReads } = await searchWith({
            buses: [makeBus('BUS-LEGACY', 'NB-8008', undefined)],
            trips: [
                makeTrip('TRIP-L1', ROUTE_MAIN, 'BUS-LEGACY', '06:00'),
                makeTrip('TRIP-L2', ROUTE_MAIN, 'BUS-LEGACY', '07:00'),
            ],
        });

        expect(readsOf(busReads, 'BUS-LEGACY')).toBe(1);

        // Present as a vehicle, with nothing recorded about its facilities —
        // never retried in the hope of a different answer.
        for (const option of optionsOf(json)) {
            expect(option.bus.busId).toBe('BUS-LEGACY');
            expect(option.bus.accessibilityFacilities).toBeUndefined();
        }
    });
});
