import { adminFetch } from './adminHttp';
import {
    CreateEmergencyInput,
    EmergencyRequest,
    EmergencyStatus,
    UpdateEmergencyStatusInput,
} from '../../../entities/emergency/model/types';

export interface EmergencyFilters {
    status?: EmergencyStatus | 'ALL';
    search?: string;
}

/**
 * Fetches all emergency requests matching the specified status and search criteria.
 */
export async function getEmergencies(filters: EmergencyFilters = {}): Promise<EmergencyRequest[]> {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'ALL') {
        params.append('status', filters.status);
    }
    if (filters.search && filters.search.trim()) {
        params.append('search', filters.search.trim());
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await adminFetch(`/api/emergencies${query}`);
    return data.emergencies || [];
}

/**
 * Fetches detailed information for a single emergency request.
 */
export async function getEmergencyById(emergencyId: string): Promise<EmergencyRequest> {
    const data = await adminFetch(`/api/emergencies/${encodeURIComponent(emergencyId)}`);
    return data.emergency;
}

/**
 * Updates an emergency request status (Pending -> Assigned -> Resolved).
 */
export async function updateEmergencyStatusApi(
    emergencyId: string,
    input: UpdateEmergencyStatusInput
): Promise<EmergencyRequest> {
    const data = await adminFetch(`/api/emergencies/${encodeURIComponent(emergencyId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
    });
    return data.emergency;
}

/**
 * Creates an emergency request (used by SOS trigger or admin manual dispatch).
 */
export async function createEmergencyRequestApi(input: CreateEmergencyInput): Promise<EmergencyRequest> {
    const data = await adminFetch('/api/emergencies', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    return data.emergency;
}

/**
 * Dismisses/deletes an emergency request by ID.
 */
export async function deleteEmergencyApi(emergencyId: string): Promise<boolean> {
    const data = await adminFetch(`/api/emergencies/${encodeURIComponent(emergencyId)}`, {
        method: 'DELETE',
    });
    return data.success === true;
}

