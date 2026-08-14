import { Bus } from '../../../entities/bus/model/types';
import { Route } from '../../../entities/route/model/types';
import { Trip, TripStatus } from '../../../entities/trip/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

export interface CreateTripPayload {
    routeId: string;
    busId: string;
    departureTime: string; // 'HH:MM' (24-hour)
    estimatedArrivalTime: string; // 'HH:MM' (24-hour)
    turnNumber: number;
    status: TripStatus;
}

async function readJson(response: Response): Promise<any> {
    return response.json().catch(() => null);
}

/** Loads routes from the existing routes API. */
export async function fetchRoutes(): Promise<Route[]> {
    const response = await fetch(`${API_BASE_URL}/api/routes`);
    const data = await readJson(response);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to load routes.');
    }

    return Array.isArray(data.routes) ? (data.routes as Route[]) : [];
}

/** Loads buses from the existing buses API. */
export async function fetchBuses(): Promise<Bus[]> {
    const response = await fetch(`${API_BASE_URL}/api/buses`);
    const data = await readJson(response);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to load buses.');
    }

    return Array.isArray(data.buses) ? (data.buses as Bus[]) : [];
}

/**
 * Creates a trip through the existing trips API. The payload keeps busId as the
 * bus reference — the UI resolves the admin's number-plate choice to its busId
 * before calling this, so the backend contract is unchanged.
 */
export async function createTrip(payload: CreateTripPayload): Promise<Trip> {
    const response = await fetch(`${API_BASE_URL}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const data = await readJson(response);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to create the trip. Please try again.');
    }

    return data.trip as Trip;
}
