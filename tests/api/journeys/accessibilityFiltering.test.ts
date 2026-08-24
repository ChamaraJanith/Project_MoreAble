// Only suitable transport options come back (MOV-92).
//
// MOV-91 gave a passenger the controls; this is the half that decides what the
// search actually returns. The rule it enforces is a safety rule, so the tests
// below start at the real HTTP endpoint rather than at a helper: a filter that
// works in isolation and is wired in at the wrong stage of the pipeline would
// still hand a wheelchair user a bus with no ramp.
//
// Two things are deliberately never re-implemented here. Accessibility scores
// come from `computeAccessibilityScore`, and the recommended order comes from
// running the real response through `toRecommendedJourneys` — the tests for
// "filtering changed neither" compare a filtered search against an unfiltered
// one, so they keep meaning the same thing after MOV-79 widens the formula or
// MOV-87's tie-breaks change.
//
// The vehicles are built from the shared fixtures, one facility at a time, so
// each requirement can be shown to read its own stored field and no other. No
// credential, session value or authentication data is fabricated: journey
// search needs none.

import { filterMatchesByAccessibility, POST } from '../../../app/api/journeys/search+api';
import { Bus, BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { JourneySearchMatch } from '../../../src/entities/route/model/types';
import { toRecommendedJourneys } from '../../../src/features/journey/utils/journeyRecommendations';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    FULLY_EQUIPPED,
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    NOT_EQUIPPED,
    Stored,
} from '../../testUtils/journeyFixtures';

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

// The map providers have no say in which vehicle is suitable.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// A network where every requirement can be told apart from every other.
//
//   ROUTE-177  Kaduwela - Malabe - Battaramulla - Rajagiriya - Borella
//   ROUTE-138  Kaduwela - Battaramulla - Borella      (no accessible vehicle)
//
// Each vehicle below records exactly ONE of the five requirements, so a filter
// reading the wrong stored field cannot pass by accident.
// ------------------------------------------------------------------
const R177 = 'ROUTE-177';
const R138 = 'ROUTE-138';

const STOPS_177 = ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'];
const STOPS_138 = ['Kaduwela', 'Battaramulla', 'Borella'];

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Rajagiriya', 6.9094, 79.8944),
    makeStop('Borella', 6.9147, 79.8778),
];

const route177 = makeRoute(R177, STOPS_177, { routeNumber: '177', distanceKm: 20 });
const route138 = makeRoute(R138, STOPS_138, { routeNumber: '138', distanceKm: 18 });

/** Exactly one requirement recorded, on an otherwise unequipped vehicle. */
const only = (overrides: Partial<BusAccessibilityFacilities>): BusAccessibilityFacilities => ({
    ...NOT_EQUIPPED,
    ...overrides,
});

const RAMP_ONLY = only({ wheelchairRamp: true });
const PRIORITY_ONLY = only({ prioritySeats: { available: true, count: 4 } });
const AUDIO_ONLY = only({ audioAnnouncement: true });
const LOW_FLOOR_ONLY = only({ lowFloorVehicle: true });
const WALKING_ONLY = only({ walkingAssistance: true });

/**
 * Firestore is schema-less, so these values really can be stored. Every one of
 * them is truthy in JavaScript and none of them records a facility.
 */
const MALFORMED = {
    ...NOT_EQUIPPED,
    wheelchairRamp: 'no',
    audioAnnouncement: 'false',
    lowFloorVehicle: 1,
    walkingAssistance: {},
    prioritySeats: { available: 'yes', count: 4 },
} as unknown as BusAccessibilityFacilities;

const buses: Stored<Bus>[] = [
    makeBus('BUS-FULL', 'NB-1001', FULLY_EQUIPPED),
    makeBus('BUS-RAMP', 'NB-1002', RAMP_ONLY),
    makeBus('BUS-PRIORITY', 'NB-1003', PRIORITY_ONLY),
    makeBus('BUS-AUDIO', 'NB-1004', AUDIO_ONLY),
    makeBus('BUS-LOWFLOOR', 'NB-1005', LOW_FLOOR_ONLY),
    makeBus('BUS-WALKING', 'NB-1006', WALKING_ONLY),
    makeBus('BUS-NONE', 'NB-1007', NOT_EQUIPPED),
    makeBus('BUS-MALFORMED', 'NB-1008', MALFORMED),
    // A record with no accessibility block at all.
    makeBus('BUS-NOFACILITIES', 'NB-1009', undefined),
];

