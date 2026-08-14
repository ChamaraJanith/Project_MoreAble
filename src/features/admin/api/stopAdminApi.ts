import { Stop } from '../../../entities/stop/model/types';
import { adminFetch } from './adminHttp';

export interface CreateStopPayload {
    stopId: string;
    name: string;
    latitude: number;
    longitude: number;
}

// The document id identifies the stop, so it is not editable.
export type UpdateStopPayload = Omit<CreateStopPayload, 'stopId'>;

/**
 * Derives the document id from the stop name, matching the ids already in
 * Firestore ("Battaramulla" -> "battaramulla"). This keeps the technical id out
 * of the admin's way, exactly as bus management works with number plates.
 */
export function toStopId(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** GET /api/stops */
export async function getStops(): Promise<Stop[]> {
    const data = await adminFetch('/api/stops');
    return Array.isArray(data.stops) ? (data.stops as Stop[]) : [];
}

/** GET /api/stops/:stopId */
export async function getStop(stopId: string): Promise<Stop> {
    const data = await adminFetch(`/api/stops/${encodeURIComponent(stopId)}`);
    return data.stop as Stop;
}

/** POST /api/stops */
export async function createStop(payload: CreateStopPayload): Promise<Stop> {
    const data = await adminFetch('/api/stops', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return data.stop as Stop;
}

/** PUT /api/stops/:stopId */
export async function updateStop(stopId: string, payload: UpdateStopPayload): Promise<Stop> {
    const data = await adminFetch(`/api/stops/${encodeURIComponent(stopId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
    return data.stop as Stop;
}

/**
 * DELETE /api/stops/:stopId
 * The backend refuses (409) when a route still references the stop; adminFetch
 * surfaces that message unchanged.
 */
export async function deleteStop(stopId: string): Promise<void> {
    await adminFetch(`/api/stops/${encodeURIComponent(stopId)}`, { method: 'DELETE' });
}