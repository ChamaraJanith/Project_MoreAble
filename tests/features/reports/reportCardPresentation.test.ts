// What the redesigned report screens derive from a report: the card's
// thumbnail and "Your Report" mark, the relative date in its footer, the
// ISSUE / POSITIVE wording, the submission receipt, and the filter wording.
//
// Kept as pure data so it can be tested here — this project's Jest setup is
// node-only, with no React renderer.

import { AccessibilityReport } from '../../../src/entities/report/model/types';
import {
    formatRelativeReportTime,
    formatReportDateTime,
    reportTypeLabel,
} from '../../../src/features/reports/utils/reportFormat';
import { accessibilityReportsPath } from '../../../src/features/reports/utils/reportRoutes';
import {
    REPORT_TYPE_FILTERS,
    narrowReportList,
    DEFAULT_REPORT_FILTERS,
} from '../../../src/features/reports/utils/reportSearch';
import {
    reportCardSummary,
    reportCardVisibleText,
    reportSubmissionReceipt,
} from '../../../src/features/reports/utils/reportSummary';

const NOW = new Date('2026-09-22T12:00:00.000Z');

function report(overrides: Partial<AccessibilityReport> = {}): AccessibilityReport {
    return {
        reportId: 'REP-00042',
        passengerId: 'PSG-00001',
        issueCategory: 'BROKEN_RAMP',
        description: 'The ramp would not fold down.',
        status: 'PENDING',
        createdAt: '2026-09-22T10:00:00.000Z',
        updatedAt: '2026-09-22T10:00:00.000Z',
        ...overrides,
    };
}

function positive(overrides: Partial<AccessibilityReport> = {}): AccessibilityReport {
    return report({
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        issueCategory: undefined as unknown as AccessibilityReport['issueCategory'],
        description: 'The driver waited until I was seated.',
        ...overrides,
    });
}

describe('formatRelativeReportTime', () => {
    it('says "Just now" for the last minute', () => {
        expect(formatRelativeReportTime('2026-09-22T11:59:30.000Z', NOW)).toBe('Just now');
    });

    it('counts minutes, hours and days', () => {
        expect(formatRelativeReportTime('2026-09-22T11:55:00.000Z', NOW)).toBe('5m ago');
        expect(formatRelativeReportTime('2026-09-22T10:00:00.000Z', NOW)).toBe('2h ago');
        expect(formatRelativeReportTime('2026-09-19T12:00:00.000Z', NOW)).toBe('3d ago');
    });

    it('falls back to the full date after a week', () => {
        const old = '2026-09-01T12:00:00.000Z';

        expect(formatRelativeReportTime(old, NOW)).toBe(formatReportDateTime(old));
    });

    it('falls back to the full date for a future time, and to the raw value when unparseable', () => {
        const future = '2026-09-23T12:00:00.000Z';

        expect(formatRelativeReportTime(future, NOW)).toBe(formatReportDateTime(future));
        expect(formatRelativeReportTime('not a date', NOW)).toBe('not a date');
    });
});

describe('reportTypeLabel', () => {
    it('names both kinds of report', () => {
        expect(reportTypeLabel('ISSUE')).toBe('Accessibility Issue');
        expect(reportTypeLabel('POSITIVE')).toBe('Positive Feedback');
    });
});

describe('the card thumbnail', () => {
    it('is the first photo when the report has photos', () => {
        const summary = reportCardSummary(
            report({ photoUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'] })
        );

        expect(summary.thumbnailUrl).toBe('https://cdn.example/a.jpg');
    });

    it('is absent without photos, so the card shows the category icon instead', () => {
        expect(reportCardSummary(report()).thumbnailUrl).toBeUndefined();
        expect(reportCardSummary(report({ photoUrls: [] })).thumbnailUrl).toBeUndefined();
    });

    it('skips a blank url rather than drawing an empty image', () => {
        expect(
            reportCardSummary(report({ photoUrls: ['', 'https://cdn.example/b.jpg'] })).thumbnailUrl
        ).toBe('https://cdn.example/b.jpg');
    });
});

describe('the card type and ownership', () => {
    it('tells an issue from positive feedback', () => {
        expect(reportCardSummary(report()).reportType).toBe('ISSUE');
        expect(reportCardSummary(positive()).reportType).toBe('POSITIVE');
    });

    it('marks the passenger’s own report only when asked to', () => {
        expect(reportCardSummary(report(), { isOwnReport: true }).isOwnReport).toBe(true);
        expect(reportCardSummary(report()).isOwnReport).toBe(false);
    });

    it('states the date relatively for the footer', () => {
        expect(reportCardSummary(report(), { now: NOW }).relativeDateLabel).toBe('2h ago');
    });

    it('still never shows the report id on the card', () => {
        const summary = reportCardSummary(report({ photoUrls: ['https://cdn.example/a.jpg'] }));

        expect(reportCardVisibleText(summary).join(' ')).not.toContain('REP-00042');
    });
});

describe('reportSubmissionReceipt', () => {
    it('lists what the API stored for an issue report', () => {
        const receipt = reportSubmissionReceipt(report());

        expect(receipt).toEqual({
            reportId: 'REP-00042',
            submittedLabel: formatReportDateTime('2026-09-22T10:00:00.000Z'),
            status: 'PENDING',
            reportType: 'ISSUE',
            typeLabel: 'Accessibility Issue',
            categoryLabel: 'Broken Wheelchair Ramp',
        });
    });

    it('describes positive feedback by its own category', () => {
        const receipt = reportSubmissionReceipt(positive());

        expect(receipt.reportType).toBe('POSITIVE');
        expect(receipt.typeLabel).toBe('Positive Feedback');
        expect(receipt.categoryLabel).not.toBe('');
    });

    it('reads a report with no stored status as pending', () => {
        expect(reportSubmissionReceipt(report({ status: '' })).status).toBe('PENDING');
    });
});

describe('the Report Type filter', () => {
    it('offers All, Issues and Positive', () => {
        expect(REPORT_TYPE_FILTERS.map((option) => option.label)).toEqual([
            'All',
            'Issues',
            'Positive',
        ]);
    });

    it('narrows the list to the chosen type', () => {
        const reports = [report({ reportId: 'REP-1' }), positive({ reportId: 'REP-2' })];

        const ids = (type: 'ALL' | 'ISSUE' | 'POSITIVE') =>
            narrowReportList(reports, '', { ...DEFAULT_REPORT_FILTERS, type }).map(
                (item) => item.reportId
            );

        expect(ids('ISSUE')).toEqual(['REP-1']);
        expect(ids('POSITIVE')).toEqual(['REP-2']);
        expect(ids('ALL').sort()).toEqual(['REP-1', 'REP-2']);
    });

    it('lets "issue" be searched for as a word', () => {
        const reports = [report({ reportId: 'REP-1' }), positive({ reportId: 'REP-2' })];

        expect(
            narrowReportList(reports, 'issue', DEFAULT_REPORT_FILTERS).map((item) => item.reportId)
        ).toEqual(['REP-1']);
    });
});

describe('accessibilityReportsPath', () => {
    it('opens the list, optionally on a tab', () => {
        expect(accessibilityReportsPath()).toBe('/accessibility-reports');
        expect(accessibilityReportsPath('my')).toBe('/accessibility-reports?scope=my');
    });
});
