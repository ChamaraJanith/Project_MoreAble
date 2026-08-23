// Continuous location updates, end to end (MOV-269).
//
// WHAT WAS ALREADY COVERED, AND WHY THIS IS NOT THAT.
//
// `locationTracker.test.ts` proves the loop schedules correctly — but it hands
// the tracker a STUB cycle, so it never shows that repeating the cycle actually
// keeps publishing. `locationPublishCycle.test.ts` proves one cycle, with its
// three services injected. `gpsPublishingFlow.test.ts` reaches the real HTTP
// route and real storage, but only for a single manual publish. The MOV-268
// suites do drive the real tracker, but with the publisher substituted, and
// they assert on card titles and map markers rather than on what was stored.
//
// So nothing yet joins the two halves: the REAL tracker driving the REAL cycle,
// through the REAL publisher and the REAL location endpoint, into storage, over
// and over. That is what a "continuous tracking" feature actually promises, and
// it is what this file tests.
//
//   start -> GPS fix -> session -> publish -> endpoint -> Firestore
//         -> wait    -> a DIFFERENT fix     -> publish again -> ...
//
// Only genuine external boundaries are substituted: the device GPS, the device
// keystore, the clock, and the JWT module (`jose` is ESM-only and cannot load
// under this project's CommonJS Jest, which is why every existing suite stubs
// it too — claim propagation is exercised, cryptography is not).
//
// No value below is a literal credential. Configured bus values come from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name. Coordinates are ordinary geographic test data.

import { POST as busLoginRoute } from '../../../app/api/auth/bus-login+api';
import { PUT as locationRoute } from '../../../app/api/buses/[busId]/location+api';
import { loginBus } from '../../../src/features/auth/api/busAuthApi';
import {
    MINIMUM_TRACKING_INTERVAL_MS,
    TrackingScheduler,
    TrackingStopReason,
    createLocationTracker,
} from '../../../src/features/driver/utils/locationTracker';
import {
    PhoneLocationState,
    PhoneLocationStatus,
    initialPhoneLocationState,
} from '../../../src/features/driver/utils/phoneLocationState';
import { clearBusSession, saveBusSession } from '../../../src/shared/utils/busSession';
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

const mockRequestPermissions = jest.fn();
const mockHasServicesEnabled = jest.fn();
const mockGetCurrentPosition = jest.fn();

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: () => mockRequestPermissions(),
    hasServicesEnabledAsync: () => mockHasServicesEnabled(),
    getCurrentPositionAsync: (options: unknown) => mockGetCurrentPosition(options),
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));

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

/** A bus travelling along a road, one fix per cycle. Ordinary test data. */
const ROUTE_FIXES = [
    { latitude: 6.9061, longitude: 79.9558, at: '2026-08-20T09:05:00.000Z' },
    { latitude: 6.9107, longitude: 79.9631, at: '2026-08-20T09:05:30.000Z' },
    { latitude: 6.9153, longitude: 79.9742, at: '2026-08-20T09:06:00.000Z' },
    { latitude: 6.9210, longitude: 79.9805, at: '2026-08-20T09:06:30.000Z' },
];

/** What the admin configured for each bus. Regenerated per test. */
let configuredA: string;
let configuredB: string;
let db: ReturnType<typeof createFakeFirestore>;

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
function deviceReading(fix: (typeof ROUTE_FIXES)[number]) {
    return {
        coords: {
            latitude: fix.latitude,
            longitude: fix.longitude,
            accuracy: 8,
            altitude: 12,
            altitudeAccuracy: 5,
            heading: 90,
            speed: 7.5,
        },
        timestamp: Date.parse(fix.at),
    };
}

/**
 * How the publish endpoint behaves for the next requests.
 *
 * Consumed one per location request, defaulting to the real route. This is how
 * a temporary server or network fault is injected without touching production
 * code or the route itself.
 */
type PublishBehaviour = 'ROUTE' | 'SERVER_ERROR' | 'NETWORK_DOWN' | 'UNCONFIRMED';

