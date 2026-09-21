// Starting and ending one assigned trip (MOV-294).
//
// A journey is always a specific trip: the driver picks one of the bus's
// assigned trips and Start Journey records, ON THE SERVER, that this trip is
// running (trips/{tripId}.journey, stamped with the actual start time). That
// record — not this device — is what passengers are shown.
//
// Three lifecycles, kept apart on purpose:
//
//   the SIGN-IN   — Device Login to logout. Needed to start or end a journey,
//                   and nothing else here depends on it.
//
//   the JOURNEY   — started by Start Journey, stopped only by End Journey or by
//                   its window running out (journeyLifecycle). Persisted, so it
//                   survives the device signing out, the app closing, or the
//                   phone being swapped.
//
//   the SHARING   — the journey's location sharing (services/journeySharing):
//                   starts with Start Journey, stops with End Journey. Logging
//                   out does not stop it.
//
// Nothing here collects a position. Location sharing is the existing tracker
// and publish cycle; this decides when it starts and stops.
//
// No React, like the rest of `driver/utils`, so every rule is testable.

import { JourneySharingGrant } from '../../../shared/utils/journeySharingStorage';
import { TripJourneyRecord, isJourneyActive, journeyExpiresAt } from '../../../shared/utils/journeyLifecycle';
import { AssignedTrip } from './assignedTrips';
import type { TripJourneyAction, TripJourneyResult } from '../api/tripJourneyApi';

/** The trip whose journey is running, as this device knows it. */
export interface ActiveJourney {
    trip: AssignedTrip;
    /** ISO 8601, server time when Start Journey was pressed. */
    startedAt: string;
    /** ISO 8601, when it stops running if nobody ends it. */
    expiresAt: string;
}

function toActiveJourney(trip: AssignedTrip, record: TripJourneyRecord): ActiveJourney | null {
    const expiresAt = journeyExpiresAt(record);
    return expiresAt
        ? { trip: { ...trip, journey: record }, startedAt: record.startedAt, expiresAt: expiresAt.toISOString() }
        : null;
}

/**
 * The running journey among a bus's assigned trips, from their persisted
 * records — so a device that signs in again finds the journey it left running.
 *
 * A bus runs one journey at a time and the server enforces it; if records ever
 * disagreed, the most recently started one wins.
 */
export function findActiveJourney(trips: AssignedTrip[], now: Date = new Date()): ActiveJourney | null {
    let latest: ActiveJourney | null = null;

    for (const trip of trips) {
        if (!isJourneyActive(trip.journey, now)) continue;

        const candidate = toActiveJourney(trip, trip.journey as TripJourneyRecord);

        if (candidate && (!latest || candidate.startedAt > latest.startedAt)) {
            latest = candidate;
        }
    }

    return latest;
}

export type StartJourneyRefusal =
    /** Another trip is already running on this bus. */
    | 'ANOTHER_JOURNEY_ACTIVE'
    /** The trip is not assigned to the bus this device is signed in as. */
    | 'TRIP_NOT_ASSIGNED'
    /** A start or end is already on its way to the server. */
    | 'IN_PROGRESS'
    /** The server could not record it; nothing was started. */
    | 'FAILED';

export type StartJourneyResult =
    | { ok: true; journey: ActiveJourney }
    | { ok: false; reason: StartJourneyRefusal; message?: string };

export type EndJourneyResult =
    | { ok: true }
    | { ok: false; reason: 'NO_ACTIVE_JOURNEY' | 'IN_PROGRESS' | 'FAILED'; message?: string };

/**
 * Whether `trip` may start, given what is already running. Null means yes.
 *
 * ONE JOURNEY AT A TIME. The bus has one position, so two running trips would
 * be two trips claiming it. A repeat press on the running trip is refused too:
 * it must never reset that journey's start time.
 */
export function startRefusal(
    active: ActiveJourney | null,
    trip: AssignedTrip,
    busId: string | null | undefined
): StartJourneyRefusal | null {
    if (active) return 'ANOTHER_JOURNEY_ACTIVE';
    if (!busId || !trip?.tripId || trip.busId !== busId) return 'TRIP_NOT_ASSIGNED';
    return null;
}

/** The journey's location sharing, as services/journeySharing exposes it. */
export interface JourneySharingControls {
    start: (grant: JourneySharingGrant) => Promise<void>;
    stop: () => Promise<void>;
    isSharing: (tripId: string) => boolean;
}

/** The sharing grant a server answer carries for a running journey, or null. */
export function sharingGrantFor(journey: ActiveJourney, result: TripJourneyResult): JourneySharingGrant | null {
    return result.sharingToken
        ? {
            tripId: journey.trip.tripId,
            busId: journey.trip.busId,
            token: result.sharingToken,
            expiresAt: journey.expiresAt,
        }
        : null;
}

