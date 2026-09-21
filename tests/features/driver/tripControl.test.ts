// Trip Control on the Transit Console (MOV-294).
//
// Three lifecycles, kept apart:
//
//   sign-in   Device Login -> logout
//   journey   Start Journey -> End Journey / scheduled arrival + 30 min (the server)
//   sharing   Start Journey -> End Journey                    (journeySharing)
//
// LOGOUT is not END JOURNEY, and it does not stop location sharing. These pin
// the device side of that: sharing starts from a specific trip's Start Journey,
// keeps publishing through a logout with the journey's own credential, is still
// running when the device signs back in (no resume step), and stops only once
// End Journey has been saved on the server.
//
// The project has no React renderer, so the tab and hook are not rendered.
// Everything they decide lives in the modules exercised here, driven through
// the REAL sharing service, the REAL tracker, the REAL publish cycle and the
// REAL GPS read; only the device GPS, the keystore, the clock, the network and
// the server's journey store are substituted. The server side, including a
// passenger receiving the location while the dashboard is logged out, is
// covered end to end in tests/api/trips/tripJourney+api.route.test.ts.
//
// Letters refer to the lifecycle test plan (A–U).

import { Trip } from '../../../src/entities/trip/model/types';
import { fetchAssignedTrips } from '../../../src/features/driver/api/assignedTripsApi';
import { publishBusLocation } from '../../../src/features/driver/api/busLocationApi';
import {
    TripJourneyAction,
    TripJourneyError,
    TripJourneyResult,
} from '../../../src/features/driver/api/tripJourneyApi';
import { createJourneySharing } from '../../../src/features/driver/services/journeySharing';
import { AssignedTrip, AssignedTripRoute, buildAssignedTrips } from '../../../src/features/driver/utils/assignedTrips';
import { describeBusMap } from '../../../src/features/driver/utils/busMapView';
import {
    ActiveJourney,
    createJourneyController,
    findActiveJourney,
    startRefusal,
    tripCardState,
} from '../../../src/features/driver/utils/journeyControl';
import { TrackingScheduler } from '../../../src/features/driver/utils/locationTracker';
import { describeTrackingCard } from '../../../src/features/driver/utils/trackingCardView';
import { BusSession, clearBusSession, getBusSession, saveBusSession } from '../../../src/shared/utils/busSession';
import { JourneySharingGrant } from '../../../src/shared/utils/journeySharingStorage';
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

// The device keystore, shared by the bus sign-in and the sharing grant.
const mockDeviceStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
    setItemAsync: async (key: string, value: string) => {
        mockDeviceStore.set(key, value);
    },
    getItemAsync: async (key: string) => mockDeviceStore.get(key) ?? null,
    deleteItemAsync: async (key: string) => {
        mockDeviceStore.delete(key);
    },
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
const HOUR = 3600_000;

/**
 * A journey as the server persists it: started at `startedAt`, for a scheduled
 * service whose arrival + grace (expiresAt) is `endsIn` after SERVER_NOW.
 */
function startedRecord(startedAt: Date = SERVER_NOW, endsIn: number = 2 * HOUR): TripJourneyRecord {
    const expiresAt = SERVER_NOW.getTime() + endsIn;
    return {
        status: 'STARTED',
        startedAt: startedAt.toISOString(),
        endedAt: null,
        busId: BUS_ID,
        scheduledDepartureAt: new Date(expiresAt - 90 * 60_000).toISOString(),
        scheduledArrivalAt: new Date(expiresAt - 30 * 60_000).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
    };
}

/** The dashboard sign-in's credential, and the journey's narrower one. */
const SIGN_IN_TOKEN = SESSION.token;
const sharingTokenFor = (tripId: string) => `sharing-credential-${tripId}`;

// ------------------------------------------------------------------
// A device harness: the real sharing service (real tracker, real publish
// cycle) and the real journey controller, wired the way useTripJourney wires
// them, over an in-memory journey store standing in for
// POST /api/trips/:tripId/journey.
//
// The service is created once per "app process" and survives sign-ins, as the
// app-level singleton does. `signIn()` builds a fresh controller — a new
// dashboard — against the same service and server.
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

