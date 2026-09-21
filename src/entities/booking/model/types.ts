import { JourneyLiveStatus, JourneyRoadRoute, JourneyStopPoint } from '../../route/model/types';

export type SeatStatus ='AVAILABLE' | 'RESERVED' | 'OCCUPIED';
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

/**
 * One of the signed-in passenger's own bookings whose exact trip is running
 * right now, with where that trip's bus is (MOV-295).
 *
 * Returned by GET /api/journeys/ongoing. Journey details (route, stops,
 * scheduled times, vehicle) are the booking's own `journey` and `vehicle`
 * blocks rather than copies of them.
 */
/**
 * The ticket price of an ongoing journey (MOV-297): what the passenger paid and
 * nothing of how it was worked out — no distance, concession or assistance
 * breakdown, which could reveal why a discount applied.
 */
export type OngoingJourneyFare = Pick<FareBreakdown, 'totalFare' | 'currency' | 'isEstimate'>;

/**
 * The part of a booking an ongoing journey needs (MOV-296). A fixed allow-list:
 * no ticket QR, assistance or free-text notes, and no stray fields from the
 * stored document. The full booking stays available through the booking
 * screens. MOV-297 adds only the ticket price, reduced to `OngoingJourneyFare`.
 */
export type OngoingJourneyBooking = Pick<
  Booking,
  | 'bookingId'
  | 'userId'
  | 'tripId'
  | 'routeId'
  | 'busId'
  | 'seatNumber'
  | 'pairedSeatNumber'
  | 'status'
  | 'boardingStatus'
  | 'boardedAt'
  | 'journey'
  | 'vehicle'
> & {
  /** Null when the stored booking has no readable total. */
  fare: OngoingJourneyFare | null;
};

/**
 * The planned path of an ongoing journey, for the live tracking map (MOV-297).
 *
 * Derived on the server from the running trip's own route — never from an id
 * the client sent — and only sent when the screen asks for it, since none of it
 * changes while the journey runs.
 */
export interface OngoingJourneyRoute {
  /** The whole route's stops in travel order; needed to place the passenger's times. */
  stops: string[];
  /** The passenger's own stops, boarding to alighting, in travel order. */
  journeyStops: string[];
  /** Coordinates for those of `journeyStops` that have them, in the same order. */
  stopPoints: JourneyStopPoint[];
  /** The route's configured stop-to-stop minutes, aligned to `stops`; null when untimed. */
  segmentDurationsMinutes: (number | null)[] | null;
  /** The OSRM road path through `stopPoints`; null when it could not be resolved. */
  road: JourneyRoadRoute | null;
}

export interface PassengerOngoingJourney {
  booking: OngoingJourneyBooking;
  /** The running Start Journey of booking.tripId. */
  activeJourney: BookingActiveJourney;
  /** The bus that started this trip's journey; null only if the record names none. */
  busId: string | null;
  /**
   * The existing live block (see buildLiveStatus). `available` only when that
   * bus's latest fix was reported for THIS trip; age is reported, not judged.
   */
  liveStatus: JourneyLiveStatus;
  /**
   * The planned path (MOV-297). Present only when the request asked for it
   * (`?include=route`); null when the route could not be read.
   */
  route?: OngoingJourneyRoute | null;
}




export interface FareBreakdown {
  distanceKm: number;
  baseFare: number;
  distanceFare: number;
  subtotalFare?: number;
  concessionDiscount?: number;
  concessionType?: 'ACCESSIBILITY' | 'ELDERLY' | 'NONE';
  concessionDiscountPercent?: number;
  assistanceFee?: number;
  isWheelchairPaired?: boolean;
  pairedSeatNumber?: string | null;
  guardianFare?: number;
  guardianRatePercent?: number;
  totalFare: number;
  currency: 'LKR';
  isEstimate: boolean;
}

export interface FarePolicy {
  id: string;
  currency: 'LKR';
  baseFare: number;
  baseDistanceKm: number;
  ratePerKm: number;
  accessibilityDiscountPercent: number;
  elderlyDiscountPercent: number;
  assistanceSurchargeLkr: number;
  guardianCompanionRatePercent: number;
  updatedAt: string;
  updatedBy?: string;
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