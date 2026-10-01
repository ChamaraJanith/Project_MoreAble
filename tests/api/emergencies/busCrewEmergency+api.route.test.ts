// The bus crew's emergency console — BUS ONLY, own bus only.
//
//   GET   /api/buses/:busId/emergencies                 the bus's open emergencies
//   PATCH /api/buses/:busId/emergencies/:emergencyId    { action: MESSAGE | RESOLVE }
//
// A Bus Login session acts for the bus its token names and no other: the
// :busId in the path must equal the token's busId claim, and an emergency is
// the bus's only when its busId (stamped server-side from the passenger's
// verified journey) equals that claim. Another bus's emergency is a 404, as a
// missing one is. Nothing in the body is identity: busId, changedBy,
// passengerId, status, responder fields are ignored. The admin endpoints stay
// ADMIN ONLY and are exercised here only to show they are unchanged.
//
// Real: both bus routes, the admin routes, authenticateRequest,
// authoriseBusEmergencyAccess, busCrewEmergencies, updateEmergencyStatus.
// Stubbed: the Firebase handle (an in-memory Firestore), push dispatch, and
// verifyToken, which maps opaque session strings to a payload — an invalid or
// expired token maps to null, as the real verifyToken returns. No credential
// appears; every contact detail is fictional.

import { GET as busListRoute } from '../../../app/api/buses/[busId]/emergencies+api';
import * as BusEmergencyRoute from '../../../app/api/buses/[busId]/emergencies/[emergencyId]+api';
import { GET as adminListRoute } from '../../../app/api/emergencies/index+api';
import {
    DELETE as adminDeleteRoute,
    GET as adminDetailRoute,
    PATCH as adminPatchRoute,
} from '../../../app/api/emergencies/[emergencyId]+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const busActionRoute = BusEmergencyRoute.PATCH;

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

const OWN_BUS = 'BUS-8899';
const OTHER_BUS = 'BUS-7777';
const ADMIN_EMAIL = 'dispatch-admin@example.test';
const OWN_ACTOR = `Bus Crew (${OWN_BUS})`;

const SESSIONS: Record<string, unknown> = {
    'session-bus': { uid: OWN_BUS, passengerId: '', role: 'BUS', email: '', busId: OWN_BUS },
    'session-bus-other': { uid: OTHER_BUS, passengerId: '', role: 'BUS', email: '', busId: OTHER_BUS },
    'session-admin': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: ADMIN_EMAIL },
    'session-passenger': { uid: 'uid-a', passengerId: 'PAS-2026-00001', role: 'PASSENGER', email: 'passenger-a@example.test' },
    'session-sharing': { uid: OWN_BUS, passengerId: OWN_BUS, role: 'BUS', email: '', busId: OWN_BUS, scope: 'JOURNEY_LOCATION', tripId: 'TRIP-00004' },
    // Defence in depth: tokens no login issues today, refused even so.
    'session-bus-no-id': { uid: 'uid-bus', passengerId: '', role: 'BUS', email: '' },
    'session-passenger-with-bus': { uid: 'uid-a', passengerId: 'PAS-2026-00001', role: 'PASSENGER', email: '', busId: OWN_BUS },
    'session-admin-with-bus': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: ADMIN_EMAIL, busId: OWN_BUS },
};

const NO_SESSION: [string, string | null][] = [
    ['no token', null],
    ['an invalid token', 'not-a-valid-session'],
    ['an expired token', 'session-expired'],
];

const NOT_A_BUS: [string, string][] = [
    ['PASSENGER', 'session-passenger'],
    ['ADMIN', 'session-admin'],
    ['journey-sharing credential (scoped)', 'session-sharing'],
    ['BUS session naming no bus', 'session-bus-no-id'],
    ['PASSENGER carrying a busId', 'session-passenger-with-bus'],
    ['ADMIN carrying a busId', 'session-admin-with-bus'],
];

/** Passenger details the crew view must never carry. */
const PASSENGER_PRIVATE = /0700000101|0700000202|passenger-a@example\.test|PAS-2026-0000\d|0700009999|caregiver/i;

