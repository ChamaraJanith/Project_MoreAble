// The periodic tracking loop (MOV-267).
//
// One cycle is already covered by `locationPublishCycle.test.ts`, so the cycle
// itself is substituted here and what remains is the loop: does it repeat, does
// it stop, and can it ever run two rounds at once.
//
// Time is injected rather than faked globally. The tracker takes a scheduler,
// so a test holds the timers itself and fires them deliberately — no real
// waiting, and no ambiguity about whether a tick was due.
//
// The properties worth stating outright, because each is a real failure mode
// for a phone left running a whole shift:
//
//   * two cycles never overlap — the next is scheduled only after the last ends
//   * one tracker never runs two loops, however often start() is called
//   * stop() is final: no further read, no further publish, no further state
//   * a cycle already in flight when tracking stops cannot revive the loop

import {
    PublishCycleOutcome,
    PhoneLocationStateUpdate,
} from '../../../src/features/driver/utils/locationPublishCycle';
import {
    DEFAULT_TRACKING_INTERVAL_MS,
    MINIMUM_TRACKING_INTERVAL_MS,
    TrackingScheduler,
    TrackingStopReason,
    createLocationTracker,
} from '../../../src/features/driver/utils/locationTracker';
import {
    PhoneLocationState,
    initialPhoneLocationState,
} from '../../../src/features/driver/utils/phoneLocationState';

// The tracker's own module graph reaches the publish cycle, which imports the
// device GPS and keystore services for their real implementations. The cycle is
// substituted in every test below, so neither is exercised.
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

type Timer = ReturnType<typeof setTimeout>;

/** Lets pending promise callbacks run before a test inspects the result. */
function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A clock the test drives.
 *
 * Holds whatever the tracker scheduled and fires it only when asked, so "did it
 * schedule another round?" is a question with a definite answer.
 */
function manualClock() {
    let nextId = 1;
    const pending = new Map<number, { run: () => void; delayMs: number }>();

    const scheduler: TrackingScheduler = {
        setTimer: (run, delayMs) => {
            const id = nextId++;
            pending.set(id, { run, delayMs });
            return id as unknown as Timer;
        },
        clearTimer: (timer) => {
            pending.delete(timer as unknown as number);
        },
    };

    return {
        scheduler,
        /** How many ticks are waiting. More than one would mean stacked timers. */
        pendingCount: () => pending.size,
        scheduledDelays: () => Array.from(pending.values(), (entry) => entry.delayMs),
        /** Fires everything currently due and lets the cycle it starts finish. */
        async tick(): Promise<void> {
            const due = Array.from(pending.values());
            pending.clear();
            due.forEach((entry) => entry.run());
            await settle();
        },
    };
}

/**
 * A stand-in cycle whose outcome and timing the test controls.
 *
 * `hold()` makes the next cycle hang so a test can act while one is genuinely
 * in flight — which is the only way to prove that overlapping is prevented and
 * that stopping mid-flight is safe.
 */
function fakeCycle() {
    const outcomes: PublishCycleOutcome[] = [];
    let held: ((outcome: PublishCycleOutcome) => void) | null = null;
    let holdNext = false;
    let started = 0;
    let updates: PhoneLocationStateUpdate[] = [];

    const cycle = jest.fn(async (update: PhoneLocationStateUpdate) => {
        started += 1;
        updates.push(update);

        if (holdNext) {
            holdNext = false;
            return new Promise<PublishCycleOutcome>((resolve) => {
                held = resolve;
            });
        }

        return outcomes.shift() ?? 'PUBLISHED';
    });

    return {
        cycle: cycle as unknown as typeof import('../../../src/features/driver/utils/locationPublishCycle').runPublishCycle,
        /** Number of cycles started — one per publish attempt. */
        started: () => started,
        /** Queues the outcome each subsequent cycle will report. */
        willReport: (...queued: PublishCycleOutcome[]) => outcomes.push(...queued),
        /** Makes the next cycle hang until `release` is called. */
        hold: () => {
            holdNext = true;
        },
        release: async (outcome: PublishCycleOutcome = 'PUBLISHED') => {
            held?.(outcome);
            held = null;
            await settle();
        },
        /** The updater handed to the cycle that is currently in flight. */
        latestUpdate: () => updates[updates.length - 1],
        reset: () => {
            updates = [];
        },
    };
}

function trackerHarness(options: { intervalMs?: number } = {}) {
    const clock = manualClock();
    const cycles = fakeCycle();
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
        cycle: cycles.cycle,
        intervalMs: options.intervalMs ?? MINIMUM_TRACKING_INTERVAL_MS,
    });

    return { tracker, clock, cycles, states, stops };
}

