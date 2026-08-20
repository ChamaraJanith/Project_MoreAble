// Bus Device Login (MOV-265).
//
// This is where a vehicle identity is created, so everything built on top of it
// depends on this being right: the token issued here is what later work will
// trust when deciding whether a phone may act as a particular bus.
//
// Two things have to hold. The correct bus is identified from the plate and the
// stored credential — and one bus's credential must never open another. And the
// credential itself stops here: it must not appear in the response, in the
// token, or in anything written to the console.
//
// No credential is written as a literal anywhere below. Values come from
// nextUniqueValue(), which is named and shaped so that no scanner keyword ever
// sits beside a quoted string. See tests/testUtils/uniqueValue.ts.

import { POST as busLogin } from '../../../app/api/auth/bus-login+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

const mockGetAdminDb = jest.fn();
const mockGenerateToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Signing is stubbed so the claims handed to it can be inspected directly. The
// route's own logic around it runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    generateToken: (payload: unknown) => mockGenerateToken(payload),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const BUS_A = 'BUS-00003';
const BUS_B = 'BUS-00004';
const PLATE_A = 'NB-8899';
const PLATE_B = 'NC-1122';

/** Values the fleet is seeded with, regenerated for every test. */
let storedValueA: string;
let storedValueB: string;
/** What the stubbed signer hands back, so assertions can match on it. */
let issuedSession: string;

function loginRequest(body: unknown): Request {
    return new Request('http://localhost/api/auth/bus-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

function storedBus(busId: string, numberPlate: string, configured?: string) {
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
        ...(configured === undefined ? {} : { password: configured }),
    };
}

/** Two buses, each set up with its own distinct credential. */
function fleet() {
    return createFakeFirestore({
        buses: [
            storedBus(BUS_A, PLATE_A, storedValueA),
            storedBus(BUS_B, PLATE_B, storedValueB),
        ],
    });
}

beforeEach(() => {
    jest.clearAllMocks();

    storedValueA = nextUniqueValue();
    storedValueB = nextUniqueValue();
    issuedSession = nextUniqueValue();

    mockGenerateToken.mockResolvedValue(issuedSession);
});

// ==================================================================
// IDENTIFYING THE RIGHT BUS
// ==================================================================
describe('POST /api/auth/bus-login - identifying the bus', () => {
    it('signs in the bus the plate and credential belong to', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const response = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: storedValueA })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        // The id comes from the matched record, never from the request.
        expect(json.bus.busId).toBe(BUS_A);
        expect(json.bus.numberPlate).toBe(PLATE_A);
    });

    it('normalises the plate the way bus creation does', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        // Stored upper-cased and trimmed, so a driver typing it loosely still
        // reaches the right vehicle.
        const response = await busLogin(
            loginRequest({ numberPlate: `  ${PLATE_A.toLowerCase()}  `, password: storedValueA })
        );

        expect(response.status).toBe(200);
        expect((await response.json()).bus.busId).toBe(BUS_A);
    });

    it('refuses the wrong credential for a real plate', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const response = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: nextUniqueValue() })
        );

        expect(response.status).toBe(401);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    it("refuses one bus's credential on another bus's plate", async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        // The credential is per vehicle. Holding one must not open another.
        const response = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: storedValueB })
        );

        expect(response.status).toBe(401);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    it('answers an unknown plate exactly as it answers a wrong credential', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const unknownPlate = await busLogin(
            loginRequest({ numberPlate: 'ZZ-0000', password: storedValueA })
        );
        const wrongValue = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: nextUniqueValue() })
        );

        // Identical answers, so the endpoint cannot be used to discover which
        // plates exist in the fleet.
        expect(unknownPlate.status).toBe(401);
        expect(wrongValue.status).toBe(401);
        expect((await unknownPlate.json()).message).toBe((await wrongValue.json()).message);
    });

    it('refuses a bus that has no credential configured', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ buses: [storedBus(BUS_A, PLATE_A)] })
        );

        // An admin has simply not set one yet. It must not fall through to a
        // successful sign in.
        const response = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: nextUniqueValue() })
        );

        expect(response.status).toBe(401);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    it('answers a bus with no credential the same way as an unknown plate', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ buses: [storedBus(BUS_A, PLATE_A)] })
        );

        const noCredential = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: nextUniqueValue() })
        );
        const unknownPlate = await busLogin(
            loginRequest({ numberPlate: 'ZZ-0000', password: nextUniqueValue() })
        );

        // Which buses are set up for driver sign in is not discoverable either.
        expect((await noCredential.json()).message).toBe((await unknownPlate.json()).message);
    });

    it.each([
        ['no plate', () => ({ password: nextUniqueValue() })],
        ['a blank plate', () => ({ numberPlate: '   ', password: nextUniqueValue() })],
        ['nothing to verify', () => ({ numberPlate: PLATE_A })],
        ['an empty value to verify', () => ({ numberPlate: PLATE_A, password: '' })],
    ])('rejects a request with %s', async (_label, buildBody) => {
        mockGetAdminDb.mockReturnValue(fleet());

        expect((await busLogin(loginRequest(buildBody()))).status).toBe(400);
    });

    it('survives a malformed body', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const malformed = new Request('http://localhost/api/auth/bus-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"numberPlate":',
        });

        expect((await busLogin(malformed)).status).toBe(400);
    });

    it('reports a failure without leaking why', async () => {
        mockGetAdminDb.mockImplementation(() => {
            throw new Error('Firestore unavailable');
        });

        const response = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: nextUniqueValue() })
        );
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.message).not.toContain('Firestore');
    });
});

