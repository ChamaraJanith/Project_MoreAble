// The passenger's ongoing journey (MOV-295), ending it, and their completed
// journeys (MOV-297).
//
// The passenger is identified by the session token alone: there is
// deliberately no passengerId parameter to pass, correctly or otherwise.

import {
    PassengerCompletedJourney,
    PassengerJourneyCompletionReason,
    PassengerOngoingJourney,
} from '../../../entities/booking/model/types';
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

/** One authenticated request; the parsed body on success. */
async function journeyRequest(token: string, path: string, init: RequestInit = {}): Promise<any> {
    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...init,
            headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
        });
    } catch {
        throw new OngoingJourneyRequestError('Network error. Please check your connection and try again.', null);
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new OngoingJourneyRequestError(data?.message || 'Something went wrong. Please try again.', response.status);
    }

    return data;
}

/** GET /api/journeys/ongoing — empty when nothing is running. */
export async function getOngoingJourneys(
    token: string,
    { includeRoute = false }: OngoingJourneyRequestOptions = {}
): Promise<PassengerOngoingJourney[]> {
    const data = await journeyRequest(token, `/api/journeys/ongoing${includeRoute ? '?include=route' : ''}`, {
        method: 'GET',
    });

    return Array.isArray(data.journeys) ? (data.journeys as PassengerOngoingJourney[]) : [];
}

export interface EndJourneyResult {
    /** True when it had already finished (an earlier tap, or the bus ended it). */
    alreadyCompleted: boolean;
    completedAt: string;
    completionReason: PassengerJourneyCompletionReason;
}

/**
 * POST /api/journeys/ongoing/end — the passenger's own End Journey (MOV-297).
 *
 * Sends only which of the passenger's own running bookings is meant. The time
 * is the server's; no timestamp, passenger or trip is sent.
 */
export async function endPassengerJourney(token: string, bookingId: string): Promise<EndJourneyResult> {
    const data = await journeyRequest(token, '/api/journeys/ongoing/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
    });

    return {
        alreadyCompleted: data.alreadyCompleted === true,
        completedAt: data.completion?.completedAt,
        completionReason: data.completion?.completionReason,
    };
}

/** GET /api/journeys/completed — the passenger's finished journeys (MOV-297). */
export async function getCompletedJourneys(
    token: string,
    { includeRoute = false }: OngoingJourneyRequestOptions = {}
): Promise<PassengerCompletedJourney[]> {
    const data = await journeyRequest(token, `/api/journeys/completed${includeRoute ? '?include=route' : ''}`, {
        method: 'GET',
    });

    return Array.isArray(data.journeys) ? (data.journeys as PassengerCompletedJourney[]) : [];
}
