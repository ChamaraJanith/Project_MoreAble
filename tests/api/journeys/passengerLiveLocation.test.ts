// The driver's continuous tracking, seen by a passenger (MOV-270).
//
// WHAT THE NEIGHBOURING SUITES ALREADY PROVE, AND WHERE THEY STOP.
//
// `liveUpdates.test.ts` (MOV-122) already drives the real location endpoint
// into the real journey search: published, retrieved, published again,
// retrieved again. But its publisher is an ADMIN operator calling the route
// directly — that suite predates bus authentication (MOV-265) and the
// continuous tracker (MOV-267) entirely.
//
// `continuousLocationUpdates.test.ts` (MOV-269) drives the real tracker through
// the real endpoint — but stops at Firestore. It never asks a passenger.
//
// So the seam nobody has closed is the whole of it: the CONTINUOUS,
// BUS-AUTHENTICATED flow arriving at a passenger's screen.
//
//   plate + configured value -> bus-login -> stored session
//     -> tracker cycle -> GPS fix -> publish -> location endpoint
//       -> vehicleLocations/{busId}
//         -> journey search -> live block -> resolveVehiclePosition
//
// If the vehicle-session write path used a different document key from the one
// journey search reads, MOV-122 and MOV-269 would both still pass and no
// passenger would ever see a tracked bus. That is what this file pins down.
//
// It deliberately re-tests none of the coordinate validation, authentication,
// age arithmetic or scheduling already covered next door.
//
// No value below is a literal credential. Configured bus values come from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name. Coordinates are ordinary geographic test data.

import { POST as busLoginRoute } from '../../../app/api/auth/bus-login+api';
import { PUT as locationRoute } from '../../../app/api/buses/[busId]/location+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { loginBus } from '../../../src/features/auth/api/busAuthApi';
import {
    MINIMUM_TRACKING_INTERVAL_MS,
    TrackingScheduler,
    createLocationTracker,
} from '../../../src/features/driver/utils/locationTracker';
import { initialPhoneLocationState } from '../../../src/features/driver/utils/phoneLocationState';
import {
    formatLocationAge,
    resolveVehiclePosition,
} from '../../../src/features/journey/utils/liveStatus';
import { saveBusSession } from '../../../src/shared/utils/busSession';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

// ------------------------------------------------------------------
// External boundaries — everything between them is the real thing
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

// `jose` is ESM-only and cannot load under this project's CommonJS Jest, which
// is why every existing suite stubs it. Claims propagate; signatures are not
// exercised, and only values this issued will verify.
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

// The map providers play no part in live vehicle data.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(async () => null),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(async () => null),
    getRouteThroughCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const BUS_A = 'BUS-00001';
const BUS_B = 'BUS-00002';
const PLATE_A = 'NB-1234';
const PLATE_B = 'NB-5678';
const TRIP_A = 'TRIP-00001';
const TRIP_B = 'TRIP-00002';

/** Points along the Kaduwela - Kollupitiya corridor. Ordinary test data. */
const JOURNEY_FIXES = [
    { latitude: 6.9333, longitude: 79.9833, at: '2026-08-20T09:00:00.000Z' },
    { latitude: 6.9210, longitude: 79.9701, at: '2026-08-20T09:00:30.000Z' },
    { latitude: 6.9061, longitude: 79.9558, at: '2026-08-20T09:01:00.000Z' },
];

/** Somewhere else entirely, so a mix-up between buses is unmistakable. */
const OTHER_BUS_FIXES = [
    { latitude: 7.2906, longitude: 80.6337, at: '2026-08-20T09:00:15.000Z' },
    { latitude: 7.2513, longitude: 80.5950, at: '2026-08-20T09:00:45.000Z' },
];

type Fix = (typeof JOURNEY_FIXES)[number];

let configuredA: string;
let configuredB: string;
let db: ReturnType<typeof createFakeFirestore>;

const route = {
    id: '177_KADUWELA_KOLLUPITIYA',
    routeId: '177_KADUWELA_KOLLUPITIYA',
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

function bus(busId: string, numberPlate: string, configured: string) {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: {
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            walkingAssistance: false,
            wheelchairSpace: { available: true, count: 2 },
            guardianSeats: { available: true, count: 2 },
            prioritySeats: { available: true, count: 4 },
            elderlySeats: { available: true, count: 4 },
        },
        status: 'ACTIVE',
        // The fleet record really does carry this now (MOV-265). Its presence
        // is the point: the passenger response must not be able to reach it.
        password: configured,
    };
}

