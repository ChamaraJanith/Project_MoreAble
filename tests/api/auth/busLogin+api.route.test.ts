// Bus Device Login (MOV-265).
//
// This is where a bus identity is created, so everything downstream depends on
// it being right: the token it issues is what the GPS endpoint trusts when it
// decides whether a phone may move a bus. Two things must hold — the right bus
// is identified from the plate and password, and the credential never leaves
// this route in any form.
//
// Passwords are generated at run time; there is no credential-shaped literal
// anywhere in this file.

import { POST as busLogin } from '../../../app/api/auth/bus-login+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { buildTestPassword, buildTestToken } from '../../testUtils/testPassword';

const mockGetAdminDb = jest.fn();
const mockGenerateToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The signing itself is stubbed so the claims can be inspected directly; the
// route's own logic around it runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    generateToken: (payload: unknown) => mockGenerateToken(payload),
}));

const BUS_A = 'BUS-00003';
const BUS_B = 'BUS-00004';

function loginRequest(body: unknown): Request {
    return new Request('http://localhost/api/auth/bus-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

function storedBus(busId: string, numberPlate: string, password?: string) {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: { wheelchairRamp: true },
        status: 'ACTIVE',
        ...(password === undefined ? {} : { password }),
    };
}

/** Two buses, each with its own credential. */
function fleet(passwordA: string, passwordB: string) {
    return createFakeFirestore({
        buses: [storedBus(BUS_A, 'NB-8899', passwordA), storedBus(BUS_B, 'NC-1122', passwordB)],
    });
}

/** The token the stubbed signer returns for one test, generated per run. */
let issuedToken: string;

beforeEach(() => {
    jest.clearAllMocks();
    issuedToken = buildTestToken('bus-session');
    mockGenerateToken.mockResolvedValue(issuedToken);
});

// ==================================================================
// IDENTIFYING THE RIGHT BUS
// ==================================================================
describe('POST /api/auth/bus-login - identifying the bus', () => {
    it('signs in the bus that owns the number plate and password', async () => {
        const passwordA = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(passwordA, buildTestPassword('bus-b')));

        const response = await busLogin(
            loginRequest({ numberPlate: 'NB-8899', password: passwordA })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        // The id comes from the matched record, never from the request.
        expect(json.bus.busId).toBe(BUS_A);
        expect(json.bus.numberPlate).toBe('NB-8899');
    });

    it('accepts the plate however the driver types it', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(password, buildTestPassword('bus-b')));

        const response = await busLogin(
            loginRequest({ numberPlate: '  nb-8899  ', password })
        );

        expect(response.status).toBe(200);
        expect((await response.json()).bus.busId).toBe(BUS_A);
    });

    it("refuses one bus's password on another bus's plate", async () => {
        const passwordA = buildTestPassword('bus-a');
        const passwordB = buildTestPassword('bus-b');
        mockGetAdminDb.mockReturnValue(fleet(passwordA, passwordB));

        // The credential is per bus. Holding one must not open another.
        const response = await busLogin(
            loginRequest({ numberPlate: 'NB-8899', password: passwordB })
        );

        expect(response.status).toBe(401);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    it('refuses an unknown plate the same way as a wrong password', async () => {
        const passwordA = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(passwordA, buildTestPassword('bus-b')));

        const unknownPlate = await busLogin(
            loginRequest({ numberPlate: 'ZZ-0000', password: passwordA })
        );
        const wrongPassword = await busLogin(
            loginRequest({ numberPlate: 'NB-8899', password: buildTestPassword('wrong') })
        );

        // Identical answers, so the response cannot be used to discover which
        // plates exist in the fleet.
        expect(unknownPlate.status).toBe(401);
        expect(wrongPassword.status).toBe(401);
        expect((await unknownPlate.json()).message).toBe((await wrongPassword.json()).message);
    });

    it('refuses a bus that has no password configured', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ buses: [storedBus(BUS_A, 'NB-8899')] })
        );

        // An admin has simply not set one yet. It must not fall through to a
        // successful sign in.
        const response = await busLogin(
            loginRequest({ numberPlate: 'NB-8899', password: buildTestPassword('any') })
        );

        expect(response.status).toBe(401);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    it.each([
        ['no plate', () => ({ password: buildTestPassword() })],
        ['blank plate', () => ({ numberPlate: '   ', password: buildTestPassword() })],
        ['no password', () => ({ numberPlate: 'NB-8899' })],
        // The empty string is the case under test, not a credential.
        ['empty password', () => ({ numberPlate: 'NB-8899', password: '' })],
    ])('rejects a request with %s', async (_label, buildBody) => {
        mockGetAdminDb.mockReturnValue(fleet(buildTestPassword(), buildTestPassword()));

        expect((await busLogin(loginRequest(buildBody()))).status).toBe(400);
    });

    it('survives a malformed body', async () => {
        mockGetAdminDb.mockReturnValue(fleet(buildTestPassword(), buildTestPassword()));

        const malformed = new Request('http://localhost/api/auth/bus-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"numberPlate":',
        });

        expect((await busLogin(malformed)).status).toBe(400);
    });
});

