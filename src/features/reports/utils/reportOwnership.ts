/**
 * Who may edit or delete a report, and while it is in what state.
 *
 * The app asks this to decide which controls to draw. It is not the rule — the
 * rule is enforced by PUT and DELETE /api/reports/[reportId], which compare the
 * report's passengerId against the verified token (403 for anybody else), and
 * PUT additionally its status against the review it has already had (409 once
 * decided), regardless of what the app chose to render. What this file does is make sure the app never offers an
 * action the API is going to refuse.
 */

import { isReportDecided } from '../../../entities/report/model/types';

/** Just enough of a report to decide who owns it and whether it is still open. */
export interface OwnableReport {
    passengerId: string;
    /**
     * Widened for the same reason `AccessibilityReport.status` is: a state the
     * backend introduces later still has to be read as "decided" here rather
     * than fall through to editable. Optional because a report is PENDING when
     * it says nothing, which is what `isReportDecided` reads it as.
     */
    status?: unknown;
    /** ISSUE when absent; see reportTypeOf. */
    type?: unknown;
}

/**
 * Whether this passenger filed this report.
 *
 * A missing passengerId on either side is not a match: an unauthenticated
 * session owns nothing, and a report with no author is not everybody's.
 */
export function isReportOwnedBy(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    if (!report?.passengerId || !passengerId) return false;

    return report.passengerId === passengerId;
}

/**
 * Whether a report's content can still be changed at all, by anybody.
 *
 * Only while it is waiting to be decided. Once an admin has verified or
 * rejected it the report is the thing that was decided: editing the account
 * afterwards would leave a remark answering a description that no longer says
 * what it answered.
 *
 * Deleting is a different question — see canDeleteReport. Ownership is also a
 * separate question, asked alongside this one rather than folded into it, so
 * the details screen can tell the author of a verified report why Edit is gone
 * rather than showing the same nothing as somebody else's report.
 */
export function isReportOpenToChange(report: OwnableReport | null | undefined): boolean {
    return !!report && !isReportDecided(report);
}

/**
 * Whether the Edit control belongs on screen.
 *
 * Editing is the author's alone, and only before their report is decided. A
 * report still under review is editable — correcting a description is exactly
 * what a passenger asked for more detail has to do — but a verified or rejected
 * one is not. Issue reports open the issue form and positive feedback opens
 * the feedback form, so both kinds are editable while pending.
 */
export function canEditReport(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    return isReportOwnedBy(report, passengerId) && isReportOpenToChange(report);
}

/**
 * Whether the Delete control belongs on screen.
 *
 * The author's alone, in any state: a passenger may always withdraw what they
 * filed — pending, verified or rejected. Nobody else's report is ever theirs to
 * delete. DELETE /api/reports/[reportId] enforces the same rule.
 */
export function canDeleteReport(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    return isReportOwnedBy(report, passengerId);
}

/**
 * Why a decided report can no longer be edited, in words — or null while it
 * still can be. Shown to the author on the details screen in place of Edit.
 */
export function reportEditLockedMessage(report: OwnableReport | null | undefined): string | null {
    if (!report || isReportOpenToChange(report)) return null;

    const status = typeof report.status === 'string' ? report.status : '';

    if (status === 'VERIFIED') return 'Verified reports can no longer be edited.';
    if (status === 'REJECTED') return 'Rejected reports can no longer be edited.';

    return 'Reviewed reports can no longer be edited.';
}

/** What a report offers this session, in the order the controls are shown. */
export type ReportAction = 'view' | 'edit' | 'delete';

/**
 * The actions to render for one report.
 *
 * Viewing is always offered: All Reports shows every passenger's reports
 * already, so opening one adds no access — and the author of a decided report
 * is left with exactly that, which is the point of the decision.
 */
export function reportActionsFor(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): ReportAction[] {
    const actions: ReportAction[] = ['view'];

    if (canEditReport(report, passengerId)) actions.push('edit');
    if (canDeleteReport(report, passengerId)) actions.push('delete');

    return actions;
}
