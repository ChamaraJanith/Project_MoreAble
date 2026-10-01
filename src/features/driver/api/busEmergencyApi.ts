// The bus crew's emergency console, called as the signed-in bus.
//
//   GET   /api/buses/:busId/emergencies                 this bus's open emergencies
//   PATCH /api/buses/:busId/emergencies/:emergencyId    { action: MESSAGE | RESOLVE }
//
// Every call carries the Bus Login session token (busSession), never the
// person session in authStore that adminFetch reads: the server decides which
// bus is calling from that token, and the busId in the path must match it.

import { API_BASE_URL } from '../../../shared/api/config';
import { BusSession } from '../../../shared/utils/busSession';
import { BusCrewEmergency, BusCrewEmergencyAction } from '../../../entities/emergency/model/types';

export type BusEmergencyErrorCode =
    /** 401: the bus session is missing or expired; sign the bus in again. */
    | 'NOT_AUTHENTICATED'
    /** 403: this session may not use this bus's console. */
    | 'FORBIDDEN'
    /** 404: no such emergency for this bus. */
    | 'NOT_FOUND'
    /** Offline, or the server could not be reached. */
    | 'NETWORK_UNAVAILABLE'
    | 'FAILED';

export class BusEmergencyError extends Error {
    readonly code: BusEmergencyErrorCode;

    constructor(code: BusEmergencyErrorCode, message: string) {
        super(message);
        this.name = 'BusEmergencyError';
        this.code = code;
    }
}

function codeFor(status: number): BusEmergencyErrorCode {
    if (status === 401) return 'NOT_AUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    return 'FAILED';
}

async function busRequest(session: BusSession, path: string, init?: RequestInit): Promise<any> {
    const busId = session?.busId?.trim();
    const token = session?.token?.trim();

    if (!busId || !token) {
        throw new BusEmergencyError('NOT_AUTHENTICATED', 'Please sign this bus in again.');
    }

    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}/api/buses/${encodeURIComponent(busId)}/emergencies${path}`, {
            ...init,
            headers: {
                ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
                Authorization: `Bearer ${token}`,
            },
        });
    } catch {
        throw new BusEmergencyError('NETWORK_UNAVAILABLE', 'Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new BusEmergencyError(
            codeFor(response.status),
            (typeof data?.message === 'string' && data.message) || 'The emergency could not be updated. Please try again.'
        );
    }

    return data;
}

async function busAction(
    session: BusSession,
    emergencyId: string,
    action: BusCrewEmergencyAction
): Promise<BusCrewEmergency> {
    const data = await busRequest(session, `/${encodeURIComponent(emergencyId)}`, {
        method: 'PATCH',
        body: JSON.stringify(action),
    });

    if (!data.emergency?.id) {
        throw new BusEmergencyError('FAILED', 'The server did not confirm the update. Please try again.');
    }

    return data.emergency as BusCrewEmergency;
}

/** The signed-in bus's open emergencies, newest first. */
export async function getOpenBusEmergencies(session: BusSession): Promise<BusCrewEmergency[]> {
    const data = await busRequest(session, '');

    if (!Array.isArray(data.emergencies)) {
        throw new BusEmergencyError('FAILED', 'The server sent an unexpected answer. Please try again.');
    }

    return data.emergencies as BusCrewEmergency[];
}

/** Sends a crew message on the bus's own emergency. */
export function sendBusCrewMessageApi(
    session: BusSession,
    emergencyId: string,
    message: string
): Promise<BusCrewEmergency> {
    return busAction(session, emergencyId, { action: 'MESSAGE', message });
}

/** Confirms the bus's own emergency resolved by its crew. */
export function confirmBusEmergencyResolvedApi(session: BusSession, emergencyId: string): Promise<BusCrewEmergency> {
    return busAction(session, emergencyId, { action: 'RESOLVE' });
}
