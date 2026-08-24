// Viewing and managing your own reports, end to end (MOV-272).
//
// MOV-163's lifecycle suite follows a report through the review routes and
// checks what each listing scope makes of the result. This suite follows the
// same document from the other side — the passenger's — and covers the part
// MOV-272 added or fixed:
//
//   - the three tabs of the list screen, requested through the very path the
//     screen builds, so "Verified Reports asks for the verified scope" is
//     tested as the wiring it is rather than as a string,
//   - the window in which a report is still its author's to change: open while
//     it waits for a decision, closed the moment an admin makes one,
//   - what the author is left with afterwards — the report, its status, its
//     tallies and its thread, readable but no longer editable.
//
// Nothing is seeded mid-flight. Every state below is reached by making the
// requests that reach it, because the rules being tested live across four
// routes and only agree with each other when they are run in sequence.

import {
    DELETE as deleteReport,
    GET as getReport,
    PUT as updateReport,
} from '../../../app/api/reports/[reportId]+api';
import { POST as addComment } from '../../../app/api/reports/[reportId]/comments+api';
import { POST as reviewReport } from '../../../app/api/reports/[reportId]/review+api';
import { POST as castVote } from '../../../app/api/reports/[reportId]/vote+api';
import { GET as listReports, POST as createReport } from '../../../app/api/reports/index+api';
import { reportsRequestPath } from '../../../src/features/reports/utils/reportScopes';
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
const AUTHOR = 'PSG-00001';
const AUTHOR_SESSION = 'session-author';

const OTHER_PASSENGER = 'PSG-00002';
const OTHER_SESSION = 'session-other';

const ADMIN_SESSION = 'session-admin';

const BUS_ID = 'BUS-00007';
const ROUTE_ID = 'R-138-OUT';

const PHOTO = 'https://res.cloudinary.com/moreable/image/upload/v1/ramp.jpg';

const DESCRIPTION = 'The wheelchair ramp would not fold down at Pettah station.';

