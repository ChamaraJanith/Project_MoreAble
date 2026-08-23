/**
 * Accessibility Report Entity Models and Types
 */

import { RouteDirection } from '../../route/model/types';

/**
 * Every issue category, in the order the picker offers them.
 *
 * The values live here rather than beside their labels because the API has to
 * validate against the same list, and it cannot import the UI module that holds
 * the wording and the icons. Adding a category here is what makes it valid;
 * reportCategories.ts then has to give it a label, or that file stops compiling.
 *
 * OTHER is last on purpose — a catch-all reads as a fallback, not a peer of the
 * specific problems above it.
 */
export const REPORT_ISSUE_CATEGORIES = [
    'BROKEN_RAMP',
    'LIFT_NOT_WORKING',
    'PRIORITY_SEAT_MISUSE',
    'BUS_OVERCROWDED',
    'DRIVER_DID_NOT_ASSIST',
    'AUDIO_ANNOUNCEMENT_NOT_WORKING',
    'OTHER',
] as const;

export type ReportIssueCategory = (typeof REPORT_ISSUE_CATEGORIES)[number];

/** Whether an arbitrary value is one of the categories a report may carry. */
export function isReportIssueCategory(value: unknown): value is ReportIssueCategory {
    return (
        typeof value === 'string' &&
        (REPORT_ISSUE_CATEGORIES as readonly string[]).includes(value)
    );
}

export type ReportStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REVIEWED' | 'RESOLVED';

/** Enough evidence to describe an issue without making the form unwieldy. */
export const MAX_REPORT_PHOTOS = 5;

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
    // Photo evidence, as Cloudinary secure URLs — never the device uris the
    // picker produced, which mean nothing off the phone that took them.
    // Absent rather than empty when the report carries no photos.
    // ------------------------------------------------------------------
    photoUrls?: string[];

    // ------------------------------------------------------------------
    // Community feedback tallies, kept on the report itself (MOV-145).
    //
    // The votes collection stays the record of who voted; these are the counts
    // as they stood after the last vote was cast, so a screen showing a report
    // does not have to read every vote on it. Absent on a report nobody has
    // voted on yet, which reads as zero.
    // ------------------------------------------------------------------
    agreeCount?: number;
    disagreeCount?: number;

    /**
     * How many comments the report has drawn.
     *
     * Unlike the vote tallies this is NOT stored on the report: it is derived
     * per request by GET /api/reports, which tallies the comments collection
     * once for the whole list. So it is present on a report that came from the
     * list and absent on one read straight out of Firestore — a card reads it
     * as zero when it is missing rather than treating it as a broken report.
     */
    commentCount?: number;

    /**
     * Set once the report reaches REPORT_ADMIN_REVIEW_AGREE_THRESHOLD agreeing
     * passengers. It is a flag for a human to look, and deliberately not a
     * `status` change: only an admin decides whether a report is VERIFIED.
     */
    requiresAdminReview?: boolean;

    /** When the flag was last raised. Absent while the report is unflagged. */
    adminReviewFlaggedAt?: string;
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

/** Where one picked photo has got to on its way to Cloudinary. */
export type ReportPhotoUploadStatus = 'uploading' | 'uploaded' | 'failed';

/**
 * A photo the passenger picked on the device, held in form state until submit.
 *
 * `uri` is what the thumbnail renders from and is never sent anywhere: it is a
 * path on this phone, and it doubles as the photo's key in form state. The
 * image itself goes to Cloudinary the moment it is picked, and `url` — the
 * `secure_url` that came back — is the only value that travels to the API.
 *
 * `base64` is kept after a successful upload as well, so a photo that failed
 * can be retried without asking the passenger to pick it again.
 */
export interface ReportPhotoDraft {
    /** Local file URI returned by the image picker. Display only. */
    uri: string;
    /** The image itself, requested from the picker so it can be uploaded. */
    base64?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    fileSize?: number;
    status: ReportPhotoUploadStatus;
    /** The Cloudinary secure_url. Present only once `status` is 'uploaded'. */
    url?: string;
    /** Why the upload failed, shown on the thumbnail beside a Retry control. */
    error?: string;
}

// ==================================================================
// Community feedback (MOV-145)
//
// A report is one passenger's account. Whether the ramp is actually broken is
// something the people who ride that route answer together, by voting on the
// report and commenting on it. Both live in their own Firestore collections
// rather than on the report document: a vote belongs to the passenger who cast
// it, and a report that collects fifty comments must not become a fifty-comment
// document that every list screen then downloads.
// ==================================================================

/** The two ways a passenger can answer a report. */
export const REPORT_VOTE_CHOICES = ['AGREE', 'DISAGREE'] as const;

export type ReportVoteChoice = (typeof REPORT_VOTE_CHOICES)[number];

/** Whether an arbitrary value is a vote the API will accept. */
export function isReportVoteChoice(value: unknown): value is ReportVoteChoice {
    return (
        typeof value === 'string' &&
        (REPORT_VOTE_CHOICES as readonly string[]).includes(value)
    );
}

/**
 * Long enough to describe what was seen, short enough to stay a comment.
 *
 * The same number the composer caps typing at, so the API can never refuse
 * something the input allowed the passenger to write.
 */
export const MAX_REPORT_COMMENT_LENGTH = 300;

/**
 * How many agreeing passengers make a report an admin's problem rather than
 * one person's account.
 *
 * Reaching it flags the report for review. It does NOT verify the report —
 * five passengers agreeing is a reason for somebody to look, not a finding.
 */
export const REPORT_ADMIN_REVIEW_AGREE_THRESHOLD = 5;

/**
 * One passenger's vote on one report.
 *
 * The document id is derived from `reportId` + `passengerId`, which is what
 * makes a second vote from the same passenger overwrite the first instead of
 * adding to the tally — the uniqueness rule is the key, not a query.
 */
export interface ReportVote {
    voteId: string;
    reportId: string;
    passengerId: string;
    vote: ReportVoteChoice;
    createdAt: string;
    updatedAt: string;
}

/**
 * One stored comment on one report.
 *
 * The four display fields are named exactly as MOV-144's thread already reads
 * them, so a comment straight off the API drops into the list with nothing to
 * map. `reportId` and `passengerId` are what the list does not need and the
 * record cannot do without — the second is how the app tells a passenger their
 * own comment from everybody else's.
 *
 * `authorName` is snapshotted at the time of writing, the way a report
 * snapshots the bus and the route it names: the comment has to keep reading
 * correctly afterwards, and drawing a thread must not cost one user lookup per
 * row.
 */
export interface ReportCommentRecord {
    commentId: string;
    reportId: string;
    passengerId: string;
    authorName: string;
    /** What was written, trimmed. Named for the thread that renders it. */
    text: string;
    /** ISO 8601, so it formats through the same helper as every other date. */
    createdAt: string;
}

/** How a report stands with the community, and where this session sits in it. */
export interface ReportVoteSummary {
    /** This session's own vote, or null when they have not voted. */
    myVote: ReportVoteChoice | null;
    agreeCount: number;
    disagreeCount: number;
}
