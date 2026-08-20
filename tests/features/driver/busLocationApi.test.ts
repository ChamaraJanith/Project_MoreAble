// Publishing the phone's position to the bus location endpoint (MOV-265).
//
// Two things this has to get right. The request must carry the bus identity and
// the credential together, because the endpoint compares them and a mismatch is
// what stops one bus being moved by another. And a rejection must stay
// distinguishable: a driver who is signed out needs to sign in, while a driver
// who is offline just needs to wait, and one message for both would send them
// down the wrong path.
//
// Coordinates below are ordinary geographic test data. The token values are
// generated at run time rather than written as literals.

import {
    PublishLocationError,
    publishBusLocation,
} from '../../../src/features/driver/api/busLocationApi';
import { PhoneLocation } from '../../../src/shared/utils/phoneLocation';
import { buildTestPassword } from '../../testUtils/testPassword';

// PhoneLocation is a type only, but the module it lives in imports
// expo-location, which is native ESM Jest cannot load. Stubbed at the same
// boundary the MOV-263 suite uses; nothing here calls it.
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const BUS_ID = 'BUS-00001';

const READING: PhoneLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

/** A session token, assembled at run time so no credential-shaped literal exists. */
const testToken = () => buildTestPassword('bus-session');

function respondWith(status: number, body: unknown = { success: false }) {
    mockFetch.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    });
}

/** The request the client actually sent. */
function sentRequest() {
    const [url, init] = mockFetch.mock.calls[0];
    return { url: String(url), init, body: JSON.parse(init.body) };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// THE REQUEST
// ==================================================================
describe('publishBusLocation - what goes on the wire', () => {
    it('PUTs the reading to the endpoint for that bus', async () => {
        respondWith(200, { success: true });

        await publishBusLocation(BUS_ID, READING, testToken());

        const { url, init } = sentRequest();
        expect(url).toBe(`/api/buses/${BUS_ID}/location`);
        expect(init.method).toBe('PUT');
    });

    it('carries the credential that proves the caller may move this bus', async () => {
        respondWith(200, { success: true });

        const token = testToken();
        await publishBusLocation(BUS_ID, READING, token);

        // Without this the endpoint answers 401, and with a token belonging to
        // another bus it answers 403 — the pairing is the whole protection.
        expect(sentRequest().init.headers.Authorization).toBe(`Bearer ${token}`);
    });

    it('sends exactly the three fields the endpoint accepts', async () => {
        respondWith(200, { success: true });

        await publishBusLocation(BUS_ID, READING, testToken());

        const { body } = sentRequest();
        expect(body).toEqual({
            latitude: 6.9061,
            longitude: 79.9558,
            recordedAt: '2026-08-20T09:05:00.000Z',
        });
        // Nothing else from the handset travels with it.
        expect(Object.keys(body).sort()).toEqual(['latitude', 'longitude', 'recordedAt']);
    });

    it('sends the fix time unchanged, so the backend can age it correctly', async () => {
        respondWith(200, { success: true });

        await publishBusLocation(BUS_ID, READING, testToken());

        expect(sentRequest().body.recordedAt).toBe(READING.recordedAt);
    });

    it('escapes the bus id rather than pasting it into the path', async () => {
        respondWith(200, { success: true });

        await publishBusLocation('BUS 00001/../x', READING, testToken());

        expect(sentRequest().url).toBe('/api/buses/BUS%2000001%2F..%2Fx/location');
    });

    it('resolves quietly when the endpoint accepts the reading', async () => {
        respondWith(200, { success: true });

        await expect(publishBusLocation(BUS_ID, READING, testToken())).resolves.toBeUndefined();
    });
});

// ==================================================================
// REJECTIONS STAY TOLD APART
// ==================================================================
describe('publishBusLocation - failures', () => {
    it.each([
        [401, 'NOT_AUTHENTICATED'],
        [403, 'NOT_AUTHORISED'],
        [404, 'BUS_NOT_FOUND'],
        [400, 'INVALID_LOCATION'],
        [500, 'PUBLISH_FAILED'],
    ] as const)('turns %i into %s', async (status, reason) => {
        respondWith(status, { success: false, message: 'server wording' });

        await expect(publishBusLocation(BUS_ID, READING, testToken())).rejects.toMatchObject({
            name: 'PublishLocationError',
            reason,
        });
    });

    it('treats a 200 response that does not confirm the write as a failure', async () => {
        // The status alone is not proof the position was stored. A 200 can come
        // from something that is not this endpoint at all — a proxy, a tunnel,
        // a dev-server page served for an unmatched path — and reporting
        // "Location shared" on the strength of it would tell a driver the bus
        // is being tracked when nothing was written.
        respondWith(200, { success: false, message: 'Failed to update vehicle location.' });

        await expect(publishBusLocation(BUS_ID, READING, testToken())).rejects.toMatchObject({
            name: 'PublishLocationError',
            reason: 'PUBLISH_FAILED',
            serverMessage: 'Failed to update vehicle location.',
        });
    });

    it.each([
        ['an empty object', {}],
        ['no body at all', null],
        ['a page instead of the API answer', { html: '<!doctype html>' }],
    ])('treats a 200 carrying %s as a failure', async (_label, body) => {
        respondWith(200, body);

        // Absent is not the same as false, but neither is a confirmation.
        await expect(publishBusLocation(BUS_ID, READING, testToken())).rejects.toMatchObject({
            reason: 'PUBLISH_FAILED',
        });
    });

    it('treats a 200 whose body cannot be parsed as a failure', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new Error('Unexpected token < in JSON');
            },
        });

        await expect(publishBusLocation(BUS_ID, READING, testToken())).rejects.toMatchObject({
            reason: 'PUBLISH_FAILED',
        });
    });

    it('still succeeds when the endpoint confirms the write', async () => {
        // The guard must not turn a genuine success into a failure.
        respondWith(200, { success: true, message: 'Vehicle location updated successfully.' });

        await expect(publishBusLocation(BUS_ID, READING, testToken())).resolves.toBeUndefined();
    });

    it('separates being offline from being rejected', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        // The reading was fine and retrying may well work, which is not true of
        // a 401 or a 403.
        await expect(publishBusLocation(BUS_ID, READING, testToken())).rejects.toMatchObject({
            reason: 'NETWORK_UNAVAILABLE',
        });
    });

    it('refuses to send without a bus id, rather than building a broken path', async () => {
        // `/api/buses//location` would reach a different route entirely.
        await expect(publishBusLocation('', READING, testToken())).rejects.toMatchObject({
            reason: 'BUS_NOT_FOUND',
        });
        await expect(publishBusLocation('   ', READING, testToken())).rejects.toMatchObject({
            reason: 'BUS_NOT_FOUND',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses to send without a credential', async () => {
        await expect(publishBusLocation(BUS_ID, READING, '')).rejects.toMatchObject({
            reason: 'NOT_AUTHENTICATED',
        });
        // No point spending a request that is certain to be refused.
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('survives a rejection with no readable body', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error('not json');
            },
        });

        await expect(publishBusLocation(BUS_ID, READING, testToken())).rejects.toMatchObject({
            reason: 'PUBLISH_FAILED',
        });
    });
});

