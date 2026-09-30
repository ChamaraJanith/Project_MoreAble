// The passenger's accessibility score breakdown (the journey result card's
// score badge and the sheet it opens).
//
// The display helper is pure and is tested directly. The card and the sheet
// are checked the way journeyResultsGrouping.test.ts checks the results
// screen, by reading their source: this project's Jest is node-only, with no
// React Native renderer. The scoring itself is specified in
// tests/shared/utils/accessibilityScore.test.ts and is not re-tested here.
//
// No credential-shaped value appears; none of this needs one.

import * as fs from 'fs';
import * as path from 'path';
import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import {
    accessibilityScoreBreakdownView,
    SCORE_BREAKDOWN_FACTOR_ORDER,
} from '../../../src/features/journey/utils/accessibilityScoreBreakdown';
import {
    AccessibilityFactorBreakdown,
    computeAccessibilityScore,
    computeAccessibilityScoreBreakdown,
} from '../../../src/shared/utils/accessibility';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const HELPER_FILE = 'src/features/journey/utils/accessibilityScoreBreakdown.ts';
const SHEET_FILE = 'src/features/journey/ui/AccessibilityScoreBreakdownSheet.tsx';
const CARD_FILE = 'src/features/journey/ui/JourneyOptionCard.tsx';

const helperSource = read(HELPER_FILE);
const sheet = read(SHEET_FILE);
const card = read(CARD_FILE);

const locale = (lang: 'en' | 'si') =>
    JSON.parse(read(`src/shared/i18n/locales/${lang}.json`)) as Record<string, any>;

/** The requirement's worked example: 100, 50 and 54 -> 50.0 + 15.0 + 10.8 = 75.8 -> 76. */
const EXAMPLE: AccessibilityFactorBreakdown[] = [
    { key: 'FACILITIES', score: 100, weight: 0.5, contribution: 50 },
    { key: 'COMMUNITY', score: 50, weight: 0.3, contribution: 15 },
    { key: 'RATINGS', score: 54, weight: 0.2, contribution: 10.8 },
];

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

