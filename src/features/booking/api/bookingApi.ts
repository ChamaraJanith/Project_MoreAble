import { TransportOption } from '../../../entities/booking/model/types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || '';

export async function fetchTransportOptions(routeId: string): Promise<TransportOption[]> {
    const response = await fetch(`${BASE_URL}/api/booking/options?routeId=${routeId}`);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch transport options.');
    }
    return data.options;
}