interface Published {
    busId: string;
    tripId?: string;
    credential: string;
}

function createDevice(options: { readLocation?: () => Promise<PhoneLocation>; server?: Map<string, TripJourneyRecord> } = {}) {
    const server = options.server ?? new Map<string, TripJourneyRecord>();
    const published: Published[] = [];
    const persistCalls: { tripId: string; action: TripJourneyAction }[] = [];
    const storedGrants = new Map<string, JourneySharingGrant>();
    let failNext: Error | null = null;

    const clock = manualScheduler();

    const sharing = createJourneySharing({
        storage: {
            save: async (grant) => {
                storedGrants.set('grant', grant);
            },
            get: async () => storedGrants.get('grant') ?? null,
            clear: async () => {
                storedGrants.delete('grant');
            },
        },
        readLocation: options.readLocation ?? (async () => READING),
        publish: async (busId, _location, credential, tripId) => {
            published.push({ busId, tripId, credential });
        },
        scheduler: clock.scheduler,
    });

    const persist = async (tripId: string, action: TripJourneyAction): Promise<TripJourneyResult> => {
        persistCalls.push({ tripId, action });

        if (failNext) {
            const error = failNext;
            failNext = null;
            throw error;
        }

        const current = server.get(tripId);

        if (action === 'SHARE') {
            if (current?.status !== 'STARTED') throw new TripJourneyError('JOURNEY_NOT_STARTED', 'Not running.');
            return { journey: current, sharingToken: sharingTokenFor(tripId) };
        }

        if (action === 'START') {
            // Idempotent, like the real route: a running journey keeps its start.
            const record: TripJourneyRecord =
                current?.status === 'STARTED'
                    ? current
                    : startedRecord();
            server.set(tripId, record);
            return { journey: record, sharingToken: sharingTokenFor(tripId) };
        }

        const ended: TripJourneyRecord = { ...(current as TripJourneyRecord), status: 'ENDED', endedAt: new Date().toISOString() };
        server.set(tripId, ended);
        return { journey: ended };
    };

    /** A dashboard: what signing in to Trip Control builds. */
    function signIn() {
        let active: ActiveJourney | null = findActiveJourney(tripsWithServerState(server));

        const controller = createJourneyController({
            sharing,
            getBusId: () => BUS_ID,
            getActiveJourney: () => active,
            setActiveJourney: (next) => {
                active = next;
            },
            persist,
        });

        return { controller, active: () => active };
    }

    return {
        sharing,
        server,
        clock,
        published,
        persistCalls,
        storedGrants,
        signIn,
        failNextWith: (error: Error) => {
            failNext = error;
        },
        /** One tracking interval passing, and the resulting publish settling. */
        async tick() {
            clock.advance();
            await flush();
        },
    };
}

/** The bus's trips as a device reads them from the server when it signs in. */
function tripsWithServerState(server: Map<string, TripJourneyRecord>) {
    return assigned().map((t) => ({ ...t, journey: server.get(t.tripId) ?? null }));
}

/** What Device Dashboard logout does: clears the sign-in and leaves the screen. */
async function logout() {
    await clearBusSession();
}

