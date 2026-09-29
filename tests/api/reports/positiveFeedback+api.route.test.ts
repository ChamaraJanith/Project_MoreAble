// Positive accessibility feedback through the existing report API (MOV-301).
//
// Positive feedback is not a second API. It is a second TYPE of report, filed
// through POST /api/reports with `type: 'POSITIVE'` and stored in the same
// `reports` collection under the same REP- counter. Unlike an issue report it
// needs NO admin review: it is filed PUBLISHED and counts as filed. So every
// step below is a real request through a real handler, and the same Firestore
// double the rest of the report suites use.
//
// What this file holds the backend to:
//   - only an authenticated passenger can submit it, and it is always filed
//     PUBLISHED whatever the body claims — never VERIFIED, which would claim an
//     admin review that did not happen, and never PENDING, which would leave it
//     waiting for one that is not coming;
//   - it is stored as { type: 'POSITIVE', category, description, … } and never
//     carries an `issueCategory`, so nothing that reads issues can mistake it
//     for one — while issue reports are stored exactly as they were;
//   - the review route refuses to VERIFY or REJECT it (409), while an admin can
//     still open it, and issue reports are reviewed exactly as before.

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
import { submitPositiveFeedback } from '../../../src/features/reports/api/positiveFeedbackApi';
import { buildPositiveFeedbackPayload } from '../../../src/features/reports/utils/positiveFeedbackValidation';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the signature check is stubbed; authenticateRequest runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// The app's API base URL, which reads Expo config at import time.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: 'http://localhost' }));

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

    it('files the feedback PUBLISHED: no admin review, and never VERIFIED', async () => {
        const db = seededFirestore();

        const { json } = await submit(db, positivePayload());
        const record = await stored(db, json.report.reportId);

        expect(json.report.status).toBe('PUBLISHED');
        expect(record.status).toBe('PUBLISHED');
        expect(record.status).not.toBe('VERIFIED');
        // Nothing claims an admin looked at it.
        expect(record).not.toHaveProperty('reviewedBy');
        expect(record).not.toHaveProperty('reviewedAt');
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
            status: 'PUBLISHED',
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
        expect(json.report.status).toBe('PUBLISHED');
        expect((await stored(db, json.report.reportId)).status).toBe('PUBLISHED');
    });

    it('ignores a REJECTED status in the body', async () => {
        const db = seededFirestore();

        const { json } = await submit(db, positivePayload({ status: 'REJECTED' }));

        expect((await stored(db, json.report.reportId)).status).toBe('PUBLISHED');
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
        expect((await stored(db, json.report.reportId)).status).toBe('PUBLISHED');
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

/**
 * Positive feedback stored under the workflow that existed before this change,
 * when it was filed PENDING and could be verified or rejected. The API can no
 * longer produce these, so they are seeded as they would sit in Firestore.
 */
function legacyPositive(reportId: string, status: string, overrides: Record<string, any> = {}) {
    return {
        id: reportId,
        reportId,
        passengerId: AUTHOR,
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        description: DESCRIPTION,
        status,
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        updatedAt: new Date('2026-09-01T08:00:00.000Z'),
        ...overrides,
    };
}

// ==================================================================
// Admin review — positive feedback has no Verify/Reject workflow
// ==================================================================
describe('admin review of positive feedback', () => {
    it('shows positive feedback in the review queue as PUBLISHED, with no review and no flag', async () => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload());

        const { response, json } = await list(db, 'review', ADMIN_SESSION);
        const entry = json.reports.find((report: any) => report.reportId === created.report.reportId);

        expect(response.status).toBe(200);
        expect(entry).toMatchObject({ type: 'POSITIVE', category: 'HELPFUL_DRIVER', status: 'PUBLISHED' });
        expect(entry.review).toBeNull();
        expect(entry.flagged).toBe(false);
    });

    it('keeps positive feedback out of the Pending review queue', async () => {
        const db = seededFirestore();
        const positive = (await submit(db, positivePayload())).json.report.reportId;
        const issue = (await submit(db, issuePayload())).json.report.reportId;
        mockGetAdminDb.mockReturnValue(db);

        const response = await listReports(
            jsonRequest('/api/reports?scope=review&status=PENDING', 'GET', { token: ADMIN_SESSION })
        );
        const ids = (await response.json()).reports.map((report: any) => report.reportId);

        expect(ids).toEqual([issue]);
        expect(ids).not.toContain(positive);
    });

    it('never flags positive feedback for admin review, however many passengers agree', async () => {
        const db = seededFirestore({
            reports: [legacyPositive('REP-00050', 'PUBLISHED', { agreeCount: 12, requiresAdminReview: true })],
        });

        const { json } = await list(db, 'review', ADMIN_SESSION);

        expect(json.reports[0].flagged).toBe(false);
        expect(json.flaggedCount).toBe(0);
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

    it.each(['VERIFY', 'REJECT'])('refuses to %s positive feedback, leaving it untouched', async (action) => {
        const db = seededFirestore();
        const { json: created } = await submit(db, positivePayload({ busId: BUS_ID, routeId: ROUTE_ID }));
        const reportId = created.report.reportId;
        const before = await stored(db, reportId);

        const { response, json } = await review(db, reportId, { action, adminRemark: 'Looks fine.' });

        expect(response.status).toBe(409);
        expect(json.success).toBe(false);
        expect(json.message).toBe(
            'Positive feedback does not require admin review and cannot be verified or rejected.'
        );
        // Nothing was written: no status change, and no claim of a review.
        expect(await stored(db, reportId)).toEqual(before);
    });

    it.each(['VERIFY', 'REJECT'])(
        'refuses to %s legacy positive feedback still stored PENDING',
        async (action) => {
            const db = seededFirestore({ reports: [legacyPositive('REP-00050', 'PENDING')] });

            const { response } = await review(db, 'REP-00050', { action });

            expect(response.status).toBe(409);
            expect((await stored(db, 'REP-00050')).status).toBe('PENDING');
        }
    );

    it('still lets an admin leave a remark on positive feedback, without deciding it', async () => {
        const db = seededFirestore();
        const reportId = (await submit(db, positivePayload())).json.report.reportId;

        const { response } = await review(db, reportId, { action: 'REMARK', adminRemark: 'Thanks, noted.' });
        const record = await stored(db, reportId);

        expect(response.status).toBe(200);
        expect(record.status).toBe('PUBLISHED');
        expect(record.adminRemark).toBe('Thanks, noted.');
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
//
// The listing scopes themselves are unchanged. `scope=verified` still means
// "an admin verified it", so PUBLISHED feedback is not in it.
// ==================================================================
describe('GET /api/reports?scope=all - the public community feed', () => {
    async function mixedFeed() {
        const db = seededFirestore();
        const verifiedIssue = (await submit(db, issuePayload())).json.report.reportId;
        const pendingIssue = (await submit(db, issuePayload())).json.report.reportId;
        const rejectedIssue = (await submit(db, issuePayload())).json.report.reportId;
        const feedback = (await submit(db, positivePayload())).json.report.reportId;

        await review(db, verifiedIssue, { action: 'VERIFY' });
        await review(db, rejectedIssue, { action: 'REJECT' });

        return { db, verifiedIssue, pendingIssue, rejectedIssue, feedback };
    }

    it('shows another passenger only VERIFIED issues and positive feedback', async () => {
        const { db, verifiedIssue, pendingIssue, rejectedIssue, feedback } = await mixedFeed();

        const { ids, json } = await list(db, 'all', OTHER_SESSION);

        expect(ids).toEqual(expect.arrayContaining([verifiedIssue, feedback]));
        expect(ids).not.toContain(pendingIssue);
        expect(ids).not.toContain(rejectedIssue);
        expect(json.count).toBe(2);
    });

    it('is the same public feed for the author: pending issues are followed under My Reports', async () => {
        const { db, pendingIssue, rejectedIssue } = await mixedFeed();

        expect((await list(db, 'all', AUTHOR_SESSION)).ids).not.toContain(pendingIssue);
        expect((await list(db, 'my', AUTHOR_SESSION)).ids).toEqual(
            expect.arrayContaining([pendingIssue, rejectedIssue])
        );
    });

    it('treats a request with no scope as the public feed, never the full collection', async () => {
        const { db, pendingIssue } = await mixedFeed();
        mockGetAdminDb.mockReturnValue(db);

        const response = await listReports(jsonRequest('/api/reports', 'GET', { token: OTHER_SESSION }));
        const ids = (await response.json()).reports.map((report: any) => report.reportId);

        expect(ids).not.toContain(pendingIssue);
    });

    it("never shows another passenger somebody else's pending issue under my", async () => {
        const { db } = await mixedFeed();

        expect((await list(db, 'my', OTHER_SESSION)).ids).toEqual([]);
    });

    it('still gives an admin every report through the review scope', async () => {
        const { db, verifiedIssue, pendingIssue, rejectedIssue, feedback } = await mixedFeed();

        const { ids } = await list(db, 'review', ADMIN_SESSION);

        expect(ids).toEqual(expect.arrayContaining([verifiedIssue, pendingIssue, rejectedIssue, feedback]));
    });

    it('leaves positive feedback stored PUBLISHED', async () => {
        const { db, feedback } = await mixedFeed();

        expect((await stored(db, feedback)).status).toBe('PUBLISHED');
    });
});

describe('GET /api/reports - positive feedback visibility', () => {
    async function threeFeedbacks() {
        const db = seededFirestore({
            reports: [
                legacyPositive('REP-00090', 'VERIFIED', { category: 'CLEAR_STOP_ANNOUNCEMENT' }),
                legacyPositive('REP-00091', 'REJECTED', { category: 'GOOD_PRIORITY_SEATING' }),
            ],
            counters: [{ id: 'reports', lastNumber: 91 }],
        });
        const published = (await submit(db, positivePayload())).json.report.reportId;

        return { db, published, verified: 'REP-00090', rejected: 'REP-00091' };
    }

    it('shows the author all of their own feedback, REJECTED included', async () => {
        const { db, published, verified, rejected } = await threeFeedbacks();

        const { ids } = await list(db, 'my', AUTHOR_SESSION);

        expect(ids).toEqual(expect.arrayContaining([published, verified, rejected]));
    });

    it('keeps the verified scope to what an admin actually verified', async () => {
        const { db, published, verified, rejected } = await threeFeedbacks();

        const { ids } = await list(db, 'verified', OTHER_SESSION);

        expect(ids).toEqual([verified]);
        expect(ids).not.toContain(published);
        expect(ids).not.toContain(rejected);
    });

    it('shows PUBLISHED feedback in the all scope straight away, and drops REJECTED', async () => {
        const { db, published, verified, rejected } = await threeFeedbacks();

        const { ids } = await list(db, 'all', OTHER_SESSION);

        expect(ids).toEqual(expect.arrayContaining([published, verified]));
        expect(ids).not.toContain(rejected);
    });

    it('does not show another passenger somebody else’s feedback under my', async () => {
        const { db } = await threeFeedbacks();

        const { ids } = await list(db, 'my', OTHER_SESSION);

        expect(ids).toEqual([]);
    });

    it('returns positive feedback from the single-report route in its stored shape', async () => {
        const { db, published } = await threeFeedbacks();
        mockGetAdminDb.mockReturnValue(db);

        const response = await getReport(
            jsonRequest(`/api/reports/${published}`, 'GET', { token: AUTHOR_SESSION }),
            params(published)
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
    it('lets the author edit PUBLISHED positive feedback, keeping its shape and status', async () => {
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
            status: 'PUBLISHED',
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

    it.each(['VERIFIED', 'REJECTED'])(
        'still refuses an edit to legacy feedback an admin %s',
        async (status) => {
            const db = seededFirestore({ reports: [legacyPositive('REP-00050', status)] });

            const { response } = await edit(db, 'REP-00050', positivePayload({ description: 'Changed' }));

            expect(response.status).toBe(409);
            expect((await stored(db, 'REP-00050')).description).toBe(DESCRIPTION);
        }
    );

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

// ==================================================================
// End to end: the screen's client → POST /api/reports → Firestore
//
// The regression this guards: the MOV-300 client used to simulate success in
// development builds without ever sending the request, so the screen thanked
// the passenger while nothing reached Firestore. Here `fetch` is routed into
// the real handler, so the only thing not exercised is the network itself.
// ==================================================================
describe('positive feedback from the screen client to Firestore', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function routeFetchTo(db: any) {
        const calls: Request[] = [];

        global.fetch = (async (input: any, init?: RequestInit) => {
            const request = new Request(String(input), init);
            calls.push(request.clone());
            mockGetAdminDb.mockReturnValue(db);

            return createReport(request);
        }) as typeof fetch;

        return calls;
    }

    it('sends the request and stores the feedback as a PUBLISHED report', async () => {
        const db = seededFirestore({ counters: [{ id: 'reports', lastNumber: 11 }] });
        const calls = routeFetchTo(db);

        const payload = buildPositiveFeedbackPayload({
            category: 'CLEAR_STOP_ANNOUNCEMENT',
            description: '  Every stop was announced clearly on the display and audio.  ',
            routeId: ROUTE_ID,
            busId: BUS_ID,
        })!;

        const result = await submitPositiveFeedback(payload, AUTHOR_SESSION);

        // The request actually left the client, to the existing endpoint.
        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('POST');
        expect(new URL(calls[0].url).pathname).toBe('/api/reports');
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${AUTHOR_SESSION}`);
        expect(await calls[0].json()).toEqual({
            type: 'POSITIVE',
            category: 'CLEAR_STOP_ANNOUNCEMENT',
            description: 'Every stop was announced clearly on the display and audio.',
            routeId: ROUTE_ID,
            busId: BUS_ID,
        });

        // The response carries the created report.
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.report.reportId).toBe('REP-00012');

        // And the document is in the reports collection.
        expect(await stored(db, 'REP-00012')).toEqual({
            reportId: 'REP-00012',
            passengerId: AUTHOR,
            type: 'POSITIVE',
            category: 'CLEAR_STOP_ANNOUNCEMENT',
            description: 'Every stop was announced clearly on the display and audio.',
            busId: BUS_ID,
            vehicle: {
                numberPlate: 'NB-1234',
                busModel: 'Ashok Leyland Viking',
                manufacturer: 'Ashok Leyland',
            },
            routeId: ROUTE_ID,
            route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
            status: 'PUBLISHED',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
        });
    });

    it('reports a refusal instead of success, and writes nothing', async () => {
        const db = seededFirestore();
        routeFetchTo(db);

        const result = await submitPositiveFeedback(
            buildPositiveFeedbackPayload({
                category: 'HELPFUL_DRIVER',
                description: DESCRIPTION,
                routeId: null,
                busId: 'BUS-99999',
            })!,
            AUTHOR_SESSION
        );

        expect(result).toMatchObject({ ok: false, status: 404 });
        expect((await db.collection('counters').doc('reports').get()).exists).toBe(false);
    });

    it('does not report success for a session the API refuses', async () => {
        const db = seededFirestore();
        routeFetchTo(db);

        const result = await submitPositiveFeedback(
            buildPositiveFeedbackPayload({
                category: 'HELPFUL_DRIVER',
                description: DESCRIPTION,
                routeId: null,
                busId: null,
            })!,
            ADMIN_SESSION
        );

        expect(result).toMatchObject({ ok: false, status: 403 });
    });
});
