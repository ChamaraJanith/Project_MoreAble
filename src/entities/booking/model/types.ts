export type SeatStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED';

export interface Seat {
  seatNumber: string;
  isPrioritySeat: boolean;
  status: SeatStatus;
  bookingId: string | null;
}

// Matches Kasun's real Bus/Route/Trip models exactly.
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

// US02 (MOV-184): what "Select Transport Vehicle" holds temporarily.
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