function trip(tripId: string, busId: string, departureTime: string, arrivalTime: string) {
    return {
        id: tripId,
        tripId,
        routeId: route.routeId,
        busId,
        departureTime,
        estimatedArrivalTime: arrivalTime,
        turnNumber: 1,
        status: 'ACTIVE',
    };
}

/** A device reading, shaped exactly as expo-location returns one. */
function deviceReading(fix: Fix) {
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

// ------------------------------------------------------------------
// The device, scripted round by round
// ------------------------------------------------------------------
type DeviceAnswer = Fix | 'NO_FIX';

let deviceScript: DeviceAnswer[] = [];
let repeatLast: Fix | null = null;

function installDeviceMocks() {
    mockRequestPermissions.mockImplementation(async () => ({
        granted: true,
        status: 'granted',
        canAskAgain: true,
    }));
    mockHasServicesEnabled.mockImplementation(async () => true);

    mockGetCurrentPosition.mockImplementation(async () => {
        const next = deviceScript.shift();

        if (next === undefined) {
            if (!repeatLast) throw new Error('no signal');
            return deviceReading(repeatLast);
        }

        if (next === 'NO_FIX') throw new Error('no signal');

        repeatLast = next;
        return deviceReading(next);
    });
}

function deviceWillReport(...fixes: Fix[]) {
    deviceScript.push(...fixes);
    repeatLast = fixes[fixes.length - 1] ?? null;
}

function gpsWillFail(times = 1) {
    deviceScript.unshift(...Array.from({ length: times }, () => 'NO_FIX' as const));
}

async function settle(rounds = 60): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

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
        async tick(): Promise<void> {
            const due = Array.from(pending.values());
            pending.clear();
            due.forEach((run) => run());
            await settle();
        },
    };
}

/** The app's fetch, pointed at the real route handlers. */
function routeFetchToHandlers() {
    global.fetch = (async (url: string, init: any) => {
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

/**
 * A bus signs in and starts tracking, exactly as the driver's phone does.
 *
 * No `dependencies` are given to the tracker, so `runPublishCycle` uses its
 * live defaults: the real GPS service, the real session store and the real
 * publisher.
 */
async function busStartsTracking(numberPlate: string, configured: string) {
    const session = await loginBus(numberPlate, configured);
    await saveBusSession(session);

    const clock = manualClock();
    let current = initialPhoneLocationState;

    const tracker = createLocationTracker({
        update: (reduce) => {
            current = reduce(current);
        },
        scheduler: clock.scheduler,
        intervalMs: MINIMUM_TRACKING_INTERVAL_MS,
    });

    tracker.start();
    await settle();

    return { tracker, clock, session };
}

/**
 * Makes this the phone that is signed in as the given bus.
 *
 * The bus session store models ONE device, which is correct: a phone is signed
 * in as one vehicle. Two buses tracking at once therefore means two phones, and
 * a single test process has only one store — so a test covering two vehicles
 * says which phone the next cycle is running on. Nothing about the tracker or
 * the session rules is bypassed; the session is established exactly as sign in
 * establishes it.
 */
async function switchDeviceTo(session: { busId: string; numberPlate: string; token: string }) {
    await saveBusSession(session);
}

/**
 * What the passenger's screen does: runs the journey search again.
 *
 * This is the exact call the Route Details refresh makes — it re-runs the
 * search rather than fetching a vehicle position directly — so repeating it
 * here is the testable half of that button.
 */
async function passengerSearches(): Promise<any> {
    const response = await searchJourneys(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-08-20',
                travelTime: '08:30',
            }),
        })
    );

    return response.json();
}

/** The departure a passenger selected, out of the single matched route. */
function departure(json: any, tripId: string) {
    return json.routes[0].trips.find((option: any) => option.trip.tripId === tripId);
}

/** What the passenger's map would draw for that departure. */
function markerFor(json: any, tripId: string) {
    return resolveVehiclePosition(departure(json, tripId).liveStatus);
}

beforeEach(() => {
    jest.clearAllMocks();
    deviceStore.clear();
    deviceScript = [];
    repeatLast = null;

    configuredA = nextUniqueValue();
    configuredB = nextUniqueValue();

    db = createFakeFirestore({
        routes: [route],
        buses: [bus(BUS_A, PLATE_A, configuredA), bus(BUS_B, PLATE_B, configuredB)],
        trips: [
            trip(TRIP_A, BUS_A, '09:00', '10:10'),
            trip(TRIP_B, BUS_B, '09:30', '10:40'),
        ],
    });

    mockGetAdminDb.mockReturnValue(db);
    installDeviceMocks();
    routeFetchToHandlers();
});

