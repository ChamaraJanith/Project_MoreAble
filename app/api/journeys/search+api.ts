import { Bus } from '../../../src/entities/bus/model/types';
import { JourneySearchMatch, Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { Coordinates, GeocodedLocation, geocodeLocation } from '../../../src/shared/api/locationService';
import { getRouteBetweenCoordinates, RoadRoute } from '../../../src/shared/api/routingService';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { normalizeLocation } from '../../../src/shared/utils/location';
export { normalizeLocation };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const TRAVEL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TRAVEL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Trims and lowercases a location value so origin/destination comparisons are
// case-insensitive and tolerant of incidental whitespace from user input.

export function isValidTravelDate(value: unknown): boolean {
  if (typeof value !== 'string' || !TRAVEL_DATE_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

export function isValidTravelTime(value: unknown): boolean {
  return typeof value === 'string' && TRAVEL_TIME_PATTERN.test(value);
}

// Locations are validated against the data the search itself matches on: the
// stop names of ACTIVE routes, plus the `stops` master collection when present.
// Anything a route actually serves therefore stays searchable, while a name the
// system has never heard of is rejected instead of silently returning no results.
export function collectKnownLocations(routes: Route[], stopNames: string[] = []): Set<string> {
  const knownLocations = new Set<string>();

  for (const route of routes) {
    if (!Array.isArray(route.stops)) continue;

    for (const stop of route.stops) {
      const normalized = normalizeLocation(stop);
      if (normalized) knownLocations.add(normalized);
    }
  }

  for (const stopName of stopNames) {
    const normalized = normalizeLocation(stopName);
    if (normalized) knownLocations.add(normalized);
  }

  return knownLocations;
}

export function isKnownLocation(value: unknown, knownLocations: Set<string>): boolean {
  const normalized = normalizeLocation(value);
  return normalized.length > 0 && knownLocations.has(normalized);
}

export function isSameLocation(origin: unknown, destination: unknown): boolean {
  const normalizedOrigin = normalizeLocation(origin);
  return normalizedOrigin.length > 0 && normalizedOrigin === normalizeLocation(destination);
}

interface StopRecord {
  name: string;
  latitude?: number;
  longitude?: number;
}

// Stop master data is optional, so a failure here must not fail the search —
// route stops remain the primary source of known locations. The same single read
// also supplies stored coordinates, so MOV-85 adds no extra Firestore traffic.
async function fetchStops(adminDb: any): Promise<StopRecord[]> {
  try {
    const snapshot = await adminDb.collection('stops').get();
    return snapshot.docs
      .map((doc: any) => doc.data())
      .filter((stop: any) => typeof stop?.name === 'string')
      .map((stop: any) => ({
        name: stop.name,
        latitude: typeof stop.latitude === 'number' ? stop.latitude : undefined,
        longitude: typeof stop.longitude === 'number' ? stop.longitude : undefined,
      }));
  } catch {
    return [];
  }
}

// Coordinates already recorded against a stop are preferred over an external
// geocoding call.
function buildStopCoordinateMap(stops: StopRecord[]): Map<string, Coordinates> {
  const coordinates = new Map<string, Coordinates>();

  for (const stop of stops) {
    if (typeof stop.latitude !== 'number' || typeof stop.longitude !== 'number') continue;

    const normalized = normalizeLocation(stop.name);
    if (normalized) {
      coordinates.set(normalized, { latitude: stop.latitude, longitude: stop.longitude });
    }
  }

  return coordinates;
}

/**
 * Resolves one location to coordinates, cheapest source first:
 * stored stop coordinates -> Nominatim. Results are memoised per request so the
 * public geocoder is never asked for the same place twice.
 */
async function resolveCoordinates(
  location: string,
  stopCoordinates: Map<string, Coordinates>,
  cache: Map<string, GeocodedLocation | null>
): Promise<GeocodedLocation | null> {
  const key = normalizeLocation(location);
  if (!key) return null;

  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const stored = stopCoordinates.get(key);
  const resolved = stored ? { ...stored } : await geocodeLocation(location);

  cache.set(key, resolved);
  return resolved;
}

export interface JourneyGeoInformation {
  available: boolean;
  origin?: GeocodedLocation;
  destination?: GeocodedLocation;
  road?: RoadRoute;
  message?: string;
}

/**
 * Best-effort geographic enrichment. Any failure downgrades to
 * `{ available: false }` — it can never fail the journey search itself.
 */
async function buildGeoInformation(
  origin: string,
  destination: string,
  stopCoordinates: Map<string, Coordinates>
): Promise<JourneyGeoInformation> {
  try {
    const cache = new Map<string, GeocodedLocation | null>();

    const [originPoint, destinationPoint] = await Promise.all([
      resolveCoordinates(origin, stopCoordinates, cache),
      resolveCoordinates(destination, stopCoordinates, cache),
    ]);

    if (!originPoint || !destinationPoint) {
      return {
        available: false,
        origin: originPoint ?? undefined,
        destination: destinationPoint ?? undefined,
        message: 'Map information is currently unavailable for this journey.',
      };
    }

    const road = await getRouteBetweenCoordinates(originPoint, destinationPoint);

    if (!road) {
      return {
        available: false,
        origin: originPoint,
        destination: destinationPoint,
        message: 'Road routing information is currently unavailable.',
      };
    }

    return { available: true, origin: originPoint, destination: destinationPoint, road };
  } catch {
    return {
      available: false,
      message: 'Map information is currently unavailable for this journey.',
    };
  }
}

// A route matches only when both origin and destination are stops on it and the
// origin comes before the destination, so the reverse-direction route document
// (e.g. 177_KOLLUPITIYA_KADUWELA) is required to match a reversed search.
export function findMatchingRoutes(
  routes: Route[],
  origin: string,
  destination: string
): JourneySearchMatch[] {
  const normalizedOrigin = normalizeLocation(origin);
  const normalizedDestination = normalizeLocation(destination);

  const matches: JourneySearchMatch[] = [];

  for (const route of routes) {
    if (!Array.isArray(route.stops)) continue;

    const normalizedStops = route.stops.map((stop) => normalizeLocation(stop));
    const originIndex = normalizedStops.indexOf(normalizedOrigin);
    const destinationIndex = normalizedStops.indexOf(normalizedDestination);

    if (originIndex === -1 || destinationIndex === -1) continue;
    if (originIndex >= destinationIndex) continue;

    matches.push({
      routeId: route.routeId,
      routeNumber: route.routeNumber,
      routeName: route.routeName,
      startLocation: route.startLocation,
      endLocation: route.endLocation,
      origin: route.stops[originIndex],
      destination: route.stops[destinationIndex],
      stops: route.stops,
      journeyStops: route.stops.slice(originIndex, destinationIndex + 1),
      distanceKm: route.distanceKm ?? null,
      estimatedDuration: route.estimatedDuration ?? null,
      // Populated afterwards by attachUpcomingTrips — a route can match without
      // any currently-available trip.
      trips: [],
    });
  }

  return matches;
}

// Returns every ACTIVE trip departing at/after the requested travel time,
// earliest first. Trips that have already departed are ignored. Keeps the
// previously-existing route matching untouched — this only filters trips
// already known to belong to one matched route.
export function selectUpcomingTrips(trips: Trip[], travelTime: string): Trip[] {
  return trips
    .filter((trip) => trip.status === 'ACTIVE' && trip.departureTime >= travelTime)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

async function fetchActiveTripsForRoute(adminDb: any, routeId: string): Promise<Trip[]> {
  const tripsSnapshot = await adminDb
    .collection('trips')
    .where('routeId', '==', routeId)
    .where('status', '==', 'ACTIVE')
    .get();

  return tripsSnapshot.docs.map((doc: any) => doc.data() as Trip);
}

// Loads a bus once per request — the same bus commonly operates several trips,
// so results are memoised to avoid repeating identical Firestore reads.
async function loadBus(
  adminDb: any,
  busId: string,
  busCache: Map<string, Bus | null>
): Promise<Bus | null> {
  if (busCache.has(busId)) {
    return busCache.get(busId) ?? null;
  }

  const busDoc = await adminDb.collection('buses').doc(busId).get();
  const bus = busDoc.exists ? (busDoc.data() as Bus) : null;

  busCache.set(busId, bus);
  return bus;
}

// Enriches a matched route with every upcoming trip and each trip's bus. A route
// with no qualifying trip is still a valid match — `trips` is simply empty so the
// UI can report "no departures" without crashing.
async function attachUpcomingTrips(
  adminDb: any,
  match: JourneySearchMatch,
  travelTime: string,
  busCache: Map<string, Bus | null>
): Promise<JourneySearchMatch> {
  const trips = await fetchActiveTripsForRoute(adminDb, match.routeId);
  const upcomingTrips = selectUpcomingTrips(trips, travelTime);

  const options = await Promise.all(
    upcomingTrips.map(async (trip) => {
      const bus = await loadBus(adminDb, trip.busId, busCache);

      return {
        trip: {
          tripId: trip.tripId,
          departureTime: trip.departureTime,
          estimatedArrivalTime: trip.estimatedArrivalTime,
          turnNumber: trip.turnNumber,
        },
        bus: bus
          ? {
              busId: bus.busId,
              numberPlate: bus.numberPlate,
              busModel: bus.busModel,
              manufacturer: bus.manufacturer,
              seatCapacity: bus.seatCapacity,
              accessibilityFacilities: bus.accessibilityFacilities,
            }
          : null,
      };
    })
  );

  return { ...match, trips: options };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// POST /api/journeys/search
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { origin, destination, travelDate, travelTime } = body ?? {};

    const trimmedOrigin = typeof origin === 'string' ? origin.trim() : '';
    const trimmedDestination = typeof destination === 'string' ? destination.trim() : '';

    if (!trimmedOrigin) {
      return Response.json(
        {
          success: false,
          message: 'Origin is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!trimmedDestination) {
      return Response.json(
        {
          success: false,
          message: 'Destination is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (isSameLocation(trimmedOrigin, trimmedDestination)) {
      return Response.json(
        {
          success: false,
          message: 'Origin and destination cannot be the same',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!isValidTravelDate(travelDate)) {
      return Response.json(
        {
          success: false,
          message: 'A valid travel date (YYYY-MM-DD) is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!isValidTravelTime(travelTime)) {
      return Response.json(
        {
          success: false,
          message: 'A valid travel time (HH:MM) is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    const routesSnapshot = await adminDb
      .collection('routes')
      .where('status', '==', 'ACTIVE')
      .get();

    const routes: Route[] = routesSnapshot.docs.map((doc: any) => doc.data() as Route);

    const stops = await fetchStops(adminDb);
    const knownLocations = collectKnownLocations(
      routes,
      stops.map((stop) => stop.name)
    );

    if (!isKnownLocation(trimmedOrigin, knownLocations)) {
      return Response.json(
        {
          success: false,
          message: 'Invalid origin location',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!isKnownLocation(trimmedDestination, knownLocations)) {
      return Response.json(
        {
          success: false,
          message: 'Invalid destination location',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const matchedRoutes = findMatchingRoutes(routes, trimmedOrigin, trimmedDestination);

    // MOV-85: geographic enrichment around the already-validated locations. This
    // never influences which public transport route is matched.
    const geo = await buildGeoInformation(
      trimmedOrigin,
      trimmedDestination,
      buildStopCoordinateMap(stops)
    );

    const searchCriteria = {
      origin: trimmedOrigin,
      destination: trimmedDestination,
      travelDate,
      travelTime,
    };

    if (matchedRoutes.length === 0) {
      return Response.json(
        {
          success: true,
          message: 'No matching routes found for this journey.',
          searchCriteria,
          count: 0,
          routes: [],
          geo,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    }

    // Attach each route's upcoming trips (and each trip's bus), if any.
    const busCache = new Map<string, Bus | null>();
    const enrichedRoutes = await Promise.all(
      matchedRoutes.map((match) => attachUpcomingTrips(adminDb, match, travelTime, busCache))
    );

    return Response.json(
      {
        success: true,
        message: `${enrichedRoutes.length} matching route${enrichedRoutes.length > 1 ? 's' : ''} found.`,
        searchCriteria,
        count: enrichedRoutes.length,
        routes: enrichedRoutes,
        geo,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Journey Search API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while searching journeys.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
