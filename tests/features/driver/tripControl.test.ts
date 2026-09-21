// Trip Control on the Transit Console (MOV-294).
//
// The driver starts a SPECIFIC assigned trip. Start Journey persists that on
// the server with the actual start time; only then does the EXISTING location
// sharing begin, naming that trip. The journey belongs to the trip, not to the
// device session:
//
//   - signing out stops this device's sharing and never ends the journey
//   - signing back in finds the running journey from the persisted records,
//     and sharing can be resumed
//   - End Journey persists the end, then stops sharing
//   - only one trip runs at a time
//   - the existing permission flow and live map are untouched
//
// The project has no React renderer, so the tab and hook are not rendered.
// Everything they decide lives in the pure modules exercised here, driven
// through the REAL tracker, the REAL publish cycle and the REAL GPS read; only
// the device GPS, the keystore, the clock, the network and the server's
// journey store are substituted. The server side is covered end to end in
// tests/api/trips/tripJourney+api.route.test.ts.

import { Trip } from '../../../src/entities/trip/model/types';
import { fetchAssignedTrips } from '../../../src/features/driver/api/assignedTripsApi';
import { publishBusLocation } from '../../../src/features/driver/api/busLocationApi';
import { TripJourneyAction, TripJourneyError } from '../../../src/features/driver/api/tripJourneyApi';
import { AssignedTrip, AssignedTripRoute, buildAssignedTrips } from '../../../src/features/driver/utils/assignedTrips';
import { describeBusMap } from '../../../src/features/driver/utils/busMapView';
import {
    ActiveJourney,
    createJourneyController,
    findActiveJourney,
    journeyTripIdFor,
    startRefusal,
    tripCardState,
    withJourneyTrip,
} from '../../../src/features/driver/utils/journeyControl';
import { LIVE_DEPENDENCIES, PublishCycleDependencies } from '../../../src/features/driver/utils/locationPublishCycle';
import { TrackingScheduler, createLocationTracker } from '../../../src/features/driver/utils/locationTracker';
import { PhoneLocationState, initialPhoneLocationState } from '../../../src/features/driver/utils/phoneLocationState';
import { describeTrackingCard } from '../../../src/features/driver/utils/trackingCardView';
import { BusSession } from '../../../src/shared/utils/busSession';
import { TripJourneyRecord } from '../../../src/shared/utils/journeyLifecycle';
import { PhoneLocation, getCurrentPhoneLocation } from '../../../src/shared/utils/phoneLocation';

// ------------------------------------------------------------------
// External boundaries
// ------------------------------------------------------------------
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

