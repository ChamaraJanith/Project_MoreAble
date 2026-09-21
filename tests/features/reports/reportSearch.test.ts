// Searching the report lists on the device.
//
// The point worth pinning down is that this narrows a list the screen already
// holds and nothing else: no request is shaped by it, and the fields it reads
// are the ones a card actually shows — the report id among them is exactly the
// thing that must not be searchable, for the same reason it is not on the card.

import { AccessibilityReport } from '../../../src/entities/report/model/types';
import {
    DEFAULT_REPORT_FILTERS,
    REPORT_SEARCH_PLACEHOLDER,
    ReportListFilters,
    activeReportFilterCount,
    narrowReportList,
    reportCategoryFilterOptions,
    reportMatchesFilters,
    reportRouteFilterOptions,
    sortReports,
    filterReportsBySearch,
    reportMatchesSearch,
    reportSearchFields,
    reportSearchTerms,
} from '../../../src/features/reports/utils/reportSearch';

function report(overrides: Partial<AccessibilityReport> = {}): AccessibilityReport {
    return {
        reportId: 'REP-00007',
        passengerId: 'PSG-00001',
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        createdAt: '2026-08-20T14:05:00.000Z',
        updatedAt: '2026-08-20T14:05:00.000Z',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234', busModel: 'Rosa', manufacturer: 'Mitsubishi' },
        routeId: 'ROUTE-138-OUTBOUND',
        route: { routeNumber: '138', routeName: 'Pettah - Kottawa', direction: 'OUTBOUND' },
        ...overrides,
    };
}

describe('reportSearchTerms', () => {
    it('splits what was typed into words', () => {
        expect(reportSearchTerms('138 ramp')).toEqual(['138', 'ramp']);
    });

    it('reads a box holding nothing but spaces as no search at all', () => {
        expect(reportSearchTerms('   ')).toEqual([]);
        expect(reportSearchTerms('')).toEqual([]);
    });
});

describe('reportSearchFields', () => {
    it('offers what the card shows: the issue, the bus, the route, the words', () => {
        const fields = reportSearchFields(report());

        expect(fields).toContain('Broken Wheelchair Ramp');
        expect(fields).toContain('NB-1234');
        expect(fields).toContain('138');
        expect(fields).toContain('Pettah - Kottawa');
        expect(fields).toContain('The wheelchair ramp would not fold down at Pettah station.');
    });

    it('never offers the report id or the passenger who filed it', () => {
        const fields = reportSearchFields(report());

        expect(fields).not.toContain('REP-00007');
        expect(fields).not.toContain('PSG-00001');
    });

    it('leaves out what a report was filed without, rather than a blank', () => {
        const fields = reportSearchFields(
            report({ busId: undefined, vehicle: undefined, routeId: undefined, route: undefined })
        );

        expect(fields.every((value) => value.trim() !== '')).toBe(true);
    });
});

describe('reportMatchesSearch', () => {
    it('matches the issue as it reads on the card', () => {
        expect(reportMatchesSearch(report(), 'wheelchair')).toBe(true);
    });

    it('matches the stored category as well as its label', () => {
        expect(reportMatchesSearch(report(), 'broken_ramp')).toBe(true);
    });

    it('matches a bus, a route number and a route name', () => {
        expect(reportMatchesSearch(report(), 'nb-1234')).toBe(true);
        expect(reportMatchesSearch(report(), '138')).toBe(true);
        expect(reportMatchesSearch(report(), 'kottawa')).toBe(true);
    });

    it('matches a word from the description', () => {
        expect(reportMatchesSearch(report(), 'fold')).toBe(true);
    });

    it('matches the status in the words the badge uses', () => {
        expect(reportMatchesSearch(report({ status: 'VERIFIED' }), 'verified')).toBe(true);
        expect(reportMatchesSearch(report({ status: 'VERIFIED' }), 'rejected')).toBe(false);
    });

    it('ignores case', () => {
        expect(reportMatchesSearch(report(), 'PETTAH')).toBe(true);
    });

    it('requires every word, though not all in the same field', () => {
        expect(reportMatchesSearch(report(), '138 ramp')).toBe(true);
        expect(reportMatchesSearch(report(), '138 lift')).toBe(false);
    });

    it('matches everything while nothing has been typed', () => {
        expect(reportMatchesSearch(report(), '')).toBe(true);
        expect(reportMatchesSearch(report(), '  ')).toBe(true);
    });

    it('does not find a report by its id', () => {
        expect(reportMatchesSearch(report(), 'REP-00007')).toBe(false);
    });

    it('still searches a report filed without a bus or a route', () => {
        const filed = report({
            busId: undefined,
            vehicle: undefined,
            routeId: undefined,
            route: undefined,
        });

        expect(reportMatchesSearch(filed, 'ramp')).toBe(true);
        expect(reportMatchesSearch(filed, '138')).toBe(false);
    });
});

