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

import type { AccessibilityFacilityKey } from '../../../shared/utils/accessibility';
import { formatAverageRating, ratingCountLabel } from '../../reports/utils/busCommunityFeedback';
import {
    AccessibilityFactorBreakdown,
    AccessibilityFactorKey,
    AccessibilityTrendPoint,
    AverageAccessibilityScore,
    BusAccessibilitySummary,
    BusFacilityAvailability,
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

/**
 * The colour of each band.
 *
 * Keyed by the band rather than by a threshold of its own, so the colour an
 * admin sees can never disagree with the word printed beside it — there is one
 * set of ranges (the ones above) and this only paints them. Colour is always an
 * addition to the figure and the band word, never the only way to read either.
 */
export const ACCESSIBILITY_SCORE_BAND_COLORS: Record<AccessibilityScoreBand, string> = {
    EXCELLENT: '#2E7D32',
    GOOD: '#558B2F',
    MODERATE: '#F57C00',
    NEEDS_IMPROVEMENT: '#D32F2F',
};

/** The colour for a score, through its band. */
export function accessibilityScoreBandColor(score: number): string {
    return ACCESSIBILITY_SCORE_BAND_COLORS[accessibilityScoreBand(score)];
}

/** How full a 0–100 progress bar is for a score, 0 to 1. A figure outside the scale is clamped. */
export function scoreProgress(score: number): number {
    if (typeof score !== 'number' || !Number.isFinite(score)) return 0;

    return Math.min(1, Math.max(0, score / MAX_ACCESSIBILITY_SCORE));
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
     * Null for a week with no value — a gap, not a point at the bottom.
     *
     * NOT THE TREND CHART'S SCALE, and not what MOV-170 plots. This is
     * normalised against the window's own range, so the same score moves as
     * soon as another week is higher or lower; that is fine for a relative
     * strip and wrong for a chart meant to be compared with itself over time.
     * The chart puts a score on the fixed 0–100 axis instead — see
     * `scoreToY` in utils/accessibilityTrendChart. Reach for that, not this,
     * when placing a score on a canvas.
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

// ------------------------------------------------------------------
// 5. Every bus, each with its own score (the bus-focused page)
//
// As above, nothing here scores. Each bus arrives with the score, factors and
// evidence counts the server produced through MOV-79's functions; this decides
// how they read, how the list is searched and in what order it is shown.
// ------------------------------------------------------------------

/** '2 issues', '1 rating', '20 ratings'. */
function countLabel(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

/** A count off the API, or 0. */
function usableCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** One bus on the Analytics list. */
export interface BusScoreRow {
    busId: string;
    numberPlate: string;
    /** 'Viking · Ashok Leyland', or null when the record names neither. */
    description: string | null;
    status: string | null;
    score: number;
    scoreLabel: string;
    band: AccessibilityScoreBand;
    bandLabel: string;
    color: string;
    /** 0 to 1, for the progress bar. */
    progress: number;
    /** '6 of 8 facilities'. */
    facilitiesLabel: string;
    /** '2 verified issues · 8 positive · 20 ratings'. */
    evidenceLabel: string;
    /** Lower-cased plate, id, model and manufacturer, for the search box. */
    searchText: string;
    accessibilityLabel: string;
}

export const TOTAL_ACCESSIBILITY_FACILITIES = 8;

/** Every bus the API sent, as a row. A bus without a usable score is left out rather than drawn as 0. */
export function busScoreRows(
    buses: readonly BusAccessibilitySummary[] | null | undefined
): BusScoreRow[] {
    if (!Array.isArray(buses)) return [];

    const rows: BusScoreRow[] = [];

    for (const bus of buses) {
        const score = bus?.accessibilityScore;

        if (typeof score !== 'number' || !Number.isFinite(score) || typeof bus.busId !== 'string') continue;

        const band = accessibilityScoreBand(score);
        const bandLabel = ACCESSIBILITY_SCORE_BAND_LABELS[band];
        const numberPlate = bus.numberPlate || bus.busId;
        const description = [bus.busModel, bus.manufacturer].filter(Boolean).join(' · ') || null;
        const issues = usableCount(bus.community?.issueCount);
        const positive = usableCount(bus.community?.positiveCount);
        const ratings = usableCount(bus.ratings?.count);
        const facilitiesLabel = `${usableCount(bus.availableFacilityCount)} of ${TOTAL_ACCESSIBILITY_FACILITIES} facilities`;
        const evidenceLabel = [
            countLabel(issues, 'verified issue', 'verified issues'),
            `${positive} positive`,
            countLabel(ratings, 'rating', 'ratings'),
        ].join(' · ');

        rows.push({
            busId: bus.busId,
            numberPlate,
            description,
            status: bus.status ?? null,
            score,
            scoreLabel: formatScore(score),
            band,
            bandLabel,
            color: ACCESSIBILITY_SCORE_BAND_COLORS[band],
            progress: scoreProgress(score),
            facilitiesLabel,
            evidenceLabel,
            searchText: [numberPlate, bus.busId, bus.busModel, bus.manufacturer]
                .filter(Boolean)
                .join(' ')
                .toLowerCase(),
            accessibilityLabel: [
                `Bus ${numberPlate}`,
                ...(description ? [description] : []),
                ...(bus.status ? [`status ${bus.status.toLowerCase()}`] : []),
                `accessibility score ${formatScore(score)}, ${bandLabel}`,
                facilitiesLabel,
                evidenceLabel,
            ].join(', '),
        });
    }

    return rows;
}

export type BusStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

export type BusScoreSort = 'SCORE_ASC' | 'SCORE_DESC' | 'PLATE';

export const BUS_SCORE_SORT_LABELS: Record<BusScoreSort, string> = {
    SCORE_ASC: 'Lowest score',
    SCORE_DESC: 'Highest score',
    PLATE: 'Number plate',
};

/**
 * The rows matching a search and a status, in the chosen order.
 *
 * Every ordering breaks its ties on the plate and then the id, so the list does
 * not reshuffle between loads.
 */
export function filterBusScoreRows(
    rows: readonly BusScoreRow[],
    options: { search?: string; status?: BusStatusFilter; sort?: BusScoreSort } = {}
): BusScoreRow[] {
    const term = (options.search ?? '').trim().toLowerCase();
    const status = options.status ?? 'ALL';
    const sort = options.sort ?? 'SCORE_ASC';

    const byPlate = (first: BusScoreRow, second: BusScoreRow) =>
        first.numberPlate.localeCompare(second.numberPlate) || first.busId.localeCompare(second.busId);

    return rows
        .filter((row) => (status === 'ALL' || row.status === status) && (!term || row.searchText.includes(term)))
        .sort((first, second) => {
            if (sort === 'SCORE_ASC' && first.score !== second.score) return first.score - second.score;
            if (sort === 'SCORE_DESC' && first.score !== second.score) return second.score - first.score;

            return byPlate(first, second);
        });
}

// ------------------------------------------------------------------
// 6. One bus in detail
// ------------------------------------------------------------------

/** The eight canonical facilities, in words, under the field names the bus record stores. */
export const FACILITY_LABELS: Record<AccessibilityFacilityKey, string> = {
    wheelchairRamp: 'Wheelchair Ramp',
    audioAnnouncement: 'Audio Announcement',
    lowFloorVehicle: 'Low Floor Vehicle',
    walkingAssistance: 'Walking Assistance',
    wheelchairSpace: 'Wheelchair Space',
    guardianSeats: 'Guardian Seats',
    prioritySeats: 'Priority Seats',
    elderlySeats: 'Elderly Seats',
};

export const FACTOR_LABELS: Record<AccessibilityFactorKey, string> = {
    FACILITIES: 'Facilities',
    COMMUNITY: 'Community',
    RATINGS: 'Passenger Ratings',
};

/**
 * A factor's value for display, as a whole number.
 *
 * Display only. The factor itself stays unrounded on the API, as MOV-79
 * produced it and weighed it.
 */
export function formatFactorScore(score: number): string {
    return `${Math.round(score)} / ${MAX_ACCESSIBILITY_SCORE}`;
}

/** '50%' from 0.5. */
export function formatWeight(weight: number): string {
    return `${Math.round(weight * 100)}%`;
}

/** '37.5 / 50': the points a factor carried, out of the most it could. */
export function formatContribution(contribution: number, weight: number): string {
    return `${contribution.toFixed(1)} / ${Math.round(weight * MAX_ACCESSIBILITY_SCORE)}`;
}

/** One row of the score breakdown. */
export interface FactorRow {
    key: AccessibilityFactorKey;
    label: string;
    scoreLabel: string;
    weightLabel: string;
    contributionLabel: string;
    progress: number;
    color: string;
    accessibilityLabel: string;
}

/** The three factors, in the order the API sent them. */
export function factorRows(factors: readonly AccessibilityFactorBreakdown[] | null | undefined): FactorRow[] {
    // Annotated rather than inferred: Array.isArray narrows a readonly array
    // union to any[], which would untype every factor below.
    const list: readonly AccessibilityFactorBreakdown[] = Array.isArray(factors) ? factors : [];

    return list
        .filter(
            (factor) =>
                factor &&
                FACTOR_LABELS[factor.key] !== undefined &&
                typeof factor.score === 'number' &&
                Number.isFinite(factor.score) &&
                typeof factor.weight === 'number' &&
                typeof factor.contribution === 'number'
        )
        .map((factor) => {
            const label = FACTOR_LABELS[factor.key];
            const scoreLabel = formatFactorScore(factor.score);
            const weightLabel = `Weight: ${formatWeight(factor.weight)}`;
            const contributionLabel = formatContribution(factor.contribution, factor.weight);

            return {
                key: factor.key,
                label,
                scoreLabel,
                weightLabel,
                contributionLabel,
                progress: scoreProgress(factor.score),
                color: accessibilityScoreBandColor(factor.score),
                accessibilityLabel: `${label}, ${scoreLabel}, ${weightLabel}, contributes ${contributionLabel} points`,
            };
        });
}

/** One facility row. */
export interface FacilityRowView {
    key: AccessibilityFacilityKey;
    label: string;
    available: boolean;
    statusLabel: string;
    /** '4 seats' on a counted facility that is available, else null. */
    detail: string | null;
}

/** All eight facilities, in the order the API sent them. Anything not reported available reads Unavailable. */
export function facilityRows(
    facilities: readonly BusFacilityAvailability[] | null | undefined
): FacilityRowView[] {
    const list: readonly BusFacilityAvailability[] = Array.isArray(facilities) ? facilities : [];

    return list
        .filter((facility) => facility && FACILITY_LABELS[facility.key] !== undefined)
        .map((facility) => {
            const available = facility.available === true;
            const count = typeof facility.count === 'number' && facility.count > 0 ? facility.count : null;
            const [singular, plural] = facility.key === 'wheelchairSpace' ? ['space', 'spaces'] : ['seat', 'seats'];

            return {
                key: facility.key,
                label: FACILITY_LABELS[facility.key],
                available,
                statusLabel: available ? 'Available' : 'Unavailable',
                detail: available && count !== null ? countLabel(count, singular, plural) : null,
            };
        });
}

/** What the community section says about the verified reports. */
export interface CommunityEvidenceView {
    issueCount: number;
    positiveCount: number;
    /** Why the factor sits where it does, in a sentence. */
    note: string;
}

export function communityEvidenceView(
    community: BusAccessibilitySummary['community'] | null | undefined
): CommunityEvidenceView {
    const issueCount = usableCount(community?.issueCount);
    const positiveCount = usableCount(community?.positiveCount);
    const total = issueCount + positiveCount;

    return {
        issueCount,
        positiveCount,
        note:
            total === 0
                ? 'No verified issues or positive feedback yet, so the community factor sits at the neutral 50.'
                : `${countLabel(positiveCount, 'positive feedback', 'positive feedback')} against ${countLabel(issueCount, 'verified issue', 'verified issues')}. While there is little evidence, the factor is pulled toward the neutral 50.`,
    };
}

/** What the ratings section says. The raw average and the score's factor are kept apart. */
export interface RatingEvidenceView {
    hasRatings: boolean;
    /** '4.2 / 5', or 'No ratings yet'. The passenger-facing plain average. */
    averageLabel: string;
    countLabel: string;
    /** '74 / 100': the normalised factor the accessibility score weighs. */
    factorLabel: string | null;
    note: string;
}

export function ratingEvidenceView(
    ratings: BusAccessibilitySummary['ratings'] | null | undefined,
    factors: readonly AccessibilityFactorBreakdown[] | null | undefined
): RatingEvidenceView {
    const count = usableCount(ratings?.count);
    const average = count > 0 ? formatAverageRating(ratings?.average) : null;
    const factor = Array.isArray(factors) ? factors.find((entry) => entry?.key === 'RATINGS') : undefined;
    const factorLabel =
        factor && typeof factor.score === 'number' && Number.isFinite(factor.score)
            ? formatFactorScore(factor.score)
            : null;

    return {
        hasRatings: average !== null,
        averageLabel: average !== null ? `${average} / 5` : 'No ratings yet',
        countLabel: ratingCountLabel(count),
        factorLabel,
        note:
            average === null
                ? 'With no ratings, the rating factor uses the neutral 3 stars.'
                : 'The average is what passengers gave. The rating factor pulls it toward a neutral 3 stars while there are few ratings, then maps 1–5 stars onto 0–100.',
    };
}
