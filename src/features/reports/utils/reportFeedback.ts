/**
 * Community feedback on a report — the wording, not the state.
 *
 * A report is one passenger's account; whether the ramp is actually broken is
 * something the people who ride that route answer together. They do it by
 * agreeing or disagreeing with the report, and by commenting on it.
 *
 * Nothing here invents any of it, and now nothing here holds any of it either.
 * MOV-144 kept a vote and a list of comments in the component and lost both on
 * leaving the screen; MOV-145's endpoints are what they come from now, through
 * reportFeedbackApi, with reportFeedbackState deciding what the section shows
 * at each point. What is left in this module is presentation: how a count
 * pluralises, what a screen reader is told, and what counts as a comment worth
 * sending.
 */

import {
    MAX_REPORT_COMMENT_LENGTH,
    ReportVoteChoice,
} from '../../../entities/report/model/types';
import { formatReportDateTime } from './reportFormat';

/**
 * Which way a passenger voted. `null` means they have not voted.
 *
 * An alias rather than a second list of the same two words: MOV-145's API
 * refuses anything that is not one of them, so a vote this module could produce
 * and that route would reject must not be expressible.
 */
export type FeedbackVote = ReportVoteChoice;

/**
 * Long enough to describe what was seen, short enough to stay a comment.
 *
 * Taken from the entity model, which is what POST
 * /api/reports/:reportId/comments validates against — so the composer can never
 * let a passenger type a comment the API would then refuse.
 */
export const MAX_FEEDBACK_COMMENT_LENGTH = MAX_REPORT_COMMENT_LENGTH;

// ------------------------------------------------------------------
// Votes
// ------------------------------------------------------------------

/** "1 vote" / "6 votes" — the tally beside one side, pluralised. */
export function formatVoteCount(count: number): string {
    return count + ' vote' + (count === 1 ? '' : 's');
}

/**
 * What a screen reader announces for one vote button.
 *
 * The count is spoken now that there is a real one to speak: it is drawn on the
 * pill, and a number that is only visible is a number half the people using
 * this screen do not get. Whether this is the passenger's own vote is spoken
 * for the same reason — neither the tint nor the tick that carry it visually is
 * readable.
 *
 * `count` is null while the tallies are still loading or failed to load, and
 * then nothing is announced rather than a zero standing in for a number that is
 * simply not known yet.
 */
export function voteAccessibilityLabel(
    choice: FeedbackVote,
    isSelected: boolean,
    count: number | null = null
): string {
    const action = choice === 'AGREE' ? 'Agree' : 'Disagree';

    const parts = [action + ' with this report'];

    if (count !== null) parts.push(formatVoteCount(count));
    if (isSelected) parts.push('your vote');

    return parts.join(', ');
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

// A comment written here used to be assembled locally, with a `local-N` id and
// "You" where a name should be, because there was nowhere to send it. It is
// posted now, and what goes on the list is the record POST
// /api/reports/:reportId/comments returns — see mergeSubmittedComment in
// reportFeedbackState.

/** The letter shown in a comment's avatar circle. */
export function commentInitial(authorName: string): string {
    const first = authorName.trim().charAt(0);

    return first ? first.toUpperCase() : '?';
}

/** e.g. "20 Aug 2026 · 14:05", matching the dates elsewhere on the screen. */
export function formatCommentTimestamp(createdAt: string): string {
    return formatReportDateTime(createdAt);
}
