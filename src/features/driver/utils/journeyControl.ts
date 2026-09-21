// Starting and ending one assigned trip (MOV-294).
//
// A journey is always a specific trip: the driver picks one of the bus's
// assigned trips and Start Journey records, ON THE SERVER, that this trip is
// running (trips/{tripId}.journey, stamped with the actual start time). That
// record — not this device — is what passengers are shown.
//
// Two lifecycles, kept apart on purpose:
//
//   the JOURNEY   — started by Start Journey, stopped only by End Journey or by
//                   its window running out (journeyLifecycle). Persisted, so it
//                   survives the device signing out, the app closing, or the
//                   phone being swapped.
//
//   the SHARING   — this device's location loop (MOV-267), unchanged. It runs
//                   while this device is signed in and sharing for the running
//                   journey. Signing out stops the loop and nothing else.
//
// Nothing here collects a position. Location sharing is the existing tracker
// and publish cycle; this decides when they run and which trip each publish
// names.
//
// No React, like the rest of `driver/utils`, so every rule is testable.

import { TripJourneyRecord, isJourneyActive, journeyExpiresAt } from '../../../shared/utils/journeyLifecycle';
import { PublishCycleDependencies } from './locationPublishCycle';
import { AssignedTrip } from './assignedTrips';
import type { TripJourneyAction } from '../api/tripJourneyApi';

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
    return expiresAt ? { trip: { ...trip, journey: record }, startedAt: record.startedAt, expiresAt: expiresAt.toISOString() } : null;
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

/**
 * The trip a publish should name, or undefined for none.
 *
 * Only a journey on the same bus the reading is being published as counts.
 */
export function journeyTripIdFor(journey: ActiveJourney | null, busId: string): string | undefined {
    return journey && journey.trip.busId === busId ? journey.trip.tripId : undefined;
}

/**
 * The existing publish dependencies, with each publish naming the running trip.
 *
 * Reading the position and the session are passed through untouched, so the
 * permission prompt, the GPS read and the endpoint are exactly the ones used
 * before. The journey is read at the moment of each publish.
 */
export function withJourneyTrip(
    base: PublishCycleDependencies,
    getJourney: () => ActiveJourney | null
): PublishCycleDependencies {
    return {
        readLocation: base.readLocation,
        readSession: base.readSession,
        publish: (busId, location, sessionCredential) =>
            base.publish(busId, location, sessionCredential, journeyTripIdFor(getJourney(), busId)),
    };
}

/** The tracking loop's controls, as `usePhoneLocationTracking` exposes them. */
export interface JourneyTrackingControls {
    startTracking: () => void;
    stopTracking: () => void;
}

export interface JourneyControllerOptions {
    tracking: JourneyTrackingControls;
    /** The bus this device is signed in as. */
    getBusId: () => string | null | undefined;
    getActiveJourney: () => ActiveJourney | null;
    /** Called synchronously, so the very next publish sees the change. */
    setActiveJourney: (journey: ActiveJourney | null) => void;
    /** Records a start or end on the server; resolves with the stored record. */
    persist: (tripId: string, action: TripJourneyAction) => Promise<TripJourneyRecord>;
    /** Told about every record the server confirms, to keep the trip list current. */
    onPersisted?: (tripId: string, record: TripJourneyRecord) => void;
}

export interface JourneyController {
    /** Persists the start, then begins sharing for that trip. */
    startJourney: (trip: AssignedTrip) => Promise<StartJourneyResult>;
    /** Persists the end, then stops sharing. */
    endJourney: () => Promise<EndJourneyResult>;
    /** Shares location again for the running journey, e.g. after signing back in. */
    resumeSharing: () => boolean;
    /**
     * Stops this device's sharing WITHOUT ending the journey — for signing out
     * or switching bus. The journey stays running for passengers.
     */
    releaseDevice: () => void;
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
                const record = await options.persist(trip.tripId, 'START');
                const journey = toActiveJourney(trip, record);

                if (!journey) {
                    return { ok: false, reason: 'FAILED', message: 'The server did not confirm the start time.' };
                }

                // The trip is set BEFORE sharing begins, so the very first
                // publish — sent immediately — already names it.
                options.setActiveJourney(journey);
                options.onPersisted?.(trip.tripId, record);
                options.tracking.startTracking();

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
                const record = await options.persist(active.trip.tripId, 'END');

                options.tracking.stopTracking();
                options.setActiveJourney(null);
                options.onPersisted?.(active.trip.tripId, record);

                return { ok: true };
            } catch (error) {
                if (codeOf(error) === 'JOURNEY_NOT_STARTED') {
                    // Nothing is running on the server, so there is nothing to
                    // end: the device simply catches up.
                    options.tracking.stopTracking();
                    options.setActiveJourney(null);
                    return { ok: true };
                }

                // Still running for passengers, so sharing carries on too.
                return { ok: false, reason: 'FAILED', message: messageOf(error) };
            } finally {
                inFlight = false;
            }
        },

        resumeSharing() {
            if (!options.getActiveJourney()) return false;
            options.tracking.startTracking();
            return true;
        },

        releaseDevice() {
            options.tracking.stopTracking();
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
