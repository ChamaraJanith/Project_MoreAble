import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { Bus } from '../../../src/entities/bus/model/types';
import { JourneySearchMatch, Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const TRAVEL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TRAVEL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Trims and lowercases a location value so origin/destination comparisons are
// case-insensitive and tolerant of incidental whitespace from user input.
export function normalizeLocation(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidTravelDate(value: unknown): boolean {
  if (typeof value !== 'string' || !TRAVEL_DATE_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

export function isValidTravelTime(value: unknown): boolean {
  return typeof value === 'string' && TRAVEL_TIME_PATTERN.test(value);
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
      // Populated afterwards by attachNextTrip — a route can match without any
      // currently-available trip.
      trip: null,
      bus: null,
    });
  }

  return matches;
}

// Picks the earliest ACTIVE trip departing at/after the requested travel time.
// Trips that have already departed are ignored. Keeps the previously-existing
// route matching untouched — this only chooses among trips already known to
// belong to one matched route.
export function selectNextTrip(trips: Trip[], travelTime: string): Trip | null {
  const upcoming = trips
    .filter((trip) => trip.status === 'ACTIVE' && trip.departureTime >= travelTime)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  return upcoming.length > 0 ? upcoming[0] : null;
}

async function fetchActiveTripsForRoute(adminDb: any, routeId: string): Promise<Trip[]> {
  const tripsSnapshot = await adminDb
    .collection('trips')
    .where('routeId', '==', routeId)
    .where('status', '==', 'ACTIVE')
    .get();

  return tripsSnapshot.docs.map((doc: any) => doc.data() as Trip);
}

// Enriches a matched route with its next upcoming trip and that trip's bus, if
// any. A route with no qualifying trip is still a valid match — trip/bus are
// simply left null so the UI can render the route without crashing.
async function attachNextTrip(
  adminDb: any,
  match: JourneySearchMatch,
  travelTime: string
): Promise<JourneySearchMatch> {
  const trips = await fetchActiveTripsForRoute(adminDb, match.routeId);
  const nextTrip = selectNextTrip(trips, travelTime);

  if (!nextTrip) {
    return match;
  }

  const busDoc = await adminDb.collection('buses').doc(nextTrip.busId).get();
  const bus = busDoc.exists ? (busDoc.data() as Bus) : null;

  return {
    ...match,
    trip: {
      tripId: nextTrip.tripId,
      departureTime: nextTrip.departureTime,
      estimatedArrivalTime: nextTrip.estimatedArrivalTime,
      turnNumber: nextTrip.turnNumber,
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

    const matchedRoutes = findMatchingRoutes(routes, trimmedOrigin, trimmedDestination);

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
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    }

    // Attach each route's next upcoming trip (and that trip's bus), if any.
    const enrichedRoutes = await Promise.all(
      matchedRoutes.map((match) => attachNextTrip(adminDb, match, travelTime))
    );

    return Response.json(
      {
        success: true,
        message: `${enrichedRoutes.length} matching route${enrichedRoutes.length > 1 ? 's' : ''} found.`,
        searchCriteria,
        count: enrichedRoutes.length,
        routes: enrichedRoutes,
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
