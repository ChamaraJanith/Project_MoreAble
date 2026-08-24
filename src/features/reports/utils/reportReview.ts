/**
 * Admin review of an accessibility report: the client half (MOV-160).
 *
 * The backend (MOV-161/MOV-162) already owns every rule that matters — who may
 * review, what a decision means, which state it may be made from, and how long
 * a remark can be. Nothing here re-decides any of that. What lives here is the
 * part a screen needs before it can draw anything:
 *
 *   - what the review payloads actually are, as types rather than `any`,
 *   - what a queue card shows of a report, and what it must never show,
 *   - which actions a report in this state can still be offered,
 *   - whether a typed remark is worth sending at all,
 *   - what to say when a request comes back 401, 403, 404 or 409.
 *
 * It is a plain module with no React and no react-native import, for the reason
 * this project already gives elsewhere: Jest here is node-only with no
 * renderer, so logic in a module can be tested and the same logic inside a
 * component cannot.
 */

import {
    AccessibilityReport,
    AdminReportReview,
    MAX_ADMIN_REMARK_LENGTH,
    REPORT_REVIEW_REQUIRED_STATUS,
    ReportReviewAction,
} from '../../../entities/report/model/types';
import { formatCommentCount } from './reportFeedback';
import { reportStatusLabel } from './reportFormat';
import { adminReportsRequestPath } from './reportRoutes';
import { ReportCardSummary, reportCardSummary } from './reportSummary';

// Re-exported so a screen takes the cap from the module it reviews through
// rather than reaching past it into the entity model for one constant.
export { MAX_ADMIN_REMARK_LENGTH };

/**
 * One report as the review endpoints serialise it.
 *
 * Everything a passenger-facing report carries, plus the four things
 * `toAdminReviewReport` adds on the server: the tallies resolved to numbers,
 * how many comments it drew, whether it is flagged, and any review already
 * recorded against it.
 */
export interface AdminReviewReport extends AccessibilityReport {
    /** The Firestore document id, which is what the review routes address. */
    documentId: string;
    agreeCount: number;
    disagreeCount: number;
    commentCount: number;
    requiresAdminReview: boolean;
    /** Whether the community has pushed this report over the review threshold. */
    flagged: boolean;
    /** The decision already recorded, or null on a report nobody has decided. */
    review: AdminReportReview | null;
}

// ------------------------------------------------------------------
// Reading the API's payloads
// ------------------------------------------------------------------

/** A stored tally as a number the queue can render without guarding. */
function countOrZero(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 0;
}

/** A stored string, or null — never `undefined`, which a screen has to guard. */
function textOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * The review recorded against a report, or null when there is none.
 *
 * Null rather than an object of nulls, so the page can tell "nobody has decided
 * this yet" from "decided, with nothing written about it" — the same
 * distinction `extractAdminReview` makes on the server.
 */
export function mapAdminReview(raw: unknown): AdminReportReview | null {
    if (!raw || typeof raw !== 'object') return null;

    const source = raw as Record<string, unknown>;

    const reviewedBy = textOrNull(source.reviewedBy);
    const reviewedAt = textOrNull(source.reviewedAt);
    const adminRemark = textOrNull(source.adminRemark);

    if (!reviewedBy && !reviewedAt && !adminRemark) return null;

    return {
        status: textOrNull(source.status),
        reviewedBy,
        reviewedAt,
        adminRemark,
    };
}

/**
 * One report off the review API, as the screens read it.
 *
 * The counts and the flag are normalised rather than trusted: a report written
 * before votes existed carries neither, and a card must draw a zero rather than
 * a gap. `flagged` is taken from the response and never recomputed — five
 * agreeing passengers is the backend's threshold, and a second copy of that
 * number in the app is a second rule to keep in step. It only falls back to
 * `requiresAdminReview` for a payload that predates the derived field.
 */
export function mapAdminReviewReport(raw: any): AdminReviewReport {
    const documentId = typeof raw?.documentId === 'string' ? raw.documentId : '';
    const reportId =
        typeof raw?.reportId === 'string' && raw.reportId ? raw.reportId : documentId;

    return {
        ...(raw as AccessibilityReport),
        documentId,
        reportId,
        status: reviewStatusOf(raw),
        agreeCount: countOrZero(raw?.agreeCount),
        disagreeCount: countOrZero(raw?.disagreeCount),
        commentCount: countOrZero(raw?.commentCount),
        requiresAdminReview: raw?.requiresAdminReview === true,
        flagged: raw?.flagged === true || raw?.requiresAdminReview === true,
        review: mapAdminReview(raw?.review),
    };
}

