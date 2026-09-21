// Keeps the live journey screen up to date (MOV-297).
//
// One request on focus — with the planned path, the first time — then a single
// poller that refreshes the live position while the journey runs. Everything
// stops when the screen loses focus or unmounts, and for good once the journey
// ends or access is refused. The rules themselves live in ongoingJourneyTracking.

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { getOngoingJourneys, OngoingJourneyRequestError } from '../api/ongoingJourneyApi';
import {
    createJourneyPoller,
    INITIAL_TRACKING_STATE,
    JourneyPoller,
    ONGOING_JOURNEY_POLL_INTERVAL_MS,
    reduceTracking,
    TrackingEvent,
    TrackingState,
} from '../utils/ongoingJourneyTracking';

export interface OngoingJourneyTracking {
    state: TrackingState;
    /** A refresh the passenger asked for is in progress. */
    refreshing: boolean;
    /** Asks for the latest position now (or retries a failed first load). */
    refresh: () => void;
    /**
     * The passenger ended their own journey: stop following it here, for good.
     * Only this screen stops — the bus and other passengers are unaffected.
     */
    stopTracking: () => void;
}

export function useOngoingJourneyTracking(bookingId: string | undefined, token: string | null): OngoingJourneyTracking {
    const [state, setState] = useState<TrackingState>(INITIAL_TRACKING_STATE);
    const [refreshing, setRefreshing] = useState(false);

    // The reducer runs outside React's queue so the poller can learn the new
    // phase from the same call that fetched it.
    const stateRef = useRef<TrackingState>(INITIAL_TRACKING_STATE);
    // Only the newest request may update the screen; blurring bumps it, so an
    // answer that lands after the screen is left is dropped.
    const latestRequest = useRef(0);
    const pollerRef = useRef<JourneyPoller | null>(null);

    const apply = useCallback((event: TrackingEvent) => {
        stateRef.current = reduceTracking(stateRef.current, event);
        setState(stateRef.current);
        return stateRef.current;
    }, []);

    /** One request. Resolves whether the journey is still being tracked. */
    const load = useCallback(async (): Promise<boolean> => {
        if (!bookingId || !token) {
            apply({ type: 'FAILED', status: 401 });
            return false;
        }

        const requestId = ++latestRequest.current;
        // The path never changes while a journey runs, so it is asked for only
        // until one has arrived.
        const includeRoute = !stateRef.current.route;

        try {
            const journeys = await getOngoingJourneys(token, { includeRoute });
            if (requestId !== latestRequest.current) return stateRef.current.phase === 'ACTIVE';
            return apply({ type: 'LOADED', journeys, bookingId, at: new Date() }).phase === 'ACTIVE';
        } catch (error) {
            if (requestId !== latestRequest.current) return stateRef.current.phase === 'ACTIVE';
            const status = error instanceof OngoingJourneyRequestError ? error.status : null;
            return apply({ type: 'FAILED', status }).phase === 'ACTIVE';
        }
    }, [apply, bookingId, token]);

    useFocusEffect(
        useCallback(() => {
            const phase = stateRef.current.phase;
            // Over for good on this screen: nothing to ask for again.
            if (phase === 'ENDED' || phase === 'UNAUTHORIZED') return undefined;

            let focused = true;
            const poller = createJourneyPoller(load, ONGOING_JOURNEY_POLL_INTERVAL_MS);
            pollerRef.current = poller;

            load().then((tracking) => {
                if (focused && tracking) poller.start();
            });

            return () => {
                focused = false;
                poller.stop();
                pollerRef.current = null;
                latestRequest.current++;
                setRefreshing(false);
            };
        }, [load])
    );

    const refresh = useCallback(() => {
        const phase = stateRef.current.phase;
        if (phase === 'ENDED' || phase === 'UNAUTHORIZED') return;

        setRefreshing(true);
        load()
            .then((tracking) => {
                // A retried first load that succeeds starts the live updates.
                if (tracking) pollerRef.current?.start();
                else pollerRef.current?.stop();
            })
            .finally(() => setRefreshing(false));
    }, [load]);

    const stopTracking = useCallback(() => {
        pollerRef.current?.stop();
        // Drops any refresh still in flight.
        latestRequest.current++;
        apply({ type: 'PASSENGER_ENDED' });
    }, [apply]);

    return { state, refreshing, refresh, stopTracking };
}
