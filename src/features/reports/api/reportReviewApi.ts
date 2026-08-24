/**
 * The client half of admin review (MOV-160).
 *
 * Three calls against the two endpoints MOV-161 already built: read the queue,
 * read one report in full, record a decision on it. Nothing here draws
 * anything, and nothing here decides anything either — the body names an
 * ACTION, and what VERIFY means is the server's to say.
 *
 * Every call carries the session token, because all three routes refuse an
 * anonymous request and a non-admin one. Who is reviewing is never sent: the
 * routes take the admin from the verified token, so there is deliberately no
 * adminId parameter to pass, correctly or otherwise.
 *
 * A failure comes back with the HTTP status alongside the message. The four
 * that matter — 401, 403, 404 and 409 — mean four different things to the
 * screen, and flattening them into one string would leave it unable to tell a
 * session that expired from a report another admin decided first.
 */

import {
    AdminReportReview,
    ReportCommentRecord,
    ReportReviewAction,
} from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import {
    AdminReviewFilter,
    AdminReviewReport,
    adminReviewRequestPath,
    mapAdminReview,
    mapAdminReviewReport,
    mapAdminReviewReports,
} from '../utils/reportReview';
import { reportReviewApiPath } from '../utils/reportRoutes';

/**
 * What a review call produced, or why it did not.
 *
 * The same shape reportFeedbackApi returns, with the response status carried on
 * the failure — see the module note.
 */
export type ReviewResult<T> =
    | { ok: true; value: T }
    | { ok: false; message: string; status?: number };

/** The review queue, as GET /api/reports?scope=review answers it. */
export interface AdminReviewQueue {
    reports: AdminReviewReport[];
    /** How many of the returned reports the community has flagged. */
    flaggedCount: number;
}

/** One report in full, as GET /api/reports/:reportId/review answers it. */
export interface AdminReviewDetail {
    report: AdminReviewReport;
    /** The community thread, newest first, exactly as the route returned it. */
    comments: ReportCommentRecord[];
    review: AdminReportReview | null;
}

/** What a recorded decision left behind. */
export interface AdminReviewOutcome {
    report: AdminReviewReport;
    review: AdminReportReview | null;
    /** The API's own acknowledgement, e.g. "Report marked VERIFIED." */
    message: string;
}

function authHeaders(token: string, hasBody: boolean): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    };
}

/**
 * The message to show when a request did not succeed.
 *
 * The API's own wording is preferred where there is one — it is what knows
 * whether the report is gone or was decided a moment ago — and the caller
 * decides, from the status, whether to use it or say something better.
 */
function failureMessage(payload: any, fallback: string): string {
    return typeof payload?.message === 'string' && payload.message ? payload.message : fallback;
}

/**
 * GET /api/reports?scope=review
 *
 * Admin only, enforced by the route rather than by which screen calls it. The
 * filter is a query parameter on that same scope, so the queue asks the API for
 * the slice it means to show rather than narrowing a wider list here.
 */
export async function fetchReportsForReview(
    token: string,
    filter: AdminReviewFilter = 'ALL'
): Promise<ReviewResult<AdminReviewQueue>> {
    try {
        const response = await fetch(`${API_BASE_URL}${adminReviewRequestPath(filter)}`, {
            method: 'GET',
            headers: authHeaders(token, false),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            return {
                ok: false,
                status: response.status,
                message: failureMessage(result, 'Failed to load reports for review.'),
            };
        }

        return {
            ok: true,
            value: {
                reports: mapAdminReviewReports(result.reports),
                flaggedCount: Number(result.flaggedCount) || 0,
            },
        };
    } catch (error) {
        console.error('Fetch Reports For Review Error:', error);

        return { ok: false, message: 'Failed to load reports for review.' };
    }
}

/**
 * GET /api/reports/:reportId/review
 *
 * Everything the review page needs in one request: the report, the tallies as
 * the votes themselves stand, the community thread, and whatever review has
 * already been recorded.
 */
export async function fetchReportForReview(
    reportId: string,
    token: string
): Promise<ReviewResult<AdminReviewDetail>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportReviewApiPath(reportId)}`, {
            method: 'GET',
            headers: authHeaders(token, false),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success || !result.report) {
            return {
                ok: false,
                status: response.status,
                message: failureMessage(result, 'Failed to load the report for review.'),
            };
        }

        return {
            ok: true,
            value: {
                report: mapAdminReviewReport(result.report),
                comments: Array.isArray(result.comments)
                    ? (result.comments as ReportCommentRecord[])
                    : [],
                review: mapAdminReview(result.review),
            },
        };
    } catch (error) {
        console.error('Fetch Report For Review Error:', error);

        return { ok: false, message: 'Failed to load the report for review.' };
    }
}

/**
 * POST /api/reports/:reportId/review
 *
 * The body names the action and nothing else — no status, and no report fields.
 * What VERIFY does to the report is decided by the route, which is what stops a
 * client putting a report into a state no review flow can reach.
 *
 * `adminRemark` travels only for REMARK, whose whole purpose is the text. A
 * decision does not have to be explained to be recorded, and sending an empty
 * one would be asking the route to refuse it.
 */
export async function submitReportReview(
    reportId: string,
    action: ReportReviewAction,
    token: string,
    adminRemark?: string
): Promise<ReviewResult<AdminReviewOutcome>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportReviewApiPath(reportId)}`, {
            method: 'POST',
            headers: authHeaders(token, true),
            body: JSON.stringify({
                action,
                ...(action === 'REMARK' ? { adminRemark } : {}),
            }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success || !result.report) {
            return {
                ok: false,
                status: response.status,
                message: failureMessage(result, 'Failed to record the review.'),
            };
        }

        return {
            ok: true,
            value: {
                report: mapAdminReviewReport(result.report),
                review: mapAdminReview(result.review),
                message: failureMessage(result, 'Review saved.'),
            },
        };
    } catch (error) {
        console.error('Submit Report Review Error:', error);

        return { ok: false, message: 'Failed to record the review.' };
    }
}
