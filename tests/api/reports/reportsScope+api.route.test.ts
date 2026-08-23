// GET /api/reports — the scope parameter that backs the list screen's tabs.
//
// The one rule worth testing here is that "My Reports" is a server-side filter.
// The screen sends `scope=my` and gets back only the reports filed by whoever
// the token says it is; it never receives everybody's reports and narrows them
// down itself, which would put other passengers' reports on the wire.
//
// `scope=all` is left exactly as it was — unfiltered — and is covered below so
// that a change to the `my` branch cannot quietly narrow it too.

import { GET as listReports } from '../../../app/api/reports/index+api';
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
const PASSENGER_A = 'PSG-00001';
const PASSENGER_B = 'PSG-00002';

const SESSION_A = 'session-passenger-a';
const SESSION_B = 'session-passenger-b';

const SESSIONS: Record<string, Record<string, string>> = {
    [SESSION_A]: {
        uid: 'UID-A',
        passengerId: PASSENGER_A,
        role: 'PASSENGER',
        email: 'passenger.a@example.com',
    },
    [SESSION_B]: {
        uid: 'UID-B',
        passengerId: PASSENGER_B,
        role: 'PASSENGER',
        email: 'passenger.b@example.com',
    },
};

function storedReport(overrides: Record<string, any> = {}) {
    return {
        id: 'REP-00001',
        reportId: 'REP-00001',
        passengerId: PASSENGER_A,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        createdAt: new Date('2026-08-20T14:05:00.000Z'),
        updatedAt: new Date('2026-08-20T14:05:00.000Z'),
        ...overrides,
    };
}

/** Two passengers' reports in one collection — the case `scope=my` is for. */
function mixedFirestore() {
    return createFakeFirestore({
        reports: [
            storedReport(),
            storedReport({
                id: 'REP-00002',
                reportId: 'REP-00002',
                passengerId: PASSENGER_B,
                issueCategory: 'LIFT_NOT_WORKING',
            }),
            storedReport({
                id: 'REP-00003',
                reportId: 'REP-00003',
                passengerId: PASSENGER_A,
                issueCategory: 'BUS_OVERCROWDED',
                status: 'VERIFIED',
            }),
        ],
    });
}

