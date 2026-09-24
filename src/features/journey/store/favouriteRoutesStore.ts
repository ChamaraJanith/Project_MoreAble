/**
 * The favourite routes this session is holding (MOV-99).
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  TEMPORARY. THIS IS THE SEAM MOV-101 REPLACES.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * MOV-99 owns the passenger-facing experience; the collection (MOV-100) and the
 * API (MOV-101) are not built yet. Rather than invent an endpoint or a document
 * shape to make the screens look finished, the favourites live in memory for
 * the lifetime of the app process and are gone on restart. Nothing here reads
 * or writes Firestore, calls any API, or touches the device's storage — a
 * favourite saved today genuinely is not persisted, and the UI does not pretend
 * otherwise.
 *
 * WHAT MOV-101 CHANGES, AND WHAT IT DOES NOT:
 *
 *   - The three functions below (`loadFavouriteRoutes`, `saveFavouriteRoute`,
 *     `removeFavouriteRoute`) become calls to `/api/favourites`, awaiting a
 *     result instead of returning one, and setting `status` / `errorMessage`
 *     around each call.
 *   - `FavouriteRoutesState` already carries `status` and `errorMessage` for
 *     exactly that reason, and the screens already render a loading, an error
 *     and a retry branch from them. Nothing in the UI has to change.
 *   - `favouriteId` stops being generated here and becomes whatever the API
 *     returns. No screen reads its contents — it is an opaque handle — so a
 *     server-assigned id drops straight in.
 *   - The pure rules in `utils/favouriteRoutes.ts` are untouched either way.
 *
 * The store shape follows `selectedRouteStore` — the journey feature's existing
 * session store — rather than Zustand, which this project keeps for state that
 * outlives a screen flow (auth, preferences, notifications).
 */

import { useSyncExternalStore } from 'react';
import {
    FavouriteRoute,
    FavouriteRouteInput,
    findFavouriteRoute,
    removeFavouriteRouteById,
    sortFavouriteRoutes,
    upsertFavouriteRoute,
} from '../utils/favouriteRoutes';

/**
 * Where a read of the favourites currently stands.
 *
 * Always 'ready' while the store is in memory — there is nothing to wait for
 * and nothing to fail. It exists so the screens are built around the states
 * MOV-101 will actually produce, instead of being retro-fitted with them once
 * the API lands.
 */
export type FavouriteRoutesStatus = 'loading' | 'ready' | 'error';

export interface FavouriteRoutesState {
    favourites: FavouriteRoute[];
    status: FavouriteRoutesStatus;
    /** Set only alongside `status: 'error'`. */
    errorMessage: string | null;
}

const EMPTY_STATE: FavouriteRoutesState = {
    favourites: [],
    status: 'ready',
    errorMessage: null,
};

/**
 * One object, replaced rather than mutated.
 *
 * `useSyncExternalStore` compares snapshots by reference and warns when a
 * getter returns a fresh value each call, so every update builds the next state
 * once and hands the same reference to every subscriber.
 */
let state: FavouriteRoutesState = EMPTY_STATE;

const listeners = new Set<() => void>();

function setState(next: FavouriteRoutesState) {
    state = next;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function getFavouriteRoutesState(): FavouriteRoutesState {
    return state;
}

/** The favourites, and how the last read of them went. */
export function useFavouriteRoutes(): FavouriteRoutesState {
    return useSyncExternalStore(subscribe, getFavouriteRoutesState, getFavouriteRoutesState);
}

/**
 * A handle for one saved favourite.
 *
 * Temporary, and shaped like `recentSearchesStorage`'s own local ids so the
 * pattern is familiar. Opaque by design: no screen parses it, so MOV-101 can
 * replace it with a server id without touching any component. It is NOT a
 * document id and must not be treated as one — see `favouriteRoutePairKey`.
 */
function nextFavouriteId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Brings the favourites up to date.
 *
 * A no-op today: the in-memory list is already current, so there is nothing to
 * fetch and no failure to report. Screens still call it on focus, so that
 * MOV-101 has one place to put the GET and every screen starts refreshing
 * without a change.
 */
export function loadFavouriteRoutes(): void {
    // Intentionally empty — see the file header.
}

/**
 * Saves a journey pair, or returns the existing favourite for it.
 *
 * Saving the same pair twice never produces a second entry: `upsertFavouriteRoute`
 * replaces by journey pair, and an already-saved pair keeps its original
 * `favouriteId` and `createdAt` so a list does not reshuffle under a passenger
 * who pressed the star twice.
 */
export function saveFavouriteRoute(input: FavouriteRouteInput): FavouriteRoute {
    const existing = findFavouriteRoute(state.favourites, input);

    if (existing) return existing;

    const favourite: FavouriteRoute = {
        favouriteId: nextFavouriteId(),
        origin: input.origin.trim(),
        destination: input.destination.trim(),
        createdAt: new Date().toISOString(),
    };

    setState({
        ...state,
        favourites: upsertFavouriteRoute(state.favourites, favourite),
    });

    return favourite;
}

/** Removes one favourite. An id that is not held is a no-op. */
export function removeFavouriteRoute(favouriteId: string): void {
    const favourites = removeFavouriteRouteById(state.favourites, favouriteId);

    if (favourites.length === state.favourites.length) return;

    setState({ ...state, favourites });
}

/**
 * Drops everything this session was holding.
 *
 * Exported for MOV-102 so a test can start from a known empty store, and for a
 * future sign-out hook — favourites belong to a passenger, and MOV-101 makes
 * that literal.
 */
export function resetFavouriteRoutes(): void {
    setState(EMPTY_STATE);
}

/**
 * Replaces the held favourites wholesale.
 *
 * The hook MOV-101's GET response lands in. Sorted on the way in so the screens
 * can render the list exactly as given.
 */
export function setFavouriteRoutes(favourites: FavouriteRoute[]): void {
    setState({ favourites: sortFavouriteRoutes(favourites), status: 'ready', errorMessage: null });
}
