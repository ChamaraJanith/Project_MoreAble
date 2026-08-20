// The whole publishing chain (MOV-265).
//
// Every part of this flow is tested on its own elsewhere. What only this file
// can show is that they join up: a real bus login issues a real token, that
// token is what the real location endpoint checks, and the busId that reaches
// the URL is the one the credentials authenticated — not one anybody typed in.
//
// The chain driven here:
//
//   numberPlate + password -> bus-login route -> token with a busId claim
//     -> publishBusLocation -> PUT /api/buses/{busId}/location -> stored
//
// Two things are substituted and nothing else. `fetch` is pointed at the route
// handler instead of a server, and the JWT module is replaced by an in-memory
// pair that encodes the claims into a token and only verifies tokens it issued.
//
// That substitution is not cosmetic and is worth being clear about: the
// cryptography is NOT exercised here, because `jose` is ESM-only and this
// project's Jest runs CommonJS — which is why every other suite stubs the same
// module. What IS exercised is claim propagation, which is what this flow
// depends on: the busId established by the credentials has to survive being
// issued as a token and read back by the location route, or the publish is
// refused.
//
// Passwords are generated at run time. Coordinates are ordinary test data.

import { POST as busLogin } from '../../../app/api/auth/bus-login+api';
import { PUT as reportLocation } from '../../../app/api/buses/[busId]/location+api';
import {
    PublishLocationError,
    publishBusLocation,
} from '../../../src/features/driver/api/busLocationApi';
import { PhoneLocation } from '../../../src/shared/utils/phoneLocation';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { buildTestPassword, buildTestToken } from '../../testUtils/testPassword';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

// PhoneLocation is a type only, but its module imports expo-location, which is
// native ESM Jest cannot load.
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

jest.mock('../../../src/shared/config/jwt', () => {
    // Only tokens this issued will verify, so a forged or unrelated one is
    // rejected exactly as a bad signature would be.
    const issued = new Map<string, Record<string, unknown>>();
    let counter = 0;

    /** A non-secret stand-in for a JWT segment, built at run time. */
    const segment = (part: string) => {
        counter += 1;
        return `${part}${counter}${Date.now().toString(36)}`;
    };

    return {
        generateToken: async (payload: Record<string, unknown>) => {
            const claims = { ...payload };
            // Three dot-separated parts, like a JWT, so the claims can be read
            // back the way production code would read them. The outer parts are
            // generated rather than written down: a literal there reads as a
            // leaked token to a secret scanner.
            const token = [
                segment('h'),
                Buffer.from(JSON.stringify(claims)).toString('base64url'),
                segment('s'),
            ].join('.');
            issued.set(token, claims);
            return token;
        },
        verifyToken: async (token: string) => issued.get(token) ?? null,
    };
});

const BUS_A = 'BUS-00003';
const BUS_B = 'BUS-00004';
const PLATE_A = 'NB-8899';
const PLATE_B = 'NC-1122';

const READING: PhoneLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

function storedBus(busId: string, numberPlate: string, password: string) {
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
        password,
    };
}

/**
 * Routes the client's `fetch` at the location handler.
 *
 * The client builds a real Request; this hands it to the real route. Every
 * request that passes through is recorded so the tests can inspect exactly what
 * left the phone.
 */
const sentRequests: { url: string; headers: Record<string, string>; body: any }[] = [];

function installLocationEndpointFetch() {
    global.fetch = (async (url: string, init: any) => {
        const busId = decodeURIComponent(String(url).split('/api/buses/')[1].split('/location')[0]);

        sentRequests.push({
            url: String(url),
            headers: init.headers,
            body: JSON.parse(init.body),
        });

        return reportLocation(
            new Request(`http://localhost${url}`, {
                method: 'PUT',
                headers: init.headers,
                body: init.body,
            }),
            { params: { busId } }
        );
    }) as unknown as typeof fetch;
}

/** Signs a bus in through the real route and returns the session it produced. */
async function signIn(numberPlate: string, password: string) {
    const response = await busLogin(
        new Request('http://localhost/api/auth/bus-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numberPlate, password }),
        })
    );

    return { status: response.status, json: await response.json() };
}

async function readStoredLocation(db: any, busId: string) {
    return (await db.collection('vehicleLocations').doc(busId).get()).data();
}

let passwordA: string;
let passwordB: string;
let db: ReturnType<typeof createFakeFirestore>;

beforeEach(() => {
    jest.clearAllMocks();
    sentRequests.length = 0;

    passwordA = buildTestPassword();
    passwordB = buildTestPassword();

    db = createFakeFirestore({
        buses: [storedBus(BUS_A, PLATE_A, passwordA), storedBus(BUS_B, PLATE_B, passwordB)],
    });

    mockGetAdminDb.mockReturnValue(db);
    installLocationEndpointFetch();
});

