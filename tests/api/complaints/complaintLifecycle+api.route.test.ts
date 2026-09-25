// Complaint status workflow (MOV-178), tested for MOV-179.
//
//   PENDING --ASSIGN--> ASSIGNED --START--> IN_PROGRESS --RESOLVE--> RESOLVED
//                       ASSIGNED --REASSIGN--> ASSIGNED
//                       IN_PROGRESS --REASSIGN--> IN_PROGRESS
//
// A complaint moves by an ACTION, never by a status the client names. What
// these tests hold PATCH /api/complaints/:complaintId to:
//
//   - only an admin may move a complaint;
//   - each action is allowed from exactly the states the table above lists,
//     and RESOLVED is final;
//   - each action writes its own fields and nothing else, through a
//     transactional update that re-reads the complaint first;
//   - the source report, and the accessibility score built from it, are never
//     touched by any of it.
//
// On concurrency: the Firestore double's runTransaction runs its callback once
// with no isolation and no retry, so two truly simultaneous transactions cannot
// be raced here. What CAN be tested is the property that makes the real one
// safe — that the status is re-read inside the transaction and the decision is
// made against that read — by changing the stored complaint between the
// request being validated and the transaction running.

import {
    GET as getComplaint,
    OPTIONS as complaintOptions,
    PATCH as patchComplaint,
} from '../../../app/api/complaints/[complaintId]+api';
import {
    GET as listComplaints,
    POST as createComplaint,
} from '../../../app/api/complaints/index+api';
import { POST as reviewReport } from '../../../app/api/reports/[reportId]/review+api';
import { POST as createReport } from '../../../app/api/reports/index+api';
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
const SECOND_ADMIN_UID = 'UID-ADMIN-2';

const ADMIN_SESSION = 'session-admin';
const SECOND_ADMIN_SESSION = 'session-admin-2';
const PASSENGER_SESSION = 'session-passenger';
const GUARDIAN_SESSION = 'session-guardian';

const PASSENGER = 'PAS-2026-00001';

// User document ids — what `assignedTo` stores. Deliberately unlike the
// Firebase UIDs above, so a test can tell which of the two a field holds.
const SYSTEM_ADMIN = 'ADM-2026-00001';
const SECOND_ADMIN = 'ADM-2026-00002';
const SUSPENDED_ADMIN = 'ADM-2026-00003';
const NAMELESS_ADMIN = 'ADM-2026-00004';
const BLANK_NAME_ADMIN = 'ADM-2026-00005';
const PASSENGER_USER = PASSENGER;
const GUARDIAN_USER = 'GRD-2026-00001';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: {
        uid: ADMIN_UID,
        passengerId: SYSTEM_ADMIN,
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
    [SECOND_ADMIN_SESSION]: {
        uid: SECOND_ADMIN_UID,
        passengerId: SECOND_ADMIN,
        role: 'ADMIN',
        email: 'second.admin@moreable.lk',
    },
    [PASSENGER_SESSION]: {
        uid: 'UID-P1',
        passengerId: PASSENGER,
        role: 'PASSENGER',
        email: 'passenger@example.com',
    },
    [GUARDIAN_SESSION]: {
        uid: 'UID-G1',
        passengerId: GUARDIAN_USER,
        role: 'GUARDIAN',
        email: 'guardian@example.com',
    },
};

function users() {
    return [
        // No accountStatus: a document predating the field, which reads as active.
        { id: SYSTEM_ADMIN, passengerId: SYSTEM_ADMIN, userName: '  System Admin  ', role: 'ADMIN' },
        {
            id: SECOND_ADMIN,
            passengerId: SECOND_ADMIN,
            userName: 'Second Admin',
            role: 'ADMIN',
            accountStatus: 'ACTIVE',
        },
        {
            id: SUSPENDED_ADMIN,
            passengerId: SUSPENDED_ADMIN,
            userName: 'Suspended Admin',
            role: 'ADMIN',
            accountStatus: 'SUSPENDED',
        },
        { id: NAMELESS_ADMIN, passengerId: NAMELESS_ADMIN, role: 'ADMIN' },
        { id: BLANK_NAME_ADMIN, passengerId: BLANK_NAME_ADMIN, userName: '   ', role: 'ADMIN' },
        { id: PASSENGER_USER, passengerId: PASSENGER_USER, userName: 'A Passenger', role: 'PASSENGER' },
        { id: GUARDIAN_USER, passengerId: GUARDIAN_USER, userName: 'A Guardian', role: 'GUARDIAN' },
    ];
}

const COMPLAINT_ID = 'CMP-00001';
const REPORT_ID = 'REP-00025';

// Everything seeded is stamped well in the past, so any value an action writes
// is distinguishable from what was there before.
const CREATED_AT = new Date('2026-09-01T08:00:00.000Z');
const ASSIGNED_AT = '2026-09-02T08:00:00.000Z';
const STARTED_AT = '2026-09-03T08:00:00.000Z';
const RESOLVED_AT = '2026-09-04T08:00:00.000Z';
const LAST_UPDATED = new Date('2026-09-04T08:00:00.000Z');

const RESOLUTION_NOTE = 'Wheelchair ramp was repaired and tested.';

type ComplaintState = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED';

/** A stored complaint carrying exactly the fields its state implies. */
function complaintIn(status: ComplaintState, overrides: Record<string, any> = {}) {
    const reached = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'].indexOf(status);

    return {
        id: COMPLAINT_ID,
        complaintId: COMPLAINT_ID,
        reportId: REPORT_ID,
        status,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138' },
        ...(reached >= 1
            ? {
                  assignedTo: SYSTEM_ADMIN,
                  assignedToName: 'System Admin',
                  assignedBy: ADMIN_UID,
                  assignedAt: ASSIGNED_AT,
              }
            : {}),
        ...(reached >= 2 ? { startedAt: STARTED_AT } : {}),
        ...(reached >= 3
            ? {
                  resolutionNote: 'Ramp replaced.',
                  resolvedBy: ADMIN_UID,
                  resolvedAt: RESOLVED_AT,
              }
            : {}),
        createdBy: ADMIN_UID,
        createdAt: CREATED_AT,
        updatedAt: LAST_UPDATED,
        ...overrides,
    };
}

/** The VERIFIED report the seeded complaints were opened from. */
function sourceReport() {
    return {
        id: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: PASSENGER,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'VERIFIED',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138' },
        agreeCount: 6,
        disagreeCount: 1,
        reviewedBy: ADMIN_UID,
        reviewedAt: '2026-08-22T09:00:00.000Z',
        createdAt: new Date('2026-08-20T14:05:00.000Z'),
        updatedAt: new Date('2026-08-22T09:00:00.000Z'),
    };
}

// ------------------------------------------------------------------
// Firestore double, with every write recorded
//
// The same wrapping reportReviewPersistence uses: each document reference is
// wrapped so a write through it — directly or from inside a transaction, which
// the double routes through the reference — is recorded against its
// collection. Transaction calls are recorded separately, so a test can tell a
// transactional `update` from a `set`.
// ------------------------------------------------------------------
interface RecordedWrite {
    collection: string;
    id: string;
    kind: 'set' | 'update' | 'delete';
    data?: any;
}

