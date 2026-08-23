// Community Feedback, end to end: the screen's state, the API client, and the
// route handlers, over one store.
//
// The other feedback specs each hold one side still — the routes are tested
// with hand-built Requests, the reducer with hand-built actions. This one wires
// them together and drives the exact sequence a passenger performs, because
// that is where an integration goes wrong: a body key the route does not read,
// a response field the client drops, a comment that renders from local state
// and disappears on reload.
//
// `fetch` here is the routes themselves rather than a canned reply, so nothing
// is asserted against a fixture of what the API is imagined to return. The
// store underneath is the in-memory Firestore stand-in the route specs use, so
// what is checked after each step is what was actually written.

import {
    GET as getComments,
    POST as postComment,
} from '../../../app/api/reports/[reportId]/comments+api';
import {
    GET as getVotes,
    POST as postVote,
} from '../../../app/api/reports/[reportId]/vote+api';
import {
    fetchReportComments,
    fetchReportVotes,
    submitReportComment,
    submitReportVote,
} from '../../../src/features/reports/api/reportFeedbackApi';
import {
    initialFeedbackState,
    reportFeedbackReducer,
    shouldSendVote,
} from '../../../src/features/reports/utils/reportFeedbackState';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const REPORT_ID = 'REP-00007';
const AUTHOR = 'PAS-2026-00001';
const VOTER = 'PAS-2026-00002';

/** The session token stands in for the signed-in passenger. */
const TOKEN = 'session-voter';

const SESSIONS: Record<string, Record<string, string>> = {
    [TOKEN]: {
        uid: 'UID-B',
        passengerId: VOTER,
        role: 'PASSENGER',
        email: 'voter@example.com',
    },
};

let db: any;

/**
 * `fetch`, answered by the route handlers.
 *
 * The URL decides which one, the same way Expo Router does, and the report id
 * is left in the path for the handler to read out of it — so a client that
 * builds the wrong path fails here rather than quietly hitting a stub.
 */
async function routeFetch(input: any, init: any = {}) {
    const url = String(input);
    const request = new Request(`http://localhost${url}`, init);

    const isComments = url.includes('/comments');
    const isPost = (init.method ?? 'GET') === 'POST';

    const handler = isComments
        ? isPost
            ? postComment
            : getComments
        : isPost
          ? postVote
          : getVotes;

    // No params object: the id has to survive the round trip in the path.
    return handler(request, {});
}

/** Every vote document in the store, whatever report it belongs to. */
async function storedVotes() {
    const snapshot = await db.collection('votes').get();

    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
}

async function storedComments() {
    const snapshot = await db.collection('comments').get();

    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
}

async function storedReport() {
    const doc = await db.collection('reports').doc(REPORT_ID).get();

    return doc.data();
}

/**
 * The section as the screen has it after opening the report.
 *
 * Exactly what CommunityFeedback does on mount: both halves asked for, each
 * dispatched as it lands.
 */
async function openReport() {
    let state = reportFeedbackReducer(initialFeedbackState, { type: 'loadStarted' });

    const votes = await fetchReportVotes(REPORT_ID, TOKEN);
    const comments = await fetchReportComments(REPORT_ID, TOKEN);

    state = votes.ok
        ? reportFeedbackReducer(state, { type: 'votesLoaded', votes: votes.value })
        : reportFeedbackReducer(state, { type: 'votesFailed' });

    state = comments.ok
        ? reportFeedbackReducer(state, { type: 'commentsLoaded', comments: comments.value })
        : reportFeedbackReducer(state, { type: 'commentsFailed' });

    return state;
}

/** One press on a vote pill, guard included. */
async function pressVote(state: any, choice: 'AGREE' | 'DISAGREE') {
    if (!shouldSendVote(state, choice)) return { state, sent: false };

    const started = reportFeedbackReducer(state, { type: 'voteStarted', vote: choice });
    const result = await submitReportVote(REPORT_ID, choice, TOKEN);

    return {
        state: result.ok
            ? reportFeedbackReducer(started, { type: 'voteSucceeded', votes: result.value })
            : reportFeedbackReducer(started, { type: 'voteFailed' }),
        sent: true,
    };
}

