import {
    BoardingConfirmationResult,
    BoardingVerificationResult,
    Booking,
} from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

export interface VerifyTicketParams {
    qrPayload?: string;
    bookingId?: string;
    busId?: string;
    tripId?: string;
    date?: string;
}

export interface ConfirmBoardingParams {
    bookingId: string;
    busId?: string;
    conductorId?: string;
    date?: string;
    cashCollected?: boolean;
    assistanceProgress?: 'IN_PROGRESS' | 'COMPLETED';
}

export interface IssueWalkinTicketParams {
    tripId: string;
    busId?: string;
    seatNumber: string;
    origin: string;
    destination: string;
    passengerName?: string;
    passengerPhone?: string;
    passengerEmail?: string;
    date?: string;
    conductorId?: string;
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

/**
 * Confirms receiver details for a passenger's booking.
 */
export async function confirmReceiverDetails(bookingId: string): Promise<{ success: boolean; message: string; confirmedAt?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/booking/confirm-receiver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
        throw new Error(
            data?.message || `Failed to confirm receiver details (HTTP ${res.status}).`
        );
    }

    return data;
}

/**
 * Issues an on-board walk-in ticket for a spot passenger (Standard Seats Only).
 */
export async function issueWalkinTicket(
    params: IssueWalkinTicketParams
): Promise<{ success: boolean; message: string; booking: Booking }> {
    const res = await fetch(`${API_BASE_URL}/api/booking/issue-walkin-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
        throw new Error(
            data?.message || `Failed to issue walk-in ticket (HTTP ${res.status}).`
        );
    }

    return data;
}

