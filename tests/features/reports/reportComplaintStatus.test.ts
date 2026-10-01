// The complaint status the Review Reports queue draws beside "Verified", and
// the Complaint Status filter behind its filter button.
//
// The rules under test:
//
//   - only a VERIFIED issue report gets a complaint chip — positive feedback
//     cannot have a complaint, and an undecided issue cannot have one yet.
//   - "No Complaint" is said only once the complaints have actually loaded; a
//     lookup that failed must never read as a report with no complaint.
//   - "Complaint Created" keeps a report whatever its complaint's status.
//   - the complaint filter applies to issue reports only.

import { COMPLAINT_STATUSES } from '../../../src/entities/complaint/model/types';
import {
    ADMIN_COMPLAINT_FILTERS,
    COMPLAINT_INDEX_ERROR,
    COMPLAINT_INDEX_LOADING,
    NO_COMPLAINT_LABEL,
    ReportComplaintRef,
    adminComplaintFilterLabel,
    complaintForReport,
    filterReportsByComplaint,
    indexComplaintsByReport,
    reportComplaintBadge,
} from '../../../src/features/reports/utils/reportComplaintStatus';

function report(overrides: Record<string, unknown>): any {
    return {
        reportId: 'REP-00001',
        documentId: 'REP-00001',
        type: 'ISSUE',
        status: 'VERIFIED',
        issueCategory: 'RAMP_NOT_WORKING',
        description: 'The ramp did not deploy.',
        createdAt: '2026-09-01T10:00:00.000Z',
        ...overrides,
    };
}

const verifiedWithoutComplaint = report({ reportId: 'REP-00001', documentId: 'REP-00001' });
const verifiedWithComplaint = report({ reportId: 'REP-00002', documentId: 'REP-00002' });
const pendingIssue = report({ reportId: 'REP-00003', documentId: 'REP-00003', status: 'PENDING' });
const rejectedIssue = report({ reportId: 'REP-00004', documentId: 'REP-00004', status: 'REJECTED' });
const positive = report({
    reportId: 'REP-00005',
    documentId: 'REP-00005',
    type: 'POSITIVE',
    status: 'PUBLISHED',
    category: 'HELPFUL_DRIVER',
});
// Legacy positive feedback verified under the old workflow.
const legacyVerifiedPositive = report({
    reportId: 'REP-00006',
    documentId: 'REP-00006',
    type: 'POSITIVE',
    status: 'VERIFIED',
});

function complaint(
    reportId: string,
    status: string,
    complaintId = 'CMP-00007'
): ReportComplaintRef {
    return { complaintId, reportId, status: status as ReportComplaintRef['status'] };
}

const queue = [
    verifiedWithoutComplaint,
    verifiedWithComplaint,
    pendingIssue,
    rejectedIssue,
    positive,
    legacyVerifiedPositive,
];

const index = indexComplaintsByReport([complaint('REP-00002', 'IN_PROGRESS')]);

// ------------------------------------------------------------------
describe('complaint chip on a queue card', () => {
    it('shows "No Complaint" on a verified issue that has none', () => {
        expect(reportComplaintBadge(verifiedWithoutComplaint, index)).toEqual({
            tone: 'none',
            label: NO_COMPLAINT_LABEL,
            complaintId: null,
        });
    });

    it('shows the complaint id and status on a verified issue that has one', () => {
        expect(reportComplaintBadge(verifiedWithComplaint, index)).toEqual({
            tone: 'active',
            label: 'Complaint CMP-00007 · In Progress',
            complaintId: 'CMP-00007',
        });
    });

    it.each([
        ['PENDING', 'Pending', 'active'],
        ['ASSIGNED', 'Assigned', 'active'],
        ['IN_PROGRESS', 'In Progress', 'active'],
        ['RESOLVED', 'Resolved', 'resolved'],
    ])('words a %s complaint as "%s" in the %s tone', (status, label, tone) => {
        const badge = reportComplaintBadge(
            verifiedWithComplaint,
            indexComplaintsByReport([complaint('REP-00002', status)])
        );

        expect(badge?.label).toBe(`Complaint CMP-00007 · ${label}`);
        expect(badge?.tone).toBe(tone);
    });

    it('covers every complaint status the model defines', () => {
        for (const status of COMPLAINT_STATUSES) {
            const badge = reportComplaintBadge(
                verifiedWithComplaint,
                indexComplaintsByReport([complaint('REP-00002', status)])
            );

            // Always words, never the stored key.
            expect(badge?.label).not.toContain('_');
            expect(badge?.label).toMatch(/^Complaint CMP-00007 · [A-Z][a-z]/);
        }
    });

    it('gives positive feedback no complaint chip, even a legacy verified one', () => {
        expect(reportComplaintBadge(positive, index)).toBeNull();
        expect(reportComplaintBadge(legacyVerifiedPositive, index)).toBeNull();
    });

    it('gives undecided and rejected issues no complaint chip', () => {
        expect(reportComplaintBadge(pendingIssue, index)).toBeNull();
        expect(reportComplaintBadge(rejectedIssue, index)).toBeNull();
    });

    it('draws nothing while the complaints are loading', () => {
        expect(reportComplaintBadge(verifiedWithoutComplaint, COMPLAINT_INDEX_LOADING)).toBeNull();
    });

    it('never claims "No Complaint" when the complaints failed to load', () => {
        expect(reportComplaintBadge(verifiedWithoutComplaint, COMPLAINT_INDEX_ERROR)).toBeNull();
        expect(reportComplaintBadge(verifiedWithComplaint, COMPLAINT_INDEX_ERROR)).toBeNull();
    });

    it('never puts the report id on the chip', () => {
        const badge = reportComplaintBadge(verifiedWithComplaint, index);

        expect(badge?.label).not.toContain(verifiedWithComplaint.reportId);
    });
});

