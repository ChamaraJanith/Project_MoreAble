// Turning a journey search response into the recommended routes a passenger sees
// (MOV-88).
//
// One place where the three pieces the story needs come together:
//
//   * every travellable option, so multiple routes are offered and compared;
//   * MOV-87's ranking, so the most accessible suitable option is first;
//   * MOV-88's passenger-specific timing, so the estimated travel time is the
//     passenger's own journey and not the route's total.
//
// Nothing is calculated twice. The accessibility score arrives already measured
// on the option's bus (MOV-89, itself `computeAccessibilityScore`); the ordering
// is `rankJourneyOptions` exactly as MOV-87 wrote it; the duration is
// `resolveJourneyTiming`. This module only says where each of those reads its
// inputs from.
//
// Kept out of the screen so all of it is testable without a renderer.

import {
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../entities/route/model/types';
import { rankJourneyOptions } from '../../../shared/utils/journeyRanking';
import { formatFriendlyTime, parseApiTimeString } from './dateTime';
import { JourneyLegInput, JourneyTiming, resolveJourneyTiming } from './journeyTiming';

/** One recommended journey, ready to render. */
export interface RecommendedJourney {
    /** Stable list key: a route can offer several departures. */
    key: string;
    route: JourneySearchMatch;
    option: JourneySearchOption;
    /** The passenger's own estimated travel time, and their boarding/alighting times. */
    timing: JourneyTiming;
    /**
     * The measured accessibility score, or null when this option has none.
     *
     * Read straight off the bus, never recomputed. Null is "unknown", which
     * MOV-87 ranks below every measured score — including a measured zero.
     */
    accessibilityScore: number | null;
    /** Ready-to-render values for this journey, derived in one place. */
    display: JourneyDisplay;
}

/**
 * The legs of one journey option.
 *
 * The search matches only routes that carry the passenger from origin to
 * destination on a single vehicle, so this is always one leg — that is a fact
 * about the search, not an assumption made here. Returning a list keeps the
 * shape honest: when a search can return an interchange, its legs come through
 * here and the timing is measured across them without this file changing shape.
 *
 * The FULL route stop list is handed on, not `journeyStops`. The passenger's
 * boarding time depends on the timings before they board, which `journeyStops`
 * excludes by design.
 */
export function buildJourneyLegs(
    route: JourneySearchMatch,
    option: JourneySearchOption
): JourneyLegInput[] {
    return [
        {
            stops: Array.isArray(route.stops) ? route.stops : [],
            segmentDurationsMinutes: route.segmentDurationsMinutes ?? null,
            // The stop names the search itself matched, so they are the ones
            // present in `stops` rather than whatever the passenger typed.
            boardStop: route.origin,
            alightStop: route.destination,
            scheduledDepartureTime: option.trip?.departureTime ?? null,
            scheduledArrivalTime: option.trip?.estimatedArrivalTime ?? null,
        },
    ];
}


/**
 * Exactly what a passenger screen puts on the page for one journey.
 *
 * This exists because the same derivation was written twice — once in
 * JourneySearchResults' card and once in Route Details — and both copies quietly
 * fell back to the trip's own departure and arrival when the passenger's were
 * unknown. Those describe the whole route, so a Kaduwela -> Malabe journey
 * displayed the bus's 07:10 arrival at Kollupitiya. The utilities under it were
 * correct and fully tested throughout; the bug lived in the gap between them and
 * the screen.
 *
 * So the rule is here, once, where a test can reach it: a value is the
 * passenger's own or it is absent. Nothing in this function reads
 * `trip.departureTime`, `trip.estimatedArrivalTime`, `route.estimatedDuration`
 * or `route.distanceKm` — every one of those is a whole-route figure, and the
 * layers below have already resolved whichever part of them genuinely belongs to
 * this passenger.
 */
export interface JourneyDisplay {
    /** Time at the passenger's boarding stop, or null when not derivable. */
    departureLabel: string | null;
    /** Time at their alighting stop, or null. */
    arrivalLabel: string | null;
    /** Their own journey duration in the project's format, or null. */
    durationLabel: string | null;
    /** Their own journey distance, e.g. "11.4 km", or null. */
    distanceLabel: string | null;
    /**
     * Stops on the journey, boarding and alighting included.
     *
     * A count, not an index. `journeyStops` is
     * `stops.slice(originIndex, destinationIndex + 1)`, so Kaduwela -> Malabe is
     * zero-based indexes 0..1 and reads as 2 stops. Firestore positions are
     * never shown to a passenger.
     */
    stopCount: number;
    /** True when the passenger rides the route from its first stop to its last. */
    travelsWholeRoute: boolean;
    /** True when any of the three time values above could not be established. */
    hasIncompleteTimes: boolean;
}

export function describeJourneyForDisplay(
    route: JourneySearchMatch,
    timing: JourneyTiming
): JourneyDisplay {
    const journeyStops = Array.isArray(route.journeyStops) ? route.journeyStops : [];
    const routeStops = Array.isArray(route.stops) ? route.stops : [];

    const departureLabel = timing.boardingTime
        ? formatFriendlyTime(parseApiTimeString(timing.boardingTime))
        : null;
    const arrivalLabel = timing.alightingTime
        ? formatFriendlyTime(parseApiTimeString(timing.alightingTime))
        : null;

    const journeyDistanceKm = route.journeyDistanceKm;
    const distanceLabel =
        typeof journeyDistanceKm === 'number' && Number.isFinite(journeyDistanceKm)
            ? `${journeyDistanceKm} km`
            : null;

    return {
        departureLabel,
        arrivalLabel,
        durationLabel: timing.durationLabel,
        distanceLabel,
        stopCount: journeyStops.length,
        // `journeyStops` is a contiguous slice of `stops`, so equal lengths mean
        // the journey spans the route end to end.
        travelsWholeRoute: journeyStops.length > 0 && journeyStops.length === routeStops.length,
        hasIncompleteTimes: !departureLabel || !arrivalLabel || !timing.durationLabel,
    };
}

/** Flattens the response: every trip on every matched route is its own option. */
function toJourneyOptions(routes: JourneySearchMatch[]): RecommendedJourney[] {
    return routes.flatMap((route) =>
        (Array.isArray(route.trips) ? route.trips : []).map((option) => {
            const timing = resolveJourneyTiming(buildJourneyLegs(route, option));

            return {
                key: `${route.routeId}-${option.trip.tripId}`,
                route,
                option,
                timing,
                accessibilityScore: option.bus?.accessibilityScore ?? null,
                display: describeJourneyForDisplay(route, timing),
            };
        })
    );
}

/**
 * The recommended routes, in recommended order.
 *
 * Ordering is MOV-87's and only MOV-87's — accessibility score first, then
 * earliest departure, then the route and trip ids for reproducibility. There is
 * no comparator here and no `sort` call: this supplies the facts and
 * `rankJourneyOptions` decides the order.
 *
 * Ranking reorders and never filters. Every departure the search returned comes
 * back, including one whose bus is missing and whose score is therefore unknown:
 * a passenger is still entitled to see it, ranked last.
 */
export function toRecommendedJourneys(
    routes: JourneySearchMatch[] | null | undefined
): RecommendedJourney[] {
    const matched = Array.isArray(routes) ? routes : [];

    return rankJourneyOptions(toJourneyOptions(matched), (journey) => ({
        accessibilityScore: journey.accessibilityScore,
        departureTime: journey.option.trip.departureTime,
        routeId: journey.route.routeId,
        tripId: journey.option.trip.tripId,
    }));
}
