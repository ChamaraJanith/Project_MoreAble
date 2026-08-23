// Publishing the bus position over and over while a shift is running (MOV-267).
//
// MOV-265 made one press send one position. This repeats that cycle for as long
// as tracking is on, and stops completely when it is off.
//
// FOREGROUND ONLY. There is no TaskManager, no background fetch and no
// OS-level background location permission here: this runs while the driver has
// the app open, which is what the existing location permission already covers.
//
// WHY A SELF-SCHEDULING TIMEOUT AND NOT setInterval.
// `setInterval` fires on a fixed clock whether or not the previous round
// finished. On a weak signal a GPS fix plus a round trip can easily outlast the
// gap, and the intervals would stack up into overlapping publishes racing each
// other to the same document. Here the next tick is scheduled only once the
// previous one has finished, so the gap is measured end-to-start and two cycles
// structurally cannot overlap — the guarantee comes from the shape of the loop
// rather than from a flag someone has to remember to check.

import {
    PhoneLocationStateUpdate,
    PublishCycleDependencies,
    PublishCycleOutcome,
    runPublishCycle,
} from './locationPublishCycle';

/**
 * How long to wait between publishes.
 *
 * Taken from what the rest of the project already does rather than picked from
 * the air. The passenger-facing age line (`formatLocationAge`, MOV-119) reports
 * anything under a minute as "Updated just now", so a minute is the coarsest
 * useful gap and anything far below it buys no visible freshness. The only
 * existing repeat-poll in the codebase runs at 15 seconds, and that one is a
 * local store read rather than a GPS fix plus an authenticated write.
 *
 * 30 seconds sits between the two: comfortably inside the "just now" bucket
 * even after a slow fix and a round trip, at half the request rate of that
 * existing poll, and roughly 250 metres of city driving between reports. It is
 * the gap BETWEEN cycles, so a slow round trip stretches it rather than
 * doubling up behind it.
 */
export const DEFAULT_TRACKING_INTERVAL_MS = 30_000;

/**
 * A floor on the gap, so a mistaken 0 cannot turn the loop into a hot loop
 * hammering the endpoint.
 */
export const MINIMUM_TRACKING_INTERVAL_MS = 5_000;

/** Why the loop stopped, for a screen that wants to explain it. */
export type TrackingStopReason =
    /** Someone called `stop()` — the driver, or a screen going away. */
    | 'REQUESTED'
    /** No usable bus session, so no further tick could ever succeed. */
    | 'NOT_SIGNED_IN';

type TrackingTimer = ReturnType<typeof setTimeout>;

/**
 * The clock, injectable so tests can advance time deterministically instead of
 * waiting real seconds.
 */
export interface TrackingScheduler {
    setTimer: (run: () => void, delayMs: number) => TrackingTimer;
    clearTimer: (timer: TrackingTimer) => void;
}

const REAL_SCHEDULER: TrackingScheduler = {
    setTimer: (run, delayMs) => setTimeout(run, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
};

export interface LocationTrackerOptions {
    /** Where each cycle's state transitions go. */
    update: PhoneLocationStateUpdate;
    /** Defaults to `DEFAULT_TRACKING_INTERVAL_MS`; clamped to the minimum. */
    intervalMs?: number;
    /** Called once when the loop stops, whichever way it stopped. */
    onStop?: (reason: TrackingStopReason) => void;
    dependencies?: PublishCycleDependencies;
    scheduler?: TrackingScheduler;
    /** The cycle to repeat. Substituted only by tests. */
    cycle?: typeof runPublishCycle;
}

export interface LocationTracker {
    /** Starts tracking and publishes immediately. A no-op while already on. */
    start: () => void;
    /** Stops tracking. Nothing further is read or published. */
    stop: () => void;
    isTracking: () => boolean;
}

function normaliseInterval(intervalMs?: number): number {
    if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
        return DEFAULT_TRACKING_INTERVAL_MS;
    }

    return Math.max(intervalMs, MINIMUM_TRACKING_INTERVAL_MS);
}

/**
 * Builds a tracking loop.
 *
 * Creating one starts nothing — the loop only runs between `start()` and
 * `stop()`, so a screen holding a tracker is not yet a screen publishing
 * anything.
 *
 * ONE LOOP AT A TIME. `start()` while already tracking does nothing, so no
 * amount of pressing can produce two loops against the same tracker.
 *
 * DETERMINISTIC CLEANUP. `stop()` cancels the pending tick and increments a run
 * counter. Every scheduled callback and every state update carries the counter
 * it was created under and does nothing once that no longer matches, so a cycle
 * already awaiting a GPS fix or a server reply when tracking stops cannot
 * publish a successor, cannot schedule one, and cannot write state into a
 * component that has unmounted. The same counter makes stop-then-start clean:
 * the old run is orphaned rather than joining the new one.
 */
export function createLocationTracker(options: LocationTrackerOptions): LocationTracker {
    const intervalMs = normaliseInterval(options.intervalMs);
    const scheduler = options.scheduler ?? REAL_SCHEDULER;
    const cycle = options.cycle ?? runPublishCycle;

    /** Bumped by every start and every stop. Identifies the current run. */
    let generation = 0;
    let tracking = false;
    let pendingTick: TrackingTimer | null = null;

    function cancelPendingTick(): void {
        if (pendingTick !== null) {
            scheduler.clearTimer(pendingTick);
            pendingTick = null;
        }
    }

    function stopTracking(reason: TrackingStopReason): void {
        if (!tracking) return;

        tracking = false;
        // Orphans anything still in flight before any awaiting code resumes.
        generation += 1;
        cancelPendingTick();
        options.onStop?.(reason);
    }

    function scheduleNextTick(run: number): void {
        pendingTick = scheduler.setTimer(() => {
            pendingTick = null;
            if (run !== generation) return;
            void runTick(run);
        }, intervalMs);
    }

    async function runTick(run: number): Promise<void> {
        // State from a run that has been stopped is dropped rather than
        // applied. This is what makes an unmount safe: the component's setter
        // is never called again once cleanup has run.
        const guardedUpdate: PhoneLocationStateUpdate = (reduce) => {
            if (run !== generation) return;
            options.update(reduce);
        };

        let outcome: PublishCycleOutcome;

        try {
            outcome = await cycle(guardedUpdate, options.dependencies);
        } catch {
            // `runPublishCycle` is written not to throw. If something upstream
            // ever does, one bad tick must not silently end a shift's tracking,
            // so it is treated as a temporary failure.
            outcome = 'PUBLISH_FAILED';
        }

        // Stopped while this cycle was in flight: do not schedule a successor.
        if (run !== generation) return;

        if (outcome === 'NOT_SIGNED_IN') {
            // Every further tick would fail the same way, so this stops rather
            // than retrying a phone that has to sign in again first.
            stopTracking('NOT_SIGNED_IN');
            return;
        }

        // A failed fix or a failed publish keeps the loop alive: both are
        // routinely temporary — a tunnel, a dead spot — and a driver should not
        // have to notice and restart tracking because of one.
        scheduleNextTick(run);
    }

    return {
        start(): void {
            if (tracking) return;

            tracking = true;
            generation += 1;
            // Publishes at once rather than after the first interval, so
            // turning tracking on visibly does something.
            void runTick(generation);
        },

        stop(): void {
            stopTracking('REQUESTED');
        },

        isTracking(): boolean {
            return tracking;
        },
    };
}
