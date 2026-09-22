/**
 * The client half of passenger bus ratings.
 *
 * The screen names the completed booking and the stars, and nothing else that
 * identifies anyone: the passenger is the session token's, and the bus and run
 * are resolved on the server from the booking's completion record. Skipping
 * calls nothing here — a skipped rating is never sent.
 */

import { BusRating, BusRatingContext, BusRatingValue } from '../../../entities/rating/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

export type BusRatingResult<T> =
    | { ok: true; value: T }
    /** `status` is null for a network failure; `code` is the API's, when it gave one. */
    | { ok: false; status: number | null; code: string | null; message: string };

const RATING_PATH = '/api/journeys/completed/rating';

async function ratingRequest<T>(token: string, path: string, init: RequestInit, pick: (data: any) => T): Promise<BusRatingResult<T>> {
    if (!token) {
        return { ok: false, status: 401, code: null, message: 'Please sign in again.' };
    }

    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...init,
            headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
        });
    } catch {
        return { ok: false, status: null, code: null, message: 'Network error. Please check your connection and try again.' };
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        return {
            ok: false,
            status: response.status,
            code: typeof data?.code === 'string' ? data.code : null,
            message: typeof data?.message === 'string' && data.message ? data.message : 'Something went wrong. Please try again.',
        };
    }

    return { ok: true, value: pick(data) };
}

/** GET — the bus the passenger travelled on for this completed booking. */
export function getBusRatingContext(token: string, bookingId: string): Promise<BusRatingResult<BusRatingContext>> {
    return ratingRequest(token, `${RATING_PATH}?bookingId=${encodeURIComponent(bookingId)}`, { method: 'GET' }, (data) => ({
        journey: data.journey,
        bus: data.bus,
        myRating: data.myRating ?? null,
    }));
}

/** POST — rate that bus. `busId` is the one the screen showed; the server checks it. */
export function submitBusRating(
    token: string,
    submission: { bookingId: string; busId: string; rating: BusRatingValue }
): Promise<BusRatingResult<BusRating>> {
    return ratingRequest(
        token,
        RATING_PATH,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submission),
        },
        (data) => data.rating as BusRating
    );
}
