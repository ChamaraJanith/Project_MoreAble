// Admin review of accessibility reports (MOV-161).
//
// The rule these tests exist for is authorisation. The app will only draw
// Verify and Reject on an admin's screen, but drawing is not a permission: the
// request can be made by anyone who knows the URL, and what stops it is these
// routes reading the role off the verified token.
//
// The second rule is that a review writes a review and nothing else. A decision
// names an ACTION, never a status, and the fields it stores are an allow-list —
// so a request carrying passengerId, agreeCount or a status of its own choosing
// changes none of them, which is what most of the assertions below are about.

import {
    GET as getReports,
} from '../../../app/api/reports/index+api';
import {
    GET as getReportForReview,
    POST as reviewReport,
} from '../../../app/api/reports/[reportId]/review+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the signature check is stubbed, so the Authorization header parsing in
// authenticateRequest runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const ADMIN_UID = 'UID-ADMIN';
const PASSENGER = 'PSG-00001';

const ADMIN_SESSION = 'session-admin';
const PASSENGER_SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: {
        uid: ADMIN_UID,
        passengerId: 'PSG-ADMIN',
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
    [PASSENGER_SESSION]: {
        uid: 'UID-P1',
        passengerId: PASSENGER,
        role: 'PASSENGER',
        email: 'passenger@example.com',
    },
};

const REPORT_ID = 'REP-00007';
const OTHER_REPORT_ID = 'REP-00008';

const FILED_AT = new Date('2026-08-20T14:05:00.000Z');

const PHOTO_A = 'https://res.cloudinary.com/moreable/image/upload/v1/a.jpg';
const PHOTO_B = 'https://res.cloudinary.com/moreable/image/upload/v1/b.jpg';

function storedReport(overrides: Record<string, any> = {}) {
    return {
        // The fake derives a document id from `id` — a report document also
        // carries busId and routeId, so it has to be given explicitly.
        id: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: PASSENGER,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234', busModel: 'Rosa' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
        photoUrls: [PHOTO_A, PHOTO_B],
        agreeCount: 6,
        disagreeCount: 1,
        requiresAdminReview: true,
        adminReviewFlaggedAt: '2026-08-21T09:00:00.000Z',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

/** A second, unflagged report, so the queue has something to tell apart. */
function quietReport(overrides: Record<string, any> = {}) {
    return {
        id: OTHER_REPORT_ID,
        reportId: OTHER_REPORT_ID,
        passengerId: 'PSG-00002',
        issueCategory: 'BUS_OVERCROWDED',
        description: 'No space to board with a wheelchair at 07:40.',
        status: 'PENDING',
        agreeCount: 1,
        disagreeCount: 0,
        createdAt: new Date('2026-08-22T06:40:00.000Z'),
        updatedAt: new Date('2026-08-22T06:40:00.000Z'),
        ...overrides,
    };
}

function votesFor(reportId: string, agree: number, disagree: number) {
    const votes: Record<string, any>[] = [];

    for (let index = 0; index < agree; index += 1) {
        votes.push({ id: `${reportId}__A${index}`, reportId, vote: 'AGREE' });
    }

    for (let index = 0; index < disagree; index += 1) {
        votes.push({ id: `${reportId}__D${index}`, reportId, vote: 'DISAGREE' });
    }

    return votes;
}

function storedComment(commentId: string, reportId: string, text: string, createdAt: string) {
    return {
        id: commentId,
        commentId,
        reportId,
        passengerId: 'PSG-00003',
        authorName: 'Nimali',
        text,
        createdAt,
    };
}

/** The reports collection plus the votes and comments hanging off it. */
function firestoreWith(reports: Record<string, any>[] = [storedReport(), quietReport()]) {
    return createFakeFirestore({
        reports,
        votes: [...votesFor(REPORT_ID, 6, 1), ...votesFor(OTHER_REPORT_ID, 1, 0)],
        comments: [
            storedComment('CMT-00001', REPORT_ID, 'Same on the 138 last week.', '2026-08-21T08:00:00.000Z'),
            storedComment('CMT-00002', REPORT_ID, 'Ramp is fixed now.', '2026-08-22T08:00:00.000Z'),
            storedComment('CMT-00003', OTHER_REPORT_ID, 'Always full at that hour.', '2026-08-22T09:00:00.000Z'),
        ],
    });
}

function reviewRequest(
    method: string,
    options: { token?: string; body?: unknown; reportId?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(
        `http://localhost/api/reports/${options.reportId ?? REPORT_ID}/review`,
        {
            method,
            headers,
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        }
    );
}

function listRequest(options: { token?: string; query?: string } = {}): Request {
    const headers: Record<string, string> = {};

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(`http://localhost/api/reports${options.query ?? '?scope=review'}`, {
        method: 'GET',
        headers,
    });
}

/** The params Expo Router hands the handler for this route. */
function params(reportId: string = REPORT_ID) {
    return { reportId };
}

/** The report as Firestore holds it after the handler has run. */
async function storedDocument(db: any, reportId: string = REPORT_ID) {
    const doc = await db.collection('reports').doc(reportId).get();

    return doc.data();
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Authentication and authorisation
// ==================================================================
describe('admin review - who may ask', () => {
    it('refuses the review queue without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(listRequest());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses report details for review without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(reviewRequest('GET'), params());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses a review action without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await reviewReport(
            reviewRequest('POST', { body: { action: 'VERIFY' } }),
            params()
        );

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses a token that does not verify', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(
            reviewRequest('GET', { token: 'forged-session' }),
            params()
        );

        expect(response.status).toBe(401);
    });

    it('refuses the review queue to a passenger', async () => {
        // A real, valid session that simply may not do this: 403, not 401, and
        // refused before any query runs.
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(listRequest({ token: PASSENGER_SESSION }));
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.success).toBe(false);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses report details for review to a passenger', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(
            reviewRequest('GET', { token: PASSENGER_SESSION }),
            params()
        );

        expect(response.status).toBe(403);
    });

    it('refuses a passenger the admin review actions', async () => {
        // The whole point of the ticket: hiding the buttons is not the control.
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: PASSENGER_SESSION,
                body: { action: 'VERIFY' },
            }),
            params()
        );

        expect(response.status).toBe(403);
        expect((await storedDocument(db)).status).toBe('PENDING');
    });

    it('still lets a passenger list their own reports', async () => {
        // scope=review is the admin slice; the passenger scopes are untouched.
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(
            listRequest({ token: PASSENGER_SESSION, query: '?scope=my' })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.reports.every((report: any) => report.passengerId === PASSENGER)).toBe(true);
    });
});

