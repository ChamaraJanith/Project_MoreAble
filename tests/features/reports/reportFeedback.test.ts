// Community feedback on a report.
//
// MOV-144 is frontend-only and deliberately invents nothing: there are no
// seeded counts and no seeded comments to test, because a stand-in number would
// read to a passenger as a real one. What is left is the logic that stays true
// once MOV-145 and MOV-146 put an API behind it.
//
// The rule worth pinning down is that one passenger stays one vote: pressing
// Agree twice must not become two votes. It costs nothing to hold now and will
// cost a duplicate request when a press starts hitting the network.

import {
    MAX_FEEDBACK_COMMENT_LENGTH,
    addLocalComment,
    applyVote,
    commentInitial,
    formatCommentCount,
    formatCommentTimestamp,
    isSubmittableComment,
    voteAccessibilityLabel,
} from '../../../src/features/reports/utils/reportFeedback';

describe('applyVote', () => {
    it('records a first vote', () => {
        expect(applyVote(null, 'AGREE')).toBe('AGREE');
        expect(applyVote(null, 'DISAGREE')).toBe('DISAGREE');
    });

    it('does not turn a repeated press into a second vote', () => {
        const once = applyVote(null, 'AGREE');

        expect(applyVote(once, 'AGREE')).toBe('AGREE');
        expect(applyVote(applyVote(once, 'AGREE'), 'AGREE')).toBe('AGREE');
    });

    it('moves the vote across rather than holding both', () => {
        const agreed = applyVote(null, 'AGREE');

        expect(applyVote(agreed, 'DISAGREE')).toBe('DISAGREE');
    });

    it('lets a passenger change their mind and change it back', () => {
        let vote = applyVote(null, 'AGREE');
        vote = applyVote(vote, 'DISAGREE');
        vote = applyVote(vote, 'AGREE');

        expect(vote).toBe('AGREE');
    });
});

describe('voteAccessibilityLabel', () => {
    it('names the side without claiming a count', () => {
        expect(voteAccessibilityLabel('AGREE', false)).toBe('Agree with this report');
        expect(voteAccessibilityLabel('DISAGREE', false)).toBe('Disagree with this report');
    });

    it('says when it is the passenger own vote', () => {
        expect(voteAccessibilityLabel('AGREE', true)).toBe(
            'Agree with this report, your vote'
        );
    });

    it('never announces a number', () => {
        for (const isSelected of [true, false]) {
            expect(voteAccessibilityLabel('AGREE', isSelected)).not.toMatch(/\d/);
            expect(voteAccessibilityLabel('DISAGREE', isSelected)).not.toMatch(/\d/);
        }
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
});

describe('addLocalComment', () => {
    const NOW = '2026-08-22T09:30:00.000Z';

    it('adds the first comment to an empty list', () => {
        const next = addLocalComment([], '  Same here last week.  ', 'Amaya', NOW);

        expect(next).toEqual([
            {
                commentId: 'local-1',
                authorName: 'Amaya',
                text: 'Same here last week.',
                createdAt: NOW,
            },
        ]);
    });

    it('puts each new comment at the top', () => {
        const first = addLocalComment([], 'One.', 'Amaya', NOW);
        const second = addLocalComment(first, 'Two.', 'Amaya', NOW);

        expect(second.map((comment) => comment.text)).toEqual(['Two.', 'One.']);

        // The comment already there keeps its place and its id.
        expect(second[1]).toEqual(first[0]);
    });

    it('gives each comment its own id', () => {
        const first = addLocalComment([], 'One.', 'Amaya', NOW);
        const second = addLocalComment(first, 'Two.', 'Amaya', NOW);

        expect(second[0].commentId).not.toBe(second[1].commentId);
    });

    it('falls back to "You" when there is no name to show', () => {
        expect(addLocalComment([], 'Anonymous note.', '   ', NOW)[0].authorName).toBe('You');
    });

    it('returns the same list when there is nothing submittable to add', () => {
        const existing = addLocalComment([], 'One.', 'Amaya', NOW);

        expect(addLocalComment(existing, '   ', 'Amaya', NOW)).toBe(existing);
        expect(addLocalComment(existing, '', 'Amaya', NOW)).toBe(existing);
    });

    it('leaves the passed list untouched', () => {
        const existing = addLocalComment([], 'One.', 'Amaya', NOW);

        addLocalComment(existing, 'Two.', 'Amaya', NOW);

        expect(existing).toHaveLength(1);
    });

    it('never carries a report id', () => {
        const text = JSON.stringify(addLocalComment([], 'Nothing to see.', 'Amaya', NOW));

        expect(text).not.toMatch(/REP-/);
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
