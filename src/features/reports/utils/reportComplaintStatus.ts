/**
 * Which verified issue reports already have a complaint, as the Review Reports
 * queue shows it.
 *
 * A complaint is its own record with its own lifecycle (see
 * entities/complaint): VERIFIED belongs to the report, PENDING → RESOLVED to the
 * complaint. The queue draws the two as separate badges, and this module
 * decides what the second one says. Nothing here reads or writes either
 * status — it only matches complaints the existing GET /api/complaints already
 * returns against the reports already on screen.
 *
 * Renderer-free, like reportReview.ts, so it can be tested under the project's
 * node-only Jest setup.
 */

import { AccessibilityReport } from '../../../entities/report/model/types';
import {
    AdminComplaint,
    canCreateComplaintFromReport,
    complaintStatusLabel,
} from '../../admin/utils/complaintWorkflow';

/** The two complaint fields the queue uses. */
export type ReportComplaintRef = Pick<AdminComplaint, 'complaintId' | 'status' | 'reportId'>;

/**
 * Every complaint the queue knows about, keyed by the report it was opened
 * from — or why that is not known.
 *
 * `error` is never read as "no complaints": a lookup that could not be made
 * must not tell an admin that a report has none.
 */
export type ComplaintIndex =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; byReport: Map<string, ReportComplaintRef> };

export const COMPLAINT_INDEX_LOADING: ComplaintIndex = { status: 'loading' };
export const COMPLAINT_INDEX_ERROR: ComplaintIndex = { status: 'error' };

export const COMPLAINT_STATUS_UNAVAILABLE_MESSAGE =
    'Complaint status could not be loaded. Pull to refresh to try again.';

/**
 * The complaint list as an index by report.
 *
 * The API answers newest first, and one complaint per report is the create
 * rule; should a report ever hold more, the newest is the one shown — the same
 * choice the Review Report screen makes.
 */
export function indexComplaintsByReport(complaints: ReportComplaintRef[]): ComplaintIndex {
    const byReport = new Map<string, ReportComplaintRef>();

    for (const complaint of complaints) {
        if (!complaint?.reportId || byReport.has(complaint.reportId)) continue;

        byReport.set(complaint.reportId, complaint);
    }

    return { status: 'ready', byReport };
}

/**
 * The complaint opened from this report, if any.
 *
 * A complaint stores the report's document id. Queue rows carry it as
 * `documentId`, and as `reportId` as well, so both are tried.
 */
export function complaintForReport(
    report: AccessibilityReport & { documentId?: string },
    byReport: Map<string, ReportComplaintRef>
): ReportComplaintRef | null {
    return (
        (report.documentId ? byReport.get(report.documentId) : undefined) ??
        byReport.get(report.reportId) ??
        null
    );
}

/** How the complaint chip is styled: neutral, needs attention, or done. */
export type ComplaintBadgeTone = 'none' | 'active' | 'resolved';

export interface ComplaintBadge {
    tone: ComplaintBadgeTone;
    /** What the chip reads: "No Complaint" or "Complaint CMP-00007 · In Progress". */
    label: string;
    /** Null when there is no complaint. */
    complaintId: string | null;
}

export const NO_COMPLAINT_LABEL = 'No Complaint';

/**
 * The complaint chip for one queue card, or null for none.
 *
 * Only a VERIFIED issue report gets one — the only kind a complaint can be
 * opened from (canCreateComplaintFromReport, the rule POST /api/complaints
 * enforces). Positive feedback and undecided or rejected issues get nothing,
 * and so does every card while the complaints are loading or failed to load.
 */
export function reportComplaintBadge(
    report: AccessibilityReport & { documentId?: string },
    index: ComplaintIndex
): ComplaintBadge | null {
    if (!canCreateComplaintFromReport(report) || index.status !== 'ready') return null;

    const complaint = complaintForReport(report, index.byReport);

    if (!complaint) {
        return { tone: 'none', label: NO_COMPLAINT_LABEL, complaintId: null };
    }

    return {
        tone: complaint.status === 'RESOLVED' ? 'resolved' : 'active',
        label: `Complaint ${complaint.complaintId} · ${complaintStatusLabel(complaint.status)}`,
        complaintId: complaint.complaintId,
    };
}

// ------------------------------------------------------------------
// Filter
// ------------------------------------------------------------------

export type ComplaintPresenceFilter = 'ALL' | 'CREATED' | 'NONE';

export const ADMIN_COMPLAINT_FILTERS: { value: ComplaintPresenceFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'CREATED', label: 'Complaint Created' },
    { value: 'NONE', label: 'No Complaint' },
];

export function adminComplaintFilterLabel(filter: ComplaintPresenceFilter): string {
    return ADMIN_COMPLAINT_FILTERS.find((option) => option.value === filter)?.label ?? 'All';
}

/**
 * The reports matching a complaint filter, in the order they arrived.
 *
 * 'ALL' returns the list untouched. Either other choice keeps only VERIFIED
 * issue reports — the only ones a complaint can exist for — so positive
 * feedback and undecided issues drop out of both:
 *
 *   CREATED  a complaint exists, whatever its status (Resolved included)
 *   NONE     no complaint exists yet
 *
 * While the complaints are loading or failed to load nothing can be told
 * apart, so nothing is kept rather than everything being guessed into one side.
 */
export function filterReportsByComplaint<T extends AccessibilityReport & { documentId?: string }>(
    reports: T[],
    filter: ComplaintPresenceFilter,
    index: ComplaintIndex
): T[] {
    if (filter === 'ALL') return reports;

    if (index.status !== 'ready') return [];

    return reports.filter((report) => {
        if (!canCreateComplaintFromReport(report)) return false;

        const hasComplaint = complaintForReport(report, index.byReport) !== null;

        return filter === 'CREATED' ? hasComplaint : !hasComplaint;
    });
}

