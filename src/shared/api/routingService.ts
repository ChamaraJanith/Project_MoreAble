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

function isUsablePoint(point: Coordinates): boolean {
    return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude);
}

/**
 * Requests the road route visiting every waypoint in the order given.
 *
 * OSRM routes through the waypoints as supplied; it never reorders them. That
 * is what lets a bus route's own stop sequence constrain the path, instead of
 * OSRM picking its own fastest road between the two endpoints.
 *
 * Waypoints without usable coordinates are dropped rather than failing the
 * request, so a route with one unmapped stop still produces a road path through
 * the stops that are known. Returns null when fewer than two usable waypoints
 * remain, or when OSRM cannot route them.
 */
export async function getRouteThroughCoordinates(
    waypoints: Coordinates[]
): Promise<RoadRoute | null> {
    const usable = Array.isArray(waypoints) ? waypoints.filter(isUsablePoint) : [];

    if (usable.length < 2) {
        return null;
    }

    // OSRM expects longitude,latitude — the reverse of how coordinates are held
    // everywhere else in this project.
    const coordinatePath = usable
        .map((point) => `${point.longitude},${point.latitude}`)
        .join(';');

    // `full` rather than `simplified`: a multi-stop path loses the detail that
    // shows it following the stops once the geometry is simplified.
    const url =
        `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${coordinatePath}` +
        `?overview=full&geometries=geojson`;

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

/**
 * Requests the road route directly between two coordinates.
 * Returns null when OSRM cannot route the pair or is unreachable.
 */
export async function getRouteBetweenCoordinates(
    origin: Coordinates,
    destination: Coordinates
): Promise<RoadRoute | null> {
    return getRouteThroughCoordinates([origin, destination]);
}