// ==================================================================
// A. THE TRACKED BUS ARRIVES ON A PASSENGER'S SCREEN
//
// The seam neither neighbouring suite closes: the bus-authenticated,
// continuously tracked write, read back by journey search.
// ==================================================================
describe('a continuously tracked bus reaches the passenger', () => {
    it('shows the position the tracker published, on the trip that bus operates', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);

        // Written through the vehicle-session path, read through journey
        // search, matched only by the collection name and the document key.
        expect(liveStatus.available).toBe(true);
        expect(liveStatus.location).toEqual({
            busId: BUS_A,
            latitude: JOURNEY_FIXES[0].latitude,
            longitude: JOURNEY_FIXES[0].longitude,
            recordedAt: JOURNEY_FIXES[0].at,
        });
    });

    it('gives the passenger map a marker at that exact coordinate', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        expect(markerFor(await passengerSearches(), TRIP_A)).toEqual({
            latitude: JOURNEY_FIXES[0].latitude,
            longitude: JOURNEY_FIXES[0].longitude,
        });
    });

    it('files the position under the authenticated bus id, not the number plate', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);

        // The driver typed a plate; the trip refers to a busId. If the write
        // had been keyed by what the driver typed, this read would find
        // nothing — which is exactly the failure this test exists to catch.
        expect(liveStatus.location.busId).toBe(BUS_A);
        expect(JSON.stringify(liveStatus)).not.toContain(PLATE_A);
    });
});

// ==================================================================
// B. LOCATION 1 -> 2 -> 3
// ==================================================================
describe('the passenger sees the bus move, cycle by cycle', () => {
    it('returns each new position on the next retrieval, never the previous one', async () => {
        deviceWillReport(...JOURNEY_FIXES);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);

        // Cycle 1
        const first = markerFor(await passengerSearches(), TRIP_A);
        expect(first).toEqual({
            latitude: JOURNEY_FIXES[0].latitude,
            longitude: JOURNEY_FIXES[0].longitude,
        });

        // Cycle 2
        await clock.tick();
        const second = markerFor(await passengerSearches(), TRIP_A);
        expect(second).toEqual({
            latitude: JOURNEY_FIXES[1].latitude,
            longitude: JOURNEY_FIXES[1].longitude,
        });

        // Cycle 3
        await clock.tick();
        const third = markerFor(await passengerSearches(), TRIP_A);
        expect(third).toEqual({
            latitude: JOURNEY_FIXES[2].latitude,
            longitude: JOURNEY_FIXES[2].longitude,
        });

        // Three distinct places, in order. A passenger who kept seeing the
        // first one would be watching a bus that never moved.
        expect(new Set([first, second, third].map((p) => p!.latitude)).size).toBe(3);
    });

    it('carries the coordinates through untouched, rounding and swapping nothing', async () => {
        deviceWillReport(...JOURNEY_FIXES);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);

        await clock.tick();
        await clock.tick();

        const { location } = departure(await passengerSearches(), TRIP_A).liveStatus;

        // Latitude and longitude are different magnitudes here, so a swap
        // anywhere along the chain would put the bus in the wrong hemisphere.
        expect(location.latitude).toBe(JOURNEY_FIXES[2].latitude);
        expect(location.longitude).toBe(JOURNEY_FIXES[2].longitude);
    });

    it('keeps one live record per bus however many cycles have run', async () => {
        deviceWillReport(...JOURNEY_FIXES);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);

        await clock.tick();
        await clock.tick();

        // Latest-state storage, as the existing schema defines it. The
        // passenger reads a position, never a trail.
        const stored = await db.collection('vehicleLocations').get();
        expect(stored.docs).toHaveLength(1);
    });

    it('does not need a new search to have been running to pick the change up', async () => {
        // Two identical passenger requests, a tracker cycle apart, must differ.
        deviceWillReport(...JOURNEY_FIXES);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);

        const before = departure(await passengerSearches(), TRIP_A).liveStatus.location;
        await clock.tick();
        const after = departure(await passengerSearches(), TRIP_A).liveStatus.location;

        expect(before.latitude).not.toBe(after.latitude);
    });
});

