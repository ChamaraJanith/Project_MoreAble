// Is the recommendation actually right? (MOV-90)
//
// MOV-73 promises a passenger four things: several route options, ordered by how
// accessible they are, each showing its estimated travel time and any transfers.
// Three subtasks built that — MOV-87 the ordering, MOV-89 the score, MOV-88 the
// screen — and each is well covered on its own. This file is about the thing
// none of them can prove alone: that what comes out of the whole pipeline is
// ACCURATE.
//
// The distinction is not academic. MOV-88 shipped with every unit test passing
// and the live screen still showing a full-route arrival time for a partial
// journey, because the defect sat between the tested layers. So the tests here
// deliberately start at the real HTTP endpoint and finish at
// `toRecommendedJourneys` — the object a passenger screen destructures — with no
// hand-built response in between. Everything asserted is something a passenger
// could read off the screen.
//
// Two rules keep these tests honest as the product grows:
//
//   * No accessibility score is ever written down as a number. Expectations come
//     from `computeAccessibilityScore`, and the fixtures are ordered by facility
//     CONTAINMENT, so MOV-79 can widen the formula without silently invalidating
//     an expectation here.
//   * No ranking rule is reimplemented. The expected order is written out as the
//     order a passenger should see, never recomputed with a local comparator
//     that could go wrong in the same way the production one did.
//
// No credential, session value or authentication data is written down here. The
// one test that proves the fleet credential is stripped generates its value with
// the project's existing `nextUniqueValue()` helper.

import { POST } from '../../../app/api/journeys/search+api';
import { Bus } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import {
    RecommendedJourney,
    toRecommendedJourneys,
} from '../../../src/features/journey/utils/journeyRecommendations';
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
    MOSTLY_EQUIPPED,
    NOT_EQUIPPED,
    PARTLY_EQUIPPED,
    Stored,
} from '../../testUtils/journeyFixtures';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

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

// The map providers have no say in which route is recommended.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// A small network, so a recommendation has something to be right ABOUT.
//
// Two routes connect Kaduwela to Borella by different paths, and a third serves
// the same corridor but stops short. Several buses of differing accessibility
// work several departures across them.
//
//   ROUTE-177  Kaduwela -8m- Malabe -6m- Battaramulla -12m- Rajagiriya -15m- Borella -9m- Kollupitiya
//   ROUTE-138  Kaduwela -20m- Battaramulla -18m- Borella
//   ROUTE-101  Kaduwela -11m- Malabe -14m- Battaramulla          (never reaches Borella)
// ------------------------------------------------------------------
const R177 = 'ROUTE-177';
const R138 = 'ROUTE-138';
const R101 = 'ROUTE-101';

const STOPS_177 = [
    'Kaduwela',
    'Malabe',
    'Battaramulla',
    'Rajagiriya',
    'Borella',
    'Kollupitiya',
];
const SEGMENTS_177 = [8, 6, 12, 15, 9];

const STOPS_138 = ['Kaduwela', 'Battaramulla', 'Borella'];
const SEGMENTS_138 = [20, 18];

const STOPS_101 = ['Kaduwela', 'Malabe', 'Battaramulla'];
const SEGMENTS_101 = [11, 14];

/** Coordinates as the `stops` collection holds them, so distance is measurable. */
const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Rajagiriya', 6.9094, 79.8944),
    makeStop('Borella', 6.9147, 79.8778),
    makeStop('Kollupitiya', 6.9167, 79.85),
];

const route177 = makeRoute(R177, STOPS_177, {
    routeNumber: '177',
    distanceKm: 20,
    estimatedDuration: '1h 10m',
    segmentDurationsMinutes: SEGMENTS_177,
});

const route138 = makeRoute(R138, STOPS_138, {
    routeNumber: '138',
    distanceKm: 18,
    estimatedDuration: '40m',
    segmentDurationsMinutes: SEGMENTS_138,
});

const route101 = makeRoute(R101, STOPS_101, {
    routeNumber: '101',
    distanceKm: 9,
    estimatedDuration: '25m',
    segmentDurationsMinutes: SEGMENTS_101,
});

