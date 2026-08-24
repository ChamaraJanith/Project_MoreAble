/**
 * Searching the report lists, on the device (MOV-272).
 *
 * The passenger tabs and the admin review queue both draw a list they already
 * hold: GET /api/reports answers the whole slice in one request, and every
 * narrowing that matters to the backend — the scope, the review flag, the
 * status — is already a parameter on it. So a search box here filters what has
 * arrived rather than asking for it again: a keystroke is not a round trip, and
 * the API contract is untouched.
 *
 * It lives in a plain module for the reason the rest of this folder does. Jest
 * here is node-only with no renderer, so a rule in a module can be tested and
 * the same rule inside a component cannot.
 */

import { AccessibilityReport } from '../../../entities/report/model/types';
import { reportCategoryLabel } from '../ui/reportCategories';
import { reportStatusLabel } from './reportFormat';

/** One wording for the box, on both screens. */
export const REPORT_SEARCH_PLACEHOLDER = 'Search reports...';

/**
 * Everything about a report that typing can find it by.
 *
 * The same values the card puts on screen — what the issue is, which bus and
 * route it was filed against, what was written about it, where the review got
 * to — so a passenger searching for what they can see finds it.
 *
 * The report id is deliberately not among them, for the reason it is not on the
 * card either: it is how a report is addressed, not a reference number anybody
 * is asked to quote. The passenger id is left out because it names nobody on
 * screen and is not something to be looked up by.
 */
export function reportSearchFields(report: AccessibilityReport): string[] {
    return [
        // The issue, both as it reads on the card and as it is stored, so
        // "ramp" finds BROKEN_RAMP whichever half of the pair the passenger
        // has seen.
        reportCategoryLabel(report.issueCategory),
        report.issueCategory,
        report.description,
        // Prefer the snapshot taken when the report was filed, exactly as the
        // card does, and fall back to the raw id so a report whose snapshot is
        // missing is still findable by its bus or route.
        report.vehicle?.numberPlate,
        report.vehicle?.busModel,
        report.vehicle?.manufacturer,
        report.busId,
        report.route?.routeNumber,
        report.route?.routeName,
        report.routeId,
        reportStatusLabel(typeof report.status === 'string' ? report.status : ''),
    ].filter((value): value is string => typeof value === 'string' && value.trim() !== '');
}

/**
 * What was typed, as the words to match on.
 *
 * Split rather than matched whole, so "138 ramp" finds the broken ramp on route
 * 138 — the two words are on the card, but never next to each other in any one
 * field. Empty for a box holding nothing but spaces, which is what makes a
 * cleared search show everything again.
 */
export function reportSearchTerms(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether this report answers what was typed.
 *
 * Every word has to be found somewhere on the report, though not all in the
 * same field: typing more narrows the list, which is what typing more is for.
 * An empty query matches everything rather than nothing.
 */
export function reportMatchesSearch(report: AccessibilityReport, query: string): boolean {
    const terms = reportSearchTerms(query);

    if (terms.length === 0) return true;

    const haystack = reportSearchFields(report).join(' ').toLowerCase();

    return terms.every((term) => haystack.includes(term));
}

/**
 * The reports to draw for this search, in the order the API returned them.
 *
 * Generic over the report so the admin queue keeps its own extra fields —
 * `documentId` above all, which is what its rows are opened by — instead of
 * being widened back down to a passenger report on the way through.
 */
export function filterReportsBySearch<T extends AccessibilityReport>(
    reports: T[],
    query: string
): T[] {
    if (reportSearchTerms(query).length === 0) return reports;

    return reports.filter((report) => reportMatchesSearch(report, query));
}
