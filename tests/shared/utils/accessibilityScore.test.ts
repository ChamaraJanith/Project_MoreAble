// The accessibility score algorithm (MOV-79 / MOV-111).
//
// Unlike the journey suites, which derive every expectation from the shared
// function so they survive a formula change, this file IS the specification of
// the formula, so its expectations are written out as numbers. Each one is
// worked by hand in the comment beside it.

import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { reportTypeOf } from '../../../src/entities/report/model/types';
import {
    ACCESSIBILITY_FACILITY_KEYS,
    COMMUNITY_NEUTRAL_SCORE,
    COMMUNITY_PRIOR_WEIGHT,
    COMMUNITY_WEIGHT,
    computeAccessibilityScore,
    computeCommunityScore,
    computeFacilityScore,
    computeRatingScore,
    FACILITY_WEIGHT,
    isFacilityConfigured,
    isFacilityEffectivelyAvailable,
    RATING_NEUTRAL_VALUE,
    RATING_PRIOR_WEIGHT,
    RATING_WEIGHT,
    tallyPassengerRatings,
    tallyVerifiedCommunityReports,
} from '../../../src/shared/utils/accessibility';

const NONE: BusAccessibilityFacilities = {
    wheelchairRamp: false,
    audioAnnouncement: false,
    lowFloorVehicle: false,
    walkingAssistance: false,
    wheelchairSpace: { available: false, count: 0 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: false, count: 0 },
    elderlySeats: { available: false, count: 0 },
};

const ALL: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: true,
    walkingAssistance: true,
    wheelchairSpace: { available: true, count: 2 },
    guardianSeats: { available: true, count: 2 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: true, count: 4 },
};

/** The first `n` canonical facilities available, the rest not. */
function withAvailable(n: number): BusAccessibilityFacilities {
    const facilities: any = structuredClone(NONE);
    for (const key of ACCESSIBILITY_FACILITY_KEYS.slice(0, n)) {
        facilities[key] = typeof facilities[key] === 'object' ? { available: true, count: 1 } : true;
    }
    return facilities;
}

/** `n` ratings summing to `total`. */
const ratings = (count: number, total: number) => ({ count, total });
const community = (positiveCount: number, issueCount: number) => ({ positiveCount, issueCount });

describe('the specified constants', () => {
    it('weights the three factors 50 / 30 / 20', () => {
        expect(FACILITY_WEIGHT).toBe(0.5);
        expect(COMMUNITY_WEIGHT).toBe(0.3);
        expect(RATING_WEIGHT).toBe(0.2);
        expect(FACILITY_WEIGHT + COMMUNITY_WEIGHT + RATING_WEIGHT).toBeCloseTo(1, 12);
    });

    it('uses a neutral prior of 50 / 3 stars, each worth 5 pieces of evidence', () => {
        expect(COMMUNITY_NEUTRAL_SCORE).toBe(50);
        expect(COMMUNITY_PRIOR_WEIGHT).toBe(5);
        expect(RATING_NEUTRAL_VALUE).toBe(3);
        expect(RATING_PRIOR_WEIGHT).toBe(5);
    });

    it('scores exactly the 8 facilities the bus record stores', () => {
        expect([...ACCESSIBILITY_FACILITY_KEYS].sort()).toEqual(Object.keys(ALL).sort());
    });
});

