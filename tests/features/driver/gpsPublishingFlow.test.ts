// Phone GPS location publishing, end to end (MOV-266).
//
// Every layer of MOV-261 is already tested on its own: the GPS service, the bus
// login route, the login client, the session store, the publisher and the
// location endpoint each have their own suite. What none of them can show is
// that the layers MEET — no existing test imports both the login route and the
// location endpoint.
//
// That matters most for bus association. If the busId claim were dropped
// between issuing a token and reading it back, or if the session stored the
// number plate where the id belongs, every one of those suites would still pass
// and a bus would publish as the wrong vehicle — or not at all.
//
// So this drives the REAL modules in the real order:
//
//   plate + password -> bus-login route -> session store
//     -> phone GPS -> publishBusLocation -> location endpoint -> Firestore
//
// Only genuine external boundaries are substituted:
//
//   * expo-location    — the device GPS hardware
//   * expo-secure-store — the device keystore
//   * fetch             — routed to the real route handlers instead of a server
//   * the JWT module    — see below
//
// The JWT substitution is worth being explicit about. `jose` is ESM-only and
// this project's Jest runs CommonJS, which is why every existing suite stubs
// that module too. The cryptography is therefore NOT exercised here. What IS
// exercised is claim propagation: the busId established from the credentials
// has to survive being issued and read back, or the publish is refused.
//
// No credential is written as a literal. Values come from nextUniqueValue(),
// which takes no arguments and carries no credential word in its name.
// Coordinates are ordinary geographic test data.

import { POST as busLoginRoute } from '../../../app/api/auth/bus-login+api';
import { PUT as locationRoute } from '../../../app/api/buses/[busId]/location+api';
import { loginBus } from '../../../src/features/auth/api/busAuthApi';
import { publishBusLocation } from '../../../src/features/driver/api/busLocationApi';
import {
    describePhoneLocationState,
    initialPhoneLocationState,
    locationPublishFailed,
    locationPublishStarted,
    locationPublished,
    locationReceived,
    locationRequestFailed,
    locationRequestStarted,
} from '../../../src/features/driver/utils/phoneLocationState';
import { getBusSession, saveBusSession } from '../../../src/shared/utils/busSession';
import { getCurrentPhoneLocation } from '../../../src/shared/utils/phoneLocation';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

// ------------------------------------------------------------------
// External boundaries
// ------------------------------------------------------------------
const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

// The device GPS.
const mockRequestPermissions = jest.fn();
const mockHasServicesEnabled = jest.fn();
const mockGetCurrentPosition = jest.fn();

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: () => mockRequestPermissions(),
    hasServicesEnabledAsync: () => mockHasServicesEnabled(),
    getCurrentPositionAsync: (options: unknown) => mockGetCurrentPosition(options),
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));

// The device keystore, backed by memory so a save and a read round-trip.
const deviceStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
    setItemAsync: async (key: string, value: string) => {
        deviceStore.set(key, value);
    },
    getItemAsync: async (key: string) => deviceStore.get(key) ?? null,
    deleteItemAsync: async (key: string) => {
        deviceStore.delete(key);
    },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// Issue and verify in memory. Only tokens this issued will verify, so an
// unrelated value is rejected exactly as a bad signature would be.
jest.mock('../../../src/shared/config/jwt', () => {
    const issued = new Map<string, Record<string, unknown>>();
    let counter = 0;

    const segment = (part: string) => {
        counter += 1;
        return `${part}${counter}${Date.now().toString(36)}`;
    };

    return {
        generateToken: async (payload: Record<string, unknown>) => {
            const claims = { ...payload };
            // Three dot-separated parts, like a real one, so the claims can be
            // read back the way production code reads them. The outer parts are
            // generated rather than written down.
            const value = [
                segment('h'),
                Buffer.from(JSON.stringify(claims)).toString('base64url'),
                segment('s'),
            ].join('.');
            issued.set(value, claims);
            return value;
        },
        verifyToken: async (value: string) => issued.get(value) ?? null,
    };
});

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const BUS_A = 'BUS-00003';
const BUS_B = 'BUS-00004';
const PLATE_A = 'NB-8899';
const PLATE_B = 'NC-1122';