// ------------------------------------------------------------------
// The display helper
// ------------------------------------------------------------------
describe('accessibilityScoreBreakdownView', () => {
    it('turns a score and its three factors into display rows', () => {
        const view = accessibilityScoreBreakdownView(76, EXAMPLE);

        expect(view).not.toBeNull();
        expect(view!.score).toBe(76);
        expect(view!.scoreText).toBe('76 / 100');
        expect(view!.rows.map((row) => [row.labelFallback, row.scoreText, row.weightText, row.contributionText])).toEqual([
            ['Facilities', '100 / 100', '50%', '50.0 / 50'],
            ['Community', '50 / 100', '30%', '15.0 / 30'],
            ['Passenger Ratings', '54 / 100', '20%', '10.8 / 20'],
        ]);
    });

    it('lists the factors in the canonical order, whatever order they arrived in', () => {
        const view = accessibilityScoreBreakdownView(76, [EXAMPLE[2], EXAMPLE[0], EXAMPLE[1]]);

        expect(view!.rows.map((row) => row.key)).toEqual(['FACILITIES', 'COMMUNITY', 'RATINGS']);
        expect(SCORE_BREAKDOWN_FACTOR_ORDER).toEqual(['FACILITIES', 'COMMUNITY', 'RATINGS']);
    });

    it('rounds a factor score for display only, keeping the API value for colour and bar', () => {
        const view = accessibilityScoreBreakdownView(73, [
            { key: 'FACILITIES', score: 75, weight: 0.5, contribution: 37.5 },
            { key: 'COMMUNITY', score: 70, weight: 0.3, contribution: 21 },
            { key: 'RATINGS', score: 73.75, weight: 0.2, contribution: 14.75 },
        ]);
        const ratings = view!.rows[2];

        expect(ratings.scoreText).toBe('74 / 100');
        expect(ratings.score).toBe(73.75);
        expect(ratings.progress).toBeCloseTo(0.7375);
    });

    it('prints a weight as a whole percentage, even when its product is not exact', () => {
        // 0.3 * 100 is 30.000000000000004 in floating point.
        const view = accessibilityScoreBreakdownView(76, EXAMPLE);

        expect(view!.rows.map((row) => row.weightValue)).toEqual(['50', '30', '20']);
        expect(view!.rows.map((row) => row.maxContributionValue)).toEqual(['50', '30', '20']);
    });

    it('prints a contribution to one decimal place, out of the most it could carry', () => {
        const view = accessibilityScoreBreakdownView(69, [
            { key: 'FACILITIES', score: 87.5, weight: 0.5, contribution: 43.75 },
            { key: 'COMMUNITY', score: 50, weight: 0.3, contribution: 15 },
            { key: 'RATINGS', score: 50, weight: 0.2, contribution: 10 },
        ]);

        expect(view!.rows.map((row) => row.contributionText)).toEqual(['43.8 / 50', '15.0 / 30', '10.0 / 20']);
    });

    it('explains the rounding as an approximation: 50.0 + 15.0 + 10.8 ≈ 76, with no exact total', () => {
        const view = accessibilityScoreBreakdownView(76, EXAMPLE)!;

        expect(view.rounding).toEqual({ parts: '50.0 + 15.0 + 10.8', score: '76' });
        expect(view.rounding).not.toHaveProperty('total');
    });

    it('rounds from exactly the three contributions the rows print', () => {
        const view = accessibilityScoreBreakdownView(76, EXAMPLE)!;

        expect(view.rounding.parts).toBe(view.rows.map((row) => row.contributionValue).join(' + '));
        expect(view.rounding.parts.split(' + ')).toEqual(['50.0', '15.0', '10.8']);
    });

    it('stays true where an exact printed total would not: 0.0 + 15.0 + 5.5 ≈ 20', () => {
        // Six ratings totalling 8 stars: the unrounded total is 20.45…, so the
        // score is 20, but a total printed to one decimal place would have read
        // "20.5 → 20" — the audit's counter-example.
        const evidence = { ratings: { count: 6, total: 8 } };
        const score = computeAccessibilityScore(undefined, evidence);
        const view = accessibilityScoreBreakdownView(score, computeAccessibilityScoreBreakdown(undefined, evidence))!;

        expect(score).toBe(20);
        expect(view.rounding).toEqual({ parts: '0.0 + 15.0 + 5.5', score: '20' });
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty list', []],
        ['not a list', { FACILITIES: EXAMPLE[0] }],
    ])('shows no breakdown when it is missing: %s', (_label, breakdown) => {
        expect(accessibilityScoreBreakdownView(76, breakdown)).toBeNull();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['NaN', Number.NaN],
        ['a string', '76'],
        ['a fraction', 75.8],
        ['below the scale', -1],
        ['above the scale', 101],
    ])('shows no breakdown without a whole 0-100 score: %s', (_label, score) => {
        expect(accessibilityScoreBreakdownView(score, EXAMPLE)).toBeNull();
    });

    it.each([
        ['a factor with a string score', [{ ...EXAMPLE[0], score: '100' }, EXAMPLE[1], EXAMPLE[2]]],
        ['a factor with no weight', [{ ...EXAMPLE[0], weight: undefined }, EXAMPLE[1], EXAMPLE[2]]],
        ['a factor with a NaN contribution', [{ ...EXAMPLE[0], contribution: Number.NaN }, EXAMPLE[1], EXAMPLE[2]]],
        ['a factor score above 100', [{ ...EXAMPLE[0], score: 120 }, EXAMPLE[1], EXAMPLE[2]]],
        ['a zero weight', [{ ...EXAMPLE[0], weight: 0 }, EXAMPLE[1], EXAMPLE[2]]],
        ['a negative contribution', [{ ...EXAMPLE[0], contribution: -50 }, EXAMPLE[1], EXAMPLE[2]]],
        ['a null entry', [null, EXAMPLE[1], EXAMPLE[2]]],
        ['a fourth factor', [...EXAMPLE, EXAMPLE[2]]],
    ])('shows no breakdown when it is malformed: %s', (_label, breakdown) => {
        expect(accessibilityScoreBreakdownView(76, breakdown)).toBeNull();
    });

    it.each([
        ['an unknown factor key', [{ ...EXAMPLE[0], key: 'RELIABILITY' }, EXAMPLE[1], EXAMPLE[2]]],
        ['a factor listed twice', [EXAMPLE[0], EXAMPLE[0], EXAMPLE[2]]],
        ['a factor missing', [EXAMPLE[0], EXAMPLE[1]]],
    ])('shows no breakdown without exactly the three factors: %s', (_label, breakdown) => {
        expect(accessibilityScoreBreakdownView(76, breakdown)).toBeNull();
    });

    it('never recalculates the score: it prints the one passed in, not a figure of its own', () => {
        // The parts total 75.8; the badge's 76 is what is printed as the score,
        // and no total of the parts is printed at all.
        const view = accessibilityScoreBreakdownView(76, EXAMPLE)!;

        expect(view.score).toBe(76);
        expect(view.scoreText).toBe('76 / 100');
        expect(view.rounding.score).toBe('76');
        expect(JSON.stringify(view)).not.toContain('75.8');
    });

    it('shows no breakdown that does not explain the score beside it', () => {
        // Factors worth 75.8 cannot be the explanation of a 60.
        expect(accessibilityScoreBreakdownView(60, EXAMPLE)).toBeNull();
    });

    it.each([
        ['every facility, no evidence', ALL, undefined],
        ['no facilities, no evidence', undefined, undefined],
        ['every facility, poor evidence', ALL, { community: { positiveCount: 2, issueCount: 8 }, ratings: { count: 5, total: 10 } }],
        ['a mixed record', ALL, { community: { positiveCount: 8, issueCount: 2 }, ratings: { count: 20, total: 84 } }],
    ])('explains every score the search can actually send: %s', (_label, facilities, evidence) => {
        // The pair the search API puts on a bus, from the shared layer.
        const score = computeAccessibilityScore(facilities, evidence);
        const breakdown = computeAccessibilityScoreBreakdown(facilities, evidence);

        expect(accessibilityScoreBreakdownView(score, breakdown)?.score).toBe(score);
    });

    it('holds no scoring formula, weight or scoring call of its own', () => {
        expect(helperSource).not.toMatch(/computeAccessibilityScore|computeFacilityScore|computeCommunityScore|computeRatingScore/);
        expect(helperSource).not.toMatch(/_WEIGHT/);
        expect(helperSource).not.toMatch(/\b0\.[235]\b/);
    });
});

