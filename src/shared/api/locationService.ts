// Geocoding via Nominatim (OpenStreetMap).
//
// Nominatim's usage policy requires an identifying User-Agent and discourages
// high-frequency use, so this is only called for an actual journey search — and
// only when the location's coordinates are not already stored in Firestore.

import { fetchGeoJson } from './geoHttp';

const NOMINATIM_BASE_URL = (
    process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org'
).replace(/\/+$/, '');

const NOMINATIM_USER_AGENT =
    process.env.NOMINATIM_USER_AGENT || 'MoreAble/1.0 (Inclusive Public Transport Companion)';

// Biases results towards Sri Lanka, where MoreAble operates, so short stop names
// such as "Borella" resolve to the right place.
const NOMINATIM_COUNTRY_CODES = process.env.NOMINATIM_COUNTRY_CODES || 'lk';

export interface Coordinates {
    latitude: number;
    longitude: number;
}

export interface GeocodedLocation extends Coordinates {
    displayName?: string;
}

function toFiniteNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolves a location name to coordinates.
 * Returns null when the location is unknown to Nominatim or the service is
 * unreachable — callers treat that as "map data unavailable", never an error.
 */
export async function geocodeLocation(location: string): Promise<GeocodedLocation | null> {
    const query = typeof location === 'string' ? location.trim() : '';
    if (!query) return null;

    const url =
        `${NOMINATIM_BASE_URL}/search` +
        `?q=${encodeURIComponent(query)}` +
        `&format=jsonv2&limit=1&addressdetails=0` +
        `&countrycodes=${encodeURIComponent(NOMINATIM_COUNTRY_CODES)}`;

    const payload = await fetchGeoJson(url, {
        headers: {
            'User-Agent': NOMINATIM_USER_AGENT,
            Accept: 'application/json',
        },
    });

    if (!Array.isArray(payload) || payload.length === 0) {
        return null;
    }

    const [result] = payload;
    const latitude = toFiniteNumber(result?.lat);
    const longitude = toFiniteNumber(result?.lon);

    if (latitude === null || longitude === null) {
        return null;
    }

    return {
        latitude,
        longitude,
        displayName: typeof result?.display_name === 'string' ? result.display_name : undefined,
    };
}
