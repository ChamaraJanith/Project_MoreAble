/**
 * The client half of community feedback (MOV-145).
 *
 * Read the votes, cast one, read the thread, add to it — and, since MOV-306,
 * reword or remove one comment in it. Nothing here draws anything; the screens
 * own the controls.
 *
 * Every call carries the session token, because every feedback route refuses
 * an anonymous request. The passenger is identified by that token alone: there is
 * deliberately no passengerId parameter to pass, correctly or otherwise.
 */

import {
    ReportCommentRecord,
    ReportVoteChoice,
    ReportVoteSummary,
} from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import {
    reportCommentApiPath,
    reportCommentsApiPath,
    reportVoteApiPath,
} from '../utils/reportRoutes';

/** What a vote left behind: this session's vote, and the tallies after it. */
export interface ReportVoteResult extends ReportVoteSummary {
    /** Whether the report has now collected enough agreement to be reviewed. */
    requiresAdminReview: boolean;
}

/**
 * What a feedback call produced, or why it did not.
 *
 * `status` rides on a failure the API answered, so a screen can tell a comment
 * that is gone (404) from one it may not touch (403). It is absent when nothing
 * came back at all — a request that never left the device has no status.
 */
export type FeedbackResult<T> =
    | { ok: true; value: T }
    | { ok: false; message: string; status?: number };

function authHeaders(token: string, hasBody: boolean): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    };
}

/**
 * The message to show when a request did not succeed.
 *
 * The API's own wording is preferred — it is the one that knows whether the
 * report is gone or the comment was too long — with a fallback for the case
 * where nothing readable came back at all.
 */
function failureMessage(payload: any, fallback: string): string {
    return typeof payload?.message === 'string' && payload.message ? payload.message : fallback;
}

/** GET /api/reports/:reportId/vote */
export async function fetchReportVotes(
    reportId: string,
    token: string
): Promise<FeedbackResult<ReportVoteSummary>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportVoteApiPath(reportId)}`, {
            method: 'GET',
            headers: authHeaders(token, false),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            return { ok: false, message: failureMessage(result, 'Failed to load votes.') };
        }

        return {
            ok: true,
            value: {
                myVote: (result.myVote as ReportVoteChoice | null) ?? null,
                agreeCount: Number(result.agreeCount) || 0,
                disagreeCount: Number(result.disagreeCount) || 0,
            },
        };
    } catch (error) {
        console.error('Fetch Report Votes Error:', error);

        return { ok: false, message: 'Failed to load votes.' };
    }
}

/**
 * POST /api/reports/:reportId/vote
 *
 * Safe to call for a vote the passenger already holds: the route keys the vote
 * by report and passenger, so a repeat press rewrites one document rather than
 * adding a second voice.
 */
export async function submitReportVote(
    reportId: string,
    vote: ReportVoteChoice,
    token: string
): Promise<FeedbackResult<ReportVoteResult>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportVoteApiPath(reportId)}`, {
            method: 'POST',
            headers: authHeaders(token, true),
            body: JSON.stringify({ vote }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            return { ok: false, message: failureMessage(result, 'Failed to record your vote.') };
        }

        return {
            ok: true,
            value: {
                myVote: (result.vote as ReportVoteChoice | null) ?? null,
                agreeCount: Number(result.agreeCount) || 0,
                disagreeCount: Number(result.disagreeCount) || 0,
                requiresAdminReview: !!result.requiresAdminReview,
            },
        };
    } catch (error) {
        console.error('Submit Report Vote Error:', error);

        return { ok: false, message: 'Failed to record your vote.' };
    }
}

/** GET /api/reports/:reportId/comments — newest first, as the route returns them. */
export async function fetchReportComments(
    reportId: string,
    token: string
): Promise<FeedbackResult<ReportCommentRecord[]>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportCommentsApiPath(reportId)}`, {
            method: 'GET',
            headers: authHeaders(token, false),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            return { ok: false, message: failureMessage(result, 'Failed to load comments.') };
        }

        return {
            ok: true,
            value: Array.isArray(result.comments) ? (result.comments as ReportCommentRecord[]) : [],
        };
    } catch (error) {
        console.error('Fetch Report Comments Error:', error);

        return { ok: false, message: 'Failed to load comments.' };
    }
}

/** What may travel with a comment besides its text. */
export interface ReportCommentAttachments {
    /** The Cloudinary URL of a photo already uploaded — never local bytes. */
    imageUrl?: string | null;
    /** The top-level comment this one replies to. */
    parentCommentId?: string | null;
}

/**
 * POST /api/reports/:reportId/comments — returns the stored comment.
 *
 * A reply is the same request with `parentCommentId`; a photo is its uploaded
 * URL under `imageUrl`. Either is sent only when present, so a plain comment
 * posts exactly the body it always has.
 */
export async function submitReportComment(
    reportId: string,
    comment: string,
    token: string,
    attachments: ReportCommentAttachments = {}
): Promise<FeedbackResult<ReportCommentRecord>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportCommentsApiPath(reportId)}`, {
            method: 'POST',
            headers: authHeaders(token, true),
            body: JSON.stringify({
                comment,
                ...(attachments.imageUrl ? { imageUrl: attachments.imageUrl } : {}),
                ...(attachments.parentCommentId
                    ? { parentCommentId: attachments.parentCommentId }
                    : {}),
            }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success || !result.comment) {
            return { ok: false, message: failureMessage(result, 'Failed to add your comment.') };
        }

        return { ok: true, value: result.comment as ReportCommentRecord };
    } catch (error) {
        console.error('Submit Report Comment Error:', error);

        return { ok: false, message: 'Failed to add your comment.' };
    }
}

/**
 * PATCH /api/reports/:reportId/comments/:commentId — returns the stored comment.
 *
 * Sent under the same `comment` key the composer posts with. Only the comment's
 * author can edit it; the route takes who is asking from the token.
 */
export async function updateReportComment(
    reportId: string,
    commentId: string,
    comment: string,
    token: string
): Promise<FeedbackResult<ReportCommentRecord>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportCommentApiPath(reportId, commentId)}`, {
            method: 'PATCH',
            headers: authHeaders(token, true),
            body: JSON.stringify({ comment }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success || !result.comment) {
            return {
                ok: false,
                message: failureMessage(result, 'Failed to update your comment.'),
                status: response.status,
            };
        }

        return { ok: true, value: result.comment as ReportCommentRecord };
    } catch (error) {
        console.error('Update Report Comment Error:', error);

        return { ok: false, message: 'Failed to update your comment.' };
    }
}

/**
 * DELETE /api/reports/:reportId/comments/:commentId — returns the removed id.
 *
 * Used by the comment's author, and by an admin moderating the thread.
 */
export async function deleteReportComment(
    reportId: string,
    commentId: string,
    token: string
): Promise<FeedbackResult<string>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportCommentApiPath(reportId, commentId)}`, {
            method: 'DELETE',
            headers: authHeaders(token, false),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            return {
                ok: false,
                message: failureMessage(result, 'Failed to delete the comment.'),
                status: response.status,
            };
        }

        return {
            ok: true,
            value: typeof result.commentId === 'string' ? result.commentId : commentId,
        };
    } catch (error) {
        console.error('Delete Report Comment Error:', error);

        return { ok: false, message: 'Failed to delete the comment.' };
    }
}
