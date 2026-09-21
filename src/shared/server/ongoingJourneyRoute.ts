// The planned path of a passenger's ongoing journey (MOV-297).
//
// The live tracking screen draws the bus against the road it is meant to take,
// so it needs what the journey search already gives the planning map: the
// stops in travel order, their coordinates, and the OSRM road path through
// them. It is built the same way, from the same sources:
//
//     trips/{activeJourney.tripId}.routeId -> routes/{routeId}.stops
//        -> the passenger's slice, boarding stop to alighting stop
//        -> coordinates from the stops collection (never geocoded or guessed)
//        -> getRouteThroughCoordinates, in that order
//
// Every id comes from the server's own records for a journey the caller has
// already authorised (passengerOngoingJourney). Nothing here reads a request.
//
// Best-effort, like the search's geo block: any failure yields null for the
// part that failed and never fails the ongoing-journey response itself.

import { OngoingJourneyRoute } from '../../entities/booking/model/types';
import { JourneyRoadRoute, JourneyStopPoint } from '../../entities/route/model/types';
import { normalizeSegmentDurations } from '../../../app/api/journeys/search+api';
import { getRouteThroughCoordinates } from '../api/routingService';
import { normalizeLocation } from '../utils/location';

export interface OngoingRouteCaches {
    /** Route documents by routeId; null when unreadable. */
    routes: Map<string, Promise<any | null>>;
    /** The stops collection, read at most once per request. */
    stopPoints?: Promise<Map<string, JourneyStopPoint>>;
}

export function createOngoingRouteCaches(): OngoingRouteCaches {
    return { routes: new Map() };
}

/**
 * Road paths already resolved, keyed by their exact waypoint sequence.
 *
 * A route's stops do not move while it runs, so the same waypoints always
 * produce the same road. Keeping the answer means reopening the screen, or a
 * second passenger on the same trip, does not ask the public OSRM server again.
 * Bounded so a long-running server cannot grow it without limit.
 */
const ROAD_CACHE_LIMIT = 100;
const roadCache = new Map<string, Promise<JourneyRoadRoute | null>>();

/** For tests: forget every cached road path. */
export function clearOngoingRoadCache(): void {
    roadCache.clear();
}

function loadRouteDoc(adminDb: any, routeId: string, cache: Map<string, Promise<any | null>>): Promise<any | null> {
    const cached = cache.get(routeId);
    if (cached) return cached;

    const pending: Promise<any | null> = adminDb
        .collection('routes')
        .doc(routeId)
        .get()
        .then((doc: any) => (doc?.exists ? doc.data() ?? null : null))
        .catch((error: any) => {
            console.error('Ongoing Route Read Error:', error);
            return null;
        });

    cache.set(routeId, pending);
    return pending;
}

function loadStopPoints(adminDb: any, caches: OngoingRouteCaches): Promise<Map<string, JourneyStopPoint>> {
    if (!caches.stopPoints) {
        caches.stopPoints = adminDb
            .collection('stops')
            .get()
            .then((snapshot: any) => {
                const points = new Map<string, JourneyStopPoint>();

                for (const doc of snapshot?.docs ?? []) {
                    const data = doc.data() ?? {};
                    const key = normalizeLocation(data.name);

                    if (key && Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
                        points.set(key, { name: data.name, latitude: data.latitude, longitude: data.longitude });
                    }
                }

                return points;
            })
            .catch((error: any) => {
                console.error('Ongoing Route Stops Read Error:', error);
                return new Map<string, JourneyStopPoint>();
            });
    }

    return caches.stopPoints as Promise<Map<string, JourneyStopPoint>>;
}

/**
 * The passenger's own stretch of the route: boarding stop to alighting stop.
 *
 * Matched the way the search and booking flows match stop names. When either
 * end cannot be found on the route in travel order — an older booking with no
 * stop names recorded — the whole route is the honest answer: it is the path
 * the bus is running, and nothing is invented to shorten it.
 */
export function sliceJourneyStops(routeStops: string[], boardStop: unknown, alightStop: unknown): string[] {
    const normalized = routeStops.map((stop) => normalizeLocation(stop));
    const from = normalized.indexOf(normalizeLocation(boardStop));
    const to = normalized.indexOf(normalizeLocation(alightStop));

    if (from === -1 || to === -1 || to <= from) {
        return routeStops;
    }

    return routeStops.slice(from, to + 1);
}

function loadRoad(stopPoints: JourneyStopPoint[]): Promise<JourneyRoadRoute | null> {
    if (stopPoints.length < 2) return Promise.resolve(null);

    const key = stopPoints.map((point) => `${point.longitude},${point.latitude}`).join(';');
    const cached = roadCache.get(key);
    if (cached) return cached;

    const pending = getRouteThroughCoordinates(stopPoints)
        .then((road) => road ?? null)
        .catch(() => null);

    // A failed lookup is not remembered, so the next open can try again.
    pending.then((road) => {
        if (!road) roadCache.delete(key);
    });

    if (roadCache.size >= ROAD_CACHE_LIMIT) {
        const oldest = roadCache.keys().next().value;
        if (oldest !== undefined) roadCache.delete(oldest);
    }
    roadCache.set(key, pending);

    return pending;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
}

/**
 * The planned path for one authorised ongoing journey, or null when its route
 * cannot be read.
 *
 * `routeId` is the running trip's own (falling back to the booking's snapshot
 * of it only when the trip names none). Stops without stored coordinates are
 * left off the map rather than placed somewhere approximate; they are still
 * listed in `journeyStops`.
 */
export async function loadOngoingJourneyRoute(
    adminDb: any,
    routeId: string | null,
    boardStop: unknown,
    alightStop: unknown,
    caches: OngoingRouteCaches
): Promise<OngoingJourneyRoute | null> {
    if (!routeId) return null;

    try {
        const route = await loadRouteDoc(adminDb, routeId, caches.routes);
        const stops = stringList(route?.stops);

        if (stops.length < 2) return null;

        const journeyStops = sliceJourneyStops(stops, boardStop, alightStop);
        const coordinates = await loadStopPoints(adminDb, caches);
        const stopPoints = journeyStops
            .map((name) => {
                const point = coordinates.get(normalizeLocation(name));
                return point ? { name, latitude: point.latitude, longitude: point.longitude } : null;
            })
            .filter((point): point is JourneyStopPoint => point !== null);

        return {
            stops,
            journeyStops,
            stopPoints,
            segmentDurationsMinutes: normalizeSegmentDurations(route?.segmentDurationsMinutes, stops.length),
            road: await loadRoad(stopPoints),
        };
    } catch (error) {
        console.error('Ongoing Route Error:', error);
        return null;
    }
}