/** Scores, always from the shared function — never written down. */
const scoreOf = computeAccessibilityScore;

interface Network {
    routes?: Stored<Route>[];
    buses?: Stored<Bus>[];
    trips?: Stored<Trip>[];
    stops?: ReturnType<typeof makeStop>[];
}

function storeOf(network: Network) {
    return createFakeFirestore({
        routes: network.routes ?? [route177],
        buses: network.buses ?? [],
        trips: network.trips ?? [],
        stops: network.stops ?? STOP_DOCS,
    });
}

/**
 * Runs the real endpoint and returns the recommendation a passenger screen holds.
 *
 * Nothing is assembled by hand: `json` is the HTTP response body and `journeys`
 * is what `JourneySearchResults` renders from.
 */
async function recommend(
    network: Network,
    criteria: { origin?: string; destination?: string; travelTime?: string } = {}
): Promise<{ json: any; journeys: RecommendedJourney[] }> {
    mockGetAdminDb.mockReturnValue(storeOf(network));

    const response = await POST(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: criteria.origin ?? 'Kaduwela',
                destination: criteria.destination ?? 'Borella',
                travelDate: '2026-08-25',
                travelTime: criteria.travelTime ?? '05:00',
            }),
        })
    );

    const json = await response.json();
    return { json, journeys: toRecommendedJourneys(json.routes ?? []) };
}

/** The recommended order, as trip ids. */
const orderOf = (journeys: RecommendedJourney[]) =>
    journeys.map((journey) => journey.option.trip.tripId);

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
// The fixtures themselves must mean what this file assumes they mean.
// If MOV-79 ever weights the formula so that strictly more facilities score
// worse, every ordering assertion below becomes meaningless — so that is
// checked once, here, rather than assumed in thirty places.
// ==================================================================
describe('the fixtures used to rank', () => {
    it('scores strictly better equipment strictly higher', () => {
        expect(scoreOf(FULLY_EQUIPPED)).toBeGreaterThan(scoreOf(MOSTLY_EQUIPPED));
        expect(scoreOf(MOSTLY_EQUIPPED)).toBeGreaterThan(scoreOf(PARTLY_EQUIPPED));
        expect(scoreOf(PARTLY_EQUIPPED)).toBeGreaterThan(scoreOf(NOT_EQUIPPED));
    });

    it('treats a bus with nothing recorded as a measured zero', () => {
        // Zero is a measurement: the vehicle was assessed and has no facilities.
        // It is not the same as a score nobody could establish.
        expect(scoreOf(NOT_EQUIPPED)).toBe(0);
    });
});

