// Replies and photos on the report comment thread.
//
// A reply is a comment with a `parentCommentId`: it must answer a top-level
// comment under the same report (one level deep), and a photo is a Cloudinary
// URL the app already uploaded — never bytes. Deleting a comment that others
// have replied to must not delete their replies, so it becomes a placeholder
// until the last reply under it goes.

import {
    DELETE as deleteComment,
    PATCH as editComment,
} from '../../../app/api/reports/[reportId]/comments/[commentId]+api';
import {
    GET as getComments,
    POST as addComment,
} from '../../../app/api/reports/[reportId]/comments+api';
import { GET as getReports } from '../../../app/api/reports/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

const REPORT_ID = 'REP-00007';
const OTHER_REPORT_ID = 'REP-00008';
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');

const AUTHOR = 'PAS-2026-00001';
const NEIGHBOUR = 'PAS-2026-00002';
const STRANGER = 'PAS-2026-00003';

const PHOTO_URL = 'https://res.cloudinary.com/moveable/image/upload/v1/comments/ramp.jpg';

function session(passengerId: string) {
    return { uid: `UID-${passengerId}`, passengerId, role: 'PASSENGER', email: '' };
}

const SESSIONS: Record<string, Record<string, string>> = {
    [AUTHOR]: session(AUTHOR),
    [NEIGHBOUR]: session(NEIGHBOUR),
    [STRANGER]: session(STRANGER),
};

function storedReport(reportId: string) {
    return {
        id: reportId,
        reportId,
        passengerId: AUTHOR,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'VERIFIED',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
    };
}

function seed() {
    const db = createFakeFirestore({
        reports: [storedReport(REPORT_ID), storedReport(OTHER_REPORT_ID)],
        comments: [],
        users: [
            { id: AUTHOR, passengerId: AUTHOR, userName: 'Nimali Perera' },
            { id: NEIGHBOUR, passengerId: NEIGHBOUR, userName: 'Kasun Silva' },
        ],
        votes: [],
    });

    mockGetAdminDb.mockReturnValue(db);

    return db;
}

