import {
    JourneyGeoInformation,
    JourneyStopPoint,
} from '../../../entities/route/model/types';
import { normalizeLocation } from '../../../shared/utils/location';

export interface RouteMapStopResolution {
    /** Intermediate stops with coordinates, in this journey's travel order. */
    stops: JourneyStopPoint[];
    /**
     * Intermediate stops on this journey that have no saved coordinates.
     *
     * Worth surfacing rather than hiding: the journey's endpoints fall back to
     * geocoding when a stop is missing from the stops collection, but the stops
     * in between do not, so they would otherwise disappear from the map with no
     * explanation.
     */
    unmappedCount: number;
}

/**
 * Picks the stops between the boarding and alighting points for the map.
 *
 * Order comes from `journeyStops`, which is already the selected route's travel
 * order — reversed for the return direction — so nothing is sorted here. The
 * first and last entries are the origin and destination, which have their own
 * pins; trimming them is what prevents a duplicate marker at either end, and it
 * works for a partial journey too because `journeyStops` covers only the
 * travelled segment.
 */
export function resolveIntermediateStops(
    journeyStops: string[],
    geo: JourneyGeoInformation | null | undefined
): RouteMapStopResolution {
    // Fewer than three entries means the journey is a single hop: two endpoints
    // and nothing in between.
    if (journeyStops.length < 3) {
        return { stops: [], unmappedCount: 0 };
    }

    const intermediateNames = journeyStops.slice(1, -1);

    const byName = new Map(
        (geo?.stops ?? []).map((stop) => [normalizeLocation(stop.name), stop])
    );

    const stops = intermediateNames
        .map((name) => byName.get(normalizeLocation(name)))
        .filter((stop): stop is JourneyStopPoint => !!stop);

    return { stops, unmappedCount: intermediateNames.length - stops.length };
}
