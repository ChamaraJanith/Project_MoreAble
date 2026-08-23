/**
 * Community feedback as a state machine (MOV-145, frontend integration).
 *
 * MOV-144 held the vote and the comments in `useState` and lost both the moment
 * the screen closed. The API exists now, so what the section shows is what the
 * server says: a vote is a request, a comment is a request, and the counts are
 * whatever came back from the last one.
 *
 * The counts are deliberately never adjusted here. A press does not add one to
 * `agreeCount` — the POST response carries the tally, and that number is the
 * one drawn, because two passengers voting at once make any locally incremented
 * count wrong in a way that survives until the screen is closed.
 *
 * All of it lives in a reducer rather than in the component for the reason this
 * project already gives: Jest here is node-only with no React renderer, so a
 * reducer can be tested and a `useState` call cannot.
 */

import { ReportCommentRecord } from '../../../entities/report/model/types';
import { FeedbackVote } from './reportFeedback';

/** Where one half of the section has got to. */
export type FeedbackLoadStatus = 'loading' | 'ready' | 'failed';

/**
 * The four things that can go wrong, in the words the passenger sees.
 *
 * Kept apart because they are four different situations: a section that could
 * not load says so where it would have been, while a vote or a comment that did
 * not send is worth "try again" — the passenger still has something to do.
 */
export const FEEDBACK_MESSAGES = {
    votesLoadFailed: 'Unable to load community feedback.',
    voteSubmitFailed: 'Unable to submit your feedback. Please try again.',
    commentsLoadFailed: 'Unable to load comments.',
    commentSubmitFailed: 'Unable to post your comment. Please try again.',
} as const;

export interface ReportFeedbackVotes {
    status: FeedbackLoadStatus;
    /** This session's own vote, straight off the API. */
    myVote: FeedbackVote | null;
    agreeCount: number;
    disagreeCount: number;
    /**
     * Whether the report has collected enough agreement to want an admin's
     * eye. Decided by the backend at five agreeing passengers and reported
     * here; nothing in the app counts towards it or acts on it.
     */
    requiresAdminReview: boolean;
}

export interface ReportFeedbackComments {
    status: FeedbackLoadStatus;
    /** Newest first, as the API returns them. */
    items: ReportCommentRecord[];
}

export interface ReportFeedbackState {
    votes: ReportFeedbackVotes;
    comments: ReportFeedbackComments;
    /** The vote currently in flight, which is also the pill to show busy. */
    pendingVote: FeedbackVote | null;
    isPostingComment: boolean;
    /** A submission that failed, as the message to show. Never a load failure. */
    submitError: string | null;
}

/**
 * Nothing known yet.
 *
 * Zeroes rather than placeholder counts: this state is only ever rendered while
 * `status` is 'loading', where the section shows a skeleton and no numbers at
 * all. A number on screen before the API answers would be a claim about how
 * many people agreed.
 */
export const initialFeedbackState: ReportFeedbackState = {
    votes: {
        status: 'loading',
        myVote: null,
        agreeCount: 0,
        disagreeCount: 0,
        requiresAdminReview: false,
    },
    comments: { status: 'loading', items: [] },
    pendingVote: null,
    isPostingComment: false,
    submitError: null,
};

/** What a vote request hands back: the tallies as the server now holds them. */
export interface FeedbackVoteOutcome {
    myVote: FeedbackVote | null;
    agreeCount: number;
    disagreeCount: number;
    /**
     * Present on a POST, which is the only response that reports it. Absent
     * from a GET, and then the flag is left as it was rather than being
     * recomputed here: five agreements is the backend's rule to apply, and a
     * second copy of it in the app is a second rule to keep in step.
     */
    requiresAdminReview?: boolean;
}

export type ReportFeedbackAction =
    | { type: 'loadStarted' }
    | { type: 'votesLoaded'; votes: FeedbackVoteOutcome }
    | { type: 'votesFailed' }
    | { type: 'commentsLoaded'; comments: ReportCommentRecord[] }
    | { type: 'commentsFailed' }
    | { type: 'voteStarted'; vote: FeedbackVote }
    | { type: 'voteSucceeded'; votes: FeedbackVoteOutcome }
    | { type: 'voteFailed' }
    | { type: 'commentStarted' }
    | { type: 'commentSucceeded'; comment: ReportCommentRecord }
    | { type: 'commentFailed' };

/**
 * The comment list with a stored comment on it, newest first.
 *
 * Keyed by the id the API assigned, so a comment that arrives twice — posted,
 * then again in a reload that overtook it — appears once rather than as a
 * duplicate the passenger cannot tell apart.
 */
