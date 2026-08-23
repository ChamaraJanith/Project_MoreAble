// POST and GET /api/reports/[reportId]/comments — the thread under a report.
//
// A comment is attributed to whoever actually sent the request: the passenger
// comes off the verified token, never off the body, so a comment cannot be put
// in somebody else's mouth. The rest is what makes a thread readable — nothing
// blank in it, nothing longer than the composer allows, and newest first.

import {
    GET as getComments,
    POST as addComment,
} from '../../../app/api/reports/[reportId]/comments+api';
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
// Fixtures
// ------------------------------------------------------------------
const REPORT_ID = 'REP-00007';
const OTHER_REPORT_ID = 'REP-00008';
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');

const AUTHOR = 'PAS-2026-00001';
const NEIGHBOUR = 'PAS-2026-00002';
/** A passenger with no user record, to prove a comment survives one. */
const NAMELESS = 'PAS-2026-00003';

const SESSIONS: Record<string, Record<string, string>> = {
    [AUTHOR]: {
        uid: 'UID-A',
        passengerId: AUTHOR,
        role: 'PASSENGER',
        email: 'author@example.com',
    },
    [NEIGHBOUR]: {
        uid: 'UID-B',
        passengerId: NEIGHBOUR,
        role: 'PASSENGER',
        email: 'neighbour@example.com',
    },
    [NAMELESS]: {
        uid: 'UID-C',
        passengerId: NAMELESS,
        role: 'PASSENGER',
        email: 'nameless@example.com',
    },
};

function storedReport(reportId: string, overrides: Record<string, any> = {}) {
    return {
        id: reportId,
        reportId,
        passengerId: AUTHOR,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

/** Two reports, so a comment on one can be shown not to reach the other. */
function firestoreWithReports() {
    return createFakeFirestore({
        reports: [storedReport(REPORT_ID), storedReport(OTHER_REPORT_ID)],
        comments: [],
        users: [
            { id: AUTHOR, passengerId: AUTHOR, userName: 'Nimali Perera' },
            { id: NEIGHBOUR, passengerId: NEIGHBOUR, userName: 'Kasun Silva' },
        ],
    });
}

function request(
    method: string,
    options: { token?: string; body?: unknown; reportId?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(
        `http://localhost/api/reports/${options.reportId ?? REPORT_ID}/comments`,
        {
            method,
            headers,
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        }
    );
}

function params(reportId: string = REPORT_ID) {
    return { params: { reportId } };
}

async function comment(token: string, text: unknown, reportId: string = REPORT_ID) {
    const response = await addComment(
        request('POST', { token, body: { comment: text }, reportId }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

async function readComments(token: string, reportId: string = REPORT_ID) {
    const response = await getComments(
        request('GET', { token, reportId }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Authentication
// ==================================================================
describe('/api/reports/[reportId]/comments - authentication', () => {
    it('refuses to store a comment without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const response = await addComment(
            request('POST', { body: { comment: 'The ramp was not working.' } }),
            params()
        );

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses to read the thread without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const response = await getComments(request('GET'), params());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses a token that does not verify', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const response = await addComment(
            request('POST', { token: 'forged', body: { comment: 'Nope.' } }),
            params()
        );

        expect(response.status).toBe(401);
    });
});

// ==================================================================
// Writing a comment
// ==================================================================
describe('POST /api/reports/[reportId]/comments', () => {
    it('stores a comment and hands back the stored record', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await comment(
            NEIGHBOUR,
            'The ramp was not working properly.'
        );

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.comment).toMatchObject({
            reportId: REPORT_ID,
            passengerId: NEIGHBOUR,
            authorName: 'Kasun Silva',
            text: 'The ramp was not working properly.',
        });
        expect(typeof body.comment.commentId).toBe('string');
        expect(body.comment.commentId).toMatch(/^CMT-\d{5}$/);

        // A date the app's formatter can read, rather than a Firestore value
        // that does not survive JSON.
        expect(Number.isNaN(new Date(body.comment.createdAt).getTime())).toBe(false);
    });

    it('trims what was written', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const { body } = await comment(NEIGHBOUR, '   The lift was out of service.\n  ');

        expect(body.comment.text).toBe('The lift was out of service.');
    });

    it('takes the author from the token rather than the request body', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        const response = await addComment(
            request('POST', {
                token: NEIGHBOUR,
                body: {
                    comment: 'Not mine to sign.',
                    passengerId: AUTHOR,
                    authorName: 'Somebody Else',
                },
            }),
            params()
        );
        const body = await response.json();

        expect(body.comment.passengerId).toBe(NEIGHBOUR);
        expect(body.comment.authorName).toBe('Kasun Silva');
    });

    it('still stores a comment from a passenger with no user record', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const { response, body } = await comment(NAMELESS, 'The bus never lowered.');

        expect(response.status).toBe(201);
        expect(body.comment.authorName).toBe('Passenger');
    });

    it('numbers comments sequentially', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const first = await comment(NEIGHBOUR, 'First.');
        const second = await comment(AUTHOR, 'Second.');

        expect(first.body.comment.commentId).toBe('CMT-00001');
        expect(second.body.comment.commentId).toBe('CMT-00002');
    });

    it('accepts a comment of exactly the maximum length', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const { response } = await comment(NEIGHBOUR, 'a'.repeat(MAX_REPORT_COMMENT_LENGTH));

        expect(response.status).toBe(201);
    });

    it('leaves the report document untouched', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        await comment(NEIGHBOUR, 'The ramp was not working properly.');

        const report = (await db.collection('reports').doc(REPORT_ID).get()).data();

        // Commenting writes one comment document and nothing else. In
        // particular it does not keep a count on the report: GET /api/reports
        // derives that per request, so a stored one could only ever drift.
        expect(report).toEqual(storedReport(REPORT_ID));
        expect(report?.commentCount).toBeUndefined();
    });

    it('resolves the author name at the time of writing', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        await comment(NEIGHBOUR, 'Written under the old name.');

        // The passenger renames themselves afterwards. The comment keeps the
        // name it was written under, the way a report keeps the bus it named.
        await db.collection('users').doc(NEIGHBOUR).update({ userName: 'Kasun P. Silva' });

        const { body } = await readComments(AUTHOR);

        expect(body.comments[0].authorName).toBe('Kasun Silva');
    });
});

