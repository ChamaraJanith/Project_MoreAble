import {
    JourneyGeoInformation,
    JourneySearchMatch,
    JourneySearchWindowSummary,
} from '../../../entities/route/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { AccessibilityRequirementKey } from '../../../shared/utils/accessibility';

export interface JourneySearchCriteria {
    origin: string;
    destination: string;
    travelDate: string;
    travelTime: string;
    /**
     * The accessibility requirements the passenger has stated (MOV-92).
     *
     * Optional, and omitted entirely when none are selected, so a search with
     * no stated need is byte-for-byte the request this app has always sent. The
     * endpoint applies them itself and returns only suitable departures; it
     * echoes the list back on `searchCriteria` so a caller can see what was
     * filtered by.
     */
    accessibilityRequirements?: AccessibilityRequirementKey[];
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
    /**
     * What the time window found before accessibility requirements (MOV-308
     * AC6), so an empty result can be explained correctly. Optional: a response
     * from an older server has none, and the screen then keeps its old rule.
     */
    searchWindow?: JourneySearchWindowSummary;
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