// ==================================================================
// TRACKING STARTS AND REPEATS
// ==================================================================
describe('createLocationTracker - starting', () => {
    it('does nothing until it is started', async () => {
        const { clock, cycles } = trackerHarness();

        await settle();

        // Building a tracker must not publish anything. A screen can hold one
        // without being a screen that is broadcasting.
        expect(cycles.started()).toBe(0);
        expect(clock.pendingCount()).toBe(0);
    });

    it('publishes immediately on start rather than after the first interval', async () => {
        const { tracker, cycles } = trackerHarness();

        tracker.start();
        await settle();

        expect(cycles.started()).toBe(1);
        expect(tracker.isTracking()).toBe(true);
    });

    it('keeps publishing, one round per interval', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        tracker.start();
        await settle();
        expect(cycles.started()).toBe(1);

        await clock.tick();
        expect(cycles.started()).toBe(2);

        await clock.tick();
        await clock.tick();
        expect(cycles.started()).toBe(4);
    });

    it('waits the configured gap between rounds', async () => {
        const { tracker, clock } = trackerHarness({ intervalMs: 30_000 });

        tracker.start();
        await settle();

        expect(clock.scheduledDelays()).toEqual([30_000]);
    });

    it('defaults to the project interval and refuses a gap below the floor', async () => {
        const withDefault = manualClock();
        createLocationTracker({
            update: () => {},
            scheduler: withDefault.scheduler,
            cycle: fakeCycle().cycle,
        }).start();
        await settle();

        expect(withDefault.scheduledDelays()).toEqual([DEFAULT_TRACKING_INTERVAL_MS]);

        // A mistaken 0 must not become a hot loop against the endpoint.
        const clamped = manualClock();
        createLocationTracker({
            update: () => {},
            scheduler: clamped.scheduler,
            cycle: fakeCycle().cycle,
            intervalMs: 0,
        }).start();
        await settle();

        expect(clamped.scheduledDelays()).toEqual([MINIMUM_TRACKING_INTERVAL_MS]);
    });
});

// ==================================================================
// NEVER TWO AT ONCE
// ==================================================================
describe('createLocationTracker - one round at a time', () => {
    it('schedules the next round only once the last has finished', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        cycles.hold();
        tracker.start();
        await settle();

        // While a round is in flight there is no timer waiting behind it, so a
        // slow fix cannot have a second round land on top of it.
        expect(cycles.started()).toBe(1);
        expect(clock.pendingCount()).toBe(0);

        await cycles.release();

        expect(clock.pendingCount()).toBe(1);
    });

    it('cannot be made to overlap by time passing during a slow round', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        cycles.hold();
        tracker.start();
        await settle();

        // A whole interval's worth of ticking while the round is stuck.
        await clock.tick();
        await clock.tick();
        await clock.tick();

        // Still exactly one round: there was no timer to fire.
        expect(cycles.started()).toBe(1);

        await cycles.release();
        expect(cycles.started()).toBe(1);
        expect(clock.pendingCount()).toBe(1);
    });

    it('runs one loop however many times start is called', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        tracker.start();
        tracker.start();
        tracker.start();
        await settle();

        expect(cycles.started()).toBe(1);
        // One pending tick, not three racing timers.
        expect(clock.pendingCount()).toBe(1);

        await clock.tick();
        expect(cycles.started()).toBe(2);
        expect(clock.pendingCount()).toBe(1);
    });

    it('leaves exactly one pending tick after every round', async () => {
        const { tracker, clock } = trackerHarness();

        tracker.start();
        await settle();

        for (let round = 0; round < 5; round += 1) {
            expect(clock.pendingCount()).toBe(1);
            await clock.tick();
        }

        expect(clock.pendingCount()).toBe(1);
    });
});

// ==================================================================
// STOPPING AND CLEANUP
// ==================================================================
describe('createLocationTracker - stopping', () => {
    it('publishes nothing further once stopped', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        tracker.start();
        await settle();
        await clock.tick();
        expect(cycles.started()).toBe(2);

        tracker.stop();

        expect(tracker.isTracking()).toBe(false);
        // The pending tick is cancelled, not merely ignored.
        expect(clock.pendingCount()).toBe(0);

        await clock.tick();
        await clock.tick();
        expect(cycles.started()).toBe(2);
    });

    it('reports why it stopped', async () => {
        const { tracker, stops } = trackerHarness();

        tracker.start();
        await settle();
        tracker.stop();

        expect(stops).toEqual(['REQUESTED']);
    });

    it('stops only once, however often stop is called', async () => {
        const { tracker, stops } = trackerHarness();

        tracker.start();
        await settle();
        tracker.stop();
        tracker.stop();
        tracker.stop();

        expect(stops).toEqual(['REQUESTED']);
    });

    it('stopping something that never started does nothing', () => {
        const { tracker, stops } = trackerHarness();

        tracker.stop();

        expect(stops).toEqual([]);
        expect(tracker.isTracking()).toBe(false);
    });

    it('a round still in flight when tracking stops cannot restart the loop', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        cycles.hold();
        tracker.start();
        await settle();

        tracker.stop();

        // The round finishes after the stop — a reply arriving from a request
        // that was already on its way.
        await cycles.release('PUBLISHED');

        // It must not schedule a successor.
        expect(clock.pendingCount()).toBe(0);
        expect(tracker.isTracking()).toBe(false);

        await clock.tick();
        expect(cycles.started()).toBe(1);
    });

    it('a round still in flight when tracking stops cannot write state', async () => {
        const { tracker, cycles, states } = trackerHarness();

        cycles.hold();
        tracker.start();
        await settle();

        const updateFromStoppedRound = cycles.latestUpdate();
        const seenBefore = states.length;

        tracker.stop();

        // This is what a component unmounting looks like: cleanup has run, and
        // then a late reply tries to set state on a screen that is gone.
        updateFromStoppedRound(() => ({ status: 'PUBLISHED', location: null }));
        await cycles.release();

        expect(states.length).toBe(seenBefore);
    });

    it('can be started again after stopping, without the old run interfering', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        // The first round is left hanging, then abandoned.
        cycles.hold();
        tracker.start();
        await settle();
        tracker.stop();

        // The second run starts cleanly and gets its own tick waiting.
        tracker.start();
        await settle();
        expect(cycles.started()).toBe(2);
        expect(tracker.isTracking()).toBe(true);
        expect(clock.pendingCount()).toBe(1);

        // Now the abandoned first round finally finishes. It belongs to a run
        // that no longer exists, so it must not add a second timer alongside
        // the live one — that is exactly how a loop ends up running twice.
        await cycles.release();

        expect(clock.pendingCount()).toBe(1);

        // And the live loop is unharmed: one round per tick, still.
        await clock.tick();
        expect(cycles.started()).toBe(3);
        expect(clock.pendingCount()).toBe(1);
    });
});

// ==================================================================
// FAILURES ALONG THE WAY
// ==================================================================
describe('createLocationTracker - temporary failures', () => {
    it('keeps tracking when the phone cannot get a fix', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        cycles.willReport('LOCATION_UNAVAILABLE', 'LOCATION_UNAVAILABLE');

        tracker.start();
        await settle();
        await clock.tick();

        // A tunnel or a car park must not end the shift's tracking.
        expect(tracker.isTracking()).toBe(true);
        expect(clock.pendingCount()).toBe(1);

        await clock.tick();
        expect(cycles.started()).toBe(3);
    });

    it('keeps tracking when a publish fails, and recovers on a later round', async () => {
        const { tracker, clock, cycles } = trackerHarness();

        cycles.willReport('PUBLISH_FAILED', 'PUBLISH_FAILED', 'PUBLISHED');

        tracker.start();
        await settle();
        await clock.tick();
        await clock.tick();

        expect(cycles.started()).toBe(3);
        expect(tracker.isTracking()).toBe(true);
        // Still going after the recovery, too.
        expect(clock.pendingCount()).toBe(1);
    });

    it('survives a cycle that throws instead of reporting an outcome', async () => {
        const clock = manualClock();
        const throwingCycle = jest
            .fn()
            .mockRejectedValueOnce(new Error('unexpected'))
            .mockResolvedValue('PUBLISHED');

        const tracker = createLocationTracker({
            update: () => {},
            scheduler: clock.scheduler,
            cycle: throwingCycle as never,
            intervalMs: MINIMUM_TRACKING_INTERVAL_MS,
        });

        tracker.start();
        await settle();

        expect(tracker.isTracking()).toBe(true);
        expect(clock.pendingCount()).toBe(1);

        await clock.tick();
        expect(throwingCycle).toHaveBeenCalledTimes(2);
    });
});

// ==================================================================
// NO SESSION MEANS NO LOOP
// ==================================================================
describe('createLocationTracker - a phone that is not signed in', () => {
    it('stops rather than retrying a bus that has to sign in again', async () => {
        const { tracker, clock, cycles, stops } = trackerHarness();

        cycles.willReport('NOT_SIGNED_IN');

        tracker.start();
        await settle();

        expect(tracker.isTracking()).toBe(false);
        expect(stops).toEqual(['NOT_SIGNED_IN']);
        // No pending tick: every further round would be refused identically,
        // and retrying on a timer would be requests that cannot ever succeed.
        expect(clock.pendingCount()).toBe(0);

        await clock.tick();
        expect(cycles.started()).toBe(1);
    });

    it('stops mid-shift if the session stops being usable', async () => {
        const { tracker, clock, cycles, stops } = trackerHarness();

        cycles.willReport('PUBLISHED', 'PUBLISHED', 'NOT_SIGNED_IN');

        tracker.start();
        await settle();
        await clock.tick();
        expect(tracker.isTracking()).toBe(true);

        await clock.tick();

        expect(cycles.started()).toBe(3);
        expect(tracker.isTracking()).toBe(false);
        expect(stops).toEqual(['NOT_SIGNED_IN']);
        expect(clock.pendingCount()).toBe(0);
    });
});
