/**
 * Accessibility Report Entity Models and Types
 */

import { RouteDirection } from '../../route/model/types';

export type ReportIssueCategory =
    | 'BROKEN_RAMP'
    | 'LIFT_NOT_WORKING'
    | 'PRIORITY_SEAT_MISUSE'
    | 'BUS_OVERCROWDED'
    | 'DRIVER_DID_NOT_ASSIST'
    | 'AUDIO_ANNOUNCEMENT_NOT_WORKING';

export type ReportStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVIEWED' | 'RESOLVED';

/** Which slice of the reports collection the list screen is showing. */
export type ReportScope = 'all' | 'my' | 'verified';

export interface AccessibilityReport {
    reportId: string;
    passengerId: string;
    issueCategory: ReportIssueCategory;
    description: string;
    /**
     * Kept widened because the backend may introduce statuses the app does not
     * know about yet; the badge falls back to the raw value in that case.
     */
    status: ReportStatus | string;
    createdAt: string;
    updatedAt: string;

    // ------------------------------------------------------------------
    // The bus and the route the report is about (MOV-142).
    //
    // The references follow the shape a booking already uses: the canonical
    // document ids, plus a snapshot of what to display. A report is a
    // historical record, so it has to keep reading correctly after the bus is
    // retired or the route is edited.
    //
    // All four stay optional, and a report either has both halves of a
    // reference or neither: the API writes `vehicle` only alongside a `busId`
    // and `route` only alongside a `routeId`. A passenger can still file a
    // report without naming a bus or a route at all.
    // ------------------------------------------------------------------
    busId?: string;
    vehicle?: ReportVehicleSnapshot;
    routeId?: string;
    route?: ReportRouteSnapshot;

    // ------------------------------------------------------------------
    // Photo evidence. The form collects photos already, but nothing uploads
    // them yet — storing them is a separate storage subtask — so these are
    // still absent from every API response. Optional so the cards start
    // showing a photo count the moment the API returns one.
    // ------------------------------------------------------------------
    photoUrls?: string[];
    photoCount?: number;
}

/** What the bus looked like when the report was filed. */
export interface ReportVehicleSnapshot {
    numberPlate: string;
    busModel?: string;
    manufacturer?: string;
}

/**
 * What the route looked like when the report was filed.
 *
 * `direction` is typed rather than left as a bare string because a route
 * document exists per direction, and the two are what the route API accepts.
 * It stays optional for the same reason it is optional on `Route` itself: a
 * record predating that rule has none, and the report snapshots what the route
 * actually held rather than inventing a direction for it.
 */
export interface ReportRouteSnapshot {
    routeNumber: string;
    routeName?: string;
    direction?: RouteDirection;
}

/**
 * A photo the passenger picked on the device. It only ever lives in component
 * state — nothing is uploaded while photo storage is still unimplemented.
 */
export interface ReportPhotoDraft {
    /** Local file URI returned by the image picker. */
    uri: string;
    fileName?: string | null;
    fileSize?: number;
}