// ==================================================================
// Rejected comments
// ==================================================================
describe('POST /api/reports/[reportId]/comments - rejections', () => {
    it.each([[''], ['   '], ['\n\t  '], [null], [42]])(
        'rejects %p as a comment',
        async (text) => {
            const db = firestoreWithReports();
            mockGetAdminDb.mockReturnValue(db);

            const { response } = await comment(NEIGHBOUR, text);

            expect(response.status).toBe(400);

            const stored = await db.collection('comments').get();

            expect(stored.docs).toHaveLength(0);
        }
    );

    it('rejects a comment over the maximum length', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await comment(
            NEIGHBOUR,
            'a'.repeat(MAX_REPORT_COMMENT_LENGTH + 1)
        );

        expect(response.status).toBe(400);
        expect(body.message).toMatch(new RegExp(String(MAX_REPORT_COMMENT_LENGTH)));

        const stored = await db.collection('comments').get();

        expect(stored.docs).toHaveLength(0);
    });

    it('measures the length after trimming', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const { response } = await comment(
            NEIGHBOUR,
            `   ${'a'.repeat(MAX_REPORT_COMMENT_LENGTH)}   `
        );

        expect(response.status).toBe(201);
    });

    it('rejects a request with no body at all', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const response = await addComment(request('POST', { token: NEIGHBOUR }), params());

        expect(response.status).toBe(400);
    });

    it('answers 404 for a report that does not exist', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await comment(NEIGHBOUR, 'Anybody there?', 'REP-99999');

        expect(response.status).toBe(404);
        expect(body.message).toMatch(/not found/i);

        const stored = await db.collection('comments').get();

        expect(stored.docs).toHaveLength(0);
    });

    it('answers 400 when no report id reaches the handler', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const response = await addComment(
            new Request('http://localhost/api/reports//comments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${NEIGHBOUR}`,
                },
                body: JSON.stringify({ comment: 'Hello.' }),
            }),
            {}
        );

        expect(response.status).toBe(400);
    });
});

// ==================================================================
// Reading the thread
// ==================================================================
describe('GET /api/reports/[reportId]/comments', () => {
    it('returns an empty thread for a report nobody has commented on', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const { response, body } = await readComments(NEIGHBOUR);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.count).toBe(0);
        expect(body.comments).toEqual([]);
    });

    it('returns everything the thread needs to draw a row', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        await comment(NEIGHBOUR, 'The ramp was not working properly.');

        const { body } = await readComments(AUTHOR);

        expect(body.count).toBe(1);
        expect(body.comments[0]).toMatchObject({
            commentId: 'CMT-00001',
            authorName: 'Kasun Silva',
            text: 'The ramp was not working properly.',
            passengerId: NEIGHBOUR,
        });
        expect(typeof body.comments[0].createdAt).toBe('string');
    });

    it('returns comments newest first', async () => {
        const db = firestoreWithReports();
        mockGetAdminDb.mockReturnValue(db);

        await comment(NEIGHBOUR, 'Oldest.');
        await comment(AUTHOR, 'Middle.');
        await comment(NEIGHBOUR, 'Newest.');

        // The three land in the same millisecond in a test, so the timestamps
        // are spread out afterwards: what is being checked is the ordering the
        // route applies, not how fast the clock ticks.
        const stored = await db.collection('comments').get();

        stored.docs.forEach((doc: any, index: number) => {
            doc.data().createdAt = new Date(
                Date.UTC(2026, 7, 21, 9, index)
            ).toISOString();
        });

        const { body } = await readComments(AUTHOR);

        expect(body.comments.map((entry: any) => entry.text)).toEqual([
            'Newest.',
            'Middle.',
            'Oldest.',
        ]);
    });

    it('keeps each report\'s thread to itself', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        await comment(NEIGHBOUR, 'About the first report.');
        await comment(NEIGHBOUR, 'About the second report.', OTHER_REPORT_ID);

        const first = await readComments(AUTHOR);
        const second = await readComments(AUTHOR, OTHER_REPORT_ID);

        expect(first.body.comments.map((entry: any) => entry.text)).toEqual([
            'About the first report.',
        ]);
        expect(second.body.comments.map((entry: any) => entry.text)).toEqual([
            'About the second report.',
        ]);
    });

    it('answers 404 for a report that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        const { response } = await readComments(NEIGHBOUR, 'REP-99999');

        expect(response.status).toBe(404);
    });

    it('reads the report id out of the path when no params are given', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWithReports());

        await comment(NEIGHBOUR, 'Straight off the path.');

        const response = await getComments(request('GET', { token: AUTHOR }), {});
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.comments[0].text).toBe('Straight off the path.');
    });
});
