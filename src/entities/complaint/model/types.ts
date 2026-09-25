/**
 * Accessibility Complaint Entity Models and Types (MOV-177)
 *
 * A complaint is the follow-up an admin opens on a report they have already
 * VERIFIED: the report records that a problem was found, the complaint tracks
 * getting it fixed. The two are separate records with separate lifecycles —
 * VERIFIED belongs to the report and is never moved on to RESOLVED; RESOLVED
 * belongs to the complaint.
 */

import {
    ReportIssueCategory,
    ReportRouteSnapshot,
    ReportVehicleSnapshot,
} from '../../report/model/types';

/**
 * Every state a complaint can be stored in.
 *
 * Listed as values rather than as a bare union for the same reason
 * REPORT_STATUSES is: the API validates an incoming `?status=` filter against
 * this set at request time.
 */
export const COMPLAINT_STATUSES = [
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'RESOLVED',
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Whether an arbitrary value is a status a complaint may be filtered by. */
export function isComplaintStatus(value: unknown): value is ComplaintStatus {
    return (
        typeof value === 'string' &&
        (COMPLAINT_STATUSES as readonly string[]).includes(value)
    );
}

/** The status every complaint is created in. */
export const COMPLAINT_INITIAL_STATUS: ComplaintStatus = 'PENDING';

// ==================================================================
// Status workflow (MOV-178)
//
// A complaint moves by an ACTION, never by a status sent from the client —
// the same arrangement REPORT_REVIEW_ACTIONS uses for reports. The client says
// START; the table below says what START means, and from which state.
// ==================================================================

/** Every action an admin can take on a complaint. */
export const COMPLAINT_ACTIONS = ['ASSIGN', 'REASSIGN', 'START', 'RESOLVE'] as const;

export type ComplaintAction = (typeof COMPLAINT_ACTIONS)[number];

/** Whether an arbitrary value is a complaint action the API will accept. */
export function isComplaintAction(value: unknown): value is ComplaintAction {
    return (
        typeof value === 'string' &&
        (COMPLAINT_ACTIONS as readonly string[]).includes(value)
    );
}

/**
 * For each action, the statuses it may be taken from and the status each one
 * leads to. A combination that is not listed is not a transition.
 *
 * REASSIGN leaves the status where it was, the way a report REMARK does, and is
 * a separate action from ASSIGN so that two admins assigning the same PENDING
 * complaint at once cannot both succeed. RESOLVED appears as no action's
 * starting point: it is final.
 */
export const COMPLAINT_TRANSITIONS: Record<
    ComplaintAction,
    Partial<Record<ComplaintStatus, ComplaintStatus>>
> = {
    ASSIGN: { PENDING: 'ASSIGNED' },
    REASSIGN: { ASSIGNED: 'ASSIGNED', IN_PROGRESS: 'IN_PROGRESS' },
    START: { ASSIGNED: 'IN_PROGRESS' },
    RESOLVE: { IN_PROGRESS: 'RESOLVED' },
};

/**
 * The status `action` moves a complaint in `current` to, or null when the
 * action cannot be taken from there.
 */
export function nextComplaintStatus(
    action: ComplaintAction,
    current: unknown
): ComplaintStatus | null {
    if (!isComplaintStatus(current)) return null;

    return COMPLAINT_TRANSITIONS[action][current] ?? null;
}

/** Every status `action` can produce, from any starting point. */
export function complaintActionOutcomes(action: ComplaintAction): ComplaintStatus[] {
    return Object.values(COMPLAINT_TRANSITIONS[action]) as ComplaintStatus[];
}

/**
 * One complaint, as stored at `complaints/{complaintId}`.
 *
 * The issue, the bus and the route are copied off the report when the
 * complaint is created, using the report's own snapshot shapes, so the
 * complaint keeps reading correctly after its passenger deletes the report.
 *
 * Optional fields are omitted rather than stored as null. The assignment,
 * start and resolution fields are written by the status workflow (MOV-178);
 * a newly created complaint carries none of them.
 */
export interface Complaint {
    complaintId: string;
    reportId: string;
    status: ComplaintStatus;

    issueCategory: ReportIssueCategory;
    description: string;

    busId?: string;
    vehicle?: ReportVehicleSnapshot;

    routeId?: string;
    route?: ReportRouteSnapshot;

    assignedTo?: string;
    assignedToName?: string;
    assignedBy?: string;
    assignedAt?: string;

    startedAt?: string;

    resolvedBy?: string;
    resolvedAt?: string;

    resolutionNote?: string;

    /** The admin who opened the complaint. Their `uid`, from the verified token. */
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}
