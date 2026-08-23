// The Community Feedback section, as state.
//
// This is where the MOV-144 → MOV-145 integration actually lives: the component
// renders what this module decides, and this project's Jest setup is node-only
// with no React renderer, so the rules are testable here and would not be
// inside a component.
//
// Three rules are worth the tests. Counts are never adjusted locally — a press
// on Agree does not add one to the tally, the response does. Nothing is shown
// that did not come from the API, so a section that has not loaded has no
// numbers and no comments rather than plausible ones. And a vote that failed
// leaves the previous vote exactly where it was: highlighting the pressed side
// anyway would tell a passenger their voice was counted when it was not.

import { ReportCommentRecord } from '../../../src/entities/report/model/types';
import {
    FEEDBACK_MESSAGES,
    ReportFeedbackState,
    commentCountLabelValue,
    commentsLoadErrorMessage,
    initialFeedbackState,
    mergeSubmittedComment,
    reportFeedbackReducer,
    shouldSendComment,
    shouldSendVote,
    votesLoadErrorMessage,
} from '../../../src/features/reports/utils/reportFeedbackState';

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const REPORT_ID = 'REP-00007';

function comment(overrides: Partial<ReportCommentRecord> = {}): ReportCommentRecord {
    return {
        commentId: 'CMT-00001',
        reportId: REPORT_ID,
        passengerId: 'PAS-2026-00002',
        authorName: 'Kasun Silva',
        text: 'The ramp was not working properly.',
        createdAt: '2026-08-22T09:30:00.000Z',
        ...overrides,
    };
}

/** Both halves loaded, as they are the moment the screen settles. */
function loaded(
    votes: { myVote?: 'AGREE' | 'DISAGREE' | null; agreeCount?: number; disagreeCount?: number } = {},
    comments: ReportCommentRecord[] = []
): ReportFeedbackState {
    const withVotes = reportFeedbackReducer(initialFeedbackState, {
        type: 'votesLoaded',
        votes: {
            myVote: votes.myVote ?? null,
            agreeCount: votes.agreeCount ?? 0,
            disagreeCount: votes.disagreeCount ?? 0,
        },
    });

    return reportFeedbackReducer(withVotes, { type: 'commentsLoaded', comments });
}

