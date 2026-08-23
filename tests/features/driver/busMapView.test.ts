// What the dashboard map may draw (MOV-262).
//
// A map is persuasive in a way a number is not: a marker on a road says "the
// bus is here" whether or not that is still true. So most of what is pinned
// down below is when NOT to draw one — no fallback coordinate, no default
// position, nothing after the bus signs out, and an older fix never dressed up
// as a live one.
//
// The second half drives the REAL MOV-267 tracker through a shift and reads the
// map at every step, because the rules only matter against the states the
// engine actually emits.
//
// The project has no React renderer, so `BusLocationMap` itself is not mounted
// here. Everything it renders from is decided by `busMapView`, which is exactly
// why that logic is not inside the component.
//
// No value below is a literal credential. Session values come from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name. Coordinates are ordinary geographic test data.

import { PublishLocationError } from '../../../src/features/driver/api/busLocationApi';
import { describeBusMap, nextLastKnownLocation } from '../../../src/features/driver/utils/busMapView';
import { PublishCycleDependencies } from '../../../src/features/driver/utils/locationPublishCycle';
import {
    MINIMUM_TRACKING_INTERVAL_MS,
    TrackingScheduler,
    createLocationTracker,
} from '../../../src/features/driver/utils/locationTracker';
import {
    PhoneLocationState,
    PhoneLocationStatus,
    initialPhoneLocationState,
} from '../../../src/features/driver/utils/phoneLocationState';
import { PhoneLocation, PhoneLocationError } from '../../../src/shared/utils/phoneLocation';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const COLOMBO: PhoneLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

/** A little further along the road. */
const MOVED: PhoneLocation = {
    latitude: 6.9153,
    longitude: 79.9742,
    recordedAt: '2026-08-20T09:05:30.000Z',
};

function stateOf(status: PhoneLocationStatus, location: PhoneLocation | null = null) {
    return { status, location } as PhoneLocationState;
}

// ==================================================================
// NOTHING IS EVER INVENTED
// ==================================================================
describe('describeBusMap - a marker is only ever a real reading', () => {
    it('draws nothing when the phone has never had a fix', () => {
        const map = describeBusMap(stateOf('REQUESTING'), true);

        expect(map.marker).toBeNull();
        // The frame is still there so the card does not jump, but it holds no
        // position — there is no default place a bus could be.
        expect(map.visible).toBe(true);
        expect(map.caption).toMatch(/waiting/i);
    });

    it('draws the reading it was given, unchanged', () => {
        const map = describeBusMap(stateOf('PUBLISHED', COLOMBO), true);

        expect(map.marker).toEqual({ latitude: COLOMBO.latitude, longitude: COLOMBO.longitude });
        expect(map.freshness).toBe('LIVE');
    });

    it('copies only the coordinates, carrying nothing else into the map layer', () => {
        const map = describeBusMap(stateOf('PUBLISHED', COLOMBO), true);

        expect(Object.keys(map.marker!).sort()).toEqual(['latitude', 'longitude']);
        // The fix time belongs to the state and the backend, not to a pin.
        expect(JSON.stringify(map.marker)).not.toContain(COLOMBO.recordedAt);
    });

    it.each([
        ['not a number', { latitude: Number.NaN, longitude: 79.9 }],
        ['infinite', { latitude: Number.POSITIVE_INFINITY, longitude: 79.9 }],
        ['off the planet in latitude', { latitude: 95, longitude: 79.9 }],
        ['off the planet in longitude', { latitude: 6.9, longitude: 250 }],
    ])('refuses to draw a coordinate that is %s', (_label, broken) => {
        const map = describeBusMap(
            stateOf('PUBLISHED', { ...broken, recordedAt: COLOMBO.recordedAt } as PhoneLocation),
            true
        );

        expect(map.marker).toBeNull();
    });

    it('moves the marker when a newer reading arrives', () => {
        const first = describeBusMap(stateOf('PUBLISHED', COLOMBO), true);
        const second = describeBusMap(stateOf('PUBLISHED', MOVED), true);

        expect(first.marker).not.toEqual(second.marker);
        expect(second.marker).toEqual({ latitude: MOVED.latitude, longitude: MOVED.longitude });
    });
});

// ==================================================================
// TRACKING OFF, AND SIGNED OUT
// ==================================================================
describe('describeBusMap - when there must be no map at all', () => {
    it('shows no map while tracking is off', () => {
        const map = describeBusMap(stateOf('PUBLISHED', COLOMBO), false);

        // Nothing is being updated, so a marker could only claim something that
        // is not currently true.
        expect(map.visible).toBe(false);
        expect(map.marker).toBeNull();
    });

    it('shows no map, and no position, once the bus is signed out', () => {
        const map = describeBusMap(stateOf('NOT_SIGNED_IN', COLOMBO), true);

        expect(map.visible).toBe(false);
        expect(map.marker).toBeNull();
    });

    it('will not fall back to a remembered position when tracking is off', () => {
        const map = describeBusMap(stateOf('IDLE'), false, COLOMBO);

        expect(map.visible).toBe(false);
        expect(map.marker).toBeNull();
    });

    it('will not fall back to a remembered position once signed out', () => {
        const map = describeBusMap(stateOf('NOT_SIGNED_IN'), true, COLOMBO);

        expect(map.marker).toBeNull();
    });
});

