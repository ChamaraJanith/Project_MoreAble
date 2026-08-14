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

// A scheduled trip on a matched route, departing at/after the requested travel time.
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

// One travellable journey option: a specific trip on a matched route, together
// with the bus operating it. `bus` is null only when the referenced bus document
// is missing, so the UI can still show the departure without crashing.
export interface JourneySearchOption {
    trip: JourneySearchTrip;
    bus: JourneySearchBus | null;
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
    // Every ACTIVE trip departing at/after the requested travel time, ordered
    // earliest first. Empty when the route matches but has no upcoming trip.
    trips: JourneySearchOption[];
}
