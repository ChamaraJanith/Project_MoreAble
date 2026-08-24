// The whole accessibility filter, end to end (MOV-94).
//
// Three suites already cover this feature in depth and none of it is repeated
// here:
//
//   * MOV-91 (`tests/features/journey/accessibilityFilters.test.ts`) — the
//     selection helpers and the screen's narrowing rule.
//   * MOV-92 (`tests/api/journeys/accessibilityFiltering.test.ts`) — the search
//     endpoint: each requirement against its own stored field, malformed and
//     missing vehicles, all-of matching, dropped routes, request validation.
//   * MOV-93 (`tests/api/users/accessibilityFilterPreference+api.route.test.ts`)
//     — saving, restoring and isolating a passenger's preference.
//
// What none of them covers is the join between the layers, which is where this
// feature can still fail with every existing test green:
//
//   1. RANKING. MOV-92 proves the order of the SURVIVORS is undisturbed, but
//      every case it uses leaves the best-scoring departure in the results. The
//      dangerous case is the opposite one — the most accessible bus is the one
//      the passenger cannot use — and a filter applied after ranking, or one
//      that ranks before it excludes, would still pass MOV-92.
//   2. WHAT THE SCREEN ENDS UP RENDERING. The passenger does not read the HTTP
//      body; they read `toRecommendedJourneys` output, narrowed once more on the
//      device. Nothing tested that path whole, or that its two filters — the
//      server's and the screen's — still agree.
//   3. CHANGING A SELECTION, including a response arriving from a selection the
//      passenger has already moved on from.
//
// The screen's own request-ordering guard lives inside a React component, and
// this project's Jest setup is node-environment with `*.test.ts` only, so it has
// no renderer. The guard's real safety property is testable without one and is
// tested below: whatever response reaches the screen, what it renders agrees
// with the chips currently shown selected.
//
// Nothing here re-implements a rule it checks. No score is written down — every
// expectation is derived from `computeAccessibilityScore` or compared against
// the figure the pipeline itself produced — and no ordering is recomputed with a
// local comparator: the expected order is written out as the order a passenger
// should see, and cross-checked against the unfiltered order restricted to the
// survivors. No credential-shaped value appears; journey search needs none.

import { POST } from '../../../app/api/journeys/search+api';
import { Bus } from '../../../src/entities/bus/model/types';
import {
    RecommendedJourney,
    toRecommendedJourneys,
} from '../../../src/features/journey/utils/journeyRecommendations';
import {
    accessibilityRequirementSelection,
    filterJourneysByAccessibility,
} from '../../../src/features/journey/utils/accessibilityFilters';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import {
    AccessibilityRequirementKey,
    computeAccessibilityScore,
} from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    FULLY_EQUIPPED,
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    MOSTLY_EQUIPPED,
    NOT_EQUIPPED,
    PARTLY_EQUIPPED,
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

jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// One route, and a fleet chosen so score and suitability DISAGREE.
//
//   ROUTE-177  Kaduwela - Malabe - Battaramulla - Rajagiriya - Borella
//
//   BUS-FULL     every facility                     (highest score, suits all)
//   BUS-MOSTLY   everything except walking assistance and guardian seats
//   BUS-PARTLY   a ramp and priority seats only
//   BUS-ASSIST   walking assistance + priority seats (low score, suits walking)
//   BUS-WALKING  walking assistance only            (lowest non-zero score)
//   BUS-NONE     nothing recorded
//
// BUS-MOSTLY is the trap: it scores well and is the wrong bus for a passenger
// who needs help boarding.
// ------------------------------------------------------------------
const ROUTE_ID = 'ROUTE-177';
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'];

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Rajagiriya', 6.9094, 79.8944),
    makeStop('Borella', 6.9147, 79.8778),
];

const route = makeRoute(ROUTE_ID, STOPS, {
    routeNumber: '177',
    distanceKm: 20,
    segmentDurationsMinutes: [8, 6, 12, 15],
});

/** Walking assistance and priority seats, nothing else. */
const ASSIST_EQUIPPED = {
    ...NOT_EQUIPPED,
    walkingAssistance: true,
    prioritySeats: { available: true, count: 2 },
};

/** Walking assistance alone. */
const WALKING_EQUIPPED = { ...NOT_EQUIPPED, walkingAssistance: true };

