/**
 * What a report says: its type, its category and its description (MOV-301).
 *
 * The reports collection holds two kinds of report — an accessibility ISSUE and
 * POSITIVE feedback — that share everything else: the author, the bus and route
 * references, the photos, the PENDING → VERIFIED / REJECTED lifecycle and the
 * admin review. What differs is only this part, so this is the one place that
 * reads it off a request body, for POST /api/reports and for
 * PUT /api/reports/[reportId] alike — the same arrangement reportReferences and
 * reportPhotos already use, so an edit can never accept a report its creation
 * would have refused.
 *
 * The two kinds keep separate category fields rather than sharing one:
 *
 *   ISSUE     { issueCategory: 'BROKEN_RAMP', … }             (no `type`)
 *   POSITIVE  { type: 'POSITIVE', category: 'HELPFUL_DRIVER', … }
 *
 * An issue report is stored exactly as it was before this module existed, and
 * `issueCategory` only ever holds an issue. A reader that counts issues by
 * `issueCategory` therefore cannot mistake praise for a fault, and a reader of
 * positive feedback (MOV-302) finds it by `type` without guessing from the
 * category's spelling.
 */

import {
    POSITIVE_FEEDBACK_CATEGORIES,
    PositiveFeedbackCategory,
    REPORT_TYPES,
    ReportIssueCategory,
    ReportType,
    isPositiveFeedbackCategory,
    isReportIssueCategory,
    isReportType,
} from '../../entities/report/model/types';

export type ReportContentValidation<T> = { ok: true; value: T } | { ok: false; message: string };

/** The fields an issue report stores for what it says. */
export interface IssueReportContent {
    issueCategory: ReportIssueCategory;
    description: string;
}

/** The fields positive feedback stores for what it says. */
export interface PositiveReportContent {
    type: 'POSITIVE';
    category: PositiveFeedbackCategory;
    description: string;
}

export type ReportContent = IssueReportContent | PositiveReportContent;

function invalid<T>(message: string): ReportContentValidation<T> {
    return { ok: false, message };
}

function isPresent(value: unknown): boolean {
    return value !== undefined && value !== null;
}

/**
 * The type a new report is being filed as, or why the request does not say.
 *
 * A body without `type` is an issue report: that is every client written
 * before positive feedback existed, and they must keep working unchanged. The
 * one exception is a body carrying `category` — the positive feedback field —
 * without a type, which is a positive submission that forgot to say so, and is
 * refused rather than guessed at.
 */
export function readRequestedReportType(body: Record<string, any>): ReportContentValidation<ReportType> {
    const { type } = body;

    if (!isPresent(type) || type === '') {
        if (isPresent(body.category)) {
            return invalid(`Report type is required. Expected one of ${REPORT_TYPES.join(', ')}.`);
        }

        return { ok: true, value: 'ISSUE' };
    }

    if (!isReportType(type)) {
        return invalid(`Report type must be one of ${REPORT_TYPES.join(', ')}.`);
    }

    return { ok: true, value: type };
}

/**
 * The description, trimmed, or why it cannot be stored. Shared wording with
 * the checks that have always guarded issue reports.
 */
function readDescription(description: unknown): ReportContentValidation<string> {
    if (typeof description !== 'string' || !description.trim()) {
        return invalid('Description cannot be empty.');
    }

    return { ok: true, value: description.trim() };
}

/**
 * The content of a report of the given type, or why it is not valid.
 *
 * The ISSUE branch applies the rules POST and PUT have always applied, in the
 * same order and with the same messages, so existing clients see no change.
 * Each branch refuses the other kind's category field: a request that names
 * both is confused, and storing either half of it would leave a document that
 * reads as one kind and carries the other's data.
 */
export function readReportContent(
    body: Record<string, any>,
    type: ReportType
): ReportContentValidation<ReportContent> {
    const { issueCategory, category, description } = body;

    if (type === 'POSITIVE') {
        if (isPresent(issueCategory)) {
            return invalid('Positive feedback cannot carry an issue category.');
        }

        if (!category || !description) {
            return invalid('Feedback category and description are required.');
        }

        if (!isPositiveFeedbackCategory(category)) {
            return invalid(
                `Invalid feedback category. Expected one of ${POSITIVE_FEEDBACK_CATEGORIES.join(', ')}.`
            );
        }

        const descriptionCheck = readDescription(description);

        if (!descriptionCheck.ok) return descriptionCheck;

        return {
            ok: true,
            value: { type: 'POSITIVE', category, description: descriptionCheck.value },
        };
    }

    if (isPresent(category)) {
        return invalid('An issue report cannot carry a feedback category.');
    }

    if (!issueCategory || !description) {
        return invalid('Issue category and description are required.');
    }

    // Checked against the entity model's list, which is the same list the
    // picker is built from — so a category can never be offered on screen and
    // refused here, or the reverse.
    if (!isReportIssueCategory(issueCategory)) {
        return invalid('Invalid issue category.');
    }

    const descriptionCheck = readDescription(description);

    if (!descriptionCheck.ok) return descriptionCheck;

    return { ok: true, value: { issueCategory, description: descriptionCheck.value } };
}