// Departure times are distinct so a trip is identifiable in a ranked list.
const trips = [
    makeTrip('T-FULL', R177, 'BUS-FULL', '06:00'),
    makeTrip('T-RAMP', R177, 'BUS-RAMP', '06:30'),
    makeTrip('T-PRIORITY', R177, 'BUS-PRIORITY', '07:00'),
    makeTrip('T-AUDIO', R177, 'BUS-AUDIO', '07:30'),
    makeTrip('T-LOWFLOOR', R177, 'BUS-LOWFLOOR', '08:00'),
    makeTrip('T-WALKING', R177, 'BUS-WALKING', '08:30'),
    makeTrip('T-NONE', R177, 'BUS-NONE', '09:00'),
    makeTrip('T-MALFORMED', R177, 'BUS-MALFORMED', '09:30'),
    makeTrip('T-NOFACILITIES', R177, 'BUS-NOFACILITIES', '10:00'),
    // Names a bus that is not in the fleet collection, so the option carries
    // `bus: null` exactly as production does for a deleted vehicle.
    makeTrip('T-NOBUS', R177, 'BUS-DELETED', '10:30'),
    makeTrip('T138-NONE', R138, 'BUS-NONE', '06:15'),
];

interface SearchOptions {
    accessibilityRequirements?: unknown;
    origin?: string;
    destination?: string;
    travelTime?: string;
    /** Omit the field from the body entirely, as a pre-MOV-92 client does. */
    omitRequirements?: boolean;
}

async function search(options: SearchOptions = {}) {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({ routes: [route177, route138], buses, trips, stops: STOP_DOCS })
    );

    const body: Record<string, unknown> = {
        origin: options.origin ?? 'Kaduwela',
        destination: options.destination ?? 'Borella',
        travelDate: '2026-08-25',
        travelTime: options.travelTime ?? '05:00',
    };

    if (!options.omitRequirements) {
        body.accessibilityRequirements = options.accessibilityRequirements ?? [];
    }

    const response = await POST(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
    );

    return { response, json: await response.json() };
}

/** Every departure the response offers, across every route it returned. */
const tripIdsOf = (json: any): string[] =>
    (json.routes ?? []).flatMap((route: any) =>
        (route.trips ?? []).map((option: any) => option.trip.tripId)
    );

const routeIdsOf = (json: any): string[] => (json.routes ?? []).map((route: any) => route.routeId);

/** The recommended order a passenger screen would render (MOV-87 / MOV-88). */
const rankedOrderOf = (json: any): string[] =>
    toRecommendedJourneys(json.routes ?? []).map((journey) => journey.option.trip.tripId);

const optionFor = (json: any, tripId: string) =>
    (json.routes ?? [])
        .flatMap((route: any) => route.trips ?? [])
        .find((option: any) => option.trip.tripId === tripId);

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
// NOTHING SELECTED — the search behaves exactly as it always has
// ==================================================================
describe('a search that states no accessibility requirement', () => {
    it('returns every eligible departure when the field is absent', async () => {
        const { response, json } = await search({ omitRequirements: true });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(routeIdsOf(json)).toEqual([R177, R138]);
        expect(tripIdsOf(json)).toEqual([
            'T-FULL',
            'T-RAMP',
            'T-PRIORITY',
            'T-AUDIO',
            'T-LOWFLOOR',
            'T-WALKING',
            'T-NONE',
            'T-MALFORMED',
            'T-NOFACILITIES',
            'T-NOBUS',
            'T138-NONE',
        ]);
    });

    it('keeps the departures whose vehicle records nothing, is malformed, or is missing', async () => {
        const { json } = await search({ omitRequirements: true });

        // A passenger who asked for nothing is still entitled to see these.
        expect(tripIdsOf(json)).toEqual(
            expect.arrayContaining(['T-NONE', 'T-MALFORMED', 'T-NOFACILITIES', 'T-NOBUS'])
        );
    });

    it('treats an empty list exactly as an absent one', async () => {
        const absent = await search({ omitRequirements: true });
        const empty = await search({ accessibilityRequirements: [] });

        expect(routeIdsOf(empty.json)).toEqual(routeIdsOf(absent.json));
        expect(tripIdsOf(empty.json)).toEqual(tripIdsOf(absent.json));
        expect(empty.json.count).toBe(absent.json.count);
        expect(empty.json.message).toBe(absent.json.message);
    });

    it('does not duplicate a departure', async () => {
        const { json } = await search({ omitRequirements: true });
        const ids = tripIdsOf(json);

        expect(new Set(ids).size).toBe(ids.length);
    });
});

