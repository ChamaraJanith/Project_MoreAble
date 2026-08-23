/**
 * Admin review of an accessibility report: the server half (MOV-161).
 *
 * A report is one passenger's account, and community feedback (MOV-145) is the
 * people who ride that route answering it. Neither of those settles anything —
 * five passengers agreeing raises `requiresAdminReview`, and deliberately not
 * the status. Deciding a report is an admin's job, and this is where the rules
 * for that live:
 *
 *   - who is asking, and whether they are an admin at all,
 *   - which report they mean, and whether it exists,
 *   - what a decision may be, and which state it may be made from,
 *   - what a decision is allowed to write.
 *
 * Two things are worth stating outright, because the whole point of the module
 * is that they are enforced here and not on screen:
 *
 * 1. The admin listing and the review actions are refused to a non-admin
 *    session with a 403 whatever the app happens to render. Hiding a button is
 *    a nicety, this is the permission.
 *
 * 2. A decision is an ACTION, never a status taken off the request. The client
 *    says VERIFY; this module says what VERIFY means. Accepting a status field
 *    as the new state would let a caller name any string at all — including
 *    ones no review flow can reach — and no amount of validating it afterwards
 *    would make the request the authority on that, which it must not be.
 */

import {
    AdminReportReview,
    MAX_ADMIN_REMARK_LENGTH,
    REPORT_REVIEW_ACTIONS,
    REPORT_REVIEW_ACTION_STATUS,
    REPORT_REVIEW_REQUIRED_STATUS,
    ReportReviewAction,
    ReportStatus,
    isReportReviewAction,
} from '../../entities/report/model/types';
import { authenticateRequest, unauthorizedResponse } from '../api/authMiddleware';
import { getAdminDb } from '../config/firebaseAdmin';
import { JwtPayload } from '../config/jwt';
import {
    FeedbackValidation,
    REPORTS_COLLECTION,
    extractFeedbackReportId,
    shouldRequireAdminReview,
    toIsoString,
} from './reportFeedback';

// Re-exported so a route takes the vocabulary and the cap from the module that
// enforces them rather than restating either.
export {
    MAX_ADMIN_REMARK_LENGTH,
    REPORT_REVIEW_ACTIONS,
    REPORT_REVIEW_REQUIRED_STATUS,
};

/** The role an account must hold to review reports. */
export const ADMIN_ROLE = 'ADMIN';

export const reviewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function reviewErrorResponse(
    status: number,
    message: string,
    headers: Record<string, string> = reviewCorsHeaders
): Response {
    return Response.json({ success: false, message }, { status, headers });
}

// ------------------------------------------------------------------
// Authorisation
// ------------------------------------------------------------------

export type AdminAuthorization =
    | { ok: true; admin: JwtPayload }
    | { ok: false; response: Response };

/**
 * Authenticates the caller and establishes that they are an admin.
 *
 * The two failures are kept apart on purpose. 401 says the request carried no
 * usable session and is worth retrying with one; 403 says this session is a
 * real, valid session that simply may not do this — a passenger who reaches a
 * review endpoint is told they are not allowed, not that they are logged out.
 *
 * `headers` is a parameter because this is also used by GET /api/reports, whose
 * CORS headers advertise a different set of methods; the rule is the same
 * either way.
 */
export async function authenticateAdmin(
    request: Request,
    headers: Record<string, string> = reviewCorsHeaders
): Promise<AdminAuthorization> {
    const user = await authenticateRequest(request);

    if (!user) {
        return {
            ok: false,
            response: unauthorizedResponse('Authentication required.', headers),
        };
    }

    if (user.role !== ADMIN_ROLE) {
        return {
            ok: false,
            response: reviewErrorResponse(
                403,
                'Only an administrator can review accessibility reports.',
                headers
            ),
        };
    }

    return { ok: true, admin: user };
}

/**
 * The id to record as the reviewer.
 *
 * `uid` is the account itself and is what an admin session is really keyed by;
 * `passengerId` is the fallback for an operator record minted before admins
 * carried one. Read off the verified token in both cases — never from the
 * request, which is the difference between an audit trail and a claim.
 */
export function adminReviewerId(admin: JwtPayload): string {
    const uid = typeof admin.uid === 'string' ? admin.uid.trim() : '';

    if (uid) return uid;

    return typeof admin.passengerId === 'string' ? admin.passengerId.trim() : '';
}

// ------------------------------------------------------------------
// Loading the report under review
// ------------------------------------------------------------------

