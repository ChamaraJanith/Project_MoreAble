import { AssistanceRequested, Booking, FareBreakdown, Seat, SeatLayout, SelectedVehicle, TransportOption } from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';


async function bookingFetch(path: string, init?: RequestInit): Promise<any> {
    const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
    if (init?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    } catch {
        throw new Error('Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Something went wrong. Please try again.');
    }
    return data;
}

export async function fetchTransportOptions(routeId: string): Promise<TransportOption[]> {
    const data = await bookingFetch(`/api/booking/options?routeId=${encodeURIComponent(routeId)}`);
    return Array.isArray(data.options) ? (data.options as TransportOption[]) : [];
}

export interface SeatMapResponse {
    tripId: string;
    routeNumber: string | null;
    numberPlate: string;
    busModel: string;
    departureTime: string;
    estimatedArrivalTime: string;
    accessibilityScore: number;
    totalSeats: number;
    layout: SeatLayout;
    seats: Seat[];
}

export async function fetchSeats(tripId: string): Promise<SeatMapResponse> {
    return (await bookingFetch(`/api/booking/seats/${encodeURIComponent(tripId)}`)) as SeatMapResponse;
}

export interface ConfirmBookingPayload {
    tripId: string;
    seatNumber: string;
    passengerId?: string;
    origin?: string;       
    destination?: string;
    assistanceRequested?: AssistanceRequested;
    specialRequests?: string;
}

import { sendLocalBookingNotification } from '../../../shared/utils/localNotifications';

/** The server re-derives seat category, pairing (wheelchair↔guardian) and any age restriction itself. */
export async function confirmBooking(payload: ConfirmBookingPayload): Promise<Booking> {
    const data = await bookingFetch('/api/booking/confirm', { method: 'POST', body: JSON.stringify(payload) });
    const booking = data.booking as Booking;

    if (booking) {
        // Trigger native pop-down notification on device
        sendLocalBookingNotification(booking).catch(() => {});
    }

    return booking;
}

export async function getBooking(bookingId: string): Promise<Booking> {
    const data = await bookingFetch(`/api/booking/${encodeURIComponent(bookingId)}`);
    return data.booking as Booking;
}

export async function getBookingHistory(passengerId: string): Promise<Booking[]> {
    const data = await bookingFetch(`/api/booking/history?passengerId=${encodeURIComponent(passengerId)}`);
    return Array.isArray(data.bookings) ? (data.bookings as Booking[]) : [];
}

export async function cancelBooking(bookingId: string): Promise<void> {
    await bookingFetch('/api/booking/cancel', { method: 'POST', body: JSON.stringify({ bookingId }) });
}

export type { SelectedVehicle };

export async function fetchFare(routeId: string, origin: string, destination: string): Promise<FareBreakdown> {
    const data = await bookingFetch(
        `/api/booking/fare?routeId=${encodeURIComponent(routeId)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
    );
    return data.fare as FareBreakdown;
}

export type { FareBreakdown };