// ------------------------------------------------------------------
// The sheet
// ------------------------------------------------------------------
describe('AccessibilityScoreBreakdownSheet', () => {
    it('is a bottom sheet in the shape the journey pickers already use', () => {
        expect(sheet).toMatch(/<Modal visible=\{visible\} transparent animationType="slide" onRequestClose=\{onClose\}>/);
        expect(sheet).toMatch(/style=\{StyleSheet\.absoluteFill\}[\s\S]*?onPress=\{onClose\}/);
    });

    it('has a header title and a labelled close button', () => {
        expect(sheet).toMatch(/accessibilityRole="header"[\s\S]*?journey\.scoreBreakdown\.title/);
        expect(sheet).toMatch(/journey\.scoreBreakdown\.close'/);
        expect(sheet).toMatch(/accessibilityLabel=\{closeLabel\}/);
        expect(sheet).toContain('accessibilityViewIsModal');
    });

    it('shows only what the display helper produced, and nothing when it produced nothing', () => {
        expect(sheet).toContain('const view = accessibilityScoreBreakdownView(score, breakdown);');
        expect(sheet).toContain('if (!view) return null;');
        expect(sheet).toContain('{view.scoreText}');
        expect(sheet).toContain('view.rows.map');
        expect(sheet).toContain('...view.rounding');
    });

    it('colours the score with the passenger scale, not a second one', () => {
        expect(sheet).toMatch(/import \{[^}]*accessibilityScoreColor[^}]*\} from '\.\.\/\.\.\/\.\.\/shared\/utils\/accessibility'/);
        expect(sheet).not.toMatch(/accessibilityScoreBand|>=\s*\d+\s*\)/);
    });

    it('calculates nothing', () => {
        expect(sheet).not.toMatch(/computeAccessibilityScore|computeFacilityScore|computeCommunityScore|computeRatingScore|_WEIGHT/);
        expect(sheet).not.toMatch(/\.reduce\(/);
    });
});