// ==================================================================
// A. ACCESSIBILITY RANKING, END TO END
// ==================================================================
describe('A. the order a passenger is given', () => {
    it('offers every travellable departure, not just the best one', async () => {
        const { journeys } = await recommend({
            routes: [route177, route138],
            buses: [
                makeBus('BUS-HIGH', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-LOW', 'NB-2222', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-177-A', R177, 'BUS-LOW', '06:00'),
                makeTrip('T-177-B', R177, 'BUS-HIGH', '09:00'),
                makeTrip('T-138-A', R138, 'BUS-HIGH', '07:00'),
            ],
        });

        // A passenger must be able to compare; ranking is not a filter.
        expect(journeys).toHaveLength(3);
        expect(orderOf(journeys).slice().sort()).toEqual(['T-138-A', 'T-177-A', 'T-177-B']);
    });

    it('recommends the accessible bus first even though the other leaves 3 hours earlier', async () => {
        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-HIGH', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-LOW', 'NB-2222', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-EARLY-INACCESSIBLE', R177, 'BUS-LOW', '06:00'),
                makeTrip('T-LATER-ACCESSIBLE', R177, 'BUS-HIGH', '09:00'),
            ],
        });

        // The whole point of the story: accessibility outranks convenience.
        expect(orderOf(journeys)).toEqual(['T-LATER-ACCESSIBLE', 'T-EARLY-INACCESSIBLE']);
    });

    it('orders four differently equipped buses from most to least accessible', async () => {
        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-PARTLY', 'NB-3333', PARTLY_EQUIPPED),
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
                makeBus('BUS-MOSTLY', 'NB-2222', MOSTLY_EQUIPPED),
            ],
            trips: [
                // Departure order is deliberately the REVERSE of the accessibility
                // order, so a lingering "soonest first" cannot look correct.
                makeTrip('T-NONE', R177, 'BUS-NONE', '06:00'),
                makeTrip('T-PARTLY', R177, 'BUS-PARTLY', '07:00'),
                makeTrip('T-MOSTLY', R177, 'BUS-MOSTLY', '08:00'),
                makeTrip('T-FULLY', R177, 'BUS-FULLY', '09:00'),
            ],
        });

        expect(orderOf(journeys)).toEqual(['T-FULLY', 'T-MOSTLY', 'T-PARTLY', 'T-NONE']);
    });

    it('never recommends the least accessible option first', async () => {
        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-NONE', R177, 'BUS-NONE', '06:00'),
                makeTrip('T-FULLY', R177, 'BUS-FULLY', '07:00'),
            ],
        });

        // Stated as a property rather than an order, so a reversed comparator
        // fails here even if some future rule changes the exact sequence.
        expect(journeys[0].accessibilityScore).toBe(scoreOf(FULLY_EQUIPPED));
        expect(journeys[journeys.length - 1].accessibilityScore).toBe(scoreOf(NOT_EQUIPPED));
    });

    it('never lets a score decrease as the list goes down', async () => {
        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-A', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-B', 'NB-2222', MOSTLY_EQUIPPED),
                makeBus('BUS-C', 'NB-3333', PARTLY_EQUIPPED),
                makeBus('BUS-D', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-C', R177, 'BUS-C', '06:00'),
                makeTrip('T-A', R177, 'BUS-A', '06:30'),
                makeTrip('T-D', R177, 'BUS-D', '07:00'),
                makeTrip('T-B', R177, 'BUS-B', '07:30'),
            ],
        });

        const scores = journeys.map((journey) => journey.accessibilityScore as number);

        // Monotonically non-increasing, checked pairwise: this is the ranking
        // requirement stated directly, independent of any particular fixture.
        for (let i = 1; i < scores.length; i++) {
            expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
        }
    });

    it('ranks a measured zero above a score that could not be established', async () => {
        const { journeys } = await recommend({
            buses: [makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED)],
            trips: [
                // No bus record exists for this one, so nothing could be measured.
                makeTrip('T-UNKNOWN', R177, 'BUS-MISSING', '06:00'),
                makeTrip('T-ZERO', R177, 'BUS-NONE', '09:00'),
            ],
        });

        expect(orderOf(journeys)).toEqual(['T-ZERO', 'T-UNKNOWN']);
        expect(journeys[0].accessibilityScore).toBe(0);
        expect(journeys[1].accessibilityScore).toBeNull();
    });

    it('keeps an unmeasurable option last but still offers it', async () => {
        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-UNKNOWN', R177, 'BUS-MISSING', '06:00'),
                makeTrip('T-FULLY', R177, 'BUS-FULLY', '07:00'),
                makeTrip('T-NONE', R177, 'BUS-NONE', '08:00'),
            ],
        });

        // Last, because "we do not know" is not evidence of being good — but
        // present, because a passenger is still entitled to see the departure.
        expect(orderOf(journeys)).toEqual(['T-FULLY', 'T-NONE', 'T-UNKNOWN']);
    });
});

