/**
 * Accessibility Report Entity Models and Types
 */

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
    // Details the report form already collects but the current backend does
    // not persist yet. Optional so the cards start showing them the moment
    // the API returns them, without another UI change.
    // ------------------------------------------------------------------
    busNumber?: string;
    routeNumber?: string;
    photoUrls?: string[];
    photoCount?: number;
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