// ==================================================================
// EACH REQUIREMENT READS ITS OWN STORED FIELD
// ==================================================================
describe('filtering by a single requirement', () => {
    const cases: [string, string][] = [
        ['wheelchairRamp', 'T-RAMP'],
        ['prioritySeats', 'T-PRIORITY'],
        ['audioAnnouncement', 'T-AUDIO'],
        ['lowFloorVehicle', 'T-LOWFLOOR'],
        ['walkingAssistance', 'T-WALKING'],
    ];

    it.each(cases)(
        'returns only the vehicles recording %s',
        async (requirement, singleFacilityTrip) => {
            const { response, json } = await search({
                accessibilityRequirements: [requirement],
            });

            expect(response.status).toBe(200);
            // The fully equipped bus records every requirement, so it survives
            // each of the five; the single-facility bus survives only its own.
            expect(tripIdsOf(json)).toEqual(['T-FULL', singleFacilityTrip]);
        }
    );

    it.each(cases)(
        'excludes every vehicle that does not record %s',
        async (requirement, singleFacilityTrip) => {
            const { json } = await search({ accessibilityRequirements: [requirement] });
            const returned = tripIdsOf(json);

            const otherSingleFacilityTrips = cases
                .map(([, tripId]) => tripId)
                .filter((tripId) => tripId !== singleFacilityTrip);

            for (const tripId of otherSingleFacilityTrips) {
                expect(returned).not.toContain(tripId);
            }
        }
    );

    it('reads priority seats through availability rather than through a count', async () => {
        // A decommissioned bay leaves the count behind; availability governs.
        const staleCount = makeBus('BUS-STALE', 'NB-1010', {
            ...NOT_EQUIPPED,
            prioritySeats: { available: false, count: 6 },
        });

        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [route177],
                buses: [staleCount],
                trips: [makeTrip('T-STALE', R177, 'BUS-STALE', '06:00')],
                stops: STOP_DOCS,
            })
        );

        const response = await POST(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: 'Kaduwela',
                    destination: 'Borella',
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                    accessibilityRequirements: ['prioritySeats'],
                }),
            })
        );

        const json = await response.json();

        expect(tripIdsOf(json)).toEqual([]);
    });
});

// ==================================================================
// WHAT MUST NEVER SATISFY A REQUIREMENT
// ==================================================================
describe('vehicles that cannot be shown to meet a requirement', () => {
    const everyRequirement = [
        'wheelchairRamp',
        'prioritySeats',
        'audioAnnouncement',
        'lowFloorVehicle',
        'walkingAssistance',
    ];

    it.each(everyRequirement)('excludes a malformed record when %s is required', async (key) => {
        const { json } = await search({ accessibilityRequirements: [key] });

        // Every malformed value on that bus is truthy; none of them is `true`.
        expect(tripIdsOf(json)).not.toContain('T-MALFORMED');
    });

    it.each(everyRequirement)(
        'excludes a vehicle with no accessibility data when %s is required',
        async (key) => {
            const { json } = await search({ accessibilityRequirements: [key] });

            expect(tripIdsOf(json)).not.toContain('T-NOFACILITIES');
        }
    );

    it.each(everyRequirement)('excludes a departure with no bus when %s is required', async (key) => {
        const { json } = await search({ accessibilityRequirements: [key] });

        expect(tripIdsOf(json)).not.toContain('T-NOBUS');
    });

    it('excludes a vehicle recorded as having nothing', async () => {
        const { json } = await search({ accessibilityRequirements: ['wheelchairRamp'] });

        expect(tripIdsOf(json)).not.toContain('T-NONE');
    });
});

