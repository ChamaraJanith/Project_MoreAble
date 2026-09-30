/**
 * The data behind the accessibility analytics (MOV-169, for MOV-133).
 *
 * Reads the collections the analytics are derived from, scores every bus with
 * MOV-79's own function, and hands the result to the pure aggregation in
 * features/admin/utils/accessibilityAnalytics. All the arithmetic lives there
 * and in MOV-79; this only decides what is read and how the evidence is
 * assembled.
 *
 *     buses                       the fleet, and its accessibilityFacilities
 *     trips                       the only bus -> route association there is
 *     routes                      what a ranked route is called
 *     reports                     community evidence, and the issue tallies
 *     busRatings                  passenger rating evidence
 *     accessibilityScoreHistory   the recorded past, for the trend
 *
 * ONE READ PER COLLECTION. No `where`, no `orderBy`, no composite index: six
 * unfiltered reads, joined in memory. This is deliberate and is the reason this
 * module exists rather than the analytics calling
 * `loadAccessibilityScoreEvidence` per bus — that loader issues two queries for
 * every bus it is asked about, which is the right shape for the one or two
 * buses a booking screen shows and 2N round-trips for a fleet-wide figure.
 *
 * WHAT IS NOT DUPLICATED. The evidence this builds is assembled by MOV-79's own
 * `tallyCommunityReports` and `tallyPassengerRatings`, fed from the two
 * collections `loadAccessibilityScoreEvidence` reads and mapped through the same
 * `readBusRating`. The score is `computeAccessibilityScore`, called as it is.
 * So a bus's analytics score is the same number the journey search and the
 * booking APIs report for it, by construction rather than by coincidence —
 * there is no second formula here, and notably no facilities-only shortcut,
 * which would pin community and ratings at their neutral 50 and quietly
 * disagree with every passenger-facing figure.
 *
 * Read-only throughout. Nothing here writes, nothing is cached or stored, and
 * no collection is created: every figure is derived per request from records
 * other features already own.
 *
 * `adminDb` is typed `any`, as it is in every server module in this project —
 * the Firestore Admin surface is not modelled anywhere in the codebase, and
 * inventing a type for it here would be a seventh convention.
 */

import { Bus } from '../../entities/bus/model/types';
import { BusRating } from '../../entities/rating/model/types';
import { reportTypeOf } from '../../entities/report/model/types';
import {
    AccessibilityAnalytics,
    AnalyticsHistoryEntry,
    AnalyticsReport,
    AnalyticsRoute,
    AnalyticsTrip,
    BusAccessibilityDetail,
    BusAccessibilitySummary,
    BusEvidenceReport,
    BusFacilityAvailability,
    RatingDistributionEntry,
    ScoredBus,
    TREND_WEEKS,
    TOP_RANKED_LIMIT,
    accessibilityAnalytics,
} from '../../features/admin/utils/accessibilityAnalytics';
import { accessibilityScoreBand } from '../../features/admin/utils/accessibilityAnalyticsPresentation';
import {
    ACCESSIBILITY_FACILITY_KEYS,
    AccessibilityScoreEvidence,
    computeAccessibilityScore,
    computeAccessibilityScoreBreakdown,
    isCountedCommunityReport,
    isFacilityEffectivelyAvailable,
    tallyPassengerRatings,
    tallyCommunityReports,
} from '../utils/accessibility';
import { ACCESSIBILITY_SCORE_HISTORY_COLLECTION } from './accessibilityScoreHistory';
import { BUS_RATINGS_COLLECTION, busRatingSummaryFromTally, readBusRating } from './busRating';

/**
 * The six collections the analytics read.
 *
 * `reports` is named here rather than imported from reportFeedback for the
 * reason accessibilityScoreEvidence gives: that module pulls the auth
 * middleware in with it. The other two names come from the modules that own
 * them, so a rename cannot leave this reading a collection that no longer
 * exists.
 */
export const ANALYTICS_COLLECTIONS = {
    buses: 'buses',
    trips: 'trips',
    routes: 'routes',
    reports: 'reports',
    busRatings: BUS_RATINGS_COLLECTION,
    history: ACCESSIBILITY_SCORE_HISTORY_COLLECTION,
} as const;

/** Every record the analytics are derived from, as it came out of Firestore. */
export interface AccessibilityAnalyticsRecords {
    buses: Record<string, any>[];
    trips: AnalyticsTrip[];
    routes: AnalyticsRoute[];
    /** Newest first, which is the order `mostReportedVehicles` reads snapshots in. */
    reports: AnalyticsReport[];
    ratings: (BusRating | null)[];
    history: AnalyticsHistoryEntry[];
}

