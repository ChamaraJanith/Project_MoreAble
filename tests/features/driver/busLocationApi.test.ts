// Publishing a position to the bus location endpoint (MOV-265, subtask 4).
//
// Two things this has to get right. The request must carry the bus identity and
// the session credential together, because the endpoint compares them — that
// pairing is what stops one bus being moved by another. And a rejection must
// stay distinguishable: a driver who is signed out needs to sign in, while one
// who is offline just needs to try again, and a single message for both sends
// them down the wrong path.
//
// No value below is a literal credential. Everything comes from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name. Coordinates are ordinary geographic test data.

import {
    PublishLocationError,
    publishBusLocation,
} from '../../../src/features/driver/api/busLocationApi';
import { PhoneLocation } from '../../../src/shared/utils/phoneLocation';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

// PhoneLocation is a type only, but its module imports expo-location, which is
// native ESM that Jest cannot load under this project's node environment.
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const BUS_ID = 'BUS-00003';

const READING: PhoneLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

/** Stands in for the stored session credential. Fresh for every test. */
let sessionValue: string;

function respondWith(status: number, body: unknown) {
    mockFetch.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    });
}

const confirmed = () => ({ success: true, message: 'Vehicle location updated successfully.' });

/** The request the client actually sent. */
function sentRequest() {
    const [url, init] = mockFetch.mock.calls[0];
    return { url: String(url), init, body: JSON.parse(init.body) };
}

beforeEach(() => {
    jest.clearAllMocks();
    sessionValue = nextUniqueValue();
});

// ==================================================================
// THE REQUEST
// ==================================================================
describe('publishBusLocation - what goes on the wire', () => {
    it('PUTs the reading to the endpoint for that bus', async () => {
        respondWith(200, confirmed());

        await publishBusLocation(BUS_ID, READING, sessionValue);

        const { url, init } = sentRequest();
        expect(url).toBe(`/api/buses/${BUS_ID}/location`);
        expect(init.method).toBe('PUT');
    });

    it('carries the session credential that proves it may move this bus', async () => {
        respondWith(200, confirmed());

        await publishBusLocation(BUS_ID, READING, sessionValue);

        // Without it the endpoint answers 401; with one belonging to another
        // bus it answers 403. The pairing is the whole protection.
        expect(sentRequest().init.headers.Authorization).toBe(`Bearer ${sessionValue}`);
    });

    it('sends exactly the three fields the endpoint accepts', async () => {
        respondWith(200, confirmed());

        await publishBusLocation(BUS_ID, READING, sessionValue);

        const { body } = sentRequest();
        expect(body).toEqual({
            latitude: READING.latitude,
            longitude: READING.longitude,
            recordedAt: READING.recordedAt,
        });
        // Speed, heading, altitude and accuracy are all available from the GPS
        // reading and none of them travels.
        expect(Object.keys(body).sort()).toEqual(['latitude', 'longitude', 'recordedAt']);
    });

    it('sends the fix time from the reading rather than a fresh clock read', async () => {
        respondWith(200, confirmed());

        await publishBusLocation(BUS_ID, READING, sessionValue);

        // The backend measures how current a position is from this field.
        expect(sentRequest().body.recordedAt).toBe(READING.recordedAt);
    });

    it('keeps the credential out of the body and the URL', async () => {
        respondWith(200, confirmed());

        await publishBusLocation(BUS_ID, READING, sessionValue);

        const { url, body } = sentRequest();
        // A credential in a path or query string ends up in server logs and
        // browser history; it belongs in the header only.
        expect(url).not.toContain(sessionValue);
        expect(JSON.stringify(body)).not.toContain(sessionValue);
    });

    it('escapes the bus id rather than pasting it into the path', async () => {
        respondWith(200, confirmed());

        await publishBusLocation('BUS 1/../x', READING, sessionValue);

        expect(sentRequest().url).toBe('/api/buses/BUS%201%2F..%2Fx/location');
    });

    it('resolves quietly when the endpoint confirms the write', async () => {
        respondWith(200, confirmed());

        await expect(
            publishBusLocation(BUS_ID, READING, sessionValue)
        ).resolves.toBeUndefined();
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

        await expect(publishBusLocation(BUS_ID, READING, sessionValue)).rejects.toMatchObject({
            name: 'PublishLocationError',
            reason,
        });
    });

    it('treats a 200 that does not confirm the write as a failure', async () => {
        // The status alone is not proof the position was stored. A 200 can come
        // from something that is not this endpoint at all, and reporting
        // "Location shared" on that basis would tell a driver the bus is being
        // tracked when nothing was written.
        respondWith(200, { success: false, message: 'Failed to update vehicle location.' });

        await expect(publishBusLocation(BUS_ID, READING, sessionValue)).rejects.toMatchObject({
            reason: 'PUBLISH_FAILED',
            serverMessage: 'Failed to update vehicle location.',
        });
    });

    it.each([
        ['an empty object', {}],
        ['no body at all', null],
        ['a page instead of the API answer', { html: 'doctype' }],
    ])('treats a 200 carrying %s as a failure', async (_label, body) => {
        respondWith(200, body);

        await expect(publishBusLocation(BUS_ID, READING, sessionValue)).rejects.toMatchObject({
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

        await expect(publishBusLocation(BUS_ID, READING, sessionValue)).rejects.toMatchObject({
            reason: 'PUBLISH_FAILED',
        });
    });

    it('separates being offline from being rejected', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        await expect(publishBusLocation(BUS_ID, READING, sessionValue)).rejects.toMatchObject({
            reason: 'NETWORK_UNAVAILABLE',
        });
    });

    it('refuses to send without a bus id, rather than building a broken path', async () => {
        // `/api/buses//location` would reach a different route entirely.
        await expect(publishBusLocation('', READING, sessionValue)).rejects.toMatchObject({
            reason: 'BUS_NOT_FOUND',
        });
        await expect(publishBusLocation('   ', READING, sessionValue)).rejects.toMatchObject({
            reason: 'BUS_NOT_FOUND',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses to send without a session credential', async () => {
        await expect(publishBusLocation(BUS_ID, READING, '')).rejects.toMatchObject({
            reason: 'NOT_AUTHENTICATED',
        });
        // No point spending a request that is certain to be refused.
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ==================================================================
// WHAT REACHES THE DRIVER
// ==================================================================
describe('PublishLocationError', () => {
    it('shows its own wording, not the operator-facing server wording', async () => {
        respondWith(403, {
            success: false,
            message: 'Only an operator account may report a vehicle location.',
        });

        const error = await publishBusLocation(BUS_ID, READING, sessionValue).catch((e) => e);

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
        respondWith(status, { success: false });

        const error = await publishBusLocation(BUS_ID, READING, sessionValue).catch((e) => e);

        expect(error.message).toMatch(expected);
        // Never a status code or an internal reason code.
        expect(error.message).not.toMatch(/\d{3}/);
        expect(error.message).not.toMatch(/_/);
    });
});

// ==================================================================
// PRIVACY
// ==================================================================
describe('publishBusLocation - nothing is written down', () => {
    it('logs neither the coordinates nor the credential', async () => {
        respondWith(200, confirmed());

        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            await publishBusLocation(BUS_ID, READING, sessionValue);
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        const output = logged.join('\n');
        expect(output).not.toContain(String(READING.latitude));
        expect(output).not.toContain(String(READING.longitude));
        expect(output).not.toContain(sessionValue);
    });
});