function listRequest(scope?: string, token?: string): Request {
    const headers: Record<string, string> = {};

    if (token) headers.Authorization = `Bearer ${token}`;

    const url = scope
        ? `http://localhost/api/reports?scope=${scope}`
        : 'http://localhost/api/reports';

    return new Request(url, { method: 'GET', headers });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Authentication
// ==================================================================
describe('GET /api/reports - authentication', () => {
    it('rejects a request with no Authorization header', async () => {
        mockGetAdminDb.mockReturnValue(mixedFirestore());

        const response = await listReports(listRequest('my'));

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('rejects a token that does not verify', async () => {
        mockGetAdminDb.mockReturnValue(mixedFirestore());

        const response = await listReports(listRequest('my', 'forged-session'));

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });
});

// ==================================================================
// scope=my — the filter this tab depends on
// ==================================================================
describe('GET /api/reports?scope=my', () => {
    it('returns only the reports belonging to the caller', async () => {
        mockGetAdminDb.mockReturnValue(mixedFirestore());

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.reports.map((report: any) => report.reportId)).toEqual([
            'REP-00001',
            'REP-00003',
        ]);
    });

    it('never includes another passenger, whatever their reports say', async () => {
        mockGetAdminDb.mockReturnValue(mixedFirestore());

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(
            json.reports.every((report: any) => report.passengerId === PASSENGER_A)
        ).toBe(true);
    });

    it('gives each passenger their own reports from the same collection', async () => {
        mockGetAdminDb.mockReturnValue(mixedFirestore());

        const response = await listReports(listRequest('my', SESSION_B));
        const json = await response.json();

        expect(json.reports.map((report: any) => report.reportId)).toEqual(['REP-00002']);
    });

    it('filters on passengerId in the query rather than after the read', async () => {
        // The distinction matters: filtering after the read would mean every
        // report in the collection had been fetched to build one passenger's
        // list. `where` on the query is what keeps that off the wire.
        const firestore = mixedFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        await listReports(listRequest('my', SESSION_A));

        const collection = firestore.collection.mock.results[0].value;

        expect(collection.where).toHaveBeenCalledWith('passengerId', '==', PASSENGER_A);
    });

    it('does not ask the query to order on top of the filter', async () => {
        // passengerId + createdAt DESC is exactly the pair Firestore refuses
        // without a composite index — it fails the read with FAILED_PRECONDITION
        // rather than returning anything. Asking for the filter alone is what
        // keeps this answerable against the database as it stands.
        const firestore = mixedFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        await listReports(listRequest('my', SESSION_A));

        const collection = firestore.collection.mock.results[0].value;
        const filtered = collection.where.mock.results[0].value;

        expect(filtered.orderBy).not.toHaveBeenCalled();
    });

    it('still returns the newest report first', async () => {
        // Where the ordering happens changed; what the tab shows did not.
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport({
                        id: 'REP-00001',
                        reportId: 'REP-00001',
                        createdAt: new Date('2026-08-18T09:00:00.000Z'),
                    }),
                    storedReport({
                        id: 'REP-00004',
                        reportId: 'REP-00004',
                        createdAt: new Date('2026-08-22T09:00:00.000Z'),
                    }),
                    storedReport({
                        id: 'REP-00003',
                        reportId: 'REP-00003',
                        createdAt: new Date('2026-08-20T09:00:00.000Z'),
                    }),
                ],
            })
        );

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(json.reports.map((report: any) => report.reportId)).toEqual([
            'REP-00004',
            'REP-00003',
            'REP-00001',
        ]);
    });

    it('orders Firestore timestamps, not only plain dates', async () => {
        // What the database actually hands back is a Timestamp; the ordering
        // has to read it after it has been unwrapped, not before.
        const at = (iso: string) => ({ toDate: () => new Date(iso) });

        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport({
                        id: 'REP-00001',
                        reportId: 'REP-00001',
                        createdAt: at('2026-08-18T09:00:00.000Z'),
                    }),
                    storedReport({
                        id: 'REP-00004',
                        reportId: 'REP-00004',
                        createdAt: at('2026-08-22T09:00:00.000Z'),
                    }),
                ],
            })
        );

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(json.reports.map((report: any) => report.reportId)).toEqual([
            'REP-00004',
            'REP-00001',
        ]);
    });

    it('puts a report with no readable date last instead of dropping it', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport({
                        id: 'REP-00005',
                        reportId: 'REP-00005',
                        createdAt: undefined,
                    }),
                    storedReport({
                        id: 'REP-00004',
                        reportId: 'REP-00004',
                        createdAt: new Date('2026-08-22T09:00:00.000Z'),
                    }),
                ],
            })
        );

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(json.reports.map((report: any) => report.reportId)).toEqual([
            'REP-00004',
            'REP-00005',
        ]);
    });

    it('answers with an empty list for a passenger who has filed nothing', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ reports: [storedReport({ passengerId: PASSENGER_B })] })
        );

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.reports).toEqual([]);
        expect(json.count).toBe(0);
    });

    it('carries the fields the report card renders, PENDING status included', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                reports: [
                    storedReport({
                        busId: 'BUS-00007',
                        vehicle: { numberPlate: 'NB-1234' },
                        routeId: 'R-138-OUT',
                        route: { routeNumber: '138', routeName: 'Colombo - Kandy' },
                        photoUrls: [
                            'https://res.cloudinary.com/moreable/image/upload/v1/a.jpg',
                            'https://res.cloudinary.com/moreable/image/upload/v1/b.jpg',
                        ],
                    }),
                ],
            })
        );

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();
        const [report] = json.reports;

        expect(report.status).toBe('PENDING');
        expect(report.vehicle.numberPlate).toBe('NB-1234');
        expect(report.route.routeNumber).toBe('138');
        expect(report.photoUrls).toHaveLength(2);
    });

    it('serialises the Firestore timestamps the card formats', async () => {
        const createdAt = new Date('2026-08-20T14:05:00.000Z');

        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                // A Firestore Timestamp answers .toDate(); a plain Date does not.
                reports: [
                    storedReport({
                        createdAt: { toDate: () => createdAt },
                        updatedAt: { toDate: () => createdAt },
                    }),
                ],
            })
        );

        const response = await listReports(listRequest('my', SESSION_A));
        const json = await response.json();

        expect(new Date(json.reports[0].createdAt).toISOString()).toBe(createdAt.toISOString());
    });
});

// ==================================================================
// scope=all — unchanged, and must stay that way
// ==================================================================
describe('GET /api/reports?scope=all', () => {
    it('returns every passenger‘s reports', async () => {
        mockGetAdminDb.mockReturnValue(mixedFirestore());

        const response = await listReports(listRequest('all', SESSION_A));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.reports).toHaveLength(3);
        expect(json.count).toBe(3);
    });

    it('applies no passengerId filter at all', async () => {
        const firestore = mixedFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        await listReports(listRequest('all', SESSION_A));

        const collection = firestore.collection.mock.results[0].value;

        expect(collection.where).not.toHaveBeenCalled();
    });

    it('leaves the ordering to Firestore, as it always did', async () => {
        // Unfiltered, orderBy needs no composite index, so this scope keeps
        // ordering in the query.
        const firestore = mixedFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        await listReports(listRequest('all', SESSION_A));

        const collection = firestore.collection.mock.results[0].value;

        expect(collection.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });
});
