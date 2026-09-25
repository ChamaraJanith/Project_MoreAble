/**
 * What the Complaint Management screens show and offer (MOV-176).
 *
 * Renderer-free on purpose, like reportReview.ts: the screens decide how to
 * draw, and this decides what — which actions a complaint offers, who can be
 * picked for it, what a failure says. Keeping it here is what lets it be tested
 * under the project's node-only Jest setup, and what stops the list and the
 * detail screen from each growing their own copy of the rules.
 *
 * A complaint is not a report. A VERIFIED report means the accessibility issue
 * was confirmed; a RESOLVED complaint means it was actually fixed. Nothing in
 * this module reads or writes a report's status — the source report is shown
 * alongside a complaint, never changed through one.
 */

import {
    COMPLAINT_STATUSES,
    Complaint,
    ComplaintAction,
    ComplaintStatus,
    isComplaintStatus,
    nextComplaintStatus,
} from '../../../entities/complaint/model/types';
import {
    MAX_ADMIN_REMARK_LENGTH,
    ReportRouteSnapshot,
    ReportVehicleSnapshot,
    reportTypeOf,
} from '../../../entities/report/model/types';
import { AdminUserSummary } from '../../../entities/user/model/types';

// ------------------------------------------------------------------
// Shapes the API answers with
// ------------------------------------------------------------------

/**
 * One complaint as the API sends it: the stored record, with its timestamps as
 * ISO strings. The same fields the backend's Complaint model declares — the
 * optional ones stay absent until the workflow writes them.
 */
export type AdminComplaint = Omit<Complaint, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};

/**
 * The report a complaint was opened from, as it stands now.
 *
 * Null on the detail screen once the passenger has deleted it; the complaint
 * carries its own copy of the issue, bus and route either way.
 */
export interface ComplaintSourceReport {
    reportId: string;
    status?: string;
    issueCategory?: string;
    description?: string;
    busId?: string;
    vehicle?: ReportVehicleSnapshot;
    routeId?: string;
    route?: ReportRouteSnapshot;
    photoUrls?: string[];
    reviewedAt?: string;
    adminRemark?: string;
    createdAt?: string;
    updatedAt?: string;
}

// ------------------------------------------------------------------
// Statuses and filters
// ------------------------------------------------------------------

export type ComplaintStatusFilter = ComplaintStatus | 'ALL';

const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
    PENDING: 'Pending',
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In Progress',
    RESOLVED: 'Resolved',
};

/** The wording for a complaint status; an unknown one reads as itself. */
export function complaintStatusLabel(status: string): string {
    return isComplaintStatus(status) ? COMPLAINT_STATUS_LABELS[status] : status;
}

/** The tabs over the list, in lifecycle order. */
export const COMPLAINT_STATUS_FILTERS: { value: ComplaintStatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    ...COMPLAINT_STATUSES.map((status) => ({ value: status, label: COMPLAINT_STATUS_LABELS[status] })),
];

export type ComplaintStatusCounts = Record<ComplaintStatus, number>;

/** How many complaints sit in each state — the summary tiles over the list. */
export function countComplaintsByStatus(complaints: AdminComplaint[]): ComplaintStatusCounts {
    const counts: ComplaintStatusCounts = { PENDING: 0, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 0 };

    for (const complaint of complaints) {
        if (isComplaintStatus(complaint.status)) counts[complaint.status] += 1;
    }

    return counts;
}

/**
 * The query string a list request carries.
 *
 * Both filters are the API's own (`?status=`, `?assignedTo=`), so the list asks
 * for the slice it shows rather than narrowing a wider one here.
 */
export function complaintListQuery(filters: {
    status?: ComplaintStatusFilter;
    assignedTo?: string | null;
}): string {
    const params: string[] = [];

    if (filters.status && filters.status !== 'ALL') {
        params.push(`status=${encodeURIComponent(filters.status)}`);
    }

    if (filters.assignedTo) {
        params.push(`assignedTo=${encodeURIComponent(filters.assignedTo)}`);
    }

    return params.length > 0 ? `?${params.join('&')}` : '';
}

// ------------------------------------------------------------------
// Search
// ------------------------------------------------------------------

export const COMPLAINT_SEARCH_PLACEHOLDER = 'Search by ID, issue, bus, route or admin';

