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
    isReportDecided,
    ADMIN_POSITIVE_FEEDBACK_DISPLAY_STATUS,
    reportDecisionStatus,
    adminReportDisplayStatus,
    reportTypeOf,
    requiresAdminReview,
} from '../../../entities/report/model/types';
import { VERIFIED_REPORT_STATUS } from '../../admin/utils/systemStatistics';
import { formatCommentCount } from './reportFeedback';
import { reportStatusLabel } from './reportFormat';
import { adminReportsRequestPath } from './reportRoutes';
import { ReportTypeFilter } from './reportSearch';
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
    return reportDecisionStatus(report);
}

/**
 * Whether Verify and Reject should be offered.
 *
 * Only on an accessibility issue, and only from PENDING. Positive feedback has
 * no Verify/Reject workflow at all, and on a report that has already been
 * decided the API answers 409 — so drawing the buttons in either case would be
 * offering an action that cannot succeed.
 */
export function canDecideReport(
    report: { status?: unknown; type?: unknown } | null | undefined
): boolean {
    return (
        !!report &&
        requiresAdminReview(report) &&
        reviewStatusOf(report) === REPORT_REVIEW_REQUIRED_STATUS
    );
}

/**
 * Shown on positive feedback in place of Verify and Reject.
 *
 * The admin screens badge accepted positive feedback "Verified"; this is what
 * stops that word implying an administrator reviewed it.
 */
export const POSITIVE_FEEDBACK_NO_REVIEW_MESSAGE =
    'Positive feedback is automatically accepted and does not require review. It shows as Verified here, but no administrator reviewed it, and it counts toward the bus\'s accessibility score as submitted. There is nothing to verify or reject.';

/** The short form of that message, under a queue card's badge. */
export const POSITIVE_FEEDBACK_AUTO_ACCEPTED_NOTE = 'Automatically accepted · no review required';

/** The Admin Review card on an issue nobody has decided yet. */
export const NO_ADMIN_REVIEW_YET_MESSAGE = 'No administrator has reviewed this report yet.';

/**
 * What the detail page's Admin Review card says in place of a recorded
 * decision, or null when a decision should be drawn instead (MOV-305).
 *
 * Positive feedback always says it was accepted automatically — never that a
 * review is still to come, and never a "Decision" row, because nobody decides
 * it (an admin remark on it is still shown beneath). An issue says nothing is
 * decided yet only while there is no review recorded.
 */
export function adminReviewStatusNote(
    report: { type?: unknown; status?: unknown } | null | undefined,
    review: AdminReportReview | null | undefined
): string | null {
    if (!requiresAdminReview(report)) return POSITIVE_FEEDBACK_AUTO_ACCEPTED_NOTE;

    return review ? null : NO_ADMIN_REVIEW_YET_MESSAGE;
}

/**
 * Under the admin remark box. A remark is part of the report, so it is shown
 * to whoever can open the report — its author, and every passenger once the
 * report is public — not to the author alone.
 */
export const ADMIN_REMARK_HELPER =
    "Visible to anyone who can view this report. Saving a remark does not change the report's status.";

/**
 * Whether an admin has already decided this report.
 *
 * The entity model's rule, applied to a report that is actually there: nothing
 * at all is not a decided report, it is no report.
 */
