import * as Location from 'expo-location';
import { useJourneyStore } from '../../../shared/store/journeyStore';
import { useAuthStore } from '../../../shared/store/authStore';
import { ActiveJourneySyncResult, syncActiveJourney } from './activeJourneySync';
// import { firestore } from '@/api/firebase';
import { createEmergencyRequestApi } from '../../admin/api/emergencyAdminApi';
import { adminHttpStatusOf } from '../../admin/api/adminHttp';

/**
 * How long SOS waits for a fresh GET /api/journeys/ongoing. It runs alongside
 * the GPS fix, so it rarely adds time; past this the alert goes without
 * journey identity rather than with a possibly stale one.
 */
export const SOS_JOURNEY_SYNC_TIMEOUT_MS = 5000;

function withinSyncTimeout(sync: Promise<ActiveJourneySyncResult>): Promise<ActiveJourneySyncResult | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), SOS_JOURNEY_SYNC_TIMEOUT_MS);
  });
  return Promise.race([sync, timeout]).finally(() => clearTimeout(timer));
}

/** Why the server did not record an SOS. */
export type SOSFailureReason =
  /** 401: no session, or it expired. */
  | 'NOT_AUTHENTICATED'
  /** 403: this session may not send an SOS. */
  | 'FORBIDDEN'
  /** No answer from the server at all. */
  | 'NETWORK_UNAVAILABLE'
  /** Any other refusal (4xx) or a server fault (5xx). */
  | 'REJECTED'
  /** Answered, but with no created emergency in it: nothing confirms the SOS exists. */
  | 'UNCONFIRMED';

export type SOSAlertResult =
  | { success: true; message: string }
  | { success: false; message: string; reason?: SOSFailureReason };

export const SOS_SENT_MESSAGE = 'Emergency SOS Sent Successfully!';

const SOS_UNCONFIRMED: SOSAlertResult & { success: false } = {
  success: false,
  reason: 'UNCONFIRMED',
  message: 'Your SOS could not be confirmed. Please try again or call for help directly.',
};

/**
 * The failure the passenger sees when POST /api/emergencies did not create
 * the emergency. Each says the SOS was not sent — or, for an answer that
 * cannot be read, that it could not be confirmed — and never that help was
 * notified.
 */
export function sosRequestFailure(error: unknown): SOSAlertResult & { success: false } {
  const status = adminHttpStatusOf(error);
  const serverMessage = error instanceof Error && error.message ? error.message : '';

  if (status === 401) {
    return {
      success: false,
      reason: 'NOT_AUTHENTICATED',
      message: 'Your session has expired. Please sign in again. Your SOS was NOT sent.',
    };
  }
  if (status === 403) {
    return {
      success: false,
      reason: 'FORBIDDEN',
      message: 'This account cannot send an SOS. Your SOS was NOT sent.',
    };
  }
  if (status === null) {
    return {
      success: false,
      reason: 'NETWORK_UNAVAILABLE',
      message: 'Could not reach the emergency service. Your SOS was NOT sent. Please try again or call for help directly.',
    };
  }
  if (status >= 200 && status < 300) {
    // Answered, but not in the expected shape: nothing confirms the SOS.
    return SOS_UNCONFIRMED;
  }
  if (status >= 500) {
    return {
      success: false,
      reason: 'REJECTED',
      message: 'The emergency service could not record your SOS. Your SOS was NOT sent. Please try again or call for help directly.',
    };
  }
  return {
    success: false,
    reason: 'REJECTED',
    message: `${serverMessage || 'The emergency service refused the request.'} Your SOS was NOT sent.`,
  };
}

export const triggerSOSAlert = async (): Promise<SOSAlertResult> => {
  try {
    // The passenger is the signed-in user — never a cached profile or a
    // made-up id. Checked before asking for location.
    const startToken = useAuthStore.getState().token;
    if (!useAuthStore.getState().user || !startToken) {
      throw new Error('Please sign in to send an SOS.');
    }

    // Refresh the running journey from GET /api/journeys/ongoing while the
    // GPS fix is taken, so the alert carries the current journey, not a
    // remembered one.
    const journeySync = withinSyncTimeout(syncActiveJourney(startToken));

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Location permission is required for SOS.');
    }

    const location = await Location.getCurrentPositionAsync({});
    const syncResult = await journeySync;

    // A different session now: this alert's journey and identity would not
    // belong together.
    const authUser = useAuthStore.getState().user;
    if (!authUser || useAuthStore.getState().token !== startToken) {
      throw new Error('Your session changed. Please try again.');
    }

    // Journey identity only when THIS refresh found a running journey; a
    // timed-out, failed or superseded refresh sends none.
    const store = useJourneyStore.getState();
    const journey =
      syncResult === 'active' && store.isJourneyStarted && store.bookingId
        ? {
            bookingId: store.bookingId,
            tripId: store.tripId,
            busId: store.busId,
            vehicle: store.vehicleDetails,
            driverId: store.driverId,
          }
        : null;

    const passenger = {
      id: authUser.passengerId || authUser.uid,
      name: authUser.userName || authUser.email || 'Passenger',
      phone: authUser.phoneNumber || authUser.secondaryPhoneNumber || '0771234567',
      email: authUser.email || undefined,
      specialAssistance: (Array.isArray(authUser.accessibilityNeeds) && authUser.accessibilityNeeds.length > 0)
        ? authUser.accessibilityNeeds.join(', ')
        : authUser.isWheelchairUser
        ? 'Wheelchair Assistance'
        : authUser.isLowVisionPerson
        ? 'Low Vision Support'
        : authUser.isHearingImpaired
        ? 'Hearing Support'
        : authUser.isWalkingDifficultyPerson
        ? 'Walking Assistance'
        : undefined,
    };

    const sosData = {
      timestamp: new Date().toISOString(),
      bookingId: journey?.bookingId ?? null,
      tripId: journey?.tripId ?? null,
      busId: journey?.busId ?? null,
      passenger,
      vehicle: journey?.vehicle ?? null,
      location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
      alertRecipients: {
        caregiver: authUser.guardianDetails?.mobileNo || authUser.guardianId || null,
        driver: journey?.driverId ?? null,
        admin: 'ADMIN_TOPIC',
      },
      status: 'ACTIVE'
    };

    // The SOS is sent only when the server records it. A failed or
    // unconfirmed POST is reported as not sent, never as success.
    let created: unknown;
    try {
      created = await createEmergencyRequestApi(sosData as any);
    } catch (apiErr) {
      const failure = sosRequestFailure(apiErr);
      console.warn('SOS was not recorded by the server:', failure.reason);
      return failure;
    }

    const createdId = (created as { id?: unknown } | null | undefined)?.id;
    if (typeof createdId !== 'string' || !createdId.trim()) {
      console.warn('SOS was not recorded by the server: UNCONFIRMED');
      return SOS_UNCONFIRMED;
    }

    // Local state for the driver/vehicle dashboard, once the SOS exists.
    useJourneyStore.getState().triggerLocalSOS(passenger.name);

    return { success: true, message: SOS_SENT_MESSAGE };
  } catch (error: any) {
    console.error("SOS Trigger Failed: ", error);
    return { success: false, message: error.message || 'Failed to send SOS' };
  }
};