beforeEach(async () => {
    jest.clearAllMocks();
    mockDeviceStore.clear();
    await saveBusSession(SESSION);
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
        const record: TripJourneyRecord = startedRecord();
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
    it('A. persists the exact trip that was pressed, with the start time the server stamped', async () => {
        const device = createDevice();
        const dashboard = device.signIn();

        const result = await dashboard.controller.startJourney(tripNamed('TRIP-00008'));

        expect(result.ok).toBe(true);
        expect(device.persistCalls).toEqual([{ tripId: 'TRIP-00008', action: 'START' }]);
        expect(device.server.get('TRIP-00008')?.startedAt).toBe(SERVER_NOW.toISOString());
        expect(dashboard.active()?.trip.tripId).toBe('TRIP-00008');
        await device.sharing.stop();
    });

    it('B. starts location sharing for that trip, publishing immediately with the journey credential', async () => {
        const device = createDevice();

        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(device.sharing.isSharing('TRIP-00004')).toBe(true);
        expect(device.published).toEqual([
            { busId: BUS_ID, tripId: 'TRIP-00004', credential: sharingTokenFor('TRIP-00004') },
        ]);
        expect(device.storedGrants.get('grant')).toMatchObject({ tripId: 'TRIP-00004', busId: BUS_ID });
        await device.sharing.stop();
    });

    it('keeps naming the same trip on every later publish', async () => {
        const device = createDevice();

        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        await device.tick();
        await device.tick();

        expect(device.published.map((p) => p.tripId)).toEqual(['TRIP-00004', 'TRIP-00004', 'TRIP-00004']);
        await device.sharing.stop();
    });

    it('starts nothing when the server does not save the start', async () => {
        const device = createDevice();
        const dashboard = device.signIn();
        device.failNextWith(new TripJourneyError('NETWORK_UNAVAILABLE', 'Network error.'));

        const result = await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(result).toEqual({ ok: false, reason: 'FAILED', message: 'Network error.' });
        expect(device.sharing.getSnapshot().isTracking).toBe(false);
        expect(dashboard.active()).toBeNull();
        expect(device.published).toEqual([]);
    });

    it('refuses a trip that is not assigned to this bus, without asking the server', async () => {
        const device = createDevice();
        const foreign = { ...tripNamed('TRIP-00004'), tripId: 'TRIP-99999', busId: OTHER_BUS };

        expect(await device.signIn().controller.startJourney(foreign)).toEqual({ ok: false, reason: 'TRIP_NOT_ASSIGNED' });
        expect(device.persistCalls).toEqual([]);
    });
});

// ==================================================================
// Logout is not End Journey, and does not stop sharing
// ==================================================================
describe('Logging out', () => {
    it('C. leaves the journey running on the server', async () => {
        const device = createDevice();
        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));

        await logout();

        expect(await getBusSession()).toBeNull();
        expect(device.server.get('TRIP-00004')?.status).toBe('STARTED');
        expect(device.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'START' }]);
        await device.sharing.stop();
    });

    it('D. does not stop location sharing — it keeps publishing after the sign-in is gone', async () => {
        const device = createDevice();
        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        await logout();
        await device.tick();
        await device.tick();

        expect(device.sharing.isSharing('TRIP-00004')).toBe(true);
        expect(device.published).toHaveLength(3);
        // Every publish after logout still names the trip, with the journey's
        // credential — the deleted sign-in token is never needed.
        expect(device.published.every((p) => p.tripId === 'TRIP-00004')).toBe(true);
        expect(device.published.every((p) => p.credential === sharingTokenFor('TRIP-00004'))).toBe(true);
        expect(device.published.some((p) => p.credential === SIGN_IN_TOKEN)).toBe(false);
        await device.sharing.stop();
    });

    it('keeps the sharing grant, so a closed and reopened app carries on sharing', async () => {
        const device = createDevice();
        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await logout();

        // A new app process on the same phone: a fresh service, same keystore.
        const stored = device.storedGrants.get('grant') as JourneySharingGrant;
        const published: Published[] = [];
        const relaunched = createJourneySharing({
            storage: { save: async () => {}, get: async () => stored, clear: async () => {} },
            readLocation: async () => READING,
            publish: async (busId, _l, credential, tripId) => {
                published.push({ busId, tripId, credential });
            },
            scheduler: manualScheduler().scheduler,
        });

        expect(await relaunched.restore()).toBe(true);
        await flush();

        expect(relaunched.isSharing('TRIP-00004')).toBe(true);
        expect(published).toEqual([{ busId: BUS_ID, tripId: 'TRIP-00004', credential: sharingTokenFor('TRIP-00004') }]);
        await relaunched.stop();
        await device.sharing.stop();
    });

    it('S. stops sharing by itself once the journey window has passed', async () => {
        const expired: JourneySharingGrant = {
            tripId: 'TRIP-00004',
            busId: BUS_ID,
            token: sharingTokenFor('TRIP-00004'),
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        };
        const cleared = jest.fn(async () => {});
        const service = createJourneySharing({
            storage: { save: async () => {}, get: async () => expired, clear: cleared },
            readLocation: async () => READING,
            publish: jest.fn(),
            scheduler: manualScheduler().scheduler,
        });

        expect(await service.restore()).toBe(false);
        expect(service.getSnapshot().isTracking).toBe(false);
        expect(cleared).toHaveBeenCalled();
    });
});

