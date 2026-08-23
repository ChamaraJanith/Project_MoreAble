/**
 * Community feedback on a report — as data, not as JSX (MOV-144).
 *
 * A report is one passenger's account; whether the ramp is actually broken is
 * something the people who ride that route answer together. They do it by
 * agreeing or disagreeing with the report, and by commenting on it.
 *
 * Nothing here invents any of it. There are no counts and no comments in this
 * module because there is nowhere yet to get real ones from: MOV-145 and
 * MOV-146 add the endpoints and the Firestore collections, and a stand-in
 * number in the meantime is not a placeholder to a passenger reading it — it is
 * a claim about how many people agreed. So the screen shows the controls and
 * the empty state, and says nothing it cannot support.
 *
 * What is left is the part that stays true once the API exists: which vote a
 * press produces, and what counts as a comment worth sending. It lives here
 * rather than inside the components because this project's Jest setup is
 * node-only with no React renderer, so a reducer is testable and a `useState`
 * call is not.
 */

import { formatReportDateTime } from './reportFormat';

/** Which way a passenger voted. `null` means they have not voted. */
export type FeedbackVote = 'AGREE' | 'DISAGREE';

export interface ReportComment {
    commentId: string;
    authorName: string;
    text: string;
    /** ISO 8601, so it formats through the same helper as every other date. */
    createdAt: string;
}

/** Long enough to describe what was seen, short enough to stay a comment. */
export const MAX_FEEDBACK_COMMENT_LENGTH = 300;

// ------------------------------------------------------------------
// Votes
// ------------------------------------------------------------------

/**
 * The vote a press produces.
 *
 * Pressing the option already selected is a no-op rather than a second vote:
 * the passenger has one voice, and holding or double-tapping Agree must not
 * turn it into two. That is the rule MOV-145 has to keep when the tallies
 * become real and a press starts costing a request.
 */
export function applyVote(
    selected: FeedbackVote | null,
    choice: FeedbackVote
): FeedbackVote | null {
    if (selected === choice) return selected;

    return choice;
}

/**
 * What a screen reader announces for one vote button.
 *
 * Whether this is the passenger's own vote is spoken, because neither the tint
 * nor the tick that carry it visually is readable. No count is announced for
 * the same reason none is drawn: there is no real one to give.
 */
export function voteAccessibilityLabel(choice: FeedbackVote, isSelected: boolean): string {
    const action = choice === 'AGREE' ? 'Agree' : 'Disagree';

    return action + ' with this report' + (isSelected ? ', your vote' : '');
}

// ------------------------------------------------------------------
// Comments
// ------------------------------------------------------------------

/** "1 comment" / "4 comments" — keeps the pluralisation in one place. */
export function formatCommentCount(count: number): string {
    return count + ' comment' + (count === 1 ? '' : 's');
}

/** Whether what has been typed is worth sending — blank space is not. */
export function isSubmittableComment(draft: string): boolean {
    const trimmed = draft.trim();

    return trimmed.length > 0 && trimmed.length <= MAX_FEEDBACK_COMMENT_LENGTH;
}

/**
 * The comment list with a newly written comment on it, newest first.
 *
 * Returns the list untouched when there is nothing submittable to add, so the
 * caller can send unconditionally and let one rule decide what counts.
 */
export function addLocalComment(
    comments: ReportComment[],
    draft: string,
    authorName: string,
    createdAt: string
): ReportComment[] {
    if (!isSubmittableComment(draft)) return comments;

    // Local-only ids, and never a report id: these exist to key a list until
    // MOV-146 hands back real ones. The list only ever grows, so the count is
    // enough to keep them apart.
    const comment: ReportComment = {
        commentId: 'local-' + (comments.length + 1),
        authorName: authorName.trim() || 'You',
        text: draft.trim(),
        createdAt,
    };

    return [comment, ...comments];
}

/** The letter shown in a comment's avatar circle. */
export function commentInitial(authorName: string): string {
    const first = authorName.trim().charAt(0);

    return first ? first.toUpperCase() : '?';
}

/** e.g. "20 Aug 2026 · 14:05", matching the dates elsewhere on the screen. */
export function formatCommentTimestamp(createdAt: string): string {
    return formatReportDateTime(createdAt);
}
