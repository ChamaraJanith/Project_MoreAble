// Starting and ending a trip's journey on the server (MOV-294).
//
// POST /api/trips/:tripId/journey persists the lifecycle on the trip itself,
// so a started journey outlives the device session that started it. The call
// is made as the signed-in bus, with the same session credential the location
// updates use.

import { API_BASE_URL } from '../../../shared/api/config';
import { TripJourneyRecord } from '../../../shared/utils/journeyLifecycle';

export type TripJourneyAction = 'START' | 'END';

export type TripJourneyErrorCode =
    /** This bus is already running another of its trips. */
    | 'ANOTHER_JOURNEY_ACTIVE'
    /** End Journey on a trip that was never started. */
    | 'JOURNEY_NOT_STARTED'
    /** The trip has been taken out of service. */
    | 'TRIP_INACTIVE'
    /** The session was refused; the bus must sign in again. */
    | 'NOT_AUTHENTICATED'
    /** Offline, or the server could not be reached. */
    | 'NETWORK_UNAVAILABLE'
    | 'FAILED';

export class TripJourneyError extends Error {
    readonly code: TripJourneyErrorCode;

    constructor(code: TripJourneyErrorCode, message: string) {
        super(message);
        this.name = 'TripJourneyError';
        this.code = code;
    }
}

const KNOWN_CODES: TripJourneyErrorCode[] = ['ANOTHER_JOURNEY_ACTIVE', 'JOURNEY_NOT_STARTED', 'TRIP_INACTIVE'];

/** Starts or ends `tripId`'s journey and returns the persisted record. */
export async function updateTripJourney(
    tripId: string,
    action: TripJourneyAction,
    sessionCredential: string
): Promise<TripJourneyRecord> {
    if (!tripId?.trim()) {
        throw new TripJourneyError('FAILED', 'No trip was selected.');
    }

    if (!sessionCredential?.trim()) {
        throw new TripJourneyError('NOT_AUTHENTICATED', 'Please sign this bus in again.');
    }

    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}/api/trips/${encodeURIComponent(tripId.trim())}/journey`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${sessionCredential}`,
            },
            body: JSON.stringify({ action }),
        });
    } catch {
        throw new TripJourneyError('NETWORK_UNAVAILABLE', 'Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success || !data.journey) {
        const code: TripJourneyErrorCode =
            response.status === 401
                ? 'NOT_AUTHENTICATED'
                : KNOWN_CODES.includes(data?.code)
                    ? data.code
                    : 'FAILED';
        throw new TripJourneyError(code, data?.message || 'The journey could not be updated. Please try again.');
    }

    return data.journey as TripJourneyRecord;
}