describe('filterReportsBySearch', () => {
    const ramp = report();
    const lift = report({
        reportId: 'REP-00008',
        issueCategory: 'LIFT_NOT_WORKING',
        description: 'The lift stayed shut for the whole trip.',
        vehicle: { numberPlate: 'NC-9876' },
        busId: 'BUS-00008',
        routeId: 'ROUTE-100-RETURN',
        route: { routeNumber: '100', routeName: 'Colombo - Galle' },
    });

    it('keeps only the reports that answer what was typed', () => {
        expect(filterReportsBySearch([ramp, lift], 'lift')).toEqual([lift]);
    });

    it('keeps the order the API returned them in', () => {
        expect(filterReportsBySearch([ramp, lift], 'route')).toEqual([ramp, lift]);
    });

    it('returns the list untouched while nothing has been typed', () => {
        const reports = [ramp, lift];

        expect(filterReportsBySearch(reports, '   ')).toBe(reports);
    });

    it('is empty rather than everything when nothing matches', () => {
        expect(filterReportsBySearch([ramp, lift], 'zzzz')).toEqual([]);
    });

    it('keeps the extra fields an admin queue row is opened by', () => {
        const queued = { ...lift, documentId: 'doc-8', flagged: true };

        const [match] = filterReportsBySearch([queued], 'lift');

        expect(match.documentId).toBe('doc-8');
        expect(match.flagged).toBe(true);
    });

    it('names the box the same way on both screens', () => {
        expect(REPORT_SEARCH_PLACEHOLDER).toBe('Search reports...');
    });
});

// ==================================================================
// Positive feedback, filters and sort (the redesigned list)
// ==================================================================
function positive(overrides: Partial<AccessibilityReport> = {}): AccessibilityReport {
    return report({
        reportId: 'REP-00020',
        type: 'POSITIVE',
        issueCategory: undefined as unknown as AccessibilityReport['issueCategory'],
        category: 'HELPFUL_DRIVER',
        description: 'The driver waited until I was seated.',
        ...overrides,
    });
}

function filters(overrides: Partial<ReportListFilters> = {}): ReportListFilters {
    return { ...DEFAULT_REPORT_FILTERS, ...overrides };
}

describe('searching positive feedback', () => {
    it('finds feedback by its category label and by the word feedback', () => {
        expect(reportMatchesSearch(positive(), 'helpful driver')).toBe(true);
        expect(reportMatchesSearch(positive(), 'feedback')).toBe(true);
    });

    it('does not offer an undefined issue category as a search field', () => {
        expect(reportSearchFields(positive()).every((field) => typeof field === 'string')).toBe(true);
    });
});

describe('reportMatchesFilters', () => {
    it('lets everything through with the default filters', () => {
        expect(reportMatchesFilters(report(), DEFAULT_REPORT_FILTERS)).toBe(true);
        expect(reportMatchesFilters(positive(), DEFAULT_REPORT_FILTERS)).toBe(true);
    });

    it('filters by report type', () => {
        expect(reportMatchesFilters(report(), filters({ type: 'ISSUE' }))).toBe(true);
        expect(reportMatchesFilters(positive(), filters({ type: 'ISSUE' }))).toBe(false);
        expect(reportMatchesFilters(positive(), filters({ type: 'POSITIVE' }))).toBe(true);
        expect(reportMatchesFilters(report(), filters({ type: 'POSITIVE' }))).toBe(false);
    });

    it('filters by category, reading whichever field the type uses', () => {
        expect(reportMatchesFilters(report(), filters({ category: 'BROKEN_RAMP' }))).toBe(true);
        expect(reportMatchesFilters(report(), filters({ category: 'LIFT_NOT_WORKING' }))).toBe(false);
        expect(reportMatchesFilters(positive(), filters({ category: 'HELPFUL_DRIVER' }))).toBe(true);
        expect(reportMatchesFilters(positive(), filters({ category: 'BROKEN_RAMP' }))).toBe(false);
    });

    it('filters by route id', () => {
        expect(reportMatchesFilters(report(), filters({ routeId: 'ROUTE-138-OUTBOUND' }))).toBe(true);
        expect(reportMatchesFilters(report(), filters({ routeId: 'ROUTE-177' }))).toBe(false);
        expect(
            reportMatchesFilters(report({ routeId: undefined }), filters({ routeId: 'ROUTE-177' }))
        ).toBe(false);
    });

    it('filters by status, reading a missing status as pending', () => {
        expect(
            reportMatchesFilters(report({ status: 'VERIFIED' }), filters({ status: 'VERIFIED' }))
        ).toBe(true);
        expect(
            reportMatchesFilters(report({ status: 'PENDING' }), filters({ status: 'VERIFIED' }))
        ).toBe(false);
        expect(
            reportMatchesFilters(report({ status: 'REJECTED' }), filters({ status: 'REJECTED' }))
        ).toBe(true);
        expect(
            reportMatchesFilters(
                report({ status: undefined as unknown as string }),
                filters({ status: 'PENDING' })
            )
        ).toBe(true);
    });
});