// ==================================================================
// SEVERAL REQUIREMENTS NARROW, THEY DO NOT WIDEN
// ==================================================================
describe('filtering by several requirements at once', () => {
    it('requires every selected requirement on the same vehicle', async () => {
        const { json } = await search({
            accessibilityRequirements: ['wheelchairRamp', 'lowFloorVehicle'],
        });

        // T-RAMP and T-LOWFLOOR each satisfy one of the two, which is not enough.
        expect(tripIdsOf(json)).toEqual(['T-FULL']);
    });

    it('narrows as requirements are added and never grows', async () => {
        const one = await search({ accessibilityRequirements: ['wheelchairRamp'] });
        const two = await search({
            accessibilityRequirements: ['wheelchairRamp', 'audioAnnouncement'],
        });
        const all = await search({
            accessibilityRequirements: [
                'wheelchairRamp',
                'prioritySeats',
                'audioAnnouncement',
                'lowFloorVehicle',
                'walkingAssistance',
            ],
        });

        expect(tripIdsOf(two.json).length).toBeLessThanOrEqual(tripIdsOf(one.json).length);
        expect(tripIdsOf(all.json)).toEqual(['T-FULL']);
    });

    it('is order-independent', async () => {
        const forward = await search({
            accessibilityRequirements: ['wheelchairRamp', 'audioAnnouncement'],
        });
        const reversed = await search({
            accessibilityRequirements: ['audioAnnouncement', 'wheelchairRamp'],
        });

        expect(tripIdsOf(reversed.json)).toEqual(tripIdsOf(forward.json));
        expect(reversed.json.searchCriteria.accessibilityRequirements).toEqual(
            forward.json.searchCriteria.accessibilityRequirements
        );
    });

    it('ignores a requirement repeated by the client', async () => {
        const once = await search({ accessibilityRequirements: ['wheelchairRamp'] });
        const twice = await search({
            accessibilityRequirements: ['wheelchairRamp', 'wheelchairRamp'],
        });

        expect(tripIdsOf(twice.json)).toEqual(tripIdsOf(once.json));
        expect(twice.json.searchCriteria.accessibilityRequirements).toEqual(['wheelchairRamp']);
    });
});

// ==================================================================
// A ROUTE WITH NO SUITABLE DEPARTURE
// ==================================================================
describe('a route left with no suitable departure', () => {
    it('is dropped rather than returned with an empty departure list', async () => {
        const { json } = await search({ accessibilityRequirements: ['wheelchairRamp'] });

        // ROUTE-138 runs the journey, but only with an unequipped vehicle.
        expect(routeIdsOf(json)).toEqual([R177]);
        expect(json.count).toBe(1);
    });

    it('reports no match on the requirements when nothing at all survives', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [route138],
                buses: [makeBus('BUS-NONE', 'NB-1007', NOT_EQUIPPED)],
                trips: [makeTrip('T138-NONE', R138, 'BUS-NONE', '06:15')],
                stops: STOP_DOCS,
            })
        );

        const response = await POST(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: 'Kaduwela',
                    destination: 'Borella',
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                    accessibilityRequirements: ['wheelchairRamp'],
                }),
            })
        );

        const json = await response.json();

        // A truthful explanation: routes do run this journey, so the passenger
        // must not be told none was found.
        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        expect(json.routes).toEqual([]);
        expect(json.message).toMatch(/accessibility requirements/i);
    });
});