// ==================================================================
// Factor 1 — vehicle accessibility facilities
// ==================================================================
describe('facility score', () => {
    it.each([
        [0, 0],
        [1, 12.5],
        [4, 50],
        [6, 75],
        [8, 100],
    ])('%i of 8 facilities scores %d', (available, expected) => {
        expect(computeFacilityScore(withAvailable(available))).toBe(expected);
    });

    it('treats a bus with no facility record as having none', () => {
        expect(computeFacilityScore(undefined)).toBe(0);
        expect(computeFacilityScore(null)).toBe(0);
    });

    it('treats a missing (undefined) facility as unavailable', () => {
        const { wheelchairRamp, ...rest } = ALL;
        expect(isFacilityConfigured(rest as any, 'wheelchairRamp')).toBe(false);
        expect(computeFacilityScore(rest as any)).toBe(87.5);
    });

    it('treats a null facility as unavailable', () => {
        const facilities: any = { ...ALL, audioAnnouncement: null, prioritySeats: null };
        expect(isFacilityConfigured(facilities, 'audioAnnouncement')).toBe(false);
        expect(isFacilityConfigured(facilities, 'prioritySeats')).toBe(false);
        expect(computeFacilityScore(facilities)).toBe(75);
    });

    it.each([['true'], [1], ['yes'], [{}], [[]]])(
        'does not count the truthy non-boolean %p as available',
        (value) => {
            const facilities: any = { ...NONE, wheelchairRamp: value, lowFloorVehicle: value };
            expect(computeFacilityScore(facilities)).toBe(0);
        }
    );

    it('reads a counted facility through `available === true`, never its count', () => {
        const facilities: any = {
            ...NONE,
            wheelchairSpace: { available: false, count: 4 },
            guardianSeats: { available: 'true', count: 2 },
            prioritySeats: { available: 1, count: 2 },
            elderlySeats: true,
        };
        expect(computeFacilityScore(facilities)).toBe(0);
    });

    describe('effective availability', () => {
        it('takes out a configured facility that has an active verified issue', () => {
            expect(isFacilityEffectivelyAvailable(ALL, 'wheelchairRamp', ['wheelchairRamp'])).toBe(false);
            expect(computeFacilityScore(ALL, ['wheelchairRamp'])).toBe(87.5);
        });

        it('restores it once the issue is resolved (no longer listed)', () => {
            expect(computeFacilityScore(ALL, [])).toBe(100);
            expect(computeFacilityScore(ALL, null)).toBe(100);
            expect(computeFacilityScore(ALL, undefined)).toBe(100);
        });

        it('never adds a facility the bus is not configured with', () => {
            // An issue can only take something away; one about a facility the bus
            // never had changes nothing.
            expect(computeFacilityScore(withAvailable(4), ['elderlySeats'])).toBe(50);
        });

        it('counts a facility listed twice once', () => {
            expect(computeFacilityScore(ALL, ['prioritySeats', 'prioritySeats'])).toBe(87.5);
        });

        it('never changes the bus record it reads', () => {
            const record = structuredClone(ALL);
            computeAccessibilityScore(record, { unavailableFacilities: ['wheelchairRamp', 'prioritySeats'] });
            expect(record).toEqual(ALL);
        });
    });
});

// ==================================================================
// Factor 2 — community reports
// ==================================================================
describe('community score', () => {
    it.each<[string, number, number, number]>([
        // n = P + I;  (n/(n+5)) * raw + (5/(n+5)) * 50
        ['no reports', 0, 0, 50],
        ['1 positive: raw 100 -> 1/6*100 + 5/6*50', 1, 0, 58.333333],
        ['1 issue: raw 0 -> 5/6*50', 0, 1, 41.666667],
        ['equal positive and issue: raw 50', 5, 5, 50],
        ['mostly positive 8/2: raw 80 -> 10/15*80 + 5/15*50', 8, 2, 70],
        ['mostly issue 2/8: raw 20 -> 10/15*20 + 5/15*50', 2, 8, 30],
        ['20 positive: raw 100 -> 20/25*100 + 5/25*50', 20, 0, 90],
        ['large, 95 positive: 95/100*100 + 5/100*50', 95, 0, 97.5],
    ])('%s', (_label, positive, issue, expected) => {
        expect(computeCommunityScore(community(positive, issue))).toBeCloseTo(expected, 5);
    });

    it('is neutral, not zero, when there is no community evidence at all', () => {
        expect(computeCommunityScore(undefined)).toBe(50);
        expect(computeCommunityScore(null)).toBe(50);
    });

    it('gives a large consistent body of evidence more weight than a small one', () => {
        expect(computeCommunityScore(community(40, 0))).toBeGreaterThan(computeCommunityScore(community(4, 0)));
        expect(computeCommunityScore(community(0, 40))).toBeLessThan(computeCommunityScore(community(0, 4)));
    });

    describe('which reports count', () => {
        const BUS = 'BUS-A';

        it('counts VERIFIED reports only; PENDING, REJECTED and others are ignored', () => {
            const tally = tallyVerifiedCommunityReports(
                [
                    { busId: BUS, status: 'VERIFIED', type: 'POSITIVE' },
                    { busId: BUS, status: 'VERIFIED' },
                    { busId: BUS, status: 'PENDING', type: 'POSITIVE' },
                    { busId: BUS, status: 'PENDING' },
                    { busId: BUS, status: 'REJECTED', type: 'POSITIVE' },
                    { busId: BUS, status: 'REJECTED' },
                    { busId: BUS, status: 'REVIEWED' },
                    { busId: BUS, status: 'RESOLVED' },
                    { busId: BUS },
                ],
                BUS
            );
            expect(tally).toEqual({ positiveCount: 1, issueCount: 1 });
        });

        it('ignores reports with no bus, or about another bus', () => {
            const tally = tallyVerifiedCommunityReports(
                [
                    { status: 'VERIFIED', type: 'POSITIVE' },
                    { busId: '', status: 'VERIFIED' },
                    { busId: 'BUS-OTHER', status: 'VERIFIED', type: 'POSITIVE' },
                    null,
                    undefined,
                ],
                BUS
            );
            expect(tally).toEqual({ positiveCount: 0, issueCount: 0 });
        });

        it('reads type exactly as the report system does: only an explicit POSITIVE is positive', () => {
            const reports = [
                { busId: BUS, status: 'VERIFIED', type: 'POSITIVE' as const },
                { busId: BUS, status: 'VERIFIED', type: 'ISSUE' as const },
                { busId: BUS, status: 'VERIFIED' },
                { busId: BUS, status: 'VERIFIED', type: 'positive' as any },
            ];
            const tally = tallyVerifiedCommunityReports(reports, BUS);

            expect(tally).toEqual({ positiveCount: 1, issueCount: 3 });
            expect(tally.positiveCount).toBe(reports.filter((r) => reportTypeOf(r) === 'POSITIVE').length);
        });

        it('has nothing to count for a bus with no id', () => {
            expect(tallyVerifiedCommunityReports([{ busId: BUS, status: 'VERIFIED' }], '')).toEqual({
                positiveCount: 0,
                issueCount: 0,
            });
        });
    });
});

