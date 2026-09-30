// PATCH and DELETE /api/reports/[reportId]/comments/[commentId] — managing one
// comment (MOV-306, MOV-304 AC7).
//
// A comment belongs to the passenger who wrote it: they may reword it or take
// it back, while they can still see the report. An admin may remove any
// comment, which is the moderation the thread otherwise lacks — but does not
// rewrite what a passenger said. Nobody else may do either, and a comment is
// only ever reached through the report it was written under.

import {
    DELETE as deleteComment,
    OPTIONS as commentOptions,
    PATCH as editComment,
} from '../../../app/api/reports/[reportId]/comments/[commentId]+api';
import { GET as getComments } from '../../../app/api/reports/[reportId]/comments+api';
import { GET as getReports } from '../../../app/api/reports/index+api';
import { MAX_REPORT_COMMENT_LENGTH } from '../../../src/entities/report/model/types';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Sessions
// ------------------------------------------------------------------
const REPORT_AUTHOR = 'PAS-2026-00001';
const COMMENTER = 'PAS-2026-00002';
const STRANGER = 'PAS-2026-00003';
const BUS_ID = 'BUS-0001';

const REPORT_AUTHOR_SESSION = 'session-report-author';
const COMMENTER_SESSION = 'session-commenter';
const STRANGER_SESSION = 'session-stranger';
const ADMIN_SESSION = 'session-admin';
const BUS_SESSION = 'session-bus';
const JOURNEY_SESSION = 'session-journey';

const SESSIONS: Record<string, Record<string, string>> = {
    [REPORT_AUTHOR_SESSION]: {
        uid: 'UID-A',
        passengerId: REPORT_AUTHOR,
        role: 'PASSENGER',
        email: 'author@example.com',
    },
    [COMMENTER_SESSION]: {
        uid: 'UID-B',
        passengerId: COMMENTER,
        role: 'PASSENGER',
        email: 'commenter@example.com',
    },
    [STRANGER_SESSION]: {
        uid: 'UID-C',
        passengerId: STRANGER,
        role: 'PASSENGER',
        email: 'stranger@example.com',
    },
    [ADMIN_SESSION]: {
        uid: 'UID-ADMIN',
        passengerId: 'ADM-0001',
        role: 'ADMIN',
        email: 'admin@example.com',
    },
    [BUS_SESSION]: {
        uid: BUS_ID,
        passengerId: '',
        role: 'BUS',
        email: '',
        busId: BUS_ID,
    },
    [JOURNEY_SESSION]: {
        uid: BUS_ID,
        // A journey-sharing credential carries the bus id where a passenger's
        // would be — so a comment "by" that id must still not be the bus's.
        passengerId: BUS_ID,
        role: 'BUS',
        email: '',
        busId: BUS_ID,
        scope: 'JOURNEY_LOCATION',
    },
};

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');
const WRITTEN_AT = '2026-08-21T08:00:00.000Z';

const REPORT_ID = 'REP-00007';
const OTHER_REPORT_ID = 'REP-00008';
const POSITIVE_ID = 'REP-00009';
/** Rejected: its author still sees it, other passengers no longer do. */
const REJECTED_ID = 'REP-00010';

const COMMENT_ID = 'CMT-00001';
const OTHER_REPORT_COMMENT_ID = 'CMT-00002';
const SECOND_COMMENT_ID = 'CMT-00003';
const POSITIVE_COMMENT_ID = 'CMT-00004';
const REJECTED_COMMENT_ID = 'CMT-00005';
/** Written by the bus id — how a journey credential could have claimed one. */
const BUS_ID_COMMENT_ID = 'CMT-00006';

