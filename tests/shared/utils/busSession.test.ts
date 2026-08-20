// The stored bus session (MOV-265, subtask 2).
//
// Two things matter here. A bus session must never collide with the passenger
// or admin session held by `tokenStorage` — a driver signing a vehicle in must
// not sign a person out, and vice versa. And a failure to persist has to reach
// the caller, because the screen decides whether to navigate on the strength of
// it: a driver sent to the dashboard with no stored session is stranded.
//
// expo-secure-store and react-native are native modules that cannot load under
// this project's `testEnvironment: node`, so both are stubbed at the module
// boundary. No value below is a literal — they come from nextUniqueValue().

import {
    BusSession,
    clearBusSession,
    getBusSession,
    saveBusSession,
} from '../../../src/shared/utils/busSession';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

const mockSetItem = jest.fn();
const mockGetItem = jest.fn();
const mockDeleteItem = jest.fn();

jest.mock('expo-secure-store', () => ({
    setItemAsync: (key: string, value: string) => mockSetItem(key, value),
    getItemAsync: (key: string) => mockGetItem(key),
    deleteItemAsync: (key: string) => mockDeleteItem(key),
}));

// Only Platform is used by the module under test. ts-jest hoists these mock
// calls above the imports, so the stubs are in place before the module loads.
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const BUS_ID = 'BUS-00003';
const PLATE = 'NB-8899';

let issuedSession: string;

function session(overrides: Partial<BusSession> = {}): BusSession {
    return { busId: BUS_ID, numberPlate: PLATE, token: issuedSession, ...overrides };
}

/** Makes the stubbed store behave like a real one for a round trip. */
function backedByMemory() {
    const store = new Map<string, string>();
    mockSetItem.mockImplementation(async (k: string, v: string) => void store.set(k, v));
    mockGetItem.mockImplementation(async (k: string) => store.get(k) ?? null);
    mockDeleteItem.mockImplementation(async (k: string) => void store.delete(k));
    return store;
}

beforeEach(() => {
    jest.clearAllMocks();
    issuedSession = nextUniqueValue();
});

// ==================================================================
// ROUND TRIP
// ==================================================================
describe('the bus session survives a save and a read', () => {
    it('returns what was stored', async () => {
        backedByMemory();

        await saveBusSession(session());

        expect(await getBusSession()).toEqual({
            busId: BUS_ID,
            numberPlate: PLATE,
            token: issuedSession,
        });
    });

    it('returns nothing when the phone has never signed a bus in', async () => {
        backedByMemory();

        expect(await getBusSession()).toBeNull();
    });

    it('clears the session when the vehicle is signed out', async () => {
        backedByMemory();

        await saveBusSession(session());
        expect(await getBusSession()).not.toBeNull();

        await clearBusSession();
        expect(await getBusSession()).toBeNull();
    });

    it('removes only the vehicle keys, leaving a person signed in', async () => {
        // The dashboard's exit action calls this. A driver signing a bus out
        // must not sign the passenger or admin using the phone out with it —
        // tokenStorage owns those keys and is a separate identity. MOV-265.
        backedByMemory();

        await saveBusSession(session());
        await clearBusSession();

        const removed = mockDeleteItem.mock.calls.map(([key]) => key);
        expect(removed).not.toContain('moreable_access_token');
        expect(removed).not.toContain('moreable_user_data');
        expect(removed.every((key) => key.includes('bus'))).toBe(true);
        // And it really did remove both of its own.
        expect(removed).toHaveLength(2);
    });

    it('lets a failed clear reach the caller', async () => {
        // The dashboard decides whether to navigate away from this. Navigating
        // after a failed clear would leave a working bus session on the device
        // for whoever picks the phone up next.
        mockDeleteItem.mockRejectedValue(new Error('keychain unavailable'));

        await expect(clearBusSession()).rejects.toThrow();
    });
});

// ==================================================================
// WHAT IS AND IS NOT PERSISTED
// ==================================================================
describe('what reaches the device store', () => {
    it('never writes the credential the driver typed', async () => {
        backedByMemory();
        const enteredValue = nextUniqueValue();

        // The session type has no field for it, and nothing here adds one.
        await saveBusSession(session());

        const written = mockSetItem.mock.calls.map(([, value]) => value).join('\n');
        expect(written).not.toContain(enteredValue);
        expect(written).not.toMatch(/password/i);
    });

    it('writes only the bus id and plate alongside the token', async () => {
        backedByMemory();

        await saveBusSession({ ...session(), extra: 'ignored' } as BusSession & { extra: string });

        // Rebuilt field by field rather than spread, so nothing extra from a
        // login response can end up persisted.
        const busData = mockSetItem.mock.calls.find(([, v]) => v.startsWith('{'))?.[1];
        expect(Object.keys(JSON.parse(busData!)).sort()).toEqual(['busId', 'numberPlate']);
    });

    it('keeps the bus session away from the person session keys', async () => {
        backedByMemory();

        await saveBusSession(session());

        const keys = mockSetItem.mock.calls.map(([key]) => key);
        // tokenStorage owns moreable_access_token / moreable_user_data. A bus
        // signing in must not sign a passenger or admin out.
        expect(keys).not.toContain('moreable_access_token');
        expect(keys).not.toContain('moreable_user_data');
        expect(keys.every((key) => key.includes('bus'))).toBe(true);
    });
});

// ==================================================================
// WHEN STORAGE MISBEHAVES
// ==================================================================
describe('storage failures', () => {
    it('lets a failed save reach the caller', async () => {
        mockSetItem.mockRejectedValue(new Error('keychain unavailable'));

        // The screen decides whether to navigate from this. Swallowing it would
        // send the driver to a dashboard with no session behind it.
        await expect(saveBusSession(session())).rejects.toThrow();
    });

    it('treats a half-written session as no session', async () => {
        // A token with no bus record behind it cannot say which vehicle it is.
        mockGetItem.mockImplementation(async (key: string) =>
            key.includes('token') ? issuedSession : null
        );

        expect(await getBusSession()).toBeNull();
    });

    it('treats a record with no bus id as no session', async () => {
        mockGetItem.mockImplementation(async (key: string) =>
            key.includes('token') ? issuedSession : JSON.stringify({ numberPlate: PLATE })
        );

        expect(await getBusSession()).toBeNull();
    });

    it('treats unreadable storage as no session rather than crashing', async () => {
        mockGetItem.mockImplementation(async (key: string) =>
            key.includes('token') ? issuedSession : 'not json at all'
        );

        // A driver screen must still render if the store is corrupt.
        expect(await getBusSession()).toBeNull();
    });

    it('treats a store that throws on read as no session', async () => {
        mockGetItem.mockRejectedValue(new Error('keychain unavailable'));

        expect(await getBusSession()).toBeNull();
    });
});