function trackingFirestore(seed: Record<string, Record<string, any>[]>) {
    const db: any = createFakeFirestore({ users: users(), counters: [], ...seed });
    const writes: RecordedWrite[] = [];
    const transactionCalls: { kind: 'set' | 'update'; data: any }[] = [];

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
                    set: jest.fn(async (data: any, options?: any) => {
                        writes.push({ collection: name, id, kind: 'set', data });
                        return ref.set(data, options);
                    }),
                    update: jest.fn(async (data: any) => {
                        writes.push({ collection: name, id, kind: 'update', data });
                        return ref.update(data);
                    }),
                    delete: jest.fn(async () => {
                        writes.push({ collection: name, id, kind: 'delete' });
                        return ref.delete();
                    }),
                };
            }),
        };
    });

    const baseRunTransaction = db.runTransaction;

    db.runTransaction = jest.fn((callback: (transaction: any) => Promise<unknown>) =>
        baseRunTransaction(async (transaction: any) =>
            callback({
                ...transaction,
                set: jest.fn((ref: any, data: any, options?: any) => {
                    transactionCalls.push({ kind: 'set', data });
                    return transaction.set(ref, data, options);
                }),
                update: jest.fn((ref: any, data: any) => {
                    transactionCalls.push({ kind: 'update', data });
                    return transaction.update(ref, data);
                }),
            })
        )
    );

    mockGetAdminDb.mockReturnValue(db);

    return { db, writes, transactionCalls };
}

/** Seeds one complaint in `status`, beside its source report. */
function seedComplaint(status: ComplaintState, overrides: Record<string, any> = {}) {
    return trackingFirestore({
        complaints: [complaintIn(status, overrides)],
        reports: [sourceReport()],
    });
}

async function readDoc(db: any, collection: string, id: string) {
    const snapshot = await db.collection(collection).doc(id).get();

    return snapshot.exists ? snapshot.data() : undefined;
}

function storedComplaint(db: any) {
    return readDoc(db, 'complaints', COMPLAINT_ID);
}

/** A deep copy of what is stored now, to compare a later read against. */
async function snapshotComplaint(db: any) {
    return structuredClone(await storedComplaint(db));
}

function isIsoString(value: unknown): boolean {
    return typeof value === 'string' && new Date(value).toISOString() === value;
}

