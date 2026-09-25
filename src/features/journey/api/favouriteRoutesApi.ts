/**
 * The client half of favourite routes (MOV-101).
 *
 * The screen names a journey pair and nothing that identifies anyone: the
 * passenger is the session token's, resolved on the server. Shaped like
 * `busRatingApi`, the project's existing authenticated passenger client — a
 * Result union rather than exceptions, a null `status` for a network failure,
 * and the backend's own message carried through.
 *
 * Nothing here knows about Firestore. The app talks to the API; the API talks
 * to the database.
 */

import { API_BASE_URL } from '../../../shared/api/config';
import { FavouriteRoute, FavouriteRouteInput } from '../utils/favouriteRoutes';

export type FavouriteRouteResult<T> =
    | { ok: true; value: T }
    /** `status` is null for a network failure; `code` is the API's, when it gave one. */
    | { ok: false; status: number | null; code: string | null; message: string };

const FAVOURITES_PATH = '/api/favourites';

async function favouriteRequest<T>(
    token: string,
    path: string,
    init: RequestInit,
    pick: (data: any) => T
): Promise<FavouriteRouteResult<T>> {
    if (!token) {
        return { ok: false, status: 401, code: null, message: 'Please sign in to use favourite routes.' };
    }

    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...init,
            headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
        });
    } catch {
        return {
            ok: false,
            status: null,
            code: null,
            message: 'Network error. Please check your connection and try again.',
        };
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        return {
            ok: false,
            status: response.status,
            code: typeof data?.code === 'string' ? data.code : null,
            message:
                typeof data?.message === 'string' && data.message
                    ? data.message
                    : 'Something went wrong. Please try again.',
        };
    }

    return { ok: true, value: pick(data) };
}

/** GET — this passenger's favourites, newest first as the API ordered them. */
export function fetchFavouriteRoutes(token: string): Promise<FavouriteRouteResult<FavouriteRoute[]>> {
    return favouriteRequest(token, FAVOURITES_PATH, { method: 'GET' }, (data) =>
        Array.isArray(data.favourites) ? (data.favourites as FavouriteRoute[]) : []
    );
}

/**
 * POST — save a journey pair.
 *
 * A pair that is already saved comes back as a success with the existing
 * favourite, so a repeated save is indistinguishable to the caller from a
 * fresh one except for `alreadySaved`.
 */
export function createFavouriteRoute(
    token: string,
    journey: FavouriteRouteInput
): Promise<FavouriteRouteResult<{ favourite: FavouriteRoute; alreadySaved: boolean }>> {
    return favouriteRequest(
        token,
        FAVOURITES_PATH,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: journey.origin, destination: journey.destination }),
        },
        (data) => ({
            favourite: data.favourite as FavouriteRoute,
            alreadySaved: data.alreadySaved === true,
        })
    );
}

/**
 * DELETE — remove one favourite.
 *
 * The id is encoded on the way into the path because MOV-100's ids are
 * themselves percent-encoded; the route decodes exactly once on the way out.
 */
export function deleteFavouriteRoute(
    token: string,
    favouriteId: string
): Promise<FavouriteRouteResult<true>> {
    return favouriteRequest(
        token,
        `${FAVOURITES_PATH}/${encodeURIComponent(favouriteId)}`,
        { method: 'DELETE' },
        () => true as const
    );
}
