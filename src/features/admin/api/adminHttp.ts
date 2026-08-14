import { API_BASE_URL } from '../../../shared/api/config';

/**
 * Shared request helper for the admin API clients.
 *
 * Every admin endpoint in this project answers with `{ success, message, ... }`,
 * so this centralises that contract: it throws an Error carrying the backend's
 * own message whenever the call fails, and returns the parsed payload otherwise.
 */
export async function adminFetch(path: string, init?: RequestInit): Promise<any> {
    const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };

    if (init?.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    } catch {
        // Network-level failure (offline, DNS, server unreachable).
        throw new Error('Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Something went wrong. Please try again.');
    }

    return data;
}