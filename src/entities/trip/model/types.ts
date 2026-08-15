export type TripStatus = 'ACTIVE' | 'INACTIVE';

// One scheduled journey ("turn") made by one bus on one route at a particular time.
// A bus is never permanently tied to a route — it relates to routes only through
// its trips, so the same bus can serve multiple routes/directions in a day.
export interface Trip {
    tripId: string;
    routeId: string;
    busId: string;
    departureTime: string; // 'HH:MM' (24-hour)
    estimatedArrivalTime: string; // 'HH:MM' (24-hour)
    turnNumber: number;
    status: TripStatus;
    createdAt?: unknown;
    updatedAt?: unknown;
}