export interface AdminReportContext {
    /** The verified admin. Never a value taken from the request body. */
    admin: JwtPayload;
    adminDb: any;
    reportId: string;
    reportRef: any;
    report: Record<string, any>;
}

/**
 * Authorises the admin and loads the report they are addressing.
 *
 * The same shape `loadFeedbackContext` gives the feedback routes, and it reads
 * the id with the same helper, so /review resolves `/api/reports/:id/review`
 * exactly as /vote and /comments resolve theirs — including when the handler is
 * called directly with a plain params object rather than through the router.
 */
export async function loadAdminReportContext(
    request: Request,
    context: any
): Promise<{ ok: true; value: AdminReportContext } | { ok: false; response: Response }> {
    const auth = await authenticateAdmin(request);

    if (!auth.ok) return { ok: false, response: auth.response };

    const reportId = extractFeedbackReportId(request, context, 'review');

    if (!reportId) {
        return { ok: false, response: reviewErrorResponse(400, 'Report ID is required.') };
    }

    const adminDb = getAdminDb();
    const reportRef = adminDb.collection(REPORTS_COLLECTION).doc(reportId);
    const reportDoc = await reportRef.get();

    if (!reportDoc.exists) {
        return { ok: false, response: reviewErrorResponse(404, 'Report not found.') };
    }

    return {
        ok: true,
        value: {
            admin: auth.admin,
            adminDb,
            reportId,
            reportRef,
            report: reportDoc.data() ?? {},
        },
    };
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

export interface ReviewInstruction {
    action: ReportReviewAction;
    /** The status the action produces, or null when it changes none. */
    status: ReportStatus | null;
    /** The remark to store, or null when the request carried none. */
    adminRemark: string | null;
}

/**
 * The remark in a request body, trimmed, or why it cannot be stored.
 *
 * Whitespace is not a remark. When the request carries none at all the answer
 * is null rather than an error for VERIFY and REJECT — a decision does not have
 * to be explained to be recorded — and an error for REMARK, whose entire
 * purpose is the text.
 */
export function normalizeAdminRemark(
    input: unknown,
    options: { required: boolean }
): FeedbackValidation<string | null> {
    if (input === undefined || input === null) {
        return options.required
            ? { ok: false, message: 'A remark is required.' }
            : { ok: true, value: null };
    }

    if (typeof input !== 'string') {
        return { ok: false, message: 'Admin remark must be text.' };
    }

    const trimmed = input.trim();

    if (!trimmed) {
        return options.required
            ? { ok: false, message: 'A remark is required.' }
            : { ok: true, value: null };
    }

    if (trimmed.length > MAX_ADMIN_REMARK_LENGTH) {
        return {
            ok: false,
            message: `A remark can be at most ${MAX_ADMIN_REMARK_LENGTH} characters.`,
        };
    }

    return { ok: true, value: trimmed };
}

/**
 * A review request body as an instruction, or why it is not one.
 *
 * `status` may be sent, and is treated as an assertion about what the action
 * does rather than as the thing being applied: it has to agree with the action
 * or the request is refused. That is what keeps a client honest without ever
 * letting one pick the stored state — sending VERIFY with status RESOLVED is a
 * confused request, and a confused request is a 400, not a stored RESOLVED.
 */
export function readReviewInstruction(body: unknown): FeedbackValidation<ReviewInstruction> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, message: 'Invalid request body.' };
    }

    const { action, status, adminRemark } = body as Record<string, any>;

    if (action === undefined || action === null || action === '') {
        return {
            ok: false,
            message: `A review action is required. Expected one of ${REPORT_REVIEW_ACTIONS.join(', ')}.`,
        };
    }

    if (!isReportReviewAction(action)) {
        return {
            ok: false,
            message: `Action must be one of ${REPORT_REVIEW_ACTIONS.join(', ')}.`,
        };
    }

    const nextStatus = REPORT_REVIEW_ACTION_STATUS[action];

    if (status !== undefined && status !== null && status !== nextStatus) {
        return {
            ok: false,
            message: nextStatus
                ? `Action ${action} sets the status to ${nextStatus}.`
                : `Action ${action} does not change the status.`,
        };
    }

    const remarkCheck = normalizeAdminRemark(adminRemark, { required: action === 'REMARK' });

    if (!remarkCheck.ok) return remarkCheck;

    return {
        ok: true,
        value: { action, status: nextStatus, adminRemark: remarkCheck.value },
    };
}