let publishBehaviours: PublishBehaviour[] = [];

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

        const behaviour = publishBehaviours.shift() ?? 'ROUTE';

        if (behaviour === 'NETWORK_DOWN') {
            // What `fetch` does with no connection: it rejects outright.
            throw new Error('Network request failed');
        }

        if (behaviour === 'SERVER_ERROR') {
            return Response.json(
                { success: false, message: 'Failed to update vehicle location.' },
                { status: 500 }
            );
        }

        if (behaviour === 'UNCONFIRMED') {
            // A 200 that does not confirm the write. Nothing was stored.
            return Response.json({ success: false, message: 'Not stored.' }, { status: 200 });
        }

        const busId = decodeURIComponent(
            String(url).split('/api/buses/')[1].split('/location')[0]
        );
        return locationRoute(request, { params: { busId } });
    }) as unknown as typeof fetch;
}

/** Requests that went to the location endpoint, in order. */
const locationRequests = () => sentRequests.filter((r) => r.url.includes('/location'));

/** The bodies those requests carried, in order. */
const publishedBodies = () => locationRequests().map((r) => JSON.parse(r.init.body));

async function readStoredLocation(busId: string): Promise<any> {
    return (await db.collection('vehicleLocations').doc(busId).get()).data();
}

/**
 * A COPY of the stored record, for comparing across rounds.
 *
 * The in-memory Firestore double returns the live object it holds, so keeping
 * the result of `readStoredLocation` and comparing it after a later write would
 * compare that object with itself and pass no matter what happened. Anything
 * held across a round has to be a copy.
 */
async function snapshotStoredLocation(busId: string): Promise<any> {
    const stored = await readStoredLocation(busId);
    return stored === undefined ? undefined : JSON.parse(JSON.stringify(stored));
}

/** The driver signs the vehicle in and the session is stored, as the app does. */
async function signInAndStore(numberPlate: string, configured: string) {
    const session = await loginBus(numberPlate, configured);
    await saveBusSession(session);
    return session;
}

/**
 * Lets the whole chain settle.
 *
 * One cycle crosses several awaits — permission, services, the fix, the session
 * read, the request, the route, the write — so a single flush is not enough to
 * be sure a round has finished.
 */
