// What a review decision actually leaves in Firestore (MOV-162).
//
// MOV-161's suite is about the API contract — who may call it, what it answers.
// This one is about the document underneath: which keys the write touches,
// which it must not, where the values come from, and whether the report still
// reads correctly through every route once the decision has been stored.
//
// The assertions are deliberately made against the STORED document rather than
// the response body wherever both are possible. A handler can return whatever
// it likes; the record is what a report is.

import {
    GET as getReports,
} from '../../../app/api/reports/index+api';
import {
    GET as getReport,
} from '../../../app/api/reports/[reportId]+api';
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

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const ADMIN_UID = 'UID-ADMIN';
const SECOND_ADMIN_UID = 'UID-ADMIN-2';
const PASSENGER = 'PSG-00001';

const ADMIN_SESSION = 'session-admin';
const SECOND_ADMIN_SESSION = 'session-admin-2';
const PASSENGER_SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: {
        uid: ADMIN_UID,
        passengerId: 'PSG-ADMIN',
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
    [SECOND_ADMIN_SESSION]: {
        uid: SECOND_ADMIN_UID,
        passengerId: 'PSG-ADMIN-2',
        role: 'ADMIN',
        email: 'second@moreable.lk',
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
const FLAGGED_AT = '2026-08-21T09:00:00.000Z';

const PHOTO_A = 'https://res.cloudinary.com/moreable/image/upload/v1/a.jpg';
const PHOTO_B = 'https://res.cloudinary.com/moreable/image/upload/v1/b.jpg';

const VEHICLE = { numberPlate: 'NB-1234', busModel: 'Rosa' };
const ROUTE = { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' };
const DESCRIPTION = 'The wheelchair ramp would not fold down at Pettah station.';

/** A flagged, still-undecided report — the queue's typical subject. */
function storedReport(overrides: Record<string, any> = {}) {
    return {
        // The fake derives its document id from `id`; a report also carries
        // busId and routeId, so it has to be given explicitly.
        id: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: PASSENGER,
        issueCategory: 'BROKEN_RAMP',
        description: DESCRIPTION,
        status: 'PENDING',
        busId: 'BUS-00007',
        vehicle: VEHICLE,
        routeId: 'R-138-OUT',
        route: ROUTE,
        photoUrls: [PHOTO_A, PHOTO_B],
        agreeCount: 6,
        disagreeCount: 1,
        requiresAdminReview: true,
        adminReviewFlaggedAt: FLAGGED_AT,
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

/** A second report, so a write can be shown not to reach its neighbours. */
function neighbourReport() {
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
    };
}

function baseFirestore(reports: Record<string, any>[]) {
    return createFakeFirestore({
        reports,
        votes: [
            { id: 'V1', reportId: REPORT_ID, vote: 'AGREE' },
            { id: 'V2', reportId: REPORT_ID, vote: 'DISAGREE' },
        ],
        comments: [
            {
                id: 'CMT-00001',
                commentId: 'CMT-00001',
                reportId: REPORT_ID,
                passengerId: 'PSG-00003',
                authorName: 'Nimali',
                text: 'Same on the 138 last week.',
                createdAt: '2026-08-21T08:00:00.000Z',
            },
        ],
    });
}

/**
 * The fake, wrapped so every document write is recorded.
 *
 * The point is requirement "use partial updates rather than replacing the
 * document": that is a claim about which SDK call the route makes, and it can
 * only be checked by watching the calls themselves. The wrapper delegates to
 * the real fake, so the stored data is still exactly what the route wrote.
 */
function trackingFirestore(reports: Record<string, any>[] = [storedReport(), neighbourReport()]) {
    const db: any = baseFirestore(reports);
    const writes = {
        set: [] as { collection: string; id: string; data: any }[],
        update: [] as { collection: string; id: string; data: any }[],
    };

    const baseCollection = db.collection;

    db.collection = jest.fn((name: string) => {
        const collection: any = baseCollection(name);
        const baseDoc = collection.doc;

        return {
            ...collection,
            doc: jest.fn((id: string) => {
                const ref: any = baseDoc(id);

                return {
                    ...ref,
                    set: jest.fn(async (data: any) => {
                        writes.set.push({ collection: name, id, data });
                        return ref.set(data);
                    }),
                    update: jest.fn(async (data: any) => {
                        writes.update.push({ collection: name, id, data });
                        return ref.update(data);
                    }),
                };
            }),
        };
    });

    return { db, writes };
}

function reviewRequest(
    body: unknown,
    options: { token?: string; reportId?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(
        `http://localhost/api/reports/${options.reportId ?? REPORT_ID}/review`,
        { method: 'POST', headers, body: JSON.stringify(body) }
    );
}

function readRequest(path: string, token: string): Request {
    return new Request(`http://localhost${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });
}

function params(reportId: string = REPORT_ID) {
    return { reportId };
}

/** The report exactly as Firestore holds it after the handler has run. */
async function storedDocument(db: any, reportId: string = REPORT_ID) {
    const doc = await db.collection('reports').doc(reportId).get();

    return doc.data();
}

/** Records a decision and hands back the stored document. */
async function review(db: any, body: unknown, token: string = ADMIN_SESSION) {
    const response = await reviewReport(reviewRequest(body, { token }), params());

    return { response, stored: await storedDocument(db) };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// The decision itself
// ==================================================================
describe('review persistence - the decision', () => {
    it('persists VERIFIED when an admin verifies a report', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { response, stored } = await review(db, { action: 'VERIFY' });

        expect(response.status).toBe(200);
        expect(stored.status).toBe('VERIFIED');
    });

    it('persists REJECTED when an admin rejects a report', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { response, stored } = await review(db, { action: 'REJECT' });

        expect(response.status).toBe(200);
        expect(stored.status).toBe('REJECTED');
    });

    it('persists the remark alongside a decision', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'VERIFY',
            adminRemark: 'Depot confirmed the ramp motor had failed.',
        });

        expect(stored.adminRemark).toBe('Depot confirmed the ramp motor had failed.');
        expect(stored.status).toBe('VERIFIED');
    });

    it('persists a remark on its own without touching the status', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'REMARK',
            adminRemark: '  Waiting on the depot.  ',
        });

        expect(stored.adminRemark).toBe('Waiting on the depot.');
        expect(stored.status).toBe('PENDING');
    });

    it('refuses to persist a remark beyond the existing cap', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { response, stored } = await review(db, {
            action: 'REMARK',
            adminRemark: 'x'.repeat(501),
        });

        expect(response.status).toBe(400);
        expect(stored.adminRemark).toBeUndefined();
        expect(stored.reviewedBy).toBeUndefined();
    });
});

// ==================================================================
// Who and when
// ==================================================================
describe('review persistence - reviewer identity and timestamps', () => {
    it('persists the reviewer from the verified session', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'VERIFY' });

        expect(stored.reviewedBy).toBe(ADMIN_UID);
    });

    it('ignores a reviewedBy supplied in the request body', async () => {
        // The audit field says who actually decided the report. A body that
        // claims otherwise is not consulted — the token is.
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'VERIFY',
            reviewedBy: 'UID-SOMEBODY-ELSE',
            reviewedAt: '1999-01-01T00:00:00.000Z',
        });

        expect(stored.reviewedBy).toBe(ADMIN_UID);
        expect(stored.reviewedAt).not.toBe('1999-01-01T00:00:00.000Z');
    });

    it('records the second admin when a second admin decides a different report', async () => {
        const { db } = trackingFirestore([storedReport({ id: REPORT_ID })]);
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'REJECT' }, SECOND_ADMIN_SESSION);

        expect(stored.reviewedBy).toBe(SECOND_ADMIN_UID);
    });

    it('stamps reviewedAt and updatedAt on the server, not from the request', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const before = Date.now();
        const { stored } = await review(db, { action: 'VERIFY' });
        const after = Date.now();

        const reviewedAt = new Date(stored.reviewedAt).getTime();
        const updatedAt = new Date(stored.updatedAt).getTime();

        expect(reviewedAt).toBeGreaterThanOrEqual(before);
        expect(reviewedAt).toBeLessThanOrEqual(after);
        expect(updatedAt).toBeGreaterThanOrEqual(before);
        expect(updatedAt).toBeLessThanOrEqual(after);
    });

    it('stores reviewedAt in the ISO form the rest of the report uses', async () => {
        // The same shape as adminReviewFlaggedAt, so one date formatter reads
        // every review field without a special case.
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'VERIFY' });

        expect(typeof stored.reviewedAt).toBe('string');
        expect(new Date(stored.reviewedAt).toISOString()).toBe(stored.reviewedAt);
    });

    it('moves updatedAt off the value the report was filed with', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'VERIFY' });

        expect(stored.updatedAt).not.toBe(FILED_AT);
        expect(stored.createdAt).toBe(FILED_AT);
    });
});

// ==================================================================
// Data integrity
// ==================================================================
describe('review persistence - data integrity', () => {
    it('changes only the review keys and leaves every other field identical', async () => {
        // The strongest form of "do not overwrite unrelated fields": diff the
        // whole document rather than spot-checking the fields we remembered.
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const before = { ...(await storedDocument(db)) };

        await review(db, { action: 'VERIFY', adminRemark: 'Confirmed with the depot.' });

        const after = await storedDocument(db);
        const changed = Object.keys(after)
            .filter((key) => after[key] !== before[key])
            .sort();

        expect(changed).toEqual([
            'adminRemark',
            'reviewedAt',
            'reviewedBy',
            'status',
            'updatedAt',
        ]);
    });

    it('leaves the report content exactly as it was filed', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'VERIFY' });

        expect(stored.reportId).toBe(REPORT_ID);
        expect(stored.issueCategory).toBe('BROKEN_RAMP');
        expect(stored.description).toBe(DESCRIPTION);
        expect(stored.busId).toBe('BUS-00007');
        expect(stored.vehicle).toBe(VEHICLE);
        expect(stored.routeId).toBe('R-138-OUT');
        expect(stored.route).toBe(ROUTE);
        expect(stored.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
    });

    it('leaves the community tallies and the review flag untouched', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'VERIFY',
            agreeCount: 0,
            disagreeCount: 400,
            requiresAdminReview: false,
        });

        expect(stored.agreeCount).toBe(6);
        expect(stored.disagreeCount).toBe(1);
        expect(stored.requiresAdminReview).toBe(true);
        expect(stored.adminReviewFlaggedAt).toBe(FLAGGED_AT);
    });

    it('cannot be used to change who filed the report', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'VERIFY',
            passengerId: 'PSG-99999',
        });

        expect(stored.passengerId).toBe(PASSENGER);
    });

    it('cannot be used to change when the report was filed', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'VERIFY',
            createdAt: '2020-01-01T00:00:00.000Z',
            reportId: 'REP-00001',
        });

        expect(stored.createdAt).toBe(FILED_AT);
        expect(stored.reportId).toBe(REPORT_ID);
    });

    it('cannot be used to rewrite the description or the evidence', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'REJECT',
            description: 'Nothing wrong with this bus.',
            issueCategory: 'OTHER',
            photoUrls: [],
            vehicle: { numberPlate: 'XX-0000' },
        });

        expect(stored.description).toBe(DESCRIPTION);
        expect(stored.issueCategory).toBe('BROKEN_RAMP');
        expect(stored.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
        expect(stored.vehicle).toBe(VEHICLE);
    });

    it('does not touch any other report', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY' });

        const neighbour = await storedDocument(db, OTHER_REPORT_ID);

        expect(neighbour.status).toBe('PENDING');
        expect(neighbour.reviewedBy).toBeUndefined();
        expect(neighbour.reviewedAt).toBeUndefined();
    });
});

// ==================================================================
// How the write is made
// ==================================================================
describe('review persistence - the write itself', () => {
    it('updates the document partially instead of replacing it', async () => {
        const { db, writes } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY', adminRemark: 'Confirmed.' });

        const reportWrites = writes.update.filter(
            (write) => write.collection === 'reports' && write.id === REPORT_ID
        );

        expect(reportWrites).toHaveLength(1);
        expect(Object.keys(reportWrites[0].data).sort()).toEqual([
            'adminRemark',
            'reviewedAt',
            'reviewedBy',
            'status',
            'updatedAt',
        ]);

        // `set` would replace the document and take the description, the photos
        // and the community's tallies with it.
        expect(writes.set).toHaveLength(0);
    });

    it('omits adminRemark from the write when none was given', async () => {
        // Absent rather than an empty string, so a decision made without a
        // remark does not put a blank one on the report.
        const { db, writes } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'REJECT' });

        expect(Object.keys(writes.update[0].data).sort()).toEqual([
            'reviewedAt',
            'reviewedBy',
            'status',
            'updatedAt',
        ]);
        expect(stored.adminRemark).toBeUndefined();
    });

    it('records the decision inside a transaction', async () => {
        // The PENDING check and the write have to be one operation, or two
        // admins deciding the same report both pass the check and both write.
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY' });

        expect(db.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('writes nothing at all when the request is refused', async () => {
        const { db, writes } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'NOT_AN_ACTION' });

        expect(writes.update).toHaveLength(0);
        expect(writes.set).toHaveLength(0);
    });
});

// ==================================================================
// Deciding once
// ==================================================================
describe('review persistence - a decision is made once', () => {
    it('refuses a second decision and keeps the first', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY', adminRemark: 'Confirmed with the depot.' });

        const first = await storedDocument(db);

        const { response, stored } = await review(db, { action: 'REJECT' }, SECOND_ADMIN_SESSION);

        expect(response.status).toBe(409);
        expect(stored.status).toBe('VERIFIED');
        expect(stored.reviewedBy).toBe(ADMIN_UID);
        expect(stored.reviewedAt).toBe(first.reviewedAt);
        expect(stored.adminRemark).toBe('Confirmed with the depot.');
    });

    it('refuses a repeat of the same decision', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'REJECT' });

        const { response } = await review(db, { action: 'REJECT' });

        expect(response.status).toBe(409);
    });

    it('still accepts a remark after the report has been decided', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY' });

        const { response, stored } = await review(db, {
            action: 'REMARK',
            adminRemark: 'Depot has scheduled the repair.',
        });

        expect(response.status).toBe(200);
        expect(stored.status).toBe('VERIFIED');
        expect(stored.adminRemark).toBe('Depot has scheduled the repair.');
        expect(stored.reviewedBy).toBe(ADMIN_UID);
    });
});

// ==================================================================
// Reading the decision back
// ==================================================================
describe('review persistence - the report reads back with its review', () => {
    it('is returned by the admin review route with the stored decision', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, {
            action: 'VERIFY',
            adminRemark: 'Depot confirmed the ramp motor had failed.',
        });

        const response = await getReportForReview(
            readRequest(`/api/reports/${REPORT_ID}/review`, ADMIN_SESSION),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report.status).toBe('VERIFIED');
        expect(json.review).toEqual({
            status: 'VERIFIED',
            reviewedBy: ADMIN_UID,
            reviewedAt: stored.reviewedAt,
            adminRemark: 'Depot confirmed the ramp motor had failed.',
        });
    });

    it('is still readable through the existing single-report route', async () => {
        // The passenger-facing route was not changed by the review work, and a
        // decided report has to keep reading correctly through it.
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        const { stored } = await review(db, { action: 'REJECT', adminRemark: 'Duplicate.' });

        const response = await getReport(
            readRequest(`/api/reports/${REPORT_ID}`, PASSENGER_SESSION),
            params()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.report.status).toBe('REJECTED');
        expect(json.report.reviewedBy).toBe(ADMIN_UID);
        expect(json.report.reviewedAt).toBe(stored.reviewedAt);
        expect(json.report.adminRemark).toBe('Duplicate.');
        expect(json.report.description).toBe(DESCRIPTION);
        expect(json.report.photoUrls).toEqual([PHOTO_A, PHOTO_B]);
    });

    it('carries the decision into the admin review queue', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY', adminRemark: 'Confirmed.' });

        const response = await getReports(
            readRequest('/api/reports?scope=review', ADMIN_SESSION)
        );
        const json = await response.json();

        const decided = json.reports.find((entry: any) => entry.reportId === REPORT_ID);

        expect(decided.status).toBe('VERIFIED');
        expect(decided.review.reviewedBy).toBe(ADMIN_UID);
        expect(decided.review.adminRemark).toBe('Confirmed.');

        // The community's numbers are still the community's.
        expect(decided.agreeCount).toBe(6);
        expect(decided.disagreeCount).toBe(1);
        expect(decided.requiresAdminReview).toBe(true);
    });

    it('leaves an undecided report reading as undecided', async () => {
        const { db } = trackingFirestore();
        mockGetAdminDb.mockReturnValue(db);

        await review(db, { action: 'VERIFY' });

        const response = await getReports(
            readRequest('/api/reports?scope=review', ADMIN_SESSION)
        );
        const json = await response.json();

        const neighbour = json.reports.find((entry: any) => entry.reportId === OTHER_REPORT_ID);

        expect(neighbour.status).toBe('PENDING');
        expect(neighbour.review).toBeNull();
    });
});
