// GET, PUT and DELETE /api/reports/[reportId] — one report, and who may change it.
//
// The rule these tests exist for is ownership. The app hides Edit and Delete on
// somebody else's report, but hiding a button is not a permission: the request
// can be made anyway, and what stops it is this route comparing the report's
// passengerId against the passengerId on the verified token.
//
// Reading is deliberately not restricted the same way — All Reports already
// hands every report to every passenger, so opening one grants no new access.

import {
    DELETE as deleteReport,
    GET as getReport,
    PUT as updateReport,
} from '../../../app/api/reports/[reportId]+api';
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
const OWNER = 'PSG-00001';
const OTHER_PASSENGER = 'PSG-00002';

const OWNER_SESSION = 'session-owner';
const OTHER_SESSION = 'session-other';

const SESSIONS: Record<string, Record<string, string>> = {
    [OWNER_SESSION]: {
        uid: 'UID-A',
        passengerId: OWNER,
        role: 'PASSENGER',
        email: 'owner@example.com',
    },
    [OTHER_SESSION]: {
        uid: 'UID-B',
        passengerId: OTHER_PASSENGER,
        role: 'PASSENGER',
        email: 'other@example.com',
    },
};

const REPORT_ID = 'REP-00007';
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');

const PHOTO_A = 'https://res.cloudinary.com/moreable/image/upload/v1/a.jpg';
const PHOTO_B = 'https://res.cloudinary.com/moreable/image/upload/v1/b.jpg';