function jsonRequest(url: string, method: string, token?: string, body?: unknown): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (token) headers.Authorization = `Bearer ${token}`;

    return new Request(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function post(token: string, body: Record<string, unknown>, reportId: string = REPORT_ID) {
    const response = await addComment(
        jsonRequest(`http://localhost/api/reports/${reportId}/comments`, 'POST', token, body),
        { params: { reportId } }
    );

    return { response, body: await response.json() };
}

async function list(token: string, reportId: string = REPORT_ID) {
    const response = await getComments(
        jsonRequest(`http://localhost/api/reports/${reportId}/comments`, 'GET', token),
        { params: { reportId } }
    );

    return { response, body: await response.json() };
}

async function remove(token: string, commentId: string, reportId: string = REPORT_ID) {
    const response = await deleteComment(
        jsonRequest(`http://localhost/api/reports/${reportId}/comments/${commentId}`, 'DELETE', token),
        { params: { reportId, commentId } }
    );

    return { response, body: await response.json() };
}

async function stored(db: any, commentId: string) {
    const doc = await db.collection('comments').doc(commentId).get();

    return doc.exists ? doc.data() : null;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ==================================================================
// Photos
// ==================================================================
describe('POST comments - photos', () => {
    it('stores the uploaded photo URL with the comment', async () => {
        const db = seed();

        const { response, body } = await post(NEIGHBOUR, {
            comment: 'The ramp was blocked.',
            imageUrl: PHOTO_URL,
        });

        expect(response.status).toBe(201);
        expect(body.comment).toMatchObject({ text: 'The ramp was blocked.', imageUrl: PHOTO_URL });
        expect(await stored(db, body.comment.commentId)).toMatchObject({
            imageUrl: PHOTO_URL,
            parentCommentId: null,
            updatedAt: expect.any(String),
        });
    });

    it('accepts a photo with no text', async () => {
        seed();

        const { response, body } = await post(NEIGHBOUR, { imageUrl: PHOTO_URL });

        expect(response.status).toBe(201);
        expect(body.comment.text).toBe('');
        expect(body.comment.imageUrl).toBe(PHOTO_URL);
    });

    it('refuses a comment with neither text nor a photo', async () => {
        seed();

        const { response, body } = await post(NEIGHBOUR, { comment: '   ' });

        expect(response.status).toBe(400);
        expect(body.message).toMatch(/comment or attach a photo/i);
    });

    it.each([
        ['a local file uri', 'file:///data/user/0/photo.jpg'],
        ['plain http', 'http://res.cloudinary.com/moveable/image/upload/a.jpg'],
        ['another host', 'https://example.com/a.jpg'],
        ['not a string', 42],
    ])('refuses %s as the photo', async (_label, imageUrl) => {
        const db = seed();

        const { response } = await post(NEIGHBOUR, { comment: 'Look.', imageUrl });

        expect(response.status).toBe(400);
        expect((await db.collection('comments').get()).docs).toHaveLength(0);
    });

    it('omits imageUrl from a comment without one', async () => {
        seed();

        const { body } = await post(NEIGHBOUR, { comment: 'Plain words.' });

        expect(body.comment).not.toHaveProperty('imageUrl');
        expect(body.comment).not.toHaveProperty('parentCommentId');
    });
});

// ==================================================================
// Replies
// ==================================================================
describe('POST comments - replies', () => {
    it('stores a reply under a top-level comment of the same report', async () => {
        const db = seed();
        const parent = await post(NEIGHBOUR, { comment: 'The ramp was blocked.' });

        const { response, body } = await post(AUTHOR, {
            comment: 'I experienced the same issue yesterday.',
            imageUrl: PHOTO_URL,
            parentCommentId: parent.body.comment.commentId,
        });

        expect(response.status).toBe(201);
        expect(body.message).toBe('Reply added.');
        expect(body.comment).toMatchObject({
            parentCommentId: parent.body.comment.commentId,
            reportId: REPORT_ID,
            passengerId: AUTHOR,
            authorName: 'Nimali Perera',
            imageUrl: PHOTO_URL,
        });
        expect((await stored(db, body.comment.commentId)).parentCommentId).toBe(
            parent.body.comment.commentId
        );
    });

    it('refuses a reply to a comment under another report, as not found', async () => {
        seed();
        const elsewhere = await post(NEIGHBOUR, { comment: 'Other report.' }, OTHER_REPORT_ID);

        const { response } = await post(AUTHOR, {
            comment: 'Crossing reports.',
            parentCommentId: elsewhere.body.comment.commentId,
        });

        expect(response.status).toBe(404);
    });

    it('refuses a reply to a comment that does not exist', async () => {
        seed();

        const { response } = await post(AUTHOR, { comment: 'Hello?', parentCommentId: 'CMT-99999' });

        expect(response.status).toBe(404);
    });

    it('refuses a reply to a reply — one level only', async () => {
        seed();
        const parent = await post(NEIGHBOUR, { comment: 'Top.' });
        const reply = await post(AUTHOR, {
            comment: 'First reply.',
            parentCommentId: parent.body.comment.commentId,
        });

        const { response, body } = await post(STRANGER, {
            comment: 'Nested.',
            parentCommentId: reply.body.comment.commentId,
        });

        expect(response.status).toBe(400);
        expect(body.message).toMatch(/top-level/i);
    });

    it('never takes the author from the body', async () => {
        seed();
        const parent = await post(NEIGHBOUR, { comment: 'Top.' });

        const { body } = await post(STRANGER, {
            comment: 'Pretending.',
            parentCommentId: parent.body.comment.commentId,
            passengerId: AUTHOR,
            authorName: 'Nimali Perera',
        });

        expect(body.comment.passengerId).toBe(STRANGER);
        expect(body.comment.authorName).toBe('Passenger');
    });

    it("returns this report's comments and replies only", async () => {
        seed();
        const parent = await post(NEIGHBOUR, { comment: 'Top.' });
        await post(AUTHOR, { comment: 'Reply.', parentCommentId: parent.body.comment.commentId });
        await post(NEIGHBOUR, { comment: 'Elsewhere.' }, OTHER_REPORT_ID);

        const { body } = await list(STRANGER);

        expect(body.comments.map((entry: any) => entry.text).sort()).toEqual(['Reply.', 'Top.']);
        expect(body.comments.every((entry: any) => entry.reportId === REPORT_ID)).toBe(true);
    });
});

// ==================================================================
// Deleting inside a thread
// ==================================================================
describe('DELETE comments - thread rules', () => {
    async function thread() {
        const db = seed();
        const parent = await post(NEIGHBOUR, { comment: 'Top.', imageUrl: PHOTO_URL });
        const reply = await post(AUTHOR, {
            comment: 'Reply.',
            parentCommentId: parent.body.comment.commentId,
        });

        return {
            db,
            parentId: parent.body.comment.commentId as string,
            replyId: reply.body.comment.commentId as string,
        };
    }

    it("keeps other passengers' replies when a replied-to comment is deleted", async () => {
        const { db, parentId, replyId } = await thread();

        const { response, body } = await remove(NEIGHBOUR, parentId);

        expect(response.status).toBe(200);
        expect(body.comment).toMatchObject({ commentId: parentId, deleted: true, text: '' });
        expect(body.comment).not.toHaveProperty('imageUrl');

        expect(await stored(db, parentId)).toMatchObject({ deleted: true, text: '', imageUrl: null });
        expect(await stored(db, replyId)).not.toBeNull();
    });

    it('removes the placeholder along with its last reply', async () => {
        const { db, parentId, replyId } = await thread();
        await remove(NEIGHBOUR, parentId);

        const { body } = await remove(AUTHOR, replyId);

        expect(body.alsoRemovedCommentIds).toEqual([parentId]);
        expect(await stored(db, replyId)).toBeNull();
        expect(await stored(db, parentId)).toBeNull();
    });

    it("refuses to let another passenger delete someone's reply", async () => {
        const { db, replyId } = await thread();

        const { response } = await remove(STRANGER, replyId);

        expect(response.status).toBe(403);
        expect(await stored(db, replyId)).not.toBeNull();
    });

    it('lets a reply author delete their reply, leaving the parent alone', async () => {
        const { db, parentId, replyId } = await thread();

        const { response, body } = await remove(AUTHOR, replyId);

        expect(response.status).toBe(200);
        expect(body).not.toHaveProperty('alsoRemovedCommentIds');
        expect(await stored(db, parentId)).toMatchObject({ text: 'Top.' });
    });

    it('treats a placeholder as gone: no edit, no second delete, no new replies', async () => {
        const { parentId } = await thread();
        await remove(NEIGHBOUR, parentId);

        const edited = await editComment(
            jsonRequest(
                `http://localhost/api/reports/${REPORT_ID}/comments/${parentId}`,
                'PATCH',
                NEIGHBOUR,
                { comment: 'Back again.' }
            ),
            { params: { reportId: REPORT_ID, commentId: parentId } }
        );
        const again = await remove(NEIGHBOUR, parentId);
        const reply = await post(STRANGER, { comment: 'Late.', parentCommentId: parentId });

        expect(edited.status).toBe(404);
        expect(again.response.status).toBe(404);
        expect(reply.response.status).toBe(400);
    });

    it('does not count a placeholder on the report list', async () => {
        const { parentId } = await thread();
        await remove(NEIGHBOUR, parentId);

        const response = await getReports(
            jsonRequest('http://localhost/api/reports?scope=all', 'GET', STRANGER)
        );
        const body = await response.json();
        const report = body.reports.find((entry: any) => entry.reportId === REPORT_ID);

        expect(report.commentCount).toBe(1);
    });
});
