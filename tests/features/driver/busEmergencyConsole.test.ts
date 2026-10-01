// The vehicle dashboard's emergency console talks to the server as the
// signed-in BUS — its Bus Login token from busSession — never as whoever is in
// authStore, and reports success only when the server confirmed it.
//
// Real: busEmergencyConsole, busEmergencyApi, both bus emergency routes,
// authoriseBusEmergencyAccess, busCrewEmergencies, updateEmergencyStatus.
// Stubbed: the stored bus session (getBusSession), the Firebase handle (an
// in-memory Firestore), push dispatch, and verifyToken, which maps opaque
// session strings to a payload. authStore deliberately holds an ADMIN session
// throughout: had the console used it (as adminFetch does), these calls would
// go out as the admin. No credential appears; contact details are fictional.

import * as fs from 'fs';
import * as path from 'path';
import { GET as busListRoute } from '../../../app/api/buses/[busId]/emergencies+api';
import { PATCH as busActionRoute } from '../../../app/api/buses/[busId]/emergencies/[emergencyId]+api';
import {
    confirmCrewResolution,
    findOpenBusEmergency,
    sendCrewMessage,
} from '../../../src/features/driver/services/busEmergencyConsole';
import { getOpenBusEmergencies } from '../../../src/features/driver/api/busEmergencyApi';
import { useAuthStore } from '../../../src/shared/store/authStore';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

const mockGetBusSession = jest.fn();
jest.mock('../../../src/shared/utils/busSession', () => ({
    getBusSession: () => mockGetBusSession(),
}));

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));
jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: 'http://api.test' }));
jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
    dispatchEmergencySOSAlert: jest.fn(async () => ({ sent: 0 })),
}));

const OWN_BUS = 'BUS-8899';
const OTHER_BUS = 'BUS-7777';

const SESSIONS: Record<string, unknown> = {
    'session-bus': { uid: OWN_BUS, passengerId: '', role: 'BUS', email: '', busId: OWN_BUS },
    'session-bus-other': { uid: OTHER_BUS, passengerId: '', role: 'BUS', email: '', busId: OTHER_BUS },
    'session-admin': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: 'dispatch-admin@example.test' },
};

const OWN_SESSION = { busId: OWN_BUS, numberPlate: 'NB-8899', token: 'session-bus' };

function emergency(id: string, overrides: Record<string, any> = {}) {
    return {
        id,
        busId: OWN_BUS,
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

let db: any;
let fetchMock: jest.Mock;
/** Replaces the server for a request, for answers the real routes cannot give. */
let serverOverride: ((request: Request) => Promise<Response>) | null;

async function stored(id: string): Promise<any> {
    const doc = await db.collection('emergencies').doc(id).get();
    return doc.exists ? JSON.parse(JSON.stringify(doc.data())) : null;
}

function sentAuthorizations(): string[] {
    return fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)?.Authorization);
}

function sentPaths(): string[] {
    return fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
}

