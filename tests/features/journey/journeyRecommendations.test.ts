// What the Recommended Routes screen is handed, and in what order (MOV-88).
//
// The parent story asks for multiple route options, ranked by accessibility,
// with the estimated travel time and any transfers shown. This file covers the
// view model those four requirements land in — the piece between the search
// response and the cards, which is where a route could silently be dropped, put
// in the wrong order, or given the wrong journey time.
//
// Nothing here re-implements a rule it is checking. The order comes from MOV-87's
// `rankJourneyOptions` and the score from MOV-89's `accessibilityScore`, so the
// expectations are written as the order a passenger should see rather than as a
// re-run of the comparator. The accessibility scores in the fixtures are plain
// numbers, deliberately: this file must keep passing when MOV-79 widens what
// produces them.

import {
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../src/entities/route/model/types';
import { toRecommendedJourneys } from '../../../src/features/journey/utils/journeyRecommendations';

// ------------------------------------------------------------------
// Fixtures
//
//   Kaduwela --8m--> Malabe --6m--> Battaramulla --12m--> Rajagiriya --15m--> Borella
// ------------------------------------------------------------------
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'];
const SEGMENTS = [8, 6, 12, 15];

interface OptionSpec {
    tripId: string;
    departureTime?: string;
    /** Undefined means the bus record is missing, so no score exists. */
    accessibilityScore?: number;
}

function option(spec: OptionSpec): JourneySearchOption {
    return {
        trip: {
            tripId: spec.tripId,
            departureTime: spec.departureTime ?? '09:00',
            estimatedArrivalTime: '09:41',
            turnNumber: 1,
        },
        bus:
            spec.accessibilityScore === undefined
                ? null
                : ({
                      busId: `BUS-${spec.tripId}`,
                      numberPlate: `NB-${spec.tripId}`,
                      busModel: 'Ashok Leyland Viking',
                      manufacturer: 'Ashok Leyland',
                      seatCapacity: 54,
                      accessibilityFacilities: {} as never,
                      accessibilityScore: spec.accessibilityScore,
                  } as JourneySearchOption['bus']),
        liveStatus: { available: false },
    };
}

interface RouteSpec {
    routeId?: string;
    routeNumber?: string;
    origin?: string;
    destination?: string;
    segmentDurationsMinutes?: (number | null)[] | null;
    trips: OptionSpec[];
}

function match(spec: RouteSpec): JourneySearchMatch {
    const origin = spec.origin ?? 'Kaduwela';
    const destination = spec.destination ?? 'Borella';

    const originIndex = STOPS.indexOf(origin);
    const destinationIndex = STOPS.indexOf(destination);

    return {
        routeId: spec.routeId ?? '177_KADUWELA_KOLLUPITIYA',
        routeNumber: spec.routeNumber ?? '177',
        routeName: 'Kaduwela - Kollupitiya',
        startLocation: 'Kaduwela',
        endLocation: 'Borella',
        origin,
        destination,
        stops: STOPS,
        // Built the way the search builds it, so the fixture cannot disagree
        // with the response shape the screen actually receives.
        journeyStops: STOPS.slice(originIndex, destinationIndex + 1),
        distanceKm: 22.5,
        estimatedDuration: '1h 15m',
        segmentDurationsMinutes:
            spec.segmentDurationsMinutes === undefined ? SEGMENTS : spec.segmentDurationsMinutes,
        trips: spec.trips.map(option),
    };
}

const tripIds = (routes: JourneySearchMatch[]) =>
    toRecommendedJourneys(routes).map((journey) => journey.option.trip.tripId);

// ==================================================================
// A. MULTIPLE OPTIONS ARE OFFERED
// ==================================================================
describe('every travellable option reaches the passenger', () => {
    it('offers one option per departure across every matched route', () => {
        const routes = [
            match({ routeId: 'ROUTE-A', trips: [{ tripId: 'A1' }, { tripId: 'A2' }] }),
            match({ routeId: 'ROUTE-B', trips: [{ tripId: 'B1' }] }),
        ];

        expect(tripIds(routes)).toHaveLength(3);
        expect(tripIds(routes).sort()).toEqual(['A1', 'A2', 'B1']);
    });

    it('keeps two departures on the same route separately comparable', () => {
        const routes = [
            match({
                trips: [
                    { tripId: 'MORNING', departureTime: '07:30' },
                    { tripId: 'EVENING', departureTime: '18:00' },
                ],
            }),
        ];

        expect(tripIds(routes)).toHaveLength(2);
    });

    it('gives every option a key unique to its route and trip', () => {
        const routes = [
            match({ routeId: 'ROUTE-A', trips: [{ tripId: 'SHARED' }] }),
            match({ routeId: 'ROUTE-B', trips: [{ tripId: 'SHARED' }] }),
        ];

        const keys = toRecommendedJourneys(routes).map((journey) => journey.key);

        expect(new Set(keys).size).toBe(2);
    });

    it('returns nothing for a route that matched but has no departure', () => {
        expect(toRecommendedJourneys([match({ trips: [] })])).toEqual([]);
    });

    it('survives a missing or malformed response', () => {
        expect(toRecommendedJourneys(null)).toEqual([]);
        expect(toRecommendedJourneys(undefined)).toEqual([]);
        expect(
            toRecommendedJourneys([{ ...match({ trips: [] }), trips: undefined as never }])
        ).toEqual([]);
    });
});

// ==================================================================
// B. RANKED BY ACCESSIBILITY (MOV-87)
// ==================================================================
describe('recommended order', () => {
    it('puts the most accessible departure first', () => {
        const routes = [
            match({
                trips: [
                    { tripId: 'LOW', accessibilityScore: 25 },
                    { tripId: 'HIGH', accessibilityScore: 88 },
                ],
            }),
        ];

        expect(tripIds(routes)).toEqual(['HIGH', 'LOW']);
    });

    it('ranks by accessibility ahead of departure time', () => {
        // The least accessible bus leaves first, so "soonest first" and
        // "recommended" genuinely disagree here.
        const routes = [
            match({
                trips: [
                    { tripId: 'EARLY_INACCESSIBLE', departureTime: '06:00', accessibilityScore: 13 },
                    { tripId: 'LATER_ACCESSIBLE', departureTime: '18:00', accessibilityScore: 88 },
                ],
            }),
        ];

        expect(tripIds(routes)).toEqual(['LATER_ACCESSIBLE', 'EARLY_INACCESSIBLE']);
    });

    it('breaks a tie on accessibility with the earliest departure', () => {
        const routes = [
            match({
                trips: [
                    { tripId: 'AFTERNOON', departureTime: '14:45', accessibilityScore: 50 },
                    { tripId: 'MORNING', departureTime: '08:05', accessibilityScore: 50 },
                ],
            }),
        ];

        expect(tripIds(routes)).toEqual(['MORNING', 'AFTERNOON']);
    });

    it('breaks a remaining tie reproducibly on route then trip', () => {
        const routes = [
            match({ routeId: 'ROUTE-B', trips: [{ tripId: 'T2', accessibilityScore: 50 }] }),
            match({ routeId: 'ROUTE-A', trips: [{ tripId: 'T1', accessibilityScore: 50 }] }),
        ];

        expect(tripIds(routes)).toEqual(['T1', 'T2']);
    });

    it('ranks an option with no known score below every measured one', () => {
        const routes = [
            match({
                trips: [
                    { tripId: 'UNKNOWN' },
                    { tripId: 'MEASURED_LOW', accessibilityScore: 13 },
                ],
            }),
        ];

        expect(tripIds(routes)).toEqual(['MEASURED_LOW', 'UNKNOWN']);
    });

    it('treats a measured zero as a measurement, above an unknown', () => {
        const routes = [
            match({
                trips: [{ tripId: 'UNKNOWN' }, { tripId: 'ZERO', accessibilityScore: 0 }],
            }),
        ];

        expect(tripIds(routes)).toEqual(['ZERO', 'UNKNOWN']);
    });

    it('reads the score off the bus without recomputing it', () => {
        const journeys = toRecommendedJourneys([
            match({ trips: [{ tripId: 'SCORED', accessibilityScore: 63 }, { tripId: 'NO_BUS' }] }),
        ]);

        expect(journeys[0].accessibilityScore).toBe(63);
        // A departure whose bus record is missing has no score at all — that is
        // unknown, and MOV-87 ranks it last rather than calling it zero.
        expect(journeys[1].accessibilityScore).toBeNull();
    });
});

// ==================================================================
// C. RANKING REORDERS, IT NEVER FILTERS
// ==================================================================
describe('nothing is lost to ranking', () => {
    it('returns every option it was given, exactly once', () => {
        const routes = [
            match({
                routeId: 'ROUTE-A',
                trips: [
                    { tripId: 'A1', accessibilityScore: 13 },
                    { tripId: 'A2', accessibilityScore: 88 },
                    { tripId: 'A3' },
                ],
            }),
            match({
                routeId: 'ROUTE-B',
                trips: [
                    { tripId: 'B1', accessibilityScore: 0 },
                    { tripId: 'B2', accessibilityScore: 50 },
                ],
            }),
        ];

        expect(tripIds(routes).sort()).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
    });

    it('keeps the least accessible option available for comparison', () => {
        const routes = [
            match({
                trips: [
                    { tripId: 'WORST', accessibilityScore: 0 },
                    { tripId: 'BEST', accessibilityScore: 100 },
                ],
            }),
        ];

        expect(tripIds(routes)).toContain('WORST');
    });

    it('keeps an option whose journey time could not be established', () => {
        const routes = [
            match({
                origin: 'Malabe',
                segmentDurationsMinutes: null,
                trips: [{ tripId: 'UNTIMED', accessibilityScore: 88 }],
            }),
        ];

        const journeys = toRecommendedJourneys(routes);

        expect(journeys).toHaveLength(1);
        expect(journeys[0].timing.durationMinutes).toBeNull();
    });

    it('does not mutate the response it was given', () => {
        const routes = [
            match({
                trips: [
                    { tripId: 'LOW', accessibilityScore: 13 },
                    { tripId: 'HIGH', accessibilityScore: 88 },
                ],
            }),
        ];

        const before = routes[0].trips.map((entry) => entry.trip.tripId);
        toRecommendedJourneys(routes);

        expect(routes[0].trips.map((entry) => entry.trip.tripId)).toEqual(before);
    });
});

// ==================================================================
// D. THE ESTIMATED TRAVEL TIME ON EACH CARD
//
// The point of MOV-88: what the card shows must be the passenger's journey, not
// the route's total. Checked through the view model, on the same response shape
// the screen receives.
// ==================================================================
describe('the journey time carried on each option', () => {
    it('gives a whole-route search the whole route', () => {
        const journeys = toRecommendedJourneys([match({ trips: [{ tripId: 'T1' }] })]);

        expect(journeys[0].timing.durationMinutes).toBe(41);
        expect(journeys[0].timing.durationLabel).toBe('41m');
    });

    it('gives an intermediate boarder only their own journey', () => {
        const journeys = toRecommendedJourneys([
            match({ origin: 'Malabe', trips: [{ tripId: 'T1' }] }),
        ]);

        expect(journeys[0].timing.durationMinutes).toBe(33);
    });

    it('does not give a Battaramulla to Rajagiriya search the route total', () => {
        const journeys = toRecommendedJourneys([
            match({ origin: 'Battaramulla', destination: 'Rajagiriya', trips: [{ tripId: 'T1' }] }),
        ]);

        expect(journeys[0].timing.durationMinutes).toBe(12);
        expect(journeys[0].timing.durationMinutes).not.toBe(41);
    });

    it('places the boarding time at the passenger own stop', () => {
        const journeys = toRecommendedJourneys([
            match({ origin: 'Malabe', trips: [{ tripId: 'T1' }] }),
        ]);

        // The trip leaves Kaduwela at 09:00 and reaches Malabe 8 minutes later.
        expect(journeys[0].timing.boardingTime).toBe('09:08');
    });

    it('measures each option against its own route timings', () => {
        const journeys = toRecommendedJourneys([
            match({
                routeId: 'FAST',
                origin: 'Malabe',
                segmentDurationsMinutes: [8, 4, 6, 5],
                trips: [{ tripId: 'FAST-1', accessibilityScore: 50 }],
            }),
            match({
                routeId: 'SLOW',
                origin: 'Malabe',
                segmentDurationsMinutes: [8, 10, 20, 25],
                trips: [{ tripId: 'SLOW-1', accessibilityScore: 50 }],
            }),
        ]);

        const byTrip = new Map(
            journeys.map((journey) => [journey.option.trip.tripId, journey.timing.durationMinutes])
        );

        expect(byTrip.get('FAST-1')).toBe(15);
        expect(byTrip.get('SLOW-1')).toBe(55);
    });
});

// ==================================================================
// E. TRANSFERS
// ==================================================================
describe('transfers on a recommended option', () => {
    it('reports a direct journey as having no transfer', () => {
        const journeys = toRecommendedJourneys([match({ trips: [{ tripId: 'T1' }] })]);

        // The search matches only routes serving both the origin and the
        // destination, so a journey it returns is a single ride by definition.
        // Zero is a real answer here, not a missing one.
        expect(journeys[0].timing.transferCount).toBe(0);
        expect(journeys[0].timing.transferWaitMinutes).toEqual([]);
    });

    it('builds one leg per journey, from the route the passenger stays on', () => {
        const journeys = toRecommendedJourneys([
            match({ origin: 'Malabe', trips: [{ tripId: 'T1' }] }),
        ]);

        expect(journeys[0].timing.perLeg).toHaveLength(1);
        expect(journeys[0].timing.perLeg[0].travelledStops).toEqual([
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
        ]);
    });
});
