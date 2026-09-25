/**
 * The client half of Complaint Management (MOV-176).
 *
 * Calls against the endpoints MOV-177 and MOV-178 built: list and read
 * complaints, open one from a verified report, and move one through its
 * workflow.
 *
 * It does NOT go through `adminFetch`, which sends no Authorization header:
 * every complaint route is admin-only, and an anonymous request is refused 401.
 * The pattern followed is reportReviewApi's — the session token goes on each
 * request, and a failure comes back with the HTTP status beside the message,
 * so the screen can tell an expired session from a complaint another admin
 * moved first.
 *
 * Every workflow call names an ACTION. There is deliberately no way to send a
 * status: what START does to a complaint is the route's to decide. Nor is any
 * actor id sent — the route takes the admin from the verified token.
 */

import { API_BASE_URL } from '../../../shared/api/config';
import {
    AdminComplaint,
    ComplaintSourceReport,
    ComplaintStatusFilter,
    complaintListQuery,
} from '../utils/complaintWorkflow';

/**
 * What a complaint call produced, or why it did not.
 *
 * The same shape reportReviewApi returns, with the response status carried on
 * the failure.
 */
export type ComplaintResult<T> =
    | { ok: true; value: T }
    | { ok: false; message: string; status?: number };

/** One complaint, with the report it was opened from as that report stands now. */
export interface ComplaintDetail {
    complaint: AdminComplaint;
    /** Null once the passenger has deleted the report. */
    sourceReport: ComplaintSourceReport | null;
}

/** What a workflow action left behind. */
export interface ComplaintActionOutcome {
    complaint: AdminComplaint;
    /** The API's own acknowledgement, e.g. "Complaint marked IN_PROGRESS." */
    message: string;
}

export interface ComplaintListFilters {
    status?: ComplaintStatusFilter;
    /** A user document id, e.g. ADM-2026-00001. */
    assignedTo?: string | null;
}

const COMPLAINTS_PATH = '/api/complaints';

function complaintPath(complaintId: string): string {
    return `${COMPLAINTS_PATH}/${encodeURIComponent(complaintId)}`;
}

function authHeaders(token: string, hasBody: boolean): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    };
}

function failureMessage(payload: any, fallback: string): string {
    return typeof payload?.message === 'string' && payload.message ? payload.message : fallback;
}

function isComplaint(value: unknown): value is AdminComplaint {
    return (
        !!value &&
        typeof value === 'object' &&
        typeof (value as any).complaintId === 'string' &&
        typeof (value as any).status === 'string'
    );
}

/**
 * One request, answered as a result.
 *
 * `read` pulls the value out of a successful payload, and returns null when the
 * payload does not hold what the caller needs — which is answered as a failure
 * rather than handed on as a half-formed complaint.
 */
async function request<T>(
    path: string,
    token: string,
    init: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
    fallback: string,
    read: (payload: any) => T | null
): Promise<ComplaintResult<T>> {
    try {
        const hasBody = init.body !== undefined;
        const response = await fetch(`${API_BASE_URL}${path}`, {
            method: init.method,
            headers: authHeaders(token, hasBody),
            ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
        });

        const payload = await response.json().catch(() => ({}));
        const value = response.ok && payload?.success ? read(payload) : null;

        if (value === null) {
            return {
                ok: false,
                status: response.status,
                message: failureMessage(payload, fallback),
            };
        }

        return { ok: true, value };
    } catch (error) {
        console.error('Complaint API Error:', error);

        return { ok: false, message: fallback };
    }
}

/**
 * GET /api/complaints
 *
 * Newest first. Both filters are the API's own query parameters.
 */
export function getComplaints(
    token: string,
    filters: ComplaintListFilters = {}
): Promise<ComplaintResult<AdminComplaint[]>> {
    return request(
        `${COMPLAINTS_PATH}${complaintListQuery(filters)}`,
        token,
        { method: 'GET' },
        'Failed to load complaints.',
        (payload) =>
            Array.isArray(payload.complaints) ? payload.complaints.filter(isComplaint) : null
    );
}

/** GET /api/complaints/:complaintId */
export function getComplaint(
    complaintId: string,
    token: string
): Promise<ComplaintResult<ComplaintDetail>> {
    return request(
        complaintPath(complaintId),
        token,
        { method: 'GET' },
        'Failed to load the complaint.',
        (payload) =>
            isComplaint(payload.complaint)
                ? {
                      complaint: payload.complaint,
                      sourceReport:
                          payload.sourceReport && typeof payload.sourceReport === 'object'
                              ? (payload.sourceReport as ComplaintSourceReport)
                              : null,
                  }
                : null
    );
}

/**
 * POST /api/complaints
 *
 * Opens a complaint from a VERIFIED issue report. The body names the report and
 * nothing else; the report itself is left exactly as it was.
 */
export function createComplaint(
    reportId: string,
    token: string
): Promise<ComplaintResult<ComplaintActionOutcome>> {
    return request(
        COMPLAINTS_PATH,
        token,
        { method: 'POST', body: { reportId } },
        'Failed to create the complaint.',
        (payload) =>
            isComplaint(payload.complaint)
                ? { complaint: payload.complaint, message: failureMessage(payload, 'Complaint created.') }
                : null
    );
}

/** PATCH /api/complaints/:complaintId with one action body. */
function runComplaintAction(
    complaintId: string,
    token: string,
    body: Record<string, string>
): Promise<ComplaintResult<ComplaintActionOutcome>> {
    return request(
        complaintPath(complaintId),
        token,
        { method: 'PATCH', body },
        'Failed to update the complaint.',
        (payload) =>
            isComplaint(payload.complaint)
                ? { complaint: payload.complaint, message: failureMessage(payload, 'Complaint updated.') }
                : null
    );
}

/** ASSIGN — PENDING to ASSIGNED. `assignedTo` is the admin's user document id. */
export function assignComplaint(complaintId: string, assignedTo: string, token: string) {
    return runComplaintAction(complaintId, token, { action: 'ASSIGN', assignedTo });
}

/** REASSIGN — a different admin, the status left as it is. */
export function reassignComplaint(complaintId: string, assignedTo: string, token: string) {
    return runComplaintAction(complaintId, token, { action: 'REASSIGN', assignedTo });
}

/** START — ASSIGNED to IN_PROGRESS. */
export function startComplaint(complaintId: string, token: string) {
    return runComplaintAction(complaintId, token, { action: 'START' });
}

/** RESOLVE — IN_PROGRESS to RESOLVED, with the note the API requires. */
export function resolveComplaint(complaintId: string, resolutionNote: string, token: string) {
    return runComplaintAction(complaintId, token, { action: 'RESOLVE', resolutionNote });
}
