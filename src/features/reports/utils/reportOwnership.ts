/**
 * Who may edit or delete a report.
 *
 * The app asks this to decide which controls to draw. It is not the rule — the
 * rule is enforced by PUT and DELETE /api/reports/[reportId], which compare the
 * report's passengerId against the verified token and answer 403 regardless of
 * what the app chose to render. What this file does is make sure the app never
 * offers an action the API is going to refuse.
 */

/** Just enough of a report to decide who owns it. */
export interface OwnableReport {
    passengerId: string;
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
 * Whether the Edit control belongs on screen.
 *
 * Editing is the author's alone. A report under review is still editable —
 * correcting a description is exactly what a passenger asked for more detail
 * would need to do — so status is deliberately not part of this.
 */
export function canEditReport(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    return isReportOwnedBy(report, passengerId);
}

/** Whether the Delete control belongs on screen. The author's alone, too. */
export function canDeleteReport(
    report: OwnableReport | null | undefined,
    passengerId: string | null | undefined
): boolean {
    return isReportOwnedBy(report, passengerId);
}

/** What a report offers this session, in the order the controls are shown. */
export type ReportAction = 'view' | 'edit' | 'delete';

/**
 * The actions to render for one report.
 *
 * Viewing is always offered: All Reports shows every passenger's reports
 * already, so opening one adds no access. Editing and deleting are the author's.
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
