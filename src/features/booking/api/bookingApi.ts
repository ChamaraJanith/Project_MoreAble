import { Seat, TransportOption } from '../../../entities/booking/model/types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

export async function fetchTransportOptions(routeId: string): Promise<TransportOption[]> {
    const response = await fetch(`${BASE_URL}/api/booking/options?routeId=${routeId}`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch transport options.');
    }
    return data.options;
}

// US03: fetch seat map for a specific trip
export interface SeatMapResponse {
    tripId: string;
    vehicleNumber: string;
    totalSeats: number;
    seats: Seat[];
}

export async function fetchSeats(tripId: string): Promise<SeatMapResponse> {
    const response = await fetch(`${BASE_URL}/api/booking/seats/${tripId}`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch seat availability.');
    }
    return data;
}