// ==================================================================
// Factor 3 — passenger ratings
// ==================================================================
describe('rating score', () => {
    it.each<[string, number, number, number]>([
        // adjusted = (n/(n+5)) * avg + (5/(n+5)) * 3;  score = (adjusted - 1) / 4 * 100
        ['no ratings', 0, 0, 50],
        ['one 5-star: 1/6*5 + 5/6*3 = 3.3333', 1, 5, 58.333333],
        ['one 1-star: 1/6*1 + 5/6*3 = 2.6667', 1, 1, 41.666667],
        ['average 3 is neutral at any count', 10, 30, 50],
        ['average 4 from 5: 0.5*4 + 0.5*3 = 3.5', 5, 20, 62.5],
        ['average 5 from 5: 0.5*5 + 0.5*3 = 4', 5, 25, 75],
        ['average 4.2 from 20: 0.8*4.2 + 0.2*3 = 3.96', 20, 84, 74],
        ['large, average 5 from 995: 0.995*5 + 0.005*3 = 4.99', 995, 4975, 99.75],
    ])('%s', (_label, count, total, expected) => {
        expect(computeRatingScore(ratings(count, total))).toBeCloseTo(expected, 5);
    });

    it('is neutral, not zero, when nobody has rated the bus', () => {
        expect(computeRatingScore(undefined)).toBe(50);
        expect(computeRatingScore(null)).toBe(50);
    });

    it('maps whole-star averages from a very large sample to 0 / 25 / 50 / 75 / 100', () => {
        const n = 1_000_000;
        [1, 2, 3, 4, 5].forEach((stars, index) => {
            expect(computeRatingScore(ratings(n, n * stars))).toBeCloseTo(index * 25, 2);
        });
    });

    it('moves a small sample only a little from neutral, a large one nearly all the way', () => {
        const small = computeRatingScore(ratings(1, 4)); // 1/6*4 + 5/6*3 = 3.1667 -> 54.17
        const large = computeRatingScore(ratings(100, 400)); // 100/105*4 + 5/105*3 = 3.9524 -> 73.81

        expect(small).toBeCloseTo(54.166667, 5);
        expect(large).toBeCloseTo(73.809524, 5);
        expect(large).toBeGreaterThan(small);
    });

    describe('which ratings count', () => {
        const BUS = 'BUS-A';

        it('counts whole 1–5 ratings of this bus only', () => {
            const tally = tallyPassengerRatings(
                [
                    { busId: BUS, rating: 5 },
                    { busId: BUS, rating: 1 },
                    { busId: 'BUS-OTHER', rating: 5 },
                    { busId: BUS, rating: '5' as any },
                    { busId: BUS, rating: 0 as any },
                    { busId: BUS, rating: 6 as any },
                    { busId: BUS, rating: 4.5 as any },
                    { rating: 5 },
                    null,
                ],
                BUS
            );
            expect(tally).toEqual({ count: 2, total: 6 });
        });

        it('never fabricates a rating', () => {
            expect(tallyPassengerRatings([], BUS)).toEqual({ count: 0, total: 0 });
        });
    });
});