// ==================================================================
// A POSITION THAT IS NOT LIVE IS SAID TO BE SO
// ==================================================================
describe('describeBusMap - how fresh the marker is', () => {
    it('falls back to the last known position when a fix fails', () => {
        const map = describeBusMap(stateOf('POSITION_UNAVAILABLE'), true, COLOMBO);

        expect(map.marker).toEqual({ latitude: COLOMBO.latitude, longitude: COLOMBO.longitude });
        expect(map.freshness).toBe('LAST_KNOWN');
        // Never presented as where the bus is — only where it last was.
        expect(map.caption).toMatch(/last known/i);
        expect(map.caption).not.toMatch(/live|current/i);
        expect(map.accessibilityLabel).toMatch(/last known/i);
    });

    it.each(['PERMISSION_DENIED', 'LOCATION_SERVICES_DISABLED', 'UNKNOWN_ERROR'] as const)(
        'marks the position stale after %s too',
        (status) => {
            const map = describeBusMap(stateOf(status), true, COLOMBO);

            expect(map.freshness).toBe('LAST_KNOWN');
        }
    );

    it('says a position has not been sent yet when publishing failed', () => {
        const map = describeBusMap(stateOf('PUBLISH_FAILED', COLOMBO), true);

        // The fix itself was fine, so the marker sits where the bus really is —
        // it is the sending that failed, and only the caption says so.
        expect(map.marker).toEqual({ latitude: COLOMBO.latitude, longitude: COLOMBO.longitude });
        expect(map.freshness).toBe('UNSENT');
        expect(map.caption).toMatch(/not sent/i);
        expect(map.caption).not.toMatch(/last known/i);
    });

    it('does not move the marker to a newer unpublished position it was never given', () => {
        // The map draws what the state holds and nothing else; there is no path
        // by which an unconfirmed position could be substituted here.
        const map = describeBusMap(stateOf('PUBLISH_FAILED', COLOMBO), true, MOVED);

        expect(map.marker).toEqual({ latitude: COLOMBO.latitude, longitude: COLOMBO.longitude });
    });

    it('prefers the current reading over the remembered one', () => {
        const map = describeBusMap(stateOf('PUBLISHED', MOVED), true, COLOMBO);

        expect(map.marker).toEqual({ latitude: MOVED.latitude, longitude: MOVED.longitude });
        expect(map.freshness).toBe('LIVE');
    });

    it('gives every visible state a caption, so no marker is ever unqualified', () => {
        const statuses: PhoneLocationStatus[] = [
            'IDLE',
            'REQUESTING',
            'AVAILABLE',
            'PUBLISHING',
            'PUBLISHED',
            'PERMISSION_DENIED',
            'LOCATION_SERVICES_DISABLED',
            'POSITION_UNAVAILABLE',
            'PUBLISH_FAILED',
            'UNKNOWN_ERROR',
        ];

        statuses.forEach((status) => {
            const map = describeBusMap(stateOf(status, COLOMBO), true, COLOMBO);

            expect(map.visible).toBe(true);
            expect(map.caption.length).toBeGreaterThan(0);
            expect(map.accessibilityLabel.length).toBeGreaterThan(0);
            // The picture is never the only way to know what is being shown.
            expect(map.accessibilityLabel).toMatch(/map/i);
        });
    });
});

// ==================================================================
// CARRYING A POSITION FORWARD
// ==================================================================
describe('nextLastKnownLocation', () => {
    it('remembers a real reading', () => {
        expect(nextLastKnownLocation(null, stateOf('PUBLISHED', COLOMBO), true)).toEqual(COLOMBO);
    });

    it('keeps the previous one when the state has none', () => {
        expect(nextLastKnownLocation(COLOMBO, stateOf('POSITION_UNAVAILABLE'), true)).toEqual(
            COLOMBO
        );
    });

    it('replaces it as the bus moves', () => {
        expect(nextLastKnownLocation(COLOMBO, stateOf('PUBLISHED', MOVED), true)).toEqual(MOVED);
    });

    it('forgets everything when tracking stops', () => {
        // So restarting begins with an empty map rather than flashing wherever
        // the phone happened to be last time.
        expect(nextLastKnownLocation(COLOMBO, stateOf('IDLE'), false)).toBeNull();
    });

    it('forgets everything when the bus signs out', () => {
        expect(nextLastKnownLocation(COLOMBO, stateOf('NOT_SIGNED_IN'), true)).toBeNull();
    });

    it('never remembers a coordinate that is not a real point on the Earth', () => {
        const broken = { latitude: Number.NaN, longitude: 79.9, recordedAt: '' } as PhoneLocation;

        expect(nextLastKnownLocation(COLOMBO, stateOf('PUBLISHED', broken), true)).toEqual(COLOMBO);
        expect(nextLastKnownLocation(null, stateOf('PUBLISHED', broken), true)).toBeNull();
    });
});