// ------------------------------------------------------------------
describe('matching complaints to reports', () => {
    it('matches on the document id, which is what a complaint stores', () => {
        const row = report({ reportId: 'REP-00009', documentId: 'doc-9' });
        const byDoc = indexComplaintsByReport([complaint('doc-9', 'PENDING')]);

        expect(byDoc.status === 'ready' && complaintForReport(row, byDoc.byReport)).toEqual(
            complaint('doc-9', 'PENDING')
        );
    });

    it('falls back to the report id', () => {
        const row = report({ reportId: 'REP-00009', documentId: undefined });
        const byId = indexComplaintsByReport([complaint('REP-00009', 'ASSIGNED')]);

        expect(byId.status === 'ready' && complaintForReport(row, byId.byReport)?.status).toBe(
            'ASSIGNED'
        );
    });

    it('keeps the newest complaint when a report somehow has two', () => {
        // The API answers newest first.
        const twice = indexComplaintsByReport([
            complaint('REP-00002', 'PENDING', 'CMP-00011'),
            complaint('REP-00002', 'RESOLVED', 'CMP-00003'),
        ]);

        expect(reportComplaintBadge(verifiedWithComplaint, twice)?.complaintId).toBe('CMP-00011');
    });

    it('ignores a complaint for a report that is not in the queue', () => {
        const elsewhere = indexComplaintsByReport([complaint('REP-99999', 'PENDING')]);

        expect(reportComplaintBadge(verifiedWithoutComplaint, elsewhere)?.tone).toBe('none');
    });
});

// ------------------------------------------------------------------
describe('Complaint Status filter', () => {
    const ids = (rows: any[]) => rows.map((row) => row.reportId);

    it('offers All, Complaint Created and No Complaint, in that order', () => {
        expect(ADMIN_COMPLAINT_FILTERS.map((option) => option.label)).toEqual([
            'All',
            'Complaint Created',
            'No Complaint',
        ]);
        expect(adminComplaintFilterLabel('CREATED')).toBe('Complaint Created');
        expect(adminComplaintFilterLabel('NONE')).toBe('No Complaint');
    });

    it('All leaves the queue untouched, positive feedback included', () => {
        expect(filterReportsByComplaint(queue, 'ALL', index)).toBe(queue);
        expect(filterReportsByComplaint(queue, 'ALL', COMPLAINT_INDEX_ERROR)).toBe(queue);
    });

    it('Complaint Created keeps only verified issues that have a complaint', () => {
        expect(ids(filterReportsByComplaint(queue, 'CREATED', index))).toEqual(['REP-00002']);
    });

    it('Complaint Created keeps a report whatever its complaint status, Resolved included', () => {
        for (const status of COMPLAINT_STATUSES) {
            const statusIndex = indexComplaintsByReport([complaint('REP-00002', status)]);

            expect(ids(filterReportsByComplaint(queue, 'CREATED', statusIndex))).toEqual([
                'REP-00002',
            ]);
        }
    });

    it('No Complaint keeps only verified issues without one', () => {
        expect(ids(filterReportsByComplaint(queue, 'NONE', index))).toEqual(['REP-00001']);
    });

    it('applies to issue reports only — positive feedback is in neither side', () => {
        const created = filterReportsByComplaint(queue, 'CREATED', index);
        const none = filterReportsByComplaint(queue, 'NONE', index);

        for (const row of [...created, ...none]) {
            expect(row.type).toBe('ISSUE');
            expect(row.status).toBe('VERIFIED');
        }
    });

    it('keeps nothing rather than guessing while complaints are unavailable', () => {
        expect(filterReportsByComplaint(queue, 'CREATED', COMPLAINT_INDEX_ERROR)).toEqual([]);
        expect(filterReportsByComplaint(queue, 'NONE', COMPLAINT_INDEX_ERROR)).toEqual([]);
        expect(filterReportsByComplaint(queue, 'NONE', COMPLAINT_INDEX_LOADING)).toEqual([]);
    });

    it('splits the verified issues cleanly: every one is on exactly one side', () => {
        const created = ids(filterReportsByComplaint(queue, 'CREATED', index));
        const none = ids(filterReportsByComplaint(queue, 'NONE', index));

        expect(created.filter((id) => none.includes(id))).toEqual([]);
        expect([...created, ...none].sort()).toEqual(['REP-00001', 'REP-00002']);
    });
});