// ==================================================================
// Final score
// ==================================================================
describe('computeAccessibilityScore', () => {
    it('is the specification example: 6/8 facilities, 8 positive + 2 issue, 20 ratings averaging 4.2', () => {
        // 75 * 0.5 + 70 * 0.3 + 74 * 0.2 = 37.5 + 21 + 14.8 = 73.3 -> 73
        expect(
            computeAccessibilityScore(withAvailable(6), {
                community: community(8, 2),
                ratings: ratings(20, 84),
            })
        ).toBe(73);
    });

    it('with no facilities and no evidence: 0 + 50*0.3 + 50*0.2 = 25', () => {
        expect(computeAccessibilityScore(NONE)).toBe(25);
        expect(computeAccessibilityScore(undefined)).toBe(25);
        expect(computeAccessibilityScore(NONE, {})).toBe(25);
    });

    it('reaches 100 when every factor is at its best', () => {
        const n = 1_000_000;
        expect(
            computeAccessibilityScore(ALL, { community: community(n, 0), ratings: ratings(n, 5 * n) })
        ).toBe(100);
    });

    it('only facilities strong: 100*0.5 + 50*0.3 + 50*0.2 = 75', () => {
        expect(computeAccessibilityScore(ALL)).toBe(75);
    });

    it('only community strong: 0 + 90*0.3 + 50*0.2 = 37', () => {
        expect(computeAccessibilityScore(NONE, { community: community(20, 0) })).toBe(37);
    });

    it('only ratings strong: 0 + 50*0.3 + 90*0.2 = 33', () => {
        // 20 five-star ratings: 0.8*5 + 0.2*3 = 4.6 -> 90
        expect(computeAccessibilityScore(NONE, { ratings: ratings(20, 100) })).toBe(33);
    });

    it('a well-equipped bus with poor evidence: 100*0.5 + 30*0.3 + 37.5*0.2 = 67', () => {
        // community 2/8 -> 30; 5 two-star ratings: 0.5*2 + 0.5*3 = 2.5 -> 37.5 -> 7.5
        // 50 + 9 + 7.5 = 66.5 -> 67
        expect(
            computeAccessibilityScore(ALL, { community: community(2, 8), ratings: ratings(5, 10) })
        ).toBe(67);
    });

    it('applies an active facility issue through the facility factor only', () => {
        // 7/8 -> 87.5 * 0.5 = 43.75, + 15 + 10 = 68.75 -> 69
        expect(computeAccessibilityScore(ALL, { unavailableFacilities: ['wheelchairRamp'] })).toBe(69);
    });

    it('rounds to the nearest whole number, halves up', () => {
        // 1/8: 6.25 + 25 = 31.25 -> 31;  2/8: 12.5 + 25 = 37.5 -> 38
        expect(computeAccessibilityScore(withAvailable(1))).toBe(31);
        expect(computeAccessibilityScore(withAvailable(2))).toBe(38);
    });

    it('always returns a whole number', () => {
        for (let k = 0; k <= 8; k += 1) {
            for (const tally of [community(0, 0), community(1, 0), community(3, 7)]) {
                const score = computeAccessibilityScore(withAvailable(k), {
                    community: tally,
                    ratings: ratings(3, 11),
                });
                expect(Number.isInteger(score)).toBe(true);
            }
        }
    });

    it('clamps to 0–100 even when handed an inconsistent tally', () => {
        // A total no real set of 1–5 ratings could reach, and one that is too low.
        expect(computeAccessibilityScore(ALL, { ratings: ratings(1, 100_000) })).toBe(100);
        expect(
            computeAccessibilityScore(NONE, { community: community(0, 100_000), ratings: ratings(100_000, 0) })
        ).toBe(0);
    });

    it('treats unusable counts as no evidence', () => {
        const junk: any = { positiveCount: NaN, issueCount: -3 };
        expect(computeAccessibilityScore(ALL, { community: junk, ratings: { count: -1, total: 5 } as any })).toBe(
            computeAccessibilityScore(ALL)
        );
    });

    it('is deterministic for the same input', () => {
        const evidence = { community: community(8, 2), ratings: ratings(20, 84) };
        const first = computeAccessibilityScore(withAvailable(6), evidence);
        for (let i = 0; i < 5; i += 1) {
            expect(computeAccessibilityScore(withAvailable(6), evidence)).toBe(first);
        }
    });

    it('scores strictly more facilities at least as well, whatever the evidence', () => {
        const evidence = { community: community(3, 4), ratings: ratings(7, 20) };
        for (let k = 0; k < 8; k += 1) {
            expect(computeAccessibilityScore(withAvailable(k + 1), evidence)).toBeGreaterThanOrEqual(
                computeAccessibilityScore(withAvailable(k), evidence)
            );
        }
    });
});