function report(reportId: string, overrides: Record<string, any> = {}) {
    return {
        id: reportId,
        reportId,
        passengerId: REPORT_AUTHOR,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'VERIFIED',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

function storedComment(
    commentId: string,
    reportId: string,
    passengerId: string,
    text = 'Same thing happened to me on Monday.'
) {
    return {
        id: commentId,
        commentId,
        reportId,
        passengerId,
        authorName: 'Kasun Silva',
        text,
        createdAt: WRITTEN_AT,
    };
}

function seededFirestore() {
    const db = createFakeFirestore({
        reports: [
            report(REPORT_ID),
            report(OTHER_REPORT_ID),
            report(POSITIVE_ID, {
                type: 'POSITIVE',
                category: 'HELPFUL_DRIVER',
                issueCategory: undefined,
                status: 'PUBLISHED',
            }),
            report(REJECTED_ID, { status: 'REJECTED' }),
        ],
        comments: [
            storedComment(COMMENT_ID, REPORT_ID, COMMENTER),
            storedComment(OTHER_REPORT_COMMENT_ID, OTHER_REPORT_ID, COMMENTER),
            storedComment(SECOND_COMMENT_ID, REPORT_ID, STRANGER, 'I saw it too.'),
            storedComment(POSITIVE_COMMENT_ID, POSITIVE_ID, COMMENTER, 'Same driver!'),
            storedComment(REJECTED_COMMENT_ID, REJECTED_ID, COMMENTER, 'Was it fixed?'),
            storedComment(BUS_ID_COMMENT_ID, REPORT_ID, BUS_ID, 'Written before the rule.'),
        ],
        votes: [],
    });

    mockGetAdminDb.mockReturnValue(db);

    return db;
}

function request(
    method: string,
    options: { token?: string; body?: unknown; rawBody?: string; reportId?: string; commentId?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    let body: string | undefined;

    if (options.rawBody !== undefined) body = options.rawBody;
    else if (options.body !== undefined) body = JSON.stringify(options.body);

    return new Request(
        `http://localhost/api/reports/${options.reportId ?? REPORT_ID}/comments/${options.commentId ?? COMMENT_ID}`,
        { method, headers, ...(body === undefined ? {} : { body }) }
    );
}

function params(reportId: string = REPORT_ID, commentId: string = COMMENT_ID) {
    return { params: { reportId, commentId } };
}

async function edit(
    token: string | undefined,
    body: unknown,
    reportId: string = REPORT_ID,
    commentId: string = COMMENT_ID
) {
    const response = await editComment(
        request('PATCH', { token, body, reportId, commentId }),
        params(reportId, commentId)
    );

    return { response, body: await response.json() };
}

async function remove(
    token: string | undefined,
    reportId: string = REPORT_ID,
    commentId: string = COMMENT_ID
) {
    const response = await deleteComment(
        request('DELETE', { token, reportId, commentId }),
        params(reportId, commentId)
    );

    return { response, body: await response.json() };
}

async function storedCommentDoc(db: any, commentId: string = COMMENT_ID) {
    const doc = await db.collection('comments').doc(commentId).get();

    return doc.exists ? doc.data() : null;
}

async function allComments(db: any) {
    const snapshot = await db.collection('comments').get();

    return snapshot.docs.map((doc: any) => doc.data());
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// CORS
// ==================================================================
describe('/api/reports/[reportId]/comments/[commentId] - CORS', () => {
    it('advertises PATCH and DELETE on the preflight', async () => {
        const response = await commentOptions();

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('PATCH, DELETE, OPTIONS');
    });

    it('sends the same headers on a success and on a refusal', async () => {
        seededFirestore();

        const ok = await edit(COMMENTER_SESSION, { comment: 'Reworded.' });
        const refused = await edit(STRANGER_SESSION, { comment: 'Not mine.' });

        expect(ok.response.headers.get('Access-Control-Allow-Methods')).toBe('PATCH, DELETE, OPTIONS');
        expect(refused.response.headers.get('Access-Control-Allow-Methods')).toBe('PATCH, DELETE, OPTIONS');
    });
});

// ==================================================================
// Authentication
// ==================================================================
describe('/api/reports/[reportId]/comments/[commentId] - authentication', () => {
    it('refuses an edit without a token', async () => {
        const db = seededFirestore();

        const { response } = await edit(undefined, { comment: 'Reworded.' });

        expect(response.status).toBe(401);
        expect((await storedCommentDoc(db)).text).toBe('Same thing happened to me on Monday.');
    });

    it('refuses a delete without a token', async () => {
        const db = seededFirestore();

        const { response } = await remove(undefined);

        expect(response.status).toBe(401);
        expect(await storedCommentDoc(db)).not.toBeNull();
    });

    it('refuses a token that does not verify', async () => {
        seededFirestore();

        const { response } = await remove('not-a-session');

        expect(response.status).toBe(401);
    });
});

// ==================================================================
// PATCH — the author rewords their own comment
// ==================================================================
describe('PATCH - the comment author', () => {
    it('saves the new text and hands back the stored comment', async () => {
        const db = seededFirestore();

        const { response, body } = await edit(COMMENTER_SESSION, { comment: 'It was the rear ramp.' });

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.comment).toEqual({
            commentId: COMMENT_ID,
            reportId: REPORT_ID,
            passengerId: COMMENTER,
            authorName: 'Kasun Silva',
            text: 'It was the rear ramp.',
            createdAt: WRITTEN_AT,
            editedAt: expect.any(String),
        });
        expect((await storedCommentDoc(db)).text).toBe('It was the rear ramp.');
    });

    it('stamps editedAt on the server as an ISO date', async () => {
        const db = seededFirestore();
        const before = Date.now();

        const { body } = await edit(COMMENTER_SESSION, { comment: 'Reworded.' });

        const stored = await storedCommentDoc(db);

        expect(stored.editedAt).toBe(body.comment.editedAt);
        expect(new Date(stored.editedAt).toISOString()).toBe(stored.editedAt);
        expect(new Date(stored.editedAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('updates only text and editedAt, leaving every other field as it was', async () => {
        const db = seededFirestore();
        const before = { ...(await storedCommentDoc(db)) };

        await edit(COMMENTER_SESSION, {
            comment: 'Reworded.',
            passengerId: STRANGER,
            reportId: OTHER_REPORT_ID,
            authorName: 'Somebody Else',
            createdAt: '2020-01-01T00:00:00.000Z',
            commentId: 'CMT-99999',
            editedAt: '2020-01-01T00:00:00.000Z',
        });

        const after = await storedCommentDoc(db);
        const { text: _t, editedAt: _e, ...unchanged } = after;
        const { text: _bt, ...beforeUnchanged } = before;

        expect(unchanged).toEqual(beforeUnchanged);
        expect(after.editedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('writes the edit as a partial update naming only text and editedAt', async () => {
        const db = seededFirestore();
        const collection = db.collection;

        await edit(COMMENTER_SESSION, { comment: 'Reworded.' });

        const commentsCollection = collection.mock.results
            .filter((_result: any, index: number) => collection.mock.calls[index][0] === 'comments')
            .map((result: any) => result.value);
        const updates = commentsCollection
            .flatMap((col: any) => col.doc.mock.results.map((result: any) => result.value))
            .flatMap((ref: any) => ref.update.mock.calls.map((call: any[]) => call[0]));

        expect(updates).toHaveLength(1);
        expect(Object.keys(updates[0]).sort()).toEqual(['editedAt', 'text']);
    });

    it('trims the new text', async () => {
        const db = seededFirestore();

        await edit(COMMENTER_SESSION, { comment: '   Reworded.   ' });

        expect((await storedCommentDoc(db)).text).toBe('Reworded.');
    });

    it('accepts text of exactly the maximum length', async () => {
        seededFirestore();

        const { response } = await edit(COMMENTER_SESSION, {
            comment: 'x'.repeat(MAX_REPORT_COMMENT_LENGTH),
        });

        expect(response.status).toBe(200);
    });

    it('shows the edit in the thread, marked as edited', async () => {
        seededFirestore();

        await edit(COMMENTER_SESSION, { comment: 'Reworded.' });

        const response = await getComments(
            new Request(`http://localhost/api/reports/${REPORT_ID}/comments`, {
                headers: { Authorization: `Bearer ${STRANGER_SESSION}` },
            }),
            { params: { reportId: REPORT_ID } }
        );
        const body = await response.json();
        const edited = body.comments.find((entry: any) => entry.commentId === COMMENT_ID);
        const untouched = body.comments.find((entry: any) => entry.commentId === SECOND_COMMENT_ID);

        expect(edited.text).toBe('Reworded.');
        expect(edited.editedAt).toEqual(expect.any(String));
        expect(untouched).not.toHaveProperty('editedAt');
    });

    it('lets the author edit their comment on positive feedback', async () => {
        seededFirestore();

        const { response } = await edit(
            COMMENTER_SESSION,
            { comment: 'Same driver, twice now.' },
            POSITIVE_ID,
            POSITIVE_COMMENT_ID
        );

        expect(response.status).toBe(200);
    });

    it('reads the ids from the path when no params are given', async () => {
        const db = seededFirestore();

        const response = await editComment(
            request('PATCH', { token: COMMENTER_SESSION, body: { comment: 'From the path.' } }),
            {}
        );

        expect(response.status).toBe(200);
        expect((await storedCommentDoc(db)).text).toBe('From the path.');
    });
});

describe('PATCH - validation', () => {
    it.each([
        ['an empty comment', { comment: '' }, 'Comment cannot be empty.'],
        ['a whitespace-only comment', { comment: '    ' }, 'Comment cannot be empty.'],
        ['a missing comment', {}, 'Comment cannot be empty.'],
        ['a comment that is not text', { comment: 42 }, 'Comment cannot be empty.'],
        [
            'a comment over the maximum length',
            { comment: 'x'.repeat(MAX_REPORT_COMMENT_LENGTH + 1) },
            `A comment can be at most ${MAX_REPORT_COMMENT_LENGTH} characters.`,
        ],
    ])('refuses %s with 400 and changes nothing', async (_label, body, message) => {
        const db = seededFirestore();
        const before = { ...(await storedCommentDoc(db)) };

        const { response, body: json } = await edit(COMMENTER_SESSION, body);

        expect(response.status).toBe(400);
        expect(json.message).toBe(message);
        expect(await storedCommentDoc(db)).toEqual(before);
    });

    it('measures the length after trimming', async () => {
        seededFirestore();

        const { response } = await edit(COMMENTER_SESSION, {
            comment: `  ${'x'.repeat(MAX_REPORT_COMMENT_LENGTH)}  `,
        });

        expect(response.status).toBe(200);
    });

    it('refuses a body that is a list', async () => {
        seededFirestore();

        const { response, body } = await edit(COMMENTER_SESSION, [{ comment: 'A list.' }]);

        expect(response.status).toBe(400);
        expect(body.message).toBe('Invalid request body.');
    });

    it('refuses a body that is not JSON', async () => {
        seededFirestore();

        const response = await editComment(
            request('PATCH', { token: COMMENTER_SESSION, rawBody: 'not json' }),
            params()
        );

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('Invalid request body.');
    });
});

describe('PATCH - anybody but the author', () => {
    it('refuses another passenger with 403 and changes nothing', async () => {
        const db = seededFirestore();

        const { response, body } = await edit(STRANGER_SESSION, { comment: 'Put words in their mouth.' });

        expect(response.status).toBe(403);
        expect(body.message).toBe('You can only edit your own comments.');
        expect((await storedCommentDoc(db)).text).toBe('Same thing happened to me on Monday.');
    });

    it('refuses the author of the report too — the comment is not theirs', async () => {
        seededFirestore();

        const { response } = await edit(REPORT_AUTHOR_SESSION, { comment: 'My report, my thread?' });

        expect(response.status).toBe(403);
    });

    it('refuses an admin: moderation removes a comment, it does not reword one', async () => {
        const db = seededFirestore();

        const { response } = await edit(ADMIN_SESSION, { comment: 'Edited by an admin.' });

        expect(response.status).toBe(403);
        expect((await storedCommentDoc(db)).text).toBe('Same thing happened to me on Monday.');
    });

    it('refuses a bus device session', async () => {
        seededFirestore();

        const { response } = await edit(BUS_SESSION, { comment: 'From the bus.' });

        expect(response.status).toBe(403);
    });

    it('refuses a journey-sharing credential, even on a comment stored under its bus id', async () => {
        const db = seededFirestore();

        const { response } = await edit(
            JOURNEY_SESSION,
            { comment: 'Rewritten by the bus.' },
            REPORT_ID,
            BUS_ID_COMMENT_ID
        );

        expect(response.status).toBe(403);
        expect((await storedCommentDoc(db, BUS_ID_COMMENT_ID)).text).toBe('Written before the rule.');
    });
});

// ==================================================================
// DELETE — the author takes a comment back; an admin moderates
// ==================================================================
describe('DELETE - the comment author', () => {
    it('removes their own comment', async () => {
        const db = seededFirestore();

        const { response, body } = await remove(COMMENTER_SESSION);

        expect(response.status).toBe(200);
        expect(body).toEqual({ success: true, message: 'Comment deleted.', commentId: COMMENT_ID });
        expect(await storedCommentDoc(db)).toBeNull();
    });

    it('removes only that comment', async () => {
        const db = seededFirestore();
        const before = (await allComments(db)).map((entry: any) => entry.commentId);

        await remove(COMMENTER_SESSION);

        const after = (await allComments(db)).map((entry: any) => entry.commentId);

        expect(after).toEqual(before.filter((id: string) => id !== COMMENT_ID));
    });

    it('drops the comment from the thread and from the report list count', async () => {
        seededFirestore();

        const listBefore = await (
            await getReports(
                new Request('http://localhost/api/reports?scope=all', {
                    headers: { Authorization: `Bearer ${STRANGER_SESSION}` },
                })
            )
        ).json();

        await remove(COMMENTER_SESSION);

        const thread = await (
            await getComments(
                new Request(`http://localhost/api/reports/${REPORT_ID}/comments`, {
                    headers: { Authorization: `Bearer ${STRANGER_SESSION}` },
                }),
                { params: { reportId: REPORT_ID } }
            )
        ).json();
        const listAfter = await (
            await getReports(
                new Request('http://localhost/api/reports?scope=all', {
                    headers: { Authorization: `Bearer ${STRANGER_SESSION}` },
                })
            )
        ).json();

        const countOf = (list: any) =>
            list.reports.find((entry: any) => entry.reportId === REPORT_ID).commentCount;

        expect(thread.comments.map((entry: any) => entry.commentId)).not.toContain(COMMENT_ID);
        expect(countOf(listAfter)).toBe(countOf(listBefore) - 1);
    });

    it('lets the author remove their comment on positive feedback', async () => {
        const db = seededFirestore();

        const { response } = await remove(COMMENTER_SESSION, POSITIVE_ID, POSITIVE_COMMENT_ID);

        expect(response.status).toBe(200);
        expect(await storedCommentDoc(db, POSITIVE_COMMENT_ID)).toBeNull();
    });

    it('leaves the report itself untouched', async () => {
        const db = seededFirestore();
        const before = { ...(await db.collection('reports').doc(REPORT_ID).get()).data() };

        await remove(COMMENTER_SESSION);

        expect((await db.collection('reports').doc(REPORT_ID).get()).data()).toEqual(before);
    });
});

describe('DELETE - an admin', () => {
    it('removes any passenger’s comment', async () => {
        const db = seededFirestore();

        const { response, body } = await remove(ADMIN_SESSION);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(await storedCommentDoc(db)).toBeNull();
    });

    it('removes a comment on a report no passenger but its author can see', async () => {
        const db = seededFirestore();

        const { response } = await remove(ADMIN_SESSION, REJECTED_ID, REJECTED_COMMENT_ID);

        expect(response.status).toBe(200);
        expect(await storedCommentDoc(db, REJECTED_COMMENT_ID)).toBeNull();
    });
});

describe('DELETE - anybody else', () => {
    it('refuses another passenger with 403 and keeps the comment', async () => {
        const db = seededFirestore();

        const { response, body } = await remove(STRANGER_SESSION);

        expect(response.status).toBe(403);
        expect(body.message).toBe('You can only delete your own comments.');
        expect(await storedCommentDoc(db)).not.toBeNull();
    });

    it('refuses the author of the report', async () => {
        const db = seededFirestore();

        const { response } = await remove(REPORT_AUTHOR_SESSION);

        expect(response.status).toBe(403);
        expect(await storedCommentDoc(db)).not.toBeNull();
    });

    it('refuses a bus device session', async () => {
        const db = seededFirestore();

        const { response } = await remove(BUS_SESSION);

        expect(response.status).toBe(403);
        expect(await storedCommentDoc(db)).not.toBeNull();
    });

    it('refuses a journey-sharing credential, even on a comment stored under its bus id', async () => {
        const db = seededFirestore();

        const { response } = await remove(JOURNEY_SESSION, REPORT_ID, BUS_ID_COMMENT_ID);

        expect(response.status).toBe(403);
        expect(await storedCommentDoc(db, BUS_ID_COMMENT_ID)).not.toBeNull();
    });
});

// ==================================================================
// Where permitted — the report and the comment have to line up
// ==================================================================
describe('PATCH and DELETE - which comment is being addressed', () => {
    it('answers 404 for a comment that does not exist', async () => {
        seededFirestore();

        const patched = await edit(COMMENTER_SESSION, { comment: 'Reworded.' }, REPORT_ID, 'CMT-99999');
        const removed = await remove(ADMIN_SESSION, REPORT_ID, 'CMT-99999');

        expect(patched.response.status).toBe(404);
        expect(patched.body.message).toBe('Comment not found.');
        expect(removed.response.status).toBe(404);
    });

    it('answers 404 for a comment that belongs to another report, and touches neither', async () => {
        const db = seededFirestore();

        // CMT-00002 is the commenter's own — but it was written under REP-00008.
        const patched = await edit(
            COMMENTER_SESSION,
            { comment: 'Through the wrong report.' },
            REPORT_ID,
            OTHER_REPORT_COMMENT_ID
        );
        const removed = await remove(ADMIN_SESSION, REPORT_ID, OTHER_REPORT_COMMENT_ID);

        expect(patched.response.status).toBe(404);
        expect(removed.response.status).toBe(404);

        const stored = await storedCommentDoc(db, OTHER_REPORT_COMMENT_ID);

        expect(stored).not.toBeNull();
        expect(stored.text).toBe('Same thing happened to me on Monday.');
    });

    it('answers 404 for a report that does not exist', async () => {
        seededFirestore();

        const { response, body } = await edit(COMMENTER_SESSION, { comment: 'Reworded.' }, 'REP-99999');

        expect(response.status).toBe(404);
        expect(body.message).toBe('Report not found.');
    });

    it('answers 404 once the report is no longer visible to the comment author', async () => {
        // A rejected issue leaves the public feed; a passenger who commented on
        // it while it was verified can no longer reach it, or its thread.
        const db = seededFirestore();

        const patched = await edit(
            COMMENTER_SESSION,
            { comment: 'Reworded.' },
            REJECTED_ID,
            REJECTED_COMMENT_ID
        );
        const removed = await remove(COMMENTER_SESSION, REJECTED_ID, REJECTED_COMMENT_ID);

        expect(patched.response.status).toBe(404);
        expect(removed.response.status).toBe(404);
        expect(await storedCommentDoc(db, REJECTED_COMMENT_ID)).not.toBeNull();
    });

    it('answers 400 when no comment id reaches the handler', async () => {
        seededFirestore();

        const response = await deleteComment(
            new Request(`http://localhost/api/reports/${REPORT_ID}/comments`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${COMMENTER_SESSION}` },
            }),
            { params: { reportId: REPORT_ID } }
        );

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('Comment ID is required.');
    });
});

// ==================================================================
// Failures
// ==================================================================
describe('PATCH and DELETE - failures', () => {
    it('answers 500 without the underlying error when the store fails', async () => {
        mockGetAdminDb.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
                })),
            })),
        });

        const { response, body } = await remove(COMMENTER_SESSION);

        expect(response.status).toBe(500);
        expect(body).toEqual({ success: false, message: 'Failed to delete the comment.' });
    });
});
