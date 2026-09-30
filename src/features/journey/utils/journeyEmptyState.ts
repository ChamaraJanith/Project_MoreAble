import { JourneySearchWindowSummary } from '../../../entities/route/model/types';

/**
 * Why a journey search shows nothing (MOV-308 AC6), so the screen can say the
 * true reason rather than the nearest-sounding one.
 *
 *   NO_ROUTE              no route serves this origin and destination.
 *   NO_JOURNEY_IN_WINDOW  a route runs, but nothing leaves within an hour of
 *                         the requested time, earlier or later.
 *   NO_SUITABLE_JOURNEY   departures do leave within the hour, but none meets
 *                         the accessibility requirements selected.
 */
export type JourneyEmptyReason = 'NO_ROUTE' | 'NO_JOURNEY_IN_WINDOW' | 'NO_SUITABLE_JOURNEY';

/** A count the search reported: a whole number, zero or more. */
function usableCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The search's own window figures, or null when the response did not carry readable ones. */
function readSearchWindow(value: unknown): JourneySearchWindowSummary | null {
    if (!value || typeof value !== 'object') return null;

    const { matchedRouteCount, departureCount } = value as Record<string, unknown>;

    return usableCount(matchedRouteCount) && usableCount(departureCount)
        ? { matchedRouteCount, departureCount }
        : null;
}

/**
 * The reason an EMPTY result is empty. Only meaningful when nothing is shown.
 *
 * Read from the search's own counts, taken before accessibility requirements
 * were applied, so it never infers a cause from what survived the filter:
 *
 *   - no matched route                         -> NO_ROUTE, filtered or not;
 *   - a route, but no departure in the window  -> NO_JOURNEY_IN_WINDOW, even
 *     with requirements selected: removing one would bring nothing back;
 *   - departures in the window, requirements   -> NO_SUITABLE_JOURNEY: they
 *     selected, and still nothing shown           were there, and the
 *                                                 requirements removed them.
 *
 * A response without the counts (an older server) keeps the rule this screen
 * used before: requirements selected means NO_SUITABLE_JOURNEY, otherwise
 * whether any route came back.
 */
export function journeyEmptyReason(input: {
    searchWindow: unknown;
    isFiltering: boolean;
    returnedRouteCount: number;
}): JourneyEmptyReason {
    const window = readSearchWindow(input.searchWindow);

    if (window) {
        if (window.matchedRouteCount === 0) return 'NO_ROUTE';
        if (window.departureCount === 0) return 'NO_JOURNEY_IN_WINDOW';
        if (input.isFiltering) return 'NO_SUITABLE_JOURNEY';
    } else if (input.isFiltering) {
        return 'NO_SUITABLE_JOURNEY';
    }

    return input.returnedRouteCount > 0 ? 'NO_JOURNEY_IN_WINDOW' : 'NO_ROUTE';
}
