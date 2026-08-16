export interface Coordinates {
    latitude: number;
    longitude: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
    return (deg * Math.PI) / 180;
}

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
    const dLat = toRadians(b.latitude - a.latitude);
    const dLng = toRadians(b.longitude - a.longitude);
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);

    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);

    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

    return EARTH_RADIUS_KM * c;
}