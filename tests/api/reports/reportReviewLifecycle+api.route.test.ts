// One report, from filed to decided, across every route that touches it
// (MOV-163).
//
// MOV-161's suite tests the review API's contract, and MOV-162's tests the
// document a decision leaves behind. Both examine one route at a time, against
// a report seeded directly into Firestore in whatever state the case needs.
//
// This suite tests the part neither can: that the routes agree with each other
// over the life of a real report. Nothing here is seeded mid-flight. A
// passenger files the report through POST /api/reports, other passengers vote
// on it through the vote route until the community flags it, an admin finds it
// in the review queue, reads it, decides it, and every listing route is then
// asked what it makes of the result — with the stored document checked at each
// step rather than only the response that announced it.
//
// That ordering is the point. A review flow can pass every isolated test and
// still be broken at the seams: a decision that persists but never reaches the
// Verified Reports list, or a flag the vote route raises and the queue does not
// read, is invisible until the routes are run in sequence against one document.

import {
    GET as getReport,
} from '../../../app/api/reports/[reportId]+api';
import {
    GET as getReportForReview,
    POST as reviewReport,
} from '../../../app/api/reports/[reportId]/review+api';
import {
    POST as castVote,
} from '../../../app/api/reports/[reportId]/vote+api';
import {
    GET as listReports,
    POST as createReport,
} from '../../../app/api/reports/index+api';
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
//
// The sessions and the fleet the report form would have offered. Kept local to
// this file, as every other route suite in this directory keeps its own — the
// shared test utility in this project is the Firestore double, and that is what
// is reused here.
// ------------------------------------------------------------------
const AUTHOR = 'PSG-00001';
const AUTHOR_SESSION = 'session-author';
const ADMIN_UID = 'UID-ADMIN';
const ADMIN_SESSION = 'session-admin';

/** Five other passengers, which is exactly what the flag threshold needs. */
const VOTERS = ['PSG-00002', 'PSG-00003', 'PSG-00004', 'PSG-00005', 'PSG-00006'];

const BUS_ID = 'BUS-00007';
const ROUTE_ID = 'R-138-OUT';

const PHOTO_A = 'https://res.cloudinary.com/moreable/image/upload/v1/ramp-a.jpg';
const PHOTO_B = 'https://res.cloudinary.com/moreable/image/upload/v1/ramp-b.jpg';

const DESCRIPTION = 'The wheelchair ramp would not fold down at Pettah station.';

const SESSIONS: Record<string, Record<string, string>> = {
    [AUTHOR_SESSION]: {
        uid: 'UID-AUTHOR',
        passengerId: AUTHOR,
        role: 'PASSENGER',
        email: 'author@example.com',
    },
    [ADMIN_SESSION]: {
        uid: ADMIN_UID,
        passengerId: 'ADM-00001',
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
    ...Object.fromEntries(
        VOTERS.map((passengerId, index) => [
            `session-voter-${index}`,
            {
                uid: `UID-V${index}`,
                passengerId,
                role: 'PASSENGER',
                email: `voter${index}@example.com`,
            },
        ])
    ),
};

function voterSession(index: number): string {
    return `session-voter-${index}`;
}

/** A Firestore double holding the fleet, and no reports at all. */
function emptyFirestore() {
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
    });
}

// ------------------------------------------------------------------
// Requests
// ------------------------------------------------------------------
function jsonRequest(
    url: string,
    method: string,
    options: { token?: string; body?: unknown } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(`http://localhost${url}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
}

/** The params Expo Router hands a `[reportId]` handler. */
function params(reportId: string) {
    return { params: { reportId } };
}

// ------------------------------------------------------------------
// Steps
//
// Each one is a real request through a real handler. They are named for what
// somebody does, so a lifecycle test below reads as the sequence of events it
// is meant to describe.
// ------------------------------------------------------------------

/** A passenger files a report, and gets back the id it was stored under. */
async function fileReport(
    db: any,
    body: Record<string, any> = {}
): Promise<{ response: Response; reportId: string }> {
    mockGetAdminDb.mockReturnValue(db);

    const response = await createReport(
        jsonRequest('/api/reports', 'POST', {
            token: AUTHOR_SESSION,
            body: {
                issueCategory: 'BROKEN_RAMP',
                description: DESCRIPTION,
                busId: BUS_ID,
                routeId: ROUTE_ID,
                photoUrls: [PHOTO_A, PHOTO_B],
                ...body,
            },
        })
    );

    const payload = await response.json();

    return { response, reportId: payload?.report?.reportId };
}

/** One passenger agrees with the report. */
async function agree(db: any, reportId: string, voterIndex: number) {
    mockGetAdminDb.mockReturnValue(db);

    return castVote(
        jsonRequest(`/api/reports/${reportId}/vote`, 'POST', {
            token: voterSession(voterIndex),
            body: { vote: 'AGREE' },
        }),
        params(reportId)
    );
}

/** Enough passengers agree to push the report over the review threshold. */
async function agreeUntilFlagged(db: any, reportId: string, count = VOTERS.length) {
    for (let index = 0; index < count; index += 1) {
        await agree(db, reportId, index);
    }
}

/** The admin records a decision. */
async function review(db: any, reportId: string, body: Record<string, any>) {
    mockGetAdminDb.mockReturnValue(db);

    return reviewReport(
        jsonRequest(`/api/reports/${reportId}/review`, 'POST', {
            token: ADMIN_SESSION,
            body,
        }),
        params(reportId)
    );
}

/** One listing scope, as a passenger or an admin would ask for it. */
async function list(db: any, scope: string, token: string) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await listReports(
        jsonRequest(`/api/reports?scope=${scope}`, 'GET', { token })
    );

    return { response, body: await response.json() };
}

/** The admin's view of one report, re-read from the API. */
async function readForReview(db: any, reportId: string) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await getReportForReview(
        jsonRequest(`/api/reports/${reportId}/review`, 'GET', { token: ADMIN_SESSION }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

/** The passenger-facing single report, re-read from the API. */
async function readReport(db: any, reportId: string) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await getReport(
        jsonRequest(`/api/reports/${reportId}`, 'GET', { token: AUTHOR_SESSION }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

/** The report exactly as Firestore holds it. The record, not the answer. */
async function stored(db: any, reportId: string) {
    const doc = await db.collection('reports').doc(reportId).get();

    return doc.data();
}

/** Report ids in a listing response, in the order it returned them. */
function idsIn(body: any): string[] {
    return (body.reports ?? []).map((report: any) => report.reportId);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Filing, and arriving in the queue
// ==================================================================
describe('report review lifecycle - a report reaches the review queue', () => {
    it('files a report that starts life PENDING and unflagged', async () => {
        const db = emptyFirestore();

        const { response, reportId } = await fileReport(db);

        expect(response.status).toBe(201);
        expect(reportId).toBeTruthy();

        const report = await stored(db, reportId);

        expect(report.status).toBe('PENDING');
        expect(report.requiresAdminReview).toBeFalsy();
        expect(report.reviewedBy).toBeUndefined();
        expect(report.reviewedAt).toBeUndefined();
        expect(report.adminRemark).toBeUndefined();
    });

    it('shows the new report to the admin queue as awaiting a decision', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const { response, body } = await list(db, 'review', ADMIN_SESSION);

        expect(response.status).toBe(200);
        expect(idsIn(body)).toContain(reportId);

        const queued = body.reports.find((r: any) => r.reportId === reportId);

        expect(queued.status).toBe('PENDING');
        expect(queued.flagged).toBe(false);
    });

    it('flags the report once five passengers have agreed with it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agreeUntilFlagged(db, reportId);

        // The record first: the flag is a stored fact, not a rendering choice.
        const report = await stored(db, reportId);

        expect(report.agreeCount).toBe(5);
        expect(report.requiresAdminReview).toBe(true);

        // And then the queue, which is what an admin actually sees.
        const { body } = await list(db, 'review', ADMIN_SESSION);
        const queued = body.reports.find((r: any) => r.reportId === reportId);

        expect(queued.flagged).toBe(true);
        expect(queued.agreeCount).toBe(5);
    });

    it('does not flag a report four passengers agreed with', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agreeUntilFlagged(db, reportId, 4);

        const { body } = await list(db, 'review', ADMIN_SESSION);
        const queued = body.reports.find((r: any) => r.reportId === reportId);

        expect(queued.agreeCount).toBe(4);
        expect(queued.flagged).toBe(false);
    });

    it('counts the flagged reports for the queue header', async () => {
        const db = emptyFirestore();

        const flagged = await fileReport(db);
        const quiet = await fileReport(db);

        await agreeUntilFlagged(db, flagged.reportId);

        const { body } = await list(db, 'review', ADMIN_SESSION);

        expect(body.flaggedCount).toBe(1);
        expect(idsIn(body)).toEqual(expect.arrayContaining([flagged.reportId, quiet.reportId]));
    });

    it('gives the admin the whole report to decide it on', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agreeUntilFlagged(db, reportId);

        const { response, body } = await readForReview(db, reportId);

        expect(response.status).toBe(200);

        // Everything the review screen puts on the page, from one request:
        // the issue, the bus, the route, the evidence, and the community.
        expect(body.report.issueCategory).toBe('BROKEN_RAMP');
        expect(body.report.description).toBe(DESCRIPTION);
        expect(body.report.vehicle.numberPlate).toBe('NB-1234');
        expect(body.report.route.routeNumber).toBe('138');
        expect(body.report.route.direction).toBe('OUTBOUND');
        expect(body.report.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
        expect(body.report.agreeCount).toBe(5);
        expect(body.report.disagreeCount).toBe(0);
        expect(body.report.flagged).toBe(true);
        expect(body.report.status).toBe('PENDING');
        expect(body.review).toBeNull();
        expect(Array.isArray(body.comments)).toBe(true);
    });
});

// ==================================================================
// The full journey: filed, flagged, verified, re-read
// ==================================================================
describe('report review lifecycle - verifying a report end to end', () => {
    it('carries a verification from the decision through to every route that reads it', async () => {
        const db = emptyFirestore();

        // 1. Filed by a passenger.
        const { reportId } = await fileReport(db);

        // 2. Agreed with by the community, until it wants an admin.
        await agreeUntilFlagged(db, reportId);

        // 3. Decided by an admin.
        const decision = await review(db, reportId, { action: 'VERIFY' });

        expect(decision.status).toBe(200);

        // 4. The record, which is what a report actually is.
        const record = await stored(db, reportId);

        expect(record.status).toBe('VERIFIED');
        expect(record.reviewedBy).toBe(ADMIN_UID);
        expect(typeof record.reviewedAt).toBe('string');
        expect(Number.isNaN(Date.parse(record.reviewedAt))).toBe(false);

        // 5. Re-read through the admin review route.
        const reviewRead = await readForReview(db, reportId);

        expect(reviewRead.body.report.status).toBe('VERIFIED');
        expect(reviewRead.body.review.status).toBe('VERIFIED');
        expect(reviewRead.body.review.reviewedBy).toBe(ADMIN_UID);

        // 6. Re-read through the passenger-facing single report route.
        const passengerRead = await readReport(db, reportId);

        expect(passengerRead.body.report.status).toBe('VERIFIED');

        // 7. And through the queue the admin came from.
        const queue = await list(db, 'review', ADMIN_SESSION);
        const queued = queue.body.reports.find((r: any) => r.reportId === reportId);

        expect(queued.status).toBe('VERIFIED');
    });

    it('leaves everything the passenger filed exactly as they filed it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const before = await stored(db, reportId);

        await agreeUntilFlagged(db, reportId);
        await review(db, reportId, { action: 'VERIFY' });

        const after = await stored(db, reportId);

        expect(after.reportId).toBe(before.reportId);
        expect(after.passengerId).toBe(before.passengerId);
        expect(after.issueCategory).toBe(before.issueCategory);
        expect(after.description).toBe(before.description);
        expect(after.photoUrls).toEqual(before.photoUrls);
        expect(after.vehicle).toEqual(before.vehicle);
        expect(after.route).toEqual(before.route);
        expect(after.createdAt).toEqual(before.createdAt);
    });

    it('decides only the report that was addressed', async () => {
        const db = emptyFirestore();

        const decided = await fileReport(db);
        const untouched = await fileReport(db);

        await review(db, decided.reportId, { action: 'VERIFY' });

        const other = await stored(db, untouched.reportId);

        expect(other.status).toBe('PENDING');
        expect(other.reviewedBy).toBeUndefined();
        expect(other.reviewedAt).toBeUndefined();
    });
});

// ==================================================================
describe('report review lifecycle - rejecting a report end to end', () => {
    it('carries a rejection from the decision through to every route that reads it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agreeUntilFlagged(db, reportId);

        const decision = await review(db, reportId, { action: 'REJECT' });

        expect(decision.status).toBe(200);

        const record = await stored(db, reportId);

        expect(record.status).toBe('REJECTED');
        expect(record.reviewedBy).toBe(ADMIN_UID);
        expect(typeof record.reviewedAt).toBe('string');

        const reviewRead = await readForReview(db, reportId);

        expect(reviewRead.body.report.status).toBe('REJECTED');
        expect(reviewRead.body.review.status).toBe('REJECTED');

        const passengerRead = await readReport(db, reportId);

        expect(passengerRead.body.report.status).toBe('REJECTED');
    });

    it('leaves the community feedback on a rejected report untouched', async () => {
        // A rejection is the admin's finding about the issue, not a verdict on
        // the passengers who agreed with it — their votes stay counted.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agreeUntilFlagged(db, reportId);
        await review(db, reportId, { action: 'REJECT' });

        const record = await stored(db, reportId);

        expect(record.agreeCount).toBe(5);
        expect(record.requiresAdminReview).toBe(true);
    });
});

// ==================================================================
// A decision is made once
// ==================================================================
describe('report review lifecycle - a decision cannot be revisited', () => {
    it('refuses a second decision on a verified report and keeps the first', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        const second = await review(db, reportId, { action: 'REJECT' });

        expect(second.status).toBe(409);

        const record = await stored(db, reportId);

        expect(record.status).toBe('VERIFIED');
    });

    it('refuses a second decision on a rejected report and keeps the first', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const second = await review(db, reportId, { action: 'VERIFY' });

        expect(second.status).toBe(409);
        expect((await stored(db, reportId)).status).toBe('REJECTED');
    });

    it('still records a remark after the report has been decided', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        const remarked = await review(db, reportId, {
            action: 'REMARK',
            adminRemark: 'Depot has scheduled the repair for Friday.',
        });

        expect(remarked.status).toBe(200);

        const record = await stored(db, reportId);

        expect(record.adminRemark).toBe('Depot has scheduled the repair for Friday.');
        expect(record.status).toBe('VERIFIED');
    });
});

// ==================================================================
// Remarks over the life of a report
// ==================================================================
describe('report review lifecycle - remarks', () => {
    it('persists a remark to the report document and reads it back', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const saved = await review(db, reportId, {
            action: 'REMARK',
            adminRemark: 'Chasing the depot for a repair date.',
        });

        expect(saved.status).toBe(200);

        // The record.
        const record = await stored(db, reportId);

        expect(record.adminRemark).toBe('Chasing the depot for a repair date.');
        expect(record.status).toBe('PENDING');

        // And the read that the screen performs after saving.
        const { body } = await readForReview(db, reportId);

        expect(body.review.adminRemark).toBe('Chasing the depot for a repair date.');
        expect(body.report.status).toBe('PENDING');
    });

    it('replaces an earlier remark rather than accumulating them', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REMARK', adminRemark: 'First look.' });
        await review(db, reportId, { action: 'REMARK', adminRemark: 'Second look.' });

        expect((await stored(db, reportId)).adminRemark).toBe('Second look.');
    });

    it('keeps the remark when the report is decided afterwards', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REMARK', adminRemark: 'Depot contacted.' });
        await review(db, reportId, { action: 'VERIFY' });

        const record = await stored(db, reportId);

        expect(record.status).toBe('VERIFIED');
        expect(record.adminRemark).toBe('Depot contacted.');
    });

    it('refuses an empty remark and writes nothing at all', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const response = await review(db, reportId, {
            action: 'REMARK',
            adminRemark: '   ',
        });

        expect(response.status).toBe(400);

        const record = await stored(db, reportId);

        expect(record.adminRemark).toBeUndefined();
        expect(record.reviewedBy).toBeUndefined();
        expect(record.status).toBe('PENDING');
    });
});

// ==================================================================
// Verified Reports
// ==================================================================
describe('report review lifecycle - the Verified Reports list', () => {
    it('is empty while nothing has been verified', async () => {
        const db = emptyFirestore();

        await fileReport(db);

        const { response, body } = await list(db, 'verified', AUTHOR_SESSION);

        expect(response.status).toBe(200);
        expect(body.reports).toHaveLength(0);
    });

    it('shows a report only once an admin has verified it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        expect((await list(db, 'verified', AUTHOR_SESSION)).body.reports).toHaveLength(0);

        await review(db, reportId, { action: 'VERIFY' });

        const { body } = await list(db, 'verified', AUTHOR_SESSION);

        expect(idsIn(body)).toEqual([reportId]);
        expect(body.reports[0].status).toBe('VERIFIED');
    });

    it('carries the fields the report card renders', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agreeUntilFlagged(db, reportId);
        await review(db, reportId, { action: 'VERIFY' });

        const { body } = await list(db, 'verified', AUTHOR_SESSION);
        const card = body.reports[0];

        expect(card.issueCategory).toBe('BROKEN_RAMP');
        expect(card.description).toBe(DESCRIPTION);
        expect(card.vehicle.numberPlate).toBe('NB-1234');
        expect(card.route.routeNumber).toBe('138');
        expect(card.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
        expect(card.agreeCount).toBe(5);
        expect(card.commentCount).toBe(0);
    });

    it('never shows a pending or a rejected report', async () => {
        const db = emptyFirestore();

        const pending = await fileReport(db);
        const rejected = await fileReport(db);
        const verified = await fileReport(db);

        await review(db, rejected.reportId, { action: 'REJECT' });
        await review(db, verified.reportId, { action: 'VERIFY' });

        const { body } = await list(db, 'verified', AUTHOR_SESSION);

        expect(idsIn(body)).toEqual([verified.reportId]);
        expect(idsIn(body)).not.toContain(pending.reportId);
        expect(idsIn(body)).not.toContain(rejected.reportId);
    });

    it('is open to a passenger, not only to an admin', async () => {
        // Verified Reports is a passenger-facing list. It is filtered by status
        // rather than by who is asking, so an ordinary session may read it.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        const asPassenger = await list(db, 'verified', AUTHOR_SESSION);
        const asAdmin = await list(db, 'verified', ADMIN_SESSION);

        expect(asPassenger.response.status).toBe(200);
        expect(idsIn(asPassenger.body)).toEqual([reportId]);
        expect(idsIn(asAdmin.body)).toEqual(idsIn(asPassenger.body));
    });

    it('drops a report out of Verified Reports if it was never verified', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, {
            action: 'REMARK',
            adminRemark: 'Looked at, not decided.',
        });

        expect((await list(db, 'verified', AUTHOR_SESSION)).body.reports).toHaveLength(0);
        expect((await stored(db, reportId)).status).toBe('PENDING');
    });
});

// ==================================================================
// What a rejection does to the public feed
// ==================================================================
describe('report review lifecycle - a rejected report leaves the public feed', () => {
    it('drops a rejected report out of All Reports', async () => {
        const db = emptyFirestore();

        const kept = await fileReport(db);
        const rejected = await fileReport(db);

        // Both are browsable while both are pending.
        const before = await list(db, 'all', AUTHOR_SESSION);

        expect(idsIn(before.body)).toEqual(
            expect.arrayContaining([kept.reportId, rejected.reportId])
        );

        await review(db, rejected.reportId, { action: 'REJECT' });

        const after = await list(db, 'all', AUTHOR_SESSION);

        expect(idsIn(after.body)).not.toContain(rejected.reportId);
        expect(idsIn(after.body)).toContain(kept.reportId);
    });

    it('counts only what it shows', async () => {
        const db = emptyFirestore();

        await fileReport(db);
        const rejected = await fileReport(db);

        await review(db, rejected.reportId, { action: 'REJECT' });

        const { body } = await list(db, 'all', AUTHOR_SESSION);

        expect(body.count).toBe(1);
        expect(body.reports).toHaveLength(1);
    });

    it('keeps a verified report in All Reports', async () => {
        // Only a rejection removes a report. A decision that upheld it is a
        // reason to keep showing it, not to hide it.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        const { body } = await list(db, 'all', AUTHOR_SESSION);

        expect(idsIn(body)).toEqual([reportId]);
        expect(body.reports[0].status).toBe('VERIFIED');
    });

    it('keeps a pending report in All Reports', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const { body } = await list(db, 'all', AUTHOR_SESSION);

        expect(idsIn(body)).toEqual([reportId]);
    });

    it('still shows the author their own rejected report', async () => {
        // The passenger who filed it is exactly who ought to learn it was
        // rejected; hiding it from them would answer their report with silence.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const mine = await list(db, 'my', AUTHOR_SESSION);

        expect(idsIn(mine.body)).toEqual([reportId]);
        expect(mine.body.reports[0].status).toBe('REJECTED');
    });

    it('still shows a rejected report in the admin review queue', async () => {
        // The queue is the record of what was decided, so a rejection stays
        // visible to the people who make and audit those decisions.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const { body } = await list(db, 'review', ADMIN_SESSION);
        const queued = body.reports.find((r: any) => r.reportId === reportId);

        expect(queued).toBeDefined();
        expect(queued.status).toBe('REJECTED');
    });

    it('still reads a rejected report directly by id', async () => {
        // Leaving the feed is not deletion: a link to the report still works,
        // which is what lets the author open it from My Reports.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const { response, body } = await readReport(db, reportId);

        expect(response.status).toBe(200);
        expect(body.report.status).toBe('REJECTED');
    });

    it('does not remove the document, only hides it from that one list', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const record = await stored(db, reportId);

        expect(record).toBeDefined();
        expect(record.description).toBe(DESCRIPTION);
        expect(record.status).toBe('REJECTED');
    });
});

// ==================================================================
// Who may do what, over a real report
// ==================================================================
describe('report review lifecycle - authorisation across the flow', () => {
    it('refuses the queue and the decision to the passenger who filed the report', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        mockGetAdminDb.mockReturnValue(db);

        const queue = await listReports(
            jsonRequest('/api/reports?scope=review', 'GET', { token: AUTHOR_SESSION })
        );

        expect(queue.status).toBe(403);

        const decision = await reviewReport(
            jsonRequest(`/api/reports/${reportId}/review`, 'POST', {
                token: AUTHOR_SESSION,
                body: { action: 'VERIFY' },
            }),
            params(reportId)
        );

        expect(decision.status).toBe(403);
        expect((await stored(db, reportId)).status).toBe('PENDING');
    });

    it('refuses an anonymous decision and writes nothing', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            jsonRequest(`/api/reports/${reportId}/review`, 'POST', {
                body: { action: 'VERIFY' },
            }),
            params(reportId)
        );

        expect(response.status).toBe(401);

        const record = await stored(db, reportId);

        expect(record.status).toBe('PENDING');
        expect(record.reviewedBy).toBeUndefined();
    });

    it('still lets the author read their own report after it is decided', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const { response, body } = await readReport(db, reportId);

        expect(response.status).toBe(200);
        expect(body.report.status).toBe('REJECTED');
    });

    it('keeps a decided report in the author own My Reports list', async () => {
        // The author is told what became of their report; a decision is not a
        // reason to hide it from the person who filed it.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        const { body } = await list(db, 'my', AUTHOR_SESSION);

        expect(idsIn(body)).toContain(reportId);
        expect(body.reports[0].status).toBe('REJECTED');
    });
});

// ==================================================================
// Unknown reports and malformed decisions, against a live collection
// ==================================================================
describe('report review lifecycle - refusals leave the collection alone', () => {
    it('answers 404 for a report id that was never filed', async () => {
        const db = emptyFirestore();

        await fileReport(db);

        const response = await review(db, 'REP-99999', { action: 'VERIFY' });

        expect(response.status).toBe(404);
    });

    it('answers 400 for an action no admin can take, and decides nothing', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const response = await review(db, reportId, { action: 'DELETE_REPORT' });

        expect(response.status).toBe(400);

        const record = await stored(db, reportId);

        expect(record.status).toBe('PENDING');
        expect(record.reviewedBy).toBeUndefined();
    });

    it('answers 400 for a status that disagrees with the action', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const response = await review(db, reportId, {
            action: 'VERIFY',
            status: 'REJECTED',
        });

        expect(response.status).toBe(400);
        expect((await stored(db, reportId)).status).toBe('PENDING');
    });

    it('answers 400 for a remark past the cap, and stores none of it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const response = await review(db, reportId, {
            action: 'REMARK',
            adminRemark: 'x'.repeat(501),
        });

        expect(response.status).toBe(400);
        expect((await stored(db, reportId)).adminRemark).toBeUndefined();
    });

    it('leaves a refused report readable exactly as it was filed', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const before = await stored(db, reportId);

        await review(db, reportId, { action: 'NONSENSE' });

        expect(await stored(db, reportId)).toEqual(before);
    });
});
