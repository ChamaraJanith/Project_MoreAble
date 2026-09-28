import { create } from 'zustand';

interface ActiveSOS {
  isActive: boolean;
  passengerName: string;
  timestamp: string;
}

interface JourneyState {
  bookingId: string | null;
  vehicleDetails: { plateNumber: string; model: string } | null;
  driverId: string | null;
  passengerDetails: { id: string; name: string; phone: string } | null;
  caregiverId: string | null;
  activeSOS: ActiveSOS | null;
  triggerLocalSOS: () => void;
  clearSOS: () => void;
}

export const useJourneyStore = create<JourneyState>((set) => ({
  bookingId: 'BKG-998877',
  vehicleDetails: { plateNumber: 'WP-CBA-1234', model: 'Toyota Prius' },
  driverId: 'DRV-112',
  passengerDetails: { id: 'PAS-554', name: 'Nimal Silva', phone: '0771234567' },
  caregiverId: 'CG-887',
  activeSOS: null,
  triggerLocalSOS: () => set((state) => ({
    activeSOS: {
      isActive: true,
      passengerName: state.passengerDetails?.name || 'Unknown Passenger',
      timestamp: new Date().toISOString()
    }
  })),
  clearSOS: () => set({ activeSOS: null })
}));