// ------------------------------------------------------------------
// The card's score badge
// ------------------------------------------------------------------
describe('the journey card score badge', () => {
    it('reads the breakdown the search sent for this bus, through the display helper', () => {
        expect(card).toMatch(
            /const scoreBreakdown = accessibilityScoreBreakdownView\(\s*accessibilityScore,\s*bus\?\.accessibilityScoreBreakdown\s*\)/
        );
    });

    it('is a button only when there is a breakdown that explains the score', () => {
        expect(card).toMatch(/\{scoreBreakdown \? \(\s*<TouchableOpacity/);
        expect(card.match(/onPress=\{\(\) => setBreakdownOpen\(true\)\}/g)).toHaveLength(1);
    });

    it('opens the breakdown sheet with the badge score and the same bus breakdown', () => {
        expect(card).toMatch(/import \{ AccessibilityScoreBreakdownSheet \} from '\.\/AccessibilityScoreBreakdownSheet'/);
        expect(card).toMatch(
            /<AccessibilityScoreBreakdownSheet\s+visible=\{isBreakdownOpen\}\s+score=\{accessibilityScore\}\s+breakdown=\{bus\?\.accessibilityScoreBreakdown\}\s+onClose=\{\(\) => setBreakdownOpen\(false\)\}/
        );
    });

    it('is announced as a button with a label and a hint', () => {
        const button = card.match(/<TouchableOpacity\s+style=\{\[styles\.scoreBadge[\s\S]*?>\s*\{scoreBadgeContent\}/)?.[0] ?? '';

        expect(button).toContain('accessibilityRole="button"');
        expect(button).toContain("journey.scoreBreakdown.badgeLabel");
        expect(button).toContain("journey.scoreBreakdown.badgeHint");
        expect(button).toContain('hitSlop=');
    });

    it('keeps an unknown score a plain, non-interactive N/A', () => {
        const unknown = card.match(/\) : \(\s*<View[\s\S]*?N\/A<\/Text>\s*<\/View>/)?.[0] ?? '';

        expect(unknown).toContain('help-circle-outline');
        expect(unknown).not.toMatch(/onPress|TouchableOpacity|accessibilityRole/);
    });

    it('keeps a score without a usable breakdown a plain, non-interactive badge', () => {
        const plain = card.match(/\) : hasMeasuredScore \? \(\s*<View[\s\S]*?<\/View>/)?.[0] ?? '';

        expect(plain).toContain('{scoreBadgeContent}');
        expect(plain).not.toMatch(/onPress|TouchableOpacity|accessibilityRole/);
    });

    it('keeps the route summary and the score button separate accessibility elements', () => {
        // The row itself is no longer one accessible group...
        expect(card).toMatch(/<View style=\{styles\.topRow\}>/);
        expect(card).not.toMatch(/<View style=\{styles\.topRow\}[^>]*accessible/);

        // ...the summary is its own element, closed before the score begins.
        const identity = card.match(
            /<View style=\{styles\.routeIdentity\} accessible accessibilityLabel=\{summaryLabel\}>[\s\S]*?\{route\.routeName\}\s*<\/Text>\s*<\/View>/
        )?.[0];

        expect(identity).toBeDefined();
        expect(identity).not.toContain('scoreBadge');
    });

    it('still reads the score in the route summary, as it did before', () => {
        expect(card).toContain('Accessibility score ${accessibilityScore} percent. ');
        expect(card).toContain("'Accessibility score not available. '");
    });

    it('leaves Book and View details exactly as they were', () => {
        expect(card).toContain('onPress={handleDirectBook}');
        expect(card).toContain('disabled={isFull || !bus || !trip}');
        expect(card).toContain('onPress={handleViewDetails}');
        expect(card).toMatch(/`Book this trip on route \$\{route\.routeNumber\}`/);
        expect(card).toMatch(/`View details for route \$\{route\.routeNumber\}`/);
    });

    it('does not make the whole card pressable', () => {
        expect(card).toMatch(/<View style=\{styles\.card\}>/);
        expect(card).not.toMatch(/<(TouchableOpacity|Pressable)\s+style=\{styles\.card\}/);
    });
});

// ------------------------------------------------------------------
// Localization
// ------------------------------------------------------------------
describe('the score breakdown strings', () => {
    const en = locale('en').journey.scoreBreakdown as Record<string, string>;
    const si = locale('si').journey.scoreBreakdown as Record<string, string>;

    const REQUIRED = [
        'title',
        'finalScore',
        'facilities',
        'community',
        'ratings',
        'score',
        'weight',
        'contributes',
        'roundingNote',
        'close',
        'badgeLabel',
        'badgeHint',
    ];

    it.each(REQUIRED)('exists in both English and Sinhala: %s', (key) => {
        expect(typeof en[key]).toBe('string');
        expect(typeof si[key]).toBe('string');
        expect(si[key].length).toBeGreaterThan(0);
        expect(si[key]).not.toBe(en[key]);
    });

    it('keeps the same keys in both languages', () => {
        expect(Object.keys(si).sort()).toEqual(Object.keys(en).sort());
    });

    it('keeps every interpolation in both languages', () => {
        const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

        for (const key of Object.keys(en)) {
            expect(placeholders(si[key])).toEqual(placeholders(en[key]));
        }

        expect(placeholders(en.roundingNote)).toEqual(['{{parts}}', '{{score}}']);
        expect(placeholders(en.roundingNoteSpoken)).toEqual(['{{parts}}', '{{score}}']);
        expect(placeholders(en.badgeLabel)).toEqual(['{{score}}']);
        for (const key of ['score', 'weight', 'contributes']) {
            expect(placeholders(en[key])).toEqual(['{{value}}']);
        }
    });

    it('states the rounding as an approximation, never an exact sum, in both languages', () => {
        for (const lang of [en, si]) {
            expect(lang.roundingNote).toContain('{{parts}} ≈ {{score}}');
            expect(lang.roundingNote).not.toMatch(/=|→|\{\{total\}\}/);
            expect(lang.roundingNoteSpoken).not.toMatch(/=|→|≈|\{\{total\}\}/);
        }

        expect(en.roundingNoteSpoken).toContain('{{parts}} is approximately {{score}}');
    });

    it('uses the English text as the in-code fallback, so the two cannot drift', () => {
        const source = sheet + card + helperSource;

        for (const key of Object.keys(en)) {
            expect(source).toContain(`journey.scoreBreakdown.${key}`);
            expect(source).toContain(en[key]);
        }
    });
});
