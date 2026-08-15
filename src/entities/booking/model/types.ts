export type SeatStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED';
export type SeatCategory = 'STANDARD' | 'PRIORITY' | 'GUARDIAN';

export interface Seat {
  seatNumber: string;
  category: SeatCategory;
  // Kept alongside `category` because the booking-confirm API and the seat
  // selection screen already read this flag directly.
  isPrioritySeat: boolean;
  status: SeatStatus;
  bookingId: string | null;
}

export type SeatSlotKind = 'SEAT' | 'WHEELCHAIR_SPACE' | 'EMPTY';

/** One physical position in a row — either a real seat, a wheelchair space, or empty space. */
export interface SeatSlot {
  kind: SeatSlotKind;
  seat: Seat | null;
}

export interface SeatMapRow {
  rowNumber: number;
  /** True for the wheelchair-space + guardian-seat row(s) near the entrance. */
  isAccessibilityRow: boolean;
  left: SeatSlot[];
  right: SeatSlot[];
}

export interface SeatLayout {
  rows: SeatMapRow[];
}

// Matches the real Trip + Bus + Route models.
export interface TransportOption {
  tripId: string;
  routeId: string;
  routeNumber: string;
  routeName: string;
  busId: string;
  numberPlate: string;
  busModel: string;
  manufacturer: string;
  departureTime: string; // 'HH:MM'
  estimatedArrivalTime: string; // 'HH:MM'
  accessibilityScore: number; // 0-100
  totalSeats: number;
  availableSeats: number;
  availablePrioritySeats: number;
  facilities: {
    wheelchairRamp: boolean;
    audioAnnouncement: boolean;
    lowFloorVehicle: boolean;
    walkingAssistance: boolean;
  };
}

export interface SelectedVehicle {
  tripId: string;
  routeId: string;
  routeNumber: string;
  routeName: string;
  numberPlate: string;
  busModel: string;
  departureTime: string;
  estimatedArrivalTime: string;
  accessibilityScore: number;
  selectedAt: number;
}

export interface BookingJourneyDetails {
  routeNumber: string;
  routeName: string;
  startLocation: string;
  endLocation: string;
  departureTime: string;
  estimatedArrivalTime: string;
}

export interface BookingVehicleDetails {
  numberPlate: string;
  busModel: string;
  manufacturer: string;
}

export type BookingStatus = 'CONFIRMED' | 'CANCELLED';

export interface Booking {
  bookingId: string;
  userId: string;
  tripId: string;
  routeId: string;
  busId: string;
  seatNumber: string;
  isPrioritySeat: boolean;
  status: BookingStatus;
  journey: BookingJourneyDetails;
  vehicle: BookingVehicleDetails;
  qrPayload: string;
  createdAt: string;
}