/** Every document in a snapshot, or an empty list when there were none. */
function documents(snapshot: any): Record<string, any>[] {
    return (snapshot?.docs ?? []).map((doc: any) => doc?.data?.() ?? {});
}

/**
 * A stored `createdAt` as a sortable number.
 *
 * A Firestore Timestamp, a Date and the ISO string an older record may carry
 * all have to become one. A value that cannot be read sorts last rather than
 * reordering everything around it — the rule GET /api/reports already applies
 * to the same field.
 */
function sortableTime(value: unknown): number {
    if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        const time = date instanceof Date ? date.getTime() : NaN;

        return Number.isNaN(time) ? -Infinity : time;
    }

    const time = new Date(value as any).getTime();

    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * Reads everything the analytics need, in one round of six unfiltered reads.
 *
 * The reads run together because none of them depends on another: the joins
 * between a trip, its bus and its route are made below, in memory, rather than
 * by asking Firestore a question per bus.
 */
export async function loadAccessibilityAnalyticsRecords(
    adminDb: any
): Promise<AccessibilityAnalyticsRecords> {
    const [busSnap, tripSnap, routeSnap, reportSnap, ratingSnap, historySnap] = await Promise.all([
        adminDb.collection(ANALYTICS_COLLECTIONS.buses).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.trips).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.routes).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.reports).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.busRatings).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.history).get(),
    ]);

    const reports = documents(reportSnap) as (AnalyticsReport & { createdAt?: unknown })[];

    // Newest first. Sorted here rather than in the query because an orderBy
    // would be the one thing that made these reads need an index, and the whole
    // collection is being read either way.
    reports.sort((first, second) => sortableTime(second.createdAt) - sortableTime(first.createdAt));

    return {
        buses: documents(busSnap),
        trips: documents(tripSnap) as AnalyticsTrip[],
        routes: documents(routeSnap) as AnalyticsRoute[],
        reports,
        // Mapped through the reader MOV-79's evidence loader uses, so a
        // malformed rating is discarded here exactly as it is there.
        ratings: documents(ratingSnap).map((data) => readBusRating(data)),
        history: documents(historySnap) as AnalyticsHistoryEntry[],
    };
}

/**
 * The accessibility score of every bus in the fleet, evidence and all.
 *
 * The evidence is built for each bus by MOV-79's own tallies, from the reports
 * and ratings already in memory — the same two collections
 * `loadAccessibilityScoreEvidence` queries, filtered by the same functions. So
 * the number this produces for a bus is the number the booking and journey APIs
 * produce for it.
 *
 * `unavailableFacilities` is deliberately not supplied, exactly as that loader
 * does not supply it: Community Reporting still does not record which facility
 * an issue concerns or when it is resolved, and guessing one from a report's
 * category here would make the admin's score disagree with the passenger's.
 */
export function scoreBuses(records: AccessibilityAnalyticsRecords): ScoredBus[] {
    return records.buses.map((data) => {
        const bus = data as Partial<Bus>;
        const busId = typeof bus.busId === 'string' ? bus.busId : '';

        const evidence: AccessibilityScoreEvidence = {
            community: tallyCommunityReports(records.reports, busId),
            ratings: tallyPassengerRatings(records.ratings, busId),
        };

        return {
            busId,
            status: bus.status,
            accessibilityScore: computeAccessibilityScore(bus.accessibilityFacilities, evidence),
            numberPlate: bus.numberPlate,
            busModel: bus.busModel,
            manufacturer: bus.manufacturer,
        };
    });
}

// ------------------------------------------------------------------
// One bus, factor by factor (the bus-focused Analytics page)
//
// The same evidence `scoreBuses` builds, handed to the same MOV-79 functions.
// The total is `computeAccessibilityScore` called as it is; the three factors
// are MOV-79's own `computeAccessibilityScoreBreakdown` — `computeFacilityScore`,
// `computeCommunityScore` and `computeRatingScore` with its own weight
// constants, the calls the score
// history (MOV-113) already makes to record the components. So the figures the
// admin reads are the figures the score was made of, and there is no second
// formula anywhere in this file.
// ------------------------------------------------------------------

/** A non-empty trimmed string, or null. */
function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A finite number, or null. */
function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The stored count of a counted facility, or null when the facility is a plain yes/no. */
function facilityCount(facilities: unknown, key: string): number | null {
    const group = (facilities as Record<string, unknown> | null | undefined)?.[key];

    if (!group || typeof group !== 'object') return null;

    return finiteNumber((group as { count?: unknown }).count);
}

