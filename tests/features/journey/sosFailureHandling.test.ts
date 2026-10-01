// An SOS is "sent" only when POST /api/emergencies created the emergency.
//
// Every failure — 401, 403, any other 4xx, a 5xx, no network, an answer that
// cannot be read — comes back as success:false with a message that says the
// SOS was not sent (or could not be confirmed). None says "Sent Successfully",
// none raises the local "SOS triggered" alert, and SOSButton never turns to
// "SOS ACTIVATED" for one.
//
// Real: triggerSOSAlert, the emergency API client and adminFetch, GET
// /api/journeys/ongoing, POST /api/emergencies with its passenger
// authorization, the auth and journey stores, sosButtonState. Stubbed: GPS,
// Expo-bound modules, the Firebase handle (an in-memory Firestore), push
// dispatch and verifyToken, which maps opaque session strings to a payload.
// A server answer is stubbed only where the real route cannot produce it
// (5xx, unreadable bodies, network loss). No credential appears; every
// contact detail is fictional.

import * as fs from 'fs';
import * as path from 'path';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { POST as createEmergencyRoute } from '../../../app/api/emergencies/index+api';
import { resetActiveJourneySession } from '../../../src/features/journey/services/activeJourneySync';
import { SOS_SENT_MESSAGE, sosRequestFailure, triggerSOSAlert } from '../../../src/features/journey/services/sosService';
import {
    SOS_NOT_SENT_MESSAGE,
    sosButtonStateFor,
    sosButtonStateForError,
} from '../../../src/features/journey/utils/sosButtonState';
import { useAuthStore } from '../../../src/shared/store/authStore';
import { useJourneyStore } from '../../../src/shared/store/journeyStore';
import { SeedBooking, seedOngoingJourneys } from '../../testUtils/ongoingJourneySeed';
import * as Location from 'expo-location';

jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
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

const PASSENGER = 'PAS-2026-00001';
const SESSION_PASSENGER = 'session-passenger-a';
const SESSION_EXPIRED = 'session-expired';
const SESSION_BUS = 'session-bus';

const SESSIONS: Record<string, unknown> = {
    [SESSION_PASSENGER]: { uid: `uid-${PASSENGER}`, passengerId: PASSENGER, role: 'PASSENGER', email: 'passenger-a@example.test' },
    [SESSION_BUS]: { uid: 'BUS-8899', passengerId: '', role: 'BUS', email: '', busId: 'BUS-8899' },
    // SESSION_EXPIRED maps to nothing: what verifyToken returns for an expired token.
};

const USER = {
    uid: `uid-${PASSENGER}`,
    passengerId: PASSENGER,
    userName: 'Passenger A',
    email: 'passenger-a@example.test',
    phoneNumber: '0700000101',
    role: 'PASSENGER',
} as any;

const RUNNING: SeedBooking = {
    bookingId: 'BK-A-01',
    userId: PASSENGER,
    tripId: 'TRIP-00004',
    busId: 'BUS-8899',
    trip: 'running',
};

type Responder = (request: Request) => Promise<Response>;

let db: any;
/** Replaces the real POST route's answer, for answers it cannot give. */
let postOverride: Responder | null;

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function storedEmergencies(): Promise<any[]> {
    const snapshot = await db.collection('emergencies').get();
    return snapshot.docs.map((doc: any) => doc.data());
}

function signInAs(token: string) {
    useAuthStore.setState({ user: USER, token, isAuthenticated: true });
}

function gpsAt(latitude: unknown, longitude: unknown) {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude, longitude } });
}

/** Sends the SOS and asserts what every failure must look like. */
async function expectNotSent(reason: string) {
    const result = await triggerSOSAlert();

    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/Sent Successfully|help (is|was) notified/i);
    expect((result as any).reason).toBe(reason);

    // No local "SOS triggered" alert for an SOS the server did not record.
    expect(useJourneyStore.getState().activeSOS).toBeNull();

    // SOSButton stays ready to retry and shows why.
    const button = sosButtonStateFor(result);
    expect(button.activated).toBe(false);
    expect(button.errorMessage).toBe(result.message);
    expect(button.errorMessage).not.toContain('Sent Successfully');

    return result;
}