// ------------------------------------------------------------------
// Requests
// ------------------------------------------------------------------
function jsonRequest(
    url: string,
    method: string,
    options: { token?: string | null; body?: unknown } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(`http://localhost${url}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
}

function patch(
    body: unknown,
    options: { token?: string | null; complaintId?: string } = {}
): Promise<Response> {
    const complaintId = options.complaintId ?? COMPLAINT_ID;
    const token = options.token === undefined ? ADMIN_SESSION : options.token;

    return patchComplaint(
        jsonRequest(`/api/complaints/${complaintId}`, 'PATCH', { token, body }),
        { params: { complaintId } }
    );
}

async function getDetail(complaintId = COMPLAINT_ID) {
    const response = await getComplaint(
        jsonRequest(`/api/complaints/${complaintId}`, 'GET', { token: ADMIN_SESSION }),
        { params: { complaintId } }
    );

    expect(response.status).toBe(200);

    return response.json();
}

/** Lets the millisecond clock move on, so consecutive stamps differ. */
function tick() {
    return new Promise((resolve) => setTimeout(resolve, 5));
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
describe('PATCH authorisation', () => {
    it('answers 401 without a session', async () => {
        seedComplaint('ASSIGNED');

        const response = await patch({ action: 'START' }, { token: null });

        expect(response.status).toBe(401);
        expect((await response.json()).success).toBe(false);
    });

    it('answers 401 for a token that does not verify', async () => {
        seedComplaint('ASSIGNED');

        expect((await patch({ action: 'START' }, { token: 'session-forged' })).status).toBe(401);
    });

    it.each([
        ['PASSENGER', PASSENGER_SESSION],
        ['GUARDIAN', GUARDIAN_SESSION],
    ])('answers 403 for a %s session and writes nothing', async (_role, token) => {
        const { db, writes } = seedComplaint('ASSIGNED');
        const before = await snapshotComplaint(db);

        const response = await patch({ action: 'START' }, { token });

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            success: false,
            message: 'Only an administrator can manage complaints.',
        });
        expect(writes).toHaveLength(0);
        expect(await storedComplaint(db)).toEqual(before);
    });

    it('allows an ADMIN session', async () => {
        seedComplaint('ASSIGNED');

        expect((await patch({ action: 'START' })).status).toBe(200);
    });

    it('checks the session before the body', async () => {
        seedComplaint('ASSIGNED');

        expect((await patch({ action: 'NOT_AN_ACTION' }, { token: null })).status).toBe(401);
        expect((await patch({ action: 'NOT_AN_ACTION' }, { token: PASSENGER_SESSION })).status).toBe(403);
    });
});

// ------------------------------------------------------------------
// Request shape
// ------------------------------------------------------------------
describe('PATCH request validation', () => {
    it.each([
        ['a missing action', {}],
        ['an empty action', { action: '' }],
        ['an unknown action', { action: 'CLOSE' }],
        ['a lower-case action', { action: 'start' }],
        ['a status instead of an action', { status: 'IN_PROGRESS' }],
        ['an array body', ['START']],
        ['a null body', null],
    ])('answers 400 for %s', async (_case, body) => {
        const { writes } = seedComplaint('ASSIGNED');

        const response = await patch(body);

        expect(response.status).toBe(400);
        expect((await response.json()).success).toBe(false);
        expect(writes).toHaveLength(0);
    });

    it('answers 400 for a malformed complaint id', async () => {
        seedComplaint('ASSIGNED');

        for (const complaintId of ['REP-00025', 'CMP-1', 'cmp-00001']) {
            const response = await patch({ action: 'START' }, { complaintId });

            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe('Invalid complaint ID.');
        }
    });

    it('answers 404 for a complaint that does not exist', async () => {
        const { writes } = seedComplaint('ASSIGNED');

        const response = await patch({ action: 'START' }, { complaintId: 'CMP-00099' });

        expect(response.status).toBe(404);
        expect((await response.json()).message).toBe('Complaint not found.');
        expect(writes).toHaveLength(0);
    });

    it('answers a fixed 500 without internal detail when Firestore fails', async () => {
        const { db } = seedComplaint('ASSIGNED');

        db.runTransaction.mockRejectedValueOnce(new Error('FIRESTORE_INTERNAL: deadline exceeded'));

        const response = await patch({ action: 'START' });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            success: false,
            message: 'Failed to update the complaint.',
        });
    });
});

// ------------------------------------------------------------------
// ASSIGN
// ------------------------------------------------------------------
describe('ASSIGN', () => {
    it('moves a PENDING complaint to ASSIGNED and records the assignment', async () => {
        const { db } = seedComplaint('PENDING');

        const response = await patch({ action: 'ASSIGN', assignedTo: SECOND_ADMIN });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toBe('Complaint marked ASSIGNED.');

        const stored = await storedComplaint(db);

        expect(stored.status).toBe('ASSIGNED');
        // The user document id, not the assignee's Firebase UID.
        expect(stored.assignedTo).toBe(SECOND_ADMIN);
        expect(stored.assignedToName).toBe('Second Admin');
        // The acting admin's Firebase UID, not their user document id.
        expect(stored.assignedBy).toBe(ADMIN_UID);
        expect(isIsoString(stored.assignedAt)).toBe(true);
        expect(stored.updatedAt).toBeInstanceOf(Date);
        expect(stored.updatedAt.getTime()).toBeGreaterThan(LAST_UPDATED.getTime());

        expect(json.complaint).toMatchObject({
            status: 'ASSIGNED',
            assignedTo: SECOND_ADMIN,
            assignedToName: 'Second Admin',
            assignedBy: ADMIN_UID,
            assignedAt: stored.assignedAt,
            updatedAt: stored.updatedAt.toISOString(),
        });
    });

    it('writes exactly the assignment fields and the status', async () => {
        const { transactionCalls } = seedComplaint('PENDING');

        await patch({ action: 'ASSIGN', assignedTo: SECOND_ADMIN });

        expect(transactionCalls).toHaveLength(1);
        expect(transactionCalls[0].kind).toBe('update');
        expect(Object.keys(transactionCalls[0].data).sort()).toEqual([
            'assignedAt',
            'assignedBy',
            'assignedTo',
            'assignedToName',
            'status',
            'updatedAt',
        ]);
    });

    it('stores the assignee name trimmed', async () => {
        const { db } = seedComplaint('PENDING');

        await patch({ action: 'ASSIGN', assignedTo: SYSTEM_ADMIN });

        expect((await storedComplaint(db)).assignedToName).toBe('System Admin');
    });

    it('accepts an admin whose account has no accountStatus as active', async () => {
        const { db } = seedComplaint('PENDING');

        const response = await patch({ action: 'ASSIGN', assignedTo: SYSTEM_ADMIN });

        expect(response.status).toBe(200);
        expect((await storedComplaint(db)).assignedTo).toBe(SYSTEM_ADMIN);
    });

    it('trims the assignedTo it is given', async () => {
        const { db } = seedComplaint('PENDING');

        await patch({ action: 'ASSIGN', assignedTo: `  ${SECOND_ADMIN}  ` });

        expect((await storedComplaint(db)).assignedTo).toBe(SECOND_ADMIN);
    });

    describe('assignee validation', () => {
        it.each([
            ['a missing assignedTo', {}, 'assignedTo is required for ASSIGN.'],
            ['a null assignedTo', { assignedTo: null }, 'assignedTo is required for ASSIGN.'],
            ['an empty assignedTo', { assignedTo: '' }, 'assignedTo is required for ASSIGN.'],
            ['a whitespace assignedTo', { assignedTo: '   ' }, 'Invalid assignedTo.'],
            ['a numeric assignedTo', { assignedTo: 42 }, 'Invalid assignedTo.'],
            ['an object assignedTo', { assignedTo: { id: SECOND_ADMIN } }, 'Invalid assignedTo.'],
            ['an assignedTo containing "/"', { assignedTo: 'users/ADM-2026-00002' }, 'Invalid assignedTo.'],
        ])('answers 400 for %s', async (_case, fields, message) => {
            const { writes } = seedComplaint('PENDING');

            const response = await patch({ action: 'ASSIGN', ...fields });

            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe(message);
            expect(writes).toHaveLength(0);
        });

        it('answers 404 for an assignee that does not exist', async () => {
            const { writes } = seedComplaint('PENDING');

            const response = await patch({ action: 'ASSIGN', assignedTo: 'ADM-2026-00999' });

            expect(response.status).toBe(404);
            expect((await response.json()).message).toBe('Assignee not found.');
            expect(writes).toHaveLength(0);
        });

        it.each([
            ['PASSENGER', PASSENGER_USER],
            ['GUARDIAN', GUARDIAN_USER],
        ])('answers 409 for a %s assignee', async (_role, assignedTo) => {
            const { db, writes } = seedComplaint('PENDING');

            const response = await patch({ action: 'ASSIGN', assignedTo });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toBe(
                'A complaint can only be assigned to an administrator.'
            );
            expect(writes).toHaveLength(0);
            expect((await storedComplaint(db)).status).toBe('PENDING');
        });

        it('answers 409 for a suspended admin', async () => {
            const { db, writes } = seedComplaint('PENDING');

            const response = await patch({ action: 'ASSIGN', assignedTo: SUSPENDED_ADMIN });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toBe(
                'A complaint cannot be assigned to a suspended administrator.'
            );
            expect(writes).toHaveLength(0);
            expect((await storedComplaint(db)).status).toBe('PENDING');
        });
    });

    it.each(['ASSIGNED', 'IN_PROGRESS'] as const)(
        'answers 409 on an %s complaint and leaves it unchanged',
        async (status) => {
            const { db, writes } = seedComplaint(status);
            const before = await snapshotComplaint(db);

            const response = await patch({ action: 'ASSIGN', assignedTo: SECOND_ADMIN });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toBe(
                `Cannot ASSIGN a complaint that is ${status}.`
            );
            expect(writes).toHaveLength(0);
            expect(await storedComplaint(db)).toEqual(before);
        }
    );

    it('answers 409 on a RESOLVED complaint', async () => {
        const { writes } = seedComplaint('RESOLVED');

        const response = await patch({ action: 'ASSIGN', assignedTo: SECOND_ADMIN });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe(
            'This complaint is RESOLVED and can no longer be changed.'
        );
        expect(writes).toHaveLength(0);
    });
});

// ------------------------------------------------------------------
// REASSIGN
// ------------------------------------------------------------------
describe('REASSIGN', () => {
    it('changes the assignee of an ASSIGNED complaint without changing its status', async () => {
        const { db } = seedComplaint('ASSIGNED');

        const response = await patch(
            { action: 'REASSIGN', assignedTo: SECOND_ADMIN },
            { token: SECOND_ADMIN_SESSION }
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.message).toBe(`Complaint reassigned to ${SECOND_ADMIN}.`);

        const stored = await storedComplaint(db);

        expect(stored.status).toBe('ASSIGNED');
        expect(stored.assignedTo).toBe(SECOND_ADMIN);
        expect(stored.assignedToName).toBe('Second Admin');
        expect(stored.assignedBy).toBe(SECOND_ADMIN_UID);
        expect(isIsoString(stored.assignedAt)).toBe(true);
        expect(stored.assignedAt).not.toBe(ASSIGNED_AT);
        expect(stored.updatedAt.getTime()).toBeGreaterThan(LAST_UPDATED.getTime());
    });

    it('keeps an IN_PROGRESS complaint IN_PROGRESS, with its startedAt', async () => {
        const { db } = seedComplaint('IN_PROGRESS');

        const response = await patch({ action: 'REASSIGN', assignedTo: SECOND_ADMIN });

        expect(response.status).toBe(200);

        const stored = await storedComplaint(db);

        expect(stored.status).toBe('IN_PROGRESS');
        expect(stored.startedAt).toBe(STARTED_AT);
        expect(stored.assignedTo).toBe(SECOND_ADMIN);
    });

    it('writes the assignment fields and never the status', async () => {
        const { transactionCalls } = seedComplaint('IN_PROGRESS');

        await patch({ action: 'REASSIGN', assignedTo: SECOND_ADMIN });

        expect(transactionCalls).toHaveLength(1);
        expect(transactionCalls[0].kind).toBe('update');
        expect(Object.keys(transactionCalls[0].data).sort()).toEqual([
            'assignedAt',
            'assignedBy',
            'assignedTo',
            'assignedToName',
            'updatedAt',
        ]);
    });

    it('answers 409 when reassigning to the current assignee', async () => {
        const { db, writes } = seedComplaint('ASSIGNED');
        const before = await snapshotComplaint(db);

        const response = await patch({ action: 'REASSIGN', assignedTo: SYSTEM_ADMIN });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe(
            `This complaint is already assigned to ${SYSTEM_ADMIN}.`
        );
        expect(writes).toHaveLength(0);
        expect(await storedComplaint(db)).toEqual(before);
    });

    it('answers 409 on a PENDING complaint', async () => {
        const { writes } = seedComplaint('PENDING');

        const response = await patch({ action: 'REASSIGN', assignedTo: SECOND_ADMIN });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe('Cannot REASSIGN a complaint that is PENDING.');
        expect(writes).toHaveLength(0);
    });

    it('answers 409 on a RESOLVED complaint', async () => {
        const { writes } = seedComplaint('RESOLVED');

        const response = await patch({ action: 'REASSIGN', assignedTo: SECOND_ADMIN });

        expect(response.status).toBe(409);
        expect(writes).toHaveLength(0);
    });

    it('applies the same assignee validation as ASSIGN', async () => {
        seedComplaint('ASSIGNED');

        expect((await patch({ action: 'REASSIGN' })).status).toBe(400);
        expect((await patch({ action: 'REASSIGN', assignedTo: 'a/b' })).status).toBe(400);
        expect((await patch({ action: 'REASSIGN', assignedTo: 'ADM-2026-00999' })).status).toBe(404);
        expect((await patch({ action: 'REASSIGN', assignedTo: PASSENGER_USER })).status).toBe(409);
        expect((await patch({ action: 'REASSIGN', assignedTo: SUSPENDED_ADMIN })).status).toBe(409);
    });
});

// ------------------------------------------------------------------
// START
// ------------------------------------------------------------------
describe('START', () => {
    it('moves an ASSIGNED complaint to IN_PROGRESS', async () => {
        const { db } = seedComplaint('ASSIGNED');

        const response = await patch({ action: 'START' });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.message).toBe('Complaint marked IN_PROGRESS.');

        const stored = await storedComplaint(db);

        expect(stored.status).toBe('IN_PROGRESS');
        expect(isIsoString(stored.startedAt)).toBe(true);
        expect(stored.updatedAt.getTime()).toBeGreaterThan(LAST_UPDATED.getTime());
        expect(json.complaint.startedAt).toBe(stored.startedAt);
    });

    it('leaves the assignment and the copied report fields unchanged', async () => {
        const { db } = seedComplaint('ASSIGNED');
        const before = await snapshotComplaint(db);

        await patch({ action: 'START' }, { token: SECOND_ADMIN_SESSION });

        const stored = await storedComplaint(db);

        for (const field of [
            'assignedTo',
            'assignedToName',
            'assignedBy',
            'assignedAt',
            'reportId',
            'issueCategory',
            'description',
            'busId',
            'vehicle',
            'routeId',
            'route',
            'createdBy',
            'createdAt',
        ]) {
            expect([field, stored[field]]).toEqual([field, before[field]]);
        }
    });

    it('writes exactly the status, startedAt and updatedAt', async () => {
        const { transactionCalls } = seedComplaint('ASSIGNED');

        await patch({ action: 'START' });

        expect(transactionCalls).toHaveLength(1);
        expect(transactionCalls[0].kind).toBe('update');
        expect(Object.keys(transactionCalls[0].data).sort()).toEqual([
            'startedAt',
            'status',
            'updatedAt',
        ]);
    });

    it.each(['PENDING', 'IN_PROGRESS'] as const)('answers 409 on an %s complaint', async (status) => {
        const { db, writes } = seedComplaint(status);
        const before = await snapshotComplaint(db);

        const response = await patch({ action: 'START' });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe(`Cannot START a complaint that is ${status}.`);
        expect(writes).toHaveLength(0);
        expect(await storedComplaint(db)).toEqual(before);
    });

    it('answers 409 on a RESOLVED complaint', async () => {
        const { writes } = seedComplaint('RESOLVED');

        expect((await patch({ action: 'START' })).status).toBe(409);
        expect(writes).toHaveLength(0);
    });
});

// ------------------------------------------------------------------
// RESOLVE
// ------------------------------------------------------------------
describe('RESOLVE', () => {
    it('moves an IN_PROGRESS complaint to RESOLVED and records the resolution', async () => {
        const { db } = seedComplaint('IN_PROGRESS');

        const response = await patch(
            { action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE },
            { token: SECOND_ADMIN_SESSION }
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.message).toBe('Complaint marked RESOLVED.');

        const stored = await storedComplaint(db);

        expect(stored.status).toBe('RESOLVED');
        expect(stored.resolutionNote).toBe(RESOLUTION_NOTE);
        // The acting admin's Firebase UID — here the second admin, not the assignee.
        expect(stored.resolvedBy).toBe(SECOND_ADMIN_UID);
        expect(isIsoString(stored.resolvedAt)).toBe(true);
        expect(stored.updatedAt.getTime()).toBeGreaterThan(LAST_UPDATED.getTime());

        // The work that led here is kept.
        expect(stored.startedAt).toBe(STARTED_AT);
        expect(stored.assignedTo).toBe(SYSTEM_ADMIN);

        expect(json.complaint).toMatchObject({
            status: 'RESOLVED',
            resolutionNote: RESOLUTION_NOTE,
            resolvedBy: SECOND_ADMIN_UID,
            resolvedAt: stored.resolvedAt,
        });
    });

    it('writes exactly the resolution fields and the status', async () => {
        const { transactionCalls } = seedComplaint('IN_PROGRESS');

        await patch({ action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE });

        expect(transactionCalls).toHaveLength(1);
        expect(transactionCalls[0].kind).toBe('update');
        expect(Object.keys(transactionCalls[0].data).sort()).toEqual([
            'resolutionNote',
            'resolvedAt',
            'resolvedBy',
            'status',
            'updatedAt',
        ]);
    });

    describe('resolution note validation', () => {
        it.each([
            ['a missing note', {}, 'A resolution note is required.'],
            ['a null note', { resolutionNote: null }, 'A resolution note is required.'],
            ['an empty note', { resolutionNote: '' }, 'A resolution note is required.'],
            ['a whitespace-only note', { resolutionNote: ' \n\t ' }, 'A resolution note is required.'],
            ['a numeric note', { resolutionNote: 42 }, 'Resolution note must be text.'],
            ['an array note', { resolutionNote: ['fixed'] }, 'Resolution note must be text.'],
            [
                'a 501-character note',
                { resolutionNote: 'x'.repeat(501) },
                'A resolution note can be at most 500 characters.',
            ],
        ])('answers 400 for %s', async (_case, fields, message) => {
            const { db, writes } = seedComplaint('IN_PROGRESS');

            const response = await patch({ action: 'RESOLVE', ...fields });

            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe(message);
            expect(writes).toHaveLength(0);
            expect((await storedComplaint(db)).status).toBe('IN_PROGRESS');
        });

        it('stores the note trimmed', async () => {
            const { db } = seedComplaint('IN_PROGRESS');

            await patch({ action: 'RESOLVE', resolutionNote: `  ${RESOLUTION_NOTE}\n` });

            expect((await storedComplaint(db)).resolutionNote).toBe(RESOLUTION_NOTE);
        });

        it('accepts a note of exactly 500 characters', async () => {
            const { db } = seedComplaint('IN_PROGRESS');
            const note = 'x'.repeat(500);

            const response = await patch({ action: 'RESOLVE', resolutionNote: note });

            expect(response.status).toBe(200);
            expect((await storedComplaint(db)).resolutionNote).toBe(note);
        });

        it('measures the limit after trimming', async () => {
            const { db } = seedComplaint('IN_PROGRESS');
            const note = 'x'.repeat(500);

            const response = await patch({ action: 'RESOLVE', resolutionNote: `   ${note}   ` });

            expect(response.status).toBe(200);
            expect((await storedComplaint(db)).resolutionNote).toBe(note);
        });
    });

    it.each(['PENDING', 'ASSIGNED'] as const)('answers 409 on a %s complaint', async (status) => {
        const { db, writes } = seedComplaint(status);
        const before = await snapshotComplaint(db);

        const response = await patch({ action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe(`Cannot RESOLVE a complaint that is ${status}.`);
        expect(writes).toHaveLength(0);
        expect(await storedComplaint(db)).toEqual(before);
    });

    it('answers 409 on a RESOLVED complaint', async () => {
        const { writes } = seedComplaint('RESOLVED');

        const response = await patch({ action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE });

        expect(response.status).toBe(409);
        expect(writes).toHaveLength(0);
    });
});

// ------------------------------------------------------------------
// RESOLVED is final
// ------------------------------------------------------------------
describe('RESOLVED is final', () => {
    it('refuses every action once a complaint has been resolved through the API', async () => {
        const { db, writes } = seedComplaint('IN_PROGRESS');

        expect(
            (await patch({ action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE })).status
        ).toBe(200);

        const resolved = await snapshotComplaint(db);
        const writesAfterResolve = writes.length;

        for (const body of [
            { action: 'ASSIGN', assignedTo: SECOND_ADMIN },
            { action: 'REASSIGN', assignedTo: SECOND_ADMIN },
            { action: 'START' },
            { action: 'RESOLVE', resolutionNote: 'Resolved again.' },
        ]) {
            const response = await patch(body, { token: SECOND_ADMIN_SESSION });

            expect([body.action, response.status]).toEqual([body.action, 409]);
            expect((await response.json()).message).toBe(
                'This complaint is RESOLVED and can no longer be changed.'
            );
        }

        expect(writes).toHaveLength(writesAfterResolve);

        const stored = await storedComplaint(db);

        expect(stored).toEqual(resolved);
        expect(stored).toMatchObject({
            status: 'RESOLVED',
            resolutionNote: RESOLUTION_NOTE,
            resolvedBy: ADMIN_UID,
        });
    });
});

// ------------------------------------------------------------------
// The optional `status` field
// ------------------------------------------------------------------
describe('status consistency check', () => {
    it.each([
        ['PENDING', { action: 'ASSIGN', assignedTo: SECOND_ADMIN, status: 'ASSIGNED' }, 'ASSIGNED'],
        ['ASSIGNED', { action: 'START', status: 'IN_PROGRESS' }, 'IN_PROGRESS'],
        [
            'IN_PROGRESS',
            { action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE, status: 'RESOLVED' },
            'RESOLVED',
        ],
        ['ASSIGNED', { action: 'REASSIGN', assignedTo: SECOND_ADMIN, status: 'ASSIGNED' }, 'ASSIGNED'],
        [
            'IN_PROGRESS',
            { action: 'REASSIGN', assignedTo: SECOND_ADMIN, status: 'IN_PROGRESS' },
            'IN_PROGRESS',
        ],
    ] as const)('accepts a %s complaint + %j', async (status, body, expected) => {
        const { db } = seedComplaint(status);

        const response = await patch(body);

        expect(response.status).toBe(200);
        expect((await storedComplaint(db)).status).toBe(expected);
    });

    it.each([
        ['START + RESOLVED', 'ASSIGNED', { action: 'START', status: 'RESOLVED' }],
        [
            'RESOLVE + ASSIGNED',
            'IN_PROGRESS',
            { action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE, status: 'ASSIGNED' },
        ],
        ['an unknown status', 'ASSIGNED', { action: 'START', status: 'DONE' }],
        ['a report status', 'ASSIGNED', { action: 'START', status: 'VERIFIED' }],
        ['a lower-case status', 'ASSIGNED', { action: 'START', status: 'in_progress' }],
        ['a numeric status', 'ASSIGNED', { action: 'START', status: 2 }],
        [
            'REASSIGN + RESOLVED',
            'ASSIGNED',
            { action: 'REASSIGN', assignedTo: SECOND_ADMIN, status: 'RESOLVED' },
        ],
    ] as const)('answers 400 for %s and writes nothing', async (_case, status, body) => {
        const { db, writes } = seedComplaint(status);
        const before = await snapshotComplaint(db);

        const response = await patch(body);

        expect(response.status).toBe(400);
        expect(writes).toHaveLength(0);
        expect(await storedComplaint(db)).toEqual(before);
    });

    it('answers 409 when REASSIGN expects a status the complaint has moved past', async () => {
        // The client last saw ASSIGNED; the complaint has since been started.
        // REASSIGN can produce ASSIGNED, so the request is well formed — but not
        // from where the complaint now is.
        const { db, writes } = seedComplaint('IN_PROGRESS');
        const before = await snapshotComplaint(db);

        const response = await patch({
            action: 'REASSIGN',
            assignedTo: SECOND_ADMIN,
            status: 'ASSIGNED',
        });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe(
            'This complaint is IN_PROGRESS; REASSIGN would leave it IN_PROGRESS, not ASSIGNED.'
        );
        expect(writes).toHaveLength(0);
        expect(await storedComplaint(db)).toEqual(before);
    });

    it('never stores the status the client sent in place of the one the action produces', async () => {
        const { db } = seedComplaint('ASSIGNED');

        await patch({ action: 'START', status: 'IN_PROGRESS' });

        expect((await storedComplaint(db)).status).toBe('IN_PROGRESS');
    });
});

// ------------------------------------------------------------------
// Fields a request cannot reach
// ------------------------------------------------------------------
describe('body field protection', () => {
    const forged = {
        complaintId: 'CMP-99999',
        reportId: 'fake-report',
        issueCategory: 'OTHER',
        description: 'changed',
        busId: 'BUS-FAKE',
        routeId: 'R-FAKE',
        createdBy: 'fake-user',
        createdAt: 'fake-date',
        updatedAt: 'fake-date',
        hacked: true,
    };

    const protectedFields = [
        'complaintId',
        'reportId',
        'issueCategory',
        'description',
        'busId',
        'routeId',
        'createdBy',
        'createdAt',
    ];

    async function expectProtectedFieldsUnchanged(db: any, before: Record<string, any>) {
        const stored = await storedComplaint(db);

        for (const field of protectedFields) {
            expect([field, stored[field]]).toEqual([field, before[field]]);
        }

        expect(stored).not.toHaveProperty('hacked');
        expect(stored.updatedAt).toBeInstanceOf(Date);
    }

    it('ignores forged fields on START', async () => {
        const { db } = seedComplaint('ASSIGNED');
        const before = await snapshotComplaint(db);

        const response = await patch({ action: 'START', ...forged });

        expect(response.status).toBe(200);
        await expectProtectedFieldsUnchanged(db, before);
    });

    it('ignores forged assignment metadata on ASSIGN', async () => {
        const { db } = seedComplaint('PENDING');
        const before = await snapshotComplaint(db);

        const response = await patch({
            action: 'ASSIGN',
            assignedTo: SECOND_ADMIN,
            assignedToName: 'Forged Name',
            assignedBy: 'UID-FORGED',
            assignedAt: '2000-01-01T00:00:00.000Z',
            startedAt: '2000-01-01T00:00:00.000Z',
            ...forged,
        });

        expect(response.status).toBe(200);
        await expectProtectedFieldsUnchanged(db, before);

        const stored = await storedComplaint(db);

        expect(stored).toMatchObject({
            assignedToName: 'Second Admin',
            assignedBy: ADMIN_UID,
        });
        expect(stored.assignedAt).not.toBe('2000-01-01T00:00:00.000Z');
        expect(stored).not.toHaveProperty('startedAt');
    });

    it('ignores forged resolution metadata on RESOLVE', async () => {
        const { db } = seedComplaint('IN_PROGRESS');
        const before = await snapshotComplaint(db);

        const response = await patch({
            action: 'RESOLVE',
            resolutionNote: RESOLUTION_NOTE,
            resolvedBy: 'UID-FORGED',
            resolvedAt: '2000-01-01T00:00:00.000Z',
            assignedTo: SECOND_ADMIN,
            ...forged,
        });

        expect(response.status).toBe(200);
        await expectProtectedFieldsUnchanged(db, before);

        const stored = await storedComplaint(db);

        expect(stored.resolvedBy).toBe(ADMIN_UID);
        expect(stored.resolvedAt).not.toBe('2000-01-01T00:00:00.000Z');
        // assignedTo is only read by ASSIGN and REASSIGN.
        expect(stored.assignedTo).toBe(SYSTEM_ADMIN);
    });
});

// ------------------------------------------------------------------
// Stored types
// ------------------------------------------------------------------
describe('stored data types', () => {
    it('stores updatedAt as a Date and the *At workflow stamps as ISO strings', async () => {
        const { db } = seedComplaint('PENDING');

        await patch({ action: 'ASSIGN', assignedTo: SECOND_ADMIN });
        await patch({ action: 'START' });
        await patch({ action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE });

        const stored = await storedComplaint(db);

        expect(stored.updatedAt).toBeInstanceOf(Date);
        expect(stored.createdAt).toBeInstanceOf(Date);
        expect(stored.createdAt).toEqual(CREATED_AT);

        for (const field of ['assignedAt', 'startedAt', 'resolvedAt']) {
            expect([field, typeof stored[field]]).toEqual([field, 'string']);
            expect([field, isIsoString(stored[field])]).toEqual([field, true]);
        }
    });

    it('serialises every timestamp as an ISO string in the response', async () => {
        seedComplaint('ASSIGNED');

        const json = await (await patch({ action: 'START' })).json();

        for (const field of ['createdAt', 'updatedAt', 'assignedAt', 'startedAt']) {
            expect([field, isIsoString(json.complaint[field])]).toEqual([field, true]);
        }
    });
});

// ------------------------------------------------------------------
// Assignee name fallback
// ------------------------------------------------------------------
describe('assignee name fallback', () => {
    it('stores "Administrator" when the assigned admin has no userName', async () => {
        const { db } = seedComplaint('PENDING');

        await patch({ action: 'ASSIGN', assignedTo: NAMELESS_ADMIN });

        expect((await storedComplaint(db)).assignedToName).toBe('Administrator');
    });

    it('stores "Administrator" when the userName is blank', async () => {
        const { db } = seedComplaint('PENDING');

        await patch({ action: 'ASSIGN', assignedTo: BLANK_NAME_ADMIN });

        expect((await storedComplaint(db)).assignedToName).toBe('Administrator');
    });

    it('replaces the previous assignee name on a reassignment to a nameless admin', async () => {
        const { db } = seedComplaint('ASSIGNED');

        expect((await storedComplaint(db)).assignedToName).toBe('System Admin');

        await patch({ action: 'REASSIGN', assignedTo: NAMELESS_ADMIN });

        const stored = await storedComplaint(db);

        expect(stored.assignedTo).toBe(NAMELESS_ADMIN);
        expect(stored.assignedToName).toBe('Administrator');
    });
});

// ------------------------------------------------------------------
// What a status update may write
// ------------------------------------------------------------------
describe('write scope', () => {
    it.each([
        ['ASSIGN', 'PENDING', { action: 'ASSIGN', assignedTo: SECOND_ADMIN }],
        ['REASSIGN', 'ASSIGNED', { action: 'REASSIGN', assignedTo: SECOND_ADMIN }],
        ['START', 'ASSIGNED', { action: 'START' }],
        ['RESOLVE', 'IN_PROGRESS', { action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE }],
    ] as const)(
        '%s writes one transactional update to the complaint and nothing else',
        async (_action, status, body) => {
            const { writes, transactionCalls } = seedComplaint(status);

            expect((await patch(body)).status).toBe(200);

            expect(transactionCalls.map((call) => call.kind)).toEqual(['update']);
            expect(writes).toEqual([
                expect.objectContaining({ collection: 'complaints', id: COMPLAINT_ID, kind: 'update' }),
            ]);
        }
    );
});

// ------------------------------------------------------------------
// Source report and accessibility score integrity
// ------------------------------------------------------------------
describe('source report and accessibility score integrity', () => {
    it('leaves the source report identical, and never reads or writes score data', async () => {
        const scoreLatest = { id: 'BUS-00007', busId: 'BUS-00007', score: 72, lastSequence: 3 };
        const scoreHistory = { id: 'BUS-00007__000003', busId: 'BUS-00007', score: 72, sequence: 3 };

        const { db, writes } = trackingFirestore({
            complaints: [complaintIn('PENDING')],
            reports: [sourceReport()],
            accessibilityScoreLatest: [scoreLatest],
            accessibilityScoreHistory: [scoreHistory],
        });

        const reportBefore = structuredClone(await readDoc(db, 'reports', REPORT_ID));

        db.collection.mockClear();

        for (const body of [
            { action: 'ASSIGN', assignedTo: SYSTEM_ADMIN },
            { action: 'START' },
            { action: 'REASSIGN', assignedTo: SECOND_ADMIN },
            { action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE },
        ]) {
            expect([body.action, (await patch(body)).status]).toEqual([body.action, 200]);
        }

        const touched = new Set(db.collection.mock.calls.map(([name]: [string]) => name));

        expect(touched).not.toContain('reports');
        expect(touched).not.toContain('accessibilityScoreLatest');
        expect(touched).not.toContain('accessibilityScoreHistory');
        expect(new Set(writes.map((write) => write.collection))).toEqual(new Set(['complaints']));

        const reportAfter = await readDoc(db, 'reports', REPORT_ID);

        expect(reportAfter).toEqual(reportBefore);
        expect(reportAfter.status).toBe('VERIFIED');

        expect(await readDoc(db, 'accessibilityScoreLatest', 'BUS-00007')).toEqual(scoreLatest);
        expect(await readDoc(db, 'accessibilityScoreHistory', 'BUS-00007__000003')).toEqual(
            scoreHistory
        );
    });
});

// ------------------------------------------------------------------
// Stale state
// ------------------------------------------------------------------
describe('stale state', () => {
    /**
     * Runs `change` against the stored complaint just before the next
     * transaction starts — standing in for another admin's commit landing
     * between this request being validated and its transaction reading.
     */
    function landBeforeNextTransaction(db: any, change: () => Promise<void>) {
        const run = db.runTransaction.getMockImplementation();

        db.runTransaction.mockImplementationOnce(async (callback: any) => {
            await change();

            return run(callback);
        });
    }

    it('refuses a START when another admin started the complaint first', async () => {
        const { db, transactionCalls } = seedComplaint('ASSIGNED');
        const otherStart = '2026-09-10T10:00:00.000Z';

        landBeforeNextTransaction(db, async () => {
            Object.assign(await storedComplaint(db), {
                status: 'IN_PROGRESS',
                startedAt: otherStart,
            });
        });

        const response = await patch({ action: 'START' }, { token: SECOND_ADMIN_SESSION });

        expect(response.status).toBe(409);
        expect((await response.json()).message).toBe('Cannot START a complaint that is IN_PROGRESS.');
        expect(transactionCalls).toHaveLength(0);

        const stored = await storedComplaint(db);

        expect(stored.status).toBe('IN_PROGRESS');
        expect(stored.startedAt).toBe(otherStart);
    });

    it('refuses a RESOLVE when another admin resolved the complaint first', async () => {
        const { db } = seedComplaint('IN_PROGRESS');

        landBeforeNextTransaction(db, async () => {
            Object.assign(await storedComplaint(db), {
                status: 'RESOLVED',
                resolutionNote: 'First admin note.',
                resolvedBy: ADMIN_UID,
                resolvedAt: RESOLVED_AT,
            });
        });

        const response = await patch(
            { action: 'RESOLVE', resolutionNote: 'Second admin note.' },
            { token: SECOND_ADMIN_SESSION }
        );

        expect(response.status).toBe(409);
        expect(await storedComplaint(db)).toMatchObject({
            resolutionNote: 'First admin note.',
            resolvedBy: ADMIN_UID,
        });
    });

    it('answers 404 when the complaint is deleted before the transaction reads it', async () => {
        const { db, transactionCalls } = seedComplaint('ASSIGNED');

        // The double's document reference holds on to the record it found when
        // it was created, so deleting the record afterwards would not make that
        // reference read as missing the way a real one does. The deletion is
        // therefore expressed at the transaction's own read — which is exactly
        // the read the route has to rely on.
        const run = db.runTransaction.getMockImplementation();

        db.runTransaction.mockImplementationOnce((callback: any) =>
            run((transaction: any) =>
                callback({
                    ...transaction,
                    get: jest.fn(async (ref: any) =>
                        ref.id === COMPLAINT_ID
                            ? { exists: false, id: ref.id, data: () => undefined }
                            : transaction.get(ref)
                    ),
                })
            )
        );

        const response = await patch({ action: 'START' });

        expect(response.status).toBe(404);
        expect(transactionCalls).toHaveLength(0);
    });

    it('re-checks the assignee inside the transaction', async () => {
        const { db, transactionCalls } = seedComplaint('PENDING');

        landBeforeNextTransaction(db, async () => {
            Object.assign(await readDoc(db, 'users', SECOND_ADMIN), { accountStatus: 'SUSPENDED' });
        });

        const response = await patch({ action: 'ASSIGN', assignedTo: SECOND_ADMIN });

        expect(response.status).toBe(409);
        expect(transactionCalls).toHaveLength(0);
        expect((await storedComplaint(db)).status).toBe('PENDING');
    });

    it('lets only the first of two admins assign a PENDING complaint', async () => {
        const { db } = seedComplaint('PENDING');

        const first = await patch({ action: 'ASSIGN', assignedTo: SYSTEM_ADMIN });
        const second = await patch(
            { action: 'ASSIGN', assignedTo: SECOND_ADMIN },
            { token: SECOND_ADMIN_SESSION }
        );

        expect(first.status).toBe(200);
        expect(second.status).toBe(409);
        expect(await storedComplaint(db)).toMatchObject({
            status: 'ASSIGNED',
            assignedTo: SYSTEM_ADMIN,
            assignedBy: ADMIN_UID,
        });
    });

    it('lets only the first of two admins start an ASSIGNED complaint', async () => {
        const { db } = seedComplaint('ASSIGNED');

        const first = await patch({ action: 'START' });
        const startedAt = (await storedComplaint(db)).startedAt;

        await tick();

        const second = await patch({ action: 'START' }, { token: SECOND_ADMIN_SESSION });

        expect(first.status).toBe(200);
        expect(second.status).toBe(409);
        expect((await storedComplaint(db)).startedAt).toBe(startedAt);
    });
});

// ------------------------------------------------------------------
// CORS
// ------------------------------------------------------------------
describe('CORS', () => {
    const METHODS = 'GET, PATCH, OPTIONS';

    it('advertises GET, PATCH, OPTIONS on the preflight', async () => {
        const response = await complaintOptions();

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe(METHODS);
    });

    it.each([
        ['a successful PATCH', ADMIN_SESSION, { action: 'START' }, 200],
        ['a refused transition', ADMIN_SESSION, { action: 'RESOLVE', resolutionNote: 'x' }, 409],
        ['an invalid body', ADMIN_SESSION, { action: 'CLOSE' }, 400],
        ['a non-admin session', PASSENGER_SESSION, { action: 'START' }, 403],
        ['no session', null, { action: 'START' }, 401],
    ])('advertises GET, PATCH, OPTIONS on %s', async (_case, token, body, status) => {
        seedComplaint('ASSIGNED');

        const response = await patch(body, { token });

        expect(response.status).toBe(status);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe(METHODS);
    });

    it('advertises GET, PATCH, OPTIONS on the detail GET', async () => {
        seedComplaint('ASSIGNED');

        const response = await getComplaint(
            jsonRequest(`/api/complaints/${COMPLAINT_ID}`, 'GET', { token: ADMIN_SESSION }),
            { params: { complaintId: COMPLAINT_ID } }
        );

        expect(response.headers.get('Access-Control-Allow-Methods')).toBe(METHODS);
    });
});

// ------------------------------------------------------------------
// End to end
//
// Nothing seeded mid-flight: a passenger files the report through
// POST /api/reports, an admin verifies it through the review route — which
// records the bus's accessibility score — and the complaint is then opened and
// taken through its whole workflow, read back through the detail route after
// every step.
// ------------------------------------------------------------------
describe('full complaint lifecycle', () => {
    const AUTHOR_SESSION = 'session-author';
    const BUS_ID = 'BUS-00007';
    const ROUTE_ID = 'R-138-OUT';

    beforeEach(() => {
        SESSIONS[AUTHOR_SESSION] = {
            uid: 'UID-AUTHOR',
            passengerId: 'PAS-2026-00042',
            role: 'PASSENGER',
            email: 'author@example.com',
        };
    });

    afterEach(() => {
        delete SESSIONS[AUTHOR_SESSION];
    });

    function freshFirestore() {
        return trackingFirestore({
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
            complaints: [],
            accessibilityScoreLatest: [],
            accessibilityScoreHistory: [],
        });
    }

    async function allDocs(db: any, collection: string) {
        const snapshot = await db.collection(collection).get();

        return structuredClone(snapshot.docs.map((doc: any) => doc.data()));
    }

    async function act(body: unknown, token: string) {
        await tick();

        const response = await patch(body, { token, complaintId: 'CMP-00001' });

        expect(response.status).toBe(200);

        return (await getDetail('CMP-00001')).complaint;
    }

    it('takes a filed, verified report from PENDING to RESOLVED', async () => {
        const { db } = freshFirestore();

        // A passenger files the report...
        const filed = await createReport(
            jsonRequest('/api/reports', 'POST', {
                token: AUTHOR_SESSION,
                body: {
                    issueCategory: 'BROKEN_RAMP',
                    description: 'The wheelchair ramp would not fold down at Pettah station.',
                    busId: BUS_ID,
                    routeId: ROUTE_ID,
                },
            })
        );

        expect(filed.status).toBe(201);

        const reportId = (await filed.json()).report.reportId;

        // ...and an admin verifies it.
        const verified = await reviewReport(
            jsonRequest(`/api/reports/${reportId}/review`, 'POST', {
                token: ADMIN_SESSION,
                body: { action: 'VERIFY' },
            }),
            { params: { reportId } }
        );

        expect(verified.status).toBe(200);

        // Everything the complaint workflow must not touch, as it stands now.
        const reportBefore = structuredClone(await readDoc(db, 'reports', reportId));
        const scoreLatestBefore = await allDocs(db, 'accessibilityScoreLatest');
        const scoreHistoryBefore = await allDocs(db, 'accessibilityScoreHistory');

        expect(reportBefore.status).toBe('VERIFIED');

        // Verifying the report scored its bus, so the comparison at the end is
        // against real score records rather than an empty collection.
        expect(scoreLatestBefore.length).toBeGreaterThan(0);
        expect(scoreHistoryBefore.length).toBeGreaterThan(0);

        // Open the complaint.
        const created = await createComplaint(
            jsonRequest('/api/complaints', 'POST', { token: ADMIN_SESSION, body: { reportId } })
        );

        expect(created.status).toBe(201);

        const pending = (await getDetail('CMP-00001')).complaint;

        expect(pending).toMatchObject({
            complaintId: 'CMP-00001',
            reportId,
            status: 'PENDING',
            issueCategory: 'BROKEN_RAMP',
            busId: BUS_ID,
            routeId: ROUTE_ID,
            createdBy: ADMIN_UID,
        });
        expect(pending).not.toHaveProperty('assignedTo');

        // PENDING --ASSIGN--> ASSIGNED
        const assigned = await act({ action: 'ASSIGN', assignedTo: SECOND_ADMIN }, ADMIN_SESSION);

        expect(assigned).toMatchObject({
            status: 'ASSIGNED',
            assignedTo: SECOND_ADMIN,
            assignedToName: 'Second Admin',
            assignedBy: ADMIN_UID,
        });
        expect(assigned).not.toHaveProperty('startedAt');
        expect(Date.parse(assigned.assignedAt)).toBeGreaterThan(Date.parse(pending.createdAt));
        expect(Date.parse(assigned.updatedAt)).toBeGreaterThan(Date.parse(pending.updatedAt));

        // ASSIGNED --START--> IN_PROGRESS
        const started = await act({ action: 'START' }, SECOND_ADMIN_SESSION);

        expect(started).toMatchObject({
            status: 'IN_PROGRESS',
            assignedTo: SECOND_ADMIN,
            assignedBy: ADMIN_UID,
            assignedAt: assigned.assignedAt,
        });
        expect(Date.parse(started.startedAt)).toBeGreaterThan(Date.parse(assigned.assignedAt));
        expect(started).not.toHaveProperty('resolvedAt');

        // IN_PROGRESS --REASSIGN--> IN_PROGRESS
        const reassigned = await act({ action: 'REASSIGN', assignedTo: SYSTEM_ADMIN }, SECOND_ADMIN_SESSION);

        expect(reassigned).toMatchObject({
            status: 'IN_PROGRESS',
            assignedTo: SYSTEM_ADMIN,
            assignedToName: 'System Admin',
            assignedBy: SECOND_ADMIN_UID,
            startedAt: started.startedAt,
        });
        expect(Date.parse(reassigned.assignedAt)).toBeGreaterThan(Date.parse(started.startedAt));

        // IN_PROGRESS --RESOLVE--> RESOLVED
        const resolved = await act(
            { action: 'RESOLVE', resolutionNote: RESOLUTION_NOTE },
            ADMIN_SESSION
        );

        expect(resolved).toMatchObject({
            status: 'RESOLVED',
            resolutionNote: RESOLUTION_NOTE,
            resolvedBy: ADMIN_UID,
            assignedTo: SYSTEM_ADMIN,
            startedAt: started.startedAt,
            createdAt: pending.createdAt,
            createdBy: ADMIN_UID,
        });
        expect(Date.parse(resolved.resolvedAt)).toBeGreaterThan(Date.parse(reassigned.assignedAt));

        // The list agrees with the detail.
        const listed = await (
            await listComplaints(
                jsonRequest('/api/complaints?status=RESOLVED', 'GET', { token: ADMIN_SESSION })
            )
        ).json();

        expect(listed.complaints.map((complaint: any) => complaint.complaintId)).toEqual([
            'CMP-00001',
        ]);

        // The report is still VERIFIED and unchanged, and so is its bus's score.
        const reportAfter = await readDoc(db, 'reports', reportId);

        expect(reportAfter).toEqual(reportBefore);
        expect(reportAfter.status).toBe('VERIFIED');
        expect(await allDocs(db, 'accessibilityScoreLatest')).toEqual(scoreLatestBefore);
        expect(await allDocs(db, 'accessibilityScoreHistory')).toEqual(scoreHistoryBefore);
    });
});
