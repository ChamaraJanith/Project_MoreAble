/**
 * Accessibility complaints: the server half (MOV-177).
 *
 * A complaint is opened by an admin from a report they have already VERIFIED,
 * and tracks getting the problem fixed. It lives in its own `complaints`
 * collection rather than on the report: the report is the record of what was
 * found and is never written to from here, and its status stays VERIFIED
 * whatever happens to the complaint.
 *
 * Everything the complaint needs from the report — the issue, the bus and the
 * route — is copied onto it at creation, because the passenger may later delete
 * their own report and the complaint has to keep reading correctly without it.
 *
 * This module covers creating and reading complaints. Moving one through
 * ASSIGNED, IN_PROGRESS and RESOLVED is MOV-178.
 */

import {
    COMPLAINT_INITIAL_STATUS,
    Complaint,
    ComplaintStatus,
    isComplaintStatus,
} from '../../entities/complaint/model/types';
import {
    isReportIssueCategory,
    reportTypeOf,
} from '../../entities/report/model/types';
import {
    AdminAuthorization,
    authenticateAdmin,
    reviewConflictError,
    reviewErrorResponse,
} from './reportAdminReview';
import { FeedbackValidation, REPORTS_COLLECTION, toIsoString } from './reportFeedback';

export const COMPLAINTS_COLLECTION = 'complaints';

/** The counter document CMP- ids are drawn from: `counters/complaints`. */
export const COMPLAINTS_COUNTER_ID = 'complaints';

/** The one report status a complaint may be opened from. */
export const COMPLAINT_SOURCE_REPORT_STATUS = 'VERIFIED';

/**
 * A complaint id as the counter mints it: CMP-00001, and past five digits once
 * the counter outgrows the padding. Anything else cannot name a complaint.
 */
const COMPLAINT_ID_PATTERN = /^CMP-\d{5,}$/;

/** Longer than any id this project mints; a guard, not a format. */
const MAX_ID_LENGTH = 128;

export const complaintCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function complaintErrorResponse(
    status: number,
    message: string,
    headers: Record<string, string> = complaintCorsHeaders
): Response {
    return reviewErrorResponse(status, message, headers);
}

// ------------------------------------------------------------------
// Authorisation
// ------------------------------------------------------------------

/**
 * The admin gate every complaint route passes through.
 *
 * `authenticateAdmin` decides it — 401 for no usable session, 403 for a
 * session that is not an admin — and only the wording of the 403 is replaced,
 * since the shared one speaks about reviewing reports.
 */
export async function authenticateComplaintAdmin(
    request: Request,
    headers: Record<string, string> = complaintCorsHeaders
): Promise<AdminAuthorization> {
    const auth = await authenticateAdmin(request, headers);

    if (auth.ok || auth.response.status !== 403) return auth;

    return {
        ok: false,
        response: complaintErrorResponse(
            403,
            'Only an administrator can manage complaints.',
            headers
        ),
    };
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

/**
 * A value that can safely address a Firestore document, trimmed.
 *
 * A '/' would make `.doc()` resolve to a different path, or throw — either way
 * a malformed request, answered as a 400 rather than a 500.
 */
function readDocumentId(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();

    if (!trimmed || trimmed.length > MAX_ID_LENGTH || trimmed.includes('/')) return null;

    return trimmed;
}

/** The report id in a create request body, or why there is not one. */
export function readCreateComplaintRequest(body: unknown): FeedbackValidation<{ reportId: string }> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, message: 'Invalid request body.' };
    }

    const { reportId } = body as Record<string, any>;

    if (reportId === undefined || reportId === null || reportId === '') {
        return { ok: false, message: 'Report ID is required.' };
    }

    const id = readDocumentId(reportId);

    if (!id) {
        return { ok: false, message: 'Invalid report ID.' };
    }

    return { ok: true, value: { reportId: id } };
}

