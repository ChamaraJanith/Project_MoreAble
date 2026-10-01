// The emergency dispatch endpoints — ADMIN ONLY.
//
//   GET    /api/emergencies                 list every SOS
//   GET    /api/emergencies/:emergencyId    read one
//   PATCH  /api/emergencies/:emergencyId    move it Pending -> Assigned -> Resolved
//   DELETE /api/emergencies/:emergencyId    dismiss it
//
// Each record carries a passenger's name, phone, location and accessibility
// needs, so nothing is read, written or deleted until the caller is shown to be
// an unscoped ADMIN session. The actor recorded on a change is that session,
// never a `changedBy` from the body. The detail endpoint returns the record as
// stored — the old demo "heal" that pulled another commuter's name and phone
// onto a "Nimal Silva" / PAS-554 record is gone.
//
// Real: the routes, authenticateRequest, authenticateAdmin,
// authenticateEmergencyAdmin, listEmergencies, getEmergencyDetail,
// updateEmergencyStatus. Stubbed: the Firebase handle (an in-memory Firestore)
// and verifyToken — which, as in the SOS route's tests, maps opaque session
// strings to a payload. An invalid or expired token maps to null, exactly what
// the real verifyToken returns when jose rejects its signature or `exp`.
// No credential appears; every contact detail is fictional.

import { GET as listRoute } from '../../../app/api/emergencies/index+api';
import {
    DELETE as deleteRoute,
    GET as detailRoute,
    PATCH as patchRoute,
} from '../../../app/api/emergencies/[emergencyId]+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));

jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
    dispatchEmergencySOSAlert: jest.fn(async () => ({ sent: 0 })),
}));

const ADMIN_EMAIL = 'dispatch-admin@example.test';

// Opaque session strings -> what verifyToken would return for them.
const SESSIONS: Record<string, unknown> = {
    'session-admin': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: ADMIN_EMAIL },
    'session-admin-no-email': { uid: 'uid-admin-2', passengerId: '', role: 'ADMIN', email: '' },
    'session-passenger': { uid: 'uid-a', passengerId: 'PAS-2026-00001', role: 'PASSENGER', email: 'passenger-a@example.test' },
    'session-bus': { uid: 'BUS-8899', passengerId: '', role: 'BUS', email: '', busId: 'BUS-8899' },
    'session-sharing': { uid: 'BUS-8899', passengerId: 'BUS-8899', role: 'BUS', email: '', busId: 'BUS-8899', scope: 'JOURNEY_LOCATION', tripId: 'TRIP-00004' },
    'session-guest': { uid: 'uid-guest', passengerId: 'GUEST', role: 'PASSENGER', email: '' },
    // Defence in depth: tokens no login issues today, refused even so.
    'session-admin-scoped': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: ADMIN_EMAIL, scope: 'JOURNEY_LOCATION' },
    'session-admin-bus': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: ADMIN_EMAIL, busId: 'BUS-8899' },
};

const NO_SESSION: [string, string | null][] = [
    ['no token', null],
    ['an invalid token', 'not-a-valid-session'],
    ['an expired token', 'session-expired'],
];

const NOT_ADMIN: [string, string][] = [
    ['PASSENGER', 'session-passenger'],
    ['BUS', 'session-bus'],
    ['journey-sharing (scoped)', 'session-sharing'],
    ['GUEST', 'session-guest'],
    ['ADMIN carrying a scope', 'session-admin-scoped'],
    ['ADMIN bound to a bus', 'session-admin-bus'],
];

function emergency(id: string, overrides: Record<string, any> = {}) {
    return {
        id,
        status: 'PENDING',
        priority: 'CRITICAL',
        passenger: { id: 'PAS-2026-00001', name: 'Passenger A', phone: '0700000101' },
        vehicle: { plateNumber: 'NB-8899', model: 'Transit Bus' },
        location: { latitude: 6.9271, longitude: 79.8612 },
        statusHistory: [{ status: 'PENDING', changedAt: '2026-09-30T08:00:00.000Z', changedBy: 'passenger-a@example.test' }],
        createdAt: '2026-09-30T08:00:00.000Z',
        updatedAt: '2026-09-30T08:00:00.000Z',
        ...overrides,
    };
}

