import { BusAccessibilityFacilities, VehicleLocation } from '../../bus/model/types';
import { Stop } from '../../stop/model/types';

export type RouteStatus = 'ACTIVE' | 'INACTIVE';

// Direction is a property of the route itself (a route document exists per
// direction), so a trip inherits it from the route it references.
export type RouteDirection = 'OUTBOUND' | 'RETURN';

export interface Route {
    routeId: string;
    routeNumber: string;
    routeName: string;
    direction?: RouteDirection;
    startLocation: string;
    endLocation: string;
    startStopId?: string;
    endStopId?: string;
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

// The bus operating a JourneySearchTrip.
export interface JourneySearchBus {
    busId: string;
    numberPlate: string;
    busModel: string;
    manufacturer: string;
    seatCapacity: number;
    accessibilityFacilities: BusAccessibilityFacilities;
    /**
     * How accessible this vehicle is, from the facilities recorded against it
     * (MOV-89).
     *
     * Carried so a recommendation can be ranked by it without every caller
     * re-deriving it from the facilities — and so the ranking layer (MOV-87)
     * never has to know how the figure is produced.
     *
     * Not calculated here and not calculated by the search: it is the same
     * `computeAccessibilityScore` the booking flow already reports, so a bus
     * reads the same in both places. What that score should eventually take
     * into account — community reports, ratings, delay history, reliability —
     * belongs to MOV-79, and widening it there widens it here for free.
     *
     * Present only when the bus record itself is. A trip whose bus is missing
     * has `bus: null`, which the ranking layer treats as an unknown score
     * rather than a bad one.
     */
    accessibilityScore: number;
}

/**
 * What is known right now about the vehicle operating a trip (MOV-120).
 *
 * Follows the same best-effort shape as `JourneyGeoInformation`: `available`
 * says whether there is anything to show, and `message` explains its absence.
 * A vehicle that has never reported a position is the normal case, not an
 * error — nothing here is ever estimated or filled in from schedule data.
 *
 * Deliberately narrow. It carries the reported position and how old that
 * report is, and nothing else. Delay and a live arrival time are part of the
 * MOV-81 story but are not derivable from the data the project stores today —
 * see the MOV-120 report — and a fabricated figure would be worse for a
 * passenger than an honest absence.
 */
export interface JourneyLiveStatus {
    /** True only when a real GPS report exists for this trip's own bus. */
    available: boolean;
    /** The stored report, exactly as the vehicle sent it. */
    location?: VehicleLocation;
    /**
     * Whole seconds between the GPS fix and the moment this response was built.
     *
     * Reported rather than classified: the project has no agreed threshold for
     * when a position stops counting as current, so how old is "too old" is
     * left to the caller. A negative value means the reporting device's clock
     * is ahead of the server's.
     */
    locationAgeSeconds?: number;
    message?: string;
}

// One travellable journey option: a specific trip on a matched route, together
// with the bus operating it. `bus` is null only when the referenced bus document
// is missing, so the UI can still show the departure without crashing.
export interface JourneySearchOption {
    trip: JourneySearchTrip;
    bus: JourneySearchBus | null;
    /**
     * Live vehicle data for this option's own bus, resolved through the same
     * `trip.busId` as `bus`. Always present, so a caller can tell "not tracked"
     * from "not implemented" without guessing.
     */
    liveStatus: JourneyLiveStatus;
}

// ------------------------------------------------------------------
// Geographic enrichment (MOV-85)
//
// The Journey Search API already returns this alongside the matched routes; the
// shapes are mirrored here so passenger screens can consume it without importing
// server-only modules. It is best-effort: `available` is false whenever
// OpenStreetMap could not resolve the journey, and the UI degrades gracefully.
// ------------------------------------------------------------------

export interface GeoPoint {
    latitude: number;
    longitude: number;
    displayName?: string;
}

/** GeoJSON LineString: an array of [longitude, latitude] pairs. */
export interface RouteGeometry {
    type: string;
    coordinates: [number, number][];
}

export interface JourneyRoadRoute {
    distanceKm: number;
    durationMinutes: number;
    geometry?: RouteGeometry;
}

/**
 * A stop whose coordinates are known, as carried in the journey geo block.
 *
 * Exactly the part of a Stop a map needs — the stop entity itself stays the
 * single source of truth for the shape.
 */
export type JourneyStopPoint = Pick<Stop, 'name' | 'latitude' | 'longitude'>;

export interface JourneyGeoInformation {
    available: boolean;
    origin?: GeoPoint;
    destination?: GeoPoint;
    road?: JourneyRoadRoute;
    /**
     * Known coordinates for the stops on the matched routes.
     *
     * A directory, not a path: several routes can match one search, each with
     * its own stop sequence, so travel order belongs to a route's own
     * `journeyStops` rather than to this shared list. Stops without usable
     * coordinates are omitted entirely.
     */
    stops?: JourneyStopPoint[];
    message?: string;
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
    /**
     * The road path along this route's own stop sequence, from OSRM.
     *
     * Per route rather than per search: two routes can connect the same pair of
     * places by different roads, so the geometry belongs to the route the
     * passenger picked. Absent when the road could not be resolved.
     */
    road?: JourneyRoadRoute;
    // Every ACTIVE trip departing at/after the requested travel time, ordered
    // earliest first. Empty when the route matches but has no upcoming trip.
    trips: JourneySearchOption[];
}