jest.mock('expo-secure-store', () => ({
    setItemAsync: jest.fn(),
    getItemAsync: jest.fn(async () => null),
    deleteItemAsync: jest.fn(),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ------------------------------------------------------------------
// Fixtures: bus NB-8899 runs three turns; BUS-OTHER runs one on route 177 too.
// ------------------------------------------------------------------
const BUS_ID = 'BUS-00004';
const OTHER_BUS = 'BUS-OTHER';

const ROUTE_OUT: AssignedTripRoute = {
    routeId: 'ROUTE-177-OUT',
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
};
const ROUTE_BACK: AssignedTripRoute = {
    routeId: 'ROUTE-177-RET',
    routeNumber: '177',
    routeName: 'Kollupitiya - Kaduwela',
    startLocation: 'Kollupitiya',
    endLocation: 'Kaduwela',
};

function trip(tripId: string, departureTime: string, extra: Partial<Trip> = {}): Trip {
    return {
        tripId,
        routeId: ROUTE_OUT.routeId,
        busId: BUS_ID,
        departureTime,
        estimatedArrivalTime: '07:10',
        turnNumber: 1,
        status: 'ACTIVE',
        ...extra,
    };
}

const STORED_TRIPS: Trip[] = [
    trip('TRIP-00011', '11:00', { routeId: ROUTE_BACK.routeId, turnNumber: 3, estimatedArrivalTime: '12:10' }),
    trip('TRIP-00004', '06:00', { turnNumber: 1 }),
    trip('TRIP-00008', '08:30', { turnNumber: 2, estimatedArrivalTime: '09:40' }),
    trip('TRIP-99999', '06:00', { busId: OTHER_BUS }),
    trip('TRIP-00020', '14:00', { status: 'INACTIVE' }),
];

const ROUTES = { [ROUTE_OUT.routeId]: ROUTE_OUT, [ROUTE_BACK.routeId]: ROUTE_BACK };

const assigned = () => buildAssignedTrips(BUS_ID, STORED_TRIPS, ROUTES);
const tripNamed = (tripId: string) => assigned().find((t) => t.tripId === tripId) as AssignedTrip;

const READING: PhoneLocation = { latitude: 6.9271, longitude: 79.8612, recordedAt: '2026-09-21T00:30:00.000Z' };
const SESSION: BusSession = { busId: BUS_ID, numberPlate: 'NB-8899', token: 'session-token-for-tests' };

/** When the server stamps a start in these tests. */
const SERVER_NOW = new Date();

// ------------------------------------------------------------------
// A journey harness: the real tracker and the real publish cycle, wired the
// way useTripJourney wires them, over an in-memory journey store standing in
// for POST /api/trips/:tripId/journey.
// ------------------------------------------------------------------
function manualScheduler() {
    const timers: { run: () => void; cleared: boolean }[] = [];

    const scheduler: TrackingScheduler = {
        setTimer: (run) => {
            const timer = { run, cleared: false };
            timers.push(timer);
            return timer as any;
        },
        clearTimer: (timer: any) => {
            timer.cleared = true;
        },
    };

    return {
        scheduler,
        /** Fires every timer due now, as one interval passing. */
        advance() {
            const due = timers.splice(0).filter((t) => !t.cleared);
            due.forEach((t) => t.run());
        },
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createHarness(base: Partial<PublishCycleDependencies> = {}, server = new Map<string, TripJourneyRecord>()) {
    const published: { busId: string; tripId?: string }[] = [];
    const persistCalls: { tripId: string; action: TripJourneyAction }[] = [];
    let active: ActiveJourney | null = null;
    let state: PhoneLocationState = initialPhoneLocationState;
    let failNext: Error | null = null;

    const baseDependencies: PublishCycleDependencies = {
        readLocation: async () => READING,
        readSession: async () => SESSION,
        publish: async (busId, _location, _credential, tripId) => {
            published.push({ busId, tripId });
        },
        ...base,
    };

    const clock = manualScheduler();
    const tracker = createLocationTracker({
        update: (reduce) => {
            state = reduce(state);
        },
        dependencies: withJourneyTrip(baseDependencies, () => active),
        scheduler: clock.scheduler,
    });

    const persist = async (tripId: string, action: TripJourneyAction): Promise<TripJourneyRecord> => {
        persistCalls.push({ tripId, action });

        if (failNext) {
            const error = failNext;
            failNext = null;
            throw error;
        }

        const record: TripJourneyRecord =
            action === 'START'
                ? { status: 'STARTED', startedAt: SERVER_NOW.toISOString(), endedAt: null, busId: BUS_ID }
                : { ...(server.get(tripId) as TripJourneyRecord), status: 'ENDED', endedAt: new Date().toISOString() };

        server.set(tripId, record);
        return record;
    };

    const controller = createJourneyController({
        tracking: { startTracking: tracker.start, stopTracking: tracker.stop },
        getBusId: () => BUS_ID,
        getActiveJourney: () => active,
        setActiveJourney: (next) => {
            active = next;
        },
        persist,
    });

    return {
        tracker,
        controller,
        clock,
        published,
        persistCalls,
        server,
        active: () => active,
        /** What a fresh sign-in does: reads the persisted records. */
        adopt: (journey: ActiveJourney | null) => {
            active = journey;
        },
        failNextWith: (error: Error) => {
            failNext = error;
        },
        state: () => state,
    };
}

/** The bus's trips as a device reads them after signing in again. */
const tripsWithServerState = (server: Map<string, TripJourneyRecord>) =>
    assigned().map((t) => ({ ...t, journey: server.get(t.tripId) ?? null }));

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// The assigned trips
// ==================================================================
describe('Assigned trips', () => {
    it('lists every trip assigned to this bus, soonest first, with its route', () => {
        const trips = assigned();

        expect(trips.map((t) => t.tripId)).toEqual(['TRIP-00004', 'TRIP-00008', 'TRIP-00011']);
        expect(trips[0]).toEqual({
            tripId: 'TRIP-00004',
            busId: BUS_ID,
            routeId: ROUTE_OUT.routeId,
            turnNumber: 1,
            departureTime: '06:00',
            estimatedArrivalTime: '07:10',
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            origin: 'Kaduwela',
            destination: 'Kollupitiya',
            journey: null,
        });
        expect(trips[2]).toMatchObject({ origin: 'Kollupitiya', destination: 'Kaduwela' });
    });

    it('carries each trip’s persisted journey record', () => {
        const record: TripJourneyRecord = { status: 'STARTED', startedAt: SERVER_NOW.toISOString(), endedAt: null, busId: BUS_ID };
        const [first] = buildAssignedTrips(BUS_ID, [trip('TRIP-00004', '06:00', { journey: record })], ROUTES);

        expect(first.journey).toEqual(record);
    });

    it("never lists another bus's trip, even on the same route", () => {
        expect(assigned().map((t) => t.tripId)).not.toContain('TRIP-99999');
    });

    it('leaves out a trip an admin has taken out of service', () => {
        expect(assigned().map((t) => t.tripId)).not.toContain('TRIP-00020');
    });

    it('keeps a trip whose route cannot be read, without guessing its stops', () => {
        const [only] = buildAssignedTrips(BUS_ID, [trip('TRIP-00004', '06:00')], {});

        expect(only).toMatchObject({ tripId: 'TRIP-00004', routeNumber: null, origin: null, destination: null });
    });

    it('shows nothing without a signed-in bus', () => {
        expect(buildAssignedTrips('', STORED_TRIPS, ROUTES)).toEqual([]);
    });

    it('loads them from the existing trips and routes endpoints, one read per route', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            const body = url.startsWith('/api/trips')
                ? { success: true, trips: STORED_TRIPS }
                : { success: true, route: Object.values(ROUTES).find((r) => url.endsWith(r.routeId)) };
            return { ok: true, status: 200, json: async () => body };
        });

        const trips = await fetchAssignedTrips(BUS_ID);
        const urls = mockFetch.mock.calls.map(([url]) => String(url));

        expect(urls[0]).toBe(`/api/trips?busId=${BUS_ID}`);
        // Four stored trips share the outbound route; it is still read once.
        expect(urls.filter((u) => u.startsWith('/api/routes/')).sort()).toEqual([
            `/api/routes/${ROUTE_OUT.routeId}`,
            `/api/routes/${ROUTE_BACK.routeId}`,
        ]);
        expect(trips.map((t) => t.tripId)).toEqual(['TRIP-00004', 'TRIP-00008', 'TRIP-00011']);
    });

    it('reports a failed trip list rather than showing an empty one', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false, message: 'Failed to retrieve trips.' }) });

        await expect(fetchAssignedTrips(BUS_ID)).rejects.toThrow('Failed to retrieve trips.');
    });
});

