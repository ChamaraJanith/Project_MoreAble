// What the bus-focused Accessibility Analytics page says.
//
// Nothing here scores — every number is the API's. These tests hold the
// wording, the one set of band thresholds (and the colours painted on them),
// the search/filter/sort of the list, and the separation between a passenger's
// plain average rating and the normalised factor the score weighs.

import {
    BusAccessibilitySummary,
} from '../../../src/features/admin/utils/accessibilityAnalytics';
import {
    ACCESSIBILITY_SCORE_BAND_COLORS,
    accessibilityScoreBand,
    accessibilityScoreBandColor,
    busScoreRows,
    communityEvidenceView,
    facilityRows,
    factorRows,
    filterBusScoreRows,
    ratingEvidenceView,
    scoreProgress,
} from '../../../src/features/admin/utils/accessibilityAnalyticsPresentation';

function summary(overrides: Partial<BusAccessibilitySummary> = {}): BusAccessibilitySummary {
    return {
        busId: 'BUS-00001',
        numberPlate: 'NC-6789',
        busModel: 'Kinglong',
        manufacturer: 'Kinglong Motors',
        status: 'ACTIVE',
        accessibilityScore: 78,
        band: 'GOOD',
        factors: [
            { key: 'FACILITIES', score: 75, weight: 0.5, contribution: 37.5 },
            { key: 'COMMUNITY', score: 70, weight: 0.3, contribution: 21 },
            { key: 'RATINGS', score: 73.75, weight: 0.2, contribution: 14.75 },
        ],
        facilities: [],
        availableFacilityCount: 6,
        community: { issueCount: 2, positiveCount: 8 },
        ratings: { count: 20, average: 4.2 },
        ...overrides,
    };
}

describe('score bands', () => {
    it.each([
        [100, 'EXCELLENT'],
        [90, 'EXCELLENT'],
        [89, 'GOOD'],
        [75, 'GOOD'],
        [74, 'MODERATE'],
        [50, 'MODERATE'],
        [49, 'NEEDS_IMPROVEMENT'],
        [0, 'NEEDS_IMPROVEMENT'],
    ])('scores %i as %s, painted in that band\'s colour', (score, band) => {
        expect(accessibilityScoreBand(score)).toBe(band);
        // The colour comes from the band, so the two cannot disagree.
        expect(accessibilityScoreBandColor(score)).toBe(
            ACCESSIBILITY_SCORE_BAND_COLORS[band as keyof typeof ACCESSIBILITY_SCORE_BAND_COLORS]
        );
    });

    it('gives each band its own colour', () => {
        expect(new Set(Object.values(ACCESSIBILITY_SCORE_BAND_COLORS)).size).toBe(4);
    });

    it('fills a progress bar in proportion, clamped to the scale', () => {
        expect(scoreProgress(78)).toBe(0.78);
        expect(scoreProgress(-5)).toBe(0);
        expect(scoreProgress(140)).toBe(1);
        expect(scoreProgress(Number.NaN)).toBe(0);
    });
});

describe('the bus list', () => {
    it('reads one row per bus, with its own score, band and evidence', () => {
        const [row] = busScoreRows([summary()]);

        expect(row).toEqual(
            expect.objectContaining({
                busId: 'BUS-00001',
                numberPlate: 'NC-6789',
                description: 'Kinglong · Kinglong Motors',
                status: 'ACTIVE',
                score: 78,
                scoreLabel: '78 / 100',
                band: 'GOOD',
                bandLabel: 'Good',
                progress: 0.78,
                facilitiesLabel: '6 of 8 facilities',
                evidenceLabel: '2 verified issues · 8 positive · 20 ratings',
            })
        );
        expect(row.accessibilityLabel).toContain('accessibility score 78 / 100, Good');
    });

    it('keeps buses of every status and never draws a missing score as 0', () => {
        const rows = busScoreRows([
            summary({ busId: 'BUS-1', status: 'ACTIVE' }),
            summary({ busId: 'BUS-2', status: 'INACTIVE' }),
            summary({ busId: 'BUS-3', status: 'MAINTENANCE' }),
            summary({ busId: 'BUS-4', accessibilityScore: undefined as unknown as number }),
        ]);

        expect(rows.map((row) => row.busId)).toEqual(['BUS-1', 'BUS-2', 'BUS-3']);
    });

    it('falls back to the bus id when the record has no plate', () => {
        const [row] = busScoreRows([summary({ numberPlate: '', busModel: null, manufacturer: null })]);

        expect(row.numberPlate).toBe('BUS-00001');
        expect(row.description).toBeNull();
    });

    it('answers a missing list with no rows', () => {
        expect(busScoreRows(undefined)).toEqual([]);
        expect(busScoreRows(null)).toEqual([]);
    });

    describe('search, filter and sort', () => {
        const rows = busScoreRows([
            summary({ busId: 'BUS-00001', numberPlate: 'NC-6789', accessibilityScore: 78, status: 'ACTIVE' }),
            summary({
                busId: 'BUS-00002',
                numberPlate: 'NB-1111',
                busModel: 'Viking',
                manufacturer: 'Ashok Leyland',
                accessibilityScore: 45,
                status: 'MAINTENANCE',
            }),
            summary({ busId: 'BUS-00003', numberPlate: 'NA-2222', accessibilityScore: 92, status: 'INACTIVE' }),
        ]);

        const ids = (list: { busId: string }[]) => list.map((row) => row.busId);

        it('puts the lowest score first by default', () => {
            expect(ids(filterBusScoreRows(rows))).toEqual(['BUS-00002', 'BUS-00001', 'BUS-00003']);
        });

        it('can sort highest first or by plate', () => {
            expect(ids(filterBusScoreRows(rows, { sort: 'SCORE_DESC' }))).toEqual([
                'BUS-00003',
                'BUS-00001',
                'BUS-00002',
            ]);
            expect(ids(filterBusScoreRows(rows, { sort: 'PLATE' }))).toEqual([
                'BUS-00003',
                'BUS-00002',
                'BUS-00001',
            ]);
        });

        it('searches plate, bus id, model and manufacturer, ignoring case', () => {
            expect(ids(filterBusScoreRows(rows, { search: 'nc-67' }))).toEqual(['BUS-00001']);
            expect(ids(filterBusScoreRows(rows, { search: 'bus-00003' }))).toEqual(['BUS-00003']);
            expect(ids(filterBusScoreRows(rows, { search: 'viking' }))).toEqual(['BUS-00002']);
            expect(ids(filterBusScoreRows(rows, { search: 'ashok' }))).toEqual(['BUS-00002']);
            expect(filterBusScoreRows(rows, { search: 'nothing-like-this' })).toEqual([]);
        });

        it('filters by status', () => {
            expect(ids(filterBusScoreRows(rows, { status: 'MAINTENANCE' }))).toEqual(['BUS-00002']);
            expect(ids(filterBusScoreRows(rows, { status: 'ALL' }))).toHaveLength(3);
        });

        it('breaks a tied score on the plate', () => {
            const tied = busScoreRows([
                summary({ busId: 'B', numberPlate: 'ZZ-1', accessibilityScore: 60 }),
                summary({ busId: 'A', numberPlate: 'AA-1', accessibilityScore: 60 }),
            ]);

            expect(ids(filterBusScoreRows(tied))).toEqual(['A', 'B']);
        });
    });
});