export interface JourneyControllerOptions {
    sharing: JourneySharingControls;
    /** The bus this device is signed in as. */
    getBusId: () => string | null | undefined;
    getActiveJourney: () => ActiveJourney | null;
    setActiveJourney: (journey: ActiveJourney | null) => void;
    /** Records a start, end or share on the server; resolves with its answer. */
    persist: (tripId: string, action: TripJourneyAction) => Promise<TripJourneyResult>;
    /** Told about every record the server confirms, to keep the trip list current. */
    onPersisted?: (tripId: string, record: TripJourneyRecord) => void;
}

export interface JourneyController {
    /** Persists the start, then begins sharing for that trip. */
    startJourney: (trip: AssignedTrip) => Promise<StartJourneyResult>;
    /** Persists the end; only once the server confirms it, stops sharing. */
    endJourney: () => Promise<EndJourneyResult>;
    /**
     * Makes sure the running journey is being shared from this device. A no-op
     * when it already is — the usual case after logging back in, since logging
     * out never stopped it. Otherwise (another phone, or cleared storage) it
     * fetches the running journey's grant; it never starts or restarts one.
     */
    attachSharing: () => Promise<boolean>;
}

function codeOf(error: unknown): string | undefined {
    return (error as { code?: string } | null)?.code;
}

function messageOf(error: unknown): string | undefined {
    return error instanceof Error ? error.message : undefined;
}

export function createJourneyController(options: JourneyControllerOptions): JourneyController {
    // One server round-trip at a time, so a double press cannot start twice or
    // race a start against an end.
    let inFlight = false;

    return {
        async startJourney(trip) {
            if (inFlight) return { ok: false, reason: 'IN_PROGRESS' };

            const refusal = startRefusal(options.getActiveJourney(), trip, options.getBusId());
            if (refusal) return { ok: false, reason: refusal };

            inFlight = true;

            try {
                const result = await options.persist(trip.tripId, 'START');
                const journey = toActiveJourney(trip, result.journey);

                if (!journey) {
                    return { ok: false, reason: 'FAILED', message: 'The server did not confirm the start time.' };
                }

                options.setActiveJourney(journey);
                options.onPersisted?.(trip.tripId, result.journey);

                const grant = sharingGrantFor(journey, result);
                if (grant) await options.sharing.start(grant);

                return { ok: true, journey };
            } catch (error) {
                const reason = codeOf(error) === 'ANOTHER_JOURNEY_ACTIVE' ? 'ANOTHER_JOURNEY_ACTIVE' : 'FAILED';
                return { ok: false, reason, message: messageOf(error) };
            } finally {
                inFlight = false;
            }
        },

        async endJourney() {
            if (inFlight) return { ok: false, reason: 'IN_PROGRESS' };

            const active = options.getActiveJourney();
            if (!active) return { ok: false, reason: 'NO_ACTIVE_JOURNEY' };

            inFlight = true;

            try {
                const result = await options.persist(active.trip.tripId, 'END');

                // Only now that the server has recorded the end.
                await options.sharing.stop();
                options.setActiveJourney(null);
                options.onPersisted?.(active.trip.tripId, result.journey);

                return { ok: true };
            } catch (error) {
                if (codeOf(error) === 'JOURNEY_NOT_STARTED') {
                    // Nothing is running on the server, so there is nothing to
                    // end: the device simply catches up.
                    await options.sharing.stop();
                    options.setActiveJourney(null);
                    return { ok: true };
                }

                // The journey is still running, so sharing carries on too.
                return { ok: false, reason: 'FAILED', message: messageOf(error) };
            } finally {
                inFlight = false;
            }
        },

        async attachSharing() {
            const active = options.getActiveJourney();

            if (!active) return false;
            if (options.sharing.isSharing(active.trip.tripId)) return true;
            if (inFlight) return false;

            inFlight = true;

            try {
                const result = await options.persist(active.trip.tripId, 'SHARE');
                const grant = sharingGrantFor(active, result);

                if (!grant) return false;

                await options.sharing.start(grant);
                return true;
            } catch {
                return false;
            } finally {
                inFlight = false;
            }
        },
    };
}

export type TripCardState =
    /** This trip is the one running. */
    | 'ACTIVE'
    /** Nothing is running; this trip can start. */
    | 'STARTABLE'
    /** Another trip is running, so this one cannot start yet. */
    | 'BLOCKED';

/** How one assigned trip's card should read, given the running journey. */
export function tripCardState(trip: AssignedTrip, journey: ActiveJourney | null): TripCardState {
    if (!journey) return 'STARTABLE';
    return journey.trip.tripId === trip.tripId ? 'ACTIVE' : 'BLOCKED';
}