function emergency(id: string, overrides: Record<string, any> = {}) {
    return {
        id,
        busId: OWN_BUS,
        bookingId: `BK-${id}`,
        status: 'PENDING',
        priority: 'CRITICAL',
        passenger: {
            id: 'PAS-2026-00001',
            name: 'Passenger A',
            phone: '0700000101',
            email: 'passenger-a@example.test',
            specialAssistance: 'Wheelchair Assistance',
        },
        vehicle: { plateNumber: 'NB-8899', model: 'Transit Bus', routeNumber: '138' },
        location: { latitude: 6.9271, longitude: 79.8612 },
        alertRecipients: { caregiver: '0700009999', driver: OWN_BUS, admin: 'ADMIN_TOPIC' },
        statusHistory: [{ status: 'PENDING', changedAt: '2026-09-30T08:00:00.000Z', changedBy: 'passenger-a@example.test' }],
        dispatchMessages: [],
        createdAt: '2026-09-30T08:00:00.000Z',
        updatedAt: '2026-09-30T08:00:00.000Z',
        ...overrides,
    };
}

let db: any;

function seed() {
    db = createFakeFirestore({
        emergencies: [
            emergency('EMG-10001'),
            emergency('EMG-10002', {
                status: 'ASSIGNED',
                createdAt: '2026-09-30T09:00:00.000Z',
                passenger: { id: 'PAS-2026-00002', name: 'Passenger B', phone: '0700000202' },
                assignment: {
                    responderName: 'Ambulance Unit 7',
                    responderContact: 'Dispatch radio channel 2',
                    assignedAt: '2026-09-30T09:01:00.000Z',
                    assignedBy: ADMIN_EMAIL,
                },
                statusHistory: [
                    { status: 'PENDING', changedAt: '2026-09-30T09:00:00.000Z', changedBy: 'passenger-b@example.test' },
                    { status: 'ASSIGNED', changedAt: '2026-09-30T09:01:00.000Z', changedBy: ADMIN_EMAIL },
                ],
            }),
            emergency('EMG-10009', { status: 'RESOLVED', createdAt: '2026-09-29T07:00:00.000Z' }),
            emergency('EMG-20001', { busId: OTHER_BUS, vehicle: { plateNumber: 'NB-7777', model: 'Transit Bus' } }),
            // No verified journey, so no bus — but its plate text matches the
            // own bus's. The old ?search=<plate> lookup would have returned it.
            emergency('EMG-30001', { busId: undefined, vehicle: { plateNumber: 'NB-8899', model: 'Transit Bus' } }),
        ],
    });
    mockGetAdminDb.mockReturnValue(db);
}

async function stored(id: string): Promise<any> {
    const doc = await db.collection('emergencies').doc(id).get();
    return doc.exists ? JSON.parse(JSON.stringify(doc.data())) : null;
}

function headers(token: string | null, json = false): Record<string, string> {
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
}

function listAs(token: string | null, busId = OWN_BUS, query = '') {
    return busListRoute(
        new Request(`http://localhost/api/buses/${busId}/emergencies${query}`, { headers: headers(token) })
    );
}

function actAs(token: string | null, emergencyId: string, body: unknown, busId = OWN_BUS) {
    return busActionRoute(
        new Request(`http://localhost/api/buses/${busId}/emergencies/${emergencyId}`, {
            method: 'PATCH',
            headers: headers(token, true),
            body: JSON.stringify(body),
        })
    );
}

const MESSAGE = { action: 'MESSAGE', message: 'Attending to commuter onboard. Status stable.' };
const RESOLVE = { action: 'RESOLVE' };

