import { Trip, TripStatus } from '../../../entities/trip/model/types';
import { adminFetch } from './adminHttp';
import { getBuses } from './busAdminApi';
import { getRoutes } from './routeAdminApi';

export interface CreateTripPayload {
    routeId: string;
    busId: string;
    departureTime: string; // 'HH:MM' (24-hour)
    estimatedArrivalTime: string; // 'HH:MM' (24-hour)
    turnNumber: number;
    status: TripStatus;
}

// Trip scheduling needs the same route/bus lists as the management screens, so
// it reuses those clients rather than duplicating the requests.
export { getBuses as fetchBuses, getRoutes as fetchRoutes };

/**
 * POST /api/trips
 * The payload keeps busId as the bus reference — the UI resolves the admin's
 * number-plate choice to its busId before calling this, so the backend contract
 * is unchanged.
 */
export async function createTrip(payload: CreateTripPayload): Promise<Trip> {
    const data = await adminFetch('/api/trips', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    return data.trip as Trip;
}

/** GET /api/trips — every scheduled turn, with route/bus given as references. */
export async function getTrips(): Promise<Trip[]> {
    const data = await adminFetch('/api/trips');
    return Array.isArray(data.trips) ? (data.trips as Trip[]) : [];
}

/** GET /api/trips/:tripId */
export async function getTrip(tripId: string): Promise<Trip> {
    const data = await adminFetch(`/api/trips/${encodeURIComponent(tripId)}`);
    return data.trip as Trip;
}

/** PUT /api/trips/:tripId */
export async function updateTrip(
    tripId: string,
    payload: Partial<CreateTripPayload>
): Promise<Trip> {
    const data = await adminFetch(`/api/trips/${encodeURIComponent(tripId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });

    return data.trip as Trip;
}

/**
 * DELETE /api/trips/:tripId
 * The backend soft-deactivates rather than removing the document, so the trip
 * stays on record and simply drops out of journey search.
 */
export async function deactivateTrip(tripId: string): Promise<Trip> {
    const data = await adminFetch(`/api/trips/${encodeURIComponent(tripId)}`, {
        method: 'DELETE',
    });

    return data.trip as Trip;
}

/** Flips a trip between ACTIVE and INACTIVE through the update endpoint. */
export async function setTripStatus(tripId: string, status: TripStatus): Promise<Trip> {
    return updateTrip(tripId, { status });
}