/**
 * The report form's rules, kept apart from the screen that renders them.
 *
 * Extracted rather than inlined so the gating can be tested directly: whether
 * a report may be sent (and what to say under each field when it may not), and
 * whether the bus picker may open, are the things this form has to get right,
 * and all are pure functions of what is selected.
 */

import {
    ReportIssueCategory,
    ReportPhotoDraft,
} from '../../../entities/report/model/types';

/** What the form holds at the moment a decision is made about it. */
export interface ReportFormState {
    issueCategory: ReportIssueCategory | null;
    description: string;
    /** Canonical route document id, never the display text. */
    routeId: string | null;
    /** Canonical bus document id, never the number plate. */
    busId: string | null;
}

/**
 * Whether the bus picker may be opened.
 *
 * The route comes first: a passenger reports an issue on a journey, and the
 * journey is the route. This is an ordering rule for the form only — it does
 * not claim a bus belongs to a route, because the data model has no such
 * relationship, and the full fleet stays selectable once the gate is open.
 */
export function isBusSelectionUnlocked(routeId: string | null): boolean {
    return !!routeId;
}

/** The required fields, each with the message shown beside it when missing. */
export type ReportFieldErrors = Partial<
    Record<'issueCategory' | 'description' | 'routeId' | 'busId', string>
>;

/**
 * Every required field that is not filled in yet, keyed by field.
 *
 * What the form draws under each input once Submit has been tried — the
 * counterpart of positiveFeedbackFieldErrors. An empty object means the report
 * is ready to submit. Insertion order is the order the form asks for them, so
 * firstMissingReportField reads the same rules from here.
 */
export function reportFieldErrors(state: ReportFormState): ReportFieldErrors {
    const errors: ReportFieldErrors = {};

    if (!state.issueCategory) errors.issueCategory = 'Please select an issue category.';
    if (!state.description.trim()) {
        errors.description = 'Please provide a description of the issue.';
    }
    if (!state.routeId) errors.routeId = 'Please select the route you were travelling on.';
    if (!state.busId) errors.busId = 'Please select the bus you were travelling on.';

    return errors;
}

/**
 * The first missing field's message, in the order the form asks for them.
 *
 * Returns null when the report is ready to submit, so the caller can use it
 * both to gate the submission and to explain what is missing.
 */
export function firstMissingReportField(state: ReportFormState): string | null {
    const errors = reportFieldErrors(state);

    return errors.issueCategory ?? errors.description ?? errors.routeId ?? errors.busId ?? null;
}

/**
 * Whether Submit should be live.
 *
 * `isSubmitting` is part of the answer, not a separate check: a button that
 * stays pressable during an upload is how one report becomes three. `photos`
 * is the same — see photoUploadIssue.
 */
export function canSubmitReport(
    state: ReportFormState,
    isSubmitting: boolean,
    photos: Pick<ReportPhotoDraft, 'status'>[] = []
): boolean {
    return (
        !isSubmitting &&
        firstMissingReportField(state) === null &&
        photoUploadIssue(photos) === null
    );
}

/**
 * Whether the attached photos are ready to be submitted with the report.
 *
 * Photos upload as they are picked, so by submit time they are usually already
 * done — but a report must never be filed while one is still in flight or has
 * failed, because the document would then claim less evidence than the
 * passenger attached and there is no way to add it afterwards. Blocking is what
 * makes the retry on the thumbnail meaningful.
 *
 * Returns null when every photo has a URL, so the caller can use it both to
 * gate the button and to explain what it is waiting for.
 */
export function photoUploadIssue(
    photos: Pick<ReportPhotoDraft, 'status'>[]
): string | null {
    if (photos.some((photo) => photo.status === 'uploading')) {
        return 'Please wait for your photos to finish uploading.';
    }

    if (photos.some((photo) => photo.status === 'failed')) {
        return 'A photo could not be uploaded. Retry it or remove it, then submit.';
    }

    return null;
}

/**
 * The Cloudinary URLs to send with the report.
 *
 * Only uploaded photos have one, and only that URL is ever submitted — a local
 * `file://` uri on a stored report is a permanently broken photo.
 */
export function uploadedPhotoUrls(photos: ReportPhotoDraft[]): string[] {
    return photos
        .filter((photo) => photo.status === 'uploaded' && !!photo.url)
        .map((photo) => photo.url as string);
}
