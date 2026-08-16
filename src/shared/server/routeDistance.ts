import { Coordinates, haversineDistanceKm } from '../utils/geo';
import { normalizeLocation } from '../utils/location';

interface StopCoordinate extends Coordinates {
    name: string;
}

/**
 * Loads every stop's coordinates once and indexes them by normalized name.
 * The `stops` and `routes` collections are managed independently (a route
 * stores stop *names*, not stop document references), so matching is done
 * in-memory by normalized name rather than by a Firestore `where...in`
 * query — that avoids silently missing a stop over a casing/whitespace
 * mismatch between the two collections.
 */
async function loadStopCoordinateMap(adminDb: any): Promise<Map<string, StopCoordinate>> {
    const snapshot = await adminDb.collection('stops').get();
    const map = new Map<string, StopCoordinate>();

    snapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        if (typeof data.latitude === 'number' && typeof data.longitude === 'number' && data.name) {
            map.set(normalizeLocation(data.name), {
                name: data.name,
                latitude: data.latitude,
                longitude: data.longitude,
            });
        }
    });

    return map;
}

export interface RouteSegmentDistanceResult {
    distanceKm: number;
    /** True only when every stop between origin and destination had known coordinates. */
    isPrecise: boolean;
}

/**
 * Computes the real travelled distance between two stops on a route by
 * summing the great-circle distance between each *consecutive* pair of
 * stops along the actual path — not a straight line from origin to
 * destination, which would under-count a winding route.
 *
 * Falls back to the route's own recorded total distanceKm, scaled by the
 * fraction of the route actually travelled, if any stop on the path is
 * missing coordinates. This keeps fare calculation always returning a
 * usable number, while still preferring the precise, coordinate-based
 * figure whenever the admin has entered stop coordinates.
 */
export async function computeRouteSegmentDistance(
    adminDb: any,
    routeStops: string[],
    originIndex: number,
    destinationIndex: number,
    routeTotalDistanceKm: number | null
): Promise<RouteSegmentDistanceResult> {
    const pathStops = routeStops.slice(originIndex, destinationIndex + 1);

    if (pathStops.length < 2) {
        return { distanceKm: 0, isPrecise: true };
    }

    const coordinateMap = await loadStopCoordinateMap(adminDb);

    let distanceKm = 0;
    let isPrecise = true;

    for (let i = 0; i < pathStops.length - 1; i++) {
        const from = coordinateMap.get(normalizeLocation(pathStops[i]));
        const to = coordinateMap.get(normalizeLocation(pathStops[i + 1]));

        if (!from || !to) {
            isPrecise = false;
            continue;
        }

        distanceKm += haversineDistanceKm(from, to);
    }

    if (!isPrecise) {
        const fraction = (destinationIndex - originIndex) / Math.max(1, routeStops.length - 1);
        const fallbackDistance = routeTotalDistanceKm != null ? routeTotalDistanceKm * fraction : distanceKm;
        return { distanceKm: Math.round(fallbackDistance * 10) / 10, isPrecise: false };
    }

    return { distanceKm: Math.round(distanceKm * 10) / 10, isPrecise: true };
}