// ==================================================================
// B. EVERY SCORE BELONGS TO ITS OWN VEHICLE
//
// A score paired with the wrong bus would send a wheelchair user to a vehicle
// that cannot carry them, and the response would look perfectly well-formed.
// ==================================================================
describe('B. each recommendation carries its own bus score', () => {
    /**
     * Fleet order, trip order, departure order and accessibility order are all
     * deliberately different from one another. Any code that pairs a score with
     * a vehicle by array position rather than by `busId` gets a different answer
     * from every one of these orderings.
     */
    const crossedOrdering: Network = {
        buses: [
            makeBus('BUS-Z', 'NB-9999', PARTLY_EQUIPPED),
            makeBus('BUS-A', 'NB-1111', NOT_EQUIPPED),
            makeBus('BUS-M', 'NB-5555', FULLY_EQUIPPED),
        ],
        trips: [
            makeTrip('T-3', R177, 'BUS-M', '08:00'),
            makeTrip('T-1', R177, 'BUS-Z', '06:00'),
            makeTrip('T-2', R177, 'BUS-A', '07:00'),
        ],
    };

    it('pairs each trip with the bus its own busId names', async () => {
        const { journeys } = await recommend(crossedOrdering);

        const byTrip = new Map(
            journeys.map((journey) => [journey.option.trip.tripId, journey.option.bus?.busId])
        );

        expect(byTrip.get('T-1')).toBe('BUS-Z');
        expect(byTrip.get('T-2')).toBe('BUS-A');
        expect(byTrip.get('T-3')).toBe('BUS-M');
    });

    it('gives each recommendation the score of that same bus', async () => {
        const { journeys } = await recommend(crossedOrdering);

        const byTrip = new Map(
            journeys.map((journey) => [journey.option.trip.tripId, journey.accessibilityScore])
        );

        expect(byTrip.get('T-1')).toBe(scoreOf(PARTLY_EQUIPPED));
        expect(byTrip.get('T-2')).toBe(scoreOf(NOT_EQUIPPED));
        expect(byTrip.get('T-3')).toBe(scoreOf(FULLY_EQUIPPED));
    });

    it('ranks that crossed ordering by score, not by any of the array orders', async () => {
        const { journeys } = await recommend(crossedOrdering);

        // Fleet order would give Z, A, M. Trip order would give 3, 1, 2.
        // Departure order would give T-1, T-2, T-3. Accessibility gives:
        expect(orderOf(journeys)).toEqual(['T-3', 'T-1', 'T-2']);
    });

    it('keeps the number plate and the score on the same vehicle', async () => {
        const { journeys } = await recommend(crossedOrdering);

        for (const journey of journeys) {
            const expected = journey.option.bus
                ? scoreOf(journey.option.bus.accessibilityFacilities)
                : null;

            // The score on the option and the score its own facilities imply must
            // agree — a leak from a neighbouring bus breaks this even when the
            // ordering happens to come out right.
            expect(journey.accessibilityScore).toBe(expected);
        }
    });

    it('gives two departures on one bus the same score without merging them', async () => {
        const { journeys } = await recommend({
            buses: [makeBus('BUS-SHARED', 'NB-1111', MOSTLY_EQUIPPED)],
            trips: [
                makeTrip('T-MORNING', R177, 'BUS-SHARED', '06:00', { turnNumber: 1 }),
                makeTrip('T-EVENING', R177, 'BUS-SHARED', '18:00', { turnNumber: 2 }),
            ],
        });

        expect(journeys).toHaveLength(2);
        expect(journeys.map((journey) => journey.accessibilityScore)).toEqual([
            scoreOf(MOSTLY_EQUIPPED),
            scoreOf(MOSTLY_EQUIPPED),
        ]);
        // Equal scores, so the existing departure-time rule decides.
        expect(orderOf(journeys)).toEqual(['T-MORNING', 'T-EVENING']);
    });

    it('scores buses on different routes independently', async () => {
        const { journeys } = await recommend({
            routes: [route177, route138],
            buses: [
                makeBus('BUS-ON-177', 'NB-1111', NOT_EQUIPPED),
                makeBus('BUS-ON-138', 'NB-2222', FULLY_EQUIPPED),
            ],
            trips: [
                makeTrip('T-177', R177, 'BUS-ON-177', '06:00'),
                makeTrip('T-138', R138, 'BUS-ON-138', '06:00'),
            ],
        });

        // The better bus is on the other route, so a recommendation that only
        // ever ranks within one route would fail here.
        expect(orderOf(journeys)).toEqual(['T-138', 'T-177']);
        expect(journeys[0].route.routeId).toBe(R138);
    });
});

