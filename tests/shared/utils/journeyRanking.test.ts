// Ordering journey options (MOV-87).
//
// The scores below are written down, never calculated. Working out what an
// accessibility score is made of belongs to MOV-79, and a test that reproduced
// that arithmetic here would quietly become a second definition of it — one
// that would keep passing after the real algorithm changed. So every score is
// an input, exactly as the ranking layer receives it in production.
//
// What is under test is therefore only the ordering: which option comes first,
// what happens when two tie, and that ranking never loses or alters an option.
//
// No credential, session value or authentication data appears in this file.
// Journey options need none, so none is fabricated.

import {
    JourneyRankingFacts,
    compareJourneyOptions,
    rankJourneyOptions,
} from '../../../src/shared/utils/journeyRanking';

/** A journey option shaped the way the search API already returns one. */
interface Option {
    routeId: string;
    tripId: string;
    departureTime: string;
    /** Supplied by the caller. MOV-87 never derives this. */
    accessibilityScore?: number | null;
    /** Carried along to prove ranking reorders rather than rebuilds. */
    routeName: string;
}

function option(overrides: Partial<Option> = {}): Option {
    return {
        routeId: 'ROUTE-177',
        tripId: 'TRIP-00001',
        departureTime: '09:00',
        accessibilityScore: 50,
        routeName: 'Kaduwela - Kollupitiya',
        ...overrides,
    };
}

/** How the search API would point the ranker at its own fields. */
const describe_ = (item: Option): JourneyRankingFacts => ({
    accessibilityScore: item.accessibilityScore,
    departureTime: item.departureTime,
    routeId: item.routeId,
    tripId: item.tripId,
});

const rank = (options: Option[]) => rankJourneyOptions(options, describe_);
const tripOrder = (options: Option[]) => rank(options).map((item) => item.tripId);

// ==================================================================
// THE STORY'S REQUIREMENT: ACCESSIBILITY SCORE DECIDES
// ==================================================================
describe('rankJourneyOptions - higher accessibility ranks first', () => {
    it('puts the more accessible option ahead of the less accessible one', () => {
        const options = [
            option({ tripId: 'LOW', accessibilityScore: 25 }),
            option({ tripId: 'HIGH', accessibilityScore: 88 }),
        ];

        expect(tripOrder(options)).toEqual(['HIGH', 'LOW']);
    });

    it('orders a whole set from most to least accessible', () => {
        const options = [
            option({ tripId: 'C', accessibilityScore: 38 }),
            option({ tripId: 'A', accessibilityScore: 100 }),
            option({ tripId: 'D', accessibilityScore: 0 }),
            option({ tripId: 'B', accessibilityScore: 63 }),
        ];

        expect(tripOrder(options)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('ranks by score even when the least accessible bus leaves soonest', () => {
        // The point of the story: departure time no longer decides on its own.
        const options = [
            option({ tripId: 'EARLY_INACCESSIBLE', departureTime: '06:00', accessibilityScore: 13 }),
            option({ tripId: 'LATER_ACCESSIBLE', departureTime: '18:00', accessibilityScore: 88 }),
        ];

        expect(tripOrder(options)).toEqual(['LATER_ACCESSIBLE', 'EARLY_INACCESSIBLE']);
    });

    it('makes no assumption about the scale the score is on', () => {
        // MOV-79 defines the scale. Nothing here caps at 100 or expects a
        // percentage, so a later change of scale cannot silently reorder.
        const options = [
            option({ tripId: 'SMALL', accessibilityScore: 2 }),
            option({ tripId: 'LARGE', accessibilityScore: 4200 }),
            option({ tripId: 'NEGATIVE', accessibilityScore: -10 }),
        ];

        expect(tripOrder(options)).toEqual(['LARGE', 'SMALL', 'NEGATIVE']);
    });
});

// ==================================================================
// A SCORE THAT IS NOT KNOWN
// ==================================================================
describe('rankJourneyOptions - options with no usable score', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['not a number', Number.NaN],
        ['infinite', Number.POSITIVE_INFINITY],
    ])('ranks an option whose score is %s below every measured one', (_label, score) => {
        const options = [
            option({ tripId: 'UNKNOWN', accessibilityScore: score as number | null | undefined }),
            option({ tripId: 'MEASURED', accessibilityScore: 13 }),
        ];

        expect(tripOrder(options)).toEqual(['MEASURED', 'UNKNOWN']);
    });

    it('ranks a measured zero above an unknown score', () => {
        // Zero is a measurement; absence is not. Ranking "we do not know" above
        // "we checked, and it has nothing" would mislead exactly the passenger
        // this ordering is for.
        const options = [
            option({ tripId: 'UNKNOWN', accessibilityScore: null }),
            option({ tripId: 'ZERO', accessibilityScore: 0 }),
        ];

        expect(tripOrder(options)).toEqual(['ZERO', 'UNKNOWN']);
    });

    it('still orders unscored options among themselves by departure', () => {
        const options = [
            option({ tripId: 'LATE', departureTime: '17:30', accessibilityScore: null }),
            option({ tripId: 'EARLY', departureTime: '07:15', accessibilityScore: null }),
        ];

        expect(tripOrder(options)).toEqual(['EARLY', 'LATE']);
    });

    it('keeps an unscored option in the results rather than dropping it', () => {
        const options = [
            option({ tripId: 'SCORED', accessibilityScore: 75 }),
            option({ tripId: 'UNSCORED', accessibilityScore: undefined }),
        ];

        // A passenger is still entitled to see a departure the project could
        // not assess. Ranking reorders; it never filters.
        expect(rank(options)).toHaveLength(2);
        expect(tripOrder(options)).toContain('UNSCORED');
    });
});

