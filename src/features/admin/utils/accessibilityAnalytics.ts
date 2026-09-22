/**
 * The accessibility analytics the Admin Dashboard reports (MOV-169, for MOV-133).
 *
 *   Average Accessibility Score — the mean score of the buses in service.
 *   Most Accessible Routes      — routes ranked by the buses that actually run them.
 *   Most Reported Vehicles      — buses ranked by the issue reports filed against them.
 *   Accessibility Trends        — the fleet's average score, week by week.
 *
 * Pure, and deliberately so, for the reason systemStatistics gives: this
 * project's Jest is node-only with no React renderer, so arithmetic inside a
 * screen or inside a route handler cannot be tested and arithmetic in a module
 * can. Nothing here fetches, and nothing here scores.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO.
 * It does not calculate an accessibility score. That is MOV-79's
 * `computeAccessibilityScore`, evidence-backed, and it is called by the loader
 * (shared/server/accessibilityAnalytics) before anything here runs. A bus
 * arrives with its score already on it. There is no second formula in this
 * file, no weights, and no approximation from facilities alone — a score
 * derived that way would sit at the neutral 50 for community and ratings and
 * would disagree with every figure the passenger APIs report for the same bus.
 *
 * Three conventions run through the module, the first two lifted from
 * systemStatistics because these numbers sit beside those ones:
 *
 * 1. `null` and `0` are different answers. `null` is "nothing to average" —
 *    no bus in service, no route with a qualifying trip, no history yet; `0`
 *    is a real score of zero. A chart that confuses them draws a platform in
 *    crisis where there is merely no data.
 *
 * 2. Every figure is derived from what was actually loaded. Nothing reads a
 *    stored aggregate, and nothing reads the `counters` collection.
 *
 * 3. Ordering is total and deterministic. Every ranking breaks its ties on a
 *    stable identifier, so the same data always produces the same Top 5 rather
 *    than one that reshuffles between requests.
 */

import {
    AccessibilityReport,
    reportTypeOf,
} from '../../../entities/report/model/types';
import {
    ACTIVE_VEHICLE_STATUS,
    VERIFIED_REPORT_STATUS,
} from './systemStatistics';

// ------------------------------------------------------------------
// What each figure counts
// ------------------------------------------------------------------

/**
 * A trip counts when its schedule is enabled.
 *
 * The trip's own `status`, exactly as `ACTIVE_TRIP_STATUS` means it in
 * systemStatistics — not whether a bus has a journey running on it right now.
 * A route is described by the timetable that is switched on, not by which of
 * its buses happens to be moving.
 *
 * Restated here rather than imported so the two statuses this module compares
 * read side by side; it is the same string, and systemStatistics owns the
 * statement of what it means.
 */
export const ACTIVE_TRIP_STATUS = 'ACTIVE';

/** How many rows a ranked list returns. Both lists show the same depth. */
export const TOP_RANKED_LIMIT = 5;

/** How many weekly buckets the trend covers. */
export const TREND_WEEKS = 12;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// ------------------------------------------------------------------
// The shapes this module is fed
//
// Structural rather than the entity interfaces, for the reason systemStatistics
// gives: it keeps the module free of the loader that produces them, and it lets
// a test hand over a plain object instead of building a whole Bus. The real
// Bus, Trip, Route, AccessibilityReport and AccessibilityScoreHistoryEntry all
// satisfy these.
// ------------------------------------------------------------------

/**
 * One bus, with the score MOV-79 produced for it.
 *
 * `accessibilityScore` is an INPUT. It is `computeAccessibilityScore` called
 * with real evidence — the same call the booking and journey APIs make — and
 * nothing in this module recomputes, adjusts or rounds it.
 *
 * The three display fields are the live fleet record, used only where a report
 * carried no snapshot of its own.
 */
export interface ScoredBus {
    busId: string;
    status?: unknown;
    /** 0–100, from computeAccessibilityScore. Absent when it could not be produced. */
    accessibilityScore?: unknown;
    numberPlate?: unknown;
    busModel?: unknown;
    manufacturer?: unknown;
}