// ==================================================================
// C. THE JOURNEY DATA ON EACH RECOMMENDATION IS STILL RIGHT
//
// Ranking must not disturb what each option says about itself, and a partial
// journey must keep showing its own figures rather than the route's.
// ==================================================================
describe('C. journey data survives ranking', () => {
    const twoBuses: Network = {
        buses: [
            makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
            makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
        ],
        trips: [
            makeTrip('T-NONE', R177, 'BUS-NONE', '06:00'),
            makeTrip('T-FULLY', R177, 'BUS-FULLY', '09:00'),
        ],
    };

    it('keeps each option scheduled departure attached to that option', async () => {
        const { journeys } = await recommend(twoBuses);

        const byTrip = new Map(
            journeys.map((journey) => [
                journey.option.trip.tripId,
                journey.option.trip.departureTime,
            ])
        );

        // Reordering must not shuffle the times along with the options.
        expect(byTrip.get('T-NONE')).toBe('06:00');
        expect(byTrip.get('T-FULLY')).toBe('09:00');
    });

    it('measures a partial journey from its own segments', async () => {
        // Kaduwela -> Borella on route 177 is 8 + 6 + 12 + 15 = 41 minutes, and
        // stops short of Kollupitiya.
        const { journeys } = await recommend(twoBuses);

        for (const journey of journeys) {
            expect(journey.timing.durationMinutes).toBe(41);
            expect(journey.display.durationLabel).toBe('41m');
        }
    });

    it('does not fall back to the full-route arrival time', async () => {
        const { journeys } = await recommend({
            ...twoBuses,
            trips: [makeTrip('T-ONLY', R177, 'BUS-FULLY', '06:00', {
                // The bus runs to Kollupitiya and arrives there at 07:10.
                estimatedArrivalTime: '07:10',
            })],
        });

        // The passenger alights at Borella at 06:41, nine minutes earlier.
        expect(journeys[0].display.arrivalLabel).toBe('6:41 AM');
        expect(journeys[0].display.arrivalLabel).not.toBe('7:10 AM');
    });

    it('does not fall back to the full-route distance', async () => {
        const { journeys, json } = await recommend(twoBuses);

        // The route records 20 km end to end; this journey stops at Borella.
        expect(json.routes[0].distanceKm).toBe(20);
        expect(journeys[0].display.distanceLabel).not.toBe('20 km');
        expect(json.routes[0].journeyDistanceKm).toBeLessThan(20);
    });

    it('counts the stops on the journey, not on the route', async () => {
        const { journeys } = await recommend(twoBuses);

        // Kaduwela..Borella is five of the route's six stops.
        for (const journey of journeys) {
            expect(journey.display.stopCount).toBe(5);
        }
    });

    it('gives each route its own journey figures in one ranked list', async () => {
        const { journeys } = await recommend({
            routes: [route177, route138],
            buses: [makeBus('BUS-SAME', 'NB-1111', MOSTLY_EQUIPPED)],
            trips: [
                makeTrip('T-177', R177, 'BUS-SAME', '06:00'),
                makeTrip('T-138', R138, 'BUS-SAME', '06:00'),
            ],
        });

        const byTrip = new Map(
            journeys.map((journey) => [
                journey.option.trip.tripId,
                journey.timing.durationMinutes,
            ])
        );

        // 8 + 6 + 12 + 15 on 177, against 20 + 18 on 138. Equal scores and equal
        // departures, so the two sit side by side — and must not share a figure.
        expect(byTrip.get('T-177')).toBe(41);
        expect(byTrip.get('T-138')).toBe(38);
    });

    it('still excludes departures the existing search filters out', async () => {
        const { journeys } = await recommend(
            {
                buses: [makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED)],
                trips: [
                    makeTrip('T-DEPARTED', R177, 'BUS-FULLY', '05:00'),
                    makeTrip('T-INACTIVE', R177, 'BUS-FULLY', '10:00', { status: 'INACTIVE' }),
                    makeTrip('T-AVAILABLE', R177, 'BUS-FULLY', '11:00'),
                ],
            },
            { travelTime: '09:00' }
        );

        // Ranking reorders what the search returned; it must never resurrect a
        // departure the search excluded, however accessible its bus.
        expect(orderOf(journeys)).toEqual(['T-AVAILABLE']);
    });

    it('recommends nothing when no route connects the two places', async () => {
        const { json, journeys } = await recommend({
            // 101 stops at Battaramulla and never reaches Borella.
            routes: [route101],
            buses: [makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED)],
            trips: [makeTrip('T-101', R101, 'BUS-FULLY', '06:00')],
        });

        expect(json.routes).toEqual([]);
        expect(journeys).toEqual([]);
    });
});

