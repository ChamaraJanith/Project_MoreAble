/**
 * The client half of positive accessibility feedback (MOV-300 / MOV-301).
 *
 * Positive feedback is a report of type POSITIVE, so it is filed through the
 * same POST /api/reports the issue form uses — same collection, same REP- id,
 * same PENDING start. The route tells the two apart by the `type` in the body;
 * see shared/server/reportContent.
 *
 * The screen calls submitPositiveFeedback and nothing else. The session token
 * is the only identity sent: the route takes the passenger from it, so there
 * is deliberately no passengerId in the payload.
 */

import {
    AccessibilityReport,
    PositiveFeedbackPayload,
} from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { reportApiPath } from '../utils/reportRoutes';

/** What a submission produced, or why it did not — the shape reviewApi uses. */
export type PositiveFeedbackResult =
    | { ok: true; report: AccessibilityReport }
    | { ok: false; message: string; status?: number };

const AUTH_REQUIRED_MESSAGE = 'Authentication required. Please log in again.';

/**
 * The message for a refused request.
 *
 * The API's own wording is preferred for a 400 or 404 — it is the one that
 * knows whether the category or the bus was the problem — and the rest map to
 * the same messages the issue form shows for the same statuses.
 */
function failureMessage(status: number, payload: any, action: 'submit' | 'update' = 'submit'): string {
    const apiMessage =
        typeof payload?.message === 'string' && payload.message ? payload.message : null;

    if (status === 401) return AUTH_REQUIRED_MESSAGE;
    if (status === 403) {
        return action === 'update'
            ? 'You can only edit your own feedback.'
            : 'Only passengers can submit accessibility feedback.';
    }
    if (status === 400 || status === 404) {
        return apiMessage ?? 'Invalid request. Please check your inputs.';
    }
    // The feedback was reviewed while the form was open. The API names the
    // status it reached, which says more than a generic retry prompt.
    if (status === 409) {
        return apiMessage ?? 'This feedback has already been reviewed and can no longer be edited.';
    }

    return action === 'update'
        ? 'Unable to save your changes right now. Please try again.'
        : 'Unable to submit your feedback right now. Please try again.';
}

/** POST /api/reports with `type: 'POSITIVE'`. */
export async function submitPositiveFeedback(
    payload: PositiveFeedbackPayload,
    token: string
): Promise<PositiveFeedbackResult> {
    if (!token) {
        return { ok: false, status: 401, message: AUTH_REQUIRED_MESSAGE };
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));

        // Success is the stored report coming back, not merely a 2xx: a
        // response without it is not proof anything was written, and the
        // passenger must never be thanked for feedback that was not saved.
        if (response.ok && result?.success && result?.report?.reportId) {
            return { ok: true, report: result.report as AccessibilityReport };
        }

        const status = response.ok ? 500 : response.status;

        return { ok: false, status, message: failureMessage(status, result) };
    } catch (error) {
        console.error('Positive Feedback Submission Error:', error);

        return {
            ok: false,
            message: 'Unable to connect to the server. Please check your connection and try again.',
        };
    }
}

/**
 * PUT /api/reports/:reportId with `type: 'POSITIVE'` — editing the author's own
 * pending feedback. The route checks the token against the author (403) and
 * refuses a report that has already been reviewed (409), whatever the app drew.
 */
export async function updatePositiveFeedback(
    reportId: string,
    payload: PositiveFeedbackPayload,
    token: string
): Promise<PositiveFeedbackResult> {
    if (!token) {
        return { ok: false, status: 401, message: AUTH_REQUIRED_MESSAGE };
    }

    try {
        const response = await fetch(`${API_BASE_URL}${reportApiPath(reportId)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok && result?.success && result?.report?.reportId) {
            return { ok: true, report: result.report as AccessibilityReport };
        }

        const status = response.ok ? 500 : response.status;

        return { ok: false, status, message: failureMessage(status, result, 'update') };
    } catch (error) {
        console.error('Positive Feedback Update Error:', error);

        return {
            ok: false,
            message: 'Unable to connect to the server. Please check your connection and try again.',
        };
    }
}