// ==================================================================
// THE MAP, DRIVEN BY THE REAL TRACKER
// ==================================================================
describe('the map through a whole shift', () => {
    function settle(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
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
            async tick() {
                const due = Array.from(pending.values());
                pending.clear();
                due.forEach((run) => run());
                await settle();
            },
        };
    }

    /** The real tracker and the real cycle, with the map read from their output. */
    function shift(overrides: Partial<PublishCycleDependencies> = {}) {
        const clock = manualClock();
        let state = initialPhoneLocationState;
        let remembered: PhoneLocation | null = null;

        const dependencies: PublishCycleDependencies = {
            readLocation: jest.fn().mockResolvedValue(COLOMBO),
            readSession: jest.fn().mockResolvedValue({
                busId: 'BUS-00003',
                numberPlate: 'NA-1234',
                token: nextUniqueValue(),
            }),
            publish: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        };

        const tracker = createLocationTracker({
            update: (reduce) => {
                state = reduce(state);
                // Exactly what the card does on each render.
                remembered = nextLastKnownLocation(remembered, state, tracker.isTracking());
            },
            dependencies,
            scheduler: clock.scheduler,
            intervalMs: MINIMUM_TRACKING_INTERVAL_MS,
        });

        return {
            tracker,
            clock,
            dependencies,
            map: () => describeBusMap(state, tracker.isTracking(), remembered),
        };
    }

    it('shows no map before the driver starts', () => {
        expect(shift().map().visible).toBe(false);
    });

    it('draws the bus where the tracker published it', async () => {
        const { tracker, map, dependencies } = shift();

        tracker.start();
        await settle();

        const [, published] = (dependencies.publish as jest.Mock).mock.calls[0];

        // The pin and the published position are the same fix — the map is a
        // view of what was sent, not a second source.
        expect(map().marker).toEqual({
            latitude: published.latitude,
            longitude: published.longitude,
        });
        expect(map().freshness).toBe('LIVE');
    });

    it('follows the bus as new readings come in', async () => {
        const readLocation = jest
            .fn()
            .mockResolvedValueOnce(COLOMBO)
            .mockResolvedValue(MOVED);

        const { tracker, clock, map } = shift({ readLocation });

        tracker.start();
        await settle();
        expect(map().marker).toEqual({ latitude: COLOMBO.latitude, longitude: COLOMBO.longitude });

        await clock.tick();
        expect(map().marker).toEqual({ latitude: MOVED.latitude, longitude: MOVED.longitude });
    });

    it('holds the last position through a lost fix, marked as stale, then recovers', async () => {
        const readLocation = jest
            .fn()
            .mockResolvedValueOnce(COLOMBO)
            .mockRejectedValueOnce(new PhoneLocationError('POSITION_UNAVAILABLE'))
            .mockResolvedValue(MOVED);

        const { tracker, clock, map } = shift({ readLocation });

        tracker.start();
        await settle();
        expect(map().freshness).toBe('LIVE');

        await clock.tick();
        expect(map().marker).toEqual({ latitude: COLOMBO.latitude, longitude: COLOMBO.longitude });
        expect(map().freshness).toBe('LAST_KNOWN');

        await clock.tick();
        expect(map().marker).toEqual({ latitude: MOVED.latitude, longitude: MOVED.longitude });
        expect(map().freshness).toBe('LIVE');
    });

    it('keeps the position visible but unconfirmed when sending fails', async () => {
        const publish = jest
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValue(new PublishLocationError('NETWORK_UNAVAILABLE'));

        const { tracker, clock, map } = shift({ publish });

        tracker.start();
        await settle();
        await clock.tick();

        expect(map().marker).not.toBeNull();
        expect(map().freshness).toBe('UNSENT');
    });

    it('clears the map when the driver stops', async () => {
        const { tracker, map } = shift();

        tracker.start();
        await settle();
        expect(map().marker).not.toBeNull();

        tracker.stop();

        expect(map().visible).toBe(false);
        expect(map().marker).toBeNull();
    });

    it('shows no bus location once the session has gone', async () => {
        const { tracker, map, dependencies } = shift({
            readSession: jest.fn().mockResolvedValue(null),
        });

        tracker.start();
        await settle();

        expect(tracker.isTracking()).toBe(false);
        expect(map().visible).toBe(false);
        expect(map().marker).toBeNull();
        expect(dependencies.publish).not.toHaveBeenCalled();
    });

    it('never draws a bus the tracker never reported', async () => {
        const { tracker, clock, map, dependencies } = shift({
            readLocation: jest
                .fn()
                .mockRejectedValue(new PhoneLocationError('PERMISSION_DENIED')),
        });

        tracker.start();
        await settle();
        await clock.tick();
        await clock.tick();

        // Three rounds, no fix, nothing published — and no pin.
        expect(map().marker).toBeNull();
        expect(dependencies.publish).not.toHaveBeenCalled();
    });
});
