// Complaint CRUD APIs (MOV-177), tested for MOV-179.
//
// A complaint is opened by an admin from a report they have already VERIFIED,
// and lives in its own collection. The rules these tests hold the routes to:
//
//   - every complaint route is an admin's: 401 without a session, 403 for any
//     session that is not ADMIN, whatever the app happens to render;
//   - a complaint can only be opened from a VERIFIED accessibility ISSUE, once;
//   - opening one copies what it needs off the report and leaves the report
//     itself exactly as it was;
//   - the list and the detail read back what was stored, without the passenger
//     who filed the source report.

import {
    GET as getComplaint,
} from '../../../app/api/complaints/[complaintId]+api';
import {
    GET as listComplaints,
    POST as createComplaint,
} from '../../../app/api/complaints/index+api';
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
const PASSENGER = 'PAS-2026-00001';

const ADMIN_SESSION = 'session-admin';
const PASSENGER_SESSION = 'session-passenger';
const GUARDIAN_SESSION = 'session-guardian';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: {
        uid: ADMIN_UID,
        passengerId: 'ADM-2026-00001',
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
    [PASSENGER_SESSION]: {
        uid: 'UID-P1',
        passengerId: PASSENGER,
        role: 'PASSENGER',
        email: 'passenger@example.com',
    },
    [GUARDIAN_SESSION]: {
        uid: 'UID-G1',
        passengerId: 'GRD-2026-00001',
        role: 'GUARDIAN',
        email: 'guardian@example.com',
    },
};

const REPORT_ID = 'REP-00025';
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');