// ==================================================================
// Signing in again
// ==================================================================
describe('Signing in again', () => {
    async function startThenLogout() {
        const device = createDevice();
        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        await logout();
        await saveBusSession(SESSION); // Device Login again
        return device;
    }

    it('F. finds the active journey from the server', async () => {
        const device = await startThenLogout();

        const dashboard = device.signIn();

        expect(dashboard.active()?.trip.tripId).toBe('TRIP-00004');
        expect(tripsWithServerState(device.server).map((t) => tripCardState(t, dashboard.active()))).toEqual([
            'ACTIVE',
            'BLOCKED',
            'BLOCKED',
        ]);
        await device.sharing.stop();
    });

    it('G. finds sharing still running — attaching is a no-op, with no resume step', async () => {
        const device = await startThenLogout();
        const dashboard = device.signIn();

        expect(device.sharing.isSharing('TRIP-00004')).toBe(true);
        expect(await dashboard.controller.attachSharing()).toBe(true);
        expect(device.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'START' }]);
        await device.sharing.stop();
    });

    it('H. keeps the original startedAt', async () => {
        const device = await startThenLogout();

        expect(device.signIn().active()?.startedAt).toBe(SERVER_NOW.toISOString());
        await device.sharing.stop();
    });

    it('I. creates no second journey, and refuses to start another trip', async () => {
        const device = await startThenLogout();
        const dashboard = device.signIn();

        expect(await dashboard.controller.startJourney(tripNamed('TRIP-00004'))).toEqual({
            ok: false,
            reason: 'ANOTHER_JOURNEY_ACTIVE',
        });
        expect(await dashboard.controller.startJourney(tripNamed('TRIP-00008'))).toMatchObject({
            ok: false,
            reason: 'ANOTHER_JOURNEY_ACTIVE',
        });
        expect(device.persistCalls.filter((c) => c.action === 'START')).toHaveLength(1);
        await device.sharing.stop();
    });

    it('a different phone signing in as the bus attaches sharing for the running journey', async () => {
        const firstPhone = await startThenLogout();
        await firstPhone.sharing.stop(); // e.g. that phone was switched off

        const secondPhone = createDevice({ server: firstPhone.server });
        const dashboard = secondPhone.signIn();

        expect(await dashboard.controller.attachSharing()).toBe(true);
        await flush();

        expect(secondPhone.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'SHARE' }]);
        expect(secondPhone.published).toEqual([
            { busId: BUS_ID, tripId: 'TRIP-00004', credential: sharingTokenFor('TRIP-00004') },
        ]);
        expect(secondPhone.server.get('TRIP-00004')?.startedAt).toBe(SERVER_NOW.toISOString());
        await secondPhone.sharing.stop();
    });

    it('S. does not find a journey past its scheduled arrival + grace, or one that was ended', () => {
        // Started only an hour ago (early), but its scheduled service is over.
        const expired = startedRecord(new Date(Date.now() - HOUR), -60_000);
        const ended: TripJourneyRecord = {
            ...startedRecord(),
            status: 'ENDED',
            endedAt: SERVER_NOW.toISOString(),
        };

        expect(findActiveJourney([{ ...tripNamed('TRIP-00004'), journey: expired }])).toBeNull();
        expect(findActiveJourney([{ ...tripNamed('TRIP-00004'), journey: ended }])).toBeNull();
    });
});