/** A record as the old demo data wrote it — the shape that used to trigger the cross-user "heal". */
const LEGACY = emergency('EMG-10003', {
    passenger: { id: 'PAS-554', name: 'Nimal Silva', phone: 'Not on file' },
    vehicle: { plateNumber: 'WP-CBA-1234', model: 'Toyota Prius' },
    createdAt: '2026-09-29T08:00:00.000Z',
});

/** Another person's details, which must never surface on someone else's emergency. */
const OTHER_USER = /Commuter C|0700000303|uid-c|PAS-2026-00003|WP-ND-4521/;

let db: any;

function seed() {
    db = createFakeFirestore({
        emergencies: [
            emergency('EMG-10001'),
            emergency('EMG-10002', {
                status: 'ASSIGNED',
                passenger: { id: 'PAS-2026-00002', name: 'Passenger B', phone: '0700000202' },
                vehicle: { plateNumber: 'NB-7777', model: 'Transit Bus' },
                createdAt: '2026-09-30T09:00:00.000Z',
            }),
            LEGACY,
        ],
        users: [
            // The emergency passenger's own profile, since edited: the detail
            // still shows what the emergency recorded.
            { id: 'PAS-2026-00001', passengerId: 'PAS-2026-00001', userName: 'Renamed A', phoneNumber: '0700000999', role: 'PASSENGER' },
            // The first "COMMUTER" the old fallback would have borrowed from.
            { id: 'PAS-2026-00003', passengerId: 'PAS-2026-00003', uid: 'uid-c', userName: 'Commuter C', phoneNumber: '0700000303', role: 'COMMUTER' },
        ],
    });
    mockGetAdminDb.mockReturnValue(db);
}