/** A VERIFIED issue report naming a bus and a route — what a complaint is opened from. */
function verifiedReport(overrides: Record<string, any> = {}) {
    return {
        // The fake derives a document id from `id` — a report also carries
        // busId and passengerId, so it has to be given explicitly.
        id: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: PASSENGER,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'VERIFIED',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234', busModel: 'Rosa', manufacturer: 'Toyota' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
        photoUrls: ['https://res.cloudinary.com/moreable/image/upload/v1/a.jpg'],
        agreeCount: 6,
        disagreeCount: 1,
        requiresAdminReview: true,
        reviewedBy: ADMIN_UID,
        reviewedAt: '2026-08-22T09:00:00.000Z',
        adminRemark: 'Confirmed on site.',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

/** A stored complaint, in whatever state a case needs. */
function storedComplaint(complaintId: string, overrides: Record<string, any> = {}) {
    return {
        id: complaintId,
        complaintId,
        reportId: REPORT_ID,
        status: 'PENDING',
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138' },
        createdBy: ADMIN_UID,
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        updatedAt: new Date('2026-09-01T08:00:00.000Z'),
        ...overrides,
    };
}

function seedFirestore(seed: Record<string, Record<string, any>[]> = {}) {
    const db = createFakeFirestore({
        reports: [verifiedReport()],
        complaints: [],
        counters: [],
        ...seed,
    });

    mockGetAdminDb.mockReturnValue(db);

    return db;
}

async function readDoc(db: any, collection: string, id: string) {
    const snapshot = await db.collection(collection).doc(id).get();

    return snapshot.exists ? snapshot.data() : undefined;
}

// ------------------------------------------------------------------
// Requests
// ------------------------------------------------------------------
function jsonRequest(
    url: string,
    method: string,
    options: { token?: string | null; body?: unknown; rawBody?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const body =
        options.rawBody !== undefined
            ? options.rawBody
            : options.body === undefined
              ? undefined
              : JSON.stringify(options.body);

    return new Request(`http://localhost${url}`, { method, headers, body });
}

function create(body: unknown, token: string | null = ADMIN_SESSION) {
    return createComplaint(jsonRequest('/api/complaints', 'POST', { token, body }));
}

function list(query = '', token: string | null = ADMIN_SESSION) {
    return listComplaints(jsonRequest(`/api/complaints${query}`, 'GET', { token }));
}

function detail(complaintId: string, token: string | null = ADMIN_SESSION) {
    return getComplaint(
        jsonRequest(`/api/complaints/${encodeURIComponent(complaintId)}`, 'GET', { token }),
        { params: { complaintId } }
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ------------------------------------------------------------------
// Authorisation
// ------------------------------------------------------------------
describe('complaint CRUD authorisation', () => {
    const routes: [string, (token: string | null) => Promise<Response>][] = [
        ['POST /api/complaints', (token) => create({ reportId: REPORT_ID }, token)],
        ['GET /api/complaints', (token) => list('', token)],
        ['GET /api/complaints/:complaintId', (token) => detail('CMP-00001', token)],
    ];

    beforeEach(() => {
        // The seeded complaint is on another report, so an admin's POST is free
        // to open one on REPORT_ID.
        seedFirestore({
            complaints: [storedComplaint('CMP-00001', { reportId: 'REP-00099' })],
            counters: [{ id: 'complaints', lastNumber: 1 }],
        });
    });

    describe.each(routes)('%s', (_name, call) => {
        it('answers 401 without a session', async () => {
            const response = await call(null);

            expect(response.status).toBe(401);
            expect(await response.json()).toMatchObject({ success: false });
        });

        it('answers 401 for a token that does not verify', async () => {
            expect((await call('session-forged')).status).toBe(401);
        });

        it.each([
            ['PASSENGER', PASSENGER_SESSION],
            ['GUARDIAN', GUARDIAN_SESSION],
        ])('answers 403 for a %s session', async (_role, token) => {
            const response = await call(token);

            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({
                success: false,
                message: 'Only an administrator can manage complaints.',
            });
        });

        it('allows an ADMIN session', async () => {
            expect((await call(ADMIN_SESSION)).status).toBeLessThan(300);
        });
    });

    it('writes nothing when a non-admin tries to create a complaint', async () => {
        const db = seedFirestore();

        await create({ reportId: REPORT_ID }, PASSENGER_SESSION);

        expect(await readDoc(db, 'counters', 'complaints')).toBeUndefined();
        expect((await db.collection('complaints').get()).docs).toHaveLength(0);
    });
});

// ------------------------------------------------------------------
// POST /api/complaints
// ------------------------------------------------------------------
describe('POST /api/complaints', () => {
    it('opens a PENDING complaint from a VERIFIED issue report', async () => {
        seedFirestore();

        const response = await create({ reportId: REPORT_ID });
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.complaint).toMatchObject({
            complaintId: 'CMP-00001',
            reportId: REPORT_ID,
            status: 'PENDING',
            issueCategory: 'BROKEN_RAMP',
            description: 'The wheelchair ramp would not fold down at Pettah station.',
            busId: 'BUS-00007',
            vehicle: { numberPlate: 'NB-1234', busModel: 'Rosa', manufacturer: 'Toyota' },
            routeId: 'R-138-OUT',
            route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
            createdBy: ADMIN_UID,
        });
        expect(typeof json.complaint.createdAt).toBe('string');
        expect(json.complaint.updatedAt).toBe(json.complaint.createdAt);
    });

    it('stores the complaint at complaints/{complaintId}, with no workflow or passenger fields', async () => {
        const db = seedFirestore();

        await create({ reportId: REPORT_ID });

        const stored = await readDoc(db, 'complaints', 'CMP-00001');

        expect(stored).toMatchObject({ complaintId: 'CMP-00001', status: 'PENDING', createdBy: ADMIN_UID });
        expect(stored.createdAt).toBeInstanceOf(Date);
        expect(stored.updatedAt).toBeInstanceOf(Date);

        for (const field of [
            'passengerId',
            'photoUrls',
            'agreeCount',
            'reviewedBy',
            'adminRemark',
            'assignedTo',
            'assignedToName',
            'assignedBy',
            'assignedAt',
            'startedAt',
            'resolvedBy',
            'resolvedAt',
            'resolutionNote',
        ]) {
            expect(stored).not.toHaveProperty(field);
        }
    });

    it('leaves the source report exactly as it was', async () => {
        const db = seedFirestore();
        const before = structuredClone(await readDoc(db, 'reports', REPORT_ID));

        await create({ reportId: REPORT_ID });

        const after = await readDoc(db, 'reports', REPORT_ID);

        expect(after).toEqual(before);
        expect(after.status).toBe('VERIFIED');
    });

    it('omits the bus and route keys when the report named neither', async () => {
        const db = seedFirestore({
            reports: [
                verifiedReport({
                    busId: undefined,
                    vehicle: undefined,
                    routeId: undefined,
                    route: undefined,
                }),
            ],
        });

        await create({ reportId: REPORT_ID });

        const stored = await readDoc(db, 'complaints', 'CMP-00001');

        for (const field of ['busId', 'vehicle', 'routeId', 'route']) {
            expect(stored).not.toHaveProperty(field);
        }
    });

    it('draws sequential CMP- ids from counters/complaints', async () => {
        const db = seedFirestore({
            reports: [verifiedReport(), verifiedReport({ id: 'REP-00026', reportId: 'REP-00026' })],
        });

        const first = await (await create({ reportId: REPORT_ID })).json();
        const second = await (await create({ reportId: 'REP-00026' })).json();

        expect(first.complaint.complaintId).toBe('CMP-00001');
        expect(second.complaint.complaintId).toBe('CMP-00002');
        expect(await readDoc(db, 'counters', 'complaints')).toMatchObject({ lastNumber: 2 });
    });

    it('ignores a status, creator or id supplied in the body', async () => {
        seedFirestore();

        const json = await (
            await create({
                reportId: REPORT_ID,
                status: 'RESOLVED',
                complaintId: 'CMP-99999',
                createdBy: 'UID-FORGED',
                assignedTo: 'ADM-2026-00009',
            })
        ).json();

        expect(json.complaint).toMatchObject({
            complaintId: 'CMP-00001',
            status: 'PENDING',
            createdBy: ADMIN_UID,
        });
        expect(json.complaint).not.toHaveProperty('assignedTo');
    });

    describe('refusals', () => {
        it.each([
            ['no reportId', {}],
            ['an empty reportId', { reportId: '' }],
            ['a non-string reportId', { reportId: 25 }],
            ['a reportId containing "/"', { reportId: 'REP/00025' }],
            ['a whitespace reportId', { reportId: '   ' }],
            ['an array body', [REPORT_ID]],
        ])('answers 400 for %s', async (_case, body) => {
            seedFirestore();

            const response = await create(body);

            expect(response.status).toBe(400);
            expect((await response.json()).success).toBe(false);
        });

        it('answers 400 for a body that is not JSON', async () => {
            seedFirestore();

            const response = await createComplaint(
                jsonRequest('/api/complaints', 'POST', { token: ADMIN_SESSION, rawBody: '{nope' })
            );

            expect(response.status).toBe(400);
        });

        it('answers 404 for a report that does not exist', async () => {
            seedFirestore();

            const response = await create({ reportId: 'REP-99999' });

            expect(response.status).toBe(404);
            expect((await response.json()).message).toBe('Report not found.');
        });

        it.each(['PENDING', 'REJECTED'])('answers 409 for a %s report', async (status) => {
            seedFirestore({ reports: [verifiedReport({ status })] });

            const response = await create({ reportId: REPORT_ID });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toContain(status);
        });

        it('answers 409 for VERIFIED positive feedback', async () => {
            seedFirestore({
                reports: [
                    verifiedReport({
                        type: 'POSITIVE',
                        issueCategory: undefined,
                        category: 'HELPFUL_DRIVER',
                    }),
                ],
            });

            const response = await create({ reportId: REPORT_ID });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toBe(
                'A complaint can only be created from an accessibility issue report.'
            );
        });

        it('answers 409 for a second complaint on the same report, burning no id', async () => {
            const db = seedFirestore();

            await create({ reportId: REPORT_ID });

            const response = await create({ reportId: REPORT_ID });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toBe(
                'A complaint already exists for this report (CMP-00001).'
            );
            expect((await db.collection('complaints').get()).docs).toHaveLength(1);
            expect(await readDoc(db, 'counters', 'complaints')).toMatchObject({ lastNumber: 1 });
        });

        it('writes nothing when the report is refused', async () => {
            const db = seedFirestore({ reports: [verifiedReport({ status: 'PENDING' })] });

            await create({ reportId: REPORT_ID });

            expect(await readDoc(db, 'counters', 'complaints')).toBeUndefined();
            expect((await db.collection('complaints').get()).docs).toHaveLength(0);
        });

        it('answers a fixed 500 without internal detail when Firestore fails', async () => {
            const db = seedFirestore();

            db.runTransaction.mockRejectedValueOnce(new Error('FIRESTORE_INTERNAL: deadline exceeded'));

            const response = await create({ reportId: REPORT_ID });

            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({
                success: false,
                message: 'Failed to create the complaint.',
            });
        });
    });
});

// ------------------------------------------------------------------
// GET /api/complaints
// ------------------------------------------------------------------
describe('GET /api/complaints', () => {
    function seedList() {
        return seedFirestore({
            complaints: [
                storedComplaint('CMP-00001', {
                    createdAt: new Date('2026-09-01T08:00:00.000Z'),
                }),
                storedComplaint('CMP-00002', {
                    reportId: 'REP-00026',
                    status: 'ASSIGNED',
                    assignedTo: 'ADM-2026-00002',
                    assignedToName: 'Second Admin',
                    assignedBy: ADMIN_UID,
                    assignedAt: '2026-09-03T08:00:00.000Z',
                    createdAt: new Date('2026-09-03T08:00:00.000Z'),
                }),
                storedComplaint('CMP-00003', {
                    reportId: 'REP-00027',
                    status: 'IN_PROGRESS',
                    assignedTo: 'ADM-2026-00001',
                    startedAt: '2026-09-04T08:00:00.000Z',
                    createdAt: new Date('2026-09-02T08:00:00.000Z'),
                }),
                storedComplaint('CMP-00004', {
                    reportId: 'REP-00028',
                    status: 'RESOLVED',
                    assignedTo: 'ADM-2026-00002',
                    resolvedBy: ADMIN_UID,
                    resolvedAt: '2026-09-05T08:00:00.000Z',
                    resolutionNote: 'Ramp repaired.',
                    createdAt: new Date('2026-08-30T08:00:00.000Z'),
                }),
            ],
        });
    }

    async function ids(query = '') {
        const response = await list(query);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.count).toBe(json.complaints.length);

        return json.complaints.map((complaint: any) => complaint.complaintId);
    }

    it('returns every complaint, newest first', async () => {
        seedList();

        expect(await ids()).toEqual(['CMP-00002', 'CMP-00003', 'CMP-00001', 'CMP-00004']);
    });

    it.each([
        ['PENDING', ['CMP-00001']],
        ['ASSIGNED', ['CMP-00002']],
        ['IN_PROGRESS', ['CMP-00003']],
        ['RESOLVED', ['CMP-00004']],
    ])('narrows to status=%s', async (status, expected) => {
        seedList();

        expect(await ids(`?status=${status}`)).toEqual(expected);
    });

    it('narrows to one assignee', async () => {
        seedList();

        expect(await ids('?assignedTo=ADM-2026-00002')).toEqual(['CMP-00002', 'CMP-00004']);
        expect(await ids('?assignedTo=ADM-2026-00009')).toEqual([]);
    });

    it('applies status and assignedTo together', async () => {
        seedList();

        expect(await ids('?status=RESOLVED&assignedTo=ADM-2026-00002')).toEqual(['CMP-00004']);
    });

    it('serialises timestamps as ISO strings and keeps workflow fields', async () => {
        seedList();

        const json = await (await list('?status=RESOLVED')).json();

        expect(json.complaints[0]).toMatchObject({
            createdAt: '2026-08-30T08:00:00.000Z',
            resolvedAt: '2026-09-05T08:00:00.000Z',
            resolutionNote: 'Ramp repaired.',
        });
    });

    it.each([
        ['an unknown status', '?status=VERIFIED'],
        ['a lower-case status', '?status=pending'],
        ['two status filters', '?status=PENDING&status=ASSIGNED'],
        ['an empty assignedTo', '?assignedTo='],
        ['an assignedTo containing "/"', '?assignedTo=ADM%2F1'],
        ['two assignedTo filters', '?assignedTo=A&assignedTo=B'],
    ])('answers 400 for %s', async (_case, query) => {
        seedList();

        const response = await list(query);

        expect(response.status).toBe(400);
        expect((await response.json()).success).toBe(false);
    });

    it('returns an empty list when there are no complaints', async () => {
        seedFirestore();

        const json = await (await list()).json();

        expect(json).toMatchObject({ success: true, count: 0, complaints: [] });
    });
});

// ------------------------------------------------------------------
// GET /api/complaints/:complaintId
// ------------------------------------------------------------------
describe('GET /api/complaints/:complaintId', () => {
    it('returns the complaint and its live source report', async () => {
        seedFirestore({ complaints: [storedComplaint('CMP-00001')] });

        const response = await detail('CMP-00001');
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.complaint).toMatchObject({
            complaintId: 'CMP-00001',
            reportId: REPORT_ID,
            status: 'PENDING',
            createdAt: '2026-09-01T08:00:00.000Z',
        });
        expect(json.sourceReport).toMatchObject({
            reportId: REPORT_ID,
            status: 'VERIFIED',
            issueCategory: 'BROKEN_RAMP',
            reviewedAt: '2026-08-22T09:00:00.000Z',
        });
    });

    it('does not expose the passenger who filed the source report', async () => {
        seedFirestore({ complaints: [storedComplaint('CMP-00001')] });

        const json = await (await detail('CMP-00001')).json();

        expect(json.complaint).not.toHaveProperty('passengerId');
        expect(json.sourceReport).not.toHaveProperty('passengerId');
    });

    it('stays complete after the passenger deletes the source report', async () => {
        const db = seedFirestore({ complaints: [storedComplaint('CMP-00001')] });

        await db.collection('reports').doc(REPORT_ID).delete();

        const json = await (await detail('CMP-00001')).json();

        expect(json.sourceReport).toBeNull();
        expect(json.complaint).toMatchObject({
            issueCategory: 'BROKEN_RAMP',
            description: 'The wheelchair ramp would not fold down at Pettah station.',
            busId: 'BUS-00007',
            routeId: 'R-138-OUT',
        });
    });

    it('answers 404 for a complaint that does not exist', async () => {
        seedFirestore();

        const response = await detail('CMP-00077');

        expect(response.status).toBe(404);
        expect((await response.json()).message).toBe('Complaint not found.');
    });

    it.each(['REP-00025', 'CMP-1', 'cmp-00001', 'CMP-0000A'])(
        'answers 400 for the malformed id %s',
        async (complaintId) => {
            seedFirestore();

            expect((await detail(complaintId)).status).toBe(400);
        }
    );
});