describe('Passenger SOS: a failed POST /api/emergencies is never reported as success', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useJourneyStore.getState().clearSOS();
        postOverride = null;

        db = seedOngoingJourneys([RUNNING]);
        mockGetAdminDb.mockReturnValue(db);
        mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);

        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            const request = new Request(url, init);
            const { pathname } = new URL(url);

            if (pathname === '/api/journeys/ongoing') return getOngoing(request);
            if (pathname === '/api/emergencies' && request.method === 'POST') {
                return postOverride ? postOverride(request) : createEmergencyRoute(request);
            }
            throw new Error(`Unexpected request in test: ${request.method} ${pathname}`);
        });

        signInAs(SESSION_PASSENGER);
        resetActiveJourneySession();
        gpsAt(6.9271, 79.8612);

        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('1. successful POST -> success, the emergency is stored, and the button activates', async () => {
        const result = await triggerSOSAlert();

        expect(result).toEqual({ success: true, message: SOS_SENT_MESSAGE });

        const stored = await storedEmergencies();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ busId: 'BUS-8899', bookingId: 'BK-A-01', passenger: { id: PASSENGER } });

        expect(useJourneyStore.getState().activeSOS).toMatchObject({ isActive: true, passengerName: 'Passenger A' });
        expect(sosButtonStateFor(result)).toEqual({ activated: true, errorMessage: '' });
    });

    it('2. POST 401 (session expired on the server) -> NOT sent, nothing stored', async () => {
        signInAs(SESSION_EXPIRED);

        const result = await expectNotSent('NOT_AUTHENTICATED');

        expect(result.message).toContain('sign in again');
        expect(result.message).toContain('NOT sent');
        expect(await storedEmergencies()).toHaveLength(0);
    });

    it('3. POST 403 (a non-passenger session) -> NOT sent, nothing stored', async () => {
        signInAs(SESSION_BUS);

        const result = await expectNotSent('FORBIDDEN');

        expect(result.message).toContain('NOT sent');
        expect(await storedEmergencies()).toHaveLength(0);
    });

    it('4. POST 400 from the real route (no usable GPS fix) -> NOT sent, with the server reason', async () => {
        gpsAt(undefined, undefined);

        const result = await expectNotSent('REJECTED');

        expect(result.message).toContain('Valid GPS coordinates');
        expect(result.message).toContain('NOT sent');
        expect(await storedEmergencies()).toHaveLength(0);
    });

    it.each([409, 422, 429])('4. POST %i -> NOT sent', async (status) => {
        postOverride = async () => jsonResponse(status, { success: false, message: 'Request refused.' });

        const result = await expectNotSent('REJECTED');

        expect(result.message).toBe('Request refused. Your SOS was NOT sent.');
    });

    it.each([500, 502, 503])('5. POST %i -> NOT sent, the server fault is not shown as success', async (status) => {
        postOverride = async () => jsonResponse(status, { success: false, message: 'Failed to create emergency request.' });

        const result = await expectNotSent('REJECTED');

        expect(result.message).toContain('could not record your SOS');
        expect(result.message).toContain('NOT sent');
    });

    it('5. a 5xx with an HTML error page -> NOT sent', async () => {
        postOverride = async () => new Response('<html>Bad Gateway</html>', { status: 502 });

        await expectNotSent('REJECTED');
    });

    it('6. network failure -> NOT sent', async () => {
        postOverride = async () => {
            throw new TypeError('Network request failed');
        };

        const result = await expectNotSent('NETWORK_UNAVAILABLE');

        expect(result.message).toContain('Could not reach the emergency service');
        expect(result.message).toContain('NOT sent');
    });

    it.each<[string, Responder]>([
        ['201 with no emergency in it', async () => jsonResponse(201, { success: true, message: 'ok' })],
        ['201 with an emergency that has no id', async () => jsonResponse(201, { success: true, emergency: { status: 'PENDING' } })],
        ['200 with a body that is not JSON', async () => new Response('OK', { status: 200 })],
        ['200 with success:false', async () => jsonResponse(200, { success: false })],
        ['200 with an empty body', async () => new Response(null, { status: 200 })],
    ])('7. unexpected response (%s) -> not confirmed, never success', async (_label, responder) => {
        postOverride = responder;

        const result = await expectNotSent('UNCONFIRMED');

        expect(result.message).toContain('could not be confirmed');
    });

    it('a later successful SOS still works after a failed one', async () => {
        postOverride = async () => jsonResponse(503, { success: false, message: 'Service Unavailable' });
        await expectNotSent('REJECTED');

        postOverride = null;
        const retry = await triggerSOSAlert();

        expect(retry.success).toBe(true);
        expect(await storedEmergencies()).toHaveLength(1);
    });
});

describe('sosRequestFailure: status -> passenger-facing failure', () => {
    const httpError = (status: number | null, message = 'Server said no.') => Object.assign(new Error(message), { status });

    it.each<[number | null, string]>([
        [401, 'NOT_AUTHENTICATED'],
        [403, 'FORBIDDEN'],
        [null, 'NETWORK_UNAVAILABLE'],
        [400, 'REJECTED'],
        [404, 'REJECTED'],
        [500, 'REJECTED'],
        [503, 'REJECTED'],
        [200, 'UNCONFIRMED'],
    ])('status %p -> %s, never success', (status, reason) => {
        const failure = sosRequestFailure(httpError(status));

        expect(failure.success).toBe(false);
        expect(failure.reason).toBe(reason);
        expect(failure.message).not.toContain('Successfully');
    });

    it('a non-Error rejection is treated as no answer at all', () => {
        expect(sosRequestFailure('boom').reason).toBe('NETWORK_UNAVAILABLE');
        expect(sosRequestFailure(undefined).success).toBe(false);
    });
});

describe('SOSButton state: "SOS ACTIVATED" only for success:true', () => {
    it.each<[string, unknown]>([
        ['a failure result', { success: false, message: 'Your SOS was NOT sent.' }],
        ['a failure with no message', { success: false }],
        ['a truthy but non-boolean success', { success: 'true', message: 'Emergency SOS Sent Successfully!' }],
        ['undefined', undefined],
        ['null', null],
    ])('%s does not activate the button and shows an error', (_label, result) => {
        const state = sosButtonStateFor(result);

        expect(state.activated).toBe(false);
        expect(state.errorMessage).toBeTruthy();
        expect(state.errorMessage).not.toContain('Sent Successfully');
    });

    it('a thrown error does not activate the button and says the SOS was not sent', () => {
        expect(sosButtonStateForError(new Error('Boom.'))).toEqual({
            activated: false,
            errorMessage: `Boom. ${SOS_NOT_SENT_MESSAGE}`,
        });
        expect(sosButtonStateForError('weird')).toEqual({ activated: false, errorMessage: SOS_NOT_SENT_MESSAGE });
    });

    it('SOSButton decides its state with sosButtonState, not a bare truthiness check', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '../../../src/features/journey/components/SOSButton.tsx'),
            'utf8'
        );

        expect(source).toContain('sosButtonStateFor(result)');
        expect(source).toContain('sosButtonStateForError(e)');
        expect(source).not.toMatch(/if \(result\.success\)/);
        expect(source).not.toContain('Sent Successfully');
    });
});