/** Whether a value is shaped like a complaint id this project could have minted. */
export function isComplaintId(value: unknown): value is string {
    return typeof value === 'string' && COMPLAINT_ID_PATTERN.test(value);
}

export interface ComplaintListFilters {
    status: ComplaintStatus | null;
    assignedTo: string | null;
}

/**
 * The list filters on a query string, or why they cannot be applied.
 *
 * An unknown status is a 400 rather than an empty list, so a typo does not
 * read as "no complaints". A parameter given twice is refused too, rather than
 * one of its values being picked silently.
 */
export function readComplaintListFilters(
    searchParams: URLSearchParams
): FeedbackValidation<ComplaintListFilters> {
    const statuses = searchParams.getAll('status');
    const assignees = searchParams.getAll('assignedTo');

    if (statuses.length > 1) {
        return { ok: false, message: 'Only one status filter may be given.' };
    }

    if (assignees.length > 1) {
        return { ok: false, message: 'Only one assignedTo filter may be given.' };
    }

    let status: ComplaintStatus | null = null;

    if (statuses.length === 1) {
        const requested = statuses[0].trim();

        if (!isComplaintStatus(requested)) {
            return { ok: false, message: 'Invalid complaint status.' };
        }

        status = requested;
    }

    let assignedTo: string | null = null;

    if (assignees.length === 1) {
        const requested = readDocumentId(assignees[0]);

        if (!requested) {
            return { ok: false, message: 'Invalid assignedTo filter.' };
        }

        assignedTo = requested;
    }

    return { ok: true, value: { status, assignedTo } };
}

// ------------------------------------------------------------------
// Creating a complaint
// ------------------------------------------------------------------

/**
 * Whether a report can have a complaint opened from it, or why not.
 *
 * Positive feedback is refused first: praise can never become a complaint,
 * whatever state it reached, whereas a PENDING issue report merely has not
 * been verified yet. Both are 409 — the request is well formed; it is the
 * report that is in the wrong state for it.
 */
export function canOpenComplaint(
    report: Record<string, any>
): { ok: true } | { ok: false; status: number; message: string } {
    if (reportTypeOf(report) !== 'ISSUE') {
        return {
            ok: false,
            status: 409,
            message: 'A complaint can only be created from an accessibility issue report.',
        };
    }

    if (report.status !== COMPLAINT_SOURCE_REPORT_STATUS) {
        const current = typeof report.status === 'string' && report.status ? report.status : 'PENDING';

        return {
            ok: false,
            status: 409,
            message: `A complaint can only be created from a VERIFIED report (this report is ${current}).`,
        };
    }

    if (!isReportIssueCategory(report.issueCategory)) {
        return {
            ok: false,
            status: 409,
            message: 'This report has no valid issue category to raise a complaint about.',
        };
    }

    return { ok: true };
}

/**
 * The complaint a report opens, before it has an id.
 *
 * An allow-list of what is copied: the issue and the bus and route references,
 * each reference only as a whole pair and only when the report carries it — so
 * the complaint omits a key the report did not have rather than storing null.
 * Nothing about the passenger who filed the report is copied.
 */
