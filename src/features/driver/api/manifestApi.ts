import {
    BoardingConfirmationResult,
    BoardingVerificationResult,
} from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

export interface VerifyTicketParams {
    qrPayload?: string;
    bookingId?: string;
    busId?: string;
    tripId?: string;
}

export interface ConfirmBoardingParams {
    bookingId: string;
    busId?: string;
    conductorId?: string;
    cashCollected?: boolean;
    assistanceProgress?: 'IN_PROGRESS' | 'COMPLETED';
}

/**
 * Verifies a passenger's ticket QR code against live trip and booking records.
 */
export async function verifyTicketQr(
    params: VerifyTicketParams
): Promise<BoardingVerificationResult> {
    const res = await fetch(`${API_BASE_URL}/api/booking/verify-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
        throw new Error(
            data?.message || `Failed to verify ticket QR code (HTTP ${res.status}).`
        );
    }

    return data as BoardingVerificationResult;
}

/**
 * Confirms a passenger's boarding, updates manifest status to BOARDED, and dispatches boarding alerts.
 */
export async function confirmPassengerBoarding(
    params: ConfirmBoardingParams
): Promise<BoardingConfirmationResult> {
    const res = await fetch(`${API_BASE_URL}/api/booking/confirm-boarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
        throw new Error(
            data?.message || `Failed to confirm passenger boarding (HTTP ${res.status}).`
        );
    }

    return data as BoardingConfirmationResult;
}
