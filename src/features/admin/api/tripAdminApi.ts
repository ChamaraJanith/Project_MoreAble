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