// ==================================================================
// End Journey
// ==================================================================
describe('End Journey', () => {
    it('J. saves the end on the server first, then stops location sharing', async () => {
        const device = createDevice();
        const dashboard = device.signIn();
        await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        const result = await dashboard.controller.endJourney();
        await device.tick();

        expect(result).toEqual({ ok: true });
        expect(device.persistCalls.map((c) => c.action)).toEqual(['START', 'END']);
        expect(device.server.get('TRIP-00004')?.status).toBe('ENDED');
        expect(device.sharing.getSnapshot().isTracking).toBe(false);
        expect(device.storedGrants.size).toBe(0);
        expect(dashboard.active()).toBeNull();
        expect(device.published).toHaveLength(1);
    });

    it('J. works the same after logging out and back in', async () => {
        const device = createDevice();
        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await logout();
        await saveBusSession(SESSION);

        expect(await device.signIn().controller.endJourney()).toEqual({ ok: true });
        expect(device.sharing.getSnapshot().isTracking).toBe(false);
        expect(device.server.get('TRIP-00004')?.status).toBe('ENDED');
    });

    it('K. when the end cannot be saved, the journey stays active and sharing continues', async () => {
        const device = createDevice();
        const dashboard = device.signIn();
        await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        device.failNextWith(new TripJourneyError('NETWORK_UNAVAILABLE', 'Network error.'));

        const result = await dashboard.controller.endJourney();
        await device.tick();

        expect(result).toEqual({ ok: false, reason: 'FAILED', message: 'Network error.' });
        expect(device.server.get('TRIP-00004')?.status).toBe('STARTED');
        expect(dashboard.active()?.trip.tripId).toBe('TRIP-00004');
        expect(device.sharing.isSharing('TRIP-00004')).toBe(true);
        expect(device.published).toHaveLength(2);
        expect(device.storedGrants.get('grant')).toBeDefined();
        await device.sharing.stop();
    });

    it('catches up when the server says the journey is no longer running', async () => {
        const device = createDevice();
        const dashboard = device.signIn();
        await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        device.failNextWith(new TripJourneyError('JOURNEY_NOT_STARTED', 'This journey has not been started.'));

        expect(await dashboard.controller.endJourney()).toEqual({ ok: true });
        expect(device.sharing.getSnapshot().isTracking).toBe(false);
        expect(dashboard.active()).toBeNull();
    });

    it('does nothing when nothing is running', async () => {
        const device = createDevice();

        expect(await device.signIn().controller.endJourney()).toEqual({ ok: false, reason: 'NO_ACTIVE_JOURNEY' });
        expect(device.persistCalls).toEqual([]);
    });
});