describe('reportCategoryFilterOptions', () => {
    it('offers only the categories of the chosen type', () => {
        const issueValues = reportCategoryFilterOptions('ISSUE').map((option) => option.value);
        const positiveValues = reportCategoryFilterOptions('POSITIVE').map((option) => option.value);

        expect(issueValues).toContain('BROKEN_RAMP');
        expect(issueValues).not.toContain('HELPFUL_DRIVER');
        expect(positiveValues).toContain('HELPFUL_DRIVER');
        expect(positiveValues).not.toContain('BROKEN_RAMP');
    });

    it('offers both lists, issues first, for All', () => {
        const all = reportCategoryFilterOptions('ALL');

        expect(all).toHaveLength(
            reportCategoryFilterOptions('ISSUE').length +
                reportCategoryFilterOptions('POSITIVE').length
        );
        expect(all[0].value).toBe('BROKEN_RAMP');
    });
});

describe('reportRouteFilterOptions', () => {
    it('lists each route the reports name once, labelled from the snapshot', () => {
        const options = reportRouteFilterOptions([
            report(),
            report({ reportId: 'REP-2' }),
            report({
                reportId: 'REP-3',
                routeId: 'ROUTE-17',
                route: { routeNumber: '17', routeName: 'Panadura - Kandy' },
            }),
            report({ reportId: 'REP-4', routeId: undefined, route: undefined }),
        ]);

        expect(options).toEqual([
            { value: 'ROUTE-17', label: 'Route 17 · Panadura - Kandy' },
            { value: 'ROUTE-138-OUTBOUND', label: 'Route 138 · Pettah - Kottawa' },
        ]);
    });

    it('falls back to the route id when no snapshot was kept', () => {
        expect(reportRouteFilterOptions([report({ route: undefined })])).toEqual([
            { value: 'ROUTE-138-OUTBOUND', label: 'ROUTE-138-OUTBOUND' },
        ]);
    });
});

describe('sortReports', () => {
    const older = report({
        reportId: 'OLD',
        createdAt: '2026-08-01T10:00:00.000Z',
        agreeCount: 9,
        commentCount: 1,
    });
    const newer = report({
        reportId: 'NEW',
        createdAt: '2026-08-20T10:00:00.000Z',
        agreeCount: 2,
        commentCount: 5,
    });
    const middle = report({ reportId: 'MID', createdAt: '2026-08-10T10:00:00.000Z' });

    const ids = (reports: AccessibilityReport[]) => reports.map((entry) => entry.reportId);

    it('sorts newest first and oldest first', () => {
        expect(ids(sortReports([older, newer, middle], 'NEWEST'))).toEqual(['NEW', 'MID', 'OLD']);
        expect(ids(sortReports([older, newer, middle], 'OLDEST'))).toEqual(['OLD', 'MID', 'NEW']);
    });

    it('sorts by agreement and by comments, newest first among equals', () => {
        expect(ids(sortReports([older, newer, middle], 'MOST_AGREED'))).toEqual([
            'OLD',
            'NEW',
            'MID',
        ]);
        expect(ids(sortReports([older, newer, middle], 'MOST_DISCUSSED'))).toEqual([
            'NEW',
            'OLD',
            'MID',
        ]);
    });

    it('does not reorder the list it was given', () => {
        const list = [older, newer];

        sortReports(list, 'NEWEST');

        expect(ids(list)).toEqual(['OLD', 'NEW']);
    });
});

describe('narrowReportList', () => {
    it('applies the search, then the filters, then the sort', () => {
        const list = [
            report({ reportId: 'ISSUE-138', createdAt: '2026-08-01T10:00:00.000Z' }),
            positive({ reportId: 'GOOD-138-OLD', createdAt: '2026-08-02T10:00:00.000Z' }),
            positive({ reportId: 'GOOD-138-NEW', createdAt: '2026-08-05T10:00:00.000Z' }),
            positive({ reportId: 'GOOD-OTHER', routeId: 'R-9', route: { routeNumber: '9' } }),
        ];

        const result = narrowReportList(list, '138', filters({ type: 'POSITIVE', sort: 'OLDEST' }));

        expect(result.map((entry) => entry.reportId)).toEqual(['GOOD-138-OLD', 'GOOD-138-NEW']);
    });
});

describe('activeReportFilterCount', () => {
    it('counts the narrowing filters but not the sort', () => {
        expect(activeReportFilterCount(DEFAULT_REPORT_FILTERS)).toBe(0);
        expect(activeReportFilterCount(filters({ sort: 'OLDEST' }))).toBe(0);
        expect(
            activeReportFilterCount(
                filters({ type: 'ISSUE', category: 'BROKEN_RAMP', routeId: 'R', status: 'PENDING' })
            )
        ).toBe(4);
    });
});
