/**
 * What each tab of the list screen asks the API for.
 *
 * All three tabs are answered by GET /api/reports — the same handler, told
 * apart only by the `scope` query parameter, which is what decides whether the
 * query is filtered by the caller's passengerId (`my`), by status (`verified`)
 * or not at all (`all`). Three tabs, one endpoint: none of them is a second
 * listing route, and none of them narrows a wider list in the app.
 *
 * `verified` was a placeholder tab until MOV-272 — the backend scope existed
 * and was tested, and the tab drew a "Coming Soon" card instead of calling it.
 * What it needed was this path, not a screen of its own.
 */

import { ReportScope } from '../../../entities/report/model/types';

/**
 * The reports request for a scope, relative to the API base URL.
 *
 * `scope` is always sent explicitly — including for `all`, which the backend
 * would default to anyway — so the request says which slice it wants rather
 * than relying on what the handler happens to do with a missing parameter.
 */
export function reportsRequestPath(scope: ReportScope): string {
    return `/api/reports?scope=${scope}`;
}