// ==================================================================
// The review queue
// ==================================================================
describe('GET /api/reports?scope=review', () => {
    it('lets an admin list every report awaiting review', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(listRequest({ token: ADMIN_SESSION }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(2);
        expect(json.reports.map((report: any) => report.reportId).sort()).toEqual([
            REPORT_ID,
            OTHER_REPORT_ID,
        ]);
    });

    it('returns everything the review page renders for a report', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(listRequest({ token: ADMIN_SESSION }));
        const json = await response.json();

        const report = json.reports.find((entry: any) => entry.reportId === REPORT_ID);

        expect(report.issueCategory).toBe('BROKEN_RAMP');
        expect(report.description).toContain('wheelchair ramp');
        expect(report.vehicle.numberPlate).toBe('NB-1234');
        expect(report.route.routeNumber).toBe('138');
        expect(report.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
        expect(report.status).toBe('PENDING');
        expect(report.agreeCount).toBe(6);
        expect(report.disagreeCount).toBe(1);
        expect(report.commentCount).toBe(2);
        expect(report.requiresAdminReview).toBe(true);
        expect(new Date(report.createdAt).toISOString()).toBe(FILED_AT.toISOString());
    });

    it('marks a report the community has pushed over the threshold as flagged', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(listRequest({ token: ADMIN_SESSION }));
        const json = await response.json();

        const flagged = json.reports.find((entry: any) => entry.reportId === REPORT_ID);
        const quiet = json.reports.find((entry: any) => entry.reportId === OTHER_REPORT_ID);

        expect(flagged.flagged).toBe(true);
        expect(quiet.flagged).toBe(false);
        expect(json.flaggedCount).toBe(1);
    });

    it('flags a report on five agreements even before the flag was written', async () => {
        // The threshold is the rule; requiresAdminReview is a record of it
        // having been crossed, and a report predating the flag still counts.
        mockGetAdminDb.mockReturnValue(
            firestoreWith([
                storedReport({ agreeCount: 5, requiresAdminReview: undefined }),
            ])
        );

        const response = await getReports(listRequest({ token: ADMIN_SESSION }));
        const json = await response.json();

        expect(json.reports[0].flagged).toBe(true);
        expect(json.reports[0].requiresAdminReview).toBe(false);
    });

    it('carries the review already recorded against a report', async () => {
        mockGetAdminDb.mockReturnValue(
            firestoreWith([
                storedReport({
                    status: 'VERIFIED',
                    reviewedBy: ADMIN_UID,
                    reviewedAt: '2026-08-23T10:00:00.000Z',
                    adminRemark: 'Depot confirmed the ramp motor had failed.',
                }),
            ])
        );

        const response = await getReports(listRequest({ token: ADMIN_SESSION }));
        const json = await response.json();

        expect(json.reports[0].review).toEqual({
            status: 'VERIFIED',
            reviewedBy: ADMIN_UID,
            reviewedAt: '2026-08-23T10:00:00.000Z',
            adminRemark: 'Depot confirmed the ramp motor had failed.',
        });
    });

    it('says so plainly when nobody has reviewed the report yet', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith([storedReport()]));

        const response = await getReports(listRequest({ token: ADMIN_SESSION }));
        const json = await response.json();

        expect(json.reports[0].review).toBeNull();
    });

    it('narrows the queue to one status when asked', async () => {
        mockGetAdminDb.mockReturnValue(
            firestoreWith([storedReport({ status: 'VERIFIED' }), quietReport()])
        );

        const response = await getReports(
            listRequest({ token: ADMIN_SESSION, query: '?scope=review&status=PENDING' })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.count).toBe(1);
        expect(json.reports[0].reportId).toBe(OTHER_REPORT_ID);
    });

    it('narrows the queue to flagged reports when asked', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(
            listRequest({ token: ADMIN_SESSION, query: '?scope=review&flagged=true' })
        );
        const json = await response.json();

        expect(json.count).toBe(1);
        expect(json.reports[0].reportId).toBe(REPORT_ID);
    });

    it('refuses a status that is not one a report can hold', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReports(
            listRequest({ token: ADMIN_SESSION, query: '?scope=review&status=DELETED' })
        );

        expect(response.status).toBe(400);
    });
});