// ==================================================================
// D. WHAT THE PASSENGER-FACING MODEL ACTUALLY HOLDS
// ==================================================================
describe('D. the recommendation handed to the screen', () => {
    it('leads with a journey that is both the most accessible and correctly measured', async () => {
        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-NONE', R177, 'BUS-NONE', '06:00'),
                makeTrip('T-FULLY', R177, 'BUS-FULLY', '09:00', {
                    estimatedArrivalTime: '10:10',
                }),
            ],
        });

        const top = journeys[0];

        // Accuracy is both halves at once: the right option, described rightly.
        expect(top.option.trip.tripId).toBe('T-FULLY');
        expect(top.accessibilityScore).toBe(scoreOf(FULLY_EQUIPPED));
        expect(top.display.departureLabel).toBe('9:00 AM');
        expect(top.display.arrivalLabel).toBe('9:41 AM');
        expect(top.display.durationLabel).toBe('41m');
        expect(top.display.stopCount).toBe(5);
        expect(top.timing.transferCount).toBe(0);
    });

    it('gives every recommendation a key unique to its route and trip', async () => {
        const { journeys } = await recommend({
            routes: [route177, route138],
            buses: [makeBus('BUS-SAME', 'NB-1111', MOSTLY_EQUIPPED)],
            trips: [
                makeTrip('T-177', R177, 'BUS-SAME', '06:00'),
                makeTrip('T-138', R138, 'BUS-SAME', '07:00'),
            ],
        });

        expect(new Set(journeys.map((journey) => journey.key)).size).toBe(journeys.length);
    });

    it('reports no duration rather than inventing one when the route is untimed', async () => {
        const { journeys } = await recommend({
            routes: [makeRoute(R177, STOPS_177, {
                routeNumber: '177',
                distanceKm: 20,
                estimatedDuration: '1h 10m',
                segmentDurationsMinutes: null,
            })],
            buses: [makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED)],
            trips: [makeTrip('T-ONLY', R177, 'BUS-FULLY', '06:00', {
                estimatedArrivalTime: '07:10',
            })],
        });

        // Kaduwela -> Borella is a partial journey, so the route's own 1h 10m to
        // Kollupitiya is not this passenger's and nothing may stand in for it.
        expect(journeys[0].display.durationLabel).toBeNull();
        expect(journeys[0].timing.durationMinutes).toBeNull();
        expect(journeys[0].timing.source).toBe('UNKNOWN');
    });

    it('still ranks and still offers an option it could not measure', async () => {
        const { journeys } = await recommend({
            routes: [
                makeRoute(R177, STOPS_177, {
                    routeNumber: '177',
                    distanceKm: 20,
                    segmentDurationsMinutes: null,
                }),
                route138,
            ],
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-177-UNTIMED', R177, 'BUS-FULLY', '06:00'),
                makeTrip('T-138-TIMED', R138, 'BUS-NONE', '06:00'),
            ],
        });

        // An unmeasurable duration says nothing about accessibility, so it must
        // not push the option down the list.
        expect(orderOf(journeys)).toEqual(['T-177-UNTIMED', 'T-138-TIMED']);
        expect(journeys[0].display.durationLabel).toBeNull();
        expect(journeys[1].display.durationLabel).toBe('38m');
    });
});

