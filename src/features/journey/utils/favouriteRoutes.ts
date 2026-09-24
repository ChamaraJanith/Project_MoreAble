/**
 * Favourite routes — what one is, and everything about presenting one (MOV-99).
 *
 * A favourite is a REUSABLE JOURNEY PAIR: an origin and a destination, and
 * nothing else. It deliberately holds no route, trip, bus, date or time, so it
 * cannot go stale when a timetable shifts, a vehicle is reassigned or a route is
 * retired. The date and time belong to the search the passenger runs WITH it,
 * which is why tapping a favourite fills the planner rather than searching: the
 * Journey Search API requires both, and a favourite has neither to give.
 *
 * That also makes it a different thing from a recent search
 * (`recentSearchesStorage`), which is the whole four-field search including its
 * date and time, kept on the device and expiring in usefulness. The two lists
 * sit next to each other on the planner and must not be confused.
 *
 * Everything here is pure and free of React and of storage, so the rules a
 * screen reader and a card both depend on can be tested without a renderer —
 * which is the only kind of test this project's Jest setup runs (node
 * environment, `tests/**\/*.test.ts`, no React Native renderer installed).
 */

import { normalizeLocation } from '../../../shared/utils/location';

/**
 * One saved journey pair.
 *
 * The shape the UI consumes. MOV-100/MOV-101 own the stored document and the
 * API response; this is only what the screens actually read, so a field is
 * added here when a screen needs it and not before.
 */
export interface FavouriteRoute {
    favouriteId: string;
    origin: string;
    destination: string;
    /** ISO 8601. Used for newest-first ordering only. */
    createdAt: string;
}

/** The journey pair itself, without the identity the store or API assigns. */
export type FavouriteRouteInput = Pick<FavouriteRoute, 'origin' | 'destination'>;

/** How many favourites the Journey Planner shows before offering "View all". */
export const MAX_PLANNER_FAVOURITES = 5;

/**
 * A comparison key for one origin/destination pair.
 *
 * CLIENT-SIDE EQUALITY ONLY. This is never a document id and must never be used
 * as one: a stop name may contain any character at all — '/' among them, which
 * is a Firestore path separator — so encoding a pair for storage is MOV-100's
 * problem and is deliberately not solved here. `JSON.stringify` of the two
 * normalised parts is used precisely because it cannot collide, not because it
 * is addressable.
 *
 * Normalisation matches what the Journey Search API itself matches on
 * (`normalizeLocation`: trimmed and lowercased), so "colombo fort" and
 * "Colombo Fort " are one favourite here exactly as they are one journey there.
 */
export function favouriteRoutePairKey(origin: unknown, destination: unknown): string {
    return JSON.stringify([normalizeLocation(origin), normalizeLocation(destination)]);
}

/** Whether two journey pairs are the same journey. Direction matters. */
export function isSameFavouriteRoute(a: FavouriteRouteInput, b: FavouriteRouteInput): boolean {
    return (
        favouriteRoutePairKey(a.origin, a.destination) ===
        favouriteRoutePairKey(b.origin, b.destination)
    );
}

/** The saved favourite for this journey pair, or null when it is not saved. */
export function findFavouriteRoute(
    favourites: FavouriteRoute[],
    input: FavouriteRouteInput
): FavouriteRoute | null {
    return favourites.find((favourite) => isSameFavouriteRoute(favourite, input)) ?? null;
}

/** Whether this journey pair is already saved. */
export function isFavouriteRouteSaved(
    favourites: FavouriteRoute[],
    input: FavouriteRouteInput
): boolean {
    return findFavouriteRoute(favourites, input) !== null;
}

/**
 * Whether a journey pair can be saved at all.
 *
 * Only what the control needs to decide whether to appear: two locations that
 * are present and different. This is not validation — the search API decides
 * whether a stop exists, and MOV-101 decides what it will accept — it only
 * keeps the star off a screen where there is no journey to save, such as a
 * results screen reached with incomplete search details.
 */
export function canSaveFavouriteRoute(origin: unknown, destination: unknown): boolean {
    const normalizedOrigin = normalizeLocation(origin);
    const normalizedDestination = normalizeLocation(destination);

    return normalizedOrigin.length > 0 && normalizedDestination.length > 0 &&
        normalizedOrigin !== normalizedDestination;
}

/**
 * Newest first.
 *
 * A copy, never a sort in place, so a caller's array is not reordered under it.
 * An unreadable `createdAt` sorts last rather than throwing the ordering of
 * everything around it — the same tactic `sortableTime` uses on the reports
 * list.
 */
