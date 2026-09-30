// MOV-306 — report management and validation on the server.
//
// Four rules the MOV-304 acceptance criteria rest on, each enforced by the API
// rather than by the screens that happen to call it:
//
//   AC5  voting and commenting are a passenger's voice: a bus device, a
//        journey-sharing credential or an admin cannot write either — while a
//        passenger can still vote on and comment on everything they can see,
//        verified issues and positive feedback included, and reading stays open
//   AC2  a description is at most MAX_REPORT_DESCRIPTION_LENGTH characters, on
//        create and on edit, for an issue and for positive feedback alike
//   AC6  a passenger reads the review outcome (status, date, remark) but never
//        the uid of the admin who decided it; an admin still does
//   AC2/AC4  PUT refuses a body that is a list, as POST does

import {
    GET as getReports,
    POST as createReport,
} from '../../../app/api/reports/index+api';
import {
    GET as getReport,
    PUT as updateReport,
} from '../../../app/api/reports/[reportId]+api';
import { GET as getReportForReview } from '../../../app/api/reports/[reportId]/review+api';
import {
    GET as getVotes,
    POST as castVote,
} from '../../../app/api/reports/[reportId]/vote+api';
import {
    GET as getComments,
    POST as addComment,
} from '../../../app/api/reports/[reportId]/comments+api';
import { MAX_REPORT_DESCRIPTION_LENGTH } from '../../../src/entities/report/model/types';
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
const AUTHOR = 'PAS-2026-00001';
const NEIGHBOUR = 'PAS-2026-00002';
const ADMIN_UID = 'UID-ADMIN';
const BUS_ID = 'BUS-0001';

const AUTHOR_SESSION = 'session-author';
const NEIGHBOUR_SESSION = 'session-neighbour';
const ADMIN_SESSION = 'session-admin';
/** What POST /api/auth/bus-login mints: a vehicle, with no passenger at all. */
const BUS_SESSION = 'session-bus';
/** What Start Journey hands the device: narrowed to reporting one bus's position. */
const JOURNEY_SESSION = 'session-journey';
/** A passenger-role token that somehow carries no passenger id. */
const NAMELESS_PASSENGER_SESSION = 'session-nameless';
/** A passenger-role token narrowed by a scope claim. */
const SCOPED_PASSENGER_SESSION = 'session-scoped';

const SESSIONS: Record<string, Record<string, string>> = {
    [AUTHOR_SESSION]: {
        uid: 'UID-A',
        passengerId: AUTHOR,
        role: 'PASSENGER',
        email: 'author@example.com',
    },
    [NEIGHBOUR_SESSION]: {
        uid: 'UID-B',
        passengerId: NEIGHBOUR,
        role: 'PASSENGER',
        email: 'neighbour@example.com',
    },
    [ADMIN_SESSION]: {
        uid: ADMIN_UID,
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
        passengerId: BUS_ID,
        role: 'BUS',
        email: '',
        busId: BUS_ID,
        tripId: 'TRIP-0001',
        scope: 'JOURNEY_LOCATION',
    },
    [NAMELESS_PASSENGER_SESSION]: {
        uid: 'UID-N',
        passengerId: '',
        role: 'PASSENGER',
        email: 'nameless@example.com',
    },
    [SCOPED_PASSENGER_SESSION]: {
        uid: 'UID-S',
        passengerId: 'PAS-2026-00009',
        role: 'PASSENGER',
        email: 'scoped@example.com',
        scope: 'JOURNEY_LOCATION',
    },
};

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');
const REVIEWED_AT = '2026-08-22T09:30:00.000Z';

const VERIFIED_ISSUE = 'REP-00001';
const POSITIVE = 'REP-00002';
const PENDING_ISSUE = 'REP-00003';
const REJECTED_ISSUE = 'REP-00004';