/**
 * Whether a report is in a state this instruction can be applied to.
 *
 * A decision is only made once. VERIFY and REJECT are refused on a report that
 * has already been decided, because overwriting the stored review would erase
 * who decided it and when — the record is the point. A remark carries no
 * decision, so it can be written at any point in the report's life.
 *
 * A report with no stored status is read as PENDING: records written before a
 * status was always set are unreviewed, not undecidable.
 */
export function canApplyReview(
    instruction: ReviewInstruction,
    report: Record<string, any>
): { ok: true } | { ok: false; status: number; message: string } {
    if (instruction.status === null) return { ok: true };

    const current = typeof report?.status === 'string' && report.status
        ? report.status
        : REPORT_REVIEW_REQUIRED_STATUS;

    if (current !== REPORT_REVIEW_REQUIRED_STATUS) {
        return {
            ok: false,
            status: 409,
            message: `This report has already been reviewed (${current}).`,
        };
    }

    return { ok: true };
}

// ------------------------------------------------------------------
// Applying a review
// ------------------------------------------------------------------

/**
 * The fields a review writes, and no others.
 *
 * This is an allow-list, which is the whole of requirement "preserve existing
 * data": the update names four keys, so the description, the photos, the bus
 * and route snapshots, the vote tallies and the review flag are not merely left
 * alone by convention — the write has no way to reach them. It is also why
 * reportId, passengerId, createdAt, agreeCount, disagreeCount and
 * requiresAdminReview cannot be changed through a review request: none of them
 * is ever read off the body.
 *
 * `reviewedAt` is generated here rather than accepted, so it says when the
 * server recorded the decision.
 */
export function buildReviewUpdate(
    instruction: ReviewInstruction,
    reviewerId: string,
    now: Date = new Date()
): Record<string, any> {
    return {
        ...(instruction.status ? { status: instruction.status } : {}),
        reviewedBy: reviewerId,
        reviewedAt: now.toISOString(),
        ...(instruction.adminRemark === null ? {} : { adminRemark: instruction.adminRemark }),
        updatedAt: now,
    };
}

// ------------------------------------------------------------------
// The admin review view
// ------------------------------------------------------------------

/** Whether this report is one an admin is being asked to look at. */
export function isReportFlagged(report: Record<string, any>): boolean {
    if (report?.requiresAdminReview === true) return true;

    const agreeCount = Number(report?.agreeCount);

    return Number.isFinite(agreeCount) && shouldRequireAdminReview(agreeCount);
}

/**
 * The review already recorded against a report, or null if there is none.
 *
 * Null rather than an object of nulls, so the review page can tell "nobody has
 * decided this yet" from "decided, with nothing written about it".
 */
export function extractAdminReview(report: Record<string, any>): AdminReportReview | null {
    const reviewedBy = typeof report?.reviewedBy === 'string' ? report.reviewedBy : null;
    const reviewedAt = report?.reviewedAt ? toIsoString(report.reviewedAt) : null;
    const adminRemark = typeof report?.adminRemark === 'string' ? report.adminRemark : null;

    if (!reviewedBy && !reviewedAt && !adminRemark) return null;

    return {
        status: typeof report?.status === 'string' ? report.status : null,
        reviewedBy,
        reviewedAt,
        adminRemark,
    };
}

/** A stored count as a number the page can render without guarding. */
function readCount(value: unknown): number {
    const count = Number(value);

    return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * One report as the admin review page reads it.
 *
 * Everything the document holds, plus the four things it does not: the counts
 * as numbers rather than sometimes-absent fields, whether the report is
 * flagged, how many comments it has drawn, and the existing review pulled out
 * as its own object.
 *
 * The timestamps go out as ISO strings, which is what Firestore Timestamps, the
 * Dates a directly-called handler writes and the strings older records carry
 * all have to become before the app's date formatter can read them.
 */
export function toAdminReviewReport(
    data: Record<string, any>,
    documentId: string,
    commentCount = 0
) {
    return {
        ...data,
        documentId,
        reportId: data?.reportId ?? documentId,
        createdAt: toIsoString(data?.createdAt),
        updatedAt: toIsoString(data?.updatedAt),
        agreeCount: readCount(data?.agreeCount),
        disagreeCount: readCount(data?.disagreeCount),
        commentCount,
        requiresAdminReview: data?.requiresAdminReview === true,
        flagged: isReportFlagged(data),
        review: extractAdminReview(data),
    };
}