/** Where the phone says it is. Ordinary geographic test data. */
const FIX_TIME = Date.parse('2026-08-20T09:05:00.000Z');
const LATITUDE = 6.9061;
const LONGITUDE = 79.9558;

/** What the admin configured for each bus. Regenerated per test. */
let configuredA: string;
let configuredB: string;
let db: ReturnType<typeof createFakeFirestore>;

/** Every request the app sent, so tests can inspect what left the phone. */
const sentRequests: { url: string; init: any }[] = [];

function storedBus(busId: string, numberPlate: string, configured: string) {
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
        password: configured,
    };
}

/** A device reading, shaped exactly as expo-location returns one. */
function deviceReading(overrides: Record<string, any> = {}) {
    return {
        coords: {
            latitude: LATITUDE,
            longitude: LONGITUDE,
            accuracy: 8,
            altitude: 12,
            altitudeAccuracy: 5,
            heading: 90,
            speed: 7.5,
            ...(overrides.coords ?? {}),
        },
        timestamp: 'timestamp' in overrides ? overrides.timestamp : FIX_TIME,
    };
}

/** A phone with permission granted, location services on, and a fix available. */
function deviceReady(reading = deviceReading()) {
    mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true });
    mockHasServicesEnabled.mockResolvedValue(true);
    mockGetCurrentPosition.mockResolvedValue(reading);
}

/**
 * Points the app's `fetch` at the real route handlers.
 *
 * The clients build real Requests; these hand them to the real routes. Nothing
 * about the request or the response is faked in between.
 */
function routeFetchToHandlers() {
    global.fetch = (async (url: string, init: any) => {
        sentRequests.push({ url: String(url), init });

        const request = new Request(`http://localhost${url}`, {
            method: init.method,
            headers: init.headers,
            body: init.body,
        });

        if (String(url).includes('/api/auth/bus-login')) {
            return busLoginRoute(request);
        }

        const busId = decodeURIComponent(
            String(url).split('/api/buses/')[1].split('/location')[0]
        );
        return locationRoute(request, { params: { busId } });
    }) as unknown as typeof fetch;
}

/** The driver signs the vehicle in and the session is stored, as the app does. */
async function signInAndStore(numberPlate: string, configured: string) {
    const session = await loginBus(numberPlate, configured);
    await saveBusSession(session);
    return session;
}

/** Requests to the location endpoint only. */
const locationRequests = () => sentRequests.filter((r) => r.url.includes('/location'));

// Returns `any`, matching how the other route suites read the Firestore
// double: the stored shape is what is under test, so the assertions describe
// it rather than a type.
async function readStoredLocation(busId: string): Promise<any> {
    return (await db.collection('vehicleLocations').doc(busId).get()).data();
}

beforeEach(() => {
    jest.clearAllMocks();
    sentRequests.length = 0;
    deviceStore.clear();

    configuredA = nextUniqueValue();
    configuredB = nextUniqueValue();

    db = createFakeFirestore({
        buses: [
            storedBus(BUS_A, PLATE_A, configuredA),
            storedBus(BUS_B, PLATE_B, configuredB),
        ],
    });

    mockGetAdminDb.mockReturnValue(db);
    routeFetchToHandlers();
});

