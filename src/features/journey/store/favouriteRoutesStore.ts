/**
 * The favourite routes this session is holding (MOV-99, persisted by MOV-101).
 *
 * The screens read this store; the store talks to `/api/favourites`; the API
 * talks to Firestore. Nothing here touches Firestore itself, and no screen ever
 * calls the API directly.
 *
 * Every write is OPTIMISTIC, because that is what MOV-99's experience depends
 * on: the star on the search summary flips the instant it is pressed, and a
 * favourite disappears from the list the instant it is removed. The request
 * then either confirms that — replacing the provisional entry with the server's
 * own, which carries the real `favouriteId` and `createdAt` — or fails, and the
 * change is rolled back and `errorMessage` set. The passenger never waits on a
 * round trip to see their own tap register.
 *
 * The identity is not passed in by the screens. It is read from the auth store
 * at the moment of the call, so the three call sites MOV-99 already wrote
 * (`JourneySearchResults`, `FavouriteRoutesScreen`, `JourneyPlannerForm`) did
 * not have to change to thread a token through. The server does not trust it
 * either way: ownership is taken from the verified session, never from anything
 * this module sends.
 *
 * The store shape follows `selectedRouteStore` — the journey feature's existing
 * session store — rather than Zustand, which this project keeps for state that
 * outlives a screen flow (auth, preferences, notifications).
 */

import { useSyncExternalStore } from 'react';
import { useAuthStore } from '../../../shared/store/authStore';
import {
    createFavouriteRoute,
    deleteFavouriteRoute,
    fetchFavouriteRoutes,
} from '../api/favouriteRoutesApi';
import {
    FavouriteRoute,
    FavouriteRouteInput,
    findFavouriteRoute,
    removeFavouriteRouteById,
    sortFavouriteRoutes,
    upsertFavouriteRoute,
} from '../utils/favouriteRoutes';

/** Where the last read of the favourites stands. */
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

/** The session's token, or '' when nobody is signed in. */
function authToken(): string {
    return useAuthStore.getState().token ?? '';
}

/**
 * A placeholder id for a favourite whose save is still in flight.
 *
 * Held only until the server answers, then replaced by the real one. Opaque —
 * no screen parses it — and never a document id, so it can safely be anything
 * that will not collide with a stored id.
 */