// ==================================================================
// FILTERING CHANGES NOTHING ELSE
// ==================================================================
describe('what filtering must leave alone', () => {
    it('does not change any accessibility score', async () => {
        const unfiltered = await search({ omitRequirements: true });
        const filtered = await search({ accessibilityRequirements: ['wheelchairRamp'] });

        for (const tripId of tripIdsOf(filtered.json)) {
            const before = optionFor(unfiltered.json, tripId);
            const after = optionFor(filtered.json, tripId);

            expect(after.bus.accessibilityScore).toBe(before.bus.accessibilityScore);
            // Still the shared figure, not one this endpoint adjusted.
            expect(after.bus.accessibilityScore).toBe(
                computeAccessibilityScore(after.bus.accessibilityFacilities)
            );
        }
    });

    it('does not change the recommended order among the departures that remain', async () => {
        const unfiltered = await search({ omitRequirements: true });
        const filtered = await search({ accessibilityRequirements: ['prioritySeats'] });

        const survivors = new Set(tripIdsOf(filtered.json));
        const orderBefore = rankedOrderOf(unfiltered.json).filter((id) => survivors.has(id));

        expect(rankedOrderOf(filtered.json)).toEqual(orderBefore);
    });

    it('leaves each returned departure otherwise identical', async () => {
        const unfiltered = await search({ omitRequirements: true });
        const filtered = await search({ accessibilityRequirements: ['audioAnnouncement'] });

        for (const tripId of tripIdsOf(filtered.json)) {
            expect(optionFor(filtered.json, tripId)).toEqual(optionFor(unfiltered.json, tripId));
        }
    });

    it('keeps the route data the journey screens read', async () => {
        const unfiltered = await search({ omitRequirements: true });
        const filtered = await search({ accessibilityRequirements: ['wheelchairRamp'] });

        const before = unfiltered.json.routes.find((route: any) => route.routeId === R177);
        const after = filtered.json.routes.find((route: any) => route.routeId === R177);

        expect(after).toMatchObject({
            routeNumber: before.routeNumber,
            routeName: before.routeName,
            origin: before.origin,
            destination: before.destination,
            journeyStops: before.journeyStops,
            journeyDistanceKm: before.journeyDistanceKm,
        });
    });

    it('does not duplicate a departure while filtering', async () => {
        const { json } = await search({ accessibilityRequirements: ['wheelchairRamp'] });
        const ids = tripIdsOf(json);

        expect(ids).toEqual(['T-FULL', 'T-RAMP']);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// ==================================================================
// THE EXISTING SEARCH FILTERS STILL APPLY
// ==================================================================
describe('alongside the existing search criteria', () => {
    it('still excludes departures before the requested travel time', async () => {
        const { json } = await search({
            accessibilityRequirements: ['wheelchairRamp'],
            travelTime: '06:15',
        });

        // T-FULL departs 06:00 and is in the past for this search; T-RAMP is not.
        expect(tripIdsOf(json)).toEqual(['T-RAMP']);
    });

    it('still matches only routes that serve the journey in the right direction', async () => {
        const { json } = await search({
            accessibilityRequirements: ['wheelchairRamp'],
            origin: 'Borella',
            destination: 'Kaduwela',
        });

        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        expect(json.routes).toEqual([]);
    });

    it('still validates the journey itself before considering requirements', async () => {
        const { response, json } = await search({
            accessibilityRequirements: ['wheelchairRamp'],
            origin: 'Nowhere',
        });

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/origin/i);
    });

    it('still honours the passenger boarding partway along the route', async () => {
        const { json } = await search({
            accessibilityRequirements: ['wheelchairRamp'],
            origin: 'Malabe',
            destination: 'Rajagiriya',
        });

        const match = json.routes[0];

        expect(match.origin).toBe('Malabe');
        expect(match.destination).toBe('Rajagiriya');
        expect(match.journeyStops).toEqual(['Malabe', 'Battaramulla', 'Rajagiriya']);
        expect(tripIdsOf(json)).toEqual(['T-FULL', 'T-RAMP']);
    });
});

// ==================================================================
// THE REQUEST CONTRACT
// ==================================================================
describe('the accessibility requirements on the request', () => {
    it('echoes back what the results were filtered by', async () => {
        const { json } = await search({
            accessibilityRequirements: ['audioAnnouncement', 'wheelchairRamp'],
        });

        // Canonical order, so the echo is the same list however it was sent.
        expect(json.searchCriteria.accessibilityRequirements).toEqual([
            'wheelchairRamp',
            'audioAnnouncement',
        ]);
        expect(json.searchCriteria.origin).toBe('Kaduwela');
    });

    it('rejects a requirement it does not recognise rather than ignoring it', async () => {
        // Ignoring a mistyped requirement would answer a passenger who asked for
        // a ramp with unfiltered results that look filtered.
        const { response, json } = await search({
            accessibilityRequirements: ['wheelChairRamp'],
        });

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/wheelChairRamp/);
    });

    it('rejects a value that is not a list', async () => {
        const { response, json } = await search({
            accessibilityRequirements: { wheelchairRamp: true },
        });

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/accessibilityRequirements/);
    });

    it('reports an empty list of requirements for a request that states none', async () => {
        const { json } = await search({ omitRequirements: true });

        expect(json.searchCriteria.accessibilityRequirements).toEqual([]);
    });
});

// ==================================================================
// THE FILTER ITSELF
// ==================================================================
describe('filterMatchesByAccessibility', () => {
    it('returns the very same list when nothing is required', () => {
        const matches = [{ routeId: R177, trips: [] }] as unknown as JourneySearchMatch[];

        // Identity, not a copy: an unfiltered search does no work at all.
        expect(filterMatchesByAccessibility(matches, [])).toBe(matches);
    });

    it('never mutates the matches it is given', () => {
        const matches = [
            {
                routeId: R177,
                trips: [
                    { trip: { tripId: 'T-A' }, bus: { accessibilityFacilities: RAMP_ONLY } },
                    { trip: { tripId: 'T-B' }, bus: { accessibilityFacilities: NOT_EQUIPPED } },
                ],
            },
        ] as unknown as JourneySearchMatch[];

        filterMatchesByAccessibility(matches, ['wheelchairRamp']);

        expect(matches[0].trips).toHaveLength(2);
    });
});
