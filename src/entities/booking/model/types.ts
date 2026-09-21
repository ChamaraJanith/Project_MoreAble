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

export type BoardingStatus = 'NOT_BOARDED' | 'BOARDED';
export type PaymentStatus = 'PAID' | 'COLLECT_CASH' | 'PENDING';

/**
 * Whether the bus operating a booking's own trip is reporting its position
 * (MOV-294).
 *
 * Resolved server-side as booking.tripId -> trips/{tripId}.busId ->
 * vehicleLocations/{busId}, so it can only ever describe the vehicle running
 * the passenger's booked trip. Facts only: it never carries coordinates, and
 * whether the report is recent enough to count as live is left to the reader.
 */
export interface BookingLiveSharing {
  /** The trip this block was resolved for; always the booking's own tripId. */
  tripId: string;
  /** The bus currently assigned to that trip. */
  busId: string;
  /** True only when that bus has a stored GPS report. */
  available: boolean;
  /** ISO 8601 time of the latest GPS fix, when there is one. */
  recordedAt?: string;
  /** Whole seconds between that fix and the moment the response was built. */
  locationAgeSeconds?: number;
}

export interface Booking {
  bookingId: string;
  userId: string;
  passengerName?: string;
  tripId: string;
  routeId: string;
  busId: string;
  seatNumber: string;
  seatCategory?: SeatCategory;
  isPrioritySeat: boolean;
  pairedSeatNumber: string | null;
  status: BookingStatus;
  boardingStatus?: BoardingStatus;
  boardedAt?: string;
  paymentStatus?: PaymentStatus;
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
  /** Only present when requested from the booking history (MOV-294). */
  liveSharing?: BookingLiveSharing;
  /** Present only while this booking's own trip has a running journey (MOV-294). */
  activeJourney?: BookingActiveJourney;
}

/**
 * The running journey of a booking's own trip (MOV-294).
 *
 * Read from trips/{booking.tripId}.journey, so it can only ever describe the
 * exact trip the passenger booked. Sent only while that journey is running.
 */
export interface BookingActiveJourney {
  /** Always the booking's own tripId. */
  tripId: string;
  /** ISO 8601, when the bus pressed Start Journey. */
  startedAt: string;
  /** ISO 8601, when it stops counting as running if nobody ends it. */
  expiresAt: string;
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


export interface BoardingVerificationResult {
  valid: boolean;
  message: string;
  booking: Booking;
  passengerName?: string;
  dropOffHalt: string;
  boardingHalt: string;
  seatNumber: string;
  pairedSeatNumber?: string | null;
  isPrioritySeat: boolean;
  isWheelchair: boolean;
  fareAmount: number;
  fareCurrency: string;
  paymentStatus: PaymentStatus;
  assistanceRequested: AssistanceRequested;
  specialRequests?: string;
  alreadyBoarded: boolean;
  boardedAt?: string;
  guardianInfo?: {
    guardianId?: string;
    fullName?: string;
    mobileNo?: string;
    relationship?: string;
  } | null;
}

export interface BoardingConfirmationResult {
  success: boolean;
  message: string;
  bookingId: string;
  boardingStatus: BoardingStatus;
  boardedAt: string;
  passengerNotified: boolean;
  caregiverNotified: boolean;
  caregiverName?: string;
}