/**
 * The complaints matching what was typed, in the order they came.
 *
 * Matched against what an admin can read off a card — the ids, the issue in
 * its displayed wording, the description, the bus, the route and the assignee
 * — so anything visible can be searched for. `categoryLabel` is passed in
 * because the wording lives with the report UI, not in this module.
 */
export function filterComplaintsBySearch(
    complaints: AdminComplaint[],
    search: string,
    categoryLabel: (category: string) => string = (category) => category
): AdminComplaint[] {
    const needle = search.trim().toLowerCase();

    if (!needle) return complaints;

    return complaints.filter((complaint) =>
        [
            complaint.complaintId,
            complaint.reportId,
            complaint.issueCategory,
            categoryLabel(complaint.issueCategory),
            complaint.description,
            complaint.busId,
            complaint.vehicle?.numberPlate,
            complaint.routeId,
            complaint.route?.routeNumber,
            complaint.route?.routeName,
            complaint.assignedTo,
            complaint.assignedToName,
        ].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
    );
}

// ------------------------------------------------------------------
// Workflow actions
// ------------------------------------------------------------------

export interface ComplaintActionAvailability {
    assign: boolean;
    reassign: boolean;
    start: boolean;
    resolve: boolean;
}

/**
 * Which workflow actions a complaint in `status` offers.
 *
 * Read off the same transition table the API enforces, rather than restated:
 * a second copy of "START is allowed from ASSIGNED" is a second place for the
 * button and the route to disagree. That table gives exactly
 *
 *   PENDING      Assign
 *   ASSIGNED     Reassign, Start
 *   IN_PROGRESS  Reassign, Resolve
 *   RESOLVED     nothing — it is final.
 */
export function complaintActionAvailability(status: string): ComplaintActionAvailability {
    const can = (action: ComplaintAction) => nextComplaintStatus(action, status) !== null;

    return {
        assign: can('ASSIGN'),
        reassign: can('REASSIGN'),
        start: can('START'),
        resolve: can('RESOLVE'),
    };
}

/** Whether a complaint in `status` offers any workflow action at all. */
export function hasComplaintActions(status: string): boolean {
    return Object.values(complaintActionAvailability(status)).some(Boolean);
}

// ------------------------------------------------------------------
// Assignees
// ------------------------------------------------------------------

export interface ComplaintAssigneeOption {
    /** The user document id — what `assignedTo` stores. */
    value: string;
    label: string;
    description?: string;
}

/**
 * The administrators a complaint can be given to.
 *
 * Only ADMIN accounts that are not suspended — the rules the API applies — and
 * never the current assignee, whom a reassignment cannot pick (the API answers
 * 409). The value is the user document id; the name is only what is shown.
 */
export function complaintAssigneeOptions(
    users: AdminUserSummary[],
    currentAssignee?: string | null
): ComplaintAssigneeOption[] {
    return users
        .filter(
            (user) =>
                user.role === 'ADMIN' &&
                user.accountStatus !== 'SUSPENDED' &&
                !!user.documentId &&
                user.documentId !== currentAssignee
        )
        .map((user) => ({
            value: user.documentId,
            label: user.userName?.trim() || user.documentId,
            description: [user.documentId, user.email].filter(Boolean).join(' · '),
        }))
        .sort((first, second) => first.label.localeCompare(second.label));
}

/** How the assignee reads on a card or a detail row. */
export function complaintAssigneeLabel(complaint: Pick<AdminComplaint, 'assignedTo' | 'assignedToName'>): string | null {
    if (!complaint.assignedTo) return null;

    return complaint.assignedToName?.trim() || complaint.assignedTo;
}

/**
 * How an actor id reads — `assignedBy` and `resolvedBy`.
 *
 * Those hold the acting admin's Firebase UID, which the admin user list does
 * not carry, so an id that is not this session's own is shown as it was
 * recorded rather than guessed at.
 */
export function complaintActorLabel(actorId: string | undefined, sessionUid?: string | null): string | null {
    if (!actorId) return null;

    return sessionUid && actorId === sessionUid ? 'You' : actorId;
}

// ------------------------------------------------------------------
// Resolution note
// ------------------------------------------------------------------

/** The API's cap on a resolution note — the same one an admin remark has. */
export const MAX_RESOLUTION_NOTE_LENGTH = MAX_ADMIN_REMARK_LENGTH;

