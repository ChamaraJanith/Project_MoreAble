// Keeps the Home → Active Journey screen in step with the passenger's actual
// running journey.
//
// GET /api/journeys/ongoing is the only source of truth, the same one
// Activities → Ongoing uses. Every answer REPLACES the stored journey:
//
//   a journey   -> that exact journey (newest run first, as the server sorts)
//   []          -> no active journey
//   an error    -> no active journey; an earlier journey is never kept as LIVE
//   no token    -> no active journey
//
// A booking alone, a bus/vehicle id, or a bus session on this device is never
// treated as proof that a journey is running.

import { getOngoingJourneys } from '../../activities/api/ongoingJourneyApi';
import { useAuthStore } from '../../../shared/store/authStore';
import { useJourneyStore } from '../../../shared/store/journeyStore';

export type ActiveJourneySyncResult = 'active' | 'none' | 'error' | 'signed-out' | 'superseded';

// Only the newest request may change the store, so a slow earlier answer can
// never bring back a journey a later one has cleared. A session change moves
// it too (resetActiveJourneySession), so a request started under one session
// can never write once that session has ended.
let latestRequest = 0;

/**
 * Drops everything the previous session was holding: the journey and the
 * passenger's own profile/caregiver details. `latestRequest` moves too, so a
 * request already in flight — even with no screen left to start a newer one —
 * cannot land afterwards and bring the previous passenger's journey back.
 */
export function resetActiveJourneySession(): void {
  latestRequest++;
  useJourneyStore.getState().clearPassengerSession();
}

/**
 * Resets the moment the session changes, as favouriteRoutesStore does: on any
 * change of token — signing out, a session expiring, one passenger replacing
 * another. Zustand's `subscribe` runs synchronously inside `set`, so the state
 * is gone by the time `logout()` returns. Registered once, when this module
 * loads; the auth store does not import this module, so there is no cycle.
 */
let lastSeenSessionToken: string | null = useAuthStore.getState().token;

useAuthStore.subscribe((session) => {
  if (session.token === lastSeenSessionToken) return;

  lastSeenSessionToken = session.token;
  resetActiveJourneySession();
});

export async function syncActiveJourney(token: string | null | undefined): Promise<ActiveJourneySyncResult> {
  const requestId = ++latestRequest;
  const store = useJourneyStore.getState();

  if (!token) {
    store.clearActiveJourney();
    return 'signed-out';
  }

  try {
    const journeys = await getOngoingJourneys(token);
    if (requestId !== latestRequest) return 'superseded';

    if (journeys.length === 0) {
      useJourneyStore.getState().clearActiveJourney();
      return 'none';
    }

    useJourneyStore.getState().setActiveJourneyFromOngoing(journeys[0]);
    return 'active';
  } catch {
    if (requestId !== latestRequest) return 'superseded';
    useJourneyStore.getState().clearActiveJourney();
    return 'error';
  }
}

export interface ActiveJourneyView {
  /** The header badge reads LIVE only for a synced, running journey. */
  isLive: boolean;
  /** The Assigned Vehicle / Booking card; null when nothing is running. */
  vehicleCard: { plateNumber: string; model: string; bookingId: string } | null;
}

/**
 * What the Active Journey screen shows. While a sync is in flight nothing from
 * an earlier visit is presented as running.
 */
export function selectActiveJourneyView(
  state: { isJourneyStarted: boolean; bookingId: string | null; vehicleDetails: { plateNumber: string; model: string } | null },
  syncing: boolean
): ActiveJourneyView {
  const isLive = !syncing && state.isJourneyStarted && !!state.bookingId;

  return {
    isLive,
    vehicleCard: isLive
      ? {
          plateNumber: state.vehicleDetails?.plateNumber ?? 'Transit Bus',
          model: state.vehicleDetails?.model ?? 'Transit Bus',
          bookingId: state.bookingId as string,
        }
      : null,
  };
}