/**
 * One bus's score, its three factors, its eight facilities and the evidence
 * counts behind them.
 *
 * `reports` and `ratings` may be the whole collection or only this bus's: the
 * MOV-79 tallies filter by bus id themselves, so the result is the same either
 * way. The list hands over a pre-grouped slice purely so a fleet of N buses is
 * not N passes over every report.
 */
export function summarizeBusAccessibility(
    data: Record<string, any>,
    reports: readonly AnalyticsReport[],
    ratings: readonly (BusRating | null)[]
): BusAccessibilitySummary {
    const bus = data as Partial<Bus>;
    const busId = typeof bus.busId === 'string' ? bus.busId : '';
    const facilities = bus.accessibilityFacilities;

    const evidence: AccessibilityScoreEvidence = {
        community: tallyCommunityReports(reports, busId),
        ratings: tallyPassengerRatings(ratings, busId),
    };

    const accessibilityScore = computeAccessibilityScore(facilities, evidence);

    const factors = computeAccessibilityScoreBreakdown(facilities, evidence);

    const facilityList: BusFacilityAvailability[] = ACCESSIBILITY_FACILITY_KEYS.map((key) => ({
        key,
        available: isFacilityEffectivelyAvailable(facilities, key, evidence.unavailableFacilities),
        count: facilityCount(facilities, key),
    }));

    const ratingSummary = busRatingSummaryFromTally(evidence.ratings, busId);

    return {
        busId,
        numberPlate: text(bus.numberPlate) ?? busId,
        busModel: text(bus.busModel),
        manufacturer: text(bus.manufacturer),
        status: text(bus.status),
        accessibilityScore,
        band: accessibilityScoreBand(accessibilityScore),
        factors,
        facilities: facilityList,
        availableFacilityCount: facilityList.filter((facility) => facility.available).length,
        community: {
            issueCount: evidence.community?.issueCount ?? 0,
            positiveCount: evidence.community?.positiveCount ?? 0,
        },
        ratings: { count: ratingSummary.count, average: ratingSummary.average },
    };
}

/** Records grouped by the bus they name. A record naming no bus is dropped: it is evidence about no bus. */
function groupByBusId<T extends { busId?: unknown } | null>(records: readonly T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();

    for (const record of records) {
        const busId = typeof record?.busId === 'string' ? record.busId : null;

        if (!busId) continue;

        const group = groups.get(busId) ?? [];

        group.push(record);
        groups.set(busId, group);
    }

    return groups;
}

/**
 * Every bus in the fleet — whatever its status — with its own score.
 *
 * Ordered by number plate, then id, so the list reads the same on every load.
 */
export function summarizeBuses(records: AccessibilityAnalyticsRecords): BusAccessibilitySummary[] {
    const reportsByBus = groupByBusId(records.reports);
    const ratingsByBus = groupByBusId(records.ratings);

    return records.buses
        .map((data) => {
            const busId = typeof data?.busId === 'string' ? data.busId : '';

            return summarizeBusAccessibility(
                data,
                reportsByBus.get(busId) ?? [],
                ratingsByBus.get(busId) ?? []
            );
        })
        .sort(
            (first, second) =>
                first.numberPlate.localeCompare(second.numberPlate) ||
                first.busId.localeCompare(second.busId)
        );
}

// ------------------------------------------------------------------
// One bus, with its evidence (GET /api/analytics/buses/:busId)
// ------------------------------------------------------------------