/** The queue, in the order the API returned it. A non-list reads as empty. */
export function mapAdminReviewReports(raw: unknown): AdminReviewReport[] {
    return Array.isArray(raw) ? raw.map(mapAdminReviewReport) : [];
}

// ------------------------------------------------------------------
// Status
// ------------------------------------------------------------------

/**
 * The status a report is in, for the purpose of deciding it.
 *
 * A report with nothing stored reads as PENDING, exactly as `canApplyReview`
 * reads it on the server: a record written before a status was always set is
 * unreviewed, not undecidable. Getting this wrong in the app would hide the
 * Verify button on a report the API would happily have verified.
 */
export function reviewStatusOf(report: { status?: unknown } | null | undefined): string {
    return typeof report?.status === 'string' && report.status
        ? report.status
        : REPORT_REVIEW_REQUIRED_STATUS;
}

/**
 * Whether Verify and Reject should be offered.
 *
 * Only from PENDING. On a report that has already been decided the API answers
 * 409, so drawing the buttons would be offering an action that cannot succeed —
 * and the decision, once made, is a record rather than a setting.
 */
export function canDecideReport(report: { status?: unknown } | null | undefined): boolean {
    return !!report && reviewStatusOf(report) === REPORT_REVIEW_REQUIRED_STATUS;
}

/** Whether an admin has already decided this report. */
export function isDecidedReport(report: { status?: unknown } | null | undefined): boolean {
    return !!report && !canDecideReport(report);
}

/**
 * Whether a remark can still be written.
 *
 * At any point in the report's life. A remark carries no decision, so the API
 * accepts REMARK on a decided report as readily as on a pending one, and an
 * admin adding context to something they verified last week is a normal thing
 * to want.
 */
export function canRemarkOnReport(report: unknown): boolean {
    return !!report;
}

/**
 * The wording for a status, for the places a badge cannot go.
 *
 * Defined in reportFormat, which is where the passenger screens read it from
 * too — a second copy of this table is a second place for a status to be
 * worded differently. Re-exported so a review screen takes it from the module
 * it reviews through rather than reaching past it for one helper.
 */
export { reportStatusLabel };

// ------------------------------------------------------------------
// The queue
// ------------------------------------------------------------------

/** Said on the card, and announced with it. One wording, in one place. */
export const NEEDS_REVIEW_LABEL = 'Needs Review';

/** Which slice of the review queue is on screen. */
export type AdminReviewFilter = 'ALL' | 'FLAGGED' | 'PENDING';

export const ADMIN_REVIEW_FILTERS: { value: AdminReviewFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'FLAGGED', label: NEEDS_REVIEW_LABEL },
    { value: 'PENDING', label: 'Pending' },
];

/**
 * The request for one filter, relative to the API base URL.
 *
 * Every narrowing is a parameter on the existing review scope rather than a
 * filter applied to a wider list here: `flagged` and `status` are what
 * GET /api/reports already accepts alongside `scope=review`, so the queue asks
 * for what it means to show.
 */
export function adminReviewRequestPath(filter: AdminReviewFilter): string {
    if (filter === 'FLAGGED') return adminReportsRequestPath({ flaggedOnly: true });
    if (filter === 'PENDING') {
        return adminReportsRequestPath({ status: REPORT_REVIEW_REQUIRED_STATUS });
    }

    return adminReportsRequestPath();
}

export interface AdminReviewCardSummary extends ReportCardSummary {
    /** The stored status, for the badge. */
    status: string;
    statusLabel: string;
    /** Whether to draw the "Needs Review" flag on this card. */
    needsReview: boolean;
}

/**
 * Everything a queue card shows about a report.
 *
 * Built on the card summary the passenger list already uses, which is what
 * keeps the two reading as the same report — and, as there, notably not the
 * report id. It is how the report is addressed, not something an admin is
 * asked to read off a row.
 */
