import { create } from 'zustand';
import type { PassengerOngoingJourney } from '../../entities/booking/model/types';

interface ActiveSOS {
  isActive: boolean;
  passengerName: string;
  timestamp: string;
}

interface JourneyState {
  // The passenger's running journey, only ever taken from
  // GET /api/journeys/ongoing (see activeJourneySync). Null/false when nothing
  // is running — never a placeholder booking or vehicle.
  bookingId: string | null;
  tripId: string | null;
  busId: string | null;
  vehicleDetails: { plateNumber: string; model: string } | null;
  driverId: string | null;
  passengerDetails: { id: string; name: string; phone: string } | null;
  caregiverId: string | null;
  activeSOS: ActiveSOS | null;
  isJourneyStarted: boolean;
  triggerLocalSOS: (passengerName?: string) => void;
  clearSOS: () => void;
  setJourneyStarted: (started: boolean) => void;
  /** Replaces the active journey with this ongoing journey from the server. */
  setActiveJourneyFromOngoing: (journey: PassengerOngoingJourney) => void;
  /** No running journey: clears every journey-specific field. */
  clearActiveJourney: () => void;
  /**
   * The signed-in passenger changed or signed out: clears the journey AND the
   * passenger's own profile/caregiver details. activeSOS is left as it is.
   */
  clearPassengerSession: () => void;
}

const NO_ACTIVE_JOURNEY = {
  bookingId: null,
  tripId: null,
  busId: null,
  vehicleDetails: null,
  driverId: null,
  isJourneyStarted: false,
} as const;

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const useJourneyStore = create<JourneyState>((set) => ({
  ...NO_ACTIVE_JOURNEY,
  passengerDetails: null,
  caregiverId: null,
  activeSOS: null,
  triggerLocalSOS: (passengerName?: string) => set((state) => ({
    activeSOS: {
      isActive: true,
      passengerName: passengerName || state.passengerDetails?.name || 'Unknown Passenger',
      timestamp: new Date().toISOString()
    }
  })),
  clearSOS: () => set({ activeSOS: null }),
  setJourneyStarted: (started: boolean) => set({ isJourneyStarted: started }),
  setActiveJourneyFromOngoing: (journey: PassengerOngoingJourney) => {
    const { booking } = journey;
    const tripId = nonEmpty(journey.activeJourney?.tripId) ?? nonEmpty(booking.tripId);
    // The bus that started this run; the booking's own bus only if none is named.
    const busId = nonEmpty(journey.busId) ?? nonEmpty(booking.busId);
    const plateNumber = nonEmpty(booking.vehicle?.numberPlate) ?? busId;

    set({
      isJourneyStarted: true,
      bookingId: booking.bookingId,
      tripId,
      busId,
      vehicleDetails: plateNumber
        ? { plateNumber, model: nonEmpty(booking.vehicle?.busModel) ?? 'Transit Bus' }
        : null,
      driverId: busId ?? tripId,
    });
  },
  clearActiveJourney: () => set({ ...NO_ACTIVE_JOURNEY }),
  clearPassengerSession: () => set({ ...NO_ACTIVE_JOURNEY, passengerDetails: null, caregiverId: null }),
}));