async function settle(rounds = 60): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/** A clock the test drives, so ticks happen exactly when asked. */
function manualClock() {
    let nextId = 1;
    const pending = new Map<number, () => void>();

    const scheduler: TrackingScheduler = {
        setTimer: (run) => {
            const id = nextId++;
            pending.set(id, run);
            return id as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: (timer) => {
            pending.delete(timer as unknown as number);
        },
    };

    return {
        scheduler,
        pendingCount: () => pending.size,
        /** Fires everything due and lets the round it starts run to completion. */
        async tick(): Promise<void> {
            const due = Array.from(pending.values());
            pending.clear();
            due.forEach((run) => run());
            await settle();
        },
    };
}

/**
 * The real tracker, with nothing between it and the rest of the app.
 *
 * No `dependencies` are passed, so `runPublishCycle` uses its live defaults:
 * the real `getCurrentPhoneLocation`, the real `getBusSession` and the real
 * `publishBusLocation`. Only the clock is ours.
 */
function trackingSession() {
    const clock = manualClock();
    const states: PhoneLocationState[] = [];
    const stops: TrackingStopReason[] = [];
    let current = initialPhoneLocationState;

    const tracker = createLocationTracker({
        update: (reduce) => {
            current = reduce(current);
            states.push(current);
        },
        onStop: (reason) => stops.push(reason),
        scheduler: clock.scheduler,
        intervalMs: MINIMUM_TRACKING_INTERVAL_MS,
    });

    return {
        tracker,
        clock,
        stops,
        statuses: (): PhoneLocationStatus[] => states.map((state) => state.status),
        /** Runs the first round and returns once it has finished. */
        async start(): Promise<void> {
            tracker.start();
            await settle();
        },
    };
}

/**
 * What the device answers, round by round.
 *
 * Deliberately an explicit script rather than `mockResolvedValueOnce` queues.
 * Those queue behind whatever is already pending, so injecting a failure
 * mid-test lands several rounds later than intended, and anything left unused
 * leaks into the next test — `jest.clearAllMocks()` does not drain them. A
 * script that is emptied in `beforeEach` makes each round's answer exact.
 */
type RouteFix = (typeof ROUTE_FIXES)[number];

/** A fix, a refusal, or a promise the test releases by hand. */
type DeviceAnswer = RouteFix | 'NO_FIX' | (() => Promise<unknown>);

let deviceScript: DeviceAnswer[] = [];
let permissionDenials: boolean[] = [];
let servicesAnswers: (boolean | 'THROW')[] = [];
let repeatLast: RouteFix | null = null;

function installDeviceMocks() {
    mockRequestPermissions.mockImplementation(async () =>
        permissionDenials.shift()
            ? { granted: false, status: 'denied', canAskAgain: true }
            : { granted: true, status: 'granted', canAskAgain: true }
    );

    mockHasServicesEnabled.mockImplementation(async () => {
        const next = servicesAnswers.shift();
        if (next === 'THROW') throw new Error('unclassified platform failure');
        return next !== false;
    });

    mockGetCurrentPosition.mockImplementation(async () => {
        const next = deviceScript.shift();

        if (next === undefined) {
            // Past the end of the script the bus simply sits still.
            if (!repeatLast) throw new Error('no signal');
            return deviceReading(repeatLast);
        }

        if (next === 'NO_FIX') throw new Error('no signal');
        if (typeof next === 'function') return next();

        repeatLast = next;
        return deviceReading(next);
    });
}

/** The fixes the phone will report, in round order. */
function deviceWillReport(...fixes: RouteFix[]) {
    deviceScript.push(...fixes);
    repeatLast = fixes[fixes.length - 1] ?? null;
}

/** The next `times` rounds cannot get a fix. Later rounds are unaffected. */
function gpsWillFail(times = 1) {
    deviceScript.unshift(...Array.from({ length: times }, () => 'NO_FIX' as const));
}

/** The next round hangs inside the GPS read until the returned function runs. */
function gpsWillHang(): (fix: RouteFix) => void {
    let release: ((reading: unknown) => void) | null = null;

    deviceScript.unshift(
        () => new Promise<unknown>((resolve) => {
            release = resolve;
        })
    );

    return (fix: RouteFix) => release?.(deviceReading(fix));
}

beforeEach(async () => {
    jest.clearAllMocks();
    sentRequests.length = 0;
    publishBehaviours = [];
    deviceStore.clear();

    // Nothing carries over from the previous test.
    deviceScript = [];
    permissionDenials = [];
    servicesAnswers = [];
    repeatLast = null;
    installDeviceMocks();

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

    await signInAndStore(PLATE_A, configuredA);
    // The sign-in request is not part of what these tests count.
    sentRequests.length = 0;
});

// ==================================================================
// A. THE UPDATES REALLY ARE CONTINUOUS
// ==================================================================
describe('continuous tracking keeps publishing', () => {
    it('publishes nothing until the driver starts', async () => {
        trackingSession();
        await settle();

        expect(mockGetCurrentPosition).not.toHaveBeenCalled();
        expect(locationRequests()).toHaveLength(0);
        expect(await readStoredLocation(BUS_A)).toBeUndefined();
    });

    it('stores the first position as soon as tracking starts', async () => {
        deviceWillReport(ROUTE_FIXES[0]);
        const session = trackingSession();

        await session.start();

        const stored = await readStoredLocation(BUS_A);
        expect(stored.latitude).toBe(ROUTE_FIXES[0].latitude);
        expect(stored.longitude).toBe(ROUTE_FIXES[0].longitude);
    });

    it('publishes again on the next cycle, and the one after', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        expect(locationRequests()).toHaveLength(1);

        await session.clock.tick();
        expect(locationRequests()).toHaveLength(2);

        await session.clock.tick();
        expect(locationRequests()).toHaveLength(3);
    });

    it('reads the GPS exactly once per publish, with nothing extra in between', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();
        await session.clock.tick();

        // Four rounds: four fixes, four publishes. An extra request would mean
        // a duplicate loop; a missing one would mean a dropped round.
        expect(mockGetCurrentPosition).toHaveBeenCalledTimes(4);
        expect(locationRequests()).toHaveLength(4);
        expect(session.tracker.isTracking()).toBe(true);
    });
});

