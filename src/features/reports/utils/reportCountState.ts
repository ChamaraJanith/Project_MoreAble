/**
 * The Reports tile on the admin dashboard (MOV-131).
 *
 * How many accessibility reports exist, and — since MOV-134 — how many of them
 * an admin has upheld. Both are read from the very queue the tile opens —
 * GET /api/reports?scope=review with no narrowing — so the numbers on the
 * dashboard and the list behind them can never disagree about what counts as a
 * report.
 *
 * The verified total is derived HERE rather than asked for separately: the
 * queue this already loads is every report, each carrying the status an admin
 * decided it with, so the number is arithmetic on data that has already
 * arrived. A second call for it could also come back differently, and then the
 * tile would be showing more verified reports than reports.
 *
 * Still no wider breakdown, deliberately: those two are the statistics MOV-134
 * asks for, and pending/rejected/flagged are what the review queue is for.
 *
 * The tile carries its own state rather than joining the dashboard's other
 * overview calls, because the reports endpoint is the one that needs an admin
 * session. A refused or expired one has to leave the buses, routes, trips,
 * stops and users on screen exactly as they were.
 *
 * A reducer rather than a heap of `useState` calls, for the reason this project
 * already gives in reportReviewState: Jest here is node-only with no React
 * renderer, so this is where the loading, empty and failure behaviour can
 * actually be tested.
 */

import { countTotalReports, countVerifiedReports } from '../../admin/utils/systemStatistics';
import { reviewErrorMessage } from './reportReview';

/** Where the tile has got to. */
export type ReportCountStatus = 'loading' | 'ready' | 'failed';

export interface ReportCountState {
    status: ReportCountStatus;
    /**
     * The total, or null while it has never been read and after a failure.
     *
     * Null and 0 are different answers — "not known" against "none filed" — and
     * collapsing them would make an empty queue look like a broken one.
     */
    count: number | null;
    /**
     * How many of those reports an admin has upheld (MOV-134), or null on the
     * same terms as `count`.
     *
     * Moves with `count` and never apart from it: both come out of one reading
     * of one queue, so the card can never show a verified total that the total
     * above it does not account for.
     */
    verified: number | null;
    /** Why the count could not be read, or null. */
    error: string | null;
}

export const initialReportCountState: ReportCountState = {
    status: 'loading',
    count: null,
    verified: null,
    error: null,
};

export type ReportCountAction =
    | { type: 'loadStarted' }
    | { type: 'loadSucceeded'; reports: readonly unknown[] }
    | { type: 'loadFailed'; status?: number; message?: string | null };

export function reportCountReducer(
    state: ReportCountState,
    action: ReportCountAction
): ReportCountState {
    switch (action.type) {
        // A reload — on first focus, and again every time the dashboard regains
        // it. The count already shown is kept so a returning admin does not
        // watch a number they can already see blink back through a spinner.
        case 'loadStarted':
            return { ...state, status: 'loading', error: null };

        // Both totals are derived from what the API returned, never a stored
        // figure and never a locally adjusted one. The arithmetic lives in
        // systemStatistics so that "a verified report" means one thing here and
        // in every other statistic on the Overview.
        case 'loadSucceeded':
            return {
                status: 'ready',
                count: countTotalReports(action.reports),
                verified: countVerifiedReports(action.reports),
                error: null,
            };

        // A failure drops both counts rather than leaving stale ones under a
        // tile that has stopped being able to confirm them.
        case 'loadFailed':
            return {
                status: 'failed',
                count: null,
                verified: null,
                error: reviewErrorMessage(action.status, action.message),
            };

        default:
            return state;
    }
}

/**
 * The dashboard's own wording for a number it cannot show — the same em dash
 * the other tiles fall back to when the overview call fails.
 */
export const REPORT_COUNT_UNAVAILABLE = '—';

/**
 * Whether to draw the spinner instead of a number.
 *
 * Only while nothing has ever been read. A background reload keeps the last
 * count visible, which is what makes returning to the dashboard feel like
 * coming back to a screen rather than opening a new one.
 */
export function isReportCountLoading(state: ReportCountState): boolean {
    return state.status === 'loading' && state.count === null;
}

/** What the tile prints: the total, or the em dash when it is not known. */
export function reportCountLabel(state: ReportCountState): string {
    return state.count === null ? REPORT_COUNT_UNAVAILABLE : String(state.count);
}

/**
 * What a screen reader hears on the tile, including that it opens something.
 *
 * The verified total is spoken as well as printed (MOV-134). The card sets an
 * explicit label, which replaces whatever its children say, so a number that is
 * only in the breakdown line would be visible and unreachable. Every other card
 * in the Overview states its breakdown the same way — "Total buses 12. 8
 * active." — and this follows that sentence shape rather than inventing one.
 */
export function reportCountAccessibilityLabel(state: ReportCountState): string {
    if (isReportCountLoading(state)) return 'Reports, loading';

    if (state.count === null) {
        return 'Reports, count unavailable. Opens the accessibility report review queue.';
    }

    return `Reports ${state.count}. ${state.verified ?? 0} verified. Opens the accessibility report review queue.`;
}

/**
 * A review-queue result, as the tile needs to read it.
 *
 * Structural rather than an import of `ReviewResult<AdminReviewQueue>`, so this
 * module stays free of the API client it is fed by — and so a test can hand it
 * a result without standing up a fetch.
 */
export type ReportCountSource =
    | { ok: true; value: { reports: readonly unknown[] } }
    | { ok: false; message: string; status?: number };

/** The action to dispatch for what the API answered. */
export function reportCountAction(result: ReportCountSource): ReportCountAction {
    if (result.ok) return { type: 'loadSucceeded', reports: result.value.reports };

    return { type: 'loadFailed', status: result.status, message: result.message };
}

/**
 * The action to dispatch when there is no admin session to ask with.
 *
 * Sent as a 401 so it reads exactly as the API's own refusal would — one
 * wording for "you are not signed in", whether the client noticed or the
 * server said so.
 */
export const NO_SESSION_ACTION: ReportCountAction = { type: 'loadFailed', status: 401 };
