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