// ==================================================================
// C. THE FIX TIME IS THE DEVICE'S, NOT THE SERVER'S
// ==================================================================
describe('the time the passenger is shown', () => {
    it('is the moment the phone took the fix', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);

        // The device's own GPS timestamp, through the tracker, the endpoint,
        // storage and the search — unchanged.
        expect(liveStatus.location.recordedAt).toBe(JOURNEY_FIXES[0].at);
    });

    it('is not quietly replaced by the moment the passenger asked', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);
        const searchedAt = Date.now();

        // A fix time replaced by request time would make every bus look
        // permanently up to date, which is the one thing a live feature must
        // not fake. The fixture is years away from the run clock, so any
        // substitution shows up as a tiny age.
        expect(Math.abs(searchedAt - Date.parse(liveStatus.location.recordedAt)))
            .toBeGreaterThan(60_000);
        expect(liveStatus.locationAgeSeconds).not.toBe(0);
    });

    it('moves forward as the tracker publishes newer fixes', async () => {
        deviceWillReport(...JOURNEY_FIXES);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);

        const firstAge = departure(await passengerSearches(), TRIP_A).liveStatus
            .locationAgeSeconds;

        await clock.tick();
        await clock.tick();

        const latest = departure(await passengerSearches(), TRIP_A).liveStatus;

        expect(latest.location.recordedAt).toBe(JOURNEY_FIXES[2].at);
        // A newer fix is a smaller age against the same clock.
        expect(latest.locationAgeSeconds).toBeLessThan(firstAge);
    });

    it('gives the passenger UI an age it can put into words', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);

        // The words come from the age the backend measured from the device
        // fix — the end of the chain this subtask is verifying.
        expect(formatLocationAge(liveStatus.locationAgeSeconds)).toMatch(/^Updated /);
    });
});

// ==================================================================
// D. TWO BUSES, TWO TRACKERS
// ==================================================================
describe('two buses tracking at once never cross over', () => {
    it('gives each departure its own vehicle position', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        deviceWillReport(OTHER_BUS_FIXES[0]);
        await busStartsTracking(PLATE_B, configuredB);

        const json = await passengerSearches();

        expect(markerFor(json, TRIP_A)).toEqual({
            latitude: JOURNEY_FIXES[0].latitude,
            longitude: JOURNEY_FIXES[0].longitude,
        });
        expect(markerFor(json, TRIP_B)).toEqual({
            latitude: OTHER_BUS_FIXES[0].latitude,
            longitude: OTHER_BUS_FIXES[0].longitude,
        });
    });

    it('leaves the other bus untouched when one of them moves again', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        const busA = await busStartsTracking(PLATE_A, configuredA);

        deviceWillReport(OTHER_BUS_FIXES[0]);
        await busStartsTracking(PLATE_B, configuredB);

        const before = departure(await passengerSearches(), TRIP_B).liveStatus.location;

        // Only A moves. B has not reported since.
        deviceWillReport(JOURNEY_FIXES[2]);
        await switchDeviceTo(busA.session);
        await busA.clock.tick();

        const json = await passengerSearches();

        expect(markerFor(json, TRIP_A)).toEqual({
            latitude: JOURNEY_FIXES[2].latitude,
            longitude: JOURNEY_FIXES[2].longitude,
        });
        expect(departure(json, TRIP_B).liveStatus.location).toEqual(before);
    });

    it('never shows one bus at the other bus position', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        deviceWillReport(OTHER_BUS_FIXES[0]);
        await busStartsTracking(PLATE_B, configuredB);

        const json = await passengerSearches();

        // The two are a hundred kilometres apart, so a mix-up is unmistakable.
        expect(markerFor(json, TRIP_A)!.latitude).not.toBe(OTHER_BUS_FIXES[0].latitude);
        expect(markerFor(json, TRIP_B)!.latitude).not.toBe(JOURNEY_FIXES[0].latitude);
        expect(departure(json, TRIP_A).liveStatus.location.busId).toBe(BUS_A);
        expect(departure(json, TRIP_B).liveStatus.location.busId).toBe(BUS_B);
    });
});

