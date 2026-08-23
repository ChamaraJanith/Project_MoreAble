export type SeatStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED';
export type SeatCategory = 'STANDARD' | 'PRIORITY' | 'GUARDIAN' | 'ELDERLY' | 'WHEELCHAIR';

export interface Seat {
  seatNumber: string;
  category: SeatCategory;
  isPrioritySeat: boolean;
  status: SeatStatus;
  bookingId: string | null;
  /** WHEELCHAIR seat -> its paired GUARDIAN seat, and vice versa. Null when not paired to anything. */
  pairedSeatNumber: string | null;
  /** Minimum passenger age required to book this seat. Only set on ELDERLY seats (60). */
  minAge: number | null;
}

export type SeatSlotKind = 'SEAT' | 'EMPTY';

export interface SeatSlot {
  kind: SeatSlotKind;
  seat: Seat | null;
}

export type SeatRowKind = 'SEATS' | 'WHEELCHAIR_PAIR';

export interface SeatMapRow {
  rowNumber: number;
  isAccessibilityRow: boolean;
  kind: SeatRowKind;
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
  departureTime: string;
  estimatedArrivalTime: string;
  accessibilityScore: number;
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
  origin: string;        // ADD — passenger's actual boarding stop
  destination: string; // ADD — passenger's actual alighting stop
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

export type AssistanceStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DECLINED';

export interface Booking {
  bookingId: string;
  userId: string;
  tripId: string;
  routeId: string;
  busId: string;
  seatNumber: string;
  seatCategory?: SeatCategory;
  isPrioritySeat: boolean;
  pairedSeatNumber: string | null;
  status: BookingStatus;
  journey: BookingJourneyDetails;
  vehicle: BookingVehicleDetails;
  qrPayload: string;
  fare: FareBreakdown;
  assistanceRequested: AssistanceRequested;
  assistanceStatus?: AssistanceStatus;
  assistanceUpdatedAt?: string;
  specialRequests: string;
  isPriorityAutoEligible?: boolean;
  priorityAccessReason?: string | null;
  reminderSent?: boolean;
  reminderSentAt?: string;
  createdAt: string;
}


export interface FareBreakdown {
  distanceKm: number;
  baseFare: number;
  distanceFare: number;
  totalFare: number;
  currency: 'LKR';
  isEstimate: boolean;
}

export interface AssistanceRequested {
  wheelchairAssistance?: boolean;
  boardingAssistance: boolean;
  walkingAssistance: boolean;
  prioritySeatAssistance: boolean;
}