function storedReport(overrides: Record<string, any> = {}) {
    return {
        id: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: OWNER,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234', busModel: 'Rosa' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
        photoUrls: [PHOTO_A, PHOTO_B],
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

/** The reports collection, plus the fleet the references resolve against. */
function firestoreWith(report: Record<string, any> = storedReport()) {
    return createFakeFirestore({
        reports: [report],
        buses: [
            { id: 'BUS-00007', busId: 'BUS-00007', numberPlate: 'NB-1234', busModel: 'Rosa' },
            { id: 'BUS-00009', busId: 'BUS-00009', numberPlate: 'NC-9999' },
        ],
        routes: [
            {
                id: 'R-138-OUT',
                routeId: 'R-138-OUT',
                routeNumber: '138',
                routeName: 'Colombo - Kandy',
                direction: 'OUTBOUND',
            },
            {
                id: 'R-400-RET',
                routeId: 'R-400-RET',
                routeNumber: '400',
                routeName: 'Kadawatha - Pettah',
                direction: 'RETURN',
            },
        ],
    });
}

function request(
    method: string,
    options: { token?: string; body?: unknown; reportId?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(`http://localhost/api/reports/${options.reportId ?? REPORT_ID}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
}

/** The params Expo Router hands the handler for this route. */
function params(reportId: string = REPORT_ID) {
    return { reportId };
}

/** A complete, valid edit — the body the form sends when nothing was cleared. */
function validEdit(overrides: Record<string, any> = {}) {
    return {
        issueCategory: 'LIFT_NOT_WORKING',
        description: 'The lift was out of service for the whole journey.',
        busId: 'BUS-00007',
        routeId: 'R-138-OUT',
        photoUrls: [PHOTO_A, PHOTO_B],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Authentication
// ==================================================================
describe('/api/reports/[reportId] - authentication', () => {
    it('refuses to read a report without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(request('GET'), params());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses to update a report without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(request('PUT', { body: validEdit() }), params());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses to delete a report without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await deleteReport(request('DELETE'), params());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses a token that does not verify', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await deleteReport(
            request('DELETE', { token: 'forged-session' }),
            params()
        );

        expect(response.status).toBe(401);
    });
});

// ==================================================================
// GET — view details
// ==================================================================
describe('GET /api/reports/[reportId]', () => {
    it('returns every stored field the details screen shows', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(request('GET', { token: OWNER_SESSION }), params());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.report.issueCategory).toBe('BROKEN_RAMP');
        expect(json.report.description).toContain('wheelchair ramp');
        expect(json.report.status).toBe('PENDING');
        expect(json.report.vehicle.numberPlate).toBe('NB-1234');
        expect(json.report.route.routeNumber).toBe('138');
        expect(json.report.route.direction).toBe('OUTBOUND');
    });

    it('returns every photo the report was filed with', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(request('GET', { token: OWNER_SESSION }), params());
        const json = await response.json();

        expect(json.report.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
    });

    it('tells the owner that the report is theirs', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(request('GET', { token: OWNER_SESSION }), params());
        const json = await response.json();

        expect(json.isOwner).toBe(true);
    });

    it('lets another passenger read it, but not own it', async () => {
        // All Reports already shows every passenger's reports, so viewing one
        // in full is no new access — editing and deleting are what is gated.
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(request('GET', { token: OTHER_SESSION }), params());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.isOwner).toBe(false);
    });

    it('serialises the Firestore timestamps the screen formats', async () => {
        mockGetAdminDb.mockReturnValue(
            firestoreWith(
                storedReport({
                    createdAt: { toDate: () => FILED_AT },
                    updatedAt: { toDate: () => FILED_AT },
                })
            )
        );

        const response = await getReport(request('GET', { token: OWNER_SESSION }), params());
        const json = await response.json();

        expect(new Date(json.report.createdAt).toISOString()).toBe(FILED_AT.toISOString());
    });

    it('answers 404 for a report that is not there', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(
            request('GET', { token: OWNER_SESSION, reportId: 'REP-99999' }),
            params('REP-99999')
        );

        expect(response.status).toBe(404);
    });

    it('reads the report id from the path when no params are given', async () => {
        // The handlers are also reached with no params object at all, so the
        // path is the fallback rather than an error.
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getReport(request('GET', { token: OWNER_SESSION }), undefined);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report.reportId).toBe(REPORT_ID);
    });
});

// ==================================================================
// PUT — edit
// ==================================================================
describe('PUT /api/reports/[reportId] - the owner', () => {
    it('saves the edited category and description', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.report.issueCategory).toBe('LIFT_NOT_WORKING');
        expect(json.report.description).toBe('The lift was out of service for the whole journey.');
    });

    it('keeps the report id, its author and its review status', async () => {
        // An edit changes what the report says, never whose it is or where it
        // has got to in review — none of which the request can even express.
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({
                    reportId: 'REP-00001',
                    passengerId: OTHER_PASSENGER,
                    status: 'VERIFIED',
                }),
            }),
            params()
        );
        const json = await response.json();

        expect(json.report.reportId).toBe(REPORT_ID);
        expect(json.report.passengerId).toBe(OWNER);
        expect(json.report.status).toBe('PENDING');
    });

    it('keeps the original submission date and moves the updated one', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );
        const json = await response.json();

        expect(new Date(json.report.createdAt).toISOString()).toBe(FILED_AT.toISOString());
        expect(new Date(json.report.updatedAt).getTime()).toBeGreaterThan(FILED_AT.getTime());
    });

    it('re-snapshots the bus and route when they change', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({ busId: 'BUS-00009', routeId: 'R-400-RET' }),
            }),
            params()
        );
        const json = await response.json();

        expect(json.report.busId).toBe('BUS-00009');
        expect(json.report.vehicle.numberPlate).toBe('NC-9999');
        expect(json.report.routeId).toBe('R-400-RET');
        expect(json.report.route.routeNumber).toBe('400');
        expect(json.report.route.direction).toBe('RETURN');
    });

    it('drops the bus and route when the passenger clears them', async () => {
        // Written whole rather than merged, precisely so that clearing a
        // selection can be expressed at all.
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({ busId: null, routeId: null }),
            }),
            params()
        );
        const json = await response.json();

        expect(json.report.busId).toBeUndefined();
        expect(json.report.vehicle).toBeUndefined();
        expect(json.report.routeId).toBeUndefined();
        expect(json.report.route).toBeUndefined();
    });

    it('saves the photos the passenger kept', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit({ photoUrls: [PHOTO_B] }) }),
            params()
        );
        const json = await response.json();

        expect(json.report.photoUrls).toEqual([PHOTO_B]);
    });

    it('leaves no photos key at all once every photo is removed', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit({ photoUrls: [] }) }),
            params()
        );
        const json = await response.json();

        expect(json.report.photoUrls).toBeUndefined();
    });

    it('preserves fields the form knows nothing about', async () => {
        // A review note added elsewhere is not the form's to drop.
        mockGetAdminDb.mockReturnValue(
            firestoreWith(storedReport({ reviewNotes: 'Passed to the depot manager.' }))
        );

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );
        const json = await response.json();

        expect(json.report.reviewNotes).toBe('Passed to the depot manager.');
    });

    // The review keys, specifically. A passenger editing their own report is
    // the one caller with write access to the document, so "only an admin
    // decides a report" is a rule this route has to hold as much as the review
    // route does — an edit that could name its own reviewer would be a second
    // way into the status the review route guards.
    it('cannot be used to record a decision on the report', async () => {
        const firestore = firestoreWith();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({
                    status: 'VERIFIED',
                    reviewedBy: 'UID-ADMIN',
                    reviewedAt: '2026-08-21T09:00:00.000Z',
                    adminRemark: 'Verified by the passenger who filed it.',
                }),
            }),
            params()
        );

        expect(response.status).toBe(200);

        const stored = (await firestore.collection('reports').doc(REPORT_ID).get()).data() ?? {};

        expect(stored.status).toBe('PENDING');
        expect(stored).not.toHaveProperty('reviewedBy');
        expect(stored).not.toHaveProperty('reviewedAt');
        expect(stored).not.toHaveProperty('adminRemark');
    });

    it('leaves a decision that has already been recorded entirely alone', async () => {
        // The other half of the same rule, and MOV-272's version of it: an
        // edit must not undo a review — and once one has been made, the report
        // it was made about is not the author's to change either. The whole
        // request is refused rather than applied around the review fields.
        const reviewedAt = '2026-08-21T09:00:00.000Z';

        const firestore = firestoreWith(
            storedReport({
                status: 'VERIFIED',
                reviewedBy: 'UID-ADMIN',
                reviewedAt,
                adminRemark: 'Depot confirmed the ramp motor had failed.',
            })
        );
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(409);

        const stored = (await firestore.collection('reports').doc(REPORT_ID).get()).data() ?? {};

        expect(stored.status).toBe('VERIFIED');
        expect(stored.reviewedBy).toBe('UID-ADMIN');
        expect(stored.reviewedAt).toBe(reviewedAt);
        expect(stored.adminRemark).toBe('Depot confirmed the ramp motor had failed.');
    });
});

// ==================================================================
// A decided report is closed to its author (MOV-272)
//
// Editing and deleting are the author's only while the report is waiting to be
// reviewed. The moment an admin decides it, the report becomes the thing that
// was decided: an edit would change the account behind a finding somebody
// stands behind, and a delete would remove the finding — or, on a rejection,
// the answer its author is owed — outright.
//
// 409 rather than 403, because the caller IS the owner and the request IS well
// formed. What stopped it is the state the report reached, which is what the
// review route already answers 409 for.
// ==================================================================
describe('PUT /api/reports/[reportId] - a report that has been decided', () => {
    it('refuses to edit a verified report', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'VERIFIED' })));

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(409);
        expect(json.success).toBe(false);
        expect(json.message).toContain('VERIFIED');
    });

    it('refuses to edit a rejected report', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'REJECTED' })));

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(409);
    });

    it('changes nothing the report said', async () => {
        const firestore = firestoreWith(storedReport({ status: 'VERIFIED' }));
        mockGetAdminDb.mockReturnValue(firestore);

        await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );

        const stored = (await firestore.collection('reports').doc(REPORT_ID).get()).data() ?? {};

        expect(stored.issueCategory).toBe('BROKEN_RAMP');
        expect(stored.description).toBe(
            'The wheelchair ramp would not fold down at Pettah station.'
        );
        expect(new Date(stored.updatedAt).toISOString()).toBe(FILED_AT.toISOString());
    });

    it('refuses the edit before it validates the body', async () => {
        // A decided report answers 409 whatever was sent, rather than 400 for
        // a field that was never going to be stored.
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'VERIFIED' })));

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({ description: '   ', issueCategory: 'NOT_A_CATEGORY' }),
            }),
            params()
        );

        expect(response.status).toBe(409);
    });

    it('still edits a report that is only waiting to be reviewed', async () => {
        // The rule closes a decided report, not a pending one — a passenger
        // asked for more detail must still be able to add it.
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'PENDING' })));

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(200);
    });

    it('still edits a report whose only review so far is a remark', async () => {
        // A remark carries no decision, so it leaves the report at PENDING and
        // leaves it open.
        mockGetAdminDb.mockReturnValue(
            firestoreWith(
                storedReport({
                    status: 'PENDING',
                    reviewedBy: 'UID-ADMIN',
                    reviewedAt: '2026-08-21T09:00:00.000Z',
                    adminRemark: 'Chasing the depot for a repair date.',
                })
            )
        );

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(200);
    });

    it('refuses another passenger before it looks at the status at all', async () => {
        // Ownership is still the first question: somebody else's pending
        // report is a 403, not a 409.
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'PENDING' })));

        const response = await updateReport(
            request('PUT', { token: OTHER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(403);
    });

    it('tells a stranger nothing more about a decided report either', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'VERIFIED' })));

        const response = await updateReport(
            request('PUT', { token: OTHER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(403);
    });
});

describe('DELETE /api/reports/[reportId] - a report that has been decided', () => {
    it('refuses to delete a verified report', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'VERIFIED' })));

        const response = await deleteReport(
            request('DELETE', { token: OWNER_SESSION }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(409);
        expect(json.success).toBe(false);
        expect(json.message).toContain('VERIFIED');
    });

    it('refuses to delete a rejected report', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith(storedReport({ status: 'REJECTED' })));

        const response = await deleteReport(
            request('DELETE', { token: OWNER_SESSION }),
            params()
        );

        expect(response.status).toBe(409);
    });

    it('leaves the document in place', async () => {
        const firestore = firestoreWith(storedReport({ status: 'VERIFIED' }));
        mockGetAdminDb.mockReturnValue(firestore);

        await deleteReport(request('DELETE', { token: OWNER_SESSION }), params());

        const doc = await firestore.collection('reports').doc(REPORT_ID).get();

        expect(doc.exists).toBe(true);
        expect((doc.data() ?? {}).status).toBe('VERIFIED');
    });

    it('still deletes a report that is waiting to be reviewed', async () => {
        const firestore = firestoreWith(storedReport({ status: 'PENDING' }));
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await deleteReport(
            request('DELETE', { token: OWNER_SESSION }),
            params()
        );

        expect(response.status).toBe(200);
        expect((await firestore.collection('reports').doc(REPORT_ID).get()).exists).toBe(false);
    });
});

describe('PUT /api/reports/[reportId] - anybody else', () => {
    it('refuses another passenger', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OTHER_SESSION, body: validEdit() }),
            params()
        );

        expect(response.status).toBe(403);
    });

    it('leaves the report exactly as it was', async () => {
        const firestore = firestoreWith();
        mockGetAdminDb.mockReturnValue(firestore);

        await updateReport(
            request('PUT', { token: OTHER_SESSION, body: validEdit() }),
            params()
        );

        const stored = await firestore.collection('reports').doc(REPORT_ID).get();
        const data = stored.data() ?? {};

        expect(data.issueCategory).toBe('BROKEN_RAMP');
        expect(data.description).toContain('wheelchair ramp');
    });

    it('answers 404 for a report that is not there', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit(),
                reportId: 'REP-99999',
            }),
            params('REP-99999')
        );

        expect(response.status).toBe(404);
    });
});

describe('PUT /api/reports/[reportId] - validation', () => {
    it('refuses an empty description', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit({ description: '   ' }) }),
            params()
        );

        expect(response.status).toBe(400);
    });

    it('refuses a category the picker never offered', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({ issueCategory: 'SOMETHING_ELSE' }),
            }),
            params()
        );

        expect(response.status).toBe(400);
    });

    it('refuses a photo URL that is not an uploaded photo', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', {
                token: OWNER_SESSION,
                body: validEdit({ photoUrls: ['https://example.com/not-cloudinary.jpg'] }),
            }),
            params()
        );

        expect(response.status).toBe(400);
    });

    it('refuses a bus that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await updateReport(
            request('PUT', { token: OWNER_SESSION, body: validEdit({ busId: 'BUS-99999' }) }),
            params()
        );

        expect(response.status).toBe(404);
    });
});

// ==================================================================
// DELETE
// ==================================================================
describe('DELETE /api/reports/[reportId]', () => {
    it('lets the owner delete their report', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await deleteReport(
            request('DELETE', { token: OWNER_SESSION }),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
    });

    it('removes the document', async () => {
        const firestore = firestoreWith();
        mockGetAdminDb.mockReturnValue(firestore);

        await deleteReport(request('DELETE', { token: OWNER_SESSION }), params());

        const stored = await firestore.collection('reports').doc(REPORT_ID).get();

        expect(stored.exists).toBe(false);
    });

    it('refuses another passenger', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await deleteReport(
            request('DELETE', { token: OTHER_SESSION }),
            params()
        );

        expect(response.status).toBe(403);
    });

    it('leaves the report in place when it refuses', async () => {
        const firestore = firestoreWith();
        mockGetAdminDb.mockReturnValue(firestore);

        await deleteReport(request('DELETE', { token: OTHER_SESSION }), params());

        const stored = await firestore.collection('reports').doc(REPORT_ID).get();

        expect(stored.exists).toBe(true);
    });

    it('answers 404 for a report that is not there', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await deleteReport(
            request('DELETE', { token: OWNER_SESSION, reportId: 'REP-99999' }),
            params('REP-99999')
        );

        expect(response.status).toBe(404);
    });
});