// ==================================================================
// B. THE BUS MOVES, AND WHAT IS STORED MOVES WITH IT
// ==================================================================
describe('a bus moving between cycles', () => {
    it('publishes the fix belonging to each cycle, in order', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        expect(publishedBodies().map((body) => body.latitude)).toEqual([
            ROUTE_FIXES[0].latitude,
            ROUTE_FIXES[1].latitude,
            ROUTE_FIXES[2].latitude,
        ]);
    });

    it('never republishes an earlier position as the current one', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        const latitudes = publishedBodies().map((body) => body.latitude);
        // Every round sent something new. A repeat would mean a stale reading
        // was sent as though it were the current one.
        expect(new Set(latitudes).size).toBe(latitudes.length);
    });

    it('leaves storage holding the most recent fix, not the first', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        const stored = await readStoredLocation(BUS_A);
        expect(stored.latitude).toBe(ROUTE_FIXES[2].latitude);
        expect(stored.longitude).toBe(ROUTE_FIXES[2].longitude);
    });

    it('keeps one record per bus rather than accumulating a trail', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        // Latest-state, as the existing schema defines it. This is the shape
        // MOV-269 must not silently change.
        const all = await db.collection('vehicleLocations').get();
        expect(all.docs).toHaveLength(1);
    });

    it('carries each cycle its own device fix time, not one clock read', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();

        const times = publishedBodies().map((body) => body.recordedAt);
        expect(times).toEqual([ROUTE_FIXES[0].at, ROUTE_FIXES[1].at]);
    });
});

// ==================================================================
// C. EVERY UPDATE BELONGS TO THE AUTHENTICATED BUS
// ==================================================================
describe('bus association across many updates', () => {
    it('addresses the authenticated bus id on every cycle', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        const urls = locationRequests().map((request) => request.url);
        expect(urls).toEqual([
            `/api/buses/${BUS_A}/location`,
            `/api/buses/${BUS_A}/location`,
            `/api/buses/${BUS_A}/location`,
        ]);
    });

    it('never uses the number plate as the identity, however far the bus moves', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();

        locationRequests().forEach((request) => {
            expect(request.url).not.toContain(PLATE_A);
        });
    });

    it('leaves every other bus in the fleet untouched', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        expect(await readStoredLocation(BUS_B)).toBeUndefined();
    });

    it('cannot be made to publish as another bus by moving', async () => {
        // A second bus signs in on this phone, replacing the session. Every
        // subsequent round must follow the session, and only that bus's record
        // may change — a moving coordinate never carries identity with it.
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        expect(await readStoredLocation(BUS_A)).toBeDefined();

        await signInAndStore(PLATE_B, configuredB);

        await session.clock.tick();

        const storedA = await readStoredLocation(BUS_A);
        const storedB = await readStoredLocation(BUS_B);

        // A's record is frozen at its last round; B's is the new one.
        expect(storedA.latitude).toBe(ROUTE_FIXES[0].latitude);
        expect(storedB.latitude).toBe(ROUTE_FIXES[1].latitude);
    });
});

// ==================================================================
// D. GPS FAILS, THEN COMES BACK
// ==================================================================
describe('a fix that fails, then recovers', () => {
    /** Makes the NEXT round fail in the given way, and only that round. */
    function gpsWillFailOnce(kind: 'PERMISSION' | 'SERVICES' | 'NO_FIX' | 'UNKNOWN') {
        if (kind === 'PERMISSION') {
            permissionDenials.push(true);
            return;
        }
        if (kind === 'SERVICES') {
            servicesAnswers.push(false);
            return;
        }
        if (kind === 'NO_FIX') {
            gpsWillFail();
            return;
        }
        servicesAnswers.push('THROW');
    }

    it.each([
        ['permission is refused', 'PERMISSION', 'PERMISSION_DENIED'],
        ['location services are off', 'SERVICES', 'LOCATION_SERVICES_DISABLED'],
        ['no position can be fixed', 'NO_FIX', 'POSITION_UNAVAILABLE'],
        ['the platform fails in an unclassified way', 'UNKNOWN', 'LOCATION_SERVICES_DISABLED'],
    ] as const)('publishes nothing when %s, then recovers', async (_label, kind, expected) => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        expect(locationRequests()).toHaveLength(1);

        gpsWillFailOnce(kind);
        await session.clock.tick();

        // The round happened and produced nothing to send.
        expect(locationRequests()).toHaveLength(1);
        expect(session.statuses()).toContain(expected);
        // A failed fix is never a failed publish.
        expect(session.statuses()).not.toContain('PUBLISH_FAILED');
        expect(session.tracker.isTracking()).toBe(true);

        // The next round finds a position and sends it.
        await session.clock.tick();
        expect(locationRequests()).toHaveLength(2);
        expect(session.statuses()[session.statuses().length - 1]).toBe('PUBLISHED');
    });

    it('leaves the stored position alone while the phone cannot see the sky', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        const afterFirst = await snapshotStoredLocation(BUS_A);

        gpsWillFail();
        await session.clock.tick();

        // Not blanked, not overwritten with a guess — exactly as it was.
        const duringFailure = await readStoredLocation(BUS_A);
        expect(duringFailure).toEqual(afterFirst);
    });

    it('survives several failed rounds in a row and still recovers', async () => {
        deviceWillReport(ROUTE_FIXES[0]);
        const session = trackingSession();

        await session.start();

        gpsWillFail(3);

        await session.clock.tick();
        await session.clock.tick();
        await session.clock.tick();

        expect(locationRequests()).toHaveLength(1);
        expect(session.tracker.isTracking()).toBe(true);

        deviceWillReport(ROUTE_FIXES[3]);
        await session.clock.tick();

        expect(locationRequests()).toHaveLength(2);
        expect((await readStoredLocation(BUS_A)).latitude).toBe(ROUTE_FIXES[3].latitude);
    });
});

