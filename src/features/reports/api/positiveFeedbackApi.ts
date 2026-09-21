/**
 * The client half of positive accessibility feedback (MOV-300).
 *
 * The screen calls submitPositiveFeedback and nothing else, so connecting the
 * real endpoint in MOV-301 is a change to this file alone.
 *
 * There is no backend for it yet, and POST /api/reports cannot stand in: it
 * validates `issueCategory` against the ISSUE categories and would refuse every
 * positive one with a 400. Until MOV-301 lands, a development build simulates a
 * successful submission so the whole flow can be walked through, and a release
 * build answers with an honest "not available yet" — a passenger must never be
 * thanked for feedback that was not stored anywhere.
 */

import { PositiveFeedbackPayload } from '../../../entities/report/model/types';

/** What a submission produced, or why it did not — the shape reviewApi uses. */
export type PositiveFeedbackResult =
    | { ok: true }
    | { ok: false; message: string; status?: number };

export const POSITIVE_FEEDBACK_UNAVAILABLE_MESSAGE =
    'Positive feedback cannot be sent just yet. Please try again after the next app update.';

export interface SubmitPositiveFeedbackOptions {
    /**
     * Whether to pretend the request succeeded. Defaults to development builds
     * only; tests pass it explicitly.
     */
    simulate?: boolean;
}

/** Stands in for network latency, so the loading state is visible in dev. */
const SIMULATED_DELAY_MS = 800;

function isDevelopmentBuild(): boolean {
    // `__DEV__` is defined by the React Native bundler and absent under Jest.
    return typeof __DEV__ !== 'undefined' && __DEV__;
}

/**
 * Submits one piece of positive feedback on behalf of the session.
 *
 * MOV-301: replace the body below the token check with the real request —
 * `POST` the payload with `Authorization: Bearer ${token}` — and map 401/403/
 * 400 the way ReportFormScreen does for issue reports. The signature and the
 * result shape should stay as they are, so the screen needs no change.
 */
export async function submitPositiveFeedback(
    payload: PositiveFeedbackPayload,
    token: string,
    options: SubmitPositiveFeedbackOptions = {}
): Promise<PositiveFeedbackResult> {
    if (!token) {
        return { ok: false, status: 401, message: 'Authentication required. Please log in again.' };
    }

    const simulate = options.simulate ?? isDevelopmentBuild();

    if (!simulate) {
        return { ok: false, status: 501, message: POSITIVE_FEEDBACK_UNAVAILABLE_MESSAGE };
    }

    await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));
    console.log('[MOV-300] Simulated positive feedback submission:', payload);

    return { ok: true };
}