const SESSIONS: Record<string, Record<string, string>> = {
    [AUTHOR_SESSION]: {
        uid: 'UID-AUTHOR',
        passengerId: AUTHOR,
        role: 'PASSENGER',
        email: 'author@example.com',
    },
    [OTHER_SESSION]: {
        uid: 'UID-OTHER',
        passengerId: OTHER_PASSENGER,
        role: 'PASSENGER',
        email: 'other@example.com',
    },
    [ADMIN_SESSION]: {
        uid: 'UID-ADMIN',
        passengerId: 'ADM-00001',
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
};

/** A Firestore double holding the fleet, and no reports at all. */
function emptyFirestore() {
    return createFakeFirestore({
        buses: [
            {
                id: BUS_ID,
                busId: BUS_ID,
                numberPlate: 'NB-1234',
                busModel: 'Ashok Leyland Viking',
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
        users: [{ id: OTHER_PASSENGER, userName: 'Nimal' }],
        reports: [],
        votes: [],
        comments: [],
        counters: [],
    });
}

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
// Steps — each one a real request through a real handler
// ------------------------------------------------------------------

/** The passenger files a report through the form. */
async function fileReport(db: any, body: Record<string, any> = {}) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await createReport(
        jsonRequest('/api/reports', 'POST', {
            token: AUTHOR_SESSION,
            body: {
                issueCategory: 'BROKEN_RAMP',
                description: DESCRIPTION,
                busId: BUS_ID,
                routeId: ROUTE_ID,
                photoUrls: [PHOTO],
                ...body,
            },
        })
    );

    const payload = await response.json();

    return { response, reportId: payload?.report?.reportId as string };
}

/**
 * One tab of the list screen.
 *
 * The URL is built by the screen's own helper rather than typed here, so a tab
 * that stopped asking for its scope — which is precisely what Verified Reports
 * did before MOV-272 — fails these tests rather than passing them against a
 * string only the test knows.
 */
async function openTab(db: any, scope: 'all' | 'my' | 'verified', token = AUTHOR_SESSION) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await listReports(
        jsonRequest(reportsRequestPath(scope), 'GET', { token })
    );

    return { response, body: await response.json() };
}

/** The passenger opens one report. */
async function openReport(db: any, reportId: string, token = AUTHOR_SESSION) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await getReport(
        jsonRequest(`/api/reports/${reportId}`, 'GET', { token }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

/** The passenger saves an edit from the edit form. */
async function editReport(
    db: any,
    reportId: string,
    token = AUTHOR_SESSION,
    body: Record<string, any> = {}
) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await updateReport(
        jsonRequest(`/api/reports/${reportId}`, 'PUT', {
            token,
            body: {
                issueCategory: 'LIFT_NOT_WORKING',
                description: 'The lift was out of service for the whole journey.',
                busId: BUS_ID,
                routeId: ROUTE_ID,
                photoUrls: [PHOTO],
                ...body,
            },
        }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

/** The passenger confirms the delete dialog. */
async function removeReport(db: any, reportId: string, token = AUTHOR_SESSION) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await deleteReport(
        jsonRequest(`/api/reports/${reportId}`, 'DELETE', { token }),
        params(reportId)
    );

    return { response, body: await response.json() };
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

/** Another passenger answers the report. */
async function agree(db: any, reportId: string) {
    mockGetAdminDb.mockReturnValue(db);

    return castVote(
        jsonRequest(`/api/reports/${reportId}/vote`, 'POST', {
            token: OTHER_SESSION,
            body: { vote: 'AGREE' },
        }),
        params(reportId)
    );
}

/** Another passenger comments on the report. */
async function comment(db: any, reportId: string, text: string) {
    mockGetAdminDb.mockReturnValue(db);

    return addComment(
        jsonRequest(`/api/reports/${reportId}/comments`, 'POST', {
            token: OTHER_SESSION,
            body: { comment: text },
        }),
        params(reportId)
    );
}

/** The report exactly as Firestore holds it. The record, not the answer. */
async function stored(db: any, reportId: string) {
    const doc = await db.collection('reports').doc(reportId).get();

    return doc.data() ?? {};
}

/** Report ids in a listing response, in the order it returned them. */
function idsIn(body: any): string[] {
    return (body.reports ?? []).map((report: any) => report.reportId);
}

/** One report out of a listing response. */
function cardFor(body: any, reportId: string) {
    return (body.reports ?? []).find((report: any) => report.reportId === reportId);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// The three tabs
// ==================================================================
describe('the report list tabs ask the API for their own slice', () => {
    it('shows a newly submitted report in All Reports as Pending', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const { response, body } = await openTab(db, 'all');

        expect(response.status).toBe(200);
        expect(cardFor(body, reportId).status).toBe('PENDING');
    });

    it('shows it in My Reports as well', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        expect(idsIn((await openTab(db, 'my')).body)).toContain(reportId);
    });

    it('does not show it in Verified Reports until an admin verifies it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        expect(idsIn((await openTab(db, 'verified')).body)).toHaveLength(0);

        await review(db, reportId, { action: 'VERIFY' });

        const { response, body } = await openTab(db, 'verified');

        expect(response.status).toBe(200);
        expect(idsIn(body)).toEqual([reportId]);
        expect(cardFor(body, reportId).status).toBe('VERIFIED');
    });

    it('gives Verified Reports its own list rather than every report', async () => {
        // The tab used to be a placeholder. The thing to check now that it is
        // wired up is that it narrows — a tab that quietly fell back to `all`
        // would look right on a collection where everything is verified.
        const db = emptyFirestore();

        const pending = await fileReport(db);
        const verified = await fileReport(db);

        await review(db, verified.reportId, { action: 'VERIFY' });

        const { body } = await openTab(db, 'verified');

        expect(idsIn(body)).toEqual([verified.reportId]);
        expect(idsIn(body)).not.toContain(pending.reportId);
        expect(body.count).toBe(1);
    });

    it('shows another passenger the same Verified Reports list', async () => {
        // Verified Reports is filtered by status, not by who is asking.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        expect(idsIn((await openTab(db, 'verified', OTHER_SESSION)).body)).toEqual([reportId]);
    });

    it('carries the status and both tallies on every tab', async () => {
        // What AC 11 asks a card to show: where the report has got to, and how
        // the community answered it.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agree(db, reportId);
        await comment(db, reportId, 'The same ramp failed on my journey too.');
        await review(db, reportId, { action: 'VERIFY' });

        for (const scope of ['all', 'my', 'verified'] as const) {
            const card = cardFor((await openTab(db, scope)).body, reportId);

            expect(card.status).toBe('VERIFIED');
            expect(card.agreeCount).toBe(1);
            expect(card.commentCount).toBe(1);
        }
    });

    it('never hands a passenger tab the admin review queue', async () => {
        // The three tabs are answered by the same endpoint as `scope=review`,
        // which a passenger session may not read at all.
        const db = emptyFirestore();

        await fileReport(db);

        mockGetAdminDb.mockReturnValue(db);

        const queue = await listReports(
            jsonRequest('/api/reports?scope=review', 'GET', { token: AUTHOR_SESSION })
        );

        expect(queue.status).toBe(403);
    });
});

// ==================================================================
// Managing a report while it is still pending
// ==================================================================
describe('a pending report is still its author‘s to change', () => {
    it('lets the author edit it, and lists what they saved', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        const edit = await editReport(db, reportId);

        expect(edit.response.status).toBe(200);

        const card = cardFor((await openTab(db, 'my')).body, reportId);

        expect(card.issueCategory).toBe('LIFT_NOT_WORKING');
        expect(card.description).toBe('The lift was out of service for the whole journey.');
        expect(card.status).toBe('PENDING');
    });

    it('leaves an edited report pending, and in the queue an admin reads', async () => {
        // Editing is not resubmitting: it changes what the report says, not
        // where it has got to.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await editReport(db, reportId);

        expect((await stored(db, reportId)).status).toBe('PENDING');

        const decision = await review(db, reportId, { action: 'VERIFY' });

        expect(decision.status).toBe(200);
    });

    it('lets the author delete it, and drops it from every tab', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);
        const kept = await fileReport(db);

        const removal = await removeReport(db, reportId);

        expect(removal.response.status).toBe(200);
        expect(idsIn((await openTab(db, 'my')).body)).toEqual([kept.reportId]);
        expect(idsIn((await openTab(db, 'all')).body)).toEqual([kept.reportId]);
        expect((await openReport(db, reportId)).response.status).toBe(404);
    });

    it('refuses another passenger the edit and the delete', async () => {
        // The rule is the API's, not the screen's: neither button is drawn on
        // somebody else's report, and neither request works if it is made.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        expect((await editReport(db, reportId, OTHER_SESSION)).response.status).toBe(403);
        expect((await removeReport(db, reportId, OTHER_SESSION)).response.status).toBe(403);

        const record = await stored(db, reportId);

        expect(record.description).toBe(DESCRIPTION);
        expect(record.issueCategory).toBe('BROKEN_RAMP');
    });

    it('keeps another passenger‘s report out of My Reports entirely', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        expect(idsIn((await openTab(db, 'my', OTHER_SESSION)).body)).not.toContain(reportId);
    });
});