export function isDecidedReport(report: { status?: unknown } | null | undefined): boolean {
    return !!report && isReportDecided(report);
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

/**
 * The report's own id, as the admin review DETAIL screen shows it:
 * "Report ID: REP-00014". Read from the stored `reportId` (the document id as
 * a fallback, as the queue maps it) — never generated. Null when there is none.
 *
 * Detail screen only: queue cards still never show the id.
 */
export function adminReportIdLabel(
    report: { reportId?: unknown; documentId?: unknown } | null | undefined
): string | null {
    const id =
        (typeof report?.reportId === 'string' && report.reportId.trim()) ||
        (typeof report?.documentId === 'string' && report.documentId.trim()) ||
        '';

    return id ? `Report ID: ${id}` : null;
}

/** Said on the card, and announced with it. One wording, in one place. */
export const NEEDS_REVIEW_LABEL = 'Needs Review';

/**
 * Which slice of the review queue is on screen.
 *
 * Two, deliberately. A third tab for the community-flagged reports used to sit
 * between them and was removed: the flag is already on every card that carries
 * it, and on the report itself, so a whole tab for it narrowed the queue by
 * something an admin could already see — while hiding the reports they had
 * actually come to decide. Nothing else changed about flagging; only the tab.
 */
export type AdminReviewFilter = 'ALL' | 'PENDING' | 'VERIFIED' | 'POSITIVE';

/**
 * Pending and Verified are the issue review workflow and hold issue reports
 * only. Positive is positive feedback, which is accepted without review.
 */
export const ADMIN_REVIEW_FILTERS: { value: AdminReviewFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'VERIFIED', label: 'Verified' },
    { value: 'POSITIVE', label: 'Positive' },
];

/**
 * The request for one filter, relative to the API base URL.
 *
 * Pending and Verified are asked of the API by status (`status` is what
 * GET /api/reports already accepts alongside `scope=review`), so the queue
 * does not download every report to show the pending ones. The API filters by
 * status alone, so `reportsForReviewFilter` then keeps the issue reports —
 * legacy positive feedback may still be stored PENDING or VERIFIED.
 *
 * Positive asks for the whole queue: positive feedback is stored PUBLISHED, or
 * PENDING / VERIFIED on a legacy record, so no single stored status finds it.
 */
export function adminReviewRequestPath(filter: AdminReviewFilter): string {
    if (filter === 'PENDING') {
        return adminReportsRequestPath({ status: REPORT_REVIEW_REQUIRED_STATUS });
    }

    // The status a VERIFY decision produces — the same constant the summary
    // counts verified reports by, so the tab and the tile above it can never
    // disagree about what "verified" means.
    if (filter === 'VERIFIED') {
        return adminReportsRequestPath({ status: VERIFIED_REPORT_STATUS });
    }

    return adminReportsRequestPath();
}

/**
 * Whether a report belongs on a tab — by its type AND its status, never its
 * status alone.
 *
 *   All        every report
 *   Pending    issue reports waiting for an admin
 *   Verified   issue reports an admin verified
 *   Positive   accepted positive feedback (no review), legacy statuses
 *              included; feedback an admin REJECTED under the old workflow is
 *              only under All
 */
export function isInReviewFilter(
    report: { type?: unknown; status?: unknown } | null | undefined,
    filter: AdminReviewFilter
): boolean {
    if (!report) return false;

    switch (filter) {
        case 'ALL':
            return true;
        case 'PENDING':
            return requiresAdminReview(report) && reportDecisionStatus(report) === REPORT_REVIEW_REQUIRED_STATUS;
        case 'VERIFIED':
            return requiresAdminReview(report) && reportDecisionStatus(report) === VERIFIED_REPORT_STATUS;
        case 'POSITIVE':
            return (
                !requiresAdminReview(report) &&
                adminReportDisplayStatus(report) === ADMIN_POSITIVE_FEEDBACK_DISPLAY_STATUS
            );
    }
}

/** The reports that belong on a tab, in the order they arrived. */
export function reportsForReviewFilter<T extends AccessibilityReport>(
    reports: T[],
    filter: AdminReviewFilter
): T[] {
    return filter === 'ALL' ? reports : reports.filter((report) => isInReviewFilter(report, filter));
}

export interface AdminReviewCardSummary extends ReportCardSummary {
    /** The status to badge: `adminReportDisplayStatus`. */
    status: string;
    statusLabel: string;
    /** Under the badge on accepted positive feedback, so "Verified" is not read as a review. */
    statusNote: string | null;
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
    // Type and status together: accepted positive feedback reads "Verified"
    // through its own display key — never "Pending", and never the VERIFIED an
    // admin's decision stores.
    const status = adminReportDisplayStatus(report);
    const statusLabel = reportStatusLabel(status);
    const statusNote =
        status === ADMIN_POSITIVE_FEEDBACK_DISPLAY_STATUS ? POSITIVE_FEEDBACK_AUTO_ACCEPTED_NOTE : null;
    const needsReview = report.flagged;