// ==================================================================
// THE CHAIN JOINS UP
// ==================================================================
describe('sign in, then publish', () => {
    it('stores the position against the bus the credentials authenticated', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        // The driver typed a plate and a password. Everything below uses only
        // what the backend returned for them.
        await publishBusLocation(json.bus.busId, READING, json.token);

        // toMatchObject because the fake Firestore adds its own `id` key on
        // create; the exact field set the route writes is asserted separately
        // further down.
        expect(await readStoredLocation(db, BUS_A)).toMatchObject({
            busId: BUS_A,
            latitude: 6.9061,
            longitude: 79.9558,
            recordedAt: '2026-08-20T09:05:00.000Z',
        });
        // The other bus is untouched.
        expect(await readStoredLocation(db, BUS_B)).toBeUndefined();
    });

    it('puts the authenticated busId in the URL, not the plate the driver typed', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        await publishBusLocation(json.bus.busId, READING, json.token);

        expect(sentRequests[0].url).toBe(`/api/buses/${BUS_A}/location`);
        expect(sentRequests[0].url).not.toContain(PLATE_A);
    });

    it('sends the token as a bearer credential', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        await publishBusLocation(json.bus.busId, READING, json.token);

        expect(sentRequests[0].headers.Authorization).toBe(`Bearer ${json.token}`);
    });

    it('sends only the three fields the endpoint accepts', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        await publishBusLocation(json.bus.busId, READING, json.token);

        expect(Object.keys(sentRequests[0].body).sort()).toEqual([
            'latitude',
            'longitude',
            'recordedAt',
        ]);
    });

    it('carries a busId claim from the login route through to the location route', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        // Issued by the login route and read back by the location route. If the
        // claim were dropped anywhere between them, the publish below would be
        // refused rather than silently accepted.
        await expect(
            publishBusLocation(json.bus.busId, READING, json.token)
        ).resolves.toBeUndefined();
    });

    it('replaces the previous position when the driver publishes again', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        await publishBusLocation(json.bus.busId, READING, json.token);
        await publishBusLocation(
            json.bus.busId,
            { latitude: 6.9147, longitude: 79.8778, recordedAt: '2026-08-20T09:20:00.000Z' },
            json.token
        );

        const stored = await readStoredLocation(db, BUS_A);
        expect(stored.latitude).toBe(6.9147);
        expect((await db.collection('vehicleLocations').get()).docs).toHaveLength(1);
    });
});

// ==================================================================
// ONE BUS CANNOT MOVE ANOTHER
// ==================================================================
describe('the token decides which bus may be moved', () => {
    it('refuses BUS-00003 trying to publish for BUS-00004', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        // A tampered client passing another bus's id with its own token.
        await expect(
            publishBusLocation(BUS_B, READING, json.token)
        ).rejects.toMatchObject({ reason: 'NOT_AUTHORISED' });

        // Neither bus is moved.
        expect(await readStoredLocation(db, BUS_A)).toBeUndefined();
        expect(await readStoredLocation(db, BUS_B)).toBeUndefined();
    });

    it('lets each bus publish for itself', async () => {
        const sessionA = (await signIn(PLATE_A, passwordA)).json;
        const sessionB = (await signIn(PLATE_B, passwordB)).json;

        await publishBusLocation(sessionA.bus.busId, READING, sessionA.token);
        await publishBusLocation(
            sessionB.bus.busId,
            { latitude: 6.9333, longitude: 79.9833, recordedAt: '2026-08-20T09:06:00.000Z' },
            sessionB.token
        );

        expect((await readStoredLocation(db, BUS_A)).latitude).toBe(6.9061);
        expect((await readStoredLocation(db, BUS_B)).latitude).toBe(6.9333);
    });

    it('refuses a missing token', async () => {
        await expect(publishBusLocation(BUS_A, READING, '')).rejects.toMatchObject({
            reason: 'NOT_AUTHENTICATED',
        });
        expect(await readStoredLocation(db, BUS_A)).toBeUndefined();
    });

    it('refuses a token that was not issued by this system', async () => {
        // Generated, so nothing token-shaped is written down here either.
        await expect(
            publishBusLocation(BUS_A, READING, buildTestToken())
        ).rejects.toMatchObject({ reason: 'NOT_AUTHENTICATED' });

        expect(await readStoredLocation(db, BUS_A)).toBeUndefined();
    });

    it('refuses a bus that is no longer in the fleet', async () => {
        const { json } = await signIn(PLATE_A, passwordA);
        await db.collection('buses').doc(BUS_A).delete();

        await expect(
            publishBusLocation(json.bus.busId, READING, json.token)
        ).rejects.toBeInstanceOf(PublishLocationError);
    });
});

// ==================================================================
// THE PASSWORD STOPS AT THE LOGIN ROUTE
// ==================================================================
describe('the bus password never reaches the location endpoint', () => {
    it('appears in no part of the publish request', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        await publishBusLocation(json.bus.busId, READING, json.token);

        const sent = sentRequests[0];
        const everythingSent = JSON.stringify({
            url: sent.url,
            headers: sent.headers,
            body: sent.body,
        });

        // URL, headers and body all checked, since a credential leaking into
        // any of them ends up in server logs.
        expect(everythingSent).not.toContain(passwordA);
    });

    it('is not recoverable from the session token', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        // A JWT is signed, not encrypted — anything inside it is readable by
        // whoever holds it.
        const claims = JSON.parse(
            Buffer.from(json.token.split('.')[1], 'base64url').toString('utf8')
        );

        expect(JSON.stringify(claims)).not.toContain(passwordA);
        expect(claims.busId).toBe(BUS_A);
        expect(claims.role).toBe('BUS');
    });

    it('is never stored on the vehicle location record', async () => {
        const { json } = await signIn(PLATE_A, passwordA);

        await publishBusLocation(json.bus.busId, READING, json.token);

        const stored = await readStoredLocation(db, BUS_A);
        expect(stored.password).toBeUndefined();
        expect(Object.keys(stored).sort()).toEqual([
            'busId',
            'id',
            'latitude',
            'longitude',
            'recordedAt',
        ]);
    });
});
