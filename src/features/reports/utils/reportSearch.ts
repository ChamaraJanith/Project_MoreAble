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

import {
    AccessibilityReport,
    ReportType,
    reportDecisionStatus,
    reportTypeOf,
} from '../../../entities/report/model/types';
import {
    POSITIVE_FEEDBACK_CATEGORY_OPTIONS,
    positiveFeedbackCategoryLabel,
} from '../ui/positiveFeedbackCategories';
import { REPORT_CATEGORY_OPTIONS, reportCategoryLabel } from '../ui/reportCategories';
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
    const isPositive = reportTypeOf(report) === 'POSITIVE';

    return [
        // The category, both as it reads on the card and as it is stored, so
        // "ramp" finds BROKEN_RAMP whichever half of the pair the passenger
        // has seen. Positive feedback keeps its category in `category`.
        ...(isPositive
            ? [
                  positiveFeedbackCategoryLabel(report.category ?? ''),
                  report.category,
                  'Positive feedback',
              ]
            : [reportCategoryLabel(report.issueCategory), report.issueCategory]),
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

// ==================================================================
// Filters and sort (the passenger list's filter sheet)
//
// Applied to the list already on the device, after the search, for the same
// reason the search is: the tab's slice is what the API was asked for, and
// narrowing it further is not another question to ask it. Everything offered
// comes from the project's own vocabularies — the two category lists, the
// stored statuses, and the routes the loaded reports actually name.
// ==================================================================

export type ReportTypeFilter = 'ALL' | ReportType;
export type ReportStatusFilter = 'ALL' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ReportSortOrder = 'NEWEST' | 'OLDEST' | 'MOST_AGREED' | 'MOST_DISCUSSED';

export interface ReportListFilters {
    type: ReportTypeFilter;
    /** An issue or positive feedback category value, or null for all. */
    category: string | null;
    /** A canonical route id, or null for all. */
    routeId: string | null;
    status: ReportStatusFilter;
    sort: ReportSortOrder;
}

export const DEFAULT_REPORT_FILTERS: ReportListFilters = {
    type: 'ALL',
    category: null,
    routeId: null,
    status: 'ALL',
    sort: 'NEWEST',
};

export interface ReportFilterOption<T extends string = string> {
    value: T;
    label: string;
}

export const REPORT_TYPE_FILTERS: ReportFilterOption<ReportTypeFilter>[] = [
    { value: 'ALL', label: 'All' },
    { value: 'ISSUE', label: 'Issues' },
    { value: 'POSITIVE', label: 'Feedback' },
];

export const REPORT_STATUS_FILTERS: ReportFilterOption<ReportStatusFilter>[] = [
    { value: 'ALL', label: 'All' },
    ...(['PENDING', 'VERIFIED', 'REJECTED'] as const).map((value) => ({
        value,
        label: reportStatusLabel(value),
    })),
];

export const REPORT_SORT_OPTIONS: ReportFilterOption<ReportSortOrder>[] = [
    { value: 'NEWEST', label: 'Newest First' },
    { value: 'OLDEST', label: 'Oldest First' },
    { value: 'MOST_AGREED', label: 'Most Agreed' },
    { value: 'MOST_DISCUSSED', label: 'Most Comments' },
];

/** The report's category value, whichever field its type keeps it in. */
export function reportCategoryValue(report: AccessibilityReport): string | undefined {
    return reportTypeOf(report) === 'POSITIVE' ? report.category : report.issueCategory;
}

/**
 * The categories the filter offers for a report type.
 *
 * Issues first, then positive feedback, each in its picker's own order and
 * wording — so a category reads the same in the filter as on the form.
 */
export function reportCategoryFilterOptions(type: ReportTypeFilter): ReportFilterOption[] {
    const issues = REPORT_CATEGORY_OPTIONS.map(({ value, label }) => ({ value, label }));
    const positive = POSITIVE_FEEDBACK_CATEGORY_OPTIONS.map(({ value, label }) => ({
        value,
        label,
    }));

    if (type === 'ISSUE') return issues;
    if (type === 'POSITIVE') return positive;

    return [...issues, ...positive];
}

/**
 * The routes the filter offers: every route the loaded reports name, once.
 *
 * Taken from the reports rather than the whole route table, so picking one
 * never leads to an empty list, and labelled from the snapshot each report
 * kept — the same wording its card shows.
 */
export function reportRouteFilterOptions(reports: AccessibilityReport[]): ReportFilterOption[] {
    const routes = new Map<string, string>();

    for (const report of reports) {
        if (!report.routeId || routes.has(report.routeId)) continue;

        const number = report.route?.routeNumber;
        const name = report.route?.routeName;

        routes.set(
            report.routeId,
            number ? [`Route ${number}`, name].filter(Boolean).join(' · ') : report.routeId
        );
    }

    return [...routes.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((first, second) =>
            first.label.localeCompare(second.label, undefined, { numeric: true })
        );
}

/** Whether a report passes every narrowing filter. Sort is not a filter. */
export function reportMatchesFilters(
    report: AccessibilityReport,
    filters: ReportListFilters
): boolean {
    if (filters.type !== 'ALL' && reportTypeOf(report) !== filters.type) return false;
    if (filters.category && reportCategoryValue(report) !== filters.category) return false;
    if (filters.routeId && report.routeId !== filters.routeId) return false;

    // Read the way the review is: a report with no stored status is PENDING.
    if (filters.status !== 'ALL' && reportDecisionStatus(report) !== filters.status) {
        return false;
    }

    return true;
}

function sortableTime(value: unknown): number {
    const time = new Date(value as string).getTime();

    return Number.isNaN(time) ? -Infinity : time;
}

function countOf(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The reports in the chosen order, as a new array.
 *
 * The count orders fall back to newest first among equals, so reports nobody
 * has voted on still come out in a sensible order rather than an arbitrary one.
 */
export function sortReports<T extends AccessibilityReport>(
    reports: T[],
    order: ReportSortOrder
): T[] {
    const newestFirst = (first: T, second: T) =>
        sortableTime(second.createdAt) - sortableTime(first.createdAt);

    const comparators: Record<ReportSortOrder, (first: T, second: T) => number> = {
        NEWEST: newestFirst,
        OLDEST: (first, second) => newestFirst(second, first),
        MOST_AGREED: (first, second) =>
            countOf(second.agreeCount) - countOf(first.agreeCount) ||
            newestFirst(first, second),
        MOST_DISCUSSED: (first, second) =>
            countOf(second.commentCount) - countOf(first.commentCount) ||
            newestFirst(first, second),
    };

    return [...reports].sort(comparators[order]);
}

/** Search, then filters, then sort: the list the screen draws. */
export function narrowReportList<T extends AccessibilityReport>(
    reports: T[],
    query: string,
    filters: ReportListFilters
): T[] {
    const matching = filterReportsBySearch(reports, query).filter((report) =>
        reportMatchesFilters(report, filters)
    );

    return sortReports(matching, filters.sort);
}

/** How many narrowing filters are set, for the badge on the filter button. */
export function activeReportFilterCount(filters: ReportListFilters): number {
    return [
        filters.type !== 'ALL',
        !!filters.category,
        !!filters.routeId,
        filters.status !== 'ALL',
    ].filter(Boolean).length;
}