export function mergeSubmittedComment(
    items: ReportCommentRecord[],
    comment: ReportCommentRecord
): ReportCommentRecord[] {
    return [comment, ...items.filter((entry) => entry.commentId !== comment.commentId)];
}

export function reportFeedbackReducer(
    state: ReportFeedbackState,
    action: ReportFeedbackAction
): ReportFeedbackState {
    switch (action.type) {
        // A fresh load of both halves — on opening the report, and again on
        // returning to it. Anything in flight is abandoned with it.
        case 'loadStarted':
            return initialFeedbackState;

        case 'votesLoaded':
            return {
                ...state,
                votes: {
                    status: 'ready',
                    myVote: action.votes.myVote,
                    agreeCount: action.votes.agreeCount,
                    disagreeCount: action.votes.disagreeCount,
                    requiresAdminReview:
                        action.votes.requiresAdminReview ?? state.votes.requiresAdminReview,
                },
            };

        // The counts stay at zero and are not drawn: a failed load shows the
        // message in place of the tallies, never a tally of its own invention.
        case 'votesFailed':
            return { ...state, votes: { ...initialFeedbackState.votes, status: 'failed' } };

        case 'commentsLoaded':
            return { ...state, comments: { status: 'ready', items: action.comments } };

        case 'commentsFailed':
            return { ...state, comments: { status: 'failed', items: [] } };

        // The pill goes busy and the previous vote stays on screen until the
        // server answers, so nothing moves on the strength of a press alone.
        case 'voteStarted':
            return { ...state, pendingVote: action.vote, submitError: null };

        // Everything shown comes from the response, including which way this
        // session is now recorded as having voted.
        case 'voteSucceeded':
            return {
                ...state,
                pendingVote: null,
                submitError: null,
                votes: {
                    status: 'ready',
                    myVote: action.votes.myVote,
                    agreeCount: action.votes.agreeCount,
                    disagreeCount: action.votes.disagreeCount,
                    requiresAdminReview:
                        action.votes.requiresAdminReview ?? state.votes.requiresAdminReview,
                },
            };

        // The vote did not happen, so the tallies are left exactly as they
        // were. Showing the pressed side as selected here would tell the
        // passenger their voice was counted when it was not.
        case 'voteFailed':
            return {
                ...state,
                pendingVote: null,
                submitError: FEEDBACK_MESSAGES.voteSubmitFailed,
            };

        case 'commentStarted':
            return { ...state, isPostingComment: true, submitError: null };

        // The stored record goes on the list — the id, the name and the time
        // the server wrote, not a local stand-in for any of them.
        case 'commentSucceeded':
            return {
                ...state,
                isPostingComment: false,
                submitError: null,
                comments: {
                    status: 'ready',
                    items: mergeSubmittedComment(state.comments.items, action.comment),
                },
            };

        case 'commentFailed':
            return {
                ...state,
                isPostingComment: false,
                submitError: FEEDBACK_MESSAGES.commentSubmitFailed,
            };

        default:
            return state;
    }
}

/**
 * Whether pressing this side should send a request.
 *
 * Three reasons not to. A vote is already in flight, and a second press would
 * race it. The tallies have not arrived yet, so there is nothing to change.
 * Or this is already the passenger's vote — the backend would dedupe it, but
 * the request buys nothing, and one passenger pressing Agree twice is still one
 * passenger agreeing.
 */
export function shouldSendVote(state: ReportFeedbackState, choice: FeedbackVote): boolean {
    if (state.pendingVote !== null) return false;
    if (state.votes.status === 'loading') return false;

    return state.votes.myVote !== choice;
}

/** Whether the composer should be sending what is in it. */
export function shouldSendComment(state: ReportFeedbackState, draft: string): boolean {
    return !state.isPostingComment && draft.trim().length > 0;
}

/** The message to draw where the votes would be, or null when there is none. */
export function votesLoadErrorMessage(state: ReportFeedbackState): string | null {
    return state.votes.status === 'failed' ? FEEDBACK_MESSAGES.votesLoadFailed : null;
}

/** The message to draw where the thread would be, or null when there is none. */
export function commentsLoadErrorMessage(state: ReportFeedbackState): string | null {
    return state.comments.status === 'failed' ? FEEDBACK_MESSAGES.commentsLoadFailed : null;
}

/**
 * How many comments to announce beside the heading, or null for none at all.
 *
 * Null while loading and on failure, so the heading never carries "0 comments"
 * as a fact about a thread that has not been read yet.
 */
export function commentCountLabelValue(state: ReportFeedbackState): number | null {
    if (state.comments.status !== 'ready') return null;

    return state.comments.items.length > 0 ? state.comments.items.length : null;
}
