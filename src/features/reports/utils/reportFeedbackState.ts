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

import { ReportCommentRecord, ReportPhotoDraft } from '../../../entities/report/model/types';
import {
    FeedbackVote,
    canSubmitCommentDraft,
    countVisibleComments,
    isSubmittableCommentEdit,
} from './reportFeedback';

/** Where one half of the section has got to. */
export type FeedbackLoadStatus = 'loading' | 'ready' | 'failed';

/**
 * The things that can go wrong, in the words the passenger sees.
 *
 * Kept apart because they are different situations: a section that could not
 * load says so where it would have been, while a vote or a comment that did not
 * send is worth "try again" — the passenger still has something to do. Editing
 * or deleting one's own comment (MOV-306) is the same kind of retryable action.
 */
export const FEEDBACK_MESSAGES = {
    votesLoadFailed: 'Unable to load community feedback.',
    voteSubmitFailed: 'Unable to submit your feedback. Please try again.',
    commentsLoadFailed: 'Unable to load comments.',
    commentSubmitFailed: 'Unable to post your comment. Please try again.',
    replySubmitFailed: 'Unable to post your reply. Please try again.',
    commentEditFailed: 'Unable to update your comment. Please try again.',
    commentDeleteFailed: 'Unable to delete your comment. Please try again.',
} as const;

/** What is being done to one of the passenger's own comments. */
export type CommentActionKind = 'edit' | 'delete';

/** One comment action on its way to the API. */
export interface PendingCommentAction {
    commentId: string;
    kind: CommentActionKind;
}

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
    /**
     * The one comment whose text is open for editing, or null. One at a time:
     * opening a second editor closes the first.
     */
    editingCommentId: string | null;
    /**
     * The edit or delete currently in flight. Doubles as the guard against a
     * second press and as what the row draws busy, as `pendingVote` does.
     */
    pendingCommentAction: PendingCommentAction | null;
    /**
     * Why the last edit or delete failed, drawn inside the comments card.
     * Kept apart from `submitError`, which is drawn under the votes.
     */
    commentActionError: string | null;
    /** A reply is on its way to the API. */
    isPostingReply: boolean;
    /** Why the last reply failed, drawn inside the reply composer. */
    replyError: string | null;
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
    editingCommentId: null,
    pendingCommentAction: null,
    commentActionError: null,
    isPostingReply: false,
    replyError: null,
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
    | { type: 'commentFailed' }
    | { type: 'replyStarted' }
    | { type: 'replySucceeded'; comment: ReportCommentRecord }
    | { type: 'replyFailed'; message?: string }
    | { type: 'replyDismissed' }
    | { type: 'commentEditOpened'; commentId: string }
    | { type: 'commentEditCancelled' }
    | { type: 'commentEditStarted'; commentId: string }
    | { type: 'commentEditSucceeded'; comment: ReportCommentRecord }
    | { type: 'commentEditFailed' }
    | { type: 'commentDeleteStarted'; commentId: string }
    | { type: 'commentDeleteSucceeded'; commentId: string }
    | { type: 'commentDeleteFailed' };

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

/**
 * The comment list with one stored comment swapped for its edited record, in
 * the same place.
 *
 * An edit changes what a comment says, not when it was written — and the
 * thread is ordered by when — so it stays exactly where it was rather than
 * jumping to the top the way a new comment does. A comment that is no longer
 * on the list is not added back.
 */
export function replaceComment(
    items: ReportCommentRecord[],
    comment: ReportCommentRecord
): ReportCommentRecord[] {
    return items.map((entry) => (entry.commentId === comment.commentId ? comment : entry));
}

/** The comment list without one comment. Unknown ids leave it as it was. */
export function removeComment(
    items: ReportCommentRecord[],
    commentId: string
): ReportCommentRecord[] {
    return items.filter((entry) => entry.commentId !== commentId);
}

/**
 * The comment list after one comment was deleted, following the same thread
 * rules the API applies (removeReportComment on the server):
 *
 * - a top-level comment with replies becomes a `deleted` placeholder, text and
 *   photo gone, so the replies keep their place;
 * - anything else leaves the list, and a placeholder parent left with no
 *   replies leaves with it.
 *
 * Mirroring the rule here keeps the list right without a second request.
 */
export function removeCommentFromThread(
    items: ReportCommentRecord[],
    commentId: string
): ReportCommentRecord[] {
    const target = items.find((entry) => entry.commentId === commentId);

    if (!target) return items;

    if (!target.parentCommentId && items.some((entry) => entry.parentCommentId === commentId)) {
        return items.map((entry) => {
            if (entry.commentId !== commentId) return entry;

            const { imageUrl: _removedImage, ...rest } = entry;

            return { ...rest, text: '', deleted: true };
        });
    }

    const remaining = removeComment(items, commentId);
    const parentId = target.parentCommentId;

    if (!parentId) return remaining;

    const parent = remaining.find((entry) => entry.commentId === parentId);
    const parentHasReplies = remaining.some((entry) => entry.parentCommentId === parentId);

    return parent?.deleted && !parentHasReplies ? removeComment(remaining, parentId) : remaining;
}

