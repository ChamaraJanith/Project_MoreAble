export type SeatStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED';

export interface Seat {
  seatNumber: string;
  isPrioritySeat: boolean;
  status: SeatStatus;
  bookingId: string | null;
}

export interface TransportOption {
  tripId: string;
  routeId: string;
  routeNumber: string;
  busId: string;
  vehicleNumber: string;
  departureTime: string;
  estimatedArrivalTime: string;
  accessibilityScore: number;
  totalSeats: number;
  availableSeats: number;
  availablePrioritySeats: number;
  facilities: {
    ramp: boolean;
    wheelchairSpace: boolean;
    audioAnnouncement: boolean;
    lowFloor: boolean;
  };
}