/**
 * What the Accessibility Analytics screen puts on screen — as data, not as JSX
 * (MOV-168).
 *
 * The screen reads four figures off GET /api/analytics/accessibility and has to
 * decide what each one says: what a score of 82 is called, what "no data" reads
 * as, how a ranked row is worded and what a screen reader announces for it.
 * Deriving that here rather than inside the component is what lets it be tested
 * at all, since this project's Jest is node-only with no React renderer — the
 * same reasoning reportSummary and systemStatistics give.
 *
 * NOTHING HERE CALCULATES A SCORE. Every number arrives from the API, which got
 * it from MOV-79's `computeAccessibilityScore` by way of MOV-169. The band
 * below is a LABEL for a number that already exists — it does not adjust,
 * re-weight or re-derive it, and moving a threshold changes only the word
 * printed beside the figure.
 *
 * The one rule that runs through all of it: `null` is not `0`. The backend is
 * careful to distinguish "no bus in service", "no route with a qualifying trip"
 * and "no score recorded by this week" from a real, measured zero, and a screen
 * that renders the first as "0 / 100" throws that away and tells an admin the
 * platform is failing when it is merely new. So every figure here is either a
 * value or an explicit absence, and the absences carry their own wording.
 */

import {
    AccessibilityTrendPoint,
    AverageAccessibilityScore,
    RankedRouteAccessibilityScore,
    ReportedVehicleSummary,
} from './accessibilityAnalytics';

/** The scale every accessibility score is on. */
export const MAX_ACCESSIBILITY_SCORE = 100;

// ------------------------------------------------------------------
// How a score reads
// ------------------------------------------------------------------

/** What a score is called, for the word printed beside the figure. */
export type AccessibilityScoreBand =
    | 'EXCELLENT'
    | 'GOOD'
    | 'MODERATE'
    | 'NEEDS_IMPROVEMENT';

export const ACCESSIBILITY_SCORE_BAND_LABELS: Record<AccessibilityScoreBand, string> = {
    EXCELLENT: 'Excellent',
    GOOD: 'Good',
    MODERATE: 'Moderate',
    NEEDS_IMPROVEMENT: 'Needs Improvement',
};

/**
 * The band a score falls in.
 *
 * Presentation only. The thresholds are a reading aid for an admin — they are
 * not consulted by anything that decides a score, ranks a route or filters a
 * journey, and the API neither sends nor receives them.
 *
 * A score outside 0–100 is clamped into the scale rather than refused: the
 * figure is the API's, and a screen's job is to show it, not to argue with it.
 */
export function accessibilityScoreBand(score: number): AccessibilityScoreBand {
    if (score >= 90) return 'EXCELLENT';
    if (score >= 75) return 'GOOD';
    if (score >= 50) return 'MODERATE';

    return 'NEEDS_IMPROVEMENT';
}

/** The word for a score, e.g. 'Good'. */
export function accessibilityScoreBandLabel(score: number): string {
    return ACCESSIBILITY_SCORE_BAND_LABELS[accessibilityScoreBand(score)];
}

/** '82 / 100'. One wording, so every score on the screen reads the same way. */
export function formatScore(score: number): string {
    return `${score} / ${MAX_ACCESSIBILITY_SCORE}`;
}

/** '1 bus' / '4 buses'. */
export function formatBusCount(count: number): string {
    return `${count} bus${count === 1 ? '' : 'es'}`;
}

/** '1 report' / '12 reports'. */
export function formatReportCount(count: number): string {
    return `${count} report${count === 1 ? '' : 's'}`;
}

// ------------------------------------------------------------------
// 1. Average Accessibility Score
// ------------------------------------------------------------------

/** The hero figure, or the reason there is not one. */
export interface AverageScoreDisplay {
    /** False when the API reported no score. Never a 0 standing in for one. */
    hasScore: boolean;
    /** '82', or null when there is no score to print. */
    value: string | null;
    /** '/ 100', shown only beside a real figure. */
    outOf: string | null;
    /** 'Excellent', or null when there is no score to name. */
    bandLabel: string | null;
    band: AccessibilityScoreBand | null;
    /** 'Based on 5 active buses', or why there is no score. */
    caption: string;
    /** What a screen reader announces for the whole card. */
    accessibilityLabel: string;
}

export const NO_AVERAGE_SCORE_CAPTION = 'No accessibility score available';

/**
 * The Average Accessibility Score card.
 *
 * A `null` value is the API saying no bus in service has a usable score, and it
 * is reported as exactly that. It is never rendered as 0: a fleet with nothing
 * in it and a fleet scoring zero are opposite findings, and the second one is
 * an emergency.
 *
 * `busesIncluded` is stated alongside because an average of one bus and an
 * average of forty are different claims, and the number is what lets an admin
 * tell them apart.
 */
export function averageScoreDisplay(
    average: AverageAccessibilityScore | null | undefined
): AverageScoreDisplay {
    const value = typeof average?.value === 'number' && Number.isFinite(average.value)
        ? average.value
        : null;
    const busesIncluded =
        typeof average?.busesIncluded === 'number' && Number.isFinite(average.busesIncluded)
            ? average.busesIncluded
            : 0;

    if (value === null) {
        return {
            hasScore: false,
            value: null,
            outOf: null,
            bandLabel: null,
            band: null,
            caption: NO_AVERAGE_SCORE_CAPTION,
            accessibilityLabel: `Average accessibility score. ${NO_AVERAGE_SCORE_CAPTION}.`,
        };
    }

    const band = accessibilityScoreBand(value);
    const bandLabel = ACCESSIBILITY_SCORE_BAND_LABELS[band];
    const caption = `Based on ${formatBusCount(busesIncluded)} in service`;

    return {
        hasScore: true,
        value: String(value),
        outOf: `/ ${MAX_ACCESSIBILITY_SCORE}`,
        bandLabel,
        band,
        caption,
        // One label for the card, leading with the figure that is the point of it.
        accessibilityLabel: `Average accessibility score ${formatScore(value)}. ${bandLabel}. ${caption}.`,
    };
}

// ------------------------------------------------------------------
// 2. Most Accessible Routes
// ------------------------------------------------------------------

/** One row of the ranked routes list. */
export interface RouteRow {
    /** Stable key and the ordinal shown on the row. */
    routeId: string;
    rank: number;
    rankLabel: string;
    routeNumber: string;
    /** Absent on a route stored without a name; the row omits the line. */
    routeName: string | null;
    score: number;
    scoreLabel: string;
    bandLabel: string;
    busLabel: string;
    accessibilityLabel: string;
}

/**
 * The ranked routes, exactly in the order the API returned them.
 *
 * The API already ranks and already limits to five. Re-sorting here would be a
 * second opinion about what "most accessible" means, and one that could
 * disagree with the list the backend is tested on — so the rank is simply the
 * position each row arrived in.
 */
export function routeRows(
    routes: readonly RankedRouteAccessibilityScore[] | null | undefined
): RouteRow[] {
    if (!Array.isArray(routes)) return [];

    return routes.map((route, index) => {
        const rank = index + 1;
        const routeNumber = route.routeNumber ?? route.routeId;
        const bandLabel = accessibilityScoreBandLabel(route.averageScore);
        const busLabel = formatBusCount(route.busCount);

        return {
            routeId: route.routeId,
            rank,
            rankLabel: `#${rank}`,
            routeNumber,
            routeName: route.routeName ?? null,
            score: route.averageScore,
            scoreLabel: formatScore(route.averageScore),
            bandLabel,
            busLabel,
            accessibilityLabel: [
                `Rank ${rank}`,
                `route ${routeNumber}`,
                ...(route.routeName ? [route.routeName] : []),
                `${formatScore(route.averageScore)}, ${bandLabel}`,
                `averaged over ${busLabel}`,
            ].join(', '),
        };
    });
}

// ------------------------------------------------------------------
// 3. Most Reported Vehicles
// ------------------------------------------------------------------

/** One row of the reported vehicles list. */
export interface VehicleRow {
    busId: string;
    rank: number;
    rankLabel: string;
    numberPlate: string;
    /** 'Viking · Ashok Leyland', or null when the record names neither. */
    description: string | null;
    reportCount: number;
    reportLabel: string;
    verifiedReportCount: number;
    verifiedLabel: string;
    accessibilityLabel: string;
}

/**
 * The most reported vehicles, in the order the API ranked them.
 *
 * Both counts are shown. The total is what ranks the row, and the verified
 * count is how much of it an admin has upheld — the same pair the dashboard's
 * Reports tile states, and the reason a row reads as evidence rather than as an
 * accusation.
 */
export function vehicleRows(
    vehicles: readonly ReportedVehicleSummary[] | null | undefined
): VehicleRow[] {
    if (!Array.isArray(vehicles)) return [];

    return vehicles.map((vehicle, index) => {
        const rank = index + 1;
        const description = [vehicle.busModel, vehicle.manufacturer].filter(Boolean).join(' · ');
        const reportLabel = formatReportCount(vehicle.reportCount);
        const verifiedLabel = `${vehicle.verifiedReportCount} verified`;

        return {
            busId: vehicle.busId,
            rank,
            rankLabel: `#${rank}`,
            numberPlate: vehicle.numberPlate,
            description: description || null,
            reportCount: vehicle.reportCount,
            reportLabel,
            verifiedReportCount: vehicle.verifiedReportCount,
            verifiedLabel,
            accessibilityLabel: `Rank ${rank}, vehicle ${vehicle.numberPlate}, ${reportLabel}, ${verifiedLabel}`,
        };
    });
}

