/**
 * The client half of the accessibility analytics (MOV-168).
 *
 * One call against the endpoint MOV-169 already built. Nothing here derives
 * anything: the average, the rankings and the weekly trend are all the
 * backend's, computed from MOV-79's scoring, and this only carries them across
 * and types them.
 *
 * It does NOT go through `adminFetch`. That helper sends no Authorization
 * header — the bus, route and trip listings it was written for are open — and
 * this endpoint is admin-only, so an unauthenticated request would come back
 * 401 every time. The pattern followed instead is reportReviewApi's, which is
 * the project's existing way of calling an admin-gated route: the session token
 * goes on the request explicitly, and a failure comes back with the HTTP status
 * alongside the message so the screen can tell an expired session from a
 * refused one.
 *
 * Who is asking is never sent. The route takes the admin from the verified
 * token, so there is deliberately no adminId parameter to pass, correctly or
 * otherwise.
 */

import {
    AccessibilityTrendPoint,
    AverageAccessibilityScore,
    RankedRouteAccessibilityScore,
    ReportedVehicleSummary,
} from '../utils/accessibilityAnalytics';
import { API_BASE_URL } from '../../../shared/api/config';

/**
 * The analytics as GET /api/analytics/accessibility answers them.
 *
 * The four figures are typed by the same interfaces the backend produces them
 * with, imported rather than restated: a second copy of these shapes is a
 * second place for the client and the server to drift apart, and the module
 * they come from is pure — no Firestore, no server imports.
 */
export interface AccessibilityAnalyticsResponse {
    averageScore: AverageAccessibilityScore;
    mostAccessibleRoutes: RankedRouteAccessibilityScore[];
    mostReportedVehicles: ReportedVehicleSummary[];
    trend: AccessibilityTrendPoint[];
    /** ISO 8601 — when the backend derived these figures. Nothing is cached. */
    generatedAt: string;
    /** How many weekly buckets `trend` holds. */
    trendWeeks: number;
}

/**
 * What the call produced, or why it did not.
 *
 * The same shape reportReviewApi returns, with the response status carried on
 * the failure so the screen can word a 401 differently from a 500.
 */
export type AnalyticsResult<T> =
    | { ok: true; value: T }
    | { ok: false; message: string; status?: number };

/** Where the analytics live, relative to the API base URL. */
export function accessibilityAnalyticsPath(weeks?: number): string {
    return weeks === undefined
        ? '/api/analytics/accessibility'
        : `/api/analytics/accessibility?weeks=${encodeURIComponent(String(weeks))}`;
}

export const ANALYTICS_FALLBACK_MESSAGE = 'Unable to load accessibility analytics.';

/** What each refusal means, in the words an admin can act on. */
export const ANALYTICS_ERROR_MESSAGES: Record<number, string> = {
    401: 'Your session has expired. Please sign in again.',
    403: 'Only an administrator can view accessibility analytics.',
};

/**
 * The message to show for a failed request.
 *
 * 401 and 403 are stated here because they are the two an admin can do
 * something about. Everything else falls back to one wording rather than
 * surfacing a server-side fault message that means nothing to the person
 * reading it.
 */
export function analyticsErrorMessage(status?: number): string {
    return (status !== undefined && ANALYTICS_ERROR_MESSAGES[status]) || ANALYTICS_FALLBACK_MESSAGE;
}

/** A list off the API, or an empty one — never `undefined` for a screen to guard. */
function listOf<T>(raw: unknown): T[] {
    return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * The average, with `null` preserved.
 *
 * The backend distinguishes "no bus in service has a usable score" (null) from
 * a real, measured zero, and that distinction has to survive the wire. A
 * `Number(...)` or a `?? 0` here would turn an empty platform into one scoring
 * zero, which is the opposite finding.
 */
function averageOf(raw: any): AverageAccessibilityScore {
    const value = typeof raw?.value === 'number' && Number.isFinite(raw.value) ? raw.value : null;
    const busesIncluded =
        typeof raw?.busesIncluded === 'number' && Number.isFinite(raw.busesIncluded)
            ? raw.busesIncluded
            : 0;

    return { value, busesIncluded };
}

/**
 * GET /api/analytics/accessibility
 *
 * Admin only, enforced by the route rather than by which screen calls it.
 * `weeks` is left unset by default, so the endpoint answers with the twelve
 * weeks MOV-133 asks for without the client naming a window it does not own.
 */
export async function fetchAccessibilityAnalytics(
    token: string,
    weeks?: number
): Promise<AnalyticsResult<AccessibilityAnalyticsResponse>> {
    try {
        const response = await fetch(`${API_BASE_URL}${accessibilityAnalyticsPath(weeks)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result?.success) {
            return {
                ok: false,
                status: response.status,
                message: analyticsErrorMessage(response.status),
            };
        }

        return {
            ok: true,
            value: {
                averageScore: averageOf(result.averageScore),
                mostAccessibleRoutes: listOf<RankedRouteAccessibilityScore>(
                    result.mostAccessibleRoutes
                ),
                mostReportedVehicles: listOf<ReportedVehicleSummary>(result.mostReportedVehicles),
                trend: listOf<AccessibilityTrendPoint>(result.trend),
                generatedAt: typeof result.generatedAt === 'string' ? result.generatedAt : '',
                trendWeeks:
                    typeof result.trendWeeks === 'number' && Number.isFinite(result.trendWeeks)
                        ? result.trendWeeks
                        : 0,
            },
        };
    } catch (error) {
        console.error('Fetch Accessibility Analytics Error:', error);

        return { ok: false, message: ANALYTICS_FALLBACK_MESSAGE };
    }
}