// ==================================================================
// Start Journey
// ==================================================================
describe('Start Journey', () => {
    it('persists the exact trip that was pressed, with the start time the server stamped', async () => {
        const harness = createHarness();

        const result = await harness.controller.startJourney(tripNamed('TRIP-00008'));

        expect(result.ok).toBe(true);
        expect(harness.persistCalls).toEqual([{ tripId: 'TRIP-00008', action: 'START' }]);
        expect(harness.active()?.trip.tripId).toBe('TRIP-00008');
        expect(harness.active()?.startedAt).toBe(SERVER_NOW.toISOString());
        expect(harness.active()?.expiresAt).toBe(new Date(SERVER_NOW.getTime() + 23 * 3600_000).toISOString());
        harness.tracker.stop();
    });

    it('starts the existing location sharing once saved, publishing immediately for that trip', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(harness.tracker.isTracking()).toBe(true);
        expect(harness.published).toEqual([{ busId: BUS_ID, tripId: 'TRIP-00004' }]);
        harness.tracker.stop();
    });

    it('keeps naming the same trip on every later publish', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        harness.clock.advance();
        await flush();
        harness.clock.advance();
        await flush();

        expect(harness.published.map((p) => p.tripId)).toEqual(['TRIP-00004', 'TRIP-00004', 'TRIP-00004']);
        harness.tracker.stop();
    });

    it('starts nothing when the server does not save the start', async () => {
        const harness = createHarness();
        harness.failNextWith(new TripJourneyError('NETWORK_UNAVAILABLE', 'Network error.'));

        const result = await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(result).toEqual({ ok: false, reason: 'FAILED', message: 'Network error.' });
        expect(harness.tracker.isTracking()).toBe(false);
        expect(harness.active()).toBeNull();
        expect(harness.published).toEqual([]);
    });

    it('refuses a trip that is not assigned to this bus, without asking the server', async () => {
        const harness = createHarness();
        const foreign = { ...tripNamed('TRIP-00004'), tripId: 'TRIP-99999', busId: OTHER_BUS };

        expect(await harness.controller.startJourney(foreign)).toEqual({ ok: false, reason: 'TRIP_NOT_ASSIGNED' });
        expect(harness.persistCalls).toEqual([]);
        expect(harness.tracker.isTracking()).toBe(false);
    });
});