describe('Vehicle dashboard emergency console uses the BUS session', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        serverOverride = null;

        db = createFakeFirestore({
            emergencies: [
                emergency('EMG-10001'),
                emergency('EMG-20001', { busId: OTHER_BUS, createdAt: '2026-09-30T10:00:00.000Z' }),
            ],
        });
        mockGetAdminDb.mockReturnValue(db);
        mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
        mockGetBusSession.mockResolvedValue(OWN_SESSION);

        // The person session in authStore is an ADMIN — the console must not use it.
        useAuthStore.setState({ user: { uid: 'uid-admin', role: 'ADMIN' } as any, token: 'session-admin', isAuthenticated: true });

        fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
            const request = new Request(url, init);
            if (serverOverride) return serverOverride(request);

            const { pathname } = new URL(url);
            if (/^\/api\/buses\/[^/]+\/emergencies$/.test(pathname)) return busListRoute(request);
            if (/^\/api\/buses\/[^/]+\/emergencies\/[^/]+$/.test(pathname)) return busActionRoute(request);
            throw new Error(`Unexpected request in test: ${request.method} ${pathname}`);
        });
        (global as any).fetch = fetchMock;

        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('search / list', () => {
        it("finds this bus's open emergency, calling as the bus on its own bus path", async () => {
            const found = await findOpenBusEmergency();

            expect(found?.id).toBe('EMG-10001');
            expect(sentPaths()).toEqual([`/api/buses/${OWN_BUS}/emergencies`]);
            expect(sentAuthorizations()).toEqual(['Bearer session-bus']);
        });

        it("never returns another bus's emergency, even the newer one", async () => {
            const open = await getOpenBusEmergencies(OWN_SESSION);

            expect(open.map((e) => e.id)).toEqual(['EMG-10001']);
        });

        it('no bus signed in -> nothing is requested', async () => {
            mockGetBusSession.mockResolvedValue(null);

            expect(await findOpenBusEmergency()).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('a busId stored on the device that the token does not carry is refused by the server', async () => {
            mockGetBusSession.mockResolvedValue({ ...OWN_SESSION, busId: OTHER_BUS });

            await expect(findOpenBusEmergency()).rejects.toMatchObject({ code: 'FORBIDDEN' });
        });
    });

    describe('crew chat', () => {
        it('sends the message as the bus and returns the updated thread', async () => {
            const outcome = await sendCrewMessage('Safely pulled over at next bus halt.');

            expect(outcome.ok).toBe(true);
            if (!outcome.ok) return;
            expect(outcome.emergency.dispatchMessages).toEqual([
                expect.objectContaining({ sender: 'BUS_CREW', senderName: `Bus Crew (${OWN_BUS})`, message: 'Safely pulled over at next bus halt.' }),
            ]);
            expect(new Set(sentAuthorizations())).toEqual(new Set(['Bearer session-bus']));
            expect(sentPaths()).toEqual([
                `/api/buses/${OWN_BUS}/emergencies`,
                `/api/buses/${OWN_BUS}/emergencies/EMG-10001`,
            ]);
            expect((await stored('EMG-10001')).dispatchMessages).toHaveLength(1);
        });

        it('a refused message is a failure the dashboard shows, not a silent success', async () => {
            mockGetBusSession.mockResolvedValue({ ...OWN_SESSION, token: 'session-expired' });

            const outcome = await sendCrewMessage('Attending to commuter onboard.');

            expect(outcome).toEqual({ ok: false, message: 'Authentication required.' });
            expect((await stored('EMG-10001')).dispatchMessages).toBeUndefined();
        });

        it('no open emergency for this bus -> failure', async () => {
            mockGetBusSession.mockResolvedValue({ busId: 'BUS-0001', numberPlate: 'NB-0001', token: 'session-bus-0001' });
            SESSIONS['session-bus-0001'] = { uid: 'BUS-0001', passengerId: '', role: 'BUS', email: '', busId: 'BUS-0001' };

            const outcome = await sendCrewMessage('Hello');

            expect(outcome).toEqual({ ok: false, message: 'No open emergency was found for this bus.' });
            delete SESSIONS['session-bus-0001'];
        });
    });

    describe('Confirm Resolved', () => {
        it('ok only after the server resolved this bus\'s emergency', async () => {
            const outcome = await confirmCrewResolution();

            expect(outcome.ok).toBe(true);
            if (!outcome.ok) return;
            expect(outcome.emergency).toMatchObject({ id: 'EMG-10001', status: 'RESOLVED' });
            expect((await stored('EMG-10001')).status).toBe('RESOLVED');
            expect((await stored('EMG-20001')).status).toBe('PENDING');
            expect(new Set(sentAuthorizations())).toEqual(new Set(['Bearer session-bus']));
        });

        it.each<[string, () => void]>([
            ['the server refuses the session', () => mockGetBusSession.mockResolvedValue({ ...OWN_SESSION, token: 'session-expired' })],
            ['no bus is signed in', () => mockGetBusSession.mockResolvedValue(null)],
            ['the session cannot be read', () => mockGetBusSession.mockRejectedValue(new Error('storage'))],
            [
                'the network is down',
                () => {
                    serverOverride = async () => {
                        throw new TypeError('Network request failed');
                    };
                },
            ],
            [
                'the server faults on the update',
                () => {
                    serverOverride = async (request) =>
                        request.method === 'PATCH'
                            ? Response.json({ success: false, message: 'Failed to update the emergency.' }, { status: 500 })
                            : busListRoute(request);
                },
            ],
            [
                'the server answers success with no emergency',
                () => {
                    serverOverride = async (request) =>
                        request.method === 'PATCH' ? Response.json({ success: true }, { status: 200 }) : busListRoute(request);
                },
            ],
        ])('is a failure when %s, and the emergency stays open', async (_label, arrange) => {
            arrange();

            const outcome = await confirmCrewResolution();

            expect(outcome.ok).toBe(false);
            if (outcome.ok) return;
            expect(outcome.message).toBeTruthy();
            expect((await stored('EMG-10001')).status).toBe('PENDING');
        });

        it("another bus's session resolves only its own emergency", async () => {
            mockGetBusSession.mockResolvedValue({ busId: OTHER_BUS, numberPlate: 'NB-7777', token: 'session-bus-other' });

            const outcome = await confirmCrewResolution();

            expect(outcome.ok && outcome.emergency.id).toBe('EMG-20001');
            expect((await stored('EMG-10001')).status).toBe('PENDING');
        });
    });

    describe('12. vehicle-dashboard.tsx wiring', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../../app/vehicle-dashboard.tsx'), 'utf8');

        it('uses the bus console, not the admin emergency client or adminFetch', () => {
            expect(source).toContain("from '../src/features/driver/services/busEmergencyConsole'");
            expect(source).not.toMatch(/emergencyAdminApi|adminFetch|adminHttp|getEmergencies\(|updateEmergencyStatusApi/);
        });

        it('sends no actor, responder or phone number of its own', () => {
            expect(source).not.toMatch(/changedBy|responderContact|responderName|0771234567/);
        });

        it('Confirm Resolved clears the banner and reports success only after the server confirmed', () => {
            const handler = source.slice(
                source.indexOf('const handleConfirmAssistedAndResolve'),
                source.indexOf('useFocusEffect(')
            );
            const confirm = handler.indexOf('await confirmCrewResolution()');
            const failureReturn = handler.indexOf('if (!outcome.ok)');
            const clear = handler.indexOf('clearSOS()');
            const success = handler.indexOf("'Incident Resolved'");

            expect(confirm).toBeGreaterThan(-1);
            expect(failureReturn).toBeGreaterThan(confirm);
            expect(clear).toBeGreaterThan(failureReturn);
            expect(success).toBeGreaterThan(clear);
            expect(handler).toContain("'Resolution Failed'");
        });

        it('"Message Sent" is shown only after a confirmed send', () => {
            const handler = source.slice(
                source.indexOf('const handleSendQuickAckToAdmin'),
                source.indexOf('const handleConfirmAssistedAndResolve')
            );

            expect(handler).toMatch(/if \(sent\)[\s\S]*'Message Sent'/);
        });
    });
});