function request(method: string, path: string, session: string | null, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = `Bearer ${session}`;
    return new Request(`http://localhost${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function read(response: Response) {
    return { status: response.status, body: await response.json(), headers: response.headers };
}

const params = (emergencyId: string) => ({ params: { emergencyId } });

const list = (session: string | null, query = '') =>
    listRoute(request('GET', `/api/emergencies${query}`, session)).then(read);
const detail = (session: string | null, id: string) =>
    detailRoute(request('GET', `/api/emergencies/${id}`, session), params(id)).then(read);
const patch = (session: string | null, id: string, body: unknown) =>
    patchRoute(request('PATCH', `/api/emergencies/${id}`, session, body), params(id)).then(read);
const remove = (session: string | null, id: string) =>
    deleteRoute(request('DELETE', `/api/emergencies/${id}`, session), params(id)).then(read);

/** The stored record, read straight from the database. */
async function stored(id: string) {
    const doc = await db.collection('emergencies').doc(id).get();
    return doc.exists ? doc.data() : null;
}

const ASSIGN = { status: 'ASSIGNED', responderName: 'Responder One', responderContact: '0700000444', etaMinutes: 5 };

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
    seed();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ------------------------------------------------------------------
describe('GET /api/emergencies', () => {
    it.each(NO_SESSION)('%s -> 401, nothing read', async (_label, session) => {
        const { status, body, headers } = await list(session);

        expect(status).toBe(401);
        expect(body.success).toBe(false);
        expect(body.emergencies).toBeUndefined();
        expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it.each(NOT_ADMIN)('%s -> 403, nothing read', async (_label, session) => {
        const { status, body } = await list(session);

        expect(status).toBe(403);
        expect(body).toEqual({ success: false, message: 'Only an administrator can manage emergency requests.' });
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('ADMIN -> 200 with every emergency, newest first', async () => {
        const { status, body, headers } = await list('session-admin');

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.count).toBe(3);
        expect(body.emergencies.map((e: any) => e.id)).toEqual(['EMG-10002', 'EMG-10001', 'EMG-10003']);
        expect(headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('ADMIN -> status filter and search still apply', async () => {
        const pending = await list('session-admin', '?status=PENDING');
        expect(pending.body.emergencies.map((e: any) => e.id).sort()).toEqual(['EMG-10001', 'EMG-10003']);

        const all = await list('session-admin', '?status=ALL');
        expect(all.body.count).toBe(3);

        const searched = await list('session-admin', '?search=NB-7777');
        expect(searched.body.emergencies.map((e: any) => e.id)).toEqual(['EMG-10002']);
    });
});

// ------------------------------------------------------------------
describe('GET /api/emergencies/:emergencyId', () => {
    it.each(NO_SESSION)('%s -> 401, nothing read', async (_label, session) => {
        const { status, body } = await detail(session, 'EMG-10001');

        expect(status).toBe(401);
        expect(body.emergency).toBeUndefined();
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it.each(NOT_ADMIN)('%s -> 403, nothing read', async (_label, session) => {
        const { status, body } = await detail(session, 'EMG-10001');

        expect(status).toBe(403);
        expect(body.emergency).toBeUndefined();
        expect(JSON.stringify(body)).not.toMatch(/Passenger A|0700000101/);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('ADMIN -> 200 with the record', async () => {
        const { status, body } = await detail('session-admin', 'EMG-10001');

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.emergency.id).toBe('EMG-10001');
        expect(body.emergency.status).toBe('PENDING');
    });

    it('ADMIN -> 404 for an unknown emergency', async () => {
        const { status } = await detail('session-admin', 'EMG-99999');
        expect(status).toBe(404);
    });

    it('returns the passenger and vehicle as stored, not re-read from any user profile', async () => {
        const { body } = await detail('session-admin', 'EMG-10001');

        expect(body.emergency.passenger).toEqual({ id: 'PAS-2026-00001', name: 'Passenger A', phone: '0700000101' });
        expect(body.emergency.vehicle).toEqual({ plateNumber: 'NB-8899', model: 'Transit Bus' });
        expect(JSON.stringify(body)).not.toMatch(/Renamed A|0700000999/);
        expect(JSON.stringify(body)).not.toMatch(OTHER_USER);
    });

    it('a Nimal Silva / PAS-554 record is returned as stored, with no cross-user lookup', async () => {
        const collectionCallsBefore = db.collection.mock.calls.length;
        const { status, body } = await detail('session-admin', 'EMG-10003');

        expect(status).toBe(200);
        expect(body.emergency.passenger).toEqual({ id: 'PAS-554', name: 'Nimal Silva', phone: 'Not on file' });
        expect(body.emergency.vehicle).toEqual({ plateNumber: 'WP-CBA-1234', model: 'Toyota Prius' });
        expect(JSON.stringify(body)).not.toMatch(OTHER_USER);

        // Only the emergency itself was read: the users collection never was.
        const collectionsRead = db.collection.mock.calls.slice(collectionCallsBefore).map((call: any[]) => call[0]);
        expect(collectionsRead).toEqual(['emergencies']);

        // And the stored record was not rewritten on the way out.
        expect((await stored('EMG-10003')).passenger.name).toBe('Nimal Silva');
    });
});

// ------------------------------------------------------------------
describe('PATCH /api/emergencies/:emergencyId', () => {
    it.each(NO_SESSION)('%s -> 401, nothing changed', async (_label, session) => {
        const { status } = await patch(session, 'EMG-10001', { ...ASSIGN, changedBy: ADMIN_EMAIL });

        expect(status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(await stored('EMG-10001')).toEqual(emergency('EMG-10001'));
    });

    it.each(NOT_ADMIN)('%s -> 403, nothing changed, even naming an admin as changedBy', async (_label, session) => {
        const { status } = await patch(session, 'EMG-10001', { ...ASSIGN, changedBy: ADMIN_EMAIL });

        expect(status).toBe(403);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(await stored('EMG-10001')).toEqual(emergency('EMG-10001'));
    });

    it('ADMIN -> assigns, recording the session admin as the actor', async () => {
        const { status, body } = await patch('session-admin', 'EMG-10001', ASSIGN);

        expect(status).toBe(200);
        expect(body.emergency.status).toBe('ASSIGNED');

        const record = await stored('EMG-10001');
        expect(record.status).toBe('ASSIGNED');
        expect(record.assignment).toMatchObject({ responderName: 'Responder One', assignedBy: ADMIN_EMAIL });
        expect(record.statusHistory).toHaveLength(2);
        expect(record.statusHistory[1]).toMatchObject({ status: 'ASSIGNED', changedBy: ADMIN_EMAIL });
    });

    it('ADMIN -> resolves an assigned emergency', async () => {
        const { status } = await patch('session-admin', 'EMG-10002', { status: 'RESOLVED', actionTaken: 'Assisted at stop.' });

        expect(status).toBe(200);
        const record = await stored('EMG-10002');
        expect(record.status).toBe('RESOLVED');
        expect(record.resolution).toMatchObject({ resolvedBy: ADMIN_EMAIL, actionTaken: 'Assisted at stop.' });
    });

    it('ADMIN -> workflow rules still apply (PENDING cannot jump to RESOLVED)', async () => {
        const { status } = await patch('session-admin', 'EMG-10001', { status: 'RESOLVED', actionTaken: 'x' });

        expect(status).toBe(400);
        expect((await stored('EMG-10001')).status).toBe('PENDING');
    });

    it('body.changedBy cannot impersonate another actor', async () => {
        const claimed = 'Other Admin <other-admin@example.test>';
        await patch('session-admin', 'EMG-10001', { ...ASSIGN, changedBy: claimed, directiveMessage: 'On the way.' });

        const record = await stored('EMG-10001');
        expect(JSON.stringify(record)).not.toContain('other-admin@example.test');
        expect(record.statusHistory[1].changedBy).toBe(ADMIN_EMAIL);
        expect(record.assignment.assignedBy).toBe(ADMIN_EMAIL);
        expect(record.dispatchMessages[0]).toMatchObject({ sender: 'ADMIN', senderName: ADMIN_EMAIL });
    });

    it('body.changedBy cannot pose as bus crew either', async () => {
        await patch('session-admin', 'EMG-10002', { ...ASSIGN, changedBy: 'Bus Crew (NB-7777)', directiveMessage: 'Hello.' });

        const record = await stored('EMG-10002');
        expect(record.dispatchMessages[0]).toMatchObject({ sender: 'ADMIN', senderName: ADMIN_EMAIL });
    });

    it('an admin session without an email is recorded by its account id', async () => {
        await patch('session-admin-no-email', 'EMG-10001', ASSIGN);

        const record = await stored('EMG-10001');
        expect(record.statusHistory[1].changedBy).toBe('uid-admin-2');
        expect(record.assignment.assignedBy).toBe('uid-admin-2');
    });
});

// ------------------------------------------------------------------
describe('DELETE /api/emergencies/:emergencyId', () => {
    it.each(NO_SESSION)('%s -> 401, nothing deleted', async (_label, session) => {
        const { status } = await remove(session, 'EMG-10001');

        expect(status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(await stored('EMG-10001')).not.toBeNull();
    });

    it.each(NOT_ADMIN)('%s -> 403, nothing deleted', async (_label, session) => {
        const { status } = await remove(session, 'EMG-10001');

        expect(status).toBe(403);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(await stored('EMG-10001')).not.toBeNull();
    });

    it('ADMIN -> deletes the record, and only that record', async () => {
        const { status, body } = await remove('session-admin', 'EMG-10001');

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(await stored('EMG-10001')).toBeNull();
        expect(await stored('EMG-10002')).not.toBeNull();
        expect(await stored('EMG-10003')).not.toBeNull();
    });

    it('ADMIN -> 404 for an unknown emergency', async () => {
        const { status } = await remove('session-admin', 'EMG-99999');
        expect(status).toBe(404);
    });
});
