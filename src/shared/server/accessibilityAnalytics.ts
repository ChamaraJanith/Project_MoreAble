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
 * `tallyVerifiedCommunityReports` and `tallyPassengerRatings`, fed from the two
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
import {
    AccessibilityAnalytics,
    AnalyticsHistoryEntry,
    AnalyticsReport,
    AnalyticsRoute,
    AnalyticsTrip,
    ScoredBus,
    TREND_WEEKS,
    TOP_RANKED_LIMIT,
    accessibilityAnalytics,
} from '../../features/admin/utils/accessibilityAnalytics';
import {
    AccessibilityScoreEvidence,
    computeAccessibilityScore,
    tallyPassengerRatings,
    tallyVerifiedCommunityReports,
} from '../utils/accessibility';
import { ACCESSIBILITY_SCORE_HISTORY_COLLECTION } from './accessibilityScoreHistory';
import { BUS_RATINGS_COLLECTION, readBusRating } from './busRating';

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
            community: tallyVerifiedCommunityReports(records.reports, busId),
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

    return { ...analytics, generatedAt: now.toISOString(), trendWeeks: weeks };
}
