// Road routing via OSRM (OpenStreetMap routing engine).
//
// This describes the ROAD path between two points — it never decides which
// public transport route a passenger should take. Scheduled bus times remain
// entirely based on our own Firestore trip data.

import { fetchGeoJson } from './geoHttp';
import { Coordinates } from './locationService';

const OSRM_BASE_URL = (
    process.env.OSRM_BASE_URL || 'https://router.project-osrm.org'
).replace(/\/+$/, '');

const OSRM_PROFILE = process.env.OSRM_PROFILE || 'driving';

/** GeoJSON LineString describing the road path. */
export interface RouteGeometry {
    type: string;
    coordinates: [number, number][];
}

export interface RoadRoute {
    distanceKm: number;
    durationMinutes: number;
    geometry?: RouteGeometry;
}

/** OSRM reports metres; the rest of the project works in kilometres. */
export function metresToKilometres(metres: number): number {
    return Math.round((metres / 1000) * 10) / 10;
}

/** OSRM reports seconds; schedules and estimates here are expressed in minutes. */
export function secondsToMinutes(seconds: number): number {
    return Math.round(seconds / 60);
}

/**
 * Requests the road route between two coordinates.
 * Returns null when OSRM cannot route the pair or is unreachable.
 */
export async function getRouteBetweenCoordinates(
    origin: Coordinates,
    destination: Coordinates
): Promise<RoadRoute | null> {
    if (
        !Number.isFinite(origin?.latitude) ||
        !Number.isFinite(origin?.longitude) ||
        !Number.isFinite(destination?.latitude) ||
        !Number.isFinite(destination?.longitude)
    ) {
        return null;
    }

    // OSRM expects longitude,latitude order.
    const coordinatePair =
        `${origin.longitude},${origin.latitude};` +
        `${destination.longitude},${destination.latitude}`;

    const url =
        `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${coordinatePair}` +
        `?overview=simplified&geometries=geojson`;

    const payload = await fetchGeoJson(url);

    if (!payload || payload.code !== 'Ok' || !Array.isArray(payload.routes)) {
        return null;
    }

    const [route] = payload.routes;
    if (!route) return null;

    const distance = Number(route.distance);
    const duration = Number(route.duration);

    if (!Number.isFinite(distance) || !Number.isFinite(duration)) {
        return null;
    }

    const geometry =
        route.geometry && Array.isArray(route.geometry.coordinates)
            ? (route.geometry as RouteGeometry)
            : undefined;

    return {
        distanceKm: metresToKilometres(distance),
        durationMinutes: secondsToMinutes(duration),
        geometry,
    };
}
