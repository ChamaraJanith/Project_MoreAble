/**
 * Which report scopes the list screen can actually ask the API for.
 *
 * `all` and `my` are both answered by GET /api/reports — the same handler, told
 * apart only by the `scope` query parameter, which is also what decides whether
 * the query is filtered by the caller's passengerId. `verified` is deliberately
 * absent: its tab is still a placeholder, and keeping it out of this type is
 * what stops the screen from requesting it by accident.
 */

import { ReportScope } from '../../../entities/report/model/types';

/** A scope the screen is allowed to fetch. */
export type FetchableReportScope = Extract<ReportScope, 'all' | 'my'>;

/** Whether this tab is backed by the API rather than by a placeholder. */
export function isFetchableReportScope(scope: ReportScope): scope is FetchableReportScope {
    return scope === 'all' || scope === 'my';
}

/**
 * The reports request for a scope, relative to the API base URL.
 *
 * `scope` is always sent explicitly — including for `all`, which the backend
 * would default to anyway — so the request says which slice it wants rather
 * than relying on what the handler happens to do with a missing parameter.
 */
export function reportsRequestPath(scope: FetchableReportScope): string {
    return `/api/reports?scope=${scope}`;
}