/** Enough of a trip to join a bus to a route. */
export interface AnalyticsTrip {
    routeId?: unknown;
    busId?: unknown;
    status?: unknown;
}

/** Enough of a route to rank and name it. */
export interface AnalyticsRoute {
    routeId?: unknown;
    routeNumber?: unknown;
    routeName?: unknown;
}

/**
 * Enough of a report to attribute it to a vehicle.
 *
 * `type` is read through `reportTypeOf`, never directly — an issue report is
 * stored without the field at all, so a direct comparison would misread every
 * report filed before positive feedback existed.
 */
export type AnalyticsReport = Partial<
    Pick<AccessibilityReport, 'busId' | 'status' | 'type' | 'vehicle'>
>;

/** Enough of a score history entry to place it on a week. */
export interface AnalyticsHistoryEntry {
    busId?: unknown;
    accessibilityScore?: unknown;
    /** ISO 8601, as `recordAccessibilityScore` stored it. */
    calculatedAt?: unknown;
}

// ------------------------------------------------------------------
// What this module answers with
// ------------------------------------------------------------------

/** The fleet's average score, and how many buses it was taken over. */
export interface AverageAccessibilityScore {
    /** null when no bus in service has a usable score — never 0. */
    value: number | null;
    busesIncluded: number;
}

/** One route's accessibility, from the buses that run it. */
export interface RouteAccessibilityScore {
    routeId: string;
    routeNumber: string;
    routeName: string | null;
    /** null when no qualifying bus runs this route — never 0. */
    averageScore: number | null;
    /** Distinct qualifying buses. A bus with five turns on the route counts once. */
    busCount: number;
}

/** One route in the ranked list, which only scored routes can enter. */
export interface RankedRouteAccessibilityScore extends RouteAccessibilityScore {
    averageScore: number;
}

/** One vehicle's issue reports. */
export interface ReportedVehicleSummary {
    busId: string;
    /** The snapshot's plate, else the fleet record's, else the id. Never empty. */
    numberPlate: string;
    busModel: string | null;
    manufacturer: string | null;
    /** Issue reports naming this bus, whatever their status. */
    reportCount: number;
    /** How many of those an admin has upheld. Always <= reportCount. */
    verifiedReportCount: number;
}

/** One week of the trend. */
export interface AccessibilityTrendPoint {
    /** The Monday-agnostic ISO date the bucket STARTS on: `2026-09-21`. */
    date: string;
    /** null when no bus had a known score by the end of this week — never 0. */
    averageScore: number | null;
}

// ------------------------------------------------------------------
// Reading untrusted values
// ------------------------------------------------------------------