/** One press on Send. */
async function pressSend(state: any, draft: string) {
    const started = reportFeedbackReducer(state, { type: 'commentStarted' });
    const result = await submitReportComment(REPORT_ID, draft.trim(), TOKEN);

    return result.ok
        ? reportFeedbackReducer(started, { type: 'commentSucceeded', comment: result.value })
        : reportFeedbackReducer(started, { type: 'commentFailed' });
}

beforeEach(() => {
    jest.clearAllMocks();

    // The failure case below drives a rejected request on purpose; its log
    // line is expected output, not a signal.
    jest.spyOn(console, 'error').mockImplementation(() => {});

    db = createFakeFirestore({
        reports: [
            {
                id: REPORT_ID,
                reportId: REPORT_ID,
                passengerId: AUTHOR,
                issueCategory: 'BROKEN_RAMP',
                description: 'The wheelchair ramp would not fold down at Pettah station.',
                status: 'PENDING',
                createdAt: new Date('2026-08-20T14:05:00.000Z'),
                updatedAt: new Date('2026-08-20T14:05:00.000Z'),
            },
        ],
        votes: [],
        comments: [],
        users: [{ id: VOTER, passengerId: VOTER, userName: 'Kasun Silva' }],
    });

    mockGetAdminDb.mockImplementation(() => db);
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);

    global.fetch = routeFetch as unknown as typeof fetch;
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ==================================================================
// Opening a report nobody has answered
// ==================================================================
describe('opening a report', () => {
    it('shows no vote, no tallies and no comments — and none of them invented', async () => {
        const state = await openReport();

        expect(state.votes.status).toBe('ready');
        expect(state.votes.myVote).toBeNull();
        expect(state.votes.agreeCount).toBe(0);
        expect(state.votes.disagreeCount).toBe(0);

        expect(state.comments.status).toBe('ready');
        expect(state.comments.items).toEqual([]);
    });
});

// ==================================================================
// The sequence from the ticket: vote, change it, comment, reload
// ==================================================================
describe('a passenger voting and commenting', () => {
    it('writes a vote document when Agree is pressed', async () => {
        const opened = await openReport();

        const { state } = await pressVote(opened, 'AGREE');

        // On screen.
        expect(state.votes.myVote).toBe('AGREE');
        expect(state.votes.agreeCount).toBe(1);
        expect(state.votes.disagreeCount).toBe(0);

        // In the store.
        const votes = await storedVotes();

        expect(votes).toHaveLength(1);
        expect(votes[0]).toMatchObject({
            reportId: REPORT_ID,
            passengerId: VOTER,
            vote: 'AGREE',
        });
    });

    it('changes that same document rather than adding a second one', async () => {
        const opened = await openReport();

        const agreed = await pressVote(opened, 'AGREE');
        const [afterAgree] = await storedVotes();

        const changed = await pressVote(agreed.state, 'DISAGREE');
        const votes = await storedVotes();

        expect(votes).toHaveLength(1);
        expect(votes[0].id).toBe(afterAgree.id);
        expect(votes[0].vote).toBe('DISAGREE');

        expect(changed.state.votes.myVote).toBe('DISAGREE');
        expect(changed.state.votes.agreeCount).toBe(0);
        expect(changed.state.votes.disagreeCount).toBe(1);
    });

    it('sends nothing at all when the vote already held is pressed again', async () => {
        const opened = await openReport();
        const agreed = await pressVote(opened, 'AGREE');

        const again = await pressVote(agreed.state, 'AGREE');

        expect(again.sent).toBe(false);
        expect(await storedVotes()).toHaveLength(1);
        expect(again.state.votes.agreeCount).toBe(1);
    });

    it('writes a comment document when Send is pressed', async () => {
        const opened = await openReport();

        const state = await pressSend(opened, '  The ramp was not working properly.  ');

        const comments = await storedComments();

        expect(comments).toHaveLength(1);
        expect(comments[0]).toMatchObject({
            reportId: REPORT_ID,
            passengerId: VOTER,
            authorName: 'Kasun Silva',
            text: 'The ramp was not working properly.',
        });

        // What went on the list is that record, not a local stand-in for it.
        expect(state.comments.items[0].commentId).toBe(comments[0].commentId);
        expect(state.comments.items[0].authorName).toBe('Kasun Silva');
        expect(state.comments.items[0].text).toBe('The ramp was not working properly.');
    });

    it('shows the vote and the comment again after the screen is reopened', async () => {
        const opened = await openReport();
        const voted = await pressVote(opened, 'AGREE');
        const changed = await pressVote(voted.state, 'DISAGREE');

        await pressSend(changed.state, 'The ramp was not working properly.');

        // Everything the screen was holding is thrown away, and the section is
        // loaded again from the API — which is the check that none of it was
        // ever local state.
        const reopened = await openReport();

        expect(reopened.votes.myVote).toBe('DISAGREE');
        expect(reopened.votes.agreeCount).toBe(0);
        expect(reopened.votes.disagreeCount).toBe(1);

        expect(reopened.comments.items).toHaveLength(1);
        expect(reopened.comments.items[0]).toMatchObject({
            passengerId: VOTER,
            authorName: 'Kasun Silva',
            text: 'The ramp was not working properly.',
        });
    });

    it('leaves the passenger their words when the comment does not send', async () => {
        const opened = await openReport();

        // The route refuses it, so nothing is stored and the composer has
        // something to say about it.
        const state = await pressSend(opened, 'a'.repeat(301));

        expect(state.submitError).toBe('Unable to post your comment. Please try again.');
        expect(state.comments.items).toEqual([]);
        expect(await storedComments()).toHaveLength(0);
    });
});

// ==================================================================
// What the backend decides, and the app only reports
// ==================================================================
describe('the five-agree flag', () => {
    it('is raised by the backend and read back, never computed in the app', async () => {
        // Four other passengers have already agreed.
        for (const passengerId of [
            'PAS-2026-00010',
            'PAS-2026-00011',
            'PAS-2026-00012',
            'PAS-2026-00013',
        ]) {
            await db
                .collection('votes')
                .doc(`${REPORT_ID}__${passengerId}`)
                .set({ reportId: REPORT_ID, passengerId, vote: 'AGREE' });
        }

        const opened = await openReport();

        // Four agreements, and nothing flagged yet.
        expect(opened.votes.agreeCount).toBe(4);
        expect(opened.votes.requiresAdminReview).toBe(false);

        const { state } = await pressVote(opened, 'AGREE');

        expect(state.votes.agreeCount).toBe(5);
        expect(state.votes.requiresAdminReview).toBe(true);

        const report = await storedReport();

        expect(report.requiresAdminReview).toBe(true);

        // The report's own status is the admin's to change, and voting does
        // not touch it.
        expect(report.status).toBe('PENDING');
    });
});

// ==================================================================
// When the API cannot be reached
// ==================================================================
describe('when the feedback endpoints fail', () => {
    it('says so in the section without taking the report page with it', async () => {
        global.fetch = jest
            .fn()
            .mockRejectedValue(new Error('Network request failed')) as unknown as typeof fetch;

        const state = await openReport();

        expect(state.votes.status).toBe('failed');
        expect(state.comments.status).toBe('failed');

        // No tallies and no comments are shown in place of the ones that could
        // not be read.
        expect(state.votes.agreeCount).toBe(0);
        expect(state.comments.items).toEqual([]);
    });
});