// ==================================================================
// submit -> PENDING -> verified -> readable, not editable
// ==================================================================
describe('the full lifecycle of a report that is verified', () => {
    it('closes the report to its author the moment it is verified', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        // Open while it waits.
        expect((await editReport(db, reportId)).response.status).toBe(200);

        await review(db, reportId, {
            action: 'VERIFY',
            adminRemark: 'Depot confirmed the ramp motor had failed.',
        });

        // Closed once it is decided.
        const blockedEdit = await editReport(db, reportId);
        const blockedDelete = await removeReport(db, reportId);

        expect(blockedEdit.response.status).toBe(409);
        expect(blockedDelete.response.status).toBe(409);
    });

    it('leaves the verified report exactly as the admin found it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY', adminRemark: 'Confirmed on site.' });
        await editReport(db, reportId, AUTHOR_SESSION, {
            description: 'Something else entirely.',
        });

        const record = await stored(db, reportId);

        expect(record.description).toBe(DESCRIPTION);
        expect(record.status).toBe('VERIFIED');
        expect(record.adminRemark).toBe('Confirmed on site.');
    });

    it('still lets the author read it, the decision included', async () => {
        // Losing the buttons is the whole of what a decision costs the author.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await agree(db, reportId);
        await comment(db, reportId, 'Same ramp, same problem.');
        await review(db, reportId, { action: 'VERIFY', adminRemark: 'Confirmed on site.' });

        const { response, body } = await openReport(db, reportId);

        expect(response.status).toBe(200);
        expect(body.isOwner).toBe(true);
        expect(body.report.status).toBe('VERIFIED');
        expect(body.report.adminRemark).toBe('Confirmed on site.');
        expect(body.report.reviewedAt).toBeTruthy();
        expect(body.report.agreeCount).toBe(1);
        expect(body.report.description).toBe(DESCRIPTION);
        expect(body.report.photoUrls).toEqual([PHOTO]);
    });

    it('shows the verified report on all three tabs at once', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        expect(idsIn((await openTab(db, 'all')).body)).toContain(reportId);
        expect(idsIn((await openTab(db, 'my')).body)).toContain(reportId);
        expect(idsIn((await openTab(db, 'verified')).body)).toContain(reportId);
    });

    it('refuses a second decision on it as firmly as it refuses the edit', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'VERIFY' });

        expect((await review(db, reportId, { action: 'REJECT' })).status).toBe(409);
        expect((await stored(db, reportId)).status).toBe('VERIFIED');
    });
});

