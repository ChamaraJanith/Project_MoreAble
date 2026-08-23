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

/**
 * Every state a report can be stored in.
 *
 * Listed as values rather than as a bare union because the API has to validate
 * an incoming `?status=` filter against the same set the type describes — a
 * union alone exists only at compile time and can check nothing at request
 * time.
 */
export const REPORT_STATUSES = [
    'PENDING',
    'VERIFIED',
    'REJECTED',
    'REVIEWED',
    'RESOLVED',
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Whether an arbitrary value is a status a report may be filtered by. */
export function isReportStatus(value: unknown): value is ReportStatus {
    return (
        typeof value === 'string' &&
        (REPORT_STATUSES as readonly string[]).includes(value)
    );
}

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

    // ------------------------------------------------------------------
    // Admin review (MOV-161).
    //
    // Written only by POST /api/reports/:reportId/review, and only for an
    // ADMIN session. All three are absent until an admin has actually looked
    // at the report, which is what tells a reviewed report apart from one that
    // merely sits at PENDING.
    // ------------------------------------------------------------------

    /** The admin account that decided the report. Their `uid`, not a name. */
    reviewedBy?: string;

    /** ISO 8601, stamped by the server when the decision was recorded. */
    reviewedAt?: string;

    /**
     * What the admin wrote about the report.
     *
     * Kept apart from the community's comments: a remark is the outcome of the
     * review, not another voice in the thread.
     */
    adminRemark?: string;
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

// ==================================================================
// Admin review (MOV-161)
//
// A report is decided by an action rather than by a status sent from the
// client. The two are not the same thing: a status field would let any caller
// name any state — including one no admin flow can reach — while an action is a
// closed list of the decisions an admin is actually allowed to make, and the
// status it produces is chosen here rather than accepted from a request.
// ==================================================================

/** Every decision an admin can record against a report. */
export const REPORT_REVIEW_ACTIONS = ['VERIFY', 'REJECT', 'REMARK'] as const;

export type ReportReviewAction = (typeof REPORT_REVIEW_ACTIONS)[number];

/** Whether an arbitrary value is a review action the API will accept. */
export function isReportReviewAction(value: unknown): value is ReportReviewAction {
    return (
        typeof value === 'string' &&
        (REPORT_REVIEW_ACTIONS as readonly string[]).includes(value)
    );
}

/**
 * The status each decision moves the report to.
 *
 * REMARK maps to null on purpose: saving a remark is not a decision, so it
 * leaves the report exactly where it stood.
 */
export const REPORT_REVIEW_ACTION_STATUS: Record<ReportReviewAction, ReportStatus | null> = {
    VERIFY: 'VERIFIED',
    REJECT: 'REJECTED',
    REMARK: null,
};

/**
 * The status a report must be in before an admin can decide it.
 *
 * A report that has already been verified or rejected is not re-decided
 * through this route: the review is a record of what was found, and quietly
 * overwriting it would erase who found it and when.
 */
export const REPORT_REVIEW_REQUIRED_STATUS: ReportStatus = 'PENDING';

/**
 * Long enough for a finding, short enough to stay a remark.
 *
 * Enforced by the API, and the number an admin composer should cap typing at
 * so it can never send something the route will refuse.
 */
export const MAX_ADMIN_REMARK_LENGTH = 500;

/** The review as it stands on a report an admin has already decided. */
export interface AdminReportReview {
    status: ReportStatus | string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    adminRemark: string | null;
}