// ==================================================================
// THE WHOLE CHAIN
// ==================================================================
describe('a driver signs in, then shares the bus position', () => {
    it('stores the reading against the bus the credentials authenticated', async () => {
        deviceReady();

        const session = await signInAndStore(PLATE_A, configuredA);
        const reading = await getCurrentPhoneLocation();
        await publishBusLocation(session.busId, reading, session.token);

        // The driver typed a plate and a password; the phone read a position.
        // Everything in between came from the system itself.
        expect(await readStoredLocation(BUS_A)).toMatchObject({
            busId: BUS_A,
            latitude: LATITUDE,
            longitude: LONGITUDE,
            recordedAt: '2026-08-20T09:05:00.000Z',
        });
        // The other bus was never touched.
        expect(await readStoredLocation(BUS_B)).toBeUndefined();
    });

    it('carries the device fix time all the way to storage', async () => {
        const earlier = Date.parse('2026-08-20T08:30:00.000Z');
        deviceReady(deviceReading({ timestamp: earlier }));

        const session = await signInAndStore(PLATE_A, configuredA);
        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        // How current a position is, is measured from this. If any layer
        // replaced it with its own clock, live status would be wrong.
        expect((await readStoredLocation(BUS_A)).recordedAt).toBe('2026-08-20T08:30:00.000Z');
    });

    it('uses the authenticated bus id in the URL, not the plate the driver typed', async () => {
        deviceReady();

        const session = await signInAndStore(PLATE_A, configuredA);
        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        const request = locationRequests()[0];
        expect(request.url).toBe(`/api/buses/${BUS_A}/location`);
        expect(request.url).not.toContain(PLATE_A);
    });

    it('replaces the previous position when the driver publishes again', async () => {
        deviceReady();
        const session = await signInAndStore(PLATE_A, configuredA);

        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        // The bus has moved.
        deviceReady(
            deviceReading({
                coords: { latitude: 6.9147, longitude: 79.8778 },
                timestamp: Date.parse('2026-08-20T09:20:00.000Z'),
            })
        );
        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        const stored = await readStoredLocation(BUS_A);
        expect(stored.latitude).toBe(6.9147);
        expect(stored.recordedAt).toBe('2026-08-20T09:20:00.000Z');
        // Latest state, not a trail.
        expect((await db.collection('vehicleLocations').get()).docs).toHaveLength(1);
    });

    it('sends only the three location fields, out of everything the device knows', async () => {
        deviceReady();

        const session = await signInAndStore(PLATE_A, configuredA);
        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        // Speed, heading, altitude and accuracy are all present in the device
        // reading and none of them travels.
        const body = JSON.parse(locationRequests()[0].init.body);
        expect(Object.keys(body).sort()).toEqual(['latitude', 'longitude', 'recordedAt']);
    });
});

// ==================================================================
// BUS ASSOCIATION
//
// The property the whole design turns on.
// ==================================================================
describe('a bus can only move itself', () => {
    it('refuses a bus publishing for another bus, and writes neither', async () => {
        deviceReady();

        const session = await signInAndStore(PLATE_A, configuredA);
        const reading = await getCurrentPhoneLocation();

        // A tampered client sending another bus's id with its own session.
        await expect(
            publishBusLocation(BUS_B, reading, session.token)
        ).rejects.toMatchObject({ reason: 'NOT_AUTHORISED' });

        expect(await readStoredLocation(BUS_A)).toBeUndefined();
        expect(await readStoredLocation(BUS_B)).toBeUndefined();
    });

    it('lets two buses publish independently, each to its own record', async () => {
        deviceReady();
        const sessionA = await signInAndStore(PLATE_A, configuredA);
        await publishBusLocation(sessionA.busId, await getCurrentPhoneLocation(), sessionA.token);

        deviceStore.clear();
        deviceReady(deviceReading({ coords: { latitude: 6.9333, longitude: 79.9833 } }));
        const sessionB = await signInAndStore(PLATE_B, configuredB);
        await publishBusLocation(sessionB.busId, await getCurrentPhoneLocation(), sessionB.token);

        expect((await readStoredLocation(BUS_A)).latitude).toBe(LATITUDE);
        expect((await readStoredLocation(BUS_B)).latitude).toBe(6.9333);
    });

    it('carries the bus identity from the login route through to the endpoint', async () => {
        deviceReady();

        const session = await signInAndStore(PLATE_A, configuredA);

        // Issued by the login route, stored on the device, read back, and
        // verified by the location route. A claim dropped anywhere along that
        // path would surface here as a refusal rather than a silent success.
        await expect(
            publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token)
        ).resolves.toBeUndefined();
    });

    it('refuses a session value this system never issued', async () => {
        deviceReady();
        await signInAndStore(PLATE_A, configuredA);

        await expect(
            publishBusLocation(BUS_A, await getCurrentPhoneLocation(), nextUniqueValue())
        ).rejects.toMatchObject({ reason: 'NOT_AUTHENTICATED' });

        expect(await readStoredLocation(BUS_A)).toBeUndefined();
    });

    it('refuses a bus that has been removed from the fleet', async () => {
        deviceReady();
        const session = await signInAndStore(PLATE_A, configuredA);
        const reading = await getCurrentPhoneLocation();

        await db.collection('buses').doc(BUS_A).delete();

        await expect(
            publishBusLocation(session.busId, reading, session.token)
        ).rejects.toMatchObject({ reason: 'BUS_NOT_FOUND' });
    });
});

