// Holding a tracking loop inside a screen (MOV-267).
//
// The loop itself lives in `locationTracker`, which knows nothing about React.
// This is the small amount of wiring that gives it a component's lifetime: one
// tracker per mount, stopped on unmount, with the state it produces exposed as
// ordinary React state.
//
// It renders nothing and decides no wording. Showing "Tracking active",
// "Waiting for GPS" and the rest is MOV-268, which can read `state` and
// `isTracking` from here without touching the loop underneath.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    PhoneLocationStateUpdate,
    PublishCycleDependencies,
    runPublishCycle,
} from '../utils/locationPublishCycle';
import { LocationTracker, createLocationTracker } from '../utils/locationTracker';
import {
    PhoneLocationState,
    initialPhoneLocationState,
    isLocationRequestInFlight,
} from '../utils/phoneLocationState';

export interface UsePhoneLocationTrackingOptions {
    /** Overrides the default gap between publishes. */
    intervalMs?: number;
    /** Substituted only by tests; the app always uses the real services. */
    dependencies?: PublishCycleDependencies;
}

export interface PhoneLocationTracking {
    /** The latest state the flow produced, for the card to render. */
    state: PhoneLocationState;
    /** Whether the loop is currently running. */
    isTracking: boolean;
    /** Turns the loop on. Publishes immediately, then every interval. */
    startTracking: () => void;
    /** Turns the loop off. Nothing further is read or published. */
    stopTracking: () => void;
    /** One publish, for the manual button. Ignored while the loop is running. */
    publishOnce: () => void;
}

/**
 * Tracking, scoped to the component that uses it.
 *
 * The tracker is built once per mount, so a re-render cannot leave a second
 * loop behind, and the unmount cleanup stops it — which cancels the pending
 * tick and orphans any cycle still awaiting a reply, so nothing publishes or
 * calls a setter after the screen has gone.
 */
export function usePhoneLocationTracking(
    options?: UsePhoneLocationTrackingOptions
): PhoneLocationTracking {
    const [state, setState] = useState<PhoneLocationState>(initialPhoneLocationState);
    const [isTracking, setIsTracking] = useState(false);

    const intervalMs = options?.intervalMs;
    const dependencies = options?.dependencies;

    // Mirrors the state for the manual path, which has to check what is in
    // flight without the check re-creating the callback on every transition.
    const stateRef = useRef(state);
    stateRef.current = state;

    const mounted = useRef(true);

    /** Drops anything arriving after unmount. */
    const update = useCallback<PhoneLocationStateUpdate>((reduce) => {
        if (!mounted.current) return;
        setState(reduce);
    }, []);

    const tracker = useMemo<LocationTracker>(
        () =>
            createLocationTracker({
                update,
                intervalMs,
                dependencies,
                onStop: () => {
                    if (mounted.current) setIsTracking(false);
                },
            }),
        [update, intervalMs, dependencies]
    );

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
            tracker.stop();
        };
    }, [tracker]);

    const startTracking = useCallback(() => {
        tracker.start();
        setIsTracking(tracker.isTracking());
    }, [tracker]);

    const stopTracking = useCallback(() => {
        tracker.stop();
        setIsTracking(tracker.isTracking());
    }, [tracker]);

    const publishOnce = useCallback(() => {
        // The loop is already publishing on its own schedule; a manual press on
        // top of it would be the one way to get two cycles running at once.
        if (tracker.isTracking()) return;

        // One attempt at a time, covering the GPS read and the publish alike.
        if (isLocationRequestInFlight(stateRef.current)) return;

        void runPublishCycle(update, dependencies);
    }, [tracker, update, dependencies]);

    return { state, isTracking, startTracking, stopTracking, publishOnce };
}