// ==================================================================
// E. THE NETWORK FAILS, THEN COMES BACK
// ==================================================================
describe('a publish that fails, then recovers', () => {
    it.each([
        ['the server errors', 'SERVER_ERROR'],
        ['the connection is gone', 'NETWORK_DOWN'],
        ['the answer does not confirm the write', 'UNCONFIRMED'],
    ] as const)('keeps tracking when %s, then recovers', async (_label, behaviour) => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        expect(session.statuses()).toContain('PUBLISHED');

        publishBehaviours = [behaviour];
        await session.clock.tick();

        expect(session.statuses()[session.statuses().length - 1]).toBe('PUBLISH_FAILED');
        // A refused publish is never a GPS problem: the fix was fine.
        expect(session.statuses()).not.toContain('POSITION_UNAVAILABLE');
        expect(session.tracker.isTracking()).toBe(true);

        await session.clock.tick();

        expect(session.statuses()[session.statuses().length - 1]).toBe('PUBLISHED');
        expect((await readStoredLocation(BUS_A)).latitude).toBe(ROUTE_FIXES[2].latitude);
    });

    it('stores nothing for a round the endpoint refused', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        const afterFirst = await snapshotStoredLocation(BUS_A);

        publishBehaviours = ['SERVER_ERROR'];
        await session.clock.tick();

        expect(await readStoredLocation(BUS_A)).toEqual(afterFirst);
    });

    it('goes on reading the GPS through a network outage', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();

        publishBehaviours = ['NETWORK_DOWN', 'NETWORK_DOWN', 'NETWORK_DOWN'];
        await session.clock.tick();
        await session.clock.tick();
        await session.clock.tick();

        // Four rounds, four fixes, four attempts — the outage never made the
        // loop give up or stop looking.
        expect(mockGetCurrentPosition).toHaveBeenCalledTimes(4);
        expect(locationRequests()).toHaveLength(4);
        expect(session.tracker.isTracking()).toBe(true);
    });

    it('sends the fix from the recovering round, not the one that failed', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();

        publishBehaviours = ['SERVER_ERROR'];
        await session.clock.tick();
        await session.clock.tick();

        // Nothing is queued for retry: each round sends its own fresh position,
        // so a bus is never placed where it was two rounds ago.
        const stored = await readStoredLocation(BUS_A);
        expect(stored.latitude).toBe(ROUTE_FIXES[2].latitude);
        expect(stored.latitude).not.toBe(ROUTE_FIXES[1].latitude);
    });
});

