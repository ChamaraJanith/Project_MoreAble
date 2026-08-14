// Shared HTTP helper for the external OpenStreetMap-based services (Nominatim
// and OSRM). Both are public, best-effort services, so every call is bounded by
// a timeout and failures are reported as a null result rather than thrown — the
// journey search must never fail because a map provider is unavailable.

const DEFAULT_TIMEOUT_MS = 5000;

export interface GeoRequestOptions {
    headers?: Record<string, string>;
    timeoutMs?: number;
}

/**
 * Performs a GET request and parses the JSON body.
 * Returns null on timeout, network error, non-2xx status or unparsable body.
 */
export async function fetchGeoJson(url: string, options: GeoRequestOptions = {}): Promise<any | null> {
    const { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch {
        // Network failure, abort/timeout, or malformed JSON.
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
