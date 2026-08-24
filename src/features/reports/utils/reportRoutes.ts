/**
 * Where a report lives — in the app, and on the API.
 *
 * The report id is what every one of these paths is built from, and it is the
 * only place it is used: it identifies the report for navigation, update and
 * delete, and is never shown to the passenger. Keeping the paths here rather
 * than interpolating them at each call site is what makes that claim checkable.
 */

/**
 * The passenger's report screens, grouped under `(passenger)`.
 *
 * The group is what makes these paths unambiguous rather than what makes them
 * different: a group segment is invisible in the URL, so these still resolve to
 * `/reports` and `/reports/REP-00007`. The admin review queue lives at those
 * same two URLs — `app/(admin)/reports` — and a bare `/reports` therefore
 * matches both files and picks whichever the route tree lists first, which is
 * the admin one. Naming the group says which of the two is meant, exactly as
 * `adminReviewQueuePath` does for the other.
 */
const PASSENGER_GROUP = '/(passenger)';

/** The form for filing a new report: `/(passenger)/reports`. */
export function reportFormPath(): string {
    return `${PASSENGER_GROUP}/reports`;
}

/** The details screen for one report, e.g. `/(passenger)/reports/REP-00007`. */
export function reportDetailsPath(reportId: string): string {
    return `${reportFormPath()}/${encodeURIComponent(reportId)}`;
}

/** The edit form for one report, e.g. `/(passenger)/reports/REP-00007/edit`. */
export function reportEditPath(reportId: string): string {
    return `${reportDetailsPath(reportId)}/edit`;
}

/**
 * The admin review queue in the app: `/(admin)/reports`.
 *
 * Grouped under `(admin)` alongside buses, routes and users rather than beside
 * the passenger `/reports` screens, because what makes it an admin screen is
 * the same thing that makes those ones admin screens — and the route it calls
 * refuses a passenger session whatever path led there.
 */
export function adminReviewQueuePath(): string {
    return '/(admin)/reports';
}

/** The review screen for one report, e.g. `/(admin)/reports/REP-00007`. */
export function adminReviewDetailsPath(reportId: string): string {
    return `${adminReviewQueuePath()}/${encodeURIComponent(reportId)}`;
}

/**
 * The API route for one report, relative to the API base URL.
 *
 * GET, PUT and DELETE all address the same route — the owner-only rules live on
 * the two that change something, not in a separate endpoint per action.
 */
export function reportApiPath(reportId: string): string {
    return `/api/reports/${encodeURIComponent(reportId)}`;
}

/**
 * Where this report's votes live: `/api/reports/REP-00007/vote`.
 *
 * GET reads how the report stands and which way this session voted; POST casts
 * or changes that vote. One route, because a vote and the tally it belongs to
 * are the same fact asked in two directions.
 */
export function reportVoteApiPath(reportId: string): string {
    return `${reportApiPath(reportId)}/vote`;
}

/** This report's comment thread: `/api/reports/REP-00007/comments`. */
export function reportCommentsApiPath(reportId: string): string {
    return `${reportApiPath(reportId)}/comments`;
}

/**
 * This report's admin review: `/api/reports/REP-00007/review`.
 *
 * GET reads everything an admin needs to decide the report — the report, the
 * vote tallies, the thread and any review already recorded; POST records the
 * decision. Admin only on both, enforced by the route rather than by which
 * screen happens to call it.
 */
export function reportReviewApiPath(reportId: string): string {
    return `${reportApiPath(reportId)}/review`;
}

/** The admin review queue, relative to the API base URL. */
export function adminReportsRequestPath(
    options: { status?: string; flaggedOnly?: boolean } = {}
): string {
    const params = new URLSearchParams({ scope: 'review' });

    if (options.status) params.set('status', options.status);
    if (options.flaggedOnly) params.set('flagged', 'true');

    return `/api/reports?${params.toString()}`;
}