type VehicleName = 'full' | 'mostly' | 'partly' | 'assist' | 'walking' | 'none';

const FLEET: Record<VehicleName, { bus: Stored<Bus>; trip: ReturnType<typeof makeTrip> }> = {
    // Departure times are distinct, so a journey is identifiable in a ranked
    // list and a tie-break never decides one of these assertions.
    full: {
        bus: makeBus('BUS-FULL', 'NB-3001', FULLY_EQUIPPED),
        trip: makeTrip('T-FULL', ROUTE_ID, 'BUS-FULL', '08:00'),
    },
    mostly: {
        bus: makeBus('BUS-MOSTLY', 'NB-3002', MOSTLY_EQUIPPED),
        trip: makeTrip('T-MOSTLY', ROUTE_ID, 'BUS-MOSTLY', '07:00'),
    },
    partly: {
        bus: makeBus('BUS-PARTLY', 'NB-3003', PARTLY_EQUIPPED),
        trip: makeTrip('T-PARTLY', ROUTE_ID, 'BUS-PARTLY', '06:30'),
    },
    assist: {
        bus: makeBus('BUS-ASSIST', 'NB-3004', ASSIST_EQUIPPED),
        trip: makeTrip('T-ASSIST', ROUTE_ID, 'BUS-ASSIST', '09:00'),
    },
    walking: {
        bus: makeBus('BUS-WALKING', 'NB-3005', WALKING_EQUIPPED),
        trip: makeTrip('T-WALKING', ROUTE_ID, 'BUS-WALKING', '09:30'),
    },
    none: {
        bus: makeBus('BUS-NONE', 'NB-3006', NOT_EQUIPPED),
        trip: makeTrip('T-NONE', ROUTE_ID, 'BUS-NONE', '06:00'),
    },
};

const WHOLE_FLEET: VehicleName[] = ['full', 'mostly', 'partly', 'assist', 'walking', 'none'];

interface SearchOptions {
    fleet?: VehicleName[];
    origin?: string;
    destination?: string;
    travelTime?: string;
    /** Sent verbatim, so a test can post a malformed value on purpose. */
    rawRequirements?: unknown;
    omitRequirements?: boolean;
}

/**
 * Runs the real endpoint and returns what the passenger screen would hold.
 *
 * `journeys` is `toRecommendedJourneys` over the real response body — the same
 * view model `JourneySearchResults` renders from — so nothing between the HTTP
 * layer and the screen is assembled by hand.
 */
async function search(
    requirements: AccessibilityRequirementKey[] | null,
    options: SearchOptions = {}
) {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({
            routes: [route],
            buses: (options.fleet ?? WHOLE_FLEET).map((name) => FLEET[name].bus),
            trips: (options.fleet ?? WHOLE_FLEET).map((name) => FLEET[name].trip),
            stops: STOP_DOCS,
        })
    );

    const body: Record<string, unknown> = {
        origin: options.origin ?? 'Kaduwela',
        destination: options.destination ?? 'Borella',
        travelDate: '2026-08-25',
        travelTime: options.travelTime ?? '05:00',
    };

    if (!options.omitRequirements) {
        body.accessibilityRequirements =
            options.rawRequirements !== undefined ? options.rawRequirements : (requirements ?? []);
    }

    const response = await POST(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
    );

    const json = await response.json();
    const journeys = toRecommendedJourneys(json.routes ?? []);

    return { response, json, journeys };
}

/** The recommended journeys, as the trip ids a passenger would see in order. */
const orderOf = (journeys: RecommendedJourney[]) =>
    journeys.map((journey) => journey.option.trip.tripId);

const journeyFor = (journeys: RecommendedJourney[], tripId: string) =>
    journeys.find((journey) => journey.option.trip.tripId === tripId);

/**
 * A matched route without its list of departures.
 *
 * That list is the one thing filtering is SUPPOSED to shorten — the route a
 * surviving journey belongs to carries only the departures that survived with
 * it. Everything else about the route describes the journey itself and must
 * come back untouched, which is what the comparisons below check.
 */
const withoutDepartures = (match: RecommendedJourney['route']) => {
    const { trips, ...rest } = match;
    void trips;
    return rest;
};