/** A non-empty string, or null. Firestore is schema-less; a number id is not an id. */
function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A score that can be averaged: a finite number. A 0 is a real score and is kept. */
function usableScore(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An ISO 8601 instant as milliseconds, or null when it cannot be read. */
function instant(value: unknown): number | null {
    if (typeof value !== 'string' || !value.trim()) return null;

    const time = new Date(value).getTime();

    return Number.isNaN(time) ? null : time;
}

/** Whether a record carries exactly this status. */
function hasStatus(record: { status?: unknown } | null | undefined, status: string): boolean {
    return record?.status === status;
}

/**
 * The mean of some scores, rounded to a whole number, or null when there are
 * none.
 *
 * Whole numbers because that is the scale `computeAccessibilityScore` reports
 * on — it rounds its own result — so an average of scores stays a figure on
 * the same scale rather than a more precise-looking number that is not.
 *
 * Null for an empty list rather than 0: there is nothing to average, and 0 is
 * the score of a bus with no facilities and poor evidence, which is a finding.
 */
function meanScore(scores: readonly number[]): number | null {
    if (scores.length === 0) return null;

    const total = scores.reduce((sum, score) => sum + score, 0);

    return Math.round(total / scores.length);
}

// ==================================================================
// 1. Average Accessibility Score
// ==================================================================

/**
 * The mean accessibility score of the buses in service.
 *
 * ACTIVE buses only — the same `ACTIVE_VEHICLE_STATUS` the dashboard's Active
 * Vehicles statistic counts, so "the fleet" means one thing on both. A bus that
 * is INACTIVE or in MAINTENANCE is not carrying passengers, and averaging it in
 * would describe a fleet nobody can ride.
 *
 * A bus with no usable score is left out of both the total and the count, so
 * `busesIncluded` always says exactly how many buses the figure rests on.
 */
export function averageAccessibilityScore(
    buses: readonly ScoredBus[] | null | undefined
): AverageAccessibilityScore {
    if (!Array.isArray(buses)) return { value: null, busesIncluded: 0 };

    const scores: number[] = [];

    for (const bus of buses) {
        if (!hasStatus(bus, ACTIVE_VEHICLE_STATUS)) continue;

        const score = usableScore(bus?.accessibilityScore);

        if (score !== null) scores.push(score);
    }

    return { value: meanScore(scores), busesIncluded: scores.length };
}

// ==================================================================
// 2. Most Accessible Routes
// ==================================================================

/**
 * The buses that qualify to describe a route, by route id.
 *
 * A route has no accessibility of its own and no permanent vehicle: the only
 * association this project holds is `Trip.routeId` + `Trip.busId`, and the trip
 * entity says so outright — "a bus relates to routes only through its trips".
 *
 * Both ends have to be in service. An ACTIVE trip operated by a withdrawn bus
 * describes nothing a passenger can board, and an ACTIVE bus on a disabled turn
 * is not serving this route today.
 *
 * A Set per route is what makes the count distinct: five turns by the same bus
 * are one bus, so a frequent vehicle cannot pull a route's average toward its
 * own score.
 */
function qualifyingBusesByRoute(
    trips: readonly AnalyticsTrip[],
    scoreByBusId: ReadonlyMap<string, number>
): Map<string, Set<string>> {
    const byRoute = new Map<string, Set<string>>();

    for (const trip of trips) {
        if (!hasStatus(trip, ACTIVE_TRIP_STATUS)) continue;

        const routeId = text(trip?.routeId);
        const busId = text(trip?.busId);

        if (!routeId || !busId || !scoreByBusId.has(busId)) continue;

        const buses = byRoute.get(routeId) ?? new Set<string>();

        buses.add(busId);
        byRoute.set(routeId, buses);
    }

    return byRoute;
}

/** The score of every ACTIVE bus that has one, by bus id. */
function activeBusScores(buses: readonly ScoredBus[]): Map<string, number> {
    const scores = new Map<string, number>();

    for (const bus of buses) {
        if (!hasStatus(bus, ACTIVE_VEHICLE_STATUS)) continue;

        const busId = text(bus?.busId);
        const score = usableScore(bus?.accessibilityScore);

        if (busId && score !== null) scores.set(busId, score);
    }

    return scores;
}

/**
 * Every route with the average score of the distinct buses that run it.
 *
 * A route nothing qualifying runs scores `null` and counts 0 buses. That is
 * "we cannot say", and it is deliberately not a 0 — a route with no enabled
 * trips is not an inaccessible route, and ranking it as one would put the
 * timetable gaps at the bottom of a list about accessibility.
 *
 * Returned for every route, in the order the routes arrived, so a caller can
 * see the unscored ones. `mostAccessibleRoutes` is what ranks them.
 */
export function routeAccessibilityScores(
    routes: readonly AnalyticsRoute[] | null | undefined,
    trips: readonly AnalyticsTrip[] | null | undefined,
    buses: readonly ScoredBus[] | null | undefined
): RouteAccessibilityScore[] {
    if (!Array.isArray(routes)) return [];

    const scoreByBusId = activeBusScores(Array.isArray(buses) ? buses : []);
    const busesByRoute = qualifyingBusesByRoute(
        Array.isArray(trips) ? trips : [],
        scoreByBusId
    );

    const summaries: RouteAccessibilityScore[] = [];

    for (const route of routes) {
        const routeId = text(route?.routeId);

        if (!routeId) continue;

        const busIds = busesByRoute.get(routeId) ?? new Set<string>();
        const scores = [...busIds].map((busId) => scoreByBusId.get(busId) as number);

        summaries.push({
            routeId,
            // The number is how an admin recognises a route; the id is how the
            // system does. A route stored without one still has to be nameable.
            routeNumber: text(route?.routeNumber) ?? routeId,
            routeName: text(route?.routeName),
            averageScore: meanScore(scores),
            busCount: busIds.size,
        });
    }

    return summaries;
}

/**
 * The most accessible routes, best first.
 *
 * Only routes with a score can be ranked. An unscored route is not held at the
 * bottom of the list either — "unknown always sorts last" is `journeyRanking`'s
 * rule for ordering, and a list of the FIVE most accessible routes that is
 * padded with routes whose accessibility is unknown is not answering the
 * question. They remain visible through `routeAccessibilityScores`.
 *
 * Ties break on the bus count and then the route id, so the ranking is total:
 * two routes averaging 80 always come back in the same order, and the one
 * measured over more buses is the better-evidenced claim.
 */
export function mostAccessibleRoutes(
    routes: readonly AnalyticsRoute[] | null | undefined,
    trips: readonly AnalyticsTrip[] | null | undefined,
    buses: readonly ScoredBus[] | null | undefined,
    limit: number = TOP_RANKED_LIMIT
): RankedRouteAccessibilityScore[] {
    const ranked = routeAccessibilityScores(routes, trips, buses).filter(
        (route): route is RankedRouteAccessibilityScore => route.averageScore !== null
    );

    ranked.sort((first, second) => {
        if (second.averageScore !== first.averageScore) {
            return second.averageScore - first.averageScore;
        }

        if (second.busCount !== first.busCount) return second.busCount - first.busCount;

        return first.routeId.localeCompare(second.routeId);
    });

    return ranked.slice(0, Math.max(0, limit));
}

// ==================================================================
// 3. Most Reported Vehicles
// ==================================================================

/**
 * One vehicle's display details, preferring what the report recorded.
 *
 * A report snapshots the bus it named at the moment it was filed, precisely so
 * it keeps reading correctly after that bus is retired or re-plated. So the
 * snapshot leads and the live fleet record fills the gaps — the convention
 * `reportCardSummary` already follows.
 *
 * The bus id is the last resort for the plate, as it is on a report card: a
 * row whose snapshot and fleet record are both missing still has to identify
 * which vehicle it is about.
 */
function vehicleIdentity(
    busId: string,
    snapshot: AccessibilityReport['vehicle'] | null,
    bus: ScoredBus | undefined
): Pick<ReportedVehicleSummary, 'numberPlate' | 'busModel' | 'manufacturer'> {
    return {
        numberPlate: text(snapshot?.numberPlate) ?? text(bus?.numberPlate) ?? busId,
        busModel: text(snapshot?.busModel) ?? text(bus?.busModel),
        manufacturer: text(snapshot?.manufacturer) ?? text(bus?.manufacturer),
    };
}

/**
 * The buses with the most issue reports against them, worst first.
 *
 * ISSUE reports only, read through `reportTypeOf` — positive feedback lives in
 * the same collection and is the opposite finding. Counting a compliment
 * towards "most reported" would rank the buses passengers praise alongside the
 * ones they are complaining about.
 *
 * Every status counts towards `reportCount`, including REJECTED. This is a
 * statistic about what was reported, not about what was upheld: dropping the
 * rejected ones would make the number fall whenever an admin decided one, and
 * `verifiedReportCount` is what states how much of it an admin stands behind —
 * the same pair the dashboard's Reports tile already shows.
 *
 * A report naming no bus is counted towards no bus. It is a real report about
 * a stop or a route, and attributing it to a vehicle would be inventing the
 * one fact it deliberately does not carry.
 *
 * `reports` is expected newest first, which is the order the loader hands them
 * over in; the display details are taken from the first snapshot that carries
 * a plate, so a re-plated bus reads as it most recently did.
 */
export function mostReportedVehicles(
    reports: readonly AnalyticsReport[] | null | undefined,
    buses: readonly ScoredBus[] | null | undefined,
    limit: number = TOP_RANKED_LIMIT
): ReportedVehicleSummary[] {
    if (!Array.isArray(reports)) return [];

    const busById = new Map<string, ScoredBus>();

    for (const bus of Array.isArray(buses) ? buses : []) {
        const busId = text(bus?.busId);

        if (busId) busById.set(busId, bus);
    }

    const tallies = new Map<string, ReportedVehicleSummary>();
    /** The first snapshot seen for a bus that actually carried a plate. */
    const snapshots = new Map<string, AccessibilityReport['vehicle']>();

    for (const report of reports) {
        if (!report || reportTypeOf(report) === 'POSITIVE') continue;

        const busId = text(report.busId);

        if (!busId) continue;

        if (!snapshots.has(busId) && text(report.vehicle?.numberPlate)) {
            snapshots.set(busId, report.vehicle);
        }

        const tally = tallies.get(busId) ?? {
            busId,
            numberPlate: busId,
            busModel: null,
            manufacturer: null,
            reportCount: 0,
            verifiedReportCount: 0,
        };

        tally.reportCount += 1;

        if (hasStatus(report, VERIFIED_REPORT_STATUS)) tally.verifiedReportCount += 1;

        tallies.set(busId, tally);
    }

    const ranked = [...tallies.values()].map((tally) => ({
        ...tally,
        ...vehicleIdentity(tally.busId, snapshots.get(tally.busId) ?? null, busById.get(tally.busId)),
    }));

    // Most reported first; a tie goes to the bus with more of those upheld, and
    // then to the bus id, so the ranking is total and repeatable.
    ranked.sort((first, second) => {
        if (second.reportCount !== first.reportCount) {
            return second.reportCount - first.reportCount;
        }

        if (second.verifiedReportCount !== first.verifiedReportCount) {
            return second.verifiedReportCount - first.verifiedReportCount;
        }

        return first.busId.localeCompare(second.busId);
    });

    return ranked.slice(0, Math.max(0, limit));
}

// ==================================================================
// 4. Accessibility Trends
// ==================================================================

/** Where a weekly bucket starts and ends. The end is exclusive. */
interface TrendBucket {
    date: string;
    end: number;
}

/** Midnight UTC on the day this instant falls, so a bucket is a whole day wide. */
function startOfUtcDay(time: number): number {
    return Math.floor(time / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * The weekly buckets ending with the week `now` falls in, oldest first.
 *
 * Anchored on `now` rather than on a calendar weekday: the chart answers "the
 * last twelve weeks", and a fixed anchor means the newest bucket is always the
 * current week rather than a part-week whose width depends on what day the
 * admin opened the screen.
 *
 * Each bucket is labelled by the date it STARTS on and is measured at the
 * moment it ENDS — so a score recorded on the Wednesday shows up in that week,
 * not the next one.
 */
function trendBuckets(now: Date, weeks: number): TrendBucket[] {
    const count = Math.max(0, Math.floor(weeks));

    if (count === 0) return [];

    const lastStart = startOfUtcDay(now.getTime());
    const firstStart = lastStart - (count - 1) * MS_PER_WEEK;

    const buckets: TrendBucket[] = [];

    for (let index = 0; index < count; index += 1) {
        const start = firstStart + index * MS_PER_WEEK;

        buckets.push({
            date: new Date(start).toISOString().slice(0, 10),
            end: start + MS_PER_WEEK,
        });
    }

    return buckets;
}

/** One history entry, read and usable. */
interface TrendEntry {
    busId: string;
    score: number;
    at: number;
}

/** Each bus's entries, oldest first. Unreadable entries are dropped, not guessed. */
function entriesByBus(
    history: readonly AnalyticsHistoryEntry[]
): Map<string, TrendEntry[]> {
    const byBus = new Map<string, TrendEntry[]>();

    for (const entry of history) {
        const busId = text(entry?.busId);
        const score = usableScore(entry?.accessibilityScore);
        const at = instant(entry?.calculatedAt);

        if (!busId || score === null || at === null) continue;

        const entries = byBus.get(busId) ?? [];

        entries.push({ busId, score, at });
        byBus.set(busId, entries);
    }

    for (const entries of byBus.values()) {
        entries.sort((first, second) => first.at - second.at);
    }

    return byBus;
}

/**
 * The fleet's average accessibility score, week by week.
 *
 * The history is EVENT-DRIVEN: `recordAccessibilityScore` writes an entry only
 * when a value actually changed, so the entries are not a series and plotting
 * them raw would draw a line that moves only on the weeks somebody happened to
 * file a report. What a week is worth is the score each bus STOOD AT by the end
 * of it, which is its latest entry at or before that point carried forward.
 *
 * A bus contributes nothing to a week that precedes its first entry. That is
 * the honest reading — the score was not 0 before it was first recorded, it was
 * unknown — and a bus joining the fleet halfway through therefore moves the
 * line from the week it arrived rather than dragging the whole chart down.
 *
 * A week no bus had reached yet is `null`. Buses whose history begins later
 * leave the early weeks empty, which is exactly what the history of a feature
 * younger than the fleet looks like.
 */
export function accessibilityScoreTrend(
    history: readonly AnalyticsHistoryEntry[] | null | undefined,
    options: { now?: Date; weeks?: number } = {}
): AccessibilityTrendPoint[] {
    const buckets = trendBuckets(options.now ?? new Date(), options.weeks ?? TREND_WEEKS);
    const byBus = entriesByBus(Array.isArray(history) ? history : []);

    return buckets.map((bucket) => {
        const scores: number[] = [];

        for (const entries of byBus.values()) {
            let carried: number | null = null;

            // Entries are oldest first, so the last one inside the window is the
            // score the bus stood at when the week closed.
            for (const entry of entries) {
                if (entry.at >= bucket.end) break;

                carried = entry.score;
            }

            if (carried !== null) scores.push(carried);
        }

        return { date: bucket.date, averageScore: meanScore(scores) };
    });
}

// ==================================================================
// The whole report
// ==================================================================

/** Everything the analytics endpoint answers with, apart from its envelope. */
export interface AccessibilityAnalytics {
    averageScore: AverageAccessibilityScore;
    mostAccessibleRoutes: RankedRouteAccessibilityScore[];
    mostReportedVehicles: ReportedVehicleSummary[];
    trend: AccessibilityTrendPoint[];
}

/** What the analytics are derived from, once every collection has been read. */
export interface AccessibilityAnalyticsInput {
    buses?: readonly ScoredBus[] | null;
    trips?: readonly AnalyticsTrip[] | null;
    routes?: readonly AnalyticsRoute[] | null;
    /** Newest first — see mostReportedVehicles. */
    reports?: readonly AnalyticsReport[] | null;
    history?: readonly AnalyticsHistoryEntry[] | null;
}

/**
 * All four figures from one already-loaded set of records.
 *
 * Each is independent and each is derived from the same arrays, so the average,
 * the route ranking and the trend can never describe different fleets — which
 * is the failure that reading them from separate requests would invite.
 */
export function accessibilityAnalytics(
    input: AccessibilityAnalyticsInput = {},
    options: { now?: Date; weeks?: number; limit?: number } = {}
): AccessibilityAnalytics {
    const limit = options.limit ?? TOP_RANKED_LIMIT;

    return {
        averageScore: averageAccessibilityScore(input.buses),
        mostAccessibleRoutes: mostAccessibleRoutes(input.routes, input.trips, input.buses, limit),
        mostReportedVehicles: mostReportedVehicles(input.reports, input.buses, limit),
        trend: accessibilityScoreTrend(input.history, options),
    };
}