function hasComment(state: ReportFeedbackState, commentId: string): boolean {
    return state.comments.items.some((entry) => entry.commentId === commentId);
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

        // An editor left open on a comment the fresh thread no longer holds
        // (deleted elsewhere) is closed with it, rather than editing nothing.
        case 'commentsLoaded':
            return {
                ...state,
                comments: { status: 'ready', items: action.comments },
                editingCommentId:
                    state.editingCommentId !== null &&
                    action.comments.some((entry) => entry.commentId === state.editingCommentId)
                        ? state.editingCommentId
                        : null,
            };

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

        // ---- Replies ----
        //
        // Kept apart from the top-level composer: a reply in flight does not
        // lock the main box, and a failed reply is said in the reply composer
        // rather than under the votes.
        case 'replyStarted':
            return { ...state, isPostingReply: true, replyError: null };

        case 'replySucceeded':
            return {
                ...state,
                isPostingReply: false,
                replyError: null,
                comments: {
                    status: 'ready',
                    items: mergeSubmittedComment(state.comments.items, action.comment),
                },
            };

        case 'replyFailed':
            return {
                ...state,
                isPostingReply: false,
                replyError: action.message || FEEDBACK_MESSAGES.replySubmitFailed,
            };

        // The reply composer was closed: whatever it last failed on goes too.
        case 'replyDismissed':
            return state.isPostingReply ? state : { ...state, replyError: null };

        // ---- The passenger's own comments (MOV-306) ----
        //
        // Every action names the comment it is about, and one naming a comment
        // that is not on the list does nothing: there is nothing on screen for
        // it to change.

        // Opening an editor is refused while an edit or a delete is in flight,
        // so the row being saved cannot be swapped out from under its request.
        case 'commentEditOpened':
            if (state.pendingCommentAction !== null || !hasComment(state, action.commentId)) {
                return state;
            }

            return { ...state, editingCommentId: action.commentId, commentActionError: null };

        case 'commentEditCancelled':
            if (state.pendingCommentAction?.kind === 'edit') return state;

            return { ...state, editingCommentId: null, commentActionError: null };

        case 'commentEditStarted':
            if (state.pendingCommentAction !== null || !hasComment(state, action.commentId)) {
                return state;
            }

            return {
                ...state,
                pendingCommentAction: { commentId: action.commentId, kind: 'edit' },
                commentActionError: null,
            };

        // The stored record goes back in the same place, with the server's
        // text and editedAt — and the editor closes.
        case 'commentEditSucceeded':
            return {
                ...state,
                pendingCommentAction: null,
                commentActionError: null,
                editingCommentId: null,
                comments: {
                    ...state.comments,
                    items: replaceComment(state.comments.items, action.comment),
                },
            };

        // Nothing on the list changes and the editor stays open, so the
        // passenger keeps what they typed and can try again.
        case 'commentEditFailed':
            return {
                ...state,
                pendingCommentAction: null,
                commentActionError: FEEDBACK_MESSAGES.commentEditFailed,
            };

        case 'commentDeleteStarted':
            if (state.pendingCommentAction !== null || !hasComment(state, action.commentId)) {
                return state;
            }

            return {
                ...state,
                pendingCommentAction: { commentId: action.commentId, kind: 'delete' },
                commentActionError: null,
            };

        // Gone from the list — and so from the count beside the heading, which
        // is read off the list's length.
        case 'commentDeleteSucceeded':
            return {
                ...state,
                pendingCommentAction: null,
                commentActionError: null,
                editingCommentId:
                    state.editingCommentId === action.commentId ? null : state.editingCommentId,
                comments: {
                    ...state.comments,
                    items: removeCommentFromThread(state.comments.items, action.commentId),
                },
            };

        case 'commentDeleteFailed':
            return {
                ...state,
                pendingCommentAction: null,
                commentActionError: FEEDBACK_MESSAGES.commentDeleteFailed,
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

/**
 * Whether the composer should be sending what is in it: text, an uploaded
 * photo, or both — never while its photo is still uploading.
 */
export function shouldSendComment(
    state: ReportFeedbackState,
    draft: string,
    image: ReportPhotoDraft | null = null
): boolean {
    return !state.isPostingComment && canSubmitCommentDraft(draft, image);
}

/**
 * Whether the reply composer should send: the same rules as a comment, plus a
 * parent that is still on the list and still saying something.
 */
export function shouldSendReply(
    state: ReportFeedbackState,
    parentCommentId: string,
    draft: string,
    image: ReportPhotoDraft | null = null
): boolean {
    if (state.isPostingReply) return false;

    const parent = state.comments.items.find((entry) => entry.commentId === parentCommentId);

    if (!parent || parent.parentCommentId || parent.deleted) return false;

    return canSubmitCommentDraft(draft, image);
}

/**
 * Whether Save on an open editor should send the edit.
 *
 * Not while another edit or delete is in flight, not for a comment that is not
 * the one open for editing (or is no longer on the list), and not for a draft
 * that is blank, too long or says exactly what the comment already says.
 */
export function shouldSendCommentEdit(
    state: ReportFeedbackState,
    commentId: string,
    draft: string
): boolean {
    if (state.pendingCommentAction !== null) return false;
    if (state.editingCommentId !== commentId) return false;

    const original = state.comments.items.find((entry) => entry.commentId === commentId);

    if (!original) return false;

    return isSubmittableCommentEdit(draft, original.text);
}

/** Whether a confirmed delete should send anything. */
export function shouldSendCommentDelete(state: ReportFeedbackState, commentId: string): boolean {
    if (state.pendingCommentAction !== null) return false;

    return hasComment(state, commentId);
}

/** Whether this comment has this action in flight — what its row draws busy. */
export function isCommentActionPending(
    state: ReportFeedbackState,
    commentId: string,
    kind: CommentActionKind
): boolean {
    return (
        state.pendingCommentAction?.commentId === commentId &&
        state.pendingCommentAction.kind === kind
    );
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

    const count = countVisibleComments(state.comments.items);

    return count > 0 ? count : null;
}
