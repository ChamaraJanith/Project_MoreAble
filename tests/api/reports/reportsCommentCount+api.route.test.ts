// GET /api/reports — the comment count each card draws.
//
// The two vote tallies are stored on the report document, so the list already
// carried them. Comments are not counted onto anything, so the number has to be
// derived — and the rule this file exists for is WHERE. One query tallies the
// whole page here; a query per report would make a thirty-report list thirty
// round trips, and leaving it to the app would make it thirty requests.
//
// The other rule is that a report nobody has commented on comes back as zero
// rather than as a missing field, because a card that has to guard against an
// absent count is a card that will eventually be built without the guard.

import { GET as listReports } from '../../../app/api/reports/index+api';
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
const PASSENGER = 'PAS-2026-00001';
const OTHER_PASSENGER = 'PAS-2026-00002';
const SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [SESSION]: {
        uid: 'UID-A',
        passengerId: PASSENGER,
        role: 'PASSENGER',
        email: 'passenger@example.com',
    },
};

function storedReport(reportId: string, overrides: Record<string, any> = {}) {
    return {
        id: reportId,
        reportId,
        passengerId: PASSENGER,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        createdAt: new Date('2026-08-20T14:05:00.000Z'),
        updatedAt: new Date('2026-08-20T14:05:00.000Z'),
        ...overrides,
    };
}

function storedComment(commentId: string, reportId: string) {
    return {
        id: commentId,
        commentId,
        reportId,
        passengerId: OTHER_PASSENGER,
        authorName: 'Kasun Silva',
        text: 'The ramp was not working properly.',
        createdAt: '2026-08-22T09:30:00.000Z',
    };
}

function listRequest(scope?: string, token: string | undefined = SESSION): Request {
    const headers: Record<string, string> = {};

    if (token) headers.Authorization = `Bearer ${token}`;

    return new Request(
        scope ? `http://localhost/api/reports?scope=${scope}` : 'http://localhost/api/reports',
        { method: 'GET', headers }
    );
}

/** The returned reports, keyed by report id. */
async function listed(response: Response) {
    const body = await response.json();

    return {
        body,
        byId: Object.fromEntries(
            (body.reports ?? []).map((report: any) => [report.reportId, report])
        ) as Record<string, any>,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// The count itself
// ==================================================================
describe('GET /api/reports - commentCount', () => {
    it('reports zero for a report nobody has commented on', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ reports: [storedReport('REP-00001')], comments: [] })
        );

        const { byId } = await listed(await listReports(listRequest()));

        // A number, not an absent field: the card reads it without a guard.
        expect(byId['REP-00001'].commentCount).toBe(0);
    });

    it('counts the comments a report has drawn', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [storedReport('REP-00001')],
                comments: [
                    storedComment('CMT-00001', 'REP-00001'),
                    storedComment('CMT-00002', 'REP-00001'),
                ],
            })
        );

        const { byId } = await listed(await listReports(listRequest()));

        expect(byId['REP-00001'].commentCount).toBe(2);
    });

    it('counts each report separately', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport('REP-00001'),
                    storedReport('REP-00002'),
                    storedReport('REP-00003'),
                ],
                comments: [
                    storedComment('CMT-00001', 'REP-00001'),
                    storedComment('CMT-00002', 'REP-00001'),
                    storedComment('CMT-00003', 'REP-00002'),
                ],
            })
        );

        const { byId } = await listed(await listReports(listRequest()));

        expect(byId['REP-00001'].commentCount).toBe(2);
        expect(byId['REP-00002'].commentCount).toBe(1);
        expect(byId['REP-00003'].commentCount).toBe(0);
    });

    it('does not count a comment towards a report it does not belong to', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [storedReport('REP-00001')],
                comments: [storedComment('CMT-00009', 'REP-00404')],
            })
        );

        const { byId } = await listed(await listReports(listRequest()));

        expect(byId['REP-00001'].commentCount).toBe(0);
    });

    it('is on every report of a filtered scope too', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport('REP-00001'),
                    storedReport('REP-00002', { passengerId: OTHER_PASSENGER }),
                ],
                comments: [storedComment('CMT-00001', 'REP-00001')],
            })
        );

        const { body, byId } = await listed(await listReports(listRequest('my')));

        expect(body.count).toBe(1);
        expect(byId['REP-00001'].commentCount).toBe(1);
    });
});

// ==================================================================
// One query, not one per card
// ==================================================================
describe('how the count is fetched', () => {
    it('reads the comments collection once for the whole list', async () => {
        const db = createFakeFirestore({
            reports: Array.from({ length: 12 }, (unused, index) =>
                storedReport(`REP-${String(index + 1).padStart(5, '0')}`)
            ),
            comments: [
                storedComment('CMT-00001', 'REP-00001'),
                storedComment('CMT-00002', 'REP-00007'),
            ],
        });

        mockGetAdminDb.mockReturnValue(db);

        const { body, byId } = await listed(await listReports(listRequest()));

        expect(body.count).toBe(12);

        // Twelve cards, one comments query. Not one per card, and not one per
        // card from the app either — the number arrives with the list.
        const commentReads = db.collection.mock.calls.filter(
            (call: unknown[]) => call[0] === 'comments'
        );

        expect(commentReads).toHaveLength(1);

        expect(byId['REP-00001'].commentCount).toBe(1);
        expect(byId['REP-00007'].commentCount).toBe(1);
        expect(byId['REP-00002'].commentCount).toBe(0);
    });

    it('never reads a single report comment thread to build the list', async () => {
        const db = createFakeFirestore({
            reports: [storedReport('REP-00001'), storedReport('REP-00002')],
            comments: [storedComment('CMT-00001', 'REP-00001')],
        });

        mockGetAdminDb.mockReturnValue(db);

        await listReports(listRequest());

        // The per-report thread lives behind GET /api/reports/:reportId/comments
        // and is the details screen's to fetch, not the list's.
        const collectionsRead = db.collection.mock.calls.map((call: unknown[]) => call[0]);

        expect(collectionsRead.sort()).toEqual(['comments', 'reports']);
    });
});

// ==================================================================
// What was already there
// ==================================================================
describe('the counts the list already carried', () => {
    it('still returns the stored vote tallies untouched', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport('REP-00001', {
                        agreeCount: 18,
                        disagreeCount: 1,
                        requiresAdminReview: true,
                    }),
                ],
                comments: [storedComment('CMT-00001', 'REP-00001')],
            })
        );

        const { byId } = await listed(await listReports(listRequest()));

        expect(byId['REP-00001']).toMatchObject({
            agreeCount: 18,
            disagreeCount: 1,
            requiresAdminReview: true,
            commentCount: 1,
        });
    });

    it('leaves the rest of the report exactly as it was', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ reports: [storedReport('REP-00001')], comments: [] })
        );

        const { byId } = await listed(await listReports(listRequest()));

        expect(byId['REP-00001']).toMatchObject({
            reportId: 'REP-00001',
            passengerId: PASSENGER,
            issueCategory: 'BROKEN_RAMP',
            status: 'PENDING',
            documentId: 'REP-00001',
        });
    });

    it('still refuses an unauthenticated list', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ reports: [storedReport('REP-00001')], comments: [] })
        );

        // Built without the helper, which always signs the request.
        const response = await listReports(
            new Request('http://localhost/api/reports', { method: 'GET' })
        );

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });
});