// ==================================================================
// WHAT REACHES THE DRIVER
// ==================================================================
describe('PublishLocationError', () => {
    it('shows its own wording, not the server operator wording', async () => {
        respondWith(403, {
            success: false,
            message: 'Only an operator account may report a vehicle location.',
        });

        const error = await publishBusLocation(BUS_ID, READING, testToken()).catch((e) => e);

        expect(error).toBeInstanceOf(PublishLocationError);
        expect(error.message).not.toContain('operator account');
        // Kept for diagnostics, just not shown.
        expect(error.serverMessage).toBe('Only an operator account may report a vehicle location.');
    });

    it.each([
        [401, /sign in/i],
        [403, /not allowed/i],
        [404, /fleet/i],
        [500, /try again/i],
    ] as const)('gives %i a message a driver can act on', async (status, expected) => {
        respondWith(status);

        const error = await publishBusLocation(BUS_ID, READING, testToken()).catch((e) => e);

        expect(error.message).toMatch(expected);
        // Never a status code or a reason code.
        expect(error.message).not.toMatch(/\d{3}/);
        expect(error.message).not.toMatch(/_/);
    });

    it('is an ordinary Error, so existing catch handling still works', async () => {
        respondWith(500);

        const error = await publishBusLocation(BUS_ID, READING, testToken()).catch((e) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error.message.length).toBeGreaterThan(0);
    });
});

// ==================================================================
// PRIVACY
// ==================================================================
describe('publishBusLocation - the position goes nowhere else', () => {
    it('never writes coordinates to the console', async () => {
        respondWith(200, { success: true });

        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            await publishBusLocation(BUS_ID, READING, testToken());
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        const output = logged.join('\n');
        expect(output).not.toContain(String(READING.latitude));
        expect(output).not.toContain(String(READING.longitude));
    });

    it('never puts the credential in the URL', async () => {
        respondWith(200, { success: true });

        const token = testToken();
        await publishBusLocation(BUS_ID, READING, token);

        // A token in a path or query string ends up in server logs and browser
        // history; it belongs in the header only.
        expect(sentRequest().url).not.toContain(token);
    });
});
