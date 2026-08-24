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
    /**
     * Configured travelling minutes between each CONSECUTIVE pair of `stops`
     * (MOV-88).
     *
     * Entry `i` is the time from `stops[i]` to `stops[i + 1]`, so a fully timed
     * route has exactly `stops.length - 1` entries and the array is read in the
     * same travel order as `stops` itself — no separate ordering field, because
     * `stops` is already the authoritative sequence.
     *
     * This is the only stop-level timing the project holds, and it exists
     * because `estimatedDuration` and a trip's departure/arrival times all
     * describe the WHOLE route: none of them can say how long a passenger
     * boarding mid-route actually travels for. Summing the entries between the
     * boarded and alighted stops can, which is what MOV-88 needs.
     *
     * Entered by an operator against real timings, never derived. A gap nobody
     * has timed yet is `null` rather than a guess, and the whole field is
     * optional so every route that predates it stays valid — an untimed route
     * simply reports no passenger-specific duration instead of a wrong one.
     */
    segmentDurationsMinutes?: (number | null)[] | null;
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
     * How far the PASSENGER travels: origin stop to destination stop, not the
     * whole route (MOV-88).
     *
     * `distanceKm` above is the route's own end-to-end total and stays that, so
     * the admin screens reading it are unaffected. This is the part of it the
     * passenger actually rides, measured stop by stop along their own span.
     *
     * Sources, in order:
     *   - a journey covering the whole route reports the route's recorded
     *     `distanceKm`, which is the operator's own authoritative figure;
     *   - a partial journey is summed from the stop coordinates already stored
     *     in the `stops` collection, consecutive pair by consecutive pair — the
     *     same measurement the fare calculation has billed on since MOV-97.
     *
     * Null when a stop on the passenger's path has no stored coordinates.
     * Nothing here scales the route total by a fraction of the stops or
     * estimates from a stop count: a distance that cannot be measured is
     * reported as unavailable rather than approximated.
     */
    journeyDistanceKm?: number | null;
    /**
     * This route's own `Route.segmentDurationsMinutes`, passed through unchanged
     * and still aligned to the FULL `stops` list rather than to `journeyStops`
     * (MOV-88).
     *
     * Deliberately not pre-sliced. The passenger's boarding time depends on the
     * gaps BEFORE they board — the part `journeyStops` deliberately excludes —
     * so a consumer needs the whole route's timings to place the journey inside
     * the trip. Slicing here would throw that away and leave the duration
     * correct but its departure time wrong.
     *
     * Null when the operator has not timed this route.
     */
    segmentDurationsMinutes?: (number | null)[] | null;
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