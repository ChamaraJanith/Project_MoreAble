// Community feedback on a report — how it reads.
//
// The state behind this section is the API's now (see reportFeedbackState and
// reportFeedbackApi), so what is left in this module is presentation: how a
// tally pluralises, what a screen reader is told about a vote button, and what
// counts as a comment worth sending at all.
//
// The rule worth pinning down here is that nothing announces a number it does
// not have. A count of null is a count that has not arrived, and it must reach
// a screen reader as silence rather than as "0 votes".

import {
    MAX_FEEDBACK_COMMENT_LENGTH,
    commentInitial,
    formatCommentCount,
    formatCommentTimestamp,
    formatVoteCount,
    isSubmittableComment,
    voteAccessibilityLabel,
} from '../../../src/features/reports/utils/reportFeedback';

describe('voteAccessibilityLabel', () => {
    it('names the side, and says nothing about a count it has not been given', () => {
        expect(voteAccessibilityLabel('AGREE', false)).toBe('Agree with this report');
        expect(voteAccessibilityLabel('DISAGREE', false)).toBe('Disagree with this report');
    });

    it('announces a count once there is a real one', () => {
        expect(voteAccessibilityLabel('AGREE', false, 5)).toBe(
            'Agree with this report, 5 votes'
        );
        expect(voteAccessibilityLabel('DISAGREE', false, 2)).toBe(
            'Disagree with this report, 2 votes'
        );
    });

    it('announces a real zero, which is not the same as no count', () => {
        expect(voteAccessibilityLabel('AGREE', false, 0)).toBe(
            'Agree with this report, 0 votes'
        );
        expect(voteAccessibilityLabel('AGREE', false, null)).not.toMatch(/\d/);
    });

    it('says when it is the passenger own vote', () => {
        expect(voteAccessibilityLabel('AGREE', true)).toBe(
            'Agree with this report, your vote'
        );
        expect(voteAccessibilityLabel('AGREE', true, 5)).toBe(
            'Agree with this report, 5 votes, your vote'
        );
    });
});

describe('formatVoteCount', () => {
    it('pluralises the tally', () => {
        expect(formatVoteCount(0)).toBe('0 votes');
        expect(formatVoteCount(1)).toBe('1 vote');
        expect(formatVoteCount(6)).toBe('6 votes');
    });
});

describe('isSubmittableComment', () => {
    it('rejects an empty box and one holding only whitespace', () => {
        expect(isSubmittableComment('')).toBe(false);
        expect(isSubmittableComment('   \n  ')).toBe(false);
    });

    it('accepts real text', () => {
        expect(isSubmittableComment('The ramp was broken again.')).toBe(true);
    });

    it('rejects more than the field allows', () => {
        expect(isSubmittableComment('a'.repeat(MAX_FEEDBACK_COMMENT_LENGTH))).toBe(true);
        expect(isSubmittableComment('a'.repeat(MAX_FEEDBACK_COMMENT_LENGTH + 1))).toBe(false);
    });

    it('agrees with the cap the API enforces', () => {
        expect(MAX_FEEDBACK_COMMENT_LENGTH).toBe(300);
    });
});

describe('no comment is assembled locally any more', () => {
    it('exports nothing that could build one', async () => {
        const feedback = await import('../../../src/features/reports/utils/reportFeedback');

        // A comment used to be given a `local-N` id and "You" for a name while
        // there was nowhere to post it. It is posted now, and what goes on the
        // list is the record the API stored.
        expect(feedback).not.toHaveProperty('addLocalComment');
    });
});

describe('comment presentation', () => {
    it('takes the avatar letter from the name', () => {
        expect(commentInitial('Amaya Fernando')).toBe('A');
        expect(commentInitial('  dilan')).toBe('D');
    });

    it('falls back rather than showing a blank circle', () => {
        expect(commentInitial('   ')).toBe('?');
    });

    it('pluralises the count', () => {
        expect(formatCommentCount(1)).toBe('1 comment');
        expect(formatCommentCount(4)).toBe('4 comments');
    });

    it('formats a timestamp the way the rest of the report screens do', () => {
        expect(formatCommentTimestamp('2026-08-20T17:40:00.000Z')).toContain('2026');
    });
});
