// The passenger's ongoing journey (MOV-295).
//
// The passenger is identified by the session token alone: there is
// deliberately no passengerId parameter to pass, correctly or otherwise.

import { PassengerOngoingJourney } from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

/**
 * A failed request, with the HTTP status when the server answered (MOV-297).
 *
 * `status` is null for a network failure, so a screen can tell "sign in again"
 * (401/403) from "no connection right now" without reading the message.
 */
export class OngoingJourneyRequestError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null) {
        super(message);
        this.name = 'OngoingJourneyRequestError';
        this.status = status;
    }
}

export interface OngoingJourneyRequestOptions {
    /**
     * Also fetch each journey's planned path — stops, coordinates and road
     * geometry (MOV-297). Only the tracking screen's first load needs it.
     */
    includeRoute?: boolean;
}

/** GET /api/journeys/ongoing — empty when nothing is running. */
export async function getOngoingJourneys(
    token: string,
    { includeRoute = false }: OngoingJourneyRequestOptions = {}
): Promise<PassengerOngoingJourney[]> {
    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}/api/journeys/ongoing${includeRoute ? '?include=route' : ''}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch {
        throw new OngoingJourneyRequestError('Network error. Please check your connection and try again.', null);
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new OngoingJourneyRequestError(data?.message || 'Something went wrong. Please try again.', response.status);
    }

    return Array.isArray(data.journeys) ? (data.journeys as PassengerOngoingJourney[]) : [];
}
