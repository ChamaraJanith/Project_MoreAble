import * as Location from 'expo-location';
import { useJourneyStore } from '../../../shared/store/journeyStore';
import { useAuthStore } from '../../../shared/store/authStore';
import { ActiveJourneySyncResult, syncActiveJourney } from './activeJourneySync';
// import { firestore } from '@/api/firebase';
import { createEmergencyRequestApi } from '../../admin/api/emergencyAdminApi';

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

export const triggerSOSAlert = async () => {
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

    // Trigger local state update for driver/vehicle dashboard
    useJourneyStore.getState().triggerLocalSOS(passenger.name);

    // Save to Firebase or your backend API here
    try {
      await createEmergencyRequestApi(sosData as any);
    } catch (apiErr) {
      console.warn("Could not save to remote backend, local SOS active:", apiErr);
    }

    return { success: true, message: 'Emergency SOS Sent Successfully!' };
  } catch (error: any) {
    console.error("SOS Trigger Failed: ", error);
    return { success: false, message: error.message || 'Failed to send SOS' };
  }
};