/** What the screen renders: the response, narrowed by the chips shown selected. */
const renderedFor = (
    journeys: RecommendedJourney[],
    selected: AccessibilityRequirementKey[]
): string[] =>
    orderOf(filterJourneysByAccessibility(journeys, accessibilityRequirementSelection(selected)));

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
// The fixtures must mean what the ranking assertions assume.
// Checked once, from the shared function, rather than assumed in ten places.
// ==================================================================
describe('the fleet these tests rank', () => {
    it('scores a better equipped vehicle higher', () => {
        const scoreOf = computeAccessibilityScore;

        expect(scoreOf(FULLY_EQUIPPED)).toBeGreaterThan(scoreOf(MOSTLY_EQUIPPED));
        expect(scoreOf(MOSTLY_EQUIPPED)).toBeGreaterThan(scoreOf(ASSIST_EQUIPPED));
        expect(scoreOf(ASSIST_EQUIPPED)).toBeGreaterThan(scoreOf(WALKING_EQUIPPED));
        expect(scoreOf(WALKING_EQUIPPED)).toBeGreaterThan(scoreOf(NOT_EQUIPPED));
    });

    it('offers a well-scoring vehicle that cannot help a passenger board', () => {
        // The whole point of the fleet: score and suitability disagree here.
        expect(computeAccessibilityScore(MOSTLY_EQUIPPED)).toBeGreaterThan(
            computeAccessibilityScore(ASSIST_EQUIPPED)
        );
        expect(MOSTLY_EQUIPPED.walkingAssistance).toBe(false);
        expect(ASSIST_EQUIPPED.walkingAssistance).toBe(true);
    });
});

// ==================================================================
// 7. RANKING INTEGRATION
// ==================================================================
describe('filtering and the recommendation ranking', () => {
    it('never recommends a journey the requirements excluded', async () => {
        const unfiltered = await search([]);
        const filtered = await search(['walkingAssistance']);

        // Read from the pipeline, not asserted as a number: these do rank above
        // the vehicles that can actually help this passenger.
        expect(orderOf(unfiltered.journeys)).toContain('T-MOSTLY');
        expect(orderOf(unfiltered.journeys)).toContain('T-PARTLY');

        const recommended = orderOf(filtered.journeys);

        expect(recommended).not.toContain('T-MOSTLY');
        expect(recommended).not.toContain('T-PARTLY');
        expect(recommended).not.toContain('T-NONE');
        expect(recommended).toEqual(['T-FULL', 'T-ASSIST', 'T-WALKING']);
    });

    it('promotes the best SURVIVING journey when the highest scoring one is excluded', async () => {
        // A fleet whose top-ranked vehicle is the one that cannot help.
        const fleet: VehicleName[] = ['mostly', 'assist', 'walking', 'none'];

        const unfiltered = await search([], { fleet });
        const filtered = await search(['walkingAssistance'], { fleet });

        // Premise, taken from the unfiltered run itself.
        expect(orderOf(unfiltered.journeys)[0]).toBe('T-MOSTLY');

        // The excluded top scorer is gone from every position, and the
        // lower-scoring survivor leads — it is not displaced by the journey the
        // passenger cannot use.
        expect(orderOf(filtered.journeys)).toEqual(['T-ASSIST', 'T-WALKING']);
        expect(orderOf(filtered.journeys)).not.toContain('T-MOSTLY');
    });

    it('keeps the surviving journeys in the order they already had', async () => {
        const unfiltered = await search([]);
        const filtered = await search(['prioritySeats']);

        const survivors = new Set(orderOf(filtered.journeys));

        // Derived, not recomputed: the same order, minus what was removed.
        expect(orderOf(filtered.journeys)).toEqual(
            orderOf(unfiltered.journeys).filter((tripId) => survivors.has(tripId))
        );
    });

    it('leaves every surviving journey the score it already had', async () => {
        const unfiltered = await search([]);
        const filtered = await search(['walkingAssistance']);

        for (const journey of filtered.journeys) {
            const before = journeyFor(unfiltered.journeys, journey.option.trip.tripId);

            expect(journey.accessibilityScore).toBe(before?.accessibilityScore);
            // Still MOV-79's figure for this vehicle, not one filtering adjusted.
            expect(journey.accessibilityScore).toBe(
                computeAccessibilityScore(journey.option.bus?.accessibilityFacilities)
            );
        }
    });

    it('leaves the surviving journeys otherwise identical, timing and display included', async () => {
        const unfiltered = await search([]);
        const filtered = await search(['wheelchairRamp']);

        for (const journey of filtered.journeys) {
            const before = journeyFor(unfiltered.journeys, journey.option.trip.tripId);

            // Everything a card renders about THIS journey — MOV-88's timing,
            // duration, distance and labels included.
            expect({ ...journey, route: withoutDepartures(journey.route) }).toEqual({
                ...before,
                route: withoutDepartures(before!.route),
            });
        }
    });
});