describe('Bus crew emergency console — BUS only, own bus only', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
        seed();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('1. a bus reads its own open emergencies', () => {
        it("lists only this bus's open emergencies, newest first", async () => {
            const response = await listAs('session-bus');
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.emergencies.map((e: any) => e.id)).toEqual(['EMG-10002', 'EMG-10001']);
            expect(body.emergencies.every((e: any) => e.busId === OWN_BUS)).toBe(true);
        });

        it('returns the narrow crew view: what the crew needs, no passenger contact or admin audit', async () => {
            const body = await (await listAs('session-bus')).json();
            const view = body.emergencies.find((e: any) => e.id === 'EMG-10001');

            expect(view).toEqual({
                id: 'EMG-10001',
                busId: OWN_BUS,
                status: 'PENDING',
                priority: 'CRITICAL',
                passenger: { name: 'Passenger A', specialAssistance: 'Wheelchair Assistance' },
                vehicle: { plateNumber: 'NB-8899', routeNumber: '138' },
                location: { latitude: 6.9271, longitude: 79.8612 },
                dispatchMessages: [],
                createdAt: '2026-09-30T08:00:00.000Z',
                updatedAt: '2026-09-30T08:00:00.000Z',
            });
            const raw = JSON.stringify(body);
            expect(raw).not.toMatch(PASSENGER_PRIVATE);
            expect(raw).not.toContain('statusHistory');
            expect(raw).not.toContain('alertRecipients');
            expect(raw).not.toContain(ADMIN_EMAIL);
            expect(raw).not.toContain('Ambulance Unit 7');
        });

        it('includes the dispatch thread the crew chat shows', async () => {
            await actAs('session-bus', 'EMG-10001', MESSAGE);

            const body = await (await listAs('session-bus')).json();
            const view = body.emergencies.find((e: any) => e.id === 'EMG-10001');

            expect(view.dispatchMessages).toEqual([
                expect.objectContaining({ sender: 'BUS_CREW', senderName: OWN_ACTOR, message: MESSAGE.message }),
            ]);
        });
    });

    describe("2. a bus cannot reach another bus's emergencies", () => {
        it("refuses another bus's list (403), returning none of its records", async () => {
            const response = await listAs('session-bus', OTHER_BUS);
            const body = await response.json();

            expect(response.status).toBe(403);
            expect(body.success).toBe(false);
            expect(JSON.stringify(body)).not.toContain('EMG-20001');
        });

        it("never lists another bus's emergency or one recorded with no bus, even with a matching plate", async () => {
            const raw = JSON.stringify(await (await listAs('session-bus')).json());

            expect(raw).not.toContain('EMG-20001');
            expect(raw).not.toContain('EMG-30001');
        });

        it("the other bus sees its own emergency and none of this bus's", async () => {
            const body = await (await listAs('session-bus-other', OTHER_BUS)).json();

            expect(body.emergencies.map((e: any) => e.id)).toEqual(['EMG-20001']);
        });

        it("cannot message another bus's emergency: 404, as if it did not exist, and nothing changes", async () => {
            const before = await stored('EMG-20001');
            const response = await actAs('session-bus', 'EMG-20001', MESSAGE);
            const missing = await actAs('session-bus', 'EMG-99999', MESSAGE);

            expect(response.status).toBe(404);
            expect(missing.status).toBe(404);
            expect((await response.json()).message).toBe((await missing.json()).message);
            expect(await stored('EMG-20001')).toEqual(before);
        });

        it('cannot act on an emergency recorded with no bus', async () => {
            const before = await stored('EMG-30001');

            expect((await actAs('session-bus', 'EMG-30001', MESSAGE)).status).toBe(404);
            expect((await actAs('session-bus', 'EMG-30001', RESOLVE)).status).toBe(404);
            expect(await stored('EMG-30001')).toEqual(before);
        });

        it("cannot address another bus's path at all (403)", async () => {
            const before = await stored('EMG-20001');

            expect((await actAs('session-bus', 'EMG-20001', MESSAGE, OTHER_BUS)).status).toBe(403);
            expect((await actAs('session-bus', 'EMG-20001', RESOLVE, OTHER_BUS)).status).toBe(403);
            expect(await stored('EMG-20001')).toEqual(before);
        });
    });

    describe('3. a busId in the body or query is not identity', () => {
        it("body.busId naming the other bus does not open the other bus's emergency", async () => {
            const before = await stored('EMG-20001');
            const response = await actAs('session-bus', 'EMG-20001', { ...MESSAGE, busId: OTHER_BUS });

            expect(response.status).toBe(404);
            expect(await stored('EMG-20001')).toEqual(before);
        });

        it('body.busId on its own emergency is ignored: the message is recorded as this bus', async () => {
            await actAs('session-bus', 'EMG-10001', { ...MESSAGE, busId: OTHER_BUS });

            const record = await stored('EMG-10001');
            expect(record.busId).toBe(OWN_BUS);
            expect(record.dispatchMessages[0].senderName).toBe(OWN_ACTOR);
        });

        it('a ?busId= query does not change whose emergencies are listed', async () => {
            const body = await (await listAs('session-bus', OWN_BUS, `?busId=${OTHER_BUS}`)).json();

            expect(body.emergencies.map((e: any) => e.id)).toEqual(['EMG-10002', 'EMG-10001']);
        });
    });

    describe('4. crew message on its own emergency', () => {
        it('appends one BUS_CREW message and changes nothing else', async () => {
            const before = await stored('EMG-10002');
            const response = await actAs('session-bus', 'EMG-10002', MESSAGE);
            const body = await response.json();
            const after = await stored('EMG-10002');

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.emergency.id).toBe('EMG-10002');
            expect(JSON.stringify(body)).not.toMatch(PASSENGER_PRIVATE);

            expect(after.dispatchMessages).toEqual([
                {
                    id: expect.stringMatching(/^MSG-\d+$/),
                    sender: 'BUS_CREW',
                    senderName: OWN_ACTOR,
                    message: MESSAGE.message,
                    sentAt: expect.any(String),
                },
            ]);
            const { dispatchMessages: _a, updatedAt: _b, ...restAfter } = after;
            const { dispatchMessages: _c, updatedAt: _d, ...restBefore } = before;
            expect(restAfter).toEqual(restBefore);
        });

        it('keeps a PENDING emergency pending: a message is not an assignment', async () => {
            await actAs('session-bus', 'EMG-10001', MESSAGE);

            const after = await stored('EMG-10001');
            expect(after.status).toBe('PENDING');
            expect(after.assignment).toBeUndefined();
            expect(after.statusHistory).toHaveLength(1);
        });

        it.each<[string, unknown]>([
            ['a missing message', { action: 'MESSAGE' }],
            ['a blank message', { action: 'MESSAGE', message: '   ' }],
            ['a non-string message', { action: 'MESSAGE', message: { text: 'hi' } }],
            ['an overlong message', { action: 'MESSAGE', message: 'x'.repeat(501) }],
        ])('refuses %s (400)', async (_label, body) => {
            const response = await actAs('session-bus', 'EMG-10001', body);

            expect(response.status).toBe(400);
            expect((await stored('EMG-10001')).dispatchMessages).toEqual([]);
        });

        it('refuses a message on a resolved emergency (409)', async () => {
            expect((await actAs('session-bus', 'EMG-10009', MESSAGE)).status).toBe(409);
        });
    });

    describe('5. crew confirms its own emergency resolved', () => {
        it('PENDING -> ASSIGNED (crew attended) -> RESOLVED, every step recorded as this bus', async () => {
            const response = await actAs('session-bus', 'EMG-10001', RESOLVE);
            const body = await response.json();
            const after = await stored('EMG-10001');

            expect(response.status).toBe(200);
            expect(body.emergency).toMatchObject({ id: 'EMG-10001', status: 'RESOLVED' });

            expect(after.status).toBe('RESOLVED');
            expect(after.statusHistory.map((h: any) => [h.status, h.changedBy])).toEqual([
                ['PENDING', 'passenger-a@example.test'],
                ['ASSIGNED', OWN_ACTOR],
                ['RESOLVED', OWN_ACTOR],
            ]);
            expect(after.assignment).toMatchObject({ responderName: `Onboard bus crew (${OWN_BUS})`, assignedBy: OWN_ACTOR });
            expect(after.assignment.responderContact).not.toMatch(/\d{7,}/);
            expect(after.resolution).toMatchObject({ resolvedBy: OWN_ACTOR, notes: 'Resolved via Bus Dashboard Console' });
        });

        it("ASSIGNED -> RESOLVED keeps dispatch's own assignment", async () => {
            await actAs('session-bus', 'EMG-10002', RESOLVE);

            const after = await stored('EMG-10002');
            expect(after.status).toBe('RESOLVED');
            expect(after.assignment).toMatchObject({ responderName: 'Ambulance Unit 7', assignedBy: ADMIN_EMAIL });
            expect(after.resolution.resolvedBy).toBe(OWN_ACTOR);
        });

        it('refuses to resolve twice (409) and leaves the record as it was', async () => {
            await actAs('session-bus', 'EMG-10001', RESOLVE);
            const resolved = await stored('EMG-10001');

            expect((await actAs('session-bus', 'EMG-10001', RESOLVE)).status).toBe(409);
            expect(await stored('EMG-10001')).toEqual(resolved);
        });

        it('a resolved emergency drops off the bus list', async () => {
            await actAs('session-bus', 'EMG-10001', RESOLVE);

            const body = await (await listAs('session-bus')).json();
            expect(body.emergencies.map((e: any) => e.id)).toEqual(['EMG-10002']);
        });
    });

    describe("6. a bus cannot resolve another bus's emergency", () => {
        it('404 through its own path, 403 through the other bus path; the record is untouched', async () => {
            const before = await stored('EMG-20001');

            expect((await actAs('session-bus', 'EMG-20001', RESOLVE)).status).toBe(404);
            expect((await actAs('session-bus', 'EMG-20001', { ...RESOLVE, busId: OTHER_BUS })).status).toBe(404);
            expect((await actAs('session-bus', 'EMG-20001', RESOLVE, OTHER_BUS)).status).toBe(403);
            expect(await stored('EMG-20001')).toEqual(before);
        });
    });

    describe('7. no unrestricted admin operations for a bus', () => {
        it('ignores every admin field in the body: status, responder, passenger, priority, vehicle', async () => {
            const before = await stored('EMG-10001');
            await actAs('session-bus', 'EMG-10001', {
                ...MESSAGE,
                status: 'RESOLVED',
                responderName: 'Someone Else',
                responderContact: '0700000000',
                passenger: { id: 'PAS-2026-00009', name: 'Changed', phone: '0700000009' },
                passengerId: 'PAS-2026-00009',
                priority: 'LOW',
                vehicle: { plateNumber: 'XX-0000' },
                alertRecipients: { caregiver: '0700000008' },
                notes: 'admin note',
            });
            const after = await stored('EMG-10001');

            expect(after.status).toBe('PENDING');
            expect(after.priority).toBe(before.priority);
            expect(after.passenger).toEqual(before.passenger);
            expect(after.vehicle).toEqual(before.vehicle);
            expect(after.alertRecipients).toEqual(before.alertRecipients);
            expect(after.assignment).toBeUndefined();
            expect(after.statusHistory).toEqual(before.statusHistory);
        });

        it.each<[string, unknown]>([
            ['ASSIGN', { action: 'ASSIGN', responderName: 'X', responderContact: 'Y' }],
            ['DELETE', { action: 'DELETE' }],
            ['a bare status change', { status: 'RESOLVED', notes: 'done' }],
            ['an admin directiveMessage', { directiveMessage: 'hello' }],
            ['an empty body', {}],
        ])('refuses %s (400) without touching the record', async (_label, body) => {
            const before = await stored('EMG-10001');

            expect((await actAs('session-bus', 'EMG-10001', body)).status).toBe(400);
            expect(await stored('EMG-10001')).toEqual(before);
        });

        it('the bus route has no read-one, delete or other admin verbs', () => {
            expect(Object.keys(BusEmergencyRoute).sort()).toEqual(['OPTIONS', 'PATCH']);
        });

        it('the admin endpoints still refuse a bus session (403), and change nothing', async () => {
            const before = await stored('EMG-10001');
            const url = 'http://localhost/api/emergencies/EMG-10001';

            const list = await adminListRoute(new Request('http://localhost/api/emergencies?search=NB-8899', { headers: headers('session-bus') }));
            const detail = await adminDetailRoute(new Request(url, { headers: headers('session-bus') }), { params: { emergencyId: 'EMG-10001' } });
            const patch = await adminPatchRoute(
                new Request(url, { method: 'PATCH', headers: headers('session-bus', true), body: JSON.stringify({ status: 'ASSIGNED', responderName: 'X', responderContact: 'Y' }) }),
                { params: { emergencyId: 'EMG-10001' } }
            );
            const del = await adminDeleteRoute(new Request(url, { method: 'DELETE', headers: headers('session-bus') }), { params: { emergencyId: 'EMG-10001' } });

            expect([list.status, detail.status, patch.status, del.status]).toEqual([403, 403, 403, 403]);
            expect(await stored('EMG-10001')).toEqual(before);
        });
    });

    describe('8-10. who may use the bus console at all', () => {
        it.each(NO_SESSION)('%s -> 401 on list and on every action, nothing changes', async (_label, token) => {
            const before = await stored('EMG-10001');

            expect((await listAs(token)).status).toBe(401);
            expect((await actAs(token, 'EMG-10001', MESSAGE)).status).toBe(401);
            expect((await actAs(token, 'EMG-10001', RESOLVE)).status).toBe(401);
            expect(await stored('EMG-10001')).toEqual(before);
        });

        it.each(NOT_A_BUS)('%s -> 403 on list and on every action, nothing changes', async (_label, token) => {
            const before = await stored('EMG-10001');

            const list = await listAs(token);
            expect(list.status).toBe(403);
            expect(JSON.stringify(await list.json())).not.toContain('EMG-');
            expect((await actAs(token, 'EMG-10001', MESSAGE)).status).toBe(403);
            expect((await actAs(token, 'EMG-10001', RESOLVE)).status).toBe(403);
            expect(await stored('EMG-10001')).toEqual(before);
        });

        it('a refusal echoes nothing about the token', async () => {
            const body = await (await listAs('session-passenger')).json();

            expect(JSON.stringify(body)).not.toMatch(/session-passenger|PAS-2026|passenger-a/);
        });
    });

    describe('9. ADMIN behaviour is unchanged', () => {
        it('admin lists, reads and updates emergencies through the admin routes, recorded as the admin', async () => {
            await actAs('session-bus', 'EMG-10001', MESSAGE);

            const list = await adminListRoute(new Request('http://localhost/api/emergencies', { headers: headers('session-admin') }));
            const listBody = await list.json();
            expect(list.status).toBe(200);
            expect(listBody.emergencies.map((e: any) => e.id)).toEqual(
                expect.arrayContaining(['EMG-10001', 'EMG-10002', 'EMG-20001', 'EMG-30001', 'EMG-10009'])
            );

            const url = 'http://localhost/api/emergencies/EMG-10001';
            const detail = await (await adminDetailRoute(new Request(url, { headers: headers('session-admin') }), { params: { emergencyId: 'EMG-10001' } })).json();
            // The admin sees everything, including the crew's message.
            expect(detail.emergency.passenger.phone).toBe('0700000101');
            expect(detail.emergency.dispatchMessages[0]).toMatchObject({ sender: 'BUS_CREW', senderName: OWN_ACTOR });

            const patch = await adminPatchRoute(
                new Request(url, {
                    method: 'PATCH',
                    headers: headers('session-admin', true),
                    body: JSON.stringify({ status: 'ASSIGNED', responderName: 'Ambulance Unit 3', responderContact: 'Dispatch radio channel 1', changedBy: OWN_ACTOR }),
                }),
                { params: { emergencyId: 'EMG-10001' } }
            );
            expect(patch.status).toBe(200);
            const after = await stored('EMG-10001');
            expect(after.status).toBe('ASSIGNED');
            expect(after.statusHistory[after.statusHistory.length - 1].changedBy).toBe(ADMIN_EMAIL);
        });
    });

    describe('11. the actor cannot be impersonated', () => {
        it('changedBy, senderName and sender in the body are ignored for messages', async () => {
            await actAs('session-bus', 'EMG-10001', {
                ...MESSAGE,
                changedBy: ADMIN_EMAIL,
                senderName: 'Control Center',
                sender: 'ADMIN',
            });

            const message = (await stored('EMG-10001')).dispatchMessages[0];
            expect(message.sender).toBe('BUS_CREW');
            expect(message.senderName).toBe(OWN_ACTOR);
        });

        it('changedBy in the body is ignored for resolution history', async () => {
            await actAs('session-bus', 'EMG-10001', { ...RESOLVE, changedBy: ADMIN_EMAIL, resolvedBy: ADMIN_EMAIL });

            const after = await stored('EMG-10001');
            const crewEntries = after.statusHistory.slice(1);
            expect(crewEntries.every((entry: any) => entry.changedBy === OWN_ACTOR)).toBe(true);
            expect(after.resolution.resolvedBy).toBe(OWN_ACTOR);
            expect(JSON.stringify(crewEntries)).not.toContain(ADMIN_EMAIL);
        });

        it("the other bus's session acting on its own emergency is recorded as the other bus", async () => {
            await actAs('session-bus-other', 'EMG-20001', MESSAGE, OTHER_BUS);

            expect((await stored('EMG-20001')).dispatchMessages[0].senderName).toBe(`Bus Crew (${OTHER_BUS})`);
        });
    });
});