// ==================================================================
// E. TIES AND DETERMINISM
// ==================================================================
describe('E. two searches of the same data agree', () => {
    const equalScores: Network = {
        buses: [makeBus('BUS-SAME', 'NB-1111', MOSTLY_EQUIPPED)],
        trips: [
            makeTrip('T-LATE', R177, 'BUS-SAME', '18:00'),
            makeTrip('T-EARLY', R177, 'BUS-SAME', '07:00'),
            makeTrip('T-MIDDAY', R177, 'BUS-SAME', '12:00'),
        ],
    };

    it('falls back to the earliest departure when accessibility ties', async () => {
        const { journeys } = await recommend(equalScores);

        expect(orderOf(journeys)).toEqual(['T-EARLY', 'T-MIDDAY', 'T-LATE']);
    });

    it('settles an equal score and equal departure on route then trip identity', async () => {
        const { journeys } = await recommend({
            routes: [route138, route177],
            buses: [makeBus('BUS-SAME', 'NB-1111', MOSTLY_EQUIPPED)],
            trips: [
                makeTrip('T-9', R177, 'BUS-SAME', '06:00'),
                makeTrip('T-1', R138, 'BUS-SAME', '06:00'),
            ],
        });

        // ROUTE-138 sorts before ROUTE-177, and nothing above them separates the
        // two. Not a preference — a guarantee that the same search cannot come
        // back in two different orders.
        expect(orderOf(journeys)).toEqual(['T-1', 'T-9']);
    });

    it('ranks the same however the database returned the documents', async () => {
        const buses = [
            makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
            makeBus('BUS-MOSTLY', 'NB-2222', MOSTLY_EQUIPPED),
            makeBus('BUS-PARTLY', 'NB-3333', PARTLY_EQUIPPED),
            makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
        ];

        const trips = [
            makeTrip('T-A', R177, 'BUS-PARTLY', '06:00'),
            makeTrip('T-B', R177, 'BUS-FULLY', '07:00'),
            makeTrip('T-C', R177, 'BUS-NONE', '08:00'),
            makeTrip('T-D', R177, 'BUS-MOSTLY', '09:00'),
        ];

        // Firestore makes no promise about document order, so the recommendation
        // must not inherit one.
        const forwards = await recommend({ buses, trips });
        const reversed = await recommend({
            buses: [...buses].reverse(),
            trips: [...trips].reverse(),
        });

        expect(orderOf(forwards.journeys)).toEqual(['T-B', 'T-D', 'T-A', 'T-C']);
        expect(orderOf(reversed.journeys)).toEqual(orderOf(forwards.journeys));
    });

    it('ranks the same however tied documents were returned', async () => {
        // Everything ties on score and departure, so only identity separates
        // them — the case where an unstable order would actually show.
        const trips = [
            makeTrip('T-C', R177, 'BUS-SAME', '06:00'),
            makeTrip('T-A', R177, 'BUS-SAME', '06:00'),
            makeTrip('T-B', R177, 'BUS-SAME', '06:00'),
        ];

        const buses = [makeBus('BUS-SAME', 'NB-1111', MOSTLY_EQUIPPED)];

        const forwards = await recommend({ buses, trips });
        const reversed = await recommend({ buses, trips: [...trips].reverse() });

        expect(orderOf(forwards.journeys)).toEqual(['T-A', 'T-B', 'T-C']);
        expect(orderOf(reversed.journeys)).toEqual(orderOf(forwards.journeys));
    });

    it('returns the same result when the same search runs twice', async () => {
        const first = await recommend(equalScores);
        const second = await recommend(equalScores);

        expect(orderOf(second.journeys)).toEqual(orderOf(first.journeys));
    });

    it('loses and duplicates nothing while ranking', async () => {
        const { json, journeys } = await recommend({
            routes: [route177, route138],
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-177-A', R177, 'BUS-NONE', '06:00'),
                makeTrip('T-177-B', R177, 'BUS-FULLY', '07:00'),
                makeTrip('T-138-A', R138, 'BUS-FULLY', '08:00'),
                makeTrip('T-138-B', R138, 'BUS-NONE', '09:00'),
                makeTrip('T-ORPHAN', R177, 'BUS-MISSING', '10:00'),
            ],
        });

        // Counted against what the search itself returned, so this measures the
        // ranking layer rather than restating the fixture.
        const returned = json.routes.flatMap((match: any) =>
            match.trips.map((option: any) => option.trip.tripId)
        );

        expect(journeys).toHaveLength(returned.length);
        expect(orderOf(journeys).slice().sort()).toEqual(returned.slice().sort());
        expect(new Set(orderOf(journeys)).size).toBe(journeys.length);
    });
});