// ==================================================================
// 4. NO REQUIREMENTS, THROUGH THE WHOLE PIPELINE
// ==================================================================
describe('a passenger who states no requirement', () => {
    it('sees the same recommendations whether the field is absent or empty', async () => {
        const absent = await search(null, { omitRequirements: true });
        const empty = await search([]);

        // Compared as the objects a screen renders, not as trip ids, so a
        // difference in timing, distance or ordering would fail too.
        expect(empty.journeys).toEqual(absent.journeys);
    });

    it('loses no eligible departure to the filter', async () => {
        const { journeys } = await search([]);

        expect(orderOf(journeys)).toHaveLength(WHOLE_FLEET.length);
        expect(orderOf(journeys)).toEqual(
            expect.arrayContaining(['T-FULL', 'T-MOSTLY', 'T-PARTLY', 'T-ASSIST', 'T-WALKING', 'T-NONE'])
        );
    });

    it('recommends each departure exactly once', async () => {
        const recommended = orderOf((await search([])).journeys);

        expect(new Set(recommended).size).toBe(recommended.length);
    });
});

// ==================================================================
// 3. COMBINATIONS
// ==================================================================
describe('several requirements at once', () => {
    it('returns only a vehicle satisfying all three', async () => {
        const { journeys } = await search([
            'wheelchairRamp',
            'lowFloorVehicle',
            'audioAnnouncement',
        ]);

        // BUS-PARTLY has the ramp and BUS-MOSTLY has all three but is kept out
        // of nothing here — only vehicles recording every one survive.
        expect(orderOf(journeys)).toEqual(['T-FULL', 'T-MOSTLY']);
    });

    it('excludes a vehicle that satisfies all but one', async () => {
        const { journeys } = await search([
            'wheelchairRamp',
            'lowFloorVehicle',
            'audioAnnouncement',
            'walkingAssistance',
        ]);

        // BUS-MOSTLY records the first three and not the fourth.
        expect(orderOf(journeys)).toEqual(['T-FULL']);
    });

    it('narrows monotonically as requirements are added', async () => {
        const one = orderOf((await search(['prioritySeats'])).journeys);
        const two = orderOf((await search(['prioritySeats', 'wheelchairRamp'])).journeys);
        const three = orderOf(
            (await search(['prioritySeats', 'wheelchairRamp', 'walkingAssistance'])).journeys
        );

        expect(two.every((tripId) => one.includes(tripId))).toBe(true);
        expect(three.every((tripId) => two.includes(tripId))).toBe(true);
    });
});

// ==================================================================
// 9. CHANGING THE SELECTION, AND WHAT THE SCREEN RENDERS
// ==================================================================
describe('changing the selected requirements', () => {
    it('uses a newly filtered result each time the selection changes', async () => {
        const none = orderOf((await search([])).journeys);
        const walking = orderOf((await search(['walkingAssistance'])).journeys);
        const walkingAndSeats = orderOf(
            (await search(['walkingAssistance', 'prioritySeats'])).journeys
        );

        expect(none).toHaveLength(6);
        expect(walking).toEqual(['T-FULL', 'T-ASSIST', 'T-WALKING']);
        expect(walkingAndSeats).toEqual(['T-FULL', 'T-ASSIST']);
    });

    it('restores every eligible journey when the filters are cleared', async () => {
        const before = await search([]);
        await search(['wheelchairRamp', 'walkingAssistance']);
        const afterClearing = await search([]);

        expect(afterClearing.journeys).toEqual(before.journeys);
    });

    it('renders only what the chips currently selected allow, whatever response arrived', async () => {
        // A response fetched for one selection, reaching a screen whose
        // selection has since changed — the case the screen's request-ordering
        // guard exists for. Even if that response is the one on hand, nothing
        // unsuitable can reach the passenger.
        const stale = await search(['walkingAssistance']);

        expect(orderOf(stale.journeys)).toContain('T-WALKING');
        // BUS-WALKING records no ramp, so it cannot survive the current chips.
        expect(renderedFor(stale.journeys, ['wheelchairRamp'])).toEqual(['T-FULL']);
    });

    it('renders everything again when the chips are cleared', async () => {
        const stale = await search(['walkingAssistance']);

        expect(renderedFor(stale.journeys, [])).toEqual(orderOf(stale.journeys));
    });

    it('agrees with the server about which journeys are suitable', async () => {
        // The screen's rule (MOV-91) and the search's rule (MOV-92) read the
        // same shared function. Narrowing an UNFILTERED response on the device
        // must therefore reach the same list the server would have returned.
        const unfiltered = await search([]);

        for (const selection of [
            ['wheelchairRamp'],
            ['prioritySeats'],
            ['audioAnnouncement'],
            ['lowFloorVehicle'],
            ['walkingAssistance'],
            ['wheelchairRamp', 'lowFloorVehicle'],
            ['walkingAssistance', 'prioritySeats'],
        ] as AccessibilityRequirementKey[][]) {
            const fromServer = orderOf((await search(selection)).journeys);

            expect(renderedFor(unfiltered.journeys, selection)).toEqual(fromServer);
        }
    });
});

