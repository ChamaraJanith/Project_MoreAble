// Loading the trips a bus can start (MOV-294).
//
// Uses two endpoints that already exist, unchanged:
//
//   GET /api/trips?busId=   — every trip assigned to the bus (the Passenger
//                             Manifest tab reads the same list)
//   GET /api/routes/:routeId — the route number, name and endpoints
//
// Each route is fetched once however many of the bus's trips run on it.

import { Trip } from '../../../entities/trip/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { AssignedTrip, AssignedTripRoute, buildAssignedTrips } from '../utils/assignedTrips';

async function getJson(path: string): Promise<any> {
    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`);
    } catch {
        throw new Error('Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to load assigned trips.');
    }

    return data;
}

/**
 * A route's card details, or undefined when it cannot be read.
 *
 * A missing route does not fail the whole list: the trip is still shown by its
 * time, and the driver can still start it.
 */
async function loadRoute(routeId: string): Promise<AssignedTripRoute | undefined> {
    try {
        const data = await getJson(`/api/routes/${encodeURIComponent(routeId)}`);
        return data.route as AssignedTripRoute;
    } catch {
        return undefined;
    }
}

/** Every trip assigned to `busId`, with its route, soonest first. */
export async function fetchAssignedTrips(busId: string): Promise<AssignedTrip[]> {
    const data = await getJson(`/api/trips?busId=${encodeURIComponent(busId)}`);
    const trips: Trip[] = Array.isArray(data.trips) ? data.trips : [];

    const routeIds = Array.from(
        new Set(trips.map((trip) => trip?.routeId).filter((id): id is string => typeof id === 'string' && !!id))
    );

    const loaded = await Promise.all(routeIds.map(async (routeId) => [routeId, await loadRoute(routeId)] as const));
    const routes = Object.fromEntries(loaded);

    return buildAssignedTrips(busId, trips, routes);
}