export function adminReviewCardSummary(report: AdminReviewReport): AdminReviewCardSummary {
    const summary = reportCardSummary(report);
    const status = reviewStatusOf(report);
    const statusLabel = reportStatusLabel(status);
    const needsReview = report.flagged;

    // One label for the whole card, because the whole card is one control.
    // Status and the review flag lead it: they are why this row is here.
    const parts = [
        `Review accessibility report: ${summary.title}`,
        `status ${statusLabel}`,
        ...(needsReview ? [NEEDS_REVIEW_LABEL.toLowerCase()] : []),
        formatCommentCount(summary.feedbackCounts.commentCount),
        `${summary.feedbackCounts.agreeCount} agree`,
        `${summary.feedbackCounts.disagreeCount} disagree`,
    ];

    return {
        ...summary,
        status,
        statusLabel,
        needsReview,
        accessibilityLabel: parts.join(', '),
    };
}

/**
 * Every string a queue card puts in front of an admin, on screen or through a
 * screen reader.
 *
 * Exists for the assertion that the report id is not among them — a check worth
 * having as code, because putting it back is a one-line change.
 */
export function adminReviewCardVisibleText(summary: AdminReviewCardSummary): string[] {
    return [
        summary.title,
        summary.description,
        summary.submittedLabel,
        summary.statusLabel,
        summary.accessibilityLabel,
        ...summary.chips.map((chip) => chip.label),
    ];
}

/** How the queue stands, for the line above the list. Derived, never stored. */
export interface AdminReviewQueueSummary {
    total: number;
    flagged: number;
    pending: number;
}

export function adminReviewQueueSummary(
    reports: AdminReviewReport[]
): AdminReviewQueueSummary {
    return {
        total: reports.length,
        flagged: reports.filter((report) => report.flagged).length,
        pending: reports.filter((report) => canDecideReport(report)).length,
    };
}

// ------------------------------------------------------------------
// The remark
// ------------------------------------------------------------------

/**
 * Whether what has been typed is worth sending.
 *
 * Whitespace is not a remark — the same rule `normalizeAdminRemark` applies on
 * the server, checked here so the admin is told before the request rather than
 * after it. The length cap is the API's own, so the composer can never let
 * somebody write something the route would then refuse.
 */
export function isSubmittableRemark(draft: string): boolean {
    const trimmed = draft.trim();

    return trimmed.length > 0 && trimmed.length <= MAX_ADMIN_REMARK_LENGTH;
}

/** What to send for a remark: trimmed, exactly as the API will store it. */
export function remarkToSubmit(draft: string): string {
    return draft.trim();
}

// ------------------------------------------------------------------
// Failures
// ------------------------------------------------------------------

/** What each refusal means, in the words an admin can act on. */
export const REVIEW_ERROR_MESSAGES: Record<number, string> = {
    401: 'Your session has expired. Please sign in again.',
    403: 'Only an administrator can review accessibility reports.',
    404: 'This report is no longer available.',
    409: 'This report has already been reviewed.',
};

export const REVIEW_FALLBACK_MESSAGE =
    'Something went wrong. Please check your connection and try again.';

/**
 * The message to show for a failed review request.
 *
 * A 409 keeps the API's own wording, because it is the one that knows which
 * state the report ended up in — "already been reviewed (VERIFIED)" tells the
 * admin what happened, and a generic conflict message does not. Every other
 * known status is stated here so the four cases read consistently wherever they
 * surface, and anything unrecognised falls back to whatever the API said.
 */
export function reviewErrorMessage(
    status: number | undefined,
    apiMessage?: string | null
): string {
    const message = typeof apiMessage === 'string' && apiMessage.trim() ? apiMessage : null;

    if (status === 409 && message) return message;

    if (status !== undefined && REVIEW_ERROR_MESSAGES[status]) {
        return REVIEW_ERROR_MESSAGES[status];
    }

    return message ?? REVIEW_FALLBACK_MESSAGE;
}

/**
 * Whether the report on screen is now out of date because of this failure.
 *
 * A 409 means another admin decided it while this one was looking at it, and a
 * 404 means it is gone. Both make everything on screen a description of a
 * report that no longer exists in that form, so the page reloads rather than
 * leaving a Verify button under a report that has just been verified.
 */
export function shouldReloadAfterFailure(status: number | undefined): boolean {
    return status === 404 || status === 409;
}

/** The decision a button records. Named here so no screen types the string. */
export const VERIFY_ACTION: ReportReviewAction = 'VERIFY';
export const REJECT_ACTION: ReportReviewAction = 'REJECT';
export const REMARK_ACTION: ReportReviewAction = 'REMARK';