// ==================================================================
// E. WHEN THERE IS NOTHING HONEST TO SHOW
// ==================================================================
describe('a bus the passenger cannot be shown', () => {
    it('reports a bus that has never tracked as unavailable', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_B);

        expect(liveStatus.available).toBe(false);
        expect(liveStatus.location).toBeUndefined();
        expect(liveStatus.message).toMatch(/not available/i);
    });

    it('draws no marker for a bus with no position', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        // No coordinate is borrowed from the route, its stops, or the other
        // bus that IS reporting.
        expect(markerFor(await passengerSearches(), TRIP_B)).toBeNull();
    });

    it('stays unavailable when tracking ran but never got a fix', async () => {
        gpsWillFail(3);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);
        await clock.tick();
        await clock.tick();

        // The tracker was running the whole time. Nothing was published, so
        // the passenger is told the position is unknown rather than shown a
        // guess.
        const { liveStatus } = departure(await passengerSearches(), TRIP_A);
        expect(liveStatus.available).toBe(false);
        expect(markerFor(await passengerSearches(), TRIP_A)).toBeNull();
    });

    it('goes back to unavailable if the stored position is removed', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        expect(departure(await passengerSearches(), TRIP_A).liveStatus.available).toBe(true);

        await db.collection('vehicleLocations').doc(BUS_A).delete();

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);
        expect(liveStatus.available).toBe(false);
        expect(markerFor(await passengerSearches(), TRIP_A)).toBeNull();
    });

    it('refuses a stored record that is not a real point on the Earth', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        // Something reached the collection another way — a console edit, or an
        // older document shape. The endpoint would never have written it.
        await db.collection('vehicleLocations').doc(BUS_A).set({
            busId: BUS_A,
            latitude: Number.NaN,
            longitude: JOURNEY_FIXES[0].longitude,
            recordedAt: JOURNEY_FIXES[0].at,
        });

        expect(departure(await passengerSearches(), TRIP_A).liveStatus.available).toBe(false);
        expect(markerFor(await passengerSearches(), TRIP_A)).toBeNull();
    });

    it('refuses a stored record whose fix time cannot be read', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        await db.collection('vehicleLocations').doc(BUS_A).set({
            busId: BUS_A,
            latitude: JOURNEY_FIXES[0].latitude,
            longitude: JOURNEY_FIXES[0].longitude,
            recordedAt: 'the day before yesterday',
        });

        // A position with no readable time cannot be aged, and an un-ageable
        // position presented as live is the thing this feature must not do.
        expect(departure(await passengerSearches(), TRIP_A).liveStatus.available).toBe(false);
        expect(markerFor(await passengerSearches(), TRIP_A)).toBeNull();
    });

    it('leaves the scheduled departure readable when the live position is gone', async () => {
        const option = departure(await passengerSearches(), TRIP_A);

        // Live data is an addition. A bus that is not reporting must not take
        // the timetable down with it.
        expect(option.liveStatus.available).toBe(false);
        expect(option.trip.departureTime).toBe('09:00');
        expect(option.bus.numberPlate).toBe(PLATE_A);
    });
    it('identifies the bus by the document it was asked for, not by a field inside it', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        // A record that disagrees with its own key — a console edit, or a
        // write that went in under the wrong id. The key is what the trip was
        // resolved through, so the key is the identity; trusting the field
        // instead would report this bus to a passenger as a different vehicle.
        await db.collection('vehicleLocations').doc(BUS_A).set({
            busId: BUS_B,
            latitude: JOURNEY_FIXES[0].latitude,
            longitude: JOURNEY_FIXES[0].longitude,
            recordedAt: JOURNEY_FIXES[0].at,
        });

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);

        expect(liveStatus.location.busId).toBe(BUS_A);
    });
});

// ==================================================================
// F. WHAT THE PASSENGER RESPONSE MUST NEVER CARRY
//
// The fleet record holds a bus credential now (MOV-265). The suites that
// verified the passenger response predate that field entirely, so nothing has
// yet checked that a tracked bus cannot leak it to a passenger.
// ==================================================================
describe('the passenger response and the bus credential', () => {
    it('carries no trace of the configured bus value, anywhere in the response', async () => {
        deviceWillReport(...JOURNEY_FIXES);
        const { clock } = await busStartsTracking(PLATE_A, configuredA);
        await clock.tick();

        const whole = JSON.stringify(await passengerSearches());

        expect(whole).not.toContain(configuredA);
        expect(whole).not.toContain(configuredB);
    });

    it('exposes only the four location fields in the live block', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const { liveStatus } = departure(await passengerSearches(), TRIP_A);

        expect(Object.keys(liveStatus.location).sort()).toEqual([
            'busId',
            'latitude',
            'longitude',
            'recordedAt',
        ]);
    });

    it('carries no session or authorization material to the passenger', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        const { session } = await busStartsTracking(PLATE_A, configuredA);

        const whole = JSON.stringify(await passengerSearches());

        // The value the bus authenticates with must not travel outwards on a
        // passenger response.
        expect(whole).not.toContain(session.token);
        expect(whole).not.toMatch(/authorization|bearer/i);
    });

    it('keeps the credential out of the bus record a passenger receives', async () => {
        deviceWillReport(JOURNEY_FIXES[0]);
        await busStartsTracking(PLATE_A, configuredA);

        const option = departure(await passengerSearches(), TRIP_A);

        // The passenger legitimately gets the vehicle's plate and its
        // accessibility facilities. It must stop there.
        expect(option.bus.numberPlate).toBe(PLATE_A);
        expect(option.bus.password).toBeUndefined();
        expect(Object.keys(option.bus)).not.toContain('password');
    });
});