// ==================================================================
// One journey at a time
// ==================================================================
describe('One journey at a time', () => {
    it('refuses a second trip while one is running, without asking the server', async () => {
        const device = createDevice();
        const dashboard = device.signIn();

        await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        const second = await dashboard.controller.startJourney(tripNamed('TRIP-00008'));
        await flush();

        expect(second).toEqual({ ok: false, reason: 'ANOTHER_JOURNEY_ACTIVE' });
        expect(device.persistCalls).toEqual([{ tripId: 'TRIP-00004', action: 'START' }]);
        expect(device.published.map((p) => p.tripId)).toEqual(['TRIP-00004']);
        await device.sharing.stop();
    });

    it('reports the server refusing because another trip of this bus is running', async () => {
        const device = createDevice();
        device.failNextWith(new TripJourneyError('ANOTHER_JOURNEY_ACTIVE', 'This bus is already running another trip.'));

        const result = await device.signIn().controller.startJourney(tripNamed('TRIP-00008'));

        expect(result).toMatchObject({ ok: false, reason: 'ANOTHER_JOURNEY_ACTIVE' });
        expect(device.sharing.getSnapshot().isTracking).toBe(false);
    });

    it('ignores a double press while the first start is still being saved', async () => {
        const device = createDevice();
        const dashboard = device.signIn();

        const [first, second] = await Promise.all([
            dashboard.controller.startJourney(tripNamed('TRIP-00004')),
            dashboard.controller.startJourney(tripNamed('TRIP-00008')),
        ]);

        expect(first.ok).toBe(true);
        expect(second).toEqual({ ok: false, reason: 'IN_PROGRESS' });
        expect(device.persistCalls).toHaveLength(1);
        await device.sharing.stop();
    });

    it('never restarts a running trip when its own button is pressed again', () => {
        const running = findActiveJourney([
            {
                ...tripNamed('TRIP-00004'),
                journey: startedRecord(),
            },
        ]);

        expect(startRefusal(running, tripNamed('TRIP-00004'), BUS_ID)).toBe('ANOTHER_JOURNEY_ACTIVE');
    });

    it('starting Trip A never associates Trip B, and B only after A has ended', async () => {
        const device = createDevice();
        const dashboard = device.signIn();

        await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        await dashboard.controller.endJourney();
        await dashboard.controller.startJourney(tripNamed('TRIP-00008'));
        await flush();
        await device.tick();

        expect(device.published.map((p) => p.tripId)).toEqual(['TRIP-00004', 'TRIP-00008', 'TRIP-00008']);
        expect(device.published.map((p) => p.credential)).toEqual([
            sharingTokenFor('TRIP-00004'),
            sharingTokenFor('TRIP-00008'),
            sharingTokenFor('TRIP-00008'),
        ]);
        await device.sharing.stop();
    });
});

// ==================================================================
// The existing permission flow and live map
// ==================================================================
describe('Existing location flow, reused', () => {
    it('asks for location permission the existing way, and publishes nothing when refused', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
        const device = createDevice({ readLocation: getCurrentPhoneLocation });

        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
        expect(device.published).toEqual([]);

        // The journey is started regardless; the card shows the real problem
        // and its fix, and never claims sharing is working.
        const { state, isTracking } = device.sharing.getSnapshot();
        expect(state.status).toBe('PERMISSION_DENIED');
        expect(device.server.get('TRIP-00004')?.status).toBe('STARTED');
        const view = describeTrackingCard(state, isTracking);
        expect(view.title).not.toBe('Tracking active');
        expect(view.primaryAction?.kind).toBe('OPEN_SETTINGS');
        expect(view.trackingAction).toEqual({ kind: 'STOP_TRACKING', label: 'End Journey' });
        await device.sharing.stop();
    });

    it('publishes the real fix once permission is granted', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockResolvedValue({
            coords: { latitude: READING.latitude, longitude: READING.longitude },
            timestamp: Date.parse(READING.recordedAt),
        });
        const device = createDevice({ readLocation: getCurrentPhoneLocation });

        await device.signIn().controller.startJourney(tripNamed('TRIP-00004'));
        await flush();

        expect(device.published.map((p) => p.tripId)).toEqual(['TRIP-00004']);
        await device.sharing.stop();
    });

    it('shows the existing live map, readings and "Tracking active" while the journey runs — including after logout', async () => {
        const device = createDevice();
        const dashboard = device.signIn();

        await dashboard.controller.startJourney(tripNamed('TRIP-00004'));
        await flush();
        await logout();
        await device.tick();

        const { state, isTracking } = device.sharing.getSnapshot();
        const map = describeBusMap(state, isTracking);
        const card = describeTrackingCard(state, isTracking);

        expect(map.visible).toBe(true);
        expect(map.freshness).toBe('LIVE');
        expect(map.marker).toEqual({ latitude: READING.latitude, longitude: READING.longitude });
        expect(card.title).toBe('Tracking active');
        expect(card.trackingAction?.label).toBe('End Journey');

        await saveBusSession(SESSION);
        await device.signIn().controller.endJourney();
        const after = device.sharing.getSnapshot();
        expect(describeBusMap(after.state, after.isTracking).visible).toBe(false);
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