// ==================================================================
// Signing out and back in
// ==================================================================
describe('The device session does not end the journey', () => {
    it('A. signing out stops this device sharing, and never ends the journey', async () => {
        const harness = createHarness();
        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        harness.controller.releaseDevice();
        harness.clock.advance();
        await flush();

        expect(harness.tracker.isTracking()).toBe(false);
        expect(harness.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'START' }]);
        expect(harness.server.get('TRIP-00004')?.status).toBe('STARTED');
        expect(harness.published).toHaveLength(1);
    });

    it('B. signing in again finds the running journey, with its original start time', async () => {
        const firstSignIn = createHarness();
        await firstSignIn.controller.startJourney(tripNamed('TRIP-00004'));
        firstSignIn.controller.releaseDevice();

        const running = findActiveJourney(tripsWithServerState(firstSignIn.server));

        expect(running?.trip.tripId).toBe('TRIP-00004');
        expect(running?.startedAt).toBe(SERVER_NOW.toISOString());
        expect(tripsWithServerState(firstSignIn.server).map((t) => tripCardState(t, running))).toEqual([
            'ACTIVE',
            'BLOCKED',
            'BLOCKED',
        ]);
    });

    it('B. sharing can be resumed for it, still naming the same trip', async () => {
        const firstSignIn = createHarness();
        await firstSignIn.controller.startJourney(tripNamed('TRIP-00004'));
        firstSignIn.controller.releaseDevice();

        const secondSignIn = createHarness({}, firstSignIn.server);
        secondSignIn.adopt(findActiveJourney(tripsWithServerState(firstSignIn.server)));

        expect(secondSignIn.tracker.isTracking()).toBe(false); // never on by itself
        expect(secondSignIn.controller.resumeSharing()).toBe(true);
        await flush();

        expect(secondSignIn.published).toEqual([{ busId: BUS_ID, tripId: 'TRIP-00004' }]);
        expect(secondSignIn.persistCalls).toEqual([]); // resuming does not restart it
        secondSignIn.tracker.stop();
    });

    it('C. after signing in again, End Journey ends it on the server', async () => {
        const firstSignIn = createHarness();
        await firstSignIn.controller.startJourney(tripNamed('TRIP-00004'));
        firstSignIn.controller.releaseDevice();

        const secondSignIn = createHarness({}, firstSignIn.server);
        secondSignIn.adopt(findActiveJourney(tripsWithServerState(firstSignIn.server)));

        expect(await secondSignIn.controller.endJourney()).toEqual({ ok: true });
        expect(secondSignIn.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'END' }]);
        expect(findActiveJourney(tripsWithServerState(secondSignIn.server))).toBeNull();
    });

    it('does not offer to resume when nothing is running', () => {
        expect(createHarness().controller.resumeSharing()).toBe(false);
    });

    it('H. does not find a journey whose 23 hours have passed, or one that was ended', () => {
        const expired: TripJourneyRecord = {
            status: 'STARTED',
            startedAt: new Date(Date.now() - 23 * 3600_000).toISOString(),
            endedAt: null,
            busId: BUS_ID,
        };
        const ended: TripJourneyRecord = { ...expired, startedAt: SERVER_NOW.toISOString(), status: 'ENDED', endedAt: SERVER_NOW.toISOString() };

        expect(findActiveJourney([{ ...tripNamed('TRIP-00004'), journey: expired }])).toBeNull();
        expect(findActiveJourney([{ ...tripNamed('TRIP-00004'), journey: ended }])).toBeNull();
    });
});

