/**
 * The client half of community feedback (MOV-145).
 *
 * Four calls, matching the two routes: read the votes, cast one, read the
 * thread, add to it. Nothing here draws anything — MOV-144's screen still owns
 * the controls, and wiring them to these functions is its own change.
 *
 * Every call carries the session token, because all four routes refuse an
 * anonymous request. The passenger is identified by that token alone: there is
 * deliberately no passengerId parameter to pass, correctly or otherwise.
 */

import {
    ReportCommentRecord,
    ReportVoteChoice,
    ReportVoteSummary,
} from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { reportCommentsApiPath, reportVoteApiPath } from '../utils/reportRoutes';

/** What a vote left behind: this session's vote, and the tallies after it. */
export interface ReportVoteResult extends ReportVoteSummary {
    /** Whether the report has now collected enough agreement to be reviewed. */
    requiresAdminReview: boolean;
}

export type FeedbackResult<T> = { ok: true; value: T } | { ok: false; message: string };

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

/** POST /api/reports/:reportId/comments — returns the stored comment. */
export async function submitReportComment(
    reportId: string,
    comment: string,
    token: string
): Promise<FeedbackResult<ReportCommentRecord>> {
    try {
        const response = await fetch(`${API_BASE_URL}${reportCommentsApiPath(reportId)}`, {
            method: 'POST',
            headers: authHeaders(token, true),
            body: JSON.stringify({ comment }),
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