function issue(reportId: string, overrides: Record<string, any> = {}) {
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

function positive(reportId: string, overrides: Record<string, any> = {}) {
    return {
        id: reportId,
        reportId,
        passengerId: AUTHOR,
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        description: 'The driver waited while I boarded.',
        status: 'PUBLISHED',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

/** A decided issue, as POST /api/reports/:id/review leaves it. */
function decided(reportId: string, status: 'VERIFIED' | 'REJECTED', remark: string) {
    return issue(reportId, {
        status,
        reviewedBy: ADMIN_UID,
        reviewedAt: REVIEWED_AT,
        adminRemark: remark,
    });
}

function seededFirestore(extraReports: Record<string, any>[] = []) {
    const db = createFakeFirestore({
        reports: [
            decided(VERIFIED_ISSUE, 'VERIFIED', 'Confirmed on site.'),
            positive(POSITIVE),
            issue(PENDING_ISSUE),
            decided(REJECTED_ISSUE, 'REJECTED', 'The ramp folded normally.'),
            ...extraReports,
        ],
        votes: [],
        comments: [],
        // Past the seeded ids, so a report filed here never lands on one.
        counters: [{ id: 'reports', lastNumber: 100 }],
        users: [
            { id: AUTHOR, passengerId: AUTHOR, userName: 'Nimali Perera' },
            { id: NEIGHBOUR, passengerId: NEIGHBOUR, userName: 'Kasun Silva' },
        ],
    });

    mockGetAdminDb.mockReturnValue(db);

    return db;
}

function jsonRequest(
    path: string,
    method: string,
    options: { token?: string; body?: unknown; rawBody?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    let body: string | undefined;

    if (options.rawBody !== undefined) body = options.rawBody;
    else if (options.body !== undefined) body = JSON.stringify(options.body);

    return new Request(`http://localhost${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
    });
}

function params(reportId: string) {
    return { params: { reportId } };
}

async function vote(token: string, reportId: string, choice = 'AGREE') {
    const response = await castVote(
        jsonRequest(`/api/reports/${reportId}/vote`, 'POST', { token, body: { vote: choice } }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

async function comment(token: string, reportId: string, text = 'Same thing happened to me.') {
    const response = await addComment(
        jsonRequest(`/api/reports/${reportId}/comments`, 'POST', {
            token,
            body: { comment: text },
        }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

async function storedCollection(db: any, name: string) {
    const snapshot = await db.collection(name).get();

    return snapshot.docs.map((doc: any) => doc.data());
}

async function storedReport(db: any, reportId: string) {
    return (await db.collection('reports').doc(reportId).get()).data();
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// AC5 — only a passenger votes or comments
// ==================================================================
describe('AC5 - voting is a passenger action', () => {
    const REFUSED = [
        ['a bus device session', BUS_SESSION],
        ['a journey-sharing credential', JOURNEY_SESSION],
        ['an admin', ADMIN_SESSION],
        ['a passenger token with no passenger id', NAMELESS_PASSENGER_SESSION],
        ['a scoped passenger token', SCOPED_PASSENGER_SESSION],
    ] as const;

    it.each(REFUSED)('refuses a vote from %s with 403', async (_label, token) => {
        seededFirestore();

        const { response, body } = await vote(token, VERIFIED_ISSUE);

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.message).toMatch(/only passengers/i);
    });

    it.each(REFUSED)('writes nothing when it refuses %s', async (_label, token) => {
        const db = seededFirestore();

        await vote(token, VERIFIED_ISSUE);

        expect(await storedCollection(db, 'votes')).toEqual([]);

        const report = await storedReport(db, VERIFIED_ISSUE);

        expect(report.agreeCount).toBeUndefined();
        expect(report.requiresAdminReview).toBeUndefined();
    });

    it('refuses the bus before it looks the report up, so it learns nothing about ids', async () => {
        seededFirestore();

        const { response } = await vote(BUS_SESSION, 'REP-99999');

        expect(response.status).toBe(403);
    });

    it('still lets a passenger vote on a VERIFIED issue', async () => {
        seededFirestore();

        const { response, body } = await vote(NEIGHBOUR_SESSION, VERIFIED_ISSUE);

        expect(response.status).toBe(200);
        expect(body.agreeCount).toBe(1);
    });

    it('still lets a passenger vote on positive feedback', async () => {
        seededFirestore();

        const { response, body } = await vote(NEIGHBOUR_SESSION, POSITIVE, 'DISAGREE');

        expect(response.status).toBe(200);
        expect(body.disagreeCount).toBe(1);
    });

    it('still lets the author vote on their own pending issue', async () => {
        seededFirestore();

        const { response } = await vote(AUTHOR_SESSION, PENDING_ISSUE);

        expect(response.status).toBe(200);
    });

    it('still hides a pending issue from another passenger (404), as before', async () => {
        seededFirestore();

        const { response } = await vote(NEIGHBOUR_SESSION, PENDING_ISSUE);

        expect(response.status).toBe(404);
    });

    it('leaves reading the votes open to an admin', async () => {
        seededFirestore();
        await vote(NEIGHBOUR_SESSION, VERIFIED_ISSUE);

        const response = await getVotes(
            jsonRequest(`/api/reports/${VERIFIED_ISSUE}/vote`, 'GET', { token: ADMIN_SESSION }),
            params(VERIFIED_ISSUE)
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.agreeCount).toBe(1);
    });

    it('leaves reading the votes open to a bus session that can see the report', async () => {
        seededFirestore();

        const response = await getVotes(
            jsonRequest(`/api/reports/${VERIFIED_ISSUE}/vote`, 'GET', { token: BUS_SESSION }),
            params(VERIFIED_ISSUE)
        );

        expect(response.status).toBe(200);
    });
});

describe('AC5 - commenting is a passenger action', () => {
    const REFUSED = [
        ['a bus device session', BUS_SESSION],
        ['a journey-sharing credential', JOURNEY_SESSION],
        ['an admin', ADMIN_SESSION],
        ['a passenger token with no passenger id', NAMELESS_PASSENGER_SESSION],
        ['a scoped passenger token', SCOPED_PASSENGER_SESSION],
    ] as const;

    it.each(REFUSED)('refuses a comment from %s with 403 and stores nothing', async (_label, token) => {
        const db = seededFirestore();

        const { response, body } = await comment(token, VERIFIED_ISSUE);

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(await storedCollection(db, 'comments')).toEqual([]);
    });

    it('does not burn a comment number on a refused write', async () => {
        const db = seededFirestore();

        await comment(BUS_SESSION, VERIFIED_ISSUE);
        await comment(NEIGHBOUR_SESSION, VERIFIED_ISSUE);

        const [stored] = await storedCollection(db, 'comments');

        expect(stored.commentId).toBe('CMT-00001');
    });

    it('still lets a passenger comment on a VERIFIED issue and on positive feedback', async () => {
        seededFirestore();

        const onIssue = await comment(NEIGHBOUR_SESSION, VERIFIED_ISSUE);
        const onPraise = await comment(NEIGHBOUR_SESSION, POSITIVE, 'Same driver helped me too.');

        expect(onIssue.response.status).toBe(201);
        expect(onPraise.response.status).toBe(201);
        expect(onIssue.body.comment.passengerId).toBe(NEIGHBOUR);
    });

    it('leaves reading the thread open to an admin', async () => {
        seededFirestore();
        await comment(NEIGHBOUR_SESSION, VERIFIED_ISSUE);

        const response = await getComments(
            jsonRequest(`/api/reports/${VERIFIED_ISSUE}/comments`, 'GET', { token: ADMIN_SESSION }),
            params(VERIFIED_ISSUE)
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.count).toBe(1);
    });
});

// ==================================================================
// AC2 — the description cap, enforced by the API
// ==================================================================
describe('AC2 - description length on create', () => {
    const AT_CAP = 'a'.repeat(MAX_REPORT_DESCRIPTION_LENGTH);
    const OVER_CAP = 'a'.repeat(MAX_REPORT_DESCRIPTION_LENGTH + 1);

    async function submit(body: Record<string, any>) {
        const response = await createReport(
            jsonRequest('/api/reports', 'POST', { token: AUTHOR_SESSION, body })
        );

        return { response, body: await response.json() };
    }

    it('is the 600 characters both forms cap typing at', () => {
        expect(MAX_REPORT_DESCRIPTION_LENGTH).toBe(600);
    });

    it('accepts an issue description of exactly 600 characters', async () => {
        seededFirestore();

        const { response, body } = await submit({ issueCategory: 'BROKEN_RAMP', description: AT_CAP });

        expect(response.status).toBe(201);
        expect(body.report.description).toHaveLength(600);
    });

    it('rejects an issue description of 601 characters, and stores nothing', async () => {
        const db = seededFirestore();
        const before = (await storedCollection(db, 'reports')).length;

        const { response, body } = await submit({ issueCategory: 'BROKEN_RAMP', description: OVER_CAP });

        expect(response.status).toBe(400);
        expect(body.message).toBe('A description can be at most 600 characters.');
        expect(await storedCollection(db, 'reports')).toHaveLength(before);
    });

    it('accepts positive feedback of exactly 600 characters', async () => {
        seededFirestore();

        const { response } = await submit({
            type: 'POSITIVE',
            category: 'HELPFUL_DRIVER',
            description: AT_CAP,
        });

        expect(response.status).toBe(201);
    });

    it('rejects positive feedback of 601 characters', async () => {
        seededFirestore();

        const { response, body } = await submit({
            type: 'POSITIVE',
            category: 'HELPFUL_DRIVER',
            description: OVER_CAP,
        });

        expect(response.status).toBe(400);
        expect(body.message).toBe('A description can be at most 600 characters.');
    });

    it('measures the description after trimming', async () => {
        seededFirestore();

        const { response, body } = await submit({
            issueCategory: 'BROKEN_RAMP',
            description: `   ${AT_CAP}   `,
        });

        expect(response.status).toBe(201);
        expect(body.report.description).toBe(AT_CAP);
    });
});

describe('AC2 - description length on edit', () => {
    const AT_CAP = 'b'.repeat(MAX_REPORT_DESCRIPTION_LENGTH);
    const OVER_CAP = 'b'.repeat(MAX_REPORT_DESCRIPTION_LENGTH + 1);

    async function edit(reportId: string, body: Record<string, any>) {
        const response = await updateReport(
            jsonRequest(`/api/reports/${reportId}`, 'PUT', { token: AUTHOR_SESSION, body }),
            params(reportId)
        );

        return { response, body: await response.json() };
    }

    it('accepts an issue edited to exactly 600 characters', async () => {
        const db = seededFirestore();

        const { response } = await edit(PENDING_ISSUE, {
            issueCategory: 'BROKEN_RAMP',
            description: AT_CAP,
        });

        expect(response.status).toBe(200);
        expect((await storedReport(db, PENDING_ISSUE)).description).toBe(AT_CAP);
    });

    it('rejects an issue edited to 601 characters and keeps what was stored', async () => {
        const db = seededFirestore();
        const before = (await storedReport(db, PENDING_ISSUE)).description;

        const { response, body } = await edit(PENDING_ISSUE, {
            issueCategory: 'BROKEN_RAMP',
            description: OVER_CAP,
        });

        expect(response.status).toBe(400);
        expect(body.message).toBe('A description can be at most 600 characters.');
        expect((await storedReport(db, PENDING_ISSUE)).description).toBe(before);
    });

    it('accepts positive feedback edited to exactly 600 characters', async () => {
        seededFirestore();

        const { response } = await edit(POSITIVE, {
            type: 'POSITIVE',
            category: 'HELPFUL_DRIVER',
            description: AT_CAP,
        });

        expect(response.status).toBe(200);
    });

    it('rejects positive feedback edited to 601 characters', async () => {
        seededFirestore();

        const { response, body } = await edit(POSITIVE, {
            type: 'POSITIVE',
            category: 'HELPFUL_DRIVER',
            description: OVER_CAP,
        });

        expect(response.status).toBe(400);
        expect(body.message).toBe('A description can be at most 600 characters.');
    });
});

// ==================================================================
// AC6 — the review outcome, without the reviewer's uid
// ==================================================================
describe('AC6 - reviewedBy stays out of passenger responses', () => {
    async function readOne(token: string, reportId: string) {
        const response = await getReport(
            jsonRequest(`/api/reports/${reportId}`, 'GET', { token }),
            params(reportId)
        );

        return { response, body: await response.json() };
    }

    async function list(token: string, scope: string) {
        const response = await getReports(
            jsonRequest(`/api/reports?scope=${scope}`, 'GET', { token })
        );

        return response.json();
    }

    it('gives the author the outcome of their verified report, without the reviewer', async () => {
        seededFirestore();

        const { response, body } = await readOne(AUTHOR_SESSION, VERIFIED_ISSUE);

        expect(response.status).toBe(200);
        expect(body.report.status).toBe('VERIFIED');
        expect(body.report.reviewedAt).toBe(REVIEWED_AT);
        expect(body.report.adminRemark).toBe('Confirmed on site.');
        expect(body.report).not.toHaveProperty('reviewedBy');
    });

    it('gives the author the outcome of their rejected report, without the reviewer', async () => {
        seededFirestore();

        const { body } = await readOne(AUTHOR_SESSION, REJECTED_ISSUE);

        expect(body.report.status).toBe('REJECTED');
        expect(body.report.adminRemark).toBe('The ramp folded normally.');
        expect(body.report).not.toHaveProperty('reviewedBy');
    });

    it('does not show another passenger the reviewer of a public verified issue', async () => {
        seededFirestore();

        const { response, body } = await readOne(NEIGHBOUR_SESSION, VERIFIED_ISSUE);

        expect(response.status).toBe(200);
        expect(body.report).not.toHaveProperty('reviewedBy');
    });

    it.each(['all', 'my', 'verified'])('leaves reviewedBy off every report in scope=%s', async (scope) => {
        seededFirestore();

        const body = await list(AUTHOR_SESSION, scope);

        expect(body.reports.length).toBeGreaterThan(0);

        for (const report of body.reports) {
            expect(report).not.toHaveProperty('reviewedBy');
        }
    });

    it('still gives the author the outcome through My Reports', async () => {
        seededFirestore();

        const body = await list(AUTHOR_SESSION, 'my');
        const verified = body.reports.find((report: any) => report.reportId === VERIFIED_ISSUE);

        expect(verified.status).toBe('VERIFIED');
        expect(verified.reviewedAt).toBe(REVIEWED_AT);
        expect(verified.adminRemark).toBe('Confirmed on site.');
    });

    it('keeps passengerId, which the app reads to tell a passenger their own report', async () => {
        seededFirestore();

        const { body } = await readOne(NEIGHBOUR_SESSION, VERIFIED_ISSUE);
        const listed = await list(NEIGHBOUR_SESSION, 'all');

        expect(body.report.passengerId).toBe(AUTHOR);
        expect(listed.reports.every((report: any) => report.passengerId === AUTHOR)).toBe(true);
    });

    it('leaves a remark-only review out of the edit response too', async () => {
        const db = seededFirestore([
            issue('REP-00005', {
                reviewedBy: ADMIN_UID,
                reviewedAt: REVIEWED_AT,
                adminRemark: 'Chasing the depot.',
            }),
        ]);

        const response = await updateReport(
            jsonRequest('/api/reports/REP-00005', 'PUT', {
                token: AUTHOR_SESSION,
                body: { issueCategory: 'LIFT_NOT_WORKING', description: 'Updated account.' },
            }),
            params('REP-00005')
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.report.adminRemark).toBe('Chasing the depot.');
        expect(body.report).not.toHaveProperty('reviewedBy');
        // The stored record still names the reviewer.
        expect((await storedReport(db, 'REP-00005')).reviewedBy).toBe(ADMIN_UID);
    });

    it('still gives an admin reviewedBy through the admin review route', async () => {
        seededFirestore();

        const response = await getReportForReview(
            jsonRequest(`/api/reports/${VERIFIED_ISSUE}/review`, 'GET', { token: ADMIN_SESSION }),
            params(VERIFIED_ISSUE)
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.report.reviewedBy).toBe(ADMIN_UID);
        expect(body.review.reviewedBy).toBe(ADMIN_UID);
    });

    it('still gives an admin reviewedBy through the review queue', async () => {
        seededFirestore();

        const body = await list(ADMIN_SESSION, 'review');
        const verified = body.reports.find((report: any) => report.reportId === VERIFIED_ISSUE);

        expect(verified.review.reviewedBy).toBe(ADMIN_UID);
    });

    it('still gives an admin reviewedBy when reading one report directly', async () => {
        seededFirestore();

        const { body } = await readOne(ADMIN_SESSION, REJECTED_ISSUE);

        expect(body.report.reviewedBy).toBe(ADMIN_UID);
    });

    it('never removes reviewedBy from the stored record', async () => {
        const db = seededFirestore();

        await readOne(AUTHOR_SESSION, VERIFIED_ISSUE);
        await list(AUTHOR_SESSION, 'my');

        expect((await storedReport(db, VERIFIED_ISSUE)).reviewedBy).toBe(ADMIN_UID);
    });
});

// ==================================================================
// AC2 / AC4 — PUT refuses a list body the way POST does
// ==================================================================
describe('AC2/AC4 - PUT body validation', () => {
    it('refuses an array body with "Invalid request body." and changes nothing', async () => {
        const db = seededFirestore();
        const before = { ...(await storedReport(db, PENDING_ISSUE)) };

        const response = await updateReport(
            jsonRequest(`/api/reports/${PENDING_ISSUE}`, 'PUT', {
                token: AUTHOR_SESSION,
                body: [{ issueCategory: 'BROKEN_RAMP', description: 'A list, not an object.' }],
            }),
            params(PENDING_ISSUE)
        );
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body).toEqual({ success: false, message: 'Invalid request body.' });
        expect(await storedReport(db, PENDING_ISSUE)).toEqual(before);
    });

    it('gives POST and PUT the same answer for an array body', async () => {
        seededFirestore();

        const post = await createReport(
            jsonRequest('/api/reports', 'POST', { token: AUTHOR_SESSION, body: [] })
        );
        const put = await updateReport(
            jsonRequest(`/api/reports/${PENDING_ISSUE}`, 'PUT', { token: AUTHOR_SESSION, body: [] }),
            params(PENDING_ISSUE)
        );

        expect(put.status).toBe(post.status);
        expect((await put.json()).message).toBe((await post.json()).message);
    });

    it('still refuses a body that is not JSON', async () => {
        seededFirestore();

        const response = await updateReport(
            jsonRequest(`/api/reports/${PENDING_ISSUE}`, 'PUT', {
                token: AUTHOR_SESSION,
                rawBody: 'not json',
            }),
            params(PENDING_ISSUE)
        );

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('Invalid request body.');
    });
});