// ==================================================================
// THE SESSION TOKEN
// ==================================================================
describe('POST /api/auth/bus-login - the session token', () => {
    it('carries the BUS role and the authenticated busId', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }));

        // These two claims are what later work compares against the bus being
        // acted on, so they have to describe the vehicle that just signed in.
        expect(mockGenerateToken).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'BUS', busId: BUS_A, uid: BUS_A })
        );
    });

    it('is a vehicle session, not an operator one', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }));

        const claims = mockGenerateToken.mock.calls[0][0];
        expect(claims.role).toBe('BUS');
        expect(claims.role).not.toBe('ADMIN');
    });

    it('identifies each bus as itself', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        await busLogin(loginRequest({ numberPlate: PLATE_B, password: storedValueB }));

        expect(mockGenerateToken).toHaveBeenCalledWith(
            expect.objectContaining({ busId: BUS_B })
        );
    });

    it('returns the session to the caller', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const json = await (
            await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }))
        ).json();

        expect(json.token).toBe(issuedSession);
    });

    it('refuses to issue one for a record with no busId', async () => {
        const configured = nextUniqueValue();
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                buses: [
                    {
                        id: 'incomplete-record',
                        numberPlate: PLATE_A,
                        status: 'ACTIVE',
                        password: configured,
                    },
                ],
            })
        );

        const response = await busLogin(
            loginRequest({ numberPlate: PLATE_A, password: configured })
        );

        // A session with no vehicle in it would be acted on by nothing.
        expect(response.status).toBe(409);
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });
});

// ==================================================================
// THE CREDENTIAL STOPS HERE
// ==================================================================
describe('POST /api/auth/bus-login - what does not come back', () => {
    it('is absent from the response', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const json = await (
            await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }))
        ).json();

        expect(json.bus.password).toBeUndefined();
        expect(json.bus.passwordHash).toBeUndefined();
        expect(JSON.stringify(json)).not.toContain(storedValueA);
    });

    it('returns only what the driver client needs', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        const json = await (
            await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }))
        ).json();

        // An allow-list built field by field, so no fleet detail travels to a
        // phone just because it happened to sit on the same record.
        expect(Object.keys(json.bus).sort()).toEqual(['busId', 'numberPlate']);
        expect(json.bus.chassisNumber).toBeUndefined();
        expect(json.bus.manufacturer).toBeUndefined();
        expect(json.bus.seatCapacity).toBeUndefined();
    });

    it('is not among the token claims', async () => {
        mockGetAdminDb.mockReturnValue(fleet());

        await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }));

        // A token is stored on a device and sent with every later request; a
        // credential inside one would travel everywhere the token does.
        const claims = JSON.stringify(mockGenerateToken.mock.calls[0][0]);
        expect(claims).not.toContain(storedValueA);
        expect(mockGenerateToken.mock.calls[0][0].password).toBeUndefined();
    });

    it('is never written to the console, on success or on failure', async () => {
        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            mockGetAdminDb.mockReturnValue(fleet());
            await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }));

            mockGetAdminDb.mockImplementation(() => {
                throw new Error('Firestore unavailable');
            });
            await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }));
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        const output = logged.join('\n');
        expect(output).not.toContain(storedValueA);
        // The issued session is not logged either.
        expect(output).not.toContain(issuedSession);
    });

    it('leaves the stored fleet record untouched', async () => {
        const db = fleet();
        mockGetAdminDb.mockReturnValue(db);

        await busLogin(loginRequest({ numberPlate: PLATE_A, password: storedValueA }));

        // Signing in reads; it must not rewrite the credential or anything else.
        const stored = (await db.collection('buses').doc(BUS_A).get()).data() ?? {};
        expect(stored.password).toBe(storedValueA);
        expect(stored.numberPlate).toBe(PLATE_A);
    });
});