// ==================================================================
// Report details for review
// ==================================================================
describe('GET /api/reports/[reportId]/review', () => {
    it('lets an admin read one report with everything needed to decide it', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(
            reviewRequest('GET', { token: ADMIN_SESSION }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.report.reportId).toBe(REPORT_ID);
        expect(json.report.issueCategory).toBe('BROKEN_RAMP');
        expect(json.report.description).toContain('wheelchair ramp');
        expect(json.report.vehicle.numberPlate).toBe('NB-1234');
        expect(json.report.route.direction).toBe('OUTBOUND');
        expect(json.report.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
        expect(json.report.status).toBe('PENDING');
        expect(json.report.requiresAdminReview).toBe(true);
        expect(json.report.flagged).toBe(true);
    });

    it('counts the votes themselves rather than trusting the stored tallies', async () => {
        // The tallies on the document are what the vote route last wrote. The
        // one screen that decides a report reads the votes.
        mockGetAdminDb.mockReturnValue(
            firestoreWith([storedReport({ agreeCount: 99, disagreeCount: 99 })])
        );

        const response = await getReportForReview(
            reviewRequest('GET', { token: ADMIN_SESSION }),
            params()
        );
        const json = await response.json();

        expect(json.report.agreeCount).toBe(6);
        expect(json.report.disagreeCount).toBe(1);
    });

    it('returns the report thread, newest comment first', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(
            reviewRequest('GET', { token: ADMIN_SESSION }),
            params()
        );
        const json = await response.json();

        expect(json.comments.map((comment: any) => comment.commentId)).toEqual([
            'CMT-00002',
            'CMT-00001',
        ]);
        expect(json.report.commentCount).toBe(2);
    });

    it('answers 404 for a report that is not there', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(
            reviewRequest('GET', { token: ADMIN_SESSION, reportId: 'REP-99999' }),
            params('REP-99999')
        );

        expect(response.status).toBe(404);
    });

    it('reads the report id from the path when no params are given', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReportForReview(
            reviewRequest('GET', { token: ADMIN_SESSION }),
            undefined
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report.reportId).toBe(REPORT_ID);
    });
});

