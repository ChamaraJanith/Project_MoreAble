// The bus's trips and running journey, held for the whole Transit Console
// (MOV-294).
//
// The running journey is read from the server — each assigned trip carries its
// persisted Start/End Journey record — so it is the same whichever device, or
// whichever sign-in, is looking. This device only adds its own location
// sharing on top.
//
// Held by the dashboard screen rather than by the Trip Control tab. Tabs mount
// and unmount as the driver switches between them, and the tracking loop stops
// on unmount — held inside the tab, scanning a ticket in the Passengers tab
// would silently stop sharing.
//
// Signing out, or a different bus signing in, stops this device's sharing and
// nothing more. It never ends the journey: only End Journey, or the journey's
// window running out, does that.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBusSession } from '../../../shared/utils/busSession';
import { TripJourneyRecord } from '../../../shared/utils/journeyLifecycle';
import { fetchAssignedTrips } from '../api/assignedTripsApi';
import { TripJourneyAction, TripJourneyError, updateTripJourney } from '../api/tripJourneyApi';
import { AssignedTrip } from '../utils/assignedTrips';
import {
    ActiveJourney,
    EndJourneyResult,
    StartJourneyResult,
    createJourneyController,
    findActiveJourney,
    withJourneyTrip,
} from '../utils/journeyControl';
import { LIVE_DEPENDENCIES } from '../utils/locationPublishCycle';
import { PhoneLocationTracking, usePhoneLocationTracking } from './usePhoneLocationTracking';

export interface TripJourney {
    /** Every trip assigned to this bus, with its persisted journey record. */
    trips: AssignedTrip[];
    loading: boolean;
    refreshing: boolean;
    error: string;
    reload: (mode: 'initial' | 'refresh') => void;
    /** The running journey, or null. Independent of whether this device shares. */
    journey: ActiveJourney | null;
    /** A start or end is on its way to the server. */
    busy: boolean;
    /** The existing location-sharing state, for the live card and map. */
    tracking: PhoneLocationTracking;
    startJourney: (trip: AssignedTrip) => Promise<StartJourneyResult>;
    endJourney: () => Promise<EndJourneyResult>;
    resumeSharing: () => boolean;
}

/**
 * The running journey and bus as publishes and the controller read them.
 *
 * Read synchronously, so a start is visible to the very first publish before
 * React has re-rendered. Only read when a button is pressed or a publish goes
 * out — never while rendering, which reads React state instead.
 */
interface JourneyStore {
    getJourney: () => ActiveJourney | null;
    setJourney: (journey: ActiveJourney | null) => void;
    getBusId: () => string | null | undefined;
    setBusId: (busId: string | null | undefined) => void;
}

function createJourneyStore(): JourneyStore {
    let journey: ActiveJourney | null = null;
    let busId: string | null | undefined;

    return {
        getJourney: () => journey,
        setJourney: (next) => {
            journey = next;
        },
        getBusId: () => busId,
        setBusId: (next) => {
            busId = next;
        },
    };
}

/** Starts or ends a journey as the signed-in bus. */
async function persistJourney(tripId: string, action: TripJourneyAction): Promise<TripJourneyRecord> {
    const session = await getBusSession().catch(() => null);

    if (!session) {
        throw new TripJourneyError('NOT_AUTHENTICATED', 'Please sign this bus in again.');
    }

    return updateTripJourney(tripId, action, session.token);
}

export function useTripJourney(busId: string | null | undefined): TripJourney {
    const [trips, setTrips] = useState<AssignedTrip[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const latestRequest = useRef(0);
    const [store] = useState(createJourneyStore);

    // The server's view, re-read on every render so an expired journey drops
    // out without anyone pressing anything.
    const journey = findActiveJourney(trips);
    const journeyTripId = journey?.trip.tripId ?? null;

    useEffect(() => {
        store.setJourney(journey);
    }, [store, journey]);

    // ---- The trip list ----
    const settle = useCallback((requestId: number, outcome: { trips: AssignedTrip[] } | { error: string }) => {
        if (requestId !== latestRequest.current) return;

        if ('trips' in outcome) {
            setTrips(outcome.trips);
            setError('');
        } else {
            setError(outcome.error);
        }

        setLoading(false);
        setRefreshing(false);
    }, []);

    const request = useCallback(
        (forBusId: string) => {
            const requestId = ++latestRequest.current;

            fetchAssignedTrips(forBusId).then(
                (assigned) => settle(requestId, { trips: assigned }),
                (err: any) => settle(requestId, { error: err?.message || 'Unable to load assigned trips.' })
            );
        },
        [settle]
    );

    const reload = useCallback(
        (mode: 'initial' | 'refresh') => {
            if (!busId) return;
            if (mode === 'initial') setLoading(true);
            else setRefreshing(true);
            setError('');
            request(busId);
        },
        [busId, request]
    );

    // ---- Sharing ----
    const dependencies = useMemo(() => withJourneyTrip(LIVE_DEPENDENCIES, store.getJourney), [store]);
    const tracking = usePhoneLocationTracking({ dependencies });
    const { startTracking, stopTracking, isTracking } = tracking;

    const controller = useMemo(
        () =>
            createJourneyController({
                tracking: { startTracking, stopTracking },
                getBusId: store.getBusId,
                getActiveJourney: store.getJourney,
                setActiveJourney: store.setJourney,
                persist: persistJourney,
                onPersisted: (tripId, record) =>
                    setTrips((current) => current.map((t) => (t.tripId === tripId ? { ...t, journey: record } : t))),
            }),
        [store, startTracking, stopTracking]
    );

    // A different bus (or none — signing out) releases this device: sharing
    // stops, the journey does not. Then the new bus's trips are loaded.
    useEffect(() => {
        store.setBusId(busId);
        stopTracking();

        if (busId) request(busId);
    }, [store, busId, stopTracking, request]);

    // A journey whose window has run out is no longer running, so this device
    // stops sharing for it.
    useEffect(() => {
        if (!journeyTripId && isTracking) stopTracking();
    }, [journeyTripId, isTracking, stopTracking]);

    const startJourney = useCallback(
        async (trip: AssignedTrip) => {
            setBusy(true);
            try {
                return await controller.startJourney(trip);
            } finally {
                setBusy(false);
            }
        },
        [controller]
    );

    const endJourney = useCallback(async () => {
        setBusy(true);
        try {
            return await controller.endJourney();
        } finally {
            setBusy(false);
        }
    }, [controller]);

    return {
        trips,
        loading: loading && !!busId,
        refreshing,
        error,
        reload,
        journey,
        busy,
        tracking,
        startJourney,
        endJourney,
        resumeSharing: controller.resumeSharing,
    };
}