function provisionalFavouriteId(): string {
    return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lets a slow response be discarded once a newer read has started.
 *
 * The planner and the favourites screen both refresh on focus, so two reads can
 * easily overlap; without this the older one could land last and put a stale
 * list on screen.
 */
let latestLoadId = 0;

/**
 * Brings the favourites up to date from the API.
 *
 * Called on focus by the planner and the favourites screen. The loading state
 * is only entered when there is nothing to show yet, so returning to a screen
 * that already has a list refreshes it in place instead of flashing a skeleton
 * over it.
 */
export async function loadFavouriteRoutes(): Promise<void> {
    const token = authToken();

    // Favourites belong to a passenger, so a signed-out session holds none.
    if (!token) {
        setState(EMPTY_STATE);
        return;
    }

    const loadId = ++latestLoadId;

    if (state.favourites.length === 0) {
        setState({ ...state, status: 'loading', errorMessage: null });
    }

    const result = await fetchFavouriteRoutes(token);

    if (loadId !== latestLoadId) return;

    if (!result.ok) {
        setState({ ...state, status: 'error', errorMessage: result.message });
        return;
    }

    setFavouriteRoutes(result.value);
}

/**
 * Saves a journey pair.
 *
 * Shown as saved immediately, then confirmed. A pair that is already saved
 * comes back from the API as a success carrying the existing favourite, so
 * pressing the star twice leaves one entry with its original `createdAt` and
 * the list does not reshuffle.
 *
 * Returns the stored favourite, or null when the save did not take. The screens
 * ignore the return and read the store instead; it is here for a caller that
 * needs the server's own id.
 */
export async function saveFavouriteRoute(input: FavouriteRouteInput): Promise<FavouriteRoute | null> {
    const existing = findFavouriteRoute(state.favourites, input);

    if (existing) return existing;

    const token = authToken();

    if (!token) {
        setState({ ...state, status: 'error', errorMessage: 'Please sign in to save favourite routes.' });
        return null;
    }

    const provisional: FavouriteRoute = {
        favouriteId: provisionalFavouriteId(),
        origin: input.origin.trim(),
        destination: input.destination.trim(),
        createdAt: new Date().toISOString(),
    };

    setState({
        favourites: upsertFavouriteRoute(state.favourites, provisional),
        status: 'ready',
        errorMessage: null,
    });

    const result = await createFavouriteRoute(token, provisional);

    if (!result.ok) {
        setState({
            ...state,
            favourites: removeFavouriteRouteById(state.favourites, provisional.favouriteId),
            status: 'error',
            errorMessage: result.message,
        });
        return null;
    }

    // Removed again while the save was in flight, so the passenger's last
    // instruction was "not saved" — honoured by deleting what was just created
    // rather than putting it back on screen.
    const stillHeld = state.favourites.some(
        (favourite) => favourite.favouriteId === provisional.favouriteId
    );

    if (!stillHeld) {
        deleteFavouriteRoute(token, result.value.favourite.favouriteId).catch(() => {});
        return null;
    }

    // Replaces the provisional entry: `upsertFavouriteRoute` matches on the
    // journey pair, which is the same one, so the real id and timestamp take
    // its place rather than sitting beside it.
    setState({
        ...state,
        favourites: upsertFavouriteRoute(state.favourites, result.value.favourite),
    });

    return result.value.favourite;
}

/**
 * Removes one favourite.
 *
 * Taken off the list immediately and put back only if the request fails. A
 * favourite the server no longer has (404) is treated as removed — that is the
 * outcome the passenger asked for, and reporting an error for it would be
 * noise.
 */
export async function removeFavouriteRoute(favouriteId: string): Promise<void> {
    const removed = state.favourites.find((favourite) => favourite.favouriteId === favouriteId);

    if (!removed) return;

    const token = authToken();

    if (!token) {
        setState({ ...state, status: 'error', errorMessage: 'Please sign in to manage favourite routes.' });
        return;
    }

    setState({
        favourites: removeFavouriteRouteById(state.favourites, favouriteId),
        status: 'ready',
        errorMessage: null,
    });

    const result = await deleteFavouriteRoute(token, favouriteId);

    if (result.ok || result.status === 404) return;

    setState({
        ...state,
        favourites: upsertFavouriteRoute(state.favourites, removed),
        status: 'error',
        errorMessage: result.message,
    });
}

/**
 * Drops everything this session was holding.
 *
 * Favourites belong to one passenger, so they must never survive into another's
 * session. Called on sign-out by the subscription below, and by a test starting
 * from a known empty store.
 *
 * `latestLoadId` moves too, so a read that was already in flight when the
 * session ended cannot land afterwards and refill the list with the previous
 * passenger's favourites.
 */
export function resetFavouriteRoutes(): void {
    latestLoadId++;
    setState(EMPTY_STATE);
}

/**
 * Empties the favourites the moment the session changes (MOV-102).
 *
 * Logging out has to clear them immediately, not eventually. Waiting for the
 * next screen focus to notice there is no token would leave one passenger's
 * saved journeys readable on a shared device until something happened to look.
 *
 * Driven from HERE rather than from `logout()` on purpose. This module already
 * imports the auth store to read the session token, so having the auth store
 * import it back would be a genuine import cycle between the two — and
 * `authStore` is left completely untouched as a result, with every existing
 * logout side effect exactly as it was. Zustand's own `subscribe` is the
 * store's published API, not a new mechanism invented for this, and it runs
 * synchronously inside `set`, so the favourites are gone by the time `logout()`
 * returns.
 *
 * Fires on any change of token, which covers signing out, a session expiring
 * and one passenger replacing another. Resetting on sign-IN is harmless — there
 * is nothing held to lose — and guarantees a new session always starts clean.
 */
let lastSeenSessionToken: string | null = useAuthStore.getState().token;

useAuthStore.subscribe((session) => {
    if (session.token === lastSeenSessionToken) return;

    lastSeenSessionToken = session.token;
    resetFavouriteRoutes();
});

/**
 * Replaces the held favourites wholesale — where the GET response lands.
 *
 * Sorted on the way in. The API already returns them newest-first, so this
 * agrees with it rather than reordering it, and a caller handing over an
 * unsorted list still gets the order the screens expect.
 */
export function setFavouriteRoutes(favourites: FavouriteRoute[]): void {
    setState({ favourites: sortFavouriteRoutes(favourites), status: 'ready', errorMessage: null });
}