// ==================================================================
// End Journey
// ==================================================================
describe('End Journey', () => {
    it('saves the end, then stops the existing location sharing', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        const result = await harness.controller.endJourney();
        harness.clock.advance();
        await flush();

        expect(result).toEqual({ ok: true });
        expect(harness.persistCalls.map((c) => c.action)).toEqual(['START', 'END']);
        expect(harness.server.get('TRIP-00004')?.status).toBe('ENDED');
        expect(harness.tracker.isTracking()).toBe(false);
        expect(harness.active()).toBeNull();
        expect(harness.published).toHaveLength(1);
    });

    it('keeps the journey running, and sharing, when the end cannot be saved', async () => {
        const harness = createHarness();
        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        harness.failNextWith(new TripJourneyError('NETWORK_UNAVAILABLE', 'Network error.'));

        const result = await harness.controller.endJourney();

        expect(result).toEqual({ ok: false, reason: 'FAILED', message: 'Network error.' });
        expect(harness.tracker.isTracking()).toBe(true);
        expect(harness.active()?.trip.tripId).toBe('TRIP-00004');
        harness.tracker.stop();
    });

    it('catches up when the server says the journey is no longer running', async () => {
        const harness = createHarness();
        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        harness.failNextWith(new TripJourneyError('JOURNEY_NOT_STARTED', 'This journey has not been started.'));

        expect(await harness.controller.endJourney()).toEqual({ ok: true });
        expect(harness.tracker.isTracking()).toBe(false);
        expect(harness.active()).toBeNull();
    });

    it('does nothing when nothing is running', async () => {
        const harness = createHarness();

        expect(await harness.controller.endJourney()).toEqual({ ok: false, reason: 'NO_ACTIVE_JOURNEY' });
        expect(harness.persistCalls).toEqual([]);
    });
});

// ==================================================================
// One journey at a time
// ==================================================================
describe('One journey at a time', () => {
    it('refuses a second trip while one is running, without asking the server', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        const second = await harness.controller.startJourney(tripNamed('TRIP-00008'));
        await flush();

        expect(second).toEqual({ ok: false, reason: 'ANOTHER_JOURNEY_ACTIVE' });
        expect(harness.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'START' }]);
        expect(harness.published.map((p) => p.tripId)).toEqual(['TRIP-00004']);
        harness.tracker.stop();
    });

    it('reports the server refusing because another trip of this bus is running', async () => {
        const harness = createHarness();
        harness.failNextWith(new TripJourneyError('ANOTHER_JOURNEY_ACTIVE', 'This bus is already running another trip.'));

        const result = await harness.controller.startJourney(tripNamed('TRIP-00008'));

        expect(result).toMatchObject({ ok: false, reason: 'ANOTHER_JOURNEY_ACTIVE' });
        expect(harness.tracker.isTracking()).toBe(false);
    });

    it('ignores a double press while the first start is still being saved', async () => {
        const harness = createHarness();

        const [first, second] = await Promise.all([
            harness.controller.startJourney(tripNamed('TRIP-00004')),
            harness.controller.startJourney(tripNamed('TRIP-00008')),
        ]);

        expect(first.ok).toBe(true);
        expect(second).toEqual({ ok: false, reason: 'IN_PROGRESS' });
        expect(harness.persistCalls).toHaveLength(1);
        harness.tracker.stop();
    });

    it('marks the running trip active and blocks every other card', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00008'));

        expect(assigned().map((t) => [t.tripId, tripCardState(t, harness.active())])).toEqual([
            ['TRIP-00004', 'BLOCKED'],
            ['TRIP-00008', 'ACTIVE'],
            ['TRIP-00011', 'BLOCKED'],
        ]);
        harness.tracker.stop();
    });

    it('never restarts a running trip when its own button is pressed again', () => {
        const running = findActiveJourney([
            { ...tripNamed('TRIP-00004'), journey: { status: 'STARTED', startedAt: SERVER_NOW.toISOString(), endedAt: null, busId: BUS_ID } },
        ]);

        expect(startRefusal(running, tripNamed('TRIP-00004'), BUS_ID)).toBe('ANOTHER_JOURNEY_ACTIVE');
    });

    it('starting Trip A never associates Trip B, and B only after A has ended', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        await harness.controller.endJourney();
        await harness.controller.startJourney(tripNamed('TRIP-00008'));
        await flush();
        harness.clock.advance();
        await flush();

        expect(harness.published.map((p) => p.tripId)).toEqual(['TRIP-00004', 'TRIP-00008', 'TRIP-00008']);
        harness.tracker.stop();
    });

    it('never names a journey started on a different bus', () => {
        const elsewhere = {
            trip: { ...tripNamed('TRIP-00004'), busId: OTHER_BUS },
            startedAt: SERVER_NOW.toISOString(),
            expiresAt: SERVER_NOW.toISOString(),
        };

        expect(journeyTripIdFor(elsewhere, BUS_ID)).toBeUndefined();
        expect(journeyTripIdFor(null, BUS_ID)).toBeUndefined();
    });
});