    // One label for the whole card, because the whole card is one control.
    // Status and the review flag lead it: they are why this row is here.
    const parts = [
        `Review accessibility report: ${summary.title}`,
        `status ${statusLabel}`,
        ...(statusNote ? [statusNote] : []),
        ...(needsReview ? [NEEDS_REVIEW_LABEL.toLowerCase()] : []),
        formatCommentCount(summary.feedbackCounts.commentCount),
        `${summary.feedbackCounts.agreeCount} agree`,
        `${summary.feedbackCounts.disagreeCount} disagree`,
    ];

    return {
        ...summary,
        status,
        statusLabel,
        statusNote,
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
// Telling positive feedback apart from issue reports
//
// Both have always come from the one `reports` collection, told apart by the
// `type` field the entity model already defines: 'POSITIVE' is feedback, and
// anything else — including a report written before the field existed — is an
// issue. `reportTypeOf` is that rule, and it is imported rather than restated
// so the admin queue splits reports exactly as the passenger list and the
// cards' own type badges do.
// ------------------------------------------------------------------

/**
 * The type choices the review queue offers, in the order it offers them.
 *
 * The values are the shared `ReportTypeFilter` the passenger filter sheet uses,
 * so the two screens narrow by the same vocabulary. Only the wording differs:
 * the sheet says "Issues" and "Positive" beside four other pickers, while this
 * is the one type control on the page and can afford to say what it means.
 */
export const ADMIN_REPORT_TYPE_FILTERS: { value: ReportTypeFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'POSITIVE', label: 'Positive Feedback' },
    { value: 'ISSUE', label: 'Issue Reports' },
];

/** What the filter button says it is showing. */
export function adminReportTypeFilterLabel(type: ReportTypeFilter): string {
    return ADMIN_REPORT_TYPE_FILTERS.find((option) => option.value === type)?.label ?? 'All';
}

/**
 * The reports of one type, in the order they arrived.
 *
 * Generic for the reason `filterReportsBySearch` is: the queue's rows are
 * opened by `documentId`, and narrowing must not widen them back down to a
 * passenger report on the way through.
 *
 * 'ALL' returns the list untouched rather than a filtered copy, so choosing it
 * is genuinely "no narrowing".
 */
export function filterReportsByType<T extends AccessibilityReport>(
    reports: T[],
    type: ReportTypeFilter
): T[] {
    if (type === 'ALL') return reports;

    return reports.filter((report) => reportTypeOf(report) === type);
}

/**
 * How the queue divides, for the summary above it.
 *
 * Four numbers: how much positive feedback there is, and how many issue
 * reports — in total, still waiting for an admin, and upheld. Derived from the
 * reports already on the device — the review queue is one request that answers
 * with every report and the status each carries, so none of this is worth
 * asking the API a second time, and a second answer could disagree with the
 * list underneath it.
 *
 * Positive feedback has no "verified" count: it is never reviewed. "Verified"
 * is the one stored status an admin's VERIFY decision produces, read through
 * the same constant the dashboard statistics use. An issue with no stored
 * status reads as PENDING everywhere in this project.
 */
export interface AdminReportTypeCounts {
    positive: number;
    issue: number;
    pendingIssue: number;
    verifiedIssue: number;
}

export function adminReportTypeCounts(reports: AccessibilityReport[]): AdminReportTypeCounts {
    const counts: AdminReportTypeCounts = {
        positive: 0,
        issue: 0,
        pendingIssue: 0,
        verifiedIssue: 0,
    };

    for (const report of reports) {
        if (reportTypeOf(report) === 'POSITIVE') {
            counts.positive += 1;
            continue;
        }

        const status = reportDecisionStatus(report);

        counts.issue += 1;
        if (status === REPORT_REVIEW_REQUIRED_STATUS) counts.pendingIssue += 1;
        if (status === VERIFIED_REPORT_STATUS) counts.verifiedIssue += 1;
    }

    return counts;
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