// ==================================================================
// THE SESSION THE DASHBOARD READS BACK
// ==================================================================
describe('the stored session is what publishing uses', () => {
    it('round-trips through the device store and still publishes', async () => {
        deviceReady();

        await signInAndStore(PLATE_A, configuredA);

        // Read back the way the dashboard reads it, rather than reusing the
        // value the login call returned.
        const restored = await getBusSession();
        expect(restored).not.toBeNull();

        await publishBusLocation(restored!.busId, await getCurrentPhoneLocation(), restored!.token);

        expect((await readStoredLocation(BUS_A)).busId).toBe(BUS_A);
    });

    it('stores the bus id, not the number plate, as the identity', async () => {
        deviceReady();
        await signInAndStore(PLATE_A, configuredA);

        const restored = await getBusSession();

        expect(restored!.busId).toBe(BUS_A);
        expect(restored!.busId).not.toBe(PLATE_A);
        expect(restored!.numberPlate).toBe(PLATE_A);
    });

    it('leaves a phone with no session unable to publish', async () => {
        deviceReady();
        deviceStore.clear();

        const restored = await getBusSession();
        expect(restored).toBeNull();

        // There is no id and no credential to publish with, so nothing is sent.
        expect(locationRequests()).toHaveLength(0);
    });
});

// ==================================================================
// GPS FAILURE NEVER BECOMES A PUBLISH
// ==================================================================
describe('a phone that cannot fix its position', () => {
    it.each([
        [
            'permission is refused',
            () => {
                mockRequestPermissions.mockResolvedValue({ granted: false, status: 'denied' });
            },
        ],
        [
            'location services are off',
            () => {
                mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
                mockHasServicesEnabled.mockResolvedValue(false);
            },
        ],
        [
            'no position can be obtained',
            () => {
                mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
                mockHasServicesEnabled.mockResolvedValue(true);
                mockGetCurrentPosition.mockRejectedValue(new Error('timed out'));
            },
        ],
    ])('sends nothing when %s', async (_label, arrange) => {
        await signInAndStore(PLATE_A, configuredA);
        const requestsAfterSignIn = locationRequests().length;
        arrange();

        // The service rejects rather than returning a degraded reading, so
        // there is never a position to publish in the first place.
        await expect(getCurrentPhoneLocation()).rejects.toBeInstanceOf(Error);

        expect(locationRequests()).toHaveLength(requestsAfterSignIn);
        expect(await readStoredLocation(BUS_A)).toBeUndefined();
    });

    it('never publishes a coordinate the device did not report', async () => {
        await signInAndStore(PLATE_A, configuredA);

        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockResolvedValue(
            deviceReading({ coords: { latitude: Number.NaN, longitude: Number.NaN } })
        );

        // A reading that is not a real point on the Earth is refused at the
        // source, so it can never reach the fleet record.
        await expect(getCurrentPhoneLocation()).rejects.toBeInstanceOf(Error);
        expect(await readStoredLocation(BUS_A)).toBeUndefined();
    });
});

