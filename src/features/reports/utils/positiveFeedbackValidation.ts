/**
 * The positive feedback form's rules, kept apart from the screen (MOV-300).
 *
 * Pure functions for the same reason reportFormValidation.ts is: what may be
 * submitted is decided entirely by what is filled in, and the project's Jest
 * setup tests logic rather than rendered screens.
 */

import {
    PositiveFeedbackCategory,
    PositiveFeedbackPayload,
} from '../../../entities/report/model/types';

/** Long enough for a short story, the same cap the issue form uses. */
export const POSITIVE_FEEDBACK_DESCRIPTION_MAX_LENGTH = 600;

/** What the form holds at the moment a decision is made about it. */
export interface PositiveFeedbackFormState {
    category: PositiveFeedbackCategory | null;
    description: string;
    /** Canonical route document id, never the display text. Optional. */
    routeId: string | null;
    /** Canonical bus document id, never the number plate. Optional. */
    busId: string | null;
}

/** The fields that can be missing, each with the message shown beside it. */
export type PositiveFeedbackFieldErrors = Partial<Record<'category' | 'description', string>>;

/**
 * Every required field that is not filled in yet.
 *
 * Only the category and the description are required. The route and bus stay
 * optional, unlike on an issue report: praise for an accessible bus stop is not
 * about any one bus, and asking for one would only make the form harder to
 * finish. An empty object means the feedback is ready to submit.
 */
export function positiveFeedbackFieldErrors(
    state: PositiveFeedbackFormState
): PositiveFeedbackFieldErrors {
    const errors: PositiveFeedbackFieldErrors = {};

    if (!state.category) {
        errors.category = 'Please choose what went well.';
    }

    if (!state.description.trim()) {
        errors.description = 'Please tell us a little about your experience.';
    }

    return errors;
}

/** The first missing field's message, in the order the form asks for them. */
export function firstMissingPositiveFeedbackField(
    state: PositiveFeedbackFormState
): string | null {
    const errors = positiveFeedbackFieldErrors(state);

    return errors.category ?? errors.description ?? null;
}

/**
 * The request body for this form, or null while it is incomplete.
 *
 * The description is trimmed and the optional ids are left out entirely when
 * nothing was picked, so the body never carries an empty string or a null the
 * backend would have to tell apart from a real value.
 */
export function buildPositiveFeedbackPayload(
    state: PositiveFeedbackFormState
): PositiveFeedbackPayload | null {
    if (!state.category || firstMissingPositiveFeedbackField(state)) return null;

    return {
        type: 'POSITIVE',
        category: state.category,
        description: state.description.trim(),
        ...(state.routeId ? { routeId: state.routeId } : {}),
        ...(state.busId ? { busId: state.busId } : {}),
    };
}