// ==================================================================
// TIES
// ==================================================================
describe('rankJourneyOptions - equal scores', () => {
    it('breaks a tie on the earliest departure', () => {
        const options = [
            option({ tripId: 'AFTERNOON', departureTime: '14:45', accessibilityScore: 50 }),
            option({ tripId: 'MORNING', departureTime: '08:05', accessibilityScore: 50 }),
        ];

        expect(tripOrder(options)).toEqual(['MORNING', 'AFTERNOON']);
    });

    it('compares departures chronologically, not by digit', () => {
        // Zero-padded HH:MM, so text order is time order — the same assumption
        // `selectUpcomingTrips` already relies on.
        const options = [
            option({ tripId: 'NINE', departureTime: '09:30', accessibilityScore: 50 }),
            option({ tripId: 'TEN', departureTime: '10:00', accessibilityScore: 50 }),
            option({ tripId: 'SEVEN', departureTime: '07:45', accessibilityScore: 50 }),
        ];

        expect(tripOrder(options)).toEqual(['SEVEN', 'NINE', 'TEN']);
    });

    it('falls back to route and trip identity when score and time both tie', () => {
        const options = [
            option({ routeId: 'ROUTE-B', tripId: 'T2', departureTime: '09:00', accessibilityScore: 50 }),
            option({ routeId: 'ROUTE-A', tripId: 'T1', departureTime: '09:00', accessibilityScore: 50 }),
        ];

        expect(rank(options).map((item) => item.routeId)).toEqual(['ROUTE-A', 'ROUTE-B']);
    });

    it('uses the trip id only once the route id has also tied', () => {
        const options = [
            option({ routeId: 'ROUTE-A', tripId: 'T9', departureTime: '09:00', accessibilityScore: 50 }),
            option({ routeId: 'ROUTE-A', tripId: 'T3', departureTime: '09:00', accessibilityScore: 50 }),
        ];

        expect(tripOrder(options)).toEqual(['T3', 'T9']);
    });

    it('ranks an option with no departure time below one that has it', () => {
        const options = [
            option({ tripId: 'NO_TIME', departureTime: '', accessibilityScore: 50 }),
            option({ tripId: 'TIMED', departureTime: '11:00', accessibilityScore: 50 }),
        ];

        expect(tripOrder(options)).toEqual(['TIMED', 'NO_TIME']);
    });
});