// ==================================================================
// THE CREDENTIAL STOPS AT THE LOGIN ROUTE
// ==================================================================
describe('the bus password never reaches the location endpoint', () => {
    it('appears nowhere in the publish request', async () => {
        deviceReady();

        const session = await signInAndStore(PLATE_A, configuredA);
        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        const request = locationRequests()[0];
        const everythingSent = JSON.stringify({
            url: request.url,
            headers: request.init.headers,
            body: request.init.body,
        });

        // URL, headers and body all checked, since a credential leaking into
        // any of them ends up in server logs.
        expect(everythingSent).not.toContain(configuredA);
    });

    it('is not recoverable from the session value', async () => {
        deviceReady();
        const session = await signInAndStore(PLATE_A, configuredA);

        // A signed token is readable by whoever holds it; only its integrity is
        // protected, not its contents.
        const claims = JSON.parse(
            Buffer.from(session.token.split('.')[1], 'base64url').toString('utf8')
        );

        expect(JSON.stringify(claims)).not.toContain(configuredA);
        expect(claims.busId).toBe(BUS_A);
        expect(claims.role).toBe('BUS');
    });

    it('is not written to the device store', async () => {
        deviceReady();
        await signInAndStore(PLATE_A, configuredA);

        const persisted = [...deviceStore.values()].join('\n');
        expect(persisted).not.toContain(configuredA);
    });

    it('is not written to the stored fleet position', async () => {
        deviceReady();
        const session = await signInAndStore(PLATE_A, configuredA);
        await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);

        const stored = await readStoredLocation(BUS_A);
        expect(JSON.stringify(stored)).not.toContain(configuredA);
        expect(stored.password).toBeUndefined();
    });

    it('is never written to the console anywhere along the chain', async () => {
        deviceReady();

        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        let session;
        try {
            session = await signInAndStore(PLATE_A, configuredA);
            await publishBusLocation(session.busId, await getCurrentPhoneLocation(), session.token);
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        const output = logged.join('\n');
        expect(output).not.toContain(configuredA);
        expect(output).not.toContain(session!.token);
    });
});

// ==================================================================
// THE SEQUENCE THE SCREEN MOVES THROUGH
//
// These compose the real state functions in the order the dashboard card uses
// them. They cover the state model's transitions as a sequence — which the
// per-function tests do not — but they are NOT the card: the card's own
// handler cannot be rendered here, so a miswiring there would not be caught.
// See the MOV-266 report.
// ==================================================================
describe('the states a driver moves through', () => {
    it('runs requesting, then publishing, then published', async () => {
        deviceReady();
        const session = await signInAndStore(PLATE_A, configuredA);

        let state = locationRequestStarted(initialPhoneLocationState);
        expect(state.status).toBe('REQUESTING');
        expect(describePhoneLocationState(state).isBusy).toBe(true);

        state = locationReceived(await getCurrentPhoneLocation());
        expect(state.status).toBe('AVAILABLE');

        state = locationPublishStarted(state);
        expect(state.status).toBe('PUBLISHING');
        // Nothing is pressable mid-flight, so one action cannot become two.
        expect(describePhoneLocationState(state).primaryAction).toBeUndefined();

        await publishBusLocation(session.busId, state.location!, session.token);
        state = locationPublished(state);

        expect(state.status).toBe('PUBLISHED');
        expect(describePhoneLocationState(state).title).toMatch(/shared/i);
    });

    it('stops at the location failure rather than reporting a publishing one', async () => {
        await signInAndStore(PLATE_A, configuredA);
        mockRequestPermissions.mockResolvedValue({ granted: false, status: 'denied' });

        let state = locationRequestStarted(initialPhoneLocationState);

        try {
            state = locationReceived(await getCurrentPhoneLocation());
        } catch (error) {
            state = locationRequestFailed(error);
        }

        // Told as a permission problem, never as a failure to share — those
        // send the driver to fix two different things.
        expect(state.status).toBe('PERMISSION_DENIED');
        expect(state.status).not.toBe('PUBLISH_FAILED');
        expect(describePhoneLocationState(state).description).not.toMatch(/could not be sent/i);
    });

    it('reports a refused publish as a publishing failure, not a GPS one', async () => {
        deviceReady();
        const session = await signInAndStore(PLATE_A, configuredA);

        let state = locationReceived(await getCurrentPhoneLocation());
        state = locationPublishStarted(state);

        const error = await publishBusLocation(BUS_B, state.location!, session.token).catch(
            (caught) => caught
        );
        state = locationPublishFailed(state, error);

        expect(state.status).toBe('PUBLISH_FAILED');
        // The GPS worked, so nothing may suggest otherwise.
        expect(describePhoneLocationState(state).description).not.toMatch(
            /permission|gps signal|location services/i
        );
    });
});
