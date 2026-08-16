import { JourneyGeoInformation, JourneySearchMatch } from '../../../entities/route/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

export interface JourneySearchCriteria {
    origin: string;
    destination: string;
    travelDate: string;
    travelTime: string;
}

export interface JourneySearchResponse {
    success: boolean;
    message: string;
    count: number;
    searchCriteria: JourneySearchCriteria;
    routes: JourneySearchMatch[];
    /**
     * Best-effort geographic data for the searched journey (MOV-85). Optional
     * because the endpoint reports it as unavailable rather than failing when
     * the mapping services cannot resolve the locations.
     */
    geo?: JourneyGeoInformation;
}

export async function searchJourneys(criteria: JourneySearchCriteria): Promise<JourneySearchResponse> {
    const response = await fetch(`${API_BASE_URL}/api/journeys/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criteria),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
        throw new Error(data?.message || 'Unable to search journeys right now. Please try again.');
    }

    return data as JourneySearchResponse;
}