// ==================================================================
// The existing permission flow and live map
// ==================================================================
describe('Existing location flow, reused', () => {
    it('uses the existing GPS read and session unchanged', () => {
        const wrapped = withJourneyTrip(LIVE_DEPENDENCIES, () => null);

        expect(wrapped.readLocation).toBe(LIVE_DEPENDENCIES.readLocation);
        expect(wrapped.readLocation).toBe(getCurrentPhoneLocation);
        expect(wrapped.readSession).toBe(LIVE_DEPENDENCIES.readSession);
    });

    it('asks for location permission the existing way, and publishes nothing when refused', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
        const harness = createHarness({ readLocation: getCurrentPhoneLocation });

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
        expect(harness.published).toEqual([]);
        expect(harness.state().status).toBe('PERMISSION_DENIED');

        // The journey is started regardless; the card points at the fix and
        // still lets the journey end.
        expect(harness.server.get('TRIP-00004')?.status).toBe('STARTED');
        const view = describeTrackingCard(harness.state(), harness.tracker.isTracking());
        expect(view.primaryAction?.kind).toBe('OPEN_SETTINGS');
        expect(view.trackingAction).toEqual({ kind: 'STOP_TRACKING', label: 'End Journey' });
        harness.tracker.stop();
    });

    it('publishes the real fix once permission is granted', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockResolvedValue({
            coords: { latitude: READING.latitude, longitude: READING.longitude },
            timestamp: Date.parse(READING.recordedAt),
        });
        const harness = createHarness({ readLocation: getCurrentPhoneLocation });

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(harness.published).toEqual([{ busId: BUS_ID, tripId: 'TRIP-00004' }]);
        harness.tracker.stop();
    });

    it('shows the existing live map, readings and "Tracking active" while the journey runs', async () => {
        const harness = createHarness();

        await harness.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        const map = describeBusMap(harness.state(), harness.tracker.isTracking());
        const card = describeTrackingCard(harness.state(), harness.tracker.isTracking());

        expect(map.visible).toBe(true);
        expect(map.freshness).toBe('LIVE');
        expect(map.marker).toEqual({ latitude: READING.latitude, longitude: READING.longitude });
        expect(card.title).toBe('Tracking active');
        expect(card.trackingAction?.label).toBe('End Journey');

        await harness.controller.endJourney();
        expect(describeBusMap(harness.state(), harness.tracker.isTracking()).visible).toBe(false);
    });
});

// ==================================================================
// The trip on the wire
// ==================================================================
describe('publishBusLocation with a trip', () => {
    const okResponse = { ok: true, status: 200, json: async () => ({ success: true }) };

    it('names the started trip in the location update', async () => {
        mockFetch.mockResolvedValue(okResponse);

        await publishBusLocation(BUS_ID, READING, SESSION.token, 'TRIP-00004');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body).toEqual({ ...READING, tripId: 'TRIP-00004' });
    });

    it('sends the position alone when no journey is running', async () => {
        mockFetch.mockResolvedValue(okResponse);

        await publishBusLocation(BUS_ID, READING, SESSION.token);
        await publishBusLocation(BUS_ID, READING, SESSION.token, '   ');

        for (const [, init] of mockFetch.mock.calls) {
            expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['latitude', 'longitude', 'recordedAt']);
        }
    });
});