// ==================================================================
// 5. AN INVALID REQUEST IS NEVER AN UNFILTERED SEARCH
// ==================================================================
describe('a request the endpoint cannot honour', () => {
    it('rejects a list mixing a known and an unknown requirement', async () => {
        const { response, json } = await search(null, {
            rawRequirements: ['wheelchairRamp', 'brailleSignage'],
        });

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/brailleSignage/);
    });

    it.each([
        ['an unknown requirement', ['teleporter']],
        ['a mixed list', ['wheelchairRamp', 'teleporter']],
        ['an object instead of a list', { wheelchairRamp: true }],
        ['a bare string', 'wheelchairRamp'],
        ['a number', 5],
    ])('returns no journeys at all for %s', async (_label, rawRequirements) => {
        const { response, json } = await search(null, { rawRequirements });

        expect(response.status).toBe(400);
        // The failure mode this guards: a rejected filter quietly degrading into
        // an unfiltered search, which would answer a wheelchair user with every
        // bus on the route.
        expect(json.routes).toBeUndefined();
        expect(json.count).toBeUndefined();
    });

    it('still answers a valid request that follows a rejected one', async () => {
        await search(null, { rawRequirements: ['teleporter'] });

        const { response, journeys } = await search(['wheelchairRamp']);

        expect(response.status).toBe(200);
        expect(orderOf(journeys)).toEqual(['T-FULL', 'T-MOSTLY', 'T-PARTLY']);
    });
});

// ==================================================================
// 6. RESULT INTEGRITY ALONGSIDE THE EXISTING SEARCH CRITERIA
// ==================================================================
describe('accessibility filtering together with the rest of the search', () => {
    it('applies the travel time and the requirements together', async () => {
        const { journeys } = await search(['walkingAssistance'], { travelTime: '09:15' });

        // T-FULL (08:00) and T-ASSIST (09:00) have departed; T-WALKING (09:30)
        // is both upcoming and suitable.
        expect(orderOf(journeys)).toEqual(['T-WALKING']);
    });

    it('applies the boarding and alighting stops and the requirements together', async () => {
        const { json, journeys } = await search(['walkingAssistance'], {
            origin: 'Malabe',
            destination: 'Rajagiriya',
        });

        expect(json.routes[0].journeyStops).toEqual(['Malabe', 'Battaramulla', 'Rajagiriya']);
        expect(orderOf(journeys)).toEqual(['T-FULL', 'T-ASSIST', 'T-WALKING']);
    });

    it('reports honestly when the requirements leave nothing', async () => {
        const { response, json, journeys } = await search(['walkingAssistance'], {
            fleet: ['mostly', 'partly', 'none'],
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        // Not "no route found": routes do run this journey, and no route is
        // returned carrying an empty departure list either.
        expect(json.routes).toEqual([]);
        expect(json.message).toMatch(/accessibility requirements/i);
        expect(journeys).toEqual([]);
    });

    it('returns no route with an empty departure list once filtering is on', async () => {
        const { json } = await search(['walkingAssistance']);

        for (const match of json.routes) {
            expect(match.trips.length).toBeGreaterThan(0);
        }
    });
});