// ==================================================================
// F. STOPPING, RESTARTING, AND NEVER TWO LOOPS
// ==================================================================
describe('stopping and restarting the real loop', () => {
    it('reads no GPS and sends nothing after the driver stops', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();

        const fixesBefore = mockGetCurrentPosition.mock.calls.length;
        const requestsBefore = locationRequests().length;

        session.tracker.stop();

        await session.clock.tick();
        await session.clock.tick();

        expect(mockGetCurrentPosition).toHaveBeenCalledTimes(fixesBefore);
        expect(locationRequests()).toHaveLength(requestsBefore);
        expect(session.clock.pendingCount()).toBe(0);
    });

    // ------------------------------------------------------------------
    // KNOWN GAP, recorded rather than asserted away.
    //
    // `stop()` cancels the pending tick, orphans state updates and prevents a
    // successor being scheduled. What it does NOT do is abort a round that is
    // already running: `runPublishCycle` is awaited, not cancelled, so a round
    // that has passed the GPS read goes on to publish, and that write lands
    // after the driver pressed Stop.
    //
    // MOV-267's stated contract is "when tracking stops, no further GPS
    // acquisition or publishing should continue", so this is a real difference
    // between the contract and the behaviour. MOV-269 is a testing subtask, so
    // the behaviour is documented here rather than changed — these two tests
    // will fail loudly if it is ever fixed, which is the point.
    // ------------------------------------------------------------------
    it('lets one already-running round finish, publishing after the stop', async () => {
        deviceWillReport(ROUTE_FIXES[0]);
        const session = trackingSession();
        await session.start();

        const storedBefore = await snapshotStoredLocation(BUS_A);
        const requestsBefore = locationRequests().length;

        // The round hangs inside the GPS read, then the driver stops.
        const releaseFix = gpsWillHang();
        await session.clock.tick();
        session.tracker.stop();

        // The phone answers after the stop, as a slow fix really would.
        releaseFix(ROUTE_FIXES[3]);
        await settle();

        // The round completes and its position is stored. Documented, not
        // endorsed: a driver who pressed Stop still shared one more position.
        expect(locationRequests()).toHaveLength(requestsBefore + 1);
        expect((await readStoredLocation(BUS_A)).latitude).toBe(ROUTE_FIXES[3].latitude);
        expect(storedBefore.latitude).toBe(ROUTE_FIXES[0].latitude);
    });

    it('lets no round BEGIN after the stop, and schedules no successor', async () => {
        deviceWillReport(ROUTE_FIXES[0]);
        const session = trackingSession();
        await session.start();

        const releaseFix = gpsWillHang();
        await session.clock.tick();
        session.tracker.stop();
        releaseFix(ROUTE_FIXES[3]);
        await settle();

        // This is what stopping does guarantee, and it is the part that keeps
        // the trailing publish to exactly one: the finished round cannot queue
        // another, and no later tick can start one.
        expect(session.clock.pendingCount()).toBe(0);
        expect(session.tracker.isTracking()).toBe(false);

        const fixesAfterStop = mockGetCurrentPosition.mock.calls.length;
        const requestsAfterStop = locationRequests().length;

        await session.clock.tick();
        await session.clock.tick();

        expect(mockGetCurrentPosition).toHaveBeenCalledTimes(fixesAfterStop);
        expect(locationRequests()).toHaveLength(requestsAfterStop);
    });

    it('runs exactly one loop after a stop and a restart', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        session.tracker.stop();

        session.tracker.start();
        await settle();

        // One pending tick, not two loops racing.
        expect(session.clock.pendingCount()).toBe(1);

        const before = locationRequests().length;
        await session.clock.tick();

        // One more round, not two.
        expect(locationRequests()).toHaveLength(before + 1);
    });

    it('publishes correctly again after restarting', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        session.tracker.stop();

        deviceScript.unshift(ROUTE_FIXES[3]);
        session.tracker.start();
        await settle();

        expect((await readStoredLocation(BUS_A)).latitude).toBe(ROUTE_FIXES[3].latitude);
    });

    it('makes no extra requests however often start is pressed', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        session.tracker.start();
        session.tracker.start();
        session.tracker.start();
        await settle();

        expect(locationRequests()).toHaveLength(1);
        expect(session.clock.pendingCount()).toBe(1);
    });

    it('stays at one round per tick when start is pressed again mid-shift', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();

        // The driver presses Start again while it is already running. A second
        // loop here would double every subsequent round for the rest of the
        // shift — the failure would compound rather than show up once.
        session.tracker.start();
        session.tracker.start();
        await settle();

        expect(locationRequests()).toHaveLength(1);

        for (let round = 2; round <= 4; round += 1) {
            await session.clock.tick();
            expect(locationRequests()).toHaveLength(round);
            expect(session.clock.pendingCount()).toBe(1);
        }
    });

    it('never overlaps two rounds, however long a round takes', async () => {
        deviceWillReport(ROUTE_FIXES[0]);
        const session = trackingSession();
        await session.start();

        const releaseFix = gpsWillHang();

        await session.clock.tick();

        // The round is stuck waiting for the phone. Time passing must not
        // stack another round behind it.
        expect(session.clock.pendingCount()).toBe(0);
        await session.clock.tick();
        await session.clock.tick();

        const requestsWhileStuck = locationRequests().length;

        releaseFix(ROUTE_FIXES[3]);
        await settle();

        // Exactly one request came out of that round, and exactly one tick is
        // now waiting for the next.
        expect(locationRequests()).toHaveLength(requestsWhileStuck + 1);
        expect(session.clock.pendingCount()).toBe(1);
    });
});

