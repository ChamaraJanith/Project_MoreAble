// The passenger's ongoing journey (MOV-295).
//
// The passenger is identified by the session token alone: there is
// deliberately no passengerId parameter to pass, correctly or otherwise.

import { PassengerOngoingJourney } from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

/** GET /api/journeys/ongoing — empty when nothing is running. */
export async function getOngoingJourneys(token: string): Promise<PassengerOngoingJourney[]> {
    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}/api/journeys/ongoing`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch {
        throw new Error('Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Something went wrong. Please try again.');
    }

    return Array.isArray(data.journeys) ? (data.journeys as PassengerOngoingJourney[]) : [];
}