// ==================================================================
// submit -> PENDING -> rejected -> gone from the feed, not from its author
// ==================================================================
describe('the full lifecycle of a report that is rejected', () => {
    it('hides it from All Reports but keeps it in My Reports', async () => {
        const db = emptyFirestore();

        const kept = await fileReport(db);
        const { reportId } = await fileReport(db);

        await review(db, reportId, {
            action: 'REJECT',
            adminRemark: 'The ramp was tested on site and folded normally.',
        });

        const all = await openTab(db, 'all');
        const mine = await openTab(db, 'my');

        expect(idsIn(all.body)).toEqual([kept.reportId]);
        expect(idsIn(mine.body)).toContain(reportId);
        expect(cardFor(mine.body, reportId).status).toBe('REJECTED');
        expect(cardFor(mine.body, reportId).adminRemark).toBe(
            'The ramp was tested on site and folded normally.'
        );
    });

    it('hides it from another passenger‘s All Reports too', async () => {
        // "Not shown publicly" is about the feed, not about the session that
        // happens to be reading it.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        expect(idsIn((await openTab(db, 'all', OTHER_SESSION)).body)).not.toContain(reportId);
    });

    it('keeps it out of Verified Reports', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        expect(idsIn((await openTab(db, 'verified')).body)).toHaveLength(0);
    });

    it('still opens for its author, with the reason it was rejected', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, {
            action: 'REJECT',
            adminRemark: 'The ramp was tested on site and folded normally.',
        });

        const { response, body } = await openReport(db, reportId);

        expect(response.status).toBe(200);
        expect(body.report.status).toBe('REJECTED');
        expect(body.report.adminRemark).toBe(
            'The ramp was tested on site and folded normally.'
        );
    });

    it('is closed to editing and deleting like any other decided report', async () => {
        // A rejection is the answer the author is owed. Editing it into
        // something else, or deleting it, would erase that answer.
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, { action: 'REJECT' });

        expect((await editReport(db, reportId)).response.status).toBe(409);
        expect((await removeReport(db, reportId)).response.status).toBe(409);
        expect((await stored(db, reportId)).status).toBe('REJECTED');
    });
});

// ==================================================================
// A remark is not a decision
// ==================================================================
describe('a report an admin has only remarked on stays open', () => {
    it('still lets its author edit and delete it', async () => {
        const db = emptyFirestore();
        const { reportId } = await fileReport(db);

        await review(db, reportId, {
            action: 'REMARK',
            adminRemark: 'Chasing the depot for a repair date.',
        });

        expect((await stored(db, reportId)).status).toBe('PENDING');
        expect((await editReport(db, reportId)).response.status).toBe(200);
        expect((await removeReport(db, reportId)).response.status).toBe(200);
    });
});
