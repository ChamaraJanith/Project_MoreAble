/**
 * Who may edit or delete a report, and while it is in what state.
 *
 * The app asks this to decide which controls to draw. It is not the rule — the
 * rule is enforced by PUT and DELETE /api/reports/[reportId], which compare the
 * report's passengerId against the verified token and its status against the
 * review it has already had, answering 403 or 409 regardless of what the app
 * chose to render. What this file does is make sure the app never offers an
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
 * Whether a report can still be changed at all, by anybody.
 *
 * Only while it is waiting to be decided. Once an admin has verified or
 * rejected it the report is the thing that was decided: editing the account
 * afterwards would leave a remark answering a description that no longer says
 * what it answered, and deleting it would take a verified finding — and the
 * rejection its author is owed — out of the record.
 *
 * Ownership is a separate question, asked alongside this one rather than
 * folded into it, so the details screen can tell the author of a verified
 * report why the buttons are gone from somebody else's report having none.
 */
export function isReportOpenToChange(report: OwnableReport | null | undefined): boolean {
    return !!report && !isReportDecided(report);
}

/**
 * Whether the Edit control belongs on screen.
 *
 * Editing is the author's alone, and only before their report is decided. A
 * report still under review is editable — correcting a description is exactly
 * what a passenger asked for more detail has to do — but a verified one is not.
 */
export function canEditReport(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    return isReportOwnedBy(report, passengerId) && isReportOpenToChange(report);
}

/** Whether the Delete control belongs on screen. The same two conditions. */
export function canDeleteReport(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    return isReportOwnedBy(report, passengerId) && isReportOpenToChange(report);
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
