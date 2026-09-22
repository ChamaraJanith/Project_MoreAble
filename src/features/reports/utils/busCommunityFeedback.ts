/**
 * How a bus's community standing reads (MOV-80).
 *
 * The rules for turning a rating summary into words, and for picking the
 * verified reports that belong to one bus. Kept out of the components for the
 * reason the rest of this folder is: Jest here is node-only with no renderer,
 * so a rule in a module can be tested and the same rule inside a component
 * cannot.
 *
 * Nothing here scores, averages or verifies anything. The average is computed
 * server-side over `busRatings` (MOV-116), and whether a report is verified was
 * decided by an admin through the review route (MOV-161). This only decides how
 * what already exists is worded and ordered.
 */

import { BusRatingSummary } from '../../../entities/rating/model/types';
import { AccessibilityReport } from '../../../entities/report/model/types';

/**
 * What a bus with no ratings says.
 *
 * Deliberately not "0.0 stars", and deliberately not a zero of any kind. No
 * passenger has rated this bus, which is an absence of evidence; a zero would
 * be the worst possible verdict, and the rating scale starts at 1 so it is not
 * even a value a passenger could have given.
 */
export const NO_RATINGS_LABEL = 'No ratings yet';

/** Shown when the ratings could not be read at all, which is not the same as none. */
export const RATINGS_UNAVAILABLE_LABEL = 'Ratings unavailable';

/** How many verified reports the community feedback screen shows before "recent" stops meaning anything. */
export const RECENT_FEEDBACK_LIMIT = 10;

/** The top of the rating scale, for "4.6 out of 5". */
const RATING_SCALE_MAX = 5;

/**
 * The average to one decimal place: 4.6, or 5.0 for a straight five.
 *
 * Always one decimal, so a column of averages lines up and 5 never reads as a
 * rounder, more confident number than 4.6. Null for anything that is not a
 * finite number — nothing is invented for a summary that arrived malformed.
 */
export function formatAverageRating(average: number | null | undefined): string | null {
    if (typeof average !== 'number' || !Number.isFinite(average)) return null;

    return average.toFixed(1);
}

/** '1 rating' / '24 ratings'. */
export function ratingCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'rating' : 'ratings'}`;
}

/** Everything a rating display needs, already worded. */
export interface RatingSummaryDisplay {
    /** Whether there is an average to show at all. */
    hasRatings: boolean;
    /** '4.6', or null when there are no ratings. */
    averageLabel: string | null;
    /** '24 ratings', or null when there are none. */
    countLabel: string | null;
    /** '4.6 (24)' for the compact card, or 'No ratings yet'. */
    compactLabel: string;
    /** One sentence for a screen reader — never just the star icon. */
    accessibilityLabel: string;
}

/**
 * How one bus's ratings read.
 *
 * A summary is treated as "no ratings" whenever it cannot support an average:
 * absent, `count` of 0, or an `average` that is not a finite number. The three
 * are the same thing to a passenger — there is nothing to show — and the
 * alternative is printing a 0.0 or a NaN next to a star.
 *
 * A count with no average, or an average with no count, is contradictory rather
 * than informative, so it reads as no ratings too. Nothing is reconstructed
 * from the half that did arrive.
 */
export function describeRatingSummary(
    summary: BusRatingSummary | null | undefined
): RatingSummaryDisplay {
    const count = typeof summary?.count === 'number' && Number.isFinite(summary.count)
        ? Math.max(0, Math.trunc(summary.count))
        : 0;
    const averageLabel = formatAverageRating(summary?.average);

    if (!averageLabel || count === 0) {
        return {
            hasRatings: false,
            averageLabel: null,
            countLabel: null,
            compactLabel: NO_RATINGS_LABEL,
            accessibilityLabel: 'No passenger ratings for this bus yet.',
        };
    }

    const countLabel = ratingCountLabel(count);

    return {
        hasRatings: true,
        averageLabel,
        countLabel,
        compactLabel: `${averageLabel} (${count})`,
        accessibilityLabel:
            `Average passenger rating ${averageLabel} out of ${RATING_SCALE_MAX}, from ${countLabel}.`,
    };
}

/**
 * A report's `createdAt` as a sortable number.
 *
 * The same treatment GET /api/reports gives it: a record whose date cannot be
 * read sorts last rather than reordering everything around it.
 */
function sortableTime(value: unknown): number {
    const time = new Date(value as any).getTime();

    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * The verified community reports about one bus, newest first.
 *
 * The three rules, in the order they matter:
 *
 *   1. VERIFIED only. A PENDING report is one passenger's unchecked account and
 *      a REJECTED one is an account an admin found did not hold — neither is
 *      something to tell a passenger about the bus they are choosing. Compared
 *      against the stored status exactly as `tallyVerifiedCommunityReports`
 *      does, so the list a passenger reads and the evidence the score weighs
 *      agree on what "verified" means.
 *   2. This bus only. Matched on `busId`, the bus DOCUMENT id, which is the same
 *      value a rating's `busId` holds. A report naming another bus or no bus at
 *      all is not about this one.
 *   3. Newest first, then cut to `limit`.
 *
 * An empty or non-string `busId` matches nothing, rather than matching reports
 * that happen to have no bus — the same guard the tallies use.
 */
export function selectVerifiedBusReports(
    reports: readonly (AccessibilityReport | null | undefined)[] | null | undefined,
    busId: string,
    limit: number = RECENT_FEEDBACK_LIMIT
): AccessibilityReport[] {
    if (typeof busId !== 'string' || !busId.trim()) return [];

    const wanted = busId.trim();

    return (reports ?? [])
        .filter((report): report is AccessibilityReport =>
            !!report && report.status === 'VERIFIED' && report.busId === wanted
        )
        .sort((first, second) => sortableTime(second.createdAt) - sortableTime(first.createdAt))
        .slice(0, Math.max(0, limit));
}

// ==================================================================
// The rating block's own state
//
// Two rules, pulled out of Route Details so they can be tested. The screen
// holds a summary that may arrive twice — once seeded from the search response
// the passenger tapped through from, once refreshed from the endpoint — and
// these decide what the block shows at each point. Behaviour is unchanged; the
// expressions simply used to be inline, where no test could reach them.
// ==================================================================

export type BusRatingLoadState = 'LOADING' | 'READY' | 'UNAVAILABLE';

/**
 * The state the rating block starts in, before any request has answered.
 *
 * A seeded summary starts READY rather than LOADING. The passenger read that
 * very figure on the card they tapped, and covering it with "Loading passenger
 * ratings…" would be a flash that tells them nothing they did not already know.
 * With nothing seeded it is LOADING while a read is possible, and UNAVAILABLE
 * when there is nothing to read with — no session, or no bus.
 */
export function initialRatingLoadState(
    seeded: BusRatingSummary | null | undefined,
    canRead: boolean
): BusRatingLoadState {
    if (seeded) return 'READY';

    return canRead ? 'LOADING' : 'UNAVAILABLE';
}

/** Which of the block's three appearances to draw. */
export interface RatingCardView {
    loading: boolean;
    unavailable: boolean;
}

/**
 * What the block shows, given where the read got to and the best summary held.
 *
 * A failed refresh does NOT discard a summary already in hand. The seeded figure
 * came from the same server moments earlier and is still the best answer there
 * is — replacing it with "ratings are not available" because a refresh timed out
 * would take working information away from the passenger over a request they
 * never asked for. So UNAVAILABLE is shown only when there is genuinely nothing
 * to show.
 */
export function ratingCardView(
    state: BusRatingLoadState,
    summary: BusRatingSummary | null | undefined
): RatingCardView {
    return {
        loading: state === 'LOADING',
        unavailable: state === 'UNAVAILABLE' && !summary,
    };
}

/** What the feedback list says when the bus has no verified reports. */
export const NO_VERIFIED_FEEDBACK_TITLE = 'No verified feedback yet';
export const NO_VERIFIED_FEEDBACK_DESCRIPTION =
    'Reports about this bus appear here once an administrator has verified them.';