describe('the bus detail', () => {
    it('states each factor with its weight and contribution, rounding for display only', () => {
        const rows = factorRows(summary().factors);

        expect(rows.map((row) => [row.label, row.scoreLabel, row.weightLabel, row.contributionLabel])).toEqual([
            ['Facilities', '75 / 100', 'Weight: 50%', '37.5 / 50'],
            ['Community', '70 / 100', 'Weight: 30%', '21.0 / 30'],
            ['Passenger Ratings', '74 / 100', 'Weight: 20%', '14.8 / 20'],
        ]);
    });

    it('drops a factor it cannot read rather than inventing one', () => {
        expect(factorRows(undefined)).toEqual([]);
        expect(
            factorRows([{ key: 'FACILITIES', score: Number.NaN, weight: 0.5, contribution: 0 }])
        ).toEqual([]);
    });

    it('names every facility, and only an available one as available', () => {
        const rows = facilityRows([
            { key: 'wheelchairRamp', available: true, count: null },
            { key: 'lowFloorVehicle', available: false, count: null },
            { key: 'wheelchairSpace', available: true, count: 2 },
            { key: 'prioritySeats', available: true, count: 1 },
            { key: 'guardianSeats', available: false, count: 3 },
        ]);

        expect(rows.map((row) => [row.label, row.statusLabel, row.detail])).toEqual([
            ['Wheelchair Ramp', 'Available', null],
            ['Low Floor Vehicle', 'Unavailable', null],
            ['Wheelchair Space', 'Available', '2 spaces'],
            ['Priority Seats', 'Available', '1 seat'],
            // A leftover count on an unavailable facility states nothing.
            ['Guardian Seats', 'Unavailable', null],
        ]);
    });

    it('explains a community factor with no evidence as neutral', () => {
        expect(communityEvidenceView({ issueCount: 0, positiveCount: 0 }).note).toContain('neutral 50');
        expect(communityEvidenceView({ issueCount: 2, positiveCount: 8 })).toEqual(
            expect.objectContaining({ issueCount: 2, positiveCount: 8 })
        );
    });

    it('calls issues verified and positive feedback just positive feedback', () => {
        const { note } = communityEvidenceView({ issueCount: 2, positiveCount: 8 });

        expect(note).toContain('8 positive feedback against 2 verified issues');
        // Positive feedback is never reviewed, so it is never called verified.
        expect(note).not.toMatch(/verified positive/i);
        expect(communityEvidenceView({ issueCount: 0, positiveCount: 0 }).note).not.toMatch(
            /verified positive/i
        );
    });

    it('keeps the passenger average apart from the rating factor', () => {
        const view = ratingEvidenceView({ count: 20, average: 4.2 }, summary().factors);

        expect(view.averageLabel).toBe('4.2 / 5');
        expect(view.countLabel).toBe('20 ratings');
        expect(view.factorLabel).toBe('74 / 100');
    });

    it('never shows an average of 0 for an unrated bus', () => {
        const view = ratingEvidenceView({ count: 0, average: null }, [
            { key: 'RATINGS', score: 50, weight: 0.2, contribution: 10 },
        ]);

        expect(view.hasRatings).toBe(false);
        expect(view.averageLabel).toBe('No ratings yet');
        expect(view.factorLabel).toBe('50 / 100');
    });
});