// ==================================================================
// Verify
// ==================================================================
describe('POST /api/reports/[reportId]/review - VERIFY', () => {
    it('moves a pending report to VERIFIED', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'VERIFY' } }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.report.status).toBe('VERIFIED');
        expect((await storedDocument(db)).status).toBe('VERIFIED');
    });

    it('records who decided it and when', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const before = Date.now();

        const response = await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'VERIFY' } }),
            params()
        );
        const json = await response.json();

        const stored = await storedDocument(db);

        expect(stored.reviewedBy).toBe(ADMIN_UID);
        expect(json.review.reviewedBy).toBe(ADMIN_UID);
        expect(new Date(stored.reviewedAt).getTime()).toBeGreaterThanOrEqual(before);
        expect(new Date(stored.reviewedAt).toISOString()).toBe(stored.reviewedAt);
    });

    it('accepts a status that agrees with the action', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'VERIFY', status: 'VERIFIED' },
            }),
            params()
        );

        expect(response.status).toBe(200);
        expect((await storedDocument(db)).status).toBe('VERIFIED');
    });

    it('refuses to decide a report that has already been decided', async () => {
        const db = firestoreWith([
            storedReport({ status: 'REJECTED', reviewedBy: 'UID-OTHER-ADMIN' }),
        ]);
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'VERIFY' } }),
            params()
        );

        expect(response.status).toBe(409);

        const stored = await storedDocument(db);

        expect(stored.status).toBe('REJECTED');
        expect(stored.reviewedBy).toBe('UID-OTHER-ADMIN');
    });
});

// ==================================================================
// Reject
// ==================================================================
describe('POST /api/reports/[reportId]/review - REJECT', () => {
    it('moves a pending report to REJECTED', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'REJECT' } }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report.status).toBe('REJECTED');

        const stored = await storedDocument(db);

        expect(stored.status).toBe('REJECTED');
        expect(stored.reviewedBy).toBe(ADMIN_UID);
        expect(typeof stored.reviewedAt).toBe('string');
    });

    it('stores a remark alongside the decision', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'REJECT', adminRemark: 'Duplicate of REP-00003.' },
            }),
            params()
        );
        const json = await response.json();

        expect(json.report.adminRemark).toBe('Duplicate of REP-00003.');
        expect((await storedDocument(db)).adminRemark).toBe('Duplicate of REP-00003.');
    });
});

// ==================================================================
// Admin remark
// ==================================================================
describe('POST /api/reports/[reportId]/review - REMARK', () => {
    it('saves a remark without deciding the report', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'REMARK', adminRemark: '  Waiting on the depot.  ' },
            }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);

        const stored = await storedDocument(db);

        // Trimmed, and the status is exactly where it was.
        expect(stored.adminRemark).toBe('Waiting on the depot.');
        expect(stored.status).toBe('PENDING');
        expect(json.report.status).toBe('PENDING');
        expect(json.review.adminRemark).toBe('Waiting on the depot.');
    });

    it('can still be written after the report has been decided', async () => {
        const db = firestoreWith([storedReport({ status: 'VERIFIED', reviewedBy: ADMIN_UID })]);
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'REMARK', adminRemark: 'Depot has scheduled the repair.' },
            }),
            params()
        );

        expect(response.status).toBe(200);
        expect((await storedDocument(db)).status).toBe('VERIFIED');
    });

    it('refuses a remark that is only whitespace', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'REMARK', adminRemark: '   ' },
            }),
            params()
        );

        expect(response.status).toBe(400);
        expect((await storedDocument(db)).adminRemark).toBeUndefined();
    });

    it('refuses a remark longer than the cap', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'VERIFY', adminRemark: 'x'.repeat(501) },
            }),
            params()
        );

        expect(response.status).toBe(400);
    });
});