// ==================================================================
// THE TOKEN
// ==================================================================
describe('POST /api/auth/bus-login - the session token', () => {
    it('issues a BUS identity carrying the authenticated busId', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(password, buildTestPassword('bus-b')));

        await busLogin(loginRequest({ numberPlate: 'NB-8899', password }));

        // This claim is what the location endpoint compares against the id in
        // the URL, so it has to be the id of the bus that just authenticated.
        expect(mockGenerateToken).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'BUS', busId: BUS_A })
        );
    });

    it('is not an admin session', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(password, buildTestPassword('bus-b')));

        await busLogin(loginRequest({ numberPlate: 'NB-8899', password }));

        const claims = mockGenerateToken.mock.calls[0][0];
        expect(claims.role).not.toBe('ADMIN');
        expect(claims.role).toBe('BUS');
    });

    it('returns the token to the caller', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(password, buildTestPassword('bus-b')));

        const json = await (
            await busLogin(loginRequest({ numberPlate: 'NB-8899', password }))
        ).json();

        expect(json.token).toBe(issuedToken);
    });

    it('refuses to issue a token for a record with no busId', async () => {
        const password = buildTestPassword('broken');
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                buses: [{ id: 'incomplete-record', numberPlate: 'NB-8899', password, status: 'ACTIVE' }],
            })
        );

        const response = await busLogin(loginRequest({ numberPlate: 'NB-8899', password }));

        // A token with no bus in it would be accepted by nothing downstream.
        expect(response.status).toBe(409);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });
});

// ==================================================================
// THE CREDENTIAL DOES NOT LEAVE
// ==================================================================
describe('POST /api/auth/bus-login - the password stays put', () => {
    it('is absent from the response', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(password, buildTestPassword('bus-b')));

        const json = await (
            await busLogin(loginRequest({ numberPlate: 'NB-8899', password }))
        ).json();

        expect(json.bus.password).toBeUndefined();
        expect(json.bus.passwordHash).toBeUndefined();
        expect(JSON.stringify(json)).not.toContain(password);
    });

    it('is not put into the token claims', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockReturnValue(fleet(password, buildTestPassword('bus-b')));

        await busLogin(loginRequest({ numberPlate: 'NB-8899', password }));

        // A token is passed around and stored; a password inside one would
        // travel everywhere the token does.
        expect(JSON.stringify(mockGenerateToken.mock.calls[0][0])).not.toContain(password);
    });

    it('is never written to the console, even when the route fails', async () => {
        const password = buildTestPassword('bus-a');
        mockGetAdminDb.mockImplementation(() => {
            throw new Error('Firestore unavailable');
        });

        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            const response = await busLogin(
                loginRequest({ numberPlate: 'NB-8899', password })
            );
            expect(response.status).toBe(500);
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        expect(logged.join('\n')).not.toContain(password);
    });
});
