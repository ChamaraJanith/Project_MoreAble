// Searching the report lists on the device.
//
// The point worth pinning down is that this narrows a list the screen already
// holds and nothing else: no request is shaped by it, and the fields it reads
// are the ones a card actually shows — the report id among them is exactly the
// thing that must not be searchable, for the same reason it is not on the card.

import { AccessibilityReport } from '../../../src/entities/report/model/types';
import {
    REPORT_SEARCH_PLACEHOLDER,
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