/**
 * Why a resolution note cannot be sent yet, or null when it can.
 *
 * The API trims before it measures, so this does too: whitespace alone is no
 * note, and padding never counts against the limit.
 */
export function resolutionNoteError(note: string): string | null {
    const trimmed = note.trim();

    if (!trimmed) return 'A resolution note is required.';

    if (trimmed.length > MAX_RESOLUTION_NOTE_LENGTH) {
        return `A resolution note can be at most ${MAX_RESOLUTION_NOTE_LENGTH} characters.`;
    }

    return null;
}

// ------------------------------------------------------------------
// Failures
// ------------------------------------------------------------------

export const COMPLAINT_FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

export const COMPLAINT_CONFLICT_MESSAGE =
    'This complaint was updated by another administrator. Refreshing the latest status...';

const COMPLAINT_ERROR_MESSAGES: Record<number, string> = {
    401: 'Your session has expired. Please sign in again.',
    403: 'Only an administrator can manage complaints.',
    404: 'This complaint could not be found.',
    500: 'The server could not complete the request. Please try again.',
};

/**
 * The message to show for a failed complaint request.
 *
 * A 409 on an action is somebody else's change landing first, and says so. A
 * 400 or a 404 on an assignee carries the API's own wording, which is the
 * part that knows what was wrong with the request.
 */
export function complaintErrorMessage(status: number | undefined, apiMessage?: string | null): string {
    const message = typeof apiMessage === 'string' && apiMessage.trim() ? apiMessage : null;

    if (status === 409) return COMPLAINT_CONFLICT_MESSAGE;

    if (status === 400 && message) return message;

    if (status !== undefined && COMPLAINT_ERROR_MESSAGES[status]) {
        return COMPLAINT_ERROR_MESSAGES[status];
    }

    return message ?? COMPLAINT_FALLBACK_MESSAGE;
}

/**
 * Whether a failed action leaves the screen describing a complaint that no
 * longer exists in that form — moved on by another admin (409) or gone (404) —
 * so it has to reload rather than keep offering the action that just failed.
 */
export function shouldReloadComplaintAfterFailure(status: number | undefined): boolean {
    return status === 404 || status === 409;
}

// ------------------------------------------------------------------
// Opening a complaint from a report
// ------------------------------------------------------------------

/**
 * Whether a report can have a complaint opened from it: a VERIFIED issue
 * report. Positive feedback never can, and an unverified report not yet — the
 * rules POST /api/complaints enforces, so the button is not drawn for a
 * request that would be refused.
 */
export function canCreateComplaintFromReport(report: { status?: unknown; type?: unknown }): boolean {
    return report?.status === 'VERIFIED' && reportTypeOf(report) === 'ISSUE';
}

export const DUPLICATE_COMPLAINT_MESSAGE = 'Complaint already exists for this report.';

/**
 * Whether a failed create was refused because the report already has a
 * complaint, and which one.
 *
 * The API answers that case 409 with the existing id in its message —
 * "A complaint already exists for this report (CMP-00001)." — and no separate
 * field, so the id is read from there. Another 409 (a report no longer
 * VERIFIED) is not a duplicate. If the wording ever changes, the duplicate is
 * still recognised and simply offers no link.
 */
export function readDuplicateComplaint(
    status: number | undefined,
    message: string | null | undefined
): { isDuplicate: boolean; complaintId: string | null } {
    const text = typeof message === 'string' ? message : '';

    if (status !== 409 || !/already exists/i.test(text)) {
        return { isDuplicate: false, complaintId: null };
    }

    return { isDuplicate: true, complaintId: text.match(/\b(CMP-\d{5,})\b/)?.[1] ?? null };
}

// ------------------------------------------------------------------
// Where the screens live
// ------------------------------------------------------------------

/** The complaint list: `/(admin)/complaints`. */
export function complaintListPath(): string {
    return '/(admin)/complaints';
}

/** One complaint: `/(admin)/complaints/CMP-00001`. */
export function complaintDetailsPath(complaintId: string): string {
    return `${complaintListPath()}/${encodeURIComponent(complaintId)}`;
}

/** Whether a route parameter is shaped like a complaint id the API could answer. */
export function isComplaintIdParam(value: unknown): value is string {
    return typeof value === 'string' && /^CMP-\d{5,}$/.test(value);
}