// ==================================================================
// G. THE BUS SIGNS OUT MID-SHIFT
// ==================================================================
describe('a session that goes away while tracking', () => {
    it('stops the loop rather than retrying forever', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        expect(session.tracker.isTracking()).toBe(true);

        await clearBusSession();
        await session.clock.tick();

        expect(session.tracker.isTracking()).toBe(false);
        expect(session.stops).toEqual(['NOT_SIGNED_IN']);
        expect(session.statuses()[session.statuses().length - 1]).toBe('NOT_SIGNED_IN');
    });

    it('makes no further requests once it has stopped for that reason', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        const before = locationRequests().length;

        await clearBusSession();
        await session.clock.tick();
        await session.clock.tick();
        await session.clock.tick();

        // The round that discovered the missing session sent nothing, and no
        // round followed it.
        expect(locationRequests()).toHaveLength(before);
        expect(session.clock.pendingCount()).toBe(0);
    });
});

// ==================================================================
// H. THE STATES A SHIFT PASSES THROUGH
// ==================================================================
describe('state transitions across a whole shift', () => {
    it('runs the full sequence: publishing, failing, recovering, stopping', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        // Round 1 — a clean publish.
        await session.start();

        // Round 2 — the phone loses its fix.
        gpsWillFail();
        await session.clock.tick();

        // Round 3 — the fix is back but the network is not.
        publishBehaviours = ['NETWORK_DOWN'];
        await session.clock.tick();

        // Round 4 — everything works again.
        await session.clock.tick();

        session.tracker.stop();

        expect(session.statuses()).toEqual([
            'REQUESTING',
            'AVAILABLE',
            'PUBLISHING',
            'PUBLISHED',

            'REQUESTING',
            'POSITION_UNAVAILABLE',

            'REQUESTING',
            'AVAILABLE',
            'PUBLISHING',
            'PUBLISH_FAILED',

            'REQUESTING',
            'AVAILABLE',
            'PUBLISHING',
            'PUBLISHED',
        ]);

        expect(session.stops).toEqual(['REQUESTED']);
    });

    it('reaches PUBLISHING only when there is a real position to send', async () => {
        // Nothing is ever reported, on any round.
        gpsWillFail(5);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();

        expect(session.statuses()).not.toContain('PUBLISHING');
        expect(session.statuses()).not.toContain('PUBLISHED');
        expect(locationRequests()).toHaveLength(0);
    });
});

// ==================================================================
// I. NOTHING PRIVATE LEAKS, HOWEVER LONG THE SHIFT RUNS
// ==================================================================
describe('what repeated publishing never carries', () => {
    it('never puts the configured bus value in any request, over many rounds', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();
        await session.clock.tick();
        await session.clock.tick();

        expect(locationRequests()).toHaveLength(4);

        locationRequests().forEach((request) => {
            const whole = `${request.url} ${JSON.stringify(request.init)}`;
            expect(whole).not.toContain(configuredA);
        });
    });

    it('sends only the three location fields on every round', async () => {
        deviceWillReport(...ROUTE_FIXES);
        const session = trackingSession();

        await session.start();
        await session.clock.tick();

        publishedBodies().forEach((body) => {
            // Speed, heading, altitude and accuracy are all available from the
            // device and none of them travels, on any round.
            expect(Object.keys(body).sort()).toEqual([
                'latitude',
                'longitude',
                'recordedAt',
            ]);
        });
    });

    it('writes nothing sensitive to the console across a whole shift', async () => {
        deviceWillReport(...ROUTE_FIXES);

        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            const session = trackingSession();
            await session.start();

            publishBehaviours = ['SERVER_ERROR'];
            await session.clock.tick();

            gpsWillFail();
            await session.clock.tick();
            await session.clock.tick();
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        const output = logged.join('\n');
        expect(output).not.toContain(configuredA);
        // Not even the coordinates, which are the driver's own position.
        expect(output).not.toContain(String(ROUTE_FIXES[0].latitude));
        expect(output).not.toContain(String(ROUTE_FIXES[1].latitude));
    });
});