export function buildComplaintFromReport(
    report: Record<string, any>,
    complaintId: string,
    reportId: string,
    createdBy: string,
    now: Date = new Date()
): Complaint {
    const hasBus = typeof report.busId === 'string' && report.busId;
    const hasRoute = typeof report.routeId === 'string' && report.routeId;

    return {
        complaintId,
        reportId,
        status: COMPLAINT_INITIAL_STATUS,

        issueCategory: report.issueCategory,
        description: typeof report.description === 'string' ? report.description : '',

        ...(hasBus ? { busId: report.busId } : {}),
        ...(hasBus && report.vehicle ? { vehicle: report.vehicle } : {}),
        ...(hasRoute ? { routeId: report.routeId } : {}),
        ...(hasRoute && report.route ? { route: report.route } : {}),

        createdBy,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Opens a complaint from a report, atomically.
 *
 * One transaction re-reads the report, looks for an existing complaint on it,
 * draws the next CMP- id from `counters/complaints` and writes the complaint.
 * Every creation reads and writes that same counter document, so two admins
 * opening a complaint at once are serialised by Firestore: the one that loses
 * is retried, and on the retry its duplicate check sees the complaint the other
 * one committed. A check made before the transaction would pass for both.
 *
 * The report is only read, never written.
 *
 * A report that is missing, in the wrong state, or already has a complaint is
 * raised as the tagged conflict error the review transaction uses, carrying
 * the status the route should answer with.
 */
export async function createComplaintFromReport(
    adminDb: any,
    reportId: string,
    createdBy: string
): Promise<Complaint> {
    const reportRef = adminDb.collection(REPORTS_COLLECTION).doc(reportId);
    const existingQuery = adminDb
        .collection(COMPLAINTS_COLLECTION)
        .where('reportId', '==', reportId)
        .limit(1);
    const counterRef = adminDb.collection('counters').doc(COMPLAINTS_COUNTER_ID);

    return adminDb.runTransaction(async (transaction: any) => {
        // Every read comes before any write, as a Firestore transaction requires.
        const reportDoc = await transaction.get(reportRef);

        if (!reportDoc.exists) {
            throw reviewConflictError('Report not found.', 404);
        }

        const report = reportDoc.data() ?? {};
        const openable = canOpenComplaint(report);

        if (!openable.ok) {
            throw reviewConflictError(openable.message, openable.status);
        }

        const existing = await transaction.get(existingQuery);

        if (!existing.empty) {
            const existingId = existing.docs[0]?.id;

            throw reviewConflictError(
                existingId
                    ? `A complaint already exists for this report (${existingId}).`
                    : 'A complaint already exists for this report.',
                409
            );
        }

        const counterDoc = await transaction.get(counterRef);

        let nextNumber = 1;

        if (counterDoc.exists) {
            nextNumber = Number(counterDoc.data()?.lastNumber || 0) + 1;
        }

        const complaintId = `CMP-${String(nextNumber).padStart(5, '0')}`;

        transaction.set(
            counterRef,
            { lastNumber: nextNumber, updatedAt: new Date() },
            { merge: true }
        );

        const complaint = buildComplaintFromReport(report, complaintId, reportId, createdBy);

        transaction.set(
            adminDb.collection(COMPLAINTS_COLLECTION).doc(complaintId),
            complaint
        );

        return complaint;
    });
}

// ------------------------------------------------------------------
// Reading complaints
// ------------------------------------------------------------------

/** A complaint as the API sends it: the stored record, timestamps as ISO strings. */
export type SerializedComplaint = Omit<Complaint, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};

const OPTIONAL_COMPLAINT_FIELDS = [
    'busId',
    'vehicle',
    'routeId',
    'route',
    'assignedTo',
    'assignedToName',
    'assignedBy',
    'assignedAt',
    'startedAt',
    'resolvedBy',
    'resolvedAt',
    'resolutionNote',
] as const;

const COMPLAINT_TIMESTAMP_FIELDS = new Set(['assignedAt', 'startedAt', 'resolvedAt']);

/**
 * One stored complaint, ready to send.
 *
 * Built field by field rather than spread, so the response carries exactly the
 * complaint's own keys whatever else a document picks up. Optional fields stay
 * absent when they were never written.
 */
export function serializeComplaint(
    data: Record<string, any>,
    documentId: string
): SerializedComplaint {
    const complaint: Record<string, any> = {
        complaintId: data?.complaintId ?? documentId,
        reportId: data?.reportId,
        status: data?.status,
        issueCategory: data?.issueCategory,
        description: data?.description,
    };

    for (const field of OPTIONAL_COMPLAINT_FIELDS) {
        const value = data?.[field];

        if (value === undefined || value === null || value === '') continue;

        complaint[field] = COMPLAINT_TIMESTAMP_FIELDS.has(field) ? toIsoString(value) : value;
    }

    complaint.createdBy = data?.createdBy;
    complaint.createdAt = toIsoString(data?.createdAt);
    complaint.updatedAt = toIsoString(data?.updatedAt);

    return complaint as SerializedComplaint;
}

/** A createdAt as a sortable number; one that cannot be read sorts last. */
function sortableTime(value: unknown): number {
    const time = new Date(toIsoString(value)).getTime();

    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * Every complaint matching the filters, newest first.
 *
 * At most one equality filter goes to Firestore, which its automatic
 * single-field indexes answer; ordering, and the second filter when both are
 * given, are applied to what comes back. Adding an orderBy on another field to
 * a filtered query would need a composite index — the same reason
 * GET /api/reports sorts a filtered scope after the fact.
 */
export async function listComplaints(
    adminDb: any,
    filters: ComplaintListFilters
): Promise<SerializedComplaint[]> {
    let query: any = adminDb.collection(COMPLAINTS_COLLECTION);

    if (filters.status) {
        query = query.where('status', '==', filters.status);
    } else if (filters.assignedTo) {
        query = query.where('assignedTo', '==', filters.assignedTo);
    }

    const snapshot = await query.get();

    return snapshot.docs
        .map((doc: any) => serializeComplaint(doc.data() ?? {}, doc.id))
        .filter(
            (complaint: SerializedComplaint) =>
                (!filters.status || complaint.status === filters.status) &&
                (!filters.assignedTo || complaint.assignedTo === filters.assignedTo)
        )
        .sort(
            (first: SerializedComplaint, second: SerializedComplaint) =>
                sortableTime(second.createdAt) - sortableTime(first.createdAt)
        );
}

/**
 * The source report as it stands now, for the complaint detail view.
 *
 * An allow-list: the report's content, references, photos and review — not the
 * passenger who filed it, and not the community tallies, which say nothing
 * about the complaint.
 */
export function serializeComplaintSourceReport(data: Record<string, any>, documentId: string) {
    const fields = [
        'status',
        'issueCategory',
        'description',
        'busId',
        'vehicle',
        'routeId',
        'route',
        'photoUrls',
        'reviewedBy',
        'adminRemark',
    ] as const;

    const report: Record<string, any> = { reportId: data?.reportId ?? documentId };

    for (const field of fields) {
        const value = data?.[field];

        if (value !== undefined && value !== null && value !== '') report[field] = value;
    }

    if (data?.reviewedAt) report.reviewedAt = toIsoString(data.reviewedAt);

    report.createdAt = toIsoString(data?.createdAt);
    report.updatedAt = toIsoString(data?.updatedAt);

    return report;
}

/**
 * One complaint, plus its source report if that still exists.
 *
 * `null` when the complaint does not exist. `sourceReport` is null when the
 * report has since been deleted; the complaint carries its own copy of what it
 * needs, so it stays complete either way.
 */
export async function readComplaintDetail(
    adminDb: any,
    complaintId: string
): Promise<{ complaint: SerializedComplaint; sourceReport: Record<string, any> | null } | null> {
    const complaintDoc = await adminDb.collection(COMPLAINTS_COLLECTION).doc(complaintId).get();

    if (!complaintDoc.exists) return null;

    const complaint = serializeComplaint(complaintDoc.data() ?? {}, complaintDoc.id ?? complaintId);

    const reportId = readDocumentId(complaint.reportId);

    if (!reportId) return { complaint, sourceReport: null };

    const reportDoc = await adminDb.collection(REPORTS_COLLECTION).doc(reportId).get();

    return {
        complaint,
        sourceReport: reportDoc.exists
            ? serializeComplaintSourceReport(reportDoc.data() ?? {}, reportId)
            : null,
    };
}
