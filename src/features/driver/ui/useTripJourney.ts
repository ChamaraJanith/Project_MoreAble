// The bus's trips and running journey, for the Transit Console (MOV-294).
//
// The running journey is read from the server — each assigned trip carries its
// persisted Start/End Journey record — so it is the same whichever device, or
// whichever sign-in, is looking.
//
// Location sharing is NOT owned here. It belongs to the journey and lives in
// services/journeySharing for the life of the app, so this screen unmounting
// on logout cannot stop it. This hook only reads that service's state for the
// live card, and — when the dashboard finds a running journey this device is
// not sharing (another phone, cleared storage) — attaches it once.
//
// Logging out therefore changes nothing here but the sign-in: the journey stays
// running and sharing carries on. Only End Journey, or the journey's window
// running out, stops either.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getBusSession } from '../../../shared/utils/busSession';
import { fetchAssignedTrips } from '../api/assignedTripsApi';
import { TripJourneyAction, TripJourneyError, TripJourneyResult, updateTripJourney } from '../api/tripJourneyApi';
import { JourneySharingSnapshot, journeySharing } from '../services/journeySharing';
import { AssignedTrip } from '../utils/assignedTrips';
import {
    ActiveJourney,
    EndJourneyResult,
    StartJourneyResult,
    createJourneyController,
    findActiveJourney,
} from '../utils/journeyControl';

/** The sharing state the live card renders, plus its one recovery action. */
export interface JourneySharingView extends JourneySharingSnapshot {
    publishOnce: () => void;
}

export interface TripJourney {
    /** Every trip assigned to this bus, with its persisted journey record. */
    trips: AssignedTrip[];
    loading: boolean;
    refreshing: boolean;
    error: string;
    reload: (mode: 'initial' | 'refresh') => void;
    /** The running journey, or null. Independent of the sign-in. */
    journey: ActiveJourney | null;
    /** A start or end is on its way to the server. */
    busy: boolean;
    /** The journey's location sharing, for the live card and map. */
    sharing: JourneySharingView;
    startJourney: (trip: AssignedTrip) => Promise<StartJourneyResult>;
    endJourney: () => Promise<EndJourneyResult>;
}

/**
 * The running journey and bus as the controller reads them.
 *
 * Read synchronously when a button is pressed — never while rendering, which
 * reads React state instead.
 */
interface JourneyStore {
    getJourney: () => ActiveJourney | null;
    setJourney: (journey: ActiveJourney | null) => void;
    getBusId: () => string | null | undefined;
    setBusId: (busId: string | null | undefined) => void;
    /** The journey this device last tried to attach sharing for. */
    attemptedAttach: (tripId: string) => boolean;
    resetAttach: () => void;
}

function createJourneyStore(): JourneyStore {
    let journey: ActiveJourney | null = null;
    let busId: string | null | undefined;
    let attached: string | null = null;

    return {
        getJourney: () => journey,
        setJourney: (next) => {
            journey = next;
        },
        getBusId: () => busId,
        setBusId: (next) => {
            busId = next;
        },
        attemptedAttach: (tripId) => {
            if (attached === tripId) return true;
            attached = tripId;
            return false;
        },
        resetAttach: () => {
            attached = null;
        },
    };
}

/** Starts, ends or shares a journey as the signed-in bus. */
async function persistJourney(tripId: string, action: TripJourneyAction): Promise<TripJourneyResult> {
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

    const sharingSnapshot = useSyncExternalStore(
        journeySharing.subscribe,
        journeySharing.getSnapshot,
        journeySharing.getSnapshot
    );

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
            store.resetAttach();
            request(busId);
        },
        [busId, request, store]
    );

    // Signing in (or a different bus signing in) loads that bus's trips. It
    // never touches location sharing.
    useEffect(() => {
        store.setBusId(busId);
        if (busId) request(busId);
    }, [store, busId, request]);

    // ---- Journey actions ----
    const controller = useMemo(
        () =>
            createJourneyController({
                sharing: journeySharing,
                getBusId: store.getBusId,
                getActiveJourney: store.getJourney,
                setActiveJourney: store.setJourney,
                persist: persistJourney,
                onPersisted: (tripId, record) =>
                    setTrips((current) => current.map((t) => (t.tripId === tripId ? { ...t, journey: record } : t))),
            }),
        [store]
    );

    // A running journey this device is not sharing — typically a different
    // phone signing in as this bus — is attached once, with no action from the
    // driver. After a logout and login on the same phone it is already sharing,
    // and this does nothing.
    const sharingTripId = sharingSnapshot.isTracking ? sharingSnapshot.tripId : null;

    useEffect(() => {
        if (!journeyTripId || sharingTripId === journeyTripId) return;
        if (store.attemptedAttach(journeyTripId)) return;
        void controller.attachSharing();
    }, [journeyTripId, sharingTripId, store, controller]);

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

    const sharing = useMemo(
        () => ({ ...sharingSnapshot, publishOnce: journeySharing.publishOnce }),
        [sharingSnapshot]
    );

    return {
        trips,
        loading: loading && !!busId,
        refreshing,
        error,
        reload,
        journey,
        busy,
        sharing,
        startJourney,
        endJourney,
    };
}