/** A stored time as ISO 8601: a Firestore Timestamp, a Date or a string. Null when unreadable. */
function isoTime(value: unknown): string | null {
    const time = sortableTime(value);

    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** A verified report, reduced to what an admin reads as evidence. */
function evidenceReport(data: Record<string, any>, documentId: string): BusEvidenceReport {
    const type = reportTypeOf(data);

    return {
        reportId: text(data.reportId) ?? documentId,
        type,
        category: text(type === 'POSITIVE' ? data.category : data.issueCategory),
        description: typeof data.description === 'string' ? data.description.trim() : '',
        createdAt: isoTime(data.createdAt),
        reviewedAt: isoTime(data.reviewedAt),
        adminRemark: text(data.adminRemark),
    };
}

const RATING_STARS = [5, 4, 3, 2, 1] as const;

export type BusAccessibilityDetailResult =
    | { kind: 'OK'; detail: BusAccessibilityDetail }
    | { kind: 'INVALID_BUS_ID' }
    | { kind: 'NOT_FOUND' };

/**
 * One bus's accessibility, with the reports and ratings behind it.
 *
 * Three reads, whatever the size of the fleet: the bus document, and the two
 * single-field equality queries `loadAccessibilityScoreEvidence` makes —
 * `reports where busId ==` and `busRatings where busId ==` — so no composite
 * index is needed. That loader is not called because it returns the tallies
 * alone, and the admin also needs the reports themselves; reading them twice
 * would be the same documents fetched two ways. The tallies and the score are
 * then produced exactly as the list produces them, by `summarizeBusAccessibility`.
 *
 * Read-only: nothing is written, and no score history entry is recorded.
 */
export async function loadBusAccessibilityDetail(
    adminDb: any,
    busId: unknown
): Promise<BusAccessibilityDetailResult> {
    const key = text(busId);

    if (!key || key.includes('/')) return { kind: 'INVALID_BUS_ID' };

    const [busSnap, reportSnap, ratingSnap] = await Promise.all([
        adminDb.collection(ANALYTICS_COLLECTIONS.buses).doc(key).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.reports).where('busId', '==', key).get(),
        adminDb.collection(ANALYTICS_COLLECTIONS.busRatings).where('busId', '==', key).get(),
    ]);

    if (!busSnap?.exists) return { kind: 'NOT_FOUND' };

    const bus = busSnap.data() ?? {};

    const reportDocs: { data: Record<string, any>; id: string }[] = (reportSnap?.docs ?? []).map(
        (doc: any) => ({ data: doc?.data?.() ?? {}, id: doc?.id ?? '' })
    );

    reportDocs.sort(
        (first, second) => sortableTime(second.data.createdAt) - sortableTime(first.data.createdAt)
    );

    const ratings = documents(ratingSnap).map((data) => readBusRating(data));

    // The document id is the bus id the evidence was queried by, so it is the
    // one the tallies are asked about.
    const summary = summarizeBusAccessibility(
        { ...bus, busId: key },
        reportDocs.map((doc) => doc.data),
        ratings
    );

    // Exactly the reports tallyCommunityReports counts: verified issues and
    // positive feedback, about this bus.
    const counted = reportDocs.filter(
        (doc) => doc.data.busId === key && isCountedCommunityReport(doc.data)
    );

    const ratingDistribution: RatingDistributionEntry[] = RATING_STARS.map((stars) => ({
        stars,
        // readBusRating has already discarded anything that is not a whole 1–5.
        count: ratings.filter((rating) => rating?.busId === key && rating.rating === stars).length,
    }));

    return {
        kind: 'OK',
        detail: {
            ...summary,
            manufactureYear: finiteNumber(bus.manufactureYear),
            seatCapacity: finiteNumber(bus.seatCapacity),
            verifiedIssues: counted
                .filter((doc) => reportTypeOf(doc.data) === 'ISSUE')
                .map((doc) => evidenceReport(doc.data, doc.id)),
            positiveFeedback: counted
                .filter((doc) => reportTypeOf(doc.data) === 'POSITIVE')
                .map((doc) => evidenceReport(doc.data, doc.id)),
            ratingDistribution,
        },
    };
}

/** How many weeks of trend to report, and when "now" is. */
export interface AccessibilityAnalyticsOptions {
    now?: Date;
    weeks?: number;
    limit?: number;
}

/** The analytics, and enough about how they were produced to read them. */
export interface AccessibilityAnalyticsResult extends AccessibilityAnalytics {
    /** ISO 8601, the moment the figures were derived. Nothing is cached. */
    generatedAt: string;
    /** How many weekly buckets `trend` holds. */
    trendWeeks: number;
    /** Every bus in the fleet, whatever its status, each with its own canonical score. */
    buses: BusAccessibilitySummary[];
}

/**
 * Every figure the analytics endpoint answers with.
 *
 * Reads, scores, aggregates. The three steps are separate functions so a test
 * can drive any of them on its own, and so the aggregation stays a pure module
 * with no Firestore in it.
 */
export async function generateAccessibilityAnalytics(
    adminDb: any,
    options: AccessibilityAnalyticsOptions = {}
): Promise<AccessibilityAnalyticsResult> {
    const now = options.now ?? new Date();
    const weeks = options.weeks ?? TREND_WEEKS;
    const limit = options.limit ?? TOP_RANKED_LIMIT;

    const records = await loadAccessibilityAnalyticsRecords(adminDb);
    const buses = scoreBuses(records);

    const analytics = accessibilityAnalytics(
        {
            buses,
            trips: records.trips,
            routes: records.routes,
            reports: records.reports,
            history: records.history,
        },
        { now, weeks, limit }
    );

    return {
        ...analytics,
        generatedAt: now.toISOString(),
        trendWeeks: weeks,
        buses: summarizeBuses(records),
    };
}