export function sortFavouriteRoutes(favourites: FavouriteRoute[]): FavouriteRoute[] {
    return [...favourites].sort((a, b) => sortableTime(b.createdAt) - sortableTime(a.createdAt));
}

function sortableTime(value: unknown): number {
    const time = new Date(value as any).getTime();

    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * Adds a favourite, replacing any existing entry for the same journey pair.
 *
 * Presentation-level only: it is what keeps the SAME journey from appearing
 * twice in a list. Enforcing that a second save cannot be stored is MOV-101's
 * job, and this does not try to do it — it only guarantees the list a passenger
 * looks at never shows one journey twice.
 */
export function upsertFavouriteRoute(
    favourites: FavouriteRoute[],
    entry: FavouriteRoute
): FavouriteRoute[] {
    const withoutDuplicate = favourites.filter((favourite) => !isSameFavouriteRoute(favourite, entry));

    return sortFavouriteRoutes([entry, ...withoutDuplicate]);
}

/** Drops one favourite by id. Unknown ids leave the list untouched. */
export function removeFavouriteRouteById(
    favourites: FavouriteRoute[],
    favouriteId: string
): FavouriteRoute[] {
    return favourites.filter((favourite) => favourite.favouriteId !== favouriteId);
}

/** The favourites the Journey Planner shows inline, newest first. */
export function plannerFavourites(favourites: FavouriteRoute[]): FavouriteRoute[] {
    return sortFavouriteRoutes(favourites).slice(0, MAX_PLANNER_FAVOURITES);
}

/** Whether the planner is hiding some, so "View all" is worth offering. */
export function hasHiddenPlannerFavourites(favourites: FavouriteRoute[]): boolean {
    return favourites.length > MAX_PLANNER_FAVOURITES;
}

// ------------------------------------------------------------------
// Wording
//
// Every string a screen reader hears is built here rather than inside a
// component, so the phrasing is one decision and can be checked without
// rendering anything. The app's convention is a label that names the action and
// its subject in full — a star that only announces "star" tells a passenger who
// cannot see it nothing at all.
// ------------------------------------------------------------------

/** "Colombo Fort to Kaduwela". */
export function favouriteRouteJourneyLabel(input: FavouriteRouteInput): string {
    return `${input.origin} to ${input.destination}`;
}

/** What the card announces itself as. */
export function favouriteRouteCardLabel(input: FavouriteRouteInput): string {
    return `Favourite route from ${input.origin} to ${input.destination}`;
}

/** What tapping the card will do. */
export const FAVOURITE_ROUTE_CARD_HINT =
    'Double tap to plan this journey. Your starting location and destination will be filled in.';

/**
 * The save control's label, which carries the state.
 *
 * Stated as the action the tap performs, not as the state it is in, because
 * that is what a passenger needs to decide whether to press it. The state is
 * carried separately by `accessibilityState.selected`, and visually by a filled
 * star plus the word beside it — never by colour alone.
 */
export function favouriteToggleLabel(isSaved: boolean, input: FavouriteRouteInput): string {
    return isSaved
        ? `Remove ${favouriteRouteJourneyLabel(input)} from favourite routes`
        : `Save ${favouriteRouteJourneyLabel(input)} as a favourite route`;
}

/** The short word shown beside the star. */
export function favouriteToggleText(isSaved: boolean): string {
    return isSaved ? 'Saved' : 'Save';
}

export function favouriteToggleHint(isSaved: boolean): string {
    return isSaved
        ? 'Double tap to remove this journey from your favourite routes'
        : 'Double tap to save this journey to your favourite routes';
}

/** The remove control on a favourite card. */
export function removeFavouriteLabel(input: FavouriteRouteInput): string {
    return `Remove ${favouriteRouteJourneyLabel(input)} from favourite routes`;
}

/**
 * What is announced after a save or a remove.
 *
 * The project has no toast or snackbar — `react-native-paper` is a dependency
 * but is imported nowhere — so confirmation is an inline line in a polite live
 * region, which both sighted passengers and screen readers get.
 */
export function favouriteChangeAnnouncement(isSaved: boolean, input: FavouriteRouteInput): string {
    return isSaved
        ? `${favouriteRouteJourneyLabel(input)} saved to your favourite routes.`
        : `${favouriteRouteJourneyLabel(input)} removed from your favourite routes.`;
}

/** The count line above the list, kept plural-correct. */
export function favouriteRoutesCountLabel(count: number): string {
    return `${count} favourite route${count === 1 ? '' : 's'}`;
}