// ==================================================================
// Validation
// ==================================================================
describe('POST /api/reports/[reportId]/review - validation', () => {
    it('answers 404 for a report that is not there', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'VERIFY' },
                reportId: 'REP-99999',
            }),
            params('REP-99999')
        );

        expect(response.status).toBe(404);
    });

    it('refuses a body that is not an object', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const request = new Request(`http://localhost/api/reports/${REPORT_ID}/review`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ADMIN_SESSION}`,
            },
            body: 'not json at all',
        });

        const response = await reviewReport(request, params());

        expect(response.status).toBe(400);
        expect((await storedDocument(db)).status).toBe('PENDING');
    });

    it('refuses a request that names no action', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: {} }),
            params()
        );

        expect(response.status).toBe(400);
    });

    it('refuses an action nobody can take', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'DELETE' } }),
            params()
        );

        expect(response.status).toBe(400);
        expect((await storedDocument(db)).status).toBe('PENDING');
    });

    it('refuses a status the action does not produce', async () => {
        // A report cannot be moved anywhere the review flow did not choose:
        // the action decides the status, and a request disagreeing with it is
        // a confused request rather than a licence to store RESOLVED.
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'VERIFY', status: 'RESOLVED' },
            }),
            params()
        );

        expect(response.status).toBe(400);
        expect((await storedDocument(db)).status).toBe('PENDING');
    });

    it('refuses a status that is not a report status at all', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: { action: 'VERIFY', status: 'ANYTHING_AT_ALL' },
            }),
            params()
        );

        expect(response.status).toBe(400);
        expect((await storedDocument(db)).status).toBe('PENDING');
    });
});

// ==================================================================
// What a review must not touch
// ==================================================================
describe('POST /api/reports/[reportId]/review - preserves the report', () => {
    it('leaves every field the report was filed with exactly as it was', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'VERIFY' } }),
            params()
        );

        const stored = await storedDocument(db);

        expect(stored.reportId).toBe(REPORT_ID);
        expect(stored.issueCategory).toBe('BROKEN_RAMP');
        expect(stored.description).toBe(
            'The wheelchair ramp would not fold down at Pettah station.'
        );
        expect(stored.busId).toBe('BUS-00007');
        expect(stored.vehicle).toEqual({ numberPlate: 'NB-1234', busModel: 'Rosa' });
        expect(stored.routeId).toBe('R-138-OUT');
        expect(stored.route.routeNumber).toBe('138');
        expect(stored.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
        expect(stored.createdAt).toBe(FILED_AT);
        expect(stored.adminReviewFlaggedAt).toBe('2026-08-21T09:00:00.000Z');
    });

    it('cannot be used to change who filed the report', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: {
                    action: 'VERIFY',
                    passengerId: 'PSG-99999',
                    reportId: 'REP-00001',
                    createdAt: '2020-01-01T00:00:00.000Z',
                },
            }),
            params()
        );
        const json = await response.json();

        const stored = await storedDocument(db);

        expect(stored.passengerId).toBe(PASSENGER);
        expect(stored.reportId).toBe(REPORT_ID);
        expect(stored.createdAt).toBe(FILED_AT);
        expect(json.report.passengerId).toBe(PASSENGER);
        expect(json.report.reportId).toBe(REPORT_ID);
    });

    it('cannot be used to move the community vote tallies or the flag', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            reviewRequest('POST', {
                token: ADMIN_SESSION,
                body: {
                    action: 'VERIFY',
                    agreeCount: 0,
                    disagreeCount: 400,
                    requiresAdminReview: false,
                },
            }),
            params()
        );
        const json = await response.json();

        const stored = await storedDocument(db);

        expect(stored.agreeCount).toBe(6);
        expect(stored.disagreeCount).toBe(1);
        expect(stored.requiresAdminReview).toBe(true);
        expect(json.report.agreeCount).toBe(6);
        expect(json.report.disagreeCount).toBe(1);
        expect(json.report.requiresAdminReview).toBe(true);
    });

    it('leaves the other reports alone', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await reviewReport(
            reviewRequest('POST', { token: ADMIN_SESSION, body: { action: 'REJECT' } }),
            params()
        );

        const other = await storedDocument(db, OTHER_REPORT_ID);

        expect(other.status).toBe('PENDING');
        expect(other.reviewedBy).toBeUndefined();
    });
});