// ==================================================================
// DETERMINISM
// ==================================================================
describe('rankJourneyOptions - the same search always ranks the same way', () => {
    const set = () => [
        option({ routeId: 'ROUTE-A', tripId: 'T1', departureTime: '09:00', accessibilityScore: 50 }),
        option({ routeId: 'ROUTE-B', tripId: 'T2', departureTime: '09:00', accessibilityScore: 88 }),
        option({ routeId: 'ROUTE-C', tripId: 'T3', departureTime: '07:30', accessibilityScore: 50 }),
        option({ routeId: 'ROUTE-D', tripId: 'T4', departureTime: '09:00', accessibilityScore: null }),
    ];

    it('produces the same order however the database returned the rows', () => {
        const forwards = tripOrder(set());
        const backwards = tripOrder([...set()].reverse());

        // Without an identity tiebreak this would follow whatever order the
        // query happened to yield, and one search could rank two ways.
        expect(backwards).toEqual(forwards);
    });

    it('produces the same order when run twice', () => {
        expect(tripOrder(set())).toEqual(tripOrder(set()));
    });

    it('keeps the arrival order for options no rule can tell apart', () => {
        // Identical in every ranked respect; only the name differs.
        const options = [
            option({ routeId: 'R', tripId: 'T', routeName: 'first' }),
            option({ routeId: 'R', tripId: 'T', routeName: 'second' }),
        ];

        expect(rank(options).map((item) => item.routeName)).toEqual(['first', 'second']);
    });
});

// ==================================================================
// NOTHING IS LOST OR ALTERED
// ==================================================================
describe('rankJourneyOptions - the results are the same journeys', () => {
    it('returns every option it was given, exactly once', () => {
        const options = [
            option({ tripId: 'A', accessibilityScore: 13 }),
            option({ tripId: 'B', accessibilityScore: 88 }),
            option({ tripId: 'C', accessibilityScore: null }),
            option({ tripId: 'D', accessibilityScore: 50 }),
        ];

        const ranked = rank(options);

        expect(ranked).toHaveLength(4);
        expect([...ranked].map((item) => item.tripId).sort()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('hands back the very same objects, unmodified', () => {
        const first = option({ tripId: 'A', accessibilityScore: 13 });
        const second = option({ tripId: 'B', accessibilityScore: 88 });

        const ranked = rank([first, second]);

        // Reordered, not rebuilt: everything the search resolved for a route —
        // stops, road geometry, live status — travels through untouched.
        expect(ranked[0]).toBe(second);
        expect(ranked[1]).toBe(first);
        expect(first.routeName).toBe('Kaduwela - Kollupitiya');
    });

    it('does not reorder the array it was given', () => {
        const options = [
            option({ tripId: 'LOW', accessibilityScore: 13 }),
            option({ tripId: 'HIGH', accessibilityScore: 88 }),
        ];

        rank(options);

        expect(options.map((item) => item.tripId)).toEqual(['LOW', 'HIGH']);
    });

    it('handles a search that matched nothing', () => {
        expect(rank([])).toEqual([]);
    });

    it('handles a single option', () => {
        expect(tripOrder([option({ tripId: 'ONLY' })])).toEqual(['ONLY']);
    });

    it('survives being handed something that is not a list', () => {
        // Journey search can produce an absent `trips` array on a malformed
        // record; ranking must not be the thing that fails the whole search.
        expect(rankJourneyOptions(undefined as never, describe_)).toEqual([]);
    });
});

// ==================================================================
// THE COMPARATOR ON ITS OWN
// ==================================================================
describe('compareJourneyOptions', () => {
    it('reports a genuine tie as zero', () => {
        const facts: JourneyRankingFacts = {
            accessibilityScore: 50,
            departureTime: '09:00',
            routeId: 'R',
            tripId: 'T',
        };

        expect(compareJourneyOptions(facts, { ...facts })).toBe(0);
    });

    it('is symmetric', () => {
        const better: JourneyRankingFacts = { accessibilityScore: 88, departureTime: '09:00' };
        const worse: JourneyRankingFacts = { accessibilityScore: 13, departureTime: '09:00' };

        expect(compareJourneyOptions(better, worse)).toBeLessThan(0);
        expect(compareJourneyOptions(worse, better)).toBeGreaterThan(0);
    });

    it('treats two options with nothing to compare as equal', () => {
        expect(compareJourneyOptions({}, {})).toBe(0);
    });

    it('can be handed straight to Array.prototype.sort', () => {
        const facts: JourneyRankingFacts[] = [
            { accessibilityScore: 13, tripId: 'C' },
            { accessibilityScore: 88, tripId: 'A' },
            { accessibilityScore: 50, tripId: 'B' },
        ];

        expect(facts.sort(compareJourneyOptions).map((item) => item.tripId)).toEqual([
            'A',
            'B',
            'C',
        ]);
    });
});