// ==================================================================
// F. TRANSFERS
//
// The parent story asks for transfers to be shown "if any". `findMatchingRoutes`
// only matches a route that serves BOTH the origin and the destination with the
// origin first, so every journey the search can currently produce is a single
// ride on one vehicle. That is a property of the search, not an assumption made
// here, and it is what these tests pin down.
//
// The multi-leg arithmetic in `resolveJourneyTiming` is exercised directly in
// journeyTiming.test.ts. It is deliberately NOT exercised through this file:
// doing so would mean fabricating an interchange the production search cannot
// return, and a test built on invented data would go on passing after a real
// interchange feature got it wrong.
// ==================================================================
describe('F. transfers on a recommendation', () => {
    it('reports every current recommendation as direct', async () => {
        const { journeys } = await recommend({
            routes: [route177, route138],
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('T-177', R177, 'BUS-NONE', '06:00'),
                makeTrip('T-138', R138, 'BUS-FULLY', '07:00'),
            ],
        });

        for (const journey of journeys) {
            // Zero is a measured answer here — one leg means no change of bus —
            // rather than a count nobody worked out.
            expect(journey.timing.transferCount).toBe(0);
            expect(journey.timing.transferWaitMinutes).toEqual([]);
            expect(journey.timing.perLeg).toHaveLength(1);
        }
    });

    it('builds that single leg from the route the passenger stays on', async () => {
        const { journeys } = await recommend(
            {
                buses: [makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED)],
                trips: [makeTrip('T-ONLY', R177, 'BUS-FULLY', '06:00')],
            },
            { origin: 'Malabe', destination: 'Rajagiriya' }
        );

        expect(journeys[0].timing.perLeg[0].travelledStops).toEqual([
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
        ]);
        expect(journeys[0].timing.transferCount).toBe(0);
    });
});

// ==================================================================
// G. WHAT A RECOMMENDATION MUST NOT CARRY
// ==================================================================
describe('G. nothing private travels with a recommendation', () => {
    it('keeps the vehicle fields to the agreed list', async () => {
        const { journeys } = await recommend({
            buses: [makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED)],
            trips: [makeTrip('T-ONLY', R177, 'BUS-FULLY', '06:00')],
        });

        // Asserted on the object the screen holds, not only on the HTTP body, so
        // a field re-attached during ranking would be caught too.
        expect(Object.keys(journeys[0].option.bus as object).sort()).toEqual([
            'accessibilityFacilities',
            'accessibilityScore',
            'busId',
            'busModel',
            'manufacturer',
            'numberPlate',
            'seatCapacity',
        ]);
    });

    it('leaves the fleet credential and internal columns behind', async () => {
        // Generated, never written down — the project's existing scanner-safe
        // helper, so no credential-shaped literal enters the repository.
        const configured = nextUniqueValue();

        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED, {
                    password: configured,
                    chassisNumber: 'CHS-INTERNAL',
                }),
            ],
            trips: [makeTrip('T-ONLY', R177, 'BUS-FULLY', '06:00')],
        });

        const whole = JSON.stringify(journeys);

        expect(whole).not.toContain(configured);
        expect(whole).not.toContain('CHS-INTERNAL');
        expect((journeys[0].option.bus as any).password).toBeUndefined();
    });

    it('carries no credential through any option of a multi-bus recommendation', async () => {
        const first = nextUniqueValue();
        const second = nextUniqueValue();

        const { journeys } = await recommend({
            buses: [
                makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED, { password: first }),
                makeBus('BUS-NONE', 'NB-4444', NOT_EQUIPPED, { password: second }),
            ],
            trips: [
                makeTrip('T-NONE', R177, 'BUS-NONE', '06:00'),
                makeTrip('T-FULLY', R177, 'BUS-FULLY', '07:00'),
            ],
        });

        const whole = JSON.stringify(journeys);

        expect(whole).not.toContain(first);
        expect(whole).not.toContain(second);
    });
});
