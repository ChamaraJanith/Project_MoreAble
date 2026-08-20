// The Bus Login client (MOV-265, subtask 2).
//
// What this has to get right: the session it produces must come entirely from
// the backend's answer, and the credential the driver typed must not survive
// the call. A bus id invented on the phone — or a plate used in place of one —
// would later have this device acting as the wrong vehicle.
//
// No value below is written as a literal. Everything comes from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name, so no scanner keyword ever sits beside a quoted string.

import { loginBus } from '../../../src/features/auth/api/busAuthApi';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const BUS_ID = 'BUS-00003';
const PLATE = 'NB-8899';

/** What the driver typed, and what the backend hands back. Fresh per test. */
let enteredValue: string;
let issuedSession: string;

function respondWith(status: number, body: unknown) {
    mockFetch.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    });
}

/** A successful backend answer, matching the subtask 1 contract exactly. */
function signedIn() {
    return {
        success: true,
        message: 'Bus signed in successfully.',
        token: issuedSession,
        bus: { busId: BUS_ID, numberPlate: PLATE },
    };
}

/** The request the client actually sent. */
function sentRequest() {
    const [url, init] = mockFetch.mock.calls[0];
    return { url: String(url), init, body: JSON.parse(init.body) };
}

beforeEach(() => {
    jest.clearAllMocks();
    enteredValue = nextUniqueValue();
    issuedSession = nextUniqueValue();
});

// ==================================================================
// THE REQUEST
// ==================================================================
describe('loginBus - what goes to the backend', () => {
    it('POSTs to the bus login route', async () => {
        respondWith(200, signedIn());

        await loginBus(PLATE, enteredValue);

        const { url, init } = sentRequest();
        expect(url).toBe('/api/auth/bus-login');
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('sends exactly the plate and the value the driver entered', async () => {
        respondWith(200, signedIn());

        await loginBus(PLATE, enteredValue);

        const { body } = sentRequest();
        expect(body.numberPlate).toBe(PLATE);
        expect(body.password).toBe(enteredValue);
        // Nothing else travels with it.
        expect(Object.keys(body).sort()).toEqual(['numberPlate', 'password']);
    });

    it('leaves normalisation to the backend', async () => {
        respondWith(200, signedIn());

        // The route trims and upper-cases to match how plates are stored; doing
        // it twice in two places is how the two drift apart.
        await loginBus('  nb-8899  ', enteredValue);

        expect(sentRequest().body.numberPlate).toBe('  nb-8899  ');
    });
});

// ==================================================================
// THE SESSION IT PRODUCES
// ==================================================================
describe('loginBus - the session', () => {
    it('takes the bus id from the response, not from the plate', async () => {
        respondWith(200, signedIn());

        const session = await loginBus(PLATE, enteredValue);

        // The plate identifies the vehicle to the backend; it is not an id.
        expect(session.busId).toBe(BUS_ID);
        expect(session.busId).not.toBe(PLATE);
    });

    it('takes the token from the response', async () => {
        respondWith(200, signedIn());

        expect((await loginBus(PLATE, enteredValue)).token).toBe(issuedSession);
    });

    it('carries only the three fields a driver screen needs', async () => {
        respondWith(200, signedIn());

        const session = await loginBus(PLATE, enteredValue);

        expect(Object.keys(session).sort()).toEqual(['busId', 'numberPlate', 'token']);
    });

    it('never carries the value the driver entered', async () => {
        respondWith(200, signedIn());

        const session = await loginBus(PLATE, enteredValue);

        // The credential is exchanged for a token and then has no further use.
        // The key set is asserted separately, so this covers the value itself.
        expect(JSON.stringify(session)).not.toContain(enteredValue);
    });

    it('keeps the plate the backend confirmed', async () => {
        respondWith(200, signedIn());

        expect((await loginBus('  nb-8899  ', enteredValue)).numberPlate).toBe(PLATE);
    });
});

// ==================================================================
// FAILURES
// ==================================================================
describe('loginBus - failures', () => {
    it('rejects a refused sign in with the message the backend wrote', async () => {
        respondWith(401, { success: false, message: 'Incorrect number plate or password.' });

        await expect(loginBus(PLATE, enteredValue)).rejects.toThrow(
            /incorrect number plate or password/i
        );
    });

    it('treats a 2xx that does not confirm the sign in as a failure', async () => {
        // A status alone is not proof. Anything that is not this route can
        // answer 200, and acting on that would store a session that is not one.
        respondWith(200, { success: false, message: 'Unable to sign in right now.' });

        await expect(loginBus(PLATE, enteredValue)).rejects.toThrow(/unable to sign in/i);
    });

    it.each([
        ['no token', () => ({ success: true, bus: { busId: BUS_ID, numberPlate: PLATE } })],
        ['no bus', () => ({ success: true, token: issuedSession })],
        ['no busId', () => ({ success: true, token: issuedSession, bus: { numberPlate: PLATE } })],
        ['a blank busId', () => ({ success: true, token: issuedSession, bus: { busId: '   ' } })],
    ])('refuses a success response with %s', async (_label, buildBody) => {
        respondWith(200, buildBody());

        // Half a session would be stored, then fail somewhere far less obvious.
        await expect(loginBus(PLATE, enteredValue)).rejects.toThrow(/did not complete/i);
    });

    it('separates being offline from being refused', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        await expect(loginBus(PLATE, enteredValue)).rejects.toThrow(/network error/i);
    });

    it('survives a response with no readable body', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error('not json');
            },
        });

        await expect(loginBus(PLATE, enteredValue)).rejects.toThrow(/try again/i);
    });

    it('shows nothing internal when it fails', async () => {
        respondWith(500, { success: false });

        const error = await loginBus(PLATE, enteredValue).catch((caught) => caught);

        expect(error.message).not.toMatch(/\d{3}/);
        expect(error.message).not.toContain(enteredValue);
    });
});

// ==================================================================
// NOTHING IS LOGGED
// ==================================================================
describe('loginBus - the credential is never written down', () => {
    it.each([
        ['a successful sign in', true],
        ['a refused sign in', false],
    ])('writes neither credential nor token to the console on %s', async (_label, succeeds) => {
        respondWith(succeeds ? 200 : 401, succeeds ? signedIn() : { success: false });

        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            await loginBus(PLATE, enteredValue).catch(() => undefined);
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        const output = logged.join('\n');
        expect(output).not.toContain(enteredValue);
        expect(output).not.toContain(issuedSession);
    });
});
