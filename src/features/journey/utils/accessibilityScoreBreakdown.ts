/**
 * What the passenger's accessibility score breakdown puts on screen — as data,
 * not as JSX, so it can be tested in this project's node-only Jest.
 *
 * NOTHING HERE CALCULATES A SCORE. The final score and its three factors
 * arrive on the journey search response (`bus.accessibilityScore` and
 * `bus.accessibilityScoreBreakdown`), both produced on the server from the
 * same facilities and evidence by the shared accessibility layer. This module
 * only checks that what arrived can be shown, and words it.
 *
 * The one rule that runs through it: a breakdown is shown only when it
 * explains the very figure on the badge. Anything missing, malformed or not
 * adding up to that figure is reported as `null` — no breakdown — never
 * repaired, defaulted or filled in.
 */

import {
    AccessibilityFactorBreakdown,
    AccessibilityFactorKey,
    MAX_ACCESSIBILITY_SCORE,
    MIN_ACCESSIBILITY_SCORE,
} from '../../../shared/utils/accessibility';

/** The three factors, in the order the score weighs them and the sheet lists them. */
export const SCORE_BREAKDOWN_FACTOR_ORDER: readonly AccessibilityFactorKey[] = [
    'FACILITIES',
    'COMMUNITY',
    'RATINGS',
];

/** Each factor's translation key, with the English text as its in-code fallback. */
export const SCORE_BREAKDOWN_FACTOR_LABELS: Record<
    AccessibilityFactorKey,
    { labelKey: string; labelFallback: string }
> = {
    FACILITIES: { labelKey: 'journey.scoreBreakdown.facilities', labelFallback: 'Facilities' },
    COMMUNITY: { labelKey: 'journey.scoreBreakdown.community', labelFallback: 'Community' },
    RATINGS: { labelKey: 'journey.scoreBreakdown.ratings', labelFallback: 'Passenger Ratings' },
};

/** One factor row of the sheet. Every string is ready to print or to interpolate. */
export interface ScoreBreakdownRow {
    key: AccessibilityFactorKey;
    labelKey: string;
    labelFallback: string;
    /** The factor's own 0–100 value, as the API sent it (unrounded). For colour and the bar only. */
    score: number;
    /** '100': the factor value rounded for display. */
    scoreValue: string;
    /** '100 / 100'. */
    scoreText: string;
    /** '50': the weight as a whole percentage. */
    weightValue: string;
    /** '50%'. */
    weightText: string;
    /** '50.0': the points this factor carried. */
    contributionValue: string;
    /** '50': the most points this factor could carry. */
    maxContributionValue: string;
    /** '50.0 / 50'. */
    contributionText: string;
    /** How full the factor's bar is, 0 to 1. */
    progress: number;
}

/** The whole sheet. */
export interface ScoreBreakdownView {
    /** The badge's own score, exactly as passed in. Never derived from the factors. */
    score: number;
    /** '76 / 100'. */
    scoreText: string;
    rows: ScoreBreakdownRow[];
    /**
     * Why the parts can differ from the whole by a fraction, for
     * '50.0 + 15.0 + 10.8 ≈ 76'.
     *
     * Deliberately no total. The parts are printed to one decimal place and the
     * score is the unrounded total rounded, so any printed total can disagree
     * with both — '15.0 + 5.5 = 20.5 → 20' is a real case. The relationship is
     * stated as an approximation instead, which is always true.
     */
    rounding: {
        /** '50.0 + 15.0 + 10.8': the contributions exactly as the rows print them. */
        parts: string;
        /** '76' — the badge's score, as passed in. */
        score: string;
    };
}

/** A number that can be shown: finite, and not a string or NaN standing in for one. */
function usableNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** One factor as the API sent it, or null when any part of it cannot be read. */
function readFactor(value: unknown): AccessibilityFactorBreakdown | null {
    if (!value || typeof value !== 'object') return null;

    const { key, score, weight, contribution } = value as Record<string, unknown>;

    if (!SCORE_BREAKDOWN_FACTOR_ORDER.includes(key as AccessibilityFactorKey)) return null;
    if (!usableNumber(score) || score < MIN_ACCESSIBILITY_SCORE || score > MAX_ACCESSIBILITY_SCORE) return null;
    if (!usableNumber(weight) || weight <= 0 || weight > 1) return null;
    if (!usableNumber(contribution) || contribution < 0) return null;

    return { key: key as AccessibilityFactorKey, score, weight, contribution };
}

function toRow(factor: AccessibilityFactorBreakdown): ScoreBreakdownRow {
    const { labelKey, labelFallback } = SCORE_BREAKDOWN_FACTOR_LABELS[factor.key];
    const scoreValue = String(Math.round(factor.score));
    const weightValue = String(Math.round(factor.weight * 100));
    const maxContributionValue = String(Math.round(factor.weight * MAX_ACCESSIBILITY_SCORE));
    const contributionValue = factor.contribution.toFixed(1);

    return {
        key: factor.key,
        labelKey,
        labelFallback,
        score: factor.score,
        scoreValue,
        scoreText: `${scoreValue} / ${MAX_ACCESSIBILITY_SCORE}`,
        weightValue,
        weightText: `${weightValue}%`,
        contributionValue,
        maxContributionValue,
        contributionText: `${contributionValue} / ${maxContributionValue}`,
        progress: Math.min(1, Math.max(0, factor.score / MAX_ACCESSIBILITY_SCORE)),
    };
}

/**
 * The breakdown sheet for one journey, or null when there is none to show.
 *
 * Null when the score is not a whole 0–100 number, when the breakdown is not
 * an array of exactly the three factors (each once, each readable), or when
 * the factors do not add up to the score. That last check adds the server's
 * own contributions in the server's own order and compares the whole number
 * with the badge; its sum is never shown, and a mismatch means the two did not
 * come from the same calculation, so neither is explained.
 */
export function accessibilityScoreBreakdownView(
    score: unknown,
    breakdown: unknown
): ScoreBreakdownView | null {
    if (
        !usableNumber(score) ||
        !Number.isInteger(score) ||
        score < MIN_ACCESSIBILITY_SCORE ||
        score > MAX_ACCESSIBILITY_SCORE
    ) {
        return null;
    }

    if (!Array.isArray(breakdown) || breakdown.length !== SCORE_BREAKDOWN_FACTOR_ORDER.length) return null;

    const byKey = new Map<AccessibilityFactorKey, AccessibilityFactorBreakdown>();

    for (const entry of breakdown) {
        const factor = readFactor(entry);

        if (!factor || byKey.has(factor.key)) return null;

        byKey.set(factor.key, factor);
    }

    const factors = SCORE_BREAKDOWN_FACTOR_ORDER.map((key) => byKey.get(key) as AccessibilityFactorBreakdown);
    // A pairing check only: this sum decides whether to explain, never what is shown.
    const total = factors.reduce((sum, factor) => sum + factor.contribution, 0);

    if (Math.round(total) !== score) return null;

    const rows = factors.map(toRow);

    return {
        score,
        scoreText: `${score} / ${MAX_ACCESSIBILITY_SCORE}`,
        rows,
        rounding: {
            parts: rows.map((row) => row.contributionValue).join(' + '),
            score: String(score),
        },
    };
}
