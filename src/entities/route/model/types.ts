import { BusAccessibilityFacilities } from '../../bus/model/types';

export type RouteStatus = 'ACTIVE' | 'INACTIVE';

export interface Route {
    routeId: string;
    routeNumber: string;
    routeName: string;
    startLocation: string;
    endLocation: string;
    stops: string[];
    distanceKm: number | null;
    estimatedDuration: string | null;
    status: RouteStatus;
    createdAt?: unknown;
    updatedAt?: unknown;
}

// The next upcoming trip for a matched route, relative to the requested travel time.
export interface JourneySearchTrip {
    tripId: string;
    departureTime: string;
    estimatedArrivalTime: string;
    turnNumber: number;
}

// The bus operating a JourneySearchTrip. Deliberately excludes fields (e.g. an
// accessibility score) that this stage of the project does not calculate yet.
export interface JourneySearchBus {
    busId: string;
    numberPlate: string;
    busModel: string;
    manufacturer: string;
    seatCapacity: number;
    accessibilityFacilities: BusAccessibilityFacilities;
}

export interface JourneySearchMatch {
    routeId: string;
    routeNumber: string;
    routeName: string;
    startLocation: string;
    endLocation: string;
    origin: string;
    destination: string;
    stops: string[];
    journeyStops: string[];
    distanceKm: number | null;
    estimatedDuration: string | null;
    // Earliest ACTIVE trip departing at/after the requested travel time, and its
    // bus — null when the route matched but no such trip currently exists.
    trip: JourneySearchTrip | null;
    bus: JourneySearchBus | null;
}
