// Positive accessibility feedback through the existing report API (MOV-301).
//
// Positive feedback is not a second API. It is a second TYPE of report, filed
// through POST /api/reports with `type: 'POSITIVE'`, stored in the same
// `reports` collection under the same REP- counter, and taken through the same
// PENDING → VERIFIED / REJECTED lifecycle by the same admin review route. So
// every step below is a real request through a real handler, and the same
// Firestore double the rest of the report suites use.
//
// What this file holds the backend to:
//   - only an authenticated passenger can submit it, and it always starts
//     PENDING whatever the body claims;
//   - it is stored as { type: 'POSITIVE', category, description, … } and never
//     carries an `issueCategory`, so nothing that reads issues can mistake it
//     for one — while issue reports are stored exactly as they were;
//   - an admin verifies or rejects it with the existing review route, and the
//     listing scopes treat it by the same visibility rules as any report.

import {
    GET as getReport,
    PUT as updateReport,
} from '../../../app/api/reports/[reportId]+api';
import {
    GET as getReportForReview,
    POST as reviewReport,
} from '../../../app/api/reports/[reportId]/review+api';
import {
    GET as listReports,
    POST as createReport,
} from '../../../app/api/reports/index+api';
import {
    POSITIVE_FEEDBACK_CATEGORIES,
    reportTypeOf,
} from '../../../src/entities/report/model/types';
import {
    readReportContent,
    readRequestedReportType,
} from '../../../src/shared/server/reportContent';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the signature check is stubbed; authenticateRequest runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const AUTHOR = 'PSG-00001';
const OTHER_PASSENGER = 'PSG-00002';
const AUTHOR_SESSION = 'session-author';
const OTHER_SESSION = 'session-other';
const ADMIN_SESSION = 'session-admin';
const DRIVER_SESSION = 'session-driver';
const ADMIN_UID = 'UID-ADMIN';

const BUS_ID = 'BUS-00007';
const ROUTE_ID = 'R-138-OUT';

const DESCRIPTION = 'The driver lowered the ramp and waited until I was seated.';

const SESSIONS: Record<string, Record<string, string>> = {
    [AUTHOR_SESSION]: { uid: 'UID-A', passengerId: AUTHOR, role: 'PASSENGER' },
    [OTHER_SESSION]: { uid: 'UID-B', passengerId: OTHER_PASSENGER, role: 'PASSENGER' },
    [ADMIN_SESSION]: { uid: ADMIN_UID, passengerId: 'ADM-00001', role: 'ADMIN' },
    [DRIVER_SESSION]: { uid: 'UID-D', passengerId: 'DRV-00001', role: 'DRIVER' },
};

function seededFirestore(seed: Record<string, any[]> = {}) {
    return createFakeFirestore({
        buses: [
            {
                id: BUS_ID,
                busId: BUS_ID,
                numberPlate: 'NB-1234',
                busModel: 'Ashok Leyland Viking',
                manufacturer: 'Ashok Leyland',
                status: 'ACTIVE',
            },
        ],
        routes: [
            {
                id: ROUTE_ID,
                routeId: ROUTE_ID,
                routeNumber: '138',
                routeName: 'Colombo - Kandy',
                direction: 'OUTBOUND',
                status: 'ACTIVE',
            },
        ],
        reports: [],
        votes: [],
        comments: [],
        counters: [],
        ...seed,
    });
}

