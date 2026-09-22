/**
 * Reading how one bus stands with its passengers (MOV-80).
 *
 * Two reads, and they are not in the same state of readiness:
 *
 *   Verified reports — WORKING TODAY. `GET /api/reports?scope=verified` already
 *     returns every verified report, and each one carries the `busId` it was
 *     filed against. Narrowing that to one bus on the device is the pattern this
 *     feature already uses for its own list screen (see reportSearch.ts): the
 *     endpoint answers a whole slice in one request, and the screen filters what
 *     arrived. No new route, no second listing path.
 *
 *   The rating average — WAITING ON MOV-116. Nothing in the app today exposes an
 *     average of `busRatings`. `GET /api/journeys/completed/rating` returns one
 *     passenger's own rating for one of their own bookings, and the per-bus
 *     read that does exist (`loadAccessibilityScoreEvidence`) collapses the
 *     ratings into the accessibility score and never returns them. So the
 *     request below states the contract MOV-116 is expected to answer and
 *     degrades to UNAVAILABLE until it does.
 *
 * Deliberately NOT done here: computing an average in the app. Doing so would
 * need every rating document for the bus, which no endpoint gives out and which
 * would put a second definition of "the average rating" in the client, beside
 * the server's. An absent number is better than a second, disagreeing one.
 */

import { BusRatingSummary } from '../../../entities/rating/model/types';
import { AccessibilityReport } from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { RECENT_FEEDBACK_LIMIT, selectVerifiedBusReports } from '../utils/busCommunityFeedback';

/**
 * The contract MOV-116 is expected to serve.
 *
 * A sibling of the existing `GET /api/buses/[busId]/location`, answering
 * `{ success, summary: { busId, average, count } }` for the bus at
 * `buses/{busId}`, counting only ratings `readBusRating` accepts.
 */
export const BUS_RATING_SUMMARY_PATH = (busId: string) =>
    `/api/buses/${encodeURIComponent(busId)}/ratings`;

/** The existing verified-reports slice, unchanged. */
export const VERIFIED_REPORTS_PATH = '/api/reports?scope=verified';

/**
 * What a read came back with.
 *
 * `UNAVAILABLE` is kept apart from `ERROR` on purpose. "We cannot show ratings
 * for this bus" and "something went wrong" read very differently to a passenger,
 * and only one of them is worth an error state — a bus whose ratings are simply
 * not being served yet is not a fault the passenger can do anything about.
 */
export type BusCommunityRead<T> =
    | { ok: true; value: T }
    | { ok: false; reason: 'UNAVAILABLE' | 'ERROR'; message: string };

async function authorizedJson(
    token: string,
    path: string
): Promise<{ ok: true; data: any } | { ok: false; status: number | null; message: string }> {
    if (!token) {
        return { ok: false, status: 401, message: 'Please sign in again.' };
    }

    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch {
        return {
            ok: false,
            status: null,
            message: 'Network error. Please check your connection and try again.',
        };
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        return {
            ok: false,
            status: response.status,
            message:
                typeof data?.message === 'string' && data.message
                    ? data.message
                    : 'Something went wrong. Please try again.',
        };
    }

    return { ok: true, data };
}

/**
 * A summary as the server described it, rebuilt field by field.
 *
 * A malformed payload becomes "no ratings" rather than a rendered NaN. `average`
 * is kept only when `count` supports it: a count of 0 has no average by
 * definition, and an average without a count is not one either.
 */
export function readBusRatingSummary(data: any, busId: string): BusRatingSummary {
    const raw = data?.summary ?? data;
    const count =
        typeof raw?.count === 'number' && Number.isFinite(raw.count) && raw.count > 0
            ? Math.trunc(raw.count)
            : 0;
    const average =
        count > 0 && typeof raw?.average === 'number' && Number.isFinite(raw.average)
            ? raw.average
            : null;

    return { busId, average, count };
}

/**
 * The average rating and rating count for one bus.
 *
 * A 404 or a 501 means the route is not being served for this bus — today,
 * because MOV-116 has not added it; later, because the bus is unknown. Either
 * way there is nothing to show and nothing has gone wrong, so it is UNAVAILABLE
 * rather than an error.
 */
export async function getBusRatingSummary(
    token: string,
    busId: string
): Promise<BusCommunityRead<BusRatingSummary>> {
    if (!busId?.trim()) {
        return { ok: false, reason: 'UNAVAILABLE', message: 'No bus to read ratings for.' };
    }

    const result = await authorizedJson(token, BUS_RATING_SUMMARY_PATH(busId.trim()));

    if (!result.ok) {
        const unavailable = result.status === 404 || result.status === 501;

        return {
            ok: false,
            reason: unavailable ? 'UNAVAILABLE' : 'ERROR',
            message: result.message,
        };
    }

    return { ok: true, value: readBusRatingSummary(result.data, busId.trim()) };
}

/**
 * The verified community reports about one bus, newest first.
 *
 * Reads the existing verified slice and narrows it here. The narrowing rule
 * lives in `selectVerifiedBusReports` so that what reaches the screen is
 * verified-and-this-bus by the same rule wherever it is asked for.
 */
export async function getVerifiedBusReports(
    token: string,
    busId: string,
    limit: number = RECENT_FEEDBACK_LIMIT
): Promise<BusCommunityRead<AccessibilityReport[]>> {
    if (!busId?.trim()) {
        return { ok: true, value: [] };
    }

    const result = await authorizedJson(token, VERIFIED_REPORTS_PATH);

    if (!result.ok) {
        return { ok: false, reason: 'ERROR', message: result.message };
    }

    const reports = Array.isArray(result.data?.reports) ? result.data.reports : [];

    return { ok: true, value: selectVerifiedBusReports(reports, busId.trim(), limit) };
}
