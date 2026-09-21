// Location sharing for the running journey, independent of the dashboard
// sign-in (MOV-294).
//
// Three lifecycles, kept apart:
//
//   sign-in   Device Login -> logout                       (busSession)
//   journey   Start Journey -> End Journey / 23-hour expiry (the server)
//   sharing   Start Journey -> End Journey                  (this module)
//
// Logging out ends the sign-in and nothing else. Sharing follows the journey:
// it starts when Start Journey succeeds and stops when End Journey succeeds, or
// when the journey's window runs out.
//
// This is NOT a second location system. It is the existing tracking loop
// (`createLocationTracker`, MOV-267) running the existing publish cycle
// (MOV-265) through the existing publisher to the existing endpoint. Two things
// change, and only these:
//
//   - OWNERSHIP. The loop lives here, for the life of the app, rather than
//     inside a dashboard screen whose unmount (on logout) stopped it.
//   - CREDENTIAL. Each publish uses the journey's own sharing grant — a narrow,
//     server-issued token for this bus and trip that expires with the journey —
//     instead of the dashboard sign-in, which logout deletes.
//
// The grant is persisted, so if the app is closed and reopened while a journey
// is running, `restore()` picks sharing back up at launch without anyone
// signing in.
//
// FOREGROUND ONLY, like the tracker it reuses. While the app is open —
// including on the sign-in screen after logging out — sharing continues. When
// the OS suspends the app in the background, JavaScript timers pause with it;
// continuous background reporting would need an OS background-location task and
// the background permission, which this project does not have.

import { PhoneLocation } from '../../../shared/utils/phoneLocation';
import {
    JourneySharingGrant,
    clearJourneySharingGrant,
    getJourneySharingGrant,
    saveJourneySharingGrant,
} from '../../../shared/utils/journeySharingStorage';
import {
    LIVE_DEPENDENCIES,
    PhoneLocationStateUpdate,
    PublishCycleDependencies,
    runPublishCycle,
} from '../utils/locationPublishCycle';
import { TrackingScheduler, createLocationTracker } from '../utils/locationTracker';
import { PhoneLocationState, initialPhoneLocationState } from '../utils/phoneLocationState';

/** What the dashboard renders about sharing. Replaced, never mutated. */
export interface JourneySharingSnapshot {
    /** The existing location state model, for the live card and map. */
    state: PhoneLocationState;
    isTracking: boolean;
    /** The trip being shared, or null. */
    tripId: string | null;
}

export interface JourneySharingStorage {
    save: (grant: JourneySharingGrant) => Promise<void>;
    get: () => Promise<JourneySharingGrant | null>;
    clear: () => Promise<void>;
}

export interface JourneySharingOptions {
    storage?: JourneySharingStorage;
    readLocation?: () => Promise<PhoneLocation>;
    publish?: PublishCycleDependencies['publish'];
    scheduler?: TrackingScheduler;
    intervalMs?: number;
    now?: () => Date;
}

export interface JourneySharing {
    /** Begins (or keeps) sharing for a started journey, and persists its grant. */
    start: (grant: JourneySharingGrant) => Promise<void>;
    /** Stops sharing and forgets the grant. Only for a journey that has ended. */
    stop: () => Promise<void>;
    /** At app launch: resumes sharing for a journey still running. */
    restore: () => Promise<boolean>;
    /** Whether this device is sharing for `tripId` right now. */
    isSharing: (tripId: string) => boolean;
    /** One reading, published once — the existing recovery action. */
    publishOnce: () => void;
    getSnapshot: () => JourneySharingSnapshot;
    subscribe: (listener: () => void) => () => void;
}

const LIVE_STORAGE: JourneySharingStorage = {
    save: saveJourneySharingGrant,
    get: getJourneySharingGrant,
    clear: clearJourneySharingGrant,
};

export function createJourneySharing(options: JourneySharingOptions = {}): JourneySharing {
    const storage = options.storage ?? LIVE_STORAGE;
    const readLocation = options.readLocation ?? LIVE_DEPENDENCIES.readLocation;
    const publish = options.publish ?? LIVE_DEPENDENCIES.publish;
    const now = options.now ?? (() => new Date());

    let grant: JourneySharingGrant | null = null;
    let snapshot: JourneySharingSnapshot = { state: initialPhoneLocationState, isTracking: false, tripId: null };
    const listeners = new Set<() => void>();

    function set(next: Partial<JourneySharingSnapshot>) {
        snapshot = { ...snapshot, ...next };
        listeners.forEach((listener) => listener());
    }

    function isLive(candidate: JourneySharingGrant | null): candidate is JourneySharingGrant {
        return !!candidate && now().getTime() < new Date(candidate.expiresAt).getTime();
    }

    const update: PhoneLocationStateUpdate = (reduce) => set({ state: reduce(snapshot.state) });

    const dependencies: PublishCycleDependencies = {
        // The existing GPS read and permission flow, unchanged.
        readLocation,
        // The journey's grant stands in for the sign-in session. Once the
        // journey's window has passed there is no session, so the cycle
        // reports NOT_SIGNED_IN and the tracker stops itself.
        readSession: async () => (isLive(grant) ? { busId: grant.busId, numberPlate: '', token: grant.token } : null),
        publish: (busId, location, credential) =>
            publish(busId, location, credential, grant && grant.busId === busId ? grant.tripId : undefined),
    };

    const tracker = createLocationTracker({
        update,
        dependencies,
        scheduler: options.scheduler,
        intervalMs: options.intervalMs,
        onStop: (reason) => {
            set({ isTracking: false });

            // Stopped by the loop itself: the grant expired with the journey, or
            // the server no longer accepts it. Nothing further can be shared.
            if (reason === 'NOT_SIGNED_IN') {
                grant = null;
                set({ tripId: null });
                void storage.clear();
            }
        },
    });

    function run() {
        tracker.start();
        set({ isTracking: tracker.isTracking(), tripId: grant?.tripId ?? null });
    }

    return {
        async start(next) {
            const sameTrip = tracker.isTracking() && grant?.tripId === next.tripId;

            // One journey is shared at a time. A different one replaces it.
            if (tracker.isTracking() && !sameTrip) tracker.stop();

            grant = { ...next };

            try {
                await storage.save(grant);
            } catch {
                // Sharing still runs for as long as the app does; it just
                // cannot be picked back up after the app is closed.
            }

            if (!sameTrip) run();
        },

        async stop() {
            grant = null;
            tracker.stop();
            set({ isTracking: false, tripId: null });
            await storage.clear();
        },

        async restore() {
            if (tracker.isTracking()) return true;

            const stored = await storage.get().catch(() => null);

            if (!isLive(stored)) {
                if (stored) await storage.clear();
                return false;
            }

            grant = stored;
            run();
            return true;
        },

        isSharing: (tripId) => tracker.isTracking() && grant?.tripId === tripId,

        publishOnce() {
            if (tracker.isTracking() || !isLive(grant)) return;
            void runPublishCycle(update, dependencies);
        },

        getSnapshot: () => snapshot,

        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** The one sharing loop for this app. Outlives every screen and sign-in. */
export const journeySharing = createJourneySharing();