// ------------------------------------------------------------------
// 4. Accessibility Trends
// ------------------------------------------------------------------

/** One week of the trend, ready to draw. */
export interface TrendPointView {
    /** The ISO date the week starts on, as the API sent it. */
    date: string;
    /** '21 Sep' — the week, for an axis label. */
    label: string;
    /** False for a week no bus had a recorded score by. Never a 0. */
    hasValue: boolean;
    score: number | null;
    scoreLabel: string | null;
    /**
     * Where this point sits between the lowest and highest weeks, 0 to 1.
     *
     * Null for a week with no value — a gap in the line, not a point at the
     * bottom of it. This is the one number a visual needs that the API does not
     * send, and it is derived here so MOV-170's chart can be handed a series
     * rather than work it out again.
     */
    heightRatio: number | null;
    accessibilityLabel: string;
}

/** The whole series, and what can be said about it. */
export interface TrendView {
    points: TrendPointView[];
    /** False when no week in the window has a score — the section says so. */
    hasAnyValue: boolean;
    /** The most recent week that has a score, for the headline figure. */
    latestScore: number | null;
    lowestScore: number | null;
    highestScore: number | null;
    /** 'No trend data available yet', or a summary of the window. */
    summary: string;
}

export const NO_TREND_DATA_SUMMARY = 'No trend data available yet';

const TREND_MONTH_LABELS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * '21 Sep' from '2026-09-21'. The date itself when it cannot be read.
 *
 * Spelled out from a fixed table rather than through `toLocaleDateString`,
 * which is not the same function everywhere: its abbreviations depend on the
 * ICU data the runtime was built with — Node here says 'Sept' where others say
 * 'Sep' — and Hermes ships without full ICU on some builds, so an axis label
 * could differ between a test, a simulator and a phone. A twelve-entry table is
 * the same label on all three.
 *
 * Read in UTC, because the API's bucket dates are UTC day boundaries: parsing
 * one in a local timezone west of Greenwich would label it the previous day.
 */
export function formatTrendDate(date: string): string {
    const time = new Date(`${date}T00:00:00.000Z`).getTime();

    if (Number.isNaN(time)) return date;

    const parsed = new Date(time);

    return `${parsed.getUTCDate()} ${TREND_MONTH_LABELS[parsed.getUTCMonth()]}`;
}

/**
 * The weekly trend, ready for the section to draw.
 *
 * The API owns the trend: it decides the window, the buckets and how a score is
 * carried forward, and this does not recalculate any of it — the points arrive
 * in order and stay in it.
 *
 * What is added is the one thing a visual needs and the API does not send:
 * where each week sits between the lowest and the highest. A week with no score
 * gets `null` rather than 0, so a chart draws a gap where there is no data
 * instead of a line falling to the floor.
 *
 * When every week has the same score the ratio is 1 for all of them: a flat
 * line at the top reads as "steady", where dividing by a zero range would read
 * as nothing at all.
 */
export function trendView(
    trend: readonly AccessibilityTrendPoint[] | null | undefined
): TrendView {
    const points = Array.isArray(trend) ? trend : [];

    const scores = points
        .map((point) => point?.averageScore)
        .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));

    const lowestScore = scores.length > 0 ? Math.min(...scores) : null;
    const highestScore = scores.length > 0 ? Math.max(...scores) : null;
    const range =
        lowestScore !== null && highestScore !== null ? highestScore - lowestScore : 0;

    const views: TrendPointView[] = points.map((point) => {
        const date = typeof point?.date === 'string' ? point.date : '';
        const label = date ? formatTrendDate(date) : '';
        const score =
            typeof point?.averageScore === 'number' && Number.isFinite(point.averageScore)
                ? point.averageScore
                : null;

        if (score === null) {
            return {
                date,
                label,
                hasValue: false,
                score: null,
                scoreLabel: null,
                heightRatio: null,
                accessibilityLabel: `Week of ${label}, no data`,
            };
        }

        return {
            date,
            label,
            hasValue: true,
            score,
            scoreLabel: formatScore(score),
            heightRatio: range === 0 ? 1 : (score - (lowestScore as number)) / range,
            accessibilityLabel: `Week of ${label}, average score ${score}`,
        };
    });

    const withValues = views.filter((point) => point.hasValue);
    const latestScore = withValues.length > 0 ? withValues[withValues.length - 1].score : null;

    return {
        points: views,
        hasAnyValue: withValues.length > 0,
        latestScore,
        lowestScore,
        highestScore,
        summary:
            withValues.length === 0
                ? NO_TREND_DATA_SUMMARY
                : `${withValues.length} of ${views.length} weeks recorded · low ${lowestScore}, high ${highestScore}`,
    };
}