// ==================================================================
// Before anything has arrived
// ==================================================================
describe('the section before the API answers', () => {
    it('starts loading, with nothing to show', () => {
        expect(initialFeedbackState.votes.status).toBe('loading');
        expect(initialFeedbackState.comments.status).toBe('loading');
        expect(initialFeedbackState.comments.items).toEqual([]);
    });

    it('holds no seeded counts, comments, names or dates', () => {
        // The whole state, as text: a placeholder tally or a stand-in author
        // would have to appear somewhere in here.
        const asText = JSON.stringify(initialFeedbackState);

        expect(initialFeedbackState.votes.agreeCount).toBe(0);
        expect(initialFeedbackState.votes.disagreeCount).toBe(0);
        expect(initialFeedbackState.votes.myVote).toBeNull();
        expect(asText).not.toMatch(/local-/);
        expect(asText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('announces no comment count until the thread has been read', () => {
        expect(commentCountLabelValue(initialFeedbackState)).toBeNull();
    });

    it('will not send a vote before the tallies exist', () => {
        expect(shouldSendVote(initialFeedbackState, 'AGREE')).toBe(false);
    });
});

// ==================================================================
// Loading
// ==================================================================
describe('loading the feedback', () => {
    it('shows the votes the API returned', () => {
        const state = loaded({ myVote: 'AGREE', agreeCount: 5, disagreeCount: 2 });

        expect(state.votes.status).toBe('ready');
        expect(state.votes.myVote).toBe('AGREE');
        expect(state.votes.agreeCount).toBe(5);
        expect(state.votes.disagreeCount).toBe(2);
    });

    it('shows the comments the API returned, in the order it returned them', () => {
        const newest = comment({ commentId: 'CMT-00002', text: 'Newest.' });
        const oldest = comment({ commentId: 'CMT-00001', text: 'Oldest.' });

        const state = loaded({}, [newest, oldest]);

        expect(state.comments.status).toBe('ready');
        expect(state.comments.items.map((entry) => entry.text)).toEqual([
            'Newest.',
            'Oldest.',
        ]);
    });

    it('counts the thread only once it has one', () => {
        expect(commentCountLabelValue(loaded({}, [comment()]))).toBe(1);

        // An empty thread has its own empty state; a "0 comments" beside it
        // would say the same thing twice, the second time as a statistic.
        expect(commentCountLabelValue(loaded())).toBeNull();
    });

    it('each half lands on its own', () => {
        const votesOnly = reportFeedbackReducer(initialFeedbackState, {
            type: 'votesLoaded',
            votes: { myVote: null, agreeCount: 3, disagreeCount: 1 },
        });

        expect(votesOnly.votes.status).toBe('ready');
        expect(votesOnly.comments.status).toBe('loading');
    });

    it('reloading puts the section back to knowing nothing', () => {
        const state = loaded({ agreeCount: 5 }, [comment()]);

        expect(reportFeedbackReducer(state, { type: 'loadStarted' })).toEqual(
            initialFeedbackState
        );
    });
});

// ==================================================================
// Loading failures
// ==================================================================
describe('when a half cannot be loaded', () => {
    it('says so where the votes would have been, and shows no tallies', () => {
        const state = reportFeedbackReducer(loaded({ agreeCount: 4 }), {
            type: 'votesFailed',
        });

        expect(votesLoadErrorMessage(state)).toBe('Unable to load community feedback.');
        expect(state.votes.agreeCount).toBe(0);
        expect(state.votes.disagreeCount).toBe(0);
        expect(state.votes.myVote).toBeNull();
    });

    it('says so where the thread would have been', () => {
        const state = reportFeedbackReducer(loaded({}, [comment()]), {
            type: 'commentsFailed',
        });

        expect(commentsLoadErrorMessage(state)).toBe('Unable to load comments.');
        expect(state.comments.items).toEqual([]);
    });

    it('leaves the other half working', () => {
        const state = reportFeedbackReducer(loaded({ agreeCount: 5 }, [comment()]), {
            type: 'commentsFailed',
        });

        expect(state.votes.status).toBe('ready');
        expect(state.votes.agreeCount).toBe(5);
        expect(votesLoadErrorMessage(state)).toBeNull();
    });

    it('still lets a passenger vote when the tallies could not be read', () => {
        const state = reportFeedbackReducer(initialFeedbackState, { type: 'votesFailed' });

        expect(shouldSendVote(state, 'AGREE')).toBe(true);
    });

    it('still lets a passenger comment when the thread could not be read', () => {
        const state = reportFeedbackReducer(initialFeedbackState, { type: 'commentsFailed' });

        expect(shouldSendComment(state, 'I was on that bus too.')).toBe(true);
    });

    it('has no message to show when nothing failed', () => {
        expect(votesLoadErrorMessage(loaded())).toBeNull();
        expect(commentsLoadErrorMessage(loaded())).toBeNull();
    });
});

// ==================================================================
// Voting
// ==================================================================
describe('casting a vote', () => {
    it('marks the pressed side busy without moving anything', () => {
        const state = reportFeedbackReducer(loaded({ agreeCount: 4, disagreeCount: 1 }), {
            type: 'voteStarted',
            vote: 'AGREE',
        });

        expect(state.pendingVote).toBe('AGREE');
        expect(state.votes.myVote).toBeNull();
        expect(state.votes.agreeCount).toBe(4);
    });

    it('takes the vote and both tallies from the response', () => {
        const started = reportFeedbackReducer(loaded({ agreeCount: 4, disagreeCount: 1 }), {
            type: 'voteStarted',
            vote: 'AGREE',
        });

        const state = reportFeedbackReducer(started, {
            type: 'voteSucceeded',
            votes: {
                myVote: 'AGREE',
                agreeCount: 5,
                disagreeCount: 1,
                requiresAdminReview: true,
            },
        });

        expect(state.pendingVote).toBeNull();
        expect(state.votes.myVote).toBe('AGREE');
        expect(state.votes.agreeCount).toBe(5);
        expect(state.votes.disagreeCount).toBe(1);
    });

    it('records a DISAGREE the same way', () => {
        const state = reportFeedbackReducer(loaded(), {
            type: 'voteSucceeded',
            votes: { myVote: 'DISAGREE', agreeCount: 0, disagreeCount: 1 },
        });

        expect(state.votes.myVote).toBe('DISAGREE');
        expect(state.votes.disagreeCount).toBe(1);
    });

    it('uses the server tally even when it disagrees with the press', () => {
        // Two other passengers voted while this one was deciding. The number
        // that goes on screen is the server's, not four-plus-one.
        const state = reportFeedbackReducer(loaded({ agreeCount: 4 }), {
            type: 'voteSucceeded',
            votes: { myVote: 'AGREE', agreeCount: 7, disagreeCount: 2 },
        });

        expect(state.votes.agreeCount).toBe(7);
        expect(state.votes.disagreeCount).toBe(2);
    });

    it('moves a vote across rather than holding both', () => {
        const agreed = reportFeedbackReducer(loaded(), {
            type: 'voteSucceeded',
            votes: { myVote: 'AGREE', agreeCount: 1, disagreeCount: 0 },
        });

        const changed = reportFeedbackReducer(agreed, {
            type: 'voteSucceeded',
            votes: { myVote: 'DISAGREE', agreeCount: 0, disagreeCount: 1 },
        });

        expect(changed.votes.myVote).toBe('DISAGREE');
        expect(changed.votes.agreeCount).toBe(0);
        expect(changed.votes.disagreeCount).toBe(1);
    });

    it('carries the admin review flag the backend reported, and never sets it itself', () => {
        const flagged = reportFeedbackReducer(loaded({ agreeCount: 4 }), {
            type: 'voteSucceeded',
            votes: {
                myVote: 'AGREE',
                agreeCount: 5,
                disagreeCount: 0,
                requiresAdminReview: true,
            },
        });

        expect(flagged.votes.requiresAdminReview).toBe(true);

        // Five agreeing passengers with no flag in the response stays unflagged:
        // the threshold is the backend's rule, not a second one kept here.
        const unreported = reportFeedbackReducer(initialFeedbackState, {
            type: 'votesLoaded',
            votes: { myVote: null, agreeCount: 5, disagreeCount: 0 },
        });

        expect(unreported.votes.requiresAdminReview).toBe(false);
    });
});

// ==================================================================
// Which presses send a request
// ==================================================================
describe('what a press does', () => {
    it('sends a first vote', () => {
        expect(shouldSendVote(loaded(), 'AGREE')).toBe(true);
        expect(shouldSendVote(loaded(), 'DISAGREE')).toBe(true);
    });

    it('does not send the vote the passenger already holds', () => {
        const agreed = loaded({ myVote: 'AGREE', agreeCount: 1 });

        expect(shouldSendVote(agreed, 'AGREE')).toBe(false);
        expect(shouldSendVote(agreed, 'DISAGREE')).toBe(true);
    });

    it('ignores a second press while one is in flight', () => {
        const inFlight = reportFeedbackReducer(loaded(), {
            type: 'voteStarted',
            vote: 'AGREE',
        });

        expect(shouldSendVote(inFlight, 'AGREE')).toBe(false);
        expect(shouldSendVote(inFlight, 'DISAGREE')).toBe(false);
    });

    it('takes presses again once the request has answered', () => {
        const done = reportFeedbackReducer(
            reportFeedbackReducer(loaded(), { type: 'voteStarted', vote: 'AGREE' }),
            {
                type: 'voteSucceeded',
                votes: { myVote: 'AGREE', agreeCount: 1, disagreeCount: 0 },
            }
        );

        expect(shouldSendVote(done, 'DISAGREE')).toBe(true);
    });
});

// ==================================================================
// A vote that did not send
// ==================================================================
describe('when a vote fails', () => {
    it('says so and leaves the tallies untouched', () => {
        const started = reportFeedbackReducer(loaded({ agreeCount: 4, disagreeCount: 1 }), {
            type: 'voteStarted',
            vote: 'AGREE',
        });

        const state = reportFeedbackReducer(started, { type: 'voteFailed' });

        expect(state.submitError).toBe(
            'Unable to submit your feedback. Please try again.'
        );
        expect(state.votes.agreeCount).toBe(4);
        expect(state.votes.disagreeCount).toBe(1);
    });

    it('does not show the pressed side as the passenger vote', () => {
        const state = reportFeedbackReducer(
            reportFeedbackReducer(loaded(), { type: 'voteStarted', vote: 'AGREE' }),
            { type: 'voteFailed' }
        );

        expect(state.votes.myVote).toBeNull();
        expect(state.pendingVote).toBeNull();
    });

    it('lets the passenger try again', () => {
        const failed = reportFeedbackReducer(
            reportFeedbackReducer(loaded(), { type: 'voteStarted', vote: 'AGREE' }),
            { type: 'voteFailed' }
        );

        expect(shouldSendVote(failed, 'AGREE')).toBe(true);

        const retried = reportFeedbackReducer(failed, { type: 'voteStarted', vote: 'AGREE' });

        expect(retried.submitError).toBeNull();
    });
});

// ==================================================================
// Comments
// ==================================================================
describe('posting a comment', () => {
    it('marks the composer busy', () => {
        const state = reportFeedbackReducer(loaded(), { type: 'commentStarted' });

        expect(state.isPostingComment).toBe(true);
        expect(shouldSendComment(state, 'Another one.')).toBe(false);
    });

    it('puts the stored record on the list, exactly as it arrived', () => {
        const stored = comment({ commentId: 'CMT-00009', authorName: 'Nimali Perera' });

        const state = reportFeedbackReducer(
            reportFeedbackReducer(loaded(), { type: 'commentStarted' }),
            { type: 'commentSucceeded', comment: stored }
        );

        expect(state.isPostingComment).toBe(false);
        expect(state.comments.items[0]).toEqual(stored);

        // Nothing was invented alongside it: no local id, no "You".
        expect(JSON.stringify(state.comments.items)).not.toMatch(/local-|"You"/);
    });

    it('puts a new comment at the top', () => {
        const existing = comment({ commentId: 'CMT-00001', text: 'Older.' });
        const fresh = comment({ commentId: 'CMT-00002', text: 'Newer.' });

        const state = reportFeedbackReducer(loaded({}, [existing]), {
            type: 'commentSucceeded',
            comment: fresh,
        });

        expect(state.comments.items.map((entry) => entry.text)).toEqual([
            'Newer.',
            'Older.',
        ]);
    });

    it('counts the new comment', () => {
        const state = reportFeedbackReducer(loaded(), {
            type: 'commentSucceeded',
            comment: comment(),
        });

        expect(commentCountLabelValue(state)).toBe(1);
    });

    it('says so when the comment did not send', () => {
        const state = reportFeedbackReducer(
            reportFeedbackReducer(loaded(), { type: 'commentStarted' }),
            { type: 'commentFailed' }
        );

        expect(state.submitError).toBe('Unable to post your comment. Please try again.');
        expect(state.isPostingComment).toBe(false);
        expect(state.comments.items).toEqual([]);
    });

    it('will not send an empty box or one holding only whitespace', () => {
        expect(shouldSendComment(loaded(), '')).toBe(false);
        expect(shouldSendComment(loaded(), '   \n ')).toBe(false);
        expect(shouldSendComment(loaded(), 'The lift was out of service.')).toBe(true);
    });
});

describe('mergeSubmittedComment', () => {
    it('never shows the same comment twice', () => {
        const stored = comment({ commentId: 'CMT-00003' });

        const merged = mergeSubmittedComment([stored], stored);

        expect(merged).toHaveLength(1);
    });

    it('leaves the list it was given alone', () => {
        const existing = [comment({ commentId: 'CMT-00001' })];

        mergeSubmittedComment(existing, comment({ commentId: 'CMT-00002' }));

        expect(existing).toHaveLength(1);
    });
});

describe('the messages a passenger can be shown', () => {
    it('are the four the section can produce', () => {
        expect(FEEDBACK_MESSAGES).toEqual({
            votesLoadFailed: 'Unable to load community feedback.',
            voteSubmitFailed: 'Unable to submit your feedback. Please try again.',
            commentsLoadFailed: 'Unable to load comments.',
            commentSubmitFailed: 'Unable to post your comment. Please try again.',
        });
    });
});