function jsonRequest(
    url: string,
    method: string,
    options: { token?: string; body?: unknown; rawBody?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const body =
        options.rawBody !== undefined
            ? options.rawBody
            : options.body === undefined
              ? undefined
              : JSON.stringify(options.body);

    return new Request(`http://localhost${url}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
    });
}

function params(reportId: string) {
    return { params: { reportId } };
}

/** A valid positive submission, exactly as the MOV-300 screen builds it. */
function positivePayload(overrides: Record<string, any> = {}) {
    return {
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        description: DESCRIPTION,
        ...overrides,
    };
}

/** A valid issue submission, exactly as the existing report form builds it. */
function issuePayload(overrides: Record<string, any> = {}) {
    return {
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        ...overrides,
    };
}

/** Files a report. `token: null` sends the request with no session at all. */
async function submit(db: any, body: unknown, token: string | null = AUTHOR_SESSION) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await createReport(
        jsonRequest('/api/reports', 'POST', { token: token ?? undefined, body })
    );

    return { response, json: await response.json() };
}

async function review(db: any, reportId: string, body: Record<string, any>) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await reviewReport(
        jsonRequest(`/api/reports/${reportId}/review`, 'POST', { token: ADMIN_SESSION, body }),
        params(reportId)
    );

    return { response, json: await response.json() };
}

async function list(db: any, scope: string, token: string) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await listReports(jsonRequest(`/api/reports?scope=${scope}`, 'GET', { token }));
    const json = await response.json();

    return { response, json, ids: (json.reports ?? []).map((report: any) => report.reportId) };
}

async function edit(db: any, reportId: string, body: unknown, token = AUTHOR_SESSION) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await updateReport(
        jsonRequest(`/api/reports/${reportId}`, 'PUT', { token, body }),
        params(reportId)
    );

    return { response, json: await response.json() };
}

/**
 * The report exactly as the route wrote it.
 *
 * The Firestore double echoes each document's id into its data as `id`; the
 * route never writes that key, so it is dropped here to compare what was
 * actually stored.
 */
async function stored(db: any, reportId: string) {
    const doc = await db.collection('reports').doc(reportId).get();
    const { id: _documentId, ...data } = doc.data() ?? {};

    return data;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Submission
// ==================================================================
describe('POST /api/reports - positive feedback submission', () => {
    it('lets an authenticated passenger submit positive feedback', async () => {
        const db = seededFirestore();

        const { response, json } = await submit(db, positivePayload());

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.message).toBe('Positive accessibility feedback submitted successfully.');
        expect(json.report.reportId).toBe('REP-00001');
    });

    it('starts the feedback at PENDING', async () => {
        const db = seededFirestore();

        const { json } = await submit(db, positivePayload());

        expect(json.report.status).toBe('PENDING');
        expect((await stored(db, json.report.reportId)).status).toBe('PENDING');
    });

    it('stores the feedback in the reports collection in the positive shape', async () => {
        const db = seededFirestore();

        const { json } = await submit(
            db,
            positivePayload({
                category: 'EASY_WHEELCHAIR_BOARDING',
                description: `  ${DESCRIPTION}  `,
                busId: BUS_ID,
                routeId: ROUTE_ID,
            })
        );

        const record = await stored(db, json.report.reportId);

        expect(record).toEqual({
            reportId: 'REP-00001',
            passengerId: AUTHOR,
            type: 'POSITIVE',
            category: 'EASY_WHEELCHAIR_BOARDING',
            description: DESCRIPTION,
            busId: BUS_ID,
            vehicle: {
                numberPlate: 'NB-1234',
                busModel: 'Ashok Leyland Viking',
                manufacturer: 'Ashok Leyland',
            },
            routeId: ROUTE_ID,
            route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
            status: 'PENDING',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
        });
        expect(record).not.toHaveProperty('issueCategory');
        expect(reportTypeOf(record)).toBe('POSITIVE');
    });

    it('accepts feedback with neither a bus nor a route', async () => {
        const db = seededFirestore();

        const { response, json } = await submit(
            db,
            positivePayload({ category: 'ACCESSIBLE_BUS_STOP' })
        );
        const record = await stored(db, json.report.reportId);

        expect(response.status).toBe(201);
        expect(record).not.toHaveProperty('busId');
        expect(record).not.toHaveProperty('routeId');
    });

    it.each(POSITIVE_FEEDBACK_CATEGORIES)('accepts the %s category', async (category) => {
        const { response, json } = await submit(seededFirestore(), positivePayload({ category }));

        expect(response.status).toBe(201);
        expect(json.report.category).toBe(category);
    });

    it('shares the REP- counter with issue reports', async () => {
        const db = seededFirestore({ counters: [{ id: 'reports', lastNumber: 41 }] });

        const issue = await submit(db, issuePayload());
        const positive = await submit(db, positivePayload());

        expect(issue.json.report.reportId).toBe('REP-00042');
        expect(positive.json.report.reportId).toBe('REP-00043');
    });

    it('files the feedback under the session, not a passengerId in the body', async () => {
        const db = seededFirestore();

        const { json } = await submit(db, positivePayload({ passengerId: OTHER_PASSENGER }));

        expect((await stored(db, json.report.reportId)).passengerId).toBe(AUTHOR);
    });

    it('rejects a bus that does not exist, as issue reports do', async () => {
        const { response } = await submit(seededFirestore(), positivePayload({ busId: 'BUS-99999' }));

        expect(response.status).toBe(404);
    });
});

// ==================================================================
// Server-owned state
// ==================================================================
describe('POST /api/reports - positive feedback cannot arrive decided', () => {
    it('ignores a VERIFIED status in the body', async () => {
        const db = seededFirestore();

        const { response, json } = await submit(db, positivePayload({ status: 'VERIFIED' }));

        expect(response.status).toBe(201);
        expect(json.report.status).toBe('PENDING');
        expect((await stored(db, json.report.reportId)).status).toBe('PENDING');
    });

    it('ignores a REJECTED status in the body', async () => {
        const db = seededFirestore();

        const { json } = await submit(db, positivePayload({ status: 'REJECTED' }));

        expect((await stored(db, json.report.reportId)).status).toBe('PENDING');
    });

    it('ignores review fields in the body, so it cannot claim an admin verified it', async () => {
        const db = seededFirestore();

        const { json } = await submit(
            db,
            positivePayload({
                reviewedBy: AUTHOR,
                reviewedAt: '2026-01-01T00:00:00.000Z',
                adminRemark: 'Looks good to me',
                requiresAdminReview: true,
                agreeCount: 50,
            })
        );
        const record = await stored(db, json.report.reportId);

        expect(record).not.toHaveProperty('reviewedBy');
        expect(record).not.toHaveProperty('reviewedAt');
        expect(record).not.toHaveProperty('adminRemark');
        expect(record).not.toHaveProperty('requiresAdminReview');
        expect(record).not.toHaveProperty('agreeCount');
    });

    it('does not let the author verify their own feedback through review', async () => {
        const db = seededFirestore();
        const { json } = await submit(db, positivePayload());

        const response = await reviewReport(
            jsonRequest(`/api/reports/${json.report.reportId}/review`, 'POST', {
                token: AUTHOR_SESSION,
                body: { action: 'VERIFY' },
            }),
            params(json.report.reportId)
        );

        expect(response.status).toBe(403);
        expect((await stored(db, json.report.reportId)).status).toBe('PENDING');
    });
});

// ==================================================================
// Authorisation
// ==================================================================
describe('POST /api/reports - positive feedback authorisation', () => {
    it('rejects a request with no session', async () => {
        const db = seededFirestore();

        const { response, json } = await submit(db, positivePayload(), null);

        expect(response.status).toBe(401);
        expect(json.success).toBe(false);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('rejects a token that does not verify', async () => {
        const { response } = await submit(seededFirestore(), positivePayload(), 'forged-session');

        expect(response.status).toBe(401);
    });

    it.each([
        ['an admin', ADMIN_SESSION],
        ['a driver', DRIVER_SESSION],
    ])('rejects %s', async (_label, token) => {
        const db = seededFirestore();

        const { response, json } = await submit(db, positivePayload(), token);

        expect(response.status).toBe(403);
        expect(json.message).toMatch(/only passengers/i);
        // Refused before an id was generated or anything written.
        expect((await db.collection('counters').doc('reports').get()).exists).toBe(false);
    });
});

// ==================================================================
// Validation
// ==================================================================
describe('POST /api/reports - positive feedback validation', () => {
    async function expectRejected(body: unknown, message: RegExp) {
        const db = seededFirestore();
        const { response, json } = await submit(db, body);

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(message);

        // Refused before an id was generated or anything written.
        expect((await db.collection('counters').doc('reports').get()).exists).toBe(false);
    }

    it('rejects a positive category sent without a type', async () => {
        await expectRejected(
            { category: 'HELPFUL_DRIVER', description: DESCRIPTION },
            /report type is required/i
        );
    });

    it.each(['NEGATIVE', 'positive', 'COMPLIMENT'])('rejects the invalid type %s', async (type) => {
        await expectRejected(positivePayload({ type }), /report type must be one of/i);
    });

    it.each([42, true, ['POSITIVE'], { value: 'POSITIVE' }])(
        'rejects a type that is not a string (%p)',
        async (type) => {
            await expectRejected(positivePayload({ type }), /report type must be one of/i);
        }
    );

    it('rejects a missing category', async () => {
        await expectRejected(
            positivePayload({ category: undefined }),
            /feedback category and description are required/i
        );
    });

    it('rejects an empty category', async () => {
        await expectRejected(
            positivePayload({ category: '' }),
            /feedback category and description are required/i
        );
    });

    it('rejects an unknown category', async () => {
        await expectRejected(positivePayload({ category: 'FRIENDLY_CAT' }), /invalid feedback category/i);
    });

    it('rejects an issue category offered as a positive one', async () => {
        await expectRejected(positivePayload({ category: 'BROKEN_RAMP' }), /invalid feedback category/i);
    });

    it('rejects a category that is not a string', async () => {
        await expectRejected(positivePayload({ category: 7 }), /invalid feedback category/i);
    });

    it('rejects a missing description', async () => {
        await expectRejected(
            positivePayload({ description: undefined }),
            /feedback category and description are required/i
        );
    });

    it('rejects an empty description', async () => {
        await expectRejected(
            positivePayload({ description: '' }),
            /feedback category and description are required/i
        );
    });

    it('rejects a description that is only whitespace', async () => {
        await expectRejected(positivePayload({ description: '   \n\t ' }), /description cannot be empty/i);
    });

    it('rejects a description that is not a string', async () => {
        await expectRejected(positivePayload({ description: 12345 }), /description cannot be empty/i);
    });

    it('rejects positive feedback that also carries an issue category', async () => {
        await expectRejected(
            positivePayload({ issueCategory: 'BROKEN_RAMP' }),
            /cannot carry an issue category/i
        );
    });

    it('rejects an explicit issue report that carries a feedback category', async () => {
        await expectRejected(
            issuePayload({ type: 'ISSUE', category: 'HELPFUL_DRIVER' }),
            /cannot carry a feedback category/i
        );
    });

    it('rejects a body that is not JSON', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            jsonRequest('/api/reports', 'POST', { token: AUTHOR_SESSION, rawBody: '{not json' })
        );

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('Invalid request body.');
    });

    it('rejects a body that is a list rather than an object', async () => {
        await expectRejected([positivePayload()], /invalid request body/i);
    });
});

// ==================================================================
// Issue reports are unchanged
// ==================================================================
describe('POST /api/reports - issue reports still work', () => {
    it('creates an issue report with no type, stored exactly as before', async () => {
        const db = seededFirestore();

        const { response, json } = await submit(db, issuePayload());
        const record = await stored(db, json.report.reportId);

        expect(response.status).toBe(201);
        expect(json.message).toBe('Accessibility report submitted successfully.');
        expect(record).toEqual({
            reportId: 'REP-00001',
            passengerId: AUTHOR,
            issueCategory: 'BROKEN_RAMP',
            description: 'The wheelchair ramp would not fold down at Pettah station.',
            status: 'PENDING',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
        });
        expect(record).not.toHaveProperty('type');
        expect(reportTypeOf(record)).toBe('ISSUE');
    });

    it('accepts an explicit ISSUE type without storing it', async () => {
        const db = seededFirestore();

        const { response, json } = await submit(db, issuePayload({ type: 'ISSUE' }));

        expect(response.status).toBe(201);
        expect(await stored(db, json.report.reportId)).not.toHaveProperty('type');
    });

    it('still refuses a positive category as an issue category', async () => {
        const { response, json } = await submit(
            seededFirestore(),
            issuePayload({ issueCategory: 'HELPFUL_DRIVER' })
        );

        expect(response.status).toBe(400);
        expect(json.message).toBe('Invalid issue category.');
    });

    it('still gives an issue report with no category the existing message', async () => {
        const { response, json } = await submit(
            seededFirestore(),
            issuePayload({ issueCategory: undefined })
        );

        expect(response.status).toBe(400);
        expect(json.message).toBe('Issue category and description are required.');
    });
});

// ==================================================================
// Admin review — the existing route, unchanged
// ==================================================================
describe('admin review of positive feedback', () => {
    it('shows PENDING positive feedback in the review queue', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload());

        const { response, json } = await list(db, 'review', ADMIN_SESSION);
        const entry = json.reports.find((report: any) => report.reportId === created.report.reportId);

        expect(response.status).toBe(200);
        expect(entry).toMatchObject({ type: 'POSITIVE', category: 'HELPFUL_DRIVER', status: 'PENDING' });
        expect(entry.review).toBeNull();
    });

    it('lets an admin read positive feedback for review', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload());
        mockGetAdminDb.mockReturnValue(db);

        const response = await getReportForReview(
            jsonRequest(`/api/reports/${created.report.reportId}/review`, 'GET', {
                token: ADMIN_SESSION,
            }),
            params(created.report.reportId)
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report).toMatchObject({ type: 'POSITIVE', category: 'HELPFUL_DRIVER' });
    });

    it('lets an admin VERIFY positive feedback', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload({ busId: BUS_ID, routeId: ROUTE_ID }));
        const reportId = created.report.reportId;

        const { response, json } = await review(db, reportId, {
            action: 'VERIFY',
            adminRemark: 'Confirmed with the depot.',
        });
        const record = await stored(db, reportId);

        expect(response.status).toBe(200);
        expect(json.message).toBe('Report marked VERIFIED.');
        expect(record).toMatchObject({
            reportId,
            passengerId: AUTHOR,
            type: 'POSITIVE',
            category: 'HELPFUL_DRIVER',
            description: DESCRIPTION,
            busId: BUS_ID,
            routeId: ROUTE_ID,
            status: 'VERIFIED',
            reviewedBy: ADMIN_UID,
            reviewedAt: expect.any(String),
            adminRemark: 'Confirmed with the depot.',
        });
        // The review writes its own keys and nothing else: the feedback's
        // content is exactly as it was filed, ready for MOV-302 to read.
        expect(record).not.toHaveProperty('issueCategory');
    });

    it('lets an admin REJECT positive feedback', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload());
        const reportId = created.report.reportId;

        const { response, json } = await review(db, reportId, { action: 'REJECT' });

        expect(response.status).toBe(200);
        expect(json.message).toBe('Report marked REJECTED.');
        expect((await stored(db, reportId)).status).toBe('REJECTED');
    });

    it('does not decide positive feedback twice', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload());
        const reportId = created.report.reportId;

        await review(db, reportId, { action: 'VERIFY' });
        const { response } = await review(db, reportId, { action: 'REJECT' });

        expect(response.status).toBe(409);
        expect((await stored(db, reportId)).status).toBe('VERIFIED');
    });

    it('still reviews issue reports the same way', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, issuePayload());
        const reportId = created.report.reportId;

        const { response } = await review(db, reportId, { action: 'VERIFY' });
        const record = await stored(db, reportId);

        expect(response.status).toBe(200);
        expect(record.status).toBe('VERIFIED');
        expect(record.issueCategory).toBe('BROKEN_RAMP');
        expect(record).not.toHaveProperty('type');
    });
});

// ==================================================================
// Visibility — the existing scope rules, applied as they are
// ==================================================================
describe('GET /api/reports - positive feedback visibility', () => {
    async function threeFeedbacks() {
        const db = seededFirestore();
        const pending = (await submit(db, positivePayload())).json.report.reportId;
        const verified = (await submit(db, positivePayload({ category: 'CLEAR_STOP_ANNOUNCEMENT' })))
            .json.report.reportId;
        const rejected = (await submit(db, positivePayload({ category: 'GOOD_PRIORITY_SEATING' })))
            .json.report.reportId;

        await review(db, verified, { action: 'VERIFY' });
        await review(db, rejected, { action: 'REJECT' });

        return { db, pending, verified, rejected };
    }

    it('shows the author all of their own feedback, PENDING and REJECTED included', async () => {
        const { db, pending, verified, rejected } = await threeFeedbacks();

        const { ids } = await list(db, 'my', AUTHOR_SESSION);

        expect(ids).toEqual(expect.arrayContaining([pending, verified, rejected]));
    });

    it('keeps PENDING feedback out of the verified scope until an admin verifies it', async () => {
        const { db, pending, verified, rejected } = await threeFeedbacks();

        const { ids } = await list(db, 'verified', OTHER_SESSION);

        expect(ids).toEqual([verified]);
        expect(ids).not.toContain(pending);
        expect(ids).not.toContain(rejected);
    });

    it('drops REJECTED feedback from the all scope, as it does for issues', async () => {
        const { db, pending, verified, rejected } = await threeFeedbacks();

        const { ids } = await list(db, 'all', OTHER_SESSION);

        expect(ids).toEqual(expect.arrayContaining([pending, verified]));
        expect(ids).not.toContain(rejected);
    });

    it('does not show another passenger somebody else’s feedback under my', async () => {
        const { db } = await threeFeedbacks();

        const { ids } = await list(db, 'my', OTHER_SESSION);

        expect(ids).toEqual([]);
    });

    it('returns positive feedback from the single-report route in its stored shape', async () => {
        const { db, pending } = await threeFeedbacks();
        mockGetAdminDb.mockReturnValue(db);

        const response = await getReport(
            jsonRequest(`/api/reports/${pending}`, 'GET', { token: AUTHOR_SESSION }),
            params(pending)
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report).toMatchObject({ type: 'POSITIVE', category: 'HELPFUL_DRIVER' });
    });
});

// ==================================================================
// Editing — PUT keeps the type fixed
// ==================================================================
describe('PUT /api/reports/[reportId] - positive feedback', () => {
    it('lets the author edit PENDING positive feedback, keeping its shape', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;

        const { response, json } = await edit(db, reportId, {
            category: 'EASY_WHEELCHAIR_BOARDING',
            description: 'Updated: the ramp deployed first time.',
            routeId: ROUTE_ID,
        });
        const record = await stored(db, reportId);

        expect(response.status).toBe(200);
        expect(json.message).toBe('Positive accessibility feedback updated successfully.');
        expect(record).toMatchObject({
            type: 'POSITIVE',
            category: 'EASY_WHEELCHAIR_BOARDING',
            description: 'Updated: the ramp deployed first time.',
            routeId: ROUTE_ID,
            status: 'PENDING',
            passengerId: AUTHOR,
        });
        expect(record).not.toHaveProperty('issueCategory');
    });

    it('refuses to turn positive feedback into an issue report', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;

        const { response, json } = await edit(db, reportId, issuePayload({ type: 'ISSUE' }));

        expect(response.status).toBe(400);
        expect(json.message).toBe("A report's type cannot be changed.");
        expect(await stored(db, reportId)).toMatchObject({ type: 'POSITIVE', category: 'HELPFUL_DRIVER' });
    });

    it('refuses an issue category on positive feedback even without a type', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;

        const { response } = await edit(db, reportId, issuePayload());

        expect(response.status).toBe(400);
        expect(await stored(db, reportId)).not.toHaveProperty('issueCategory');
    });

    it('refuses to turn an issue report into positive feedback', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, issuePayload())).json.report.reportId;

        const { response } = await edit(db, reportId, positivePayload());

        expect(response.status).toBe(400);
        expect(await stored(db, reportId)).not.toHaveProperty('type');
    });

    it('validates the category on edit', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;

        const { response, json } = await edit(db, reportId, {
            category: 'NOT_A_CATEGORY',
            description: DESCRIPTION,
        });

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/invalid feedback category/i);
    });

    it('refuses an edit once an admin has decided the feedback', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;
        await review(db, reportId, { action: 'VERIFY' });

        const { response } = await edit(db, reportId, positivePayload({ description: 'Changed' }));

        expect(response.status).toBe(409);
        expect((await stored(db, reportId)).description).toBe(DESCRIPTION);
    });

    it('does not let another passenger edit the feedback', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;

        const { response } = await edit(db, reportId, positivePayload(), OTHER_SESSION);

        expect(response.status).toBe(403);
    });

    it('still edits an issue report without adding a type', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, issuePayload())).json.report.reportId;

        const { response, json } = await edit(db, reportId, issuePayload({ issueCategory: 'LIFT_NOT_WORKING' }));
        const record = await stored(db, reportId);

        expect(response.status).toBe(200);
        expect(json.message).toBe('Accessibility report updated successfully.');
        expect(record.issueCategory).toBe('LIFT_NOT_WORKING');
        expect(record).not.toHaveProperty('type');
        expect(record).not.toHaveProperty('category');
    });
});

// ==================================================================
// The content rules, directly
// ==================================================================
describe('reportContent', () => {
    it('reads a body without a type as an issue report', () => {
        expect(readRequestedReportType({ issueCategory: 'BROKEN_RAMP' })).toEqual({
            ok: true,
            value: 'ISSUE',
        });
    });

    it('reads an explicit POSITIVE type', () => {
        expect(readRequestedReportType({ type: 'POSITIVE' })).toEqual({ ok: true, value: 'POSITIVE' });
    });

    it('builds the positive content with a trimmed description', () => {
        expect(
            readReportContent({ category: 'HELPFUL_DRIVER', description: '  Kind.  ' }, 'POSITIVE')
        ).toEqual({
            ok: true,
            value: { type: 'POSITIVE', category: 'HELPFUL_DRIVER', description: 'Kind.' },
        });
    });

    it('builds the issue content without a type', () => {
        expect(
            readReportContent({ issueCategory: 'BROKEN_RAMP', description: ' Broken. ' }, 'ISSUE')
        ).toEqual({ ok: true, value: { issueCategory: 'BROKEN_RAMP', description: 'Broken.' } });
    });
});
