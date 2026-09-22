// What the admin review screens read off the API, and what they are allowed to
// conclude from it.
//
// Three things this has to get right, and each of them is a rule the backend
// already owns:
//
//   - a report is decidable only from PENDING, because the API answers 409
//     otherwise. Offering Verify on a decided report would be offering an
//     action that cannot succeed.
//   - the review flag comes off the response. Five agreeing passengers is the
//     backend's threshold, and re-deriving it here would be a second copy of a
//     rule to keep in step.
//   - a queue card never shows the report id. It is how a report is addressed,
//     not something an admin reads off a row — the same rule the passenger list
//     already keeps.

import {
    MAX_ADMIN_REMARK_LENGTH,
    REPORT_REVIEW_ACTIONS,
} from '../../../src/entities/report/model/types';
import {
    ADMIN_REPORT_TYPE_FILTERS,
    ADMIN_REVIEW_FILTERS,
    AdminReviewReport,
    NEEDS_REVIEW_LABEL,
    REJECT_ACTION,
    REMARK_ACTION,
    REVIEW_FALLBACK_MESSAGE,
    VERIFY_ACTION,
    adminReportTypeCounts,
    adminReportTypeFilterLabel,
    adminReviewCardSummary,
    adminReviewCardVisibleText,
    adminReviewQueueSummary,
    adminReviewRequestPath,
    filterReportsByType,
    canDecideReport,
    isDecidedReport,
    isSubmittableRemark,
    mapAdminReview,
    mapAdminReviewReport,
    mapAdminReviewReports,
    remarkToSubmit,
    reportStatusLabel,
    reviewErrorMessage,
    reviewStatusOf,
    shouldReloadAfterFailure,
} from '../../../src/features/reports/utils/reportReview';
// The search the screen applies before the type filter — imported so the two
// can be composed here exactly as the queue composes them.
import { filterReportsBySearch } from '../../../src/features/reports/utils/reportSearch';

const REPORT_ID = 'REP-00007';

/** One report exactly as GET /api/reports?scope=review serialises it. */
function apiReport(overrides: Record<string, any> = {}) {
    return {
        documentId: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: 'PAS-2026-00002',
        issueCategory: 'BROKEN_RAMP',
        description: 'The boarding ramp would not fold out at the terminus.',
        status: 'PENDING',
        createdAt: '2026-08-20T09:30:00.000Z',
        updatedAt: '2026-08-20T09:30:00.000Z',
        vehicle: { numberPlate: 'NA-1234' },
        route: { routeNumber: '138', routeName: 'Kottawa — Pettah' },
        photoUrls: ['https://res.cloudinary.com/demo/a.jpg'],
        agreeCount: 6,
        disagreeCount: 1,
        commentCount: 3,
        requiresAdminReview: true,
        flagged: true,
        review: null,
        ...overrides,
    };
}

// ==================================================================
// Reading the list
// ==================================================================
describe('mapping the review queue', () => {
    it('carries every field a card draws', () => {
        const report = mapAdminReviewReport(apiReport());

        expect(report.reportId).toBe(REPORT_ID);
        expect(report.documentId).toBe(REPORT_ID);
        expect(report.issueCategory).toBe('BROKEN_RAMP');
        expect(report.status).toBe('PENDING');
        expect(report.agreeCount).toBe(6);
        expect(report.disagreeCount).toBe(1);
        expect(report.commentCount).toBe(3);
        expect(report.vehicle?.numberPlate).toBe('NA-1234');
        expect(report.route?.routeNumber).toBe('138');
        expect(report.photoUrls).toEqual(['https://res.cloudinary.com/demo/a.jpg']);
    });

    it('reads every absent tally as zero rather than as a missing field', () => {
        // A report filed before votes existed carries none of the three, and a
        // card has to draw a number rather than a gap.
        const report = mapAdminReviewReport({
            documentId: REPORT_ID,
            reportId: REPORT_ID,
            status: 'PENDING',
        });

        expect(report.agreeCount).toBe(0);
        expect(report.disagreeCount).toBe(0);
        expect(report.commentCount).toBe(0);
    });

    it('falls back to the document id when the record carries no reportId', () => {
        const report = mapAdminReviewReport({ documentId: 'REP-00009' });

        expect(report.reportId).toBe('REP-00009');
    });

    it('maps the whole list, in the order the API returned it', () => {
        const reports = mapAdminReviewReports([
            apiReport({ documentId: 'REP-1', reportId: 'REP-1' }),
            apiReport({ documentId: 'REP-2', reportId: 'REP-2' }),
        ]);

        expect(reports.map((report) => report.reportId)).toEqual(['REP-1', 'REP-2']);
    });

    it('reads anything that is not a list as an empty queue', () => {
        expect(mapAdminReviewReports(undefined)).toEqual([]);
        expect(mapAdminReviewReports(null)).toEqual([]);
        expect(mapAdminReviewReports({ reports: [] })).toEqual([]);
    });
});

// ==================================================================
// The review flag
// ==================================================================
describe('identifying flagged reports', () => {
    it('flags a report the API reported as flagged', () => {
        expect(mapAdminReviewReport(apiReport({ flagged: true })).flagged).toBe(true);
    });

    it('does not flag a report the API did not flag', () => {
        const report = mapAdminReviewReport(
            apiReport({ flagged: false, requiresAdminReview: false, agreeCount: 2 })
        );

        expect(report.flagged).toBe(false);
    });

    it('does not re-derive the flag from the vote tallies', () => {
        // Nine agreements is well past the backend's threshold, but the API
        // said this report is not flagged — and the threshold is the backend's
        // rule to apply, not a number the app keeps a second copy of.
        const report = mapAdminReviewReport(
            apiReport({ agreeCount: 9, flagged: false, requiresAdminReview: false })
        );

        expect(report.flagged).toBe(false);
    });

    it('falls back to requiresAdminReview on a payload without the derived flag', () => {
        const report = mapAdminReviewReport({
            documentId: REPORT_ID,
            requiresAdminReview: true,
        });

        expect(report.flagged).toBe(true);
    });

    it('counts the flagged and pending reports in a queue', () => {
        const reports = [
            mapAdminReviewReport(apiReport({ flagged: true, status: 'PENDING' })),
            mapAdminReviewReport(
                apiReport({
                    flagged: false,
                    requiresAdminReview: false,
                    status: 'PENDING',
                })
            ),
            mapAdminReviewReport(apiReport({ flagged: true, status: 'VERIFIED' })),
        ];

        expect(adminReviewQueueSummary(reports)).toEqual({
            total: 3,
            flagged: 2,
            pending: 2,
        });
    });
});

// ==================================================================
// Status
// ==================================================================
describe('what a report status allows', () => {
    it('reads the stored status', () => {
        expect(reviewStatusOf({ status: 'VERIFIED' })).toBe('VERIFIED');
    });

    it('reads a report with no stored status as PENDING', () => {
        // The same reading canApplyReview makes on the server: a record written
        // before a status was always set is unreviewed, not undecidable.
        expect(reviewStatusOf({})).toBe('PENDING');
        expect(reviewStatusOf({ status: '' })).toBe('PENDING');
        expect(reviewStatusOf(null)).toBe('PENDING');
    });

    it('offers Verify and Reject on a pending report', () => {
        expect(canDecideReport({ status: 'PENDING' })).toBe(true);
        expect(isDecidedReport({ status: 'PENDING' })).toBe(false);
    });

    it('offers neither on a report that has already been decided', () => {
        // The API answers 409 for both, so a button here could only fail.
        expect(canDecideReport({ status: 'VERIFIED' })).toBe(false);
        expect(canDecideReport({ status: 'REJECTED' })).toBe(false);
        expect(isDecidedReport({ status: 'VERIFIED' })).toBe(true);
        expect(isDecidedReport({ status: 'REJECTED' })).toBe(true);
    });

    it('offers neither on a report that has not been read yet', () => {
        expect(canDecideReport(null)).toBe(false);
        expect(canDecideReport(undefined)).toBe(false);
    });

    it('names each status in words a screen reader can read', () => {
        expect(reportStatusLabel('PENDING')).toBe('Pending');
        expect(reportStatusLabel('VERIFIED')).toBe('Verified');
        expect(reportStatusLabel('REJECTED')).toBe('Rejected');
    });

    it('falls back to the raw value for a status the app does not know', () => {
        expect(reportStatusLabel('ESCALATED')).toBe('ESCALATED');
    });
});

// ==================================================================
// The card
// ==================================================================
describe('what a queue card shows', () => {
    it('shows the category, description, bus, route and submitted date', () => {
        const summary = adminReviewCardSummary(mapAdminReviewReport(apiReport()));

        expect(summary.title).toBe('Broken Wheelchair Ramp');
        expect(summary.description).toBe(
            'The boarding ramp would not fold out at the terminus.'
        );
        expect(summary.chips.map((chip) => chip.label)).toEqual([
            'NA-1234',
            'Route 138',
            '1 photo',
        ]);
        expect(summary.submittedLabel).toContain('Submitted');
    });

    it('carries the three community tallies off the list response', () => {
        const summary = adminReviewCardSummary(mapAdminReviewReport(apiReport()));

        expect(summary.feedbackCounts).toEqual({
            agreeCount: 6,
            disagreeCount: 1,
            commentCount: 3,
        });
    });

    it('shows the status', () => {
        const summary = adminReviewCardSummary(
            mapAdminReviewReport(apiReport({ status: 'VERIFIED' }))
        );

        expect(summary.status).toBe('VERIFIED');
        expect(summary.statusLabel).toBe('Verified');
    });

    it('marks a flagged report as needing review', () => {
        const summary = adminReviewCardSummary(
            mapAdminReviewReport(apiReport({ flagged: true }))
        );

        expect(summary.needsReview).toBe(true);
        expect(summary.accessibilityLabel).toContain(NEEDS_REVIEW_LABEL.toLowerCase());
    });

    it('does not claim an unflagged report needs review', () => {
        const summary = adminReviewCardSummary(
            mapAdminReviewReport(
                apiReport({ flagged: false, requiresAdminReview: false })
            )
        );

        expect(summary.needsReview).toBe(false);
        expect(summary.accessibilityLabel).not.toContain(NEEDS_REVIEW_LABEL.toLowerCase());
    });

    it('announces the status and both tallies in one label', () => {
        // The whole card is one control, so it gets one label rather than a
        // heap of separately readable fragments.
        const summary = adminReviewCardSummary(mapAdminReviewReport(apiReport()));

        expect(summary.accessibilityLabel).toContain('status Pending');
        expect(summary.accessibilityLabel).toContain('3 comments');
        expect(summary.accessibilityLabel).toContain('6 agree');
        expect(summary.accessibilityLabel).toContain('1 disagree');
    });

    it('never puts the report id in front of an admin', () => {
        const summary = adminReviewCardSummary(mapAdminReviewReport(apiReport()));

        adminReviewCardVisibleText(summary).forEach((text) => {
            expect(text).not.toContain(REPORT_ID);
        });
    });
});

// ==================================================================
// Requests
// ==================================================================
describe('the review queue request', () => {
    it('always asks for the review scope', () => {
        expect(adminReviewRequestPath('ALL')).toBe('/api/reports?scope=review');
    });

    it('asks the API for the pending reports by status', () => {
        expect(adminReviewRequestPath('PENDING')).toBe(
            '/api/reports?scope=review&status=PENDING'
        );
    });

    it('names one endpoint for every filter', () => {
        // Each narrowing is a parameter on the existing scope, not a second
        // listing endpoint.
        (['ALL', 'PENDING'] as const).forEach((filter) => {
            expect(adminReviewRequestPath(filter).split('?')[0]).toBe('/api/reports');
            expect(adminReviewRequestPath(filter)).toContain('scope=review');
        });
    });
});

// ==================================================================
// The remark
// ==================================================================
describe('whether a remark is worth sending', () => {
    it('sends what was written', () => {
        expect(isSubmittableRemark('Confirmed with the depot.')).toBe(true);
    });

    it('refuses an empty remark before the request is made', () => {
        expect(isSubmittableRemark('')).toBe(false);
    });

    it('refuses a remark that is nothing but whitespace', () => {
        // The same rule normalizeAdminRemark applies on the server, checked
        // here so the admin is told before the request rather than after it.
        expect(isSubmittableRemark('   ')).toBe(false);
        expect(isSubmittableRemark('\n\t  ')).toBe(false);
    });

    it('refuses a remark past the length the API accepts', () => {
        expect(isSubmittableRemark('x'.repeat(MAX_ADMIN_REMARK_LENGTH))).toBe(true);
        expect(isSubmittableRemark('x'.repeat(MAX_ADMIN_REMARK_LENGTH + 1))).toBe(false);
    });

    it('measures the trimmed remark against the cap, as the API does', () => {
        const padded = `  ${'x'.repeat(MAX_ADMIN_REMARK_LENGTH)}  `;

        expect(isSubmittableRemark(padded)).toBe(true);
    });

    it('sends the remark trimmed, exactly as it will be stored', () => {
        expect(remarkToSubmit('  Checked the ramp.  ')).toBe('Checked the ramp.');
    });

    it('takes the cap from the shared report types', () => {
        // Not a second number: the composer must never let an admin write
        // something POST /api/reports/:id/review would then refuse.
        expect(MAX_ADMIN_REMARK_LENGTH).toBe(500);
    });
});

// ==================================================================
// Failures
// ==================================================================
describe('what a failed review request says', () => {
    it('tells an expired session apart from a refusal', () => {
        expect(reviewErrorMessage(401)).toContain('session');
        expect(reviewErrorMessage(403)).toContain('administrator');
    });

    it('says a missing report is gone rather than broken', () => {
        expect(reviewErrorMessage(404)).toBe('This report is no longer available.');
    });

    it('keeps the API wording for a conflict, which names the resulting status', () => {
        expect(
            reviewErrorMessage(409, 'This report has already been reviewed (VERIFIED).')
        ).toBe('This report has already been reviewed (VERIFIED).');
    });

    it('still explains a conflict the API did not describe', () => {
        expect(reviewErrorMessage(409)).toBe('This report has already been reviewed.');
    });

    it('falls back to the API message for anything unrecognised', () => {
        expect(reviewErrorMessage(500, 'Failed to review the report.')).toBe(
            'Failed to review the report.'
        );
    });

    it('says something useful when nothing came back at all', () => {
        expect(reviewErrorMessage(undefined)).toBe(REVIEW_FALLBACK_MESSAGE);
        expect(reviewErrorMessage(undefined, '   ')).toBe(REVIEW_FALLBACK_MESSAGE);
    });

    it('reloads the report when it moved underneath the admin', () => {
        // Decided by somebody else, or deleted: either way what is on screen is
        // a description of a report that no longer exists in that form.
        expect(shouldReloadAfterFailure(409)).toBe(true);
        expect(shouldReloadAfterFailure(404)).toBe(true);
    });

    it('does not reload on a failure that left the report alone', () => {
        expect(shouldReloadAfterFailure(401)).toBe(false);
        expect(shouldReloadAfterFailure(403)).toBe(false);
        expect(shouldReloadAfterFailure(500)).toBe(false);
        expect(shouldReloadAfterFailure(undefined)).toBe(false);
    });
});

// ==================================================================
// The recorded review
// ==================================================================
describe('reading a review already recorded', () => {
    it('reads the decision, who made it, when, and what they wrote', () => {
        const review = mapAdminReview({
            status: 'VERIFIED',
            reviewedBy: 'ADM-0001',
            reviewedAt: '2026-08-23T11:00:00.000Z',
            adminRemark: 'Confirmed with the depot.',
        });

        expect(review).toEqual({
            status: 'VERIFIED',
            reviewedBy: 'ADM-0001',
            reviewedAt: '2026-08-23T11:00:00.000Z',
            adminRemark: 'Confirmed with the depot.',
        });
    });

    it('reads a report nobody has reviewed as having no review', () => {
        // Null rather than an object of nulls, so the page can tell "not
        // decided yet" from "decided, with nothing written about it".
        expect(mapAdminReview(null)).toBeNull();
        expect(mapAdminReview(undefined)).toBeNull();
        expect(
            mapAdminReview({ status: null, reviewedBy: null, reviewedAt: null })
        ).toBeNull();
    });

    it('keeps a review that carries only a remark', () => {
        const review = mapAdminReview({ adminRemark: 'Waiting on the depot.' });

        expect(review?.adminRemark).toBe('Waiting on the depot.');
        expect(review?.reviewedBy).toBeNull();
    });
});

// ==================================================================
// The action vocabulary
// ==================================================================
describe('the actions a screen can record', () => {
    it('names exactly the three the API accepts', () => {
        expect([VERIFY_ACTION, REJECT_ACTION, REMARK_ACTION]).toEqual([
            ...REPORT_REVIEW_ACTIONS,
        ]);
    });
});

// A queue card is built from a real report rather than a fixture the screen
// invents; this keeps the fixture honest about that shape.
describe('the test fixture', () => {
    it('is the shape the review endpoints actually return', () => {
        const report: AdminReviewReport = mapAdminReviewReport(apiReport());

        expect(report.review).toBeNull();
        expect(report.requiresAdminReview).toBe(true);
    });
});

// ==================================================================
// The tabs
// ==================================================================
describe('the queue tabs', () => {
    it('offers All, Pending and Verified, and nothing else', () => {
        expect(ADMIN_REVIEW_FILTERS.map((tab) => tab.value)).toEqual([
            'ALL',
            'PENDING',
            'VERIFIED',
        ]);
        expect(ADMIN_REVIEW_FILTERS.map((tab) => tab.label)).toEqual([
            'All',
            'Pending',
            'Verified',
        ]);
    });

    it('asks the API for the verified reports by status', () => {
        // The same narrowing the Pending tab uses — a parameter on the review
        // scope, not a second endpoint and not a filter applied afterwards.
        expect(adminReviewRequestPath('VERIFIED')).toBe(
            '/api/reports?scope=review&status=VERIFIED'
        );
    });

    it('no longer offers a Needs Review tab', () => {
        // The flag itself is untouched — it is still on the card that carries
        // it and on the report screen. What went is the tab that narrowed the
        // whole queue by it.
        const values = ADMIN_REVIEW_FILTERS.map((tab) => String(tab.value));
        const labels = ADMIN_REVIEW_FILTERS.map((tab) => tab.label);

        expect(values).not.toContain('FLAGGED');
        expect(labels).not.toContain(NEEDS_REVIEW_LABEL);
    });

    it('never asks the API for the flagged slice any more', () => {
        // Worth asserting as code: the endpoint still accepts `flagged=true`,
        // so nothing would break loudly if a path started sending it again.
        ADMIN_REVIEW_FILTERS.forEach((tab) => {
            expect(adminReviewRequestPath(tab.value)).not.toContain('flagged');
        });
    });
});

// ==================================================================
// Positive feedback and issue reports
//
// Both come from the one reports collection, told apart by the `type` the
// report already carries — 'POSITIVE' is feedback, anything else is an issue.
// ==================================================================

/** Positive feedback, as the review endpoint serialises it. */
function positiveReport(overrides: Record<string, any> = {}) {
    return apiReport({
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        issueCategory: undefined,
        description: 'The driver waited while I boarded.',
        ...overrides,
    });
}

/** An issue report — stored with no `type` field at all, exactly as one is. */
function issueReport(overrides: Record<string, any> = {}) {
    return apiReport(overrides);
}

function queue(...raw: Record<string, any>[]): AdminReviewReport[] {
    return mapAdminReviewReports(raw);
}

describe('the type filter', () => {
    const reports = queue(
        positiveReport({ documentId: 'POS-1', reportId: 'POS-1' }),
        issueReport({ documentId: 'ISS-1', reportId: 'ISS-1' }),
        positiveReport({ documentId: 'POS-2', reportId: 'POS-2' }),
        issueReport({ documentId: 'ISS-2', reportId: 'ISS-2' })
    );

    it('offers All, Positive Feedback and Issue Reports', () => {
        expect(ADMIN_REPORT_TYPE_FILTERS.map((option) => option.value)).toEqual([
            'ALL',
            'POSITIVE',
            'ISSUE',
        ]);
        expect(adminReportTypeFilterLabel('POSITIVE')).toBe('Positive Feedback');
        expect(adminReportTypeFilterLabel('ISSUE')).toBe('Issue Reports');
        expect(adminReportTypeFilterLabel('ALL')).toBe('All');
    });

    it('shows only positive feedback when asked for it', () => {
        expect(filterReportsByType(reports, 'POSITIVE').map((r) => r.documentId)).toEqual([
            'POS-1',
            'POS-2',
        ]);
    });

    it('shows only issue reports when asked for them', () => {
        expect(filterReportsByType(reports, 'ISSUE').map((r) => r.documentId)).toEqual([
            'ISS-1',
            'ISS-2',
        ]);
    });

    it('shows both when asked for all', () => {
        // Returns the list itself, so "All" is genuinely no narrowing.
        expect(filterReportsByType(reports, 'ALL')).toBe(reports);
    });

    it('treats a report with no type as an issue', () => {
        // Every report filed before positive feedback existed is stored without
        // a `type`, and it is an accessibility issue rather than an unknown.
        const untyped = queue(
            apiReport({ documentId: 'OLD-1', reportId: 'OLD-1', type: undefined })
        );

        expect(filterReportsByType(untyped, 'ISSUE')).toHaveLength(1);
        expect(filterReportsByType(untyped, 'POSITIVE')).toHaveLength(0);
    });

    it('keeps the fields the queue opens its rows by', () => {
        // Narrowing must not widen an admin report back down to a passenger
        // one on the way through — documentId is how a row is opened.
        const [first] = filterReportsByType(reports, 'POSITIVE');

        expect(first.documentId).toBe('POS-1');
        expect(first.flagged).toBe(true);
    });
});

describe('the counts above the queue', () => {
    const reports = queue(
        positiveReport({ documentId: 'POS-1', reportId: 'POS-1', status: 'VERIFIED' }),
        positiveReport({ documentId: 'POS-2', reportId: 'POS-2', status: 'VERIFIED' }),
        positiveReport({ documentId: 'POS-3', reportId: 'POS-3', status: 'PENDING' }),
        issueReport({ documentId: 'ISS-1', reportId: 'ISS-1', status: 'VERIFIED' }),
        issueReport({ documentId: 'ISS-2', reportId: 'ISS-2', status: 'PENDING' }),
        issueReport({ documentId: 'ISS-3', reportId: 'ISS-3', status: 'REJECTED' }),
        issueReport({ documentId: 'ISS-4', reportId: 'ISS-4', status: 'RESOLVED' })
    );

    it('counts the positive feedback', () => {
        expect(adminReportTypeCounts(reports).positive).toBe(3);
    });

    it('counts the verified positive feedback', () => {
        expect(adminReportTypeCounts(reports).verifiedPositive).toBe(2);
    });

    it('counts the issue reports', () => {
        expect(adminReportTypeCounts(reports).issue).toBe(4);
    });

    it('counts the verified issue reports', () => {
        expect(adminReportTypeCounts(reports).verifiedIssue).toBe(1);
    });

    it('counts only VERIFIED as verified', () => {
        // PENDING is undecided, REJECTED was found not to hold, and REVIEWED
        // and RESOLVED are later states rather than a finding that the report
        // was true.
        const counts = adminReportTypeCounts(
            queue(
                issueReport({ documentId: 'A', reportId: 'A', status: 'PENDING' }),
                issueReport({ documentId: 'B', reportId: 'B', status: 'REJECTED' }),
                issueReport({ documentId: 'C', reportId: 'C', status: 'RESOLVED' }),
                issueReport({ documentId: 'D', reportId: 'D', status: 'REVIEWED' })
            )
        );

        expect(counts.issue).toBe(4);
        expect(counts.verifiedIssue).toBe(0);
    });

    it('counts a report with no stored status towards its total but not as verified', () => {
        const counts = adminReportTypeCounts(
            queue(positiveReport({ documentId: 'P', reportId: 'P', status: undefined }))
        );

        expect(counts.positive).toBe(1);
        expect(counts.verifiedPositive).toBe(0);
    });

    it('accounts for every report exactly once', () => {
        const counts = adminReportTypeCounts(reports);

        expect(counts.positive + counts.issue).toBe(reports.length);
        expect(counts.verifiedPositive).toBeLessThanOrEqual(counts.positive);
        expect(counts.verifiedIssue).toBeLessThanOrEqual(counts.issue);
    });

    it('is all zeroes for an empty queue', () => {
        expect(adminReportTypeCounts([])).toEqual({
            positive: 0,
            verifiedPositive: 0,
            issue: 0,
            verifiedIssue: 0,
        });
    });
});

// ==================================================================
// Status tab + type filter + search, together
//
// The screen composes them in that order, and each has to narrow what the one
// before it left rather than replacing it.
// ==================================================================
describe('narrowing the queue by more than one thing', () => {
    const pendingPositive = positiveReport({
        documentId: 'POS-P',
        reportId: 'POS-P',
        status: 'PENDING',
        vehicle: { numberPlate: 'NB-5678' },
    });
    const verifiedPositive = positiveReport({
        documentId: 'POS-V',
        reportId: 'POS-V',
        status: 'VERIFIED',
        vehicle: { numberPlate: 'NA-1234' },
    });
    const pendingIssue = issueReport({
        documentId: 'ISS-P',
        reportId: 'ISS-P',
        status: 'PENDING',
        issueCategory: 'PRIORITY_SEAT_MISUSE',
        description: 'Priority seat occupied for the whole trip.',
        vehicle: { numberPlate: 'NB-5678' },
    });

    const verifiedIssue = issueReport({
        documentId: 'ISS-V',
        reportId: 'ISS-V',
        status: 'VERIFIED',
        vehicle: { numberPlate: 'NA-1234' },
    });

    const all = queue(pendingPositive, verifiedPositive, pendingIssue, verifiedIssue);

    // What each status tab loads. The API answers the slice by status, so these
    // stand in for the request the tab makes rather than re-filtering in the
    // app — which is exactly the split the screen relies on.
    const pendingTab = all.filter((report) => report.status === 'PENDING');
    const verifiedTab = all.filter((report) => report.status === 'VERIFIED');

    it('shows only pending positive feedback for Pending + Positive Feedback', () => {
        expect(filterReportsByType(pendingTab, 'POSITIVE').map((r) => r.documentId)).toEqual([
            'POS-P',
        ]);
    });

    it('shows only pending issue reports for Pending + Issue Reports', () => {
        expect(filterReportsByType(pendingTab, 'ISSUE').map((r) => r.documentId)).toEqual([
            'ISS-P',
        ]);
    });

    it('shows only verified positive feedback for Verified + Positive Feedback', () => {
        expect(filterReportsByType(verifiedTab, 'POSITIVE').map((r) => r.documentId)).toEqual([
            'POS-V',
        ]);
    });

    it('shows only verified issue reports for Verified + Issue Reports', () => {
        expect(filterReportsByType(verifiedTab, 'ISSUE').map((r) => r.documentId)).toEqual([
            'ISS-V',
        ]);
    });

    it('shows both kinds for Verified + All', () => {
        expect(filterReportsByType(verifiedTab, 'ALL').map((r) => r.documentId)).toEqual([
            'POS-V',
            'ISS-V',
        ]);
    });

    it('shows everything for All + All', () => {
        expect(filterReportsByType(all, 'ALL')).toHaveLength(4);
    });

    it('never shows a pending report on the Verified tab, whatever the type filter', () => {
        // The status narrowing is the API's, and the type filter must not widen
        // it back — the two compose rather than replacing one another.
        (['ALL', 'POSITIVE', 'ISSUE'] as const).forEach((type) => {
            filterReportsByType(verifiedTab, type).forEach((report) => {
                expect(report.status).toBe('VERIFIED');
            });
        });
    });

    it('combines a search with the type filter', () => {
        // Two reports about NB-5678, narrowed to one kind at a time — the
        // composition the screen performs: search first, then type.
        const searched = filterReportsBySearch(all, 'NB-5678');

        expect(searched).toHaveLength(2);
        expect(filterReportsByType(searched, 'POSITIVE').map((r) => r.documentId)).toEqual([
            'POS-P',
        ]);
        expect(filterReportsByType(searched, 'ISSUE').map((r) => r.documentId)).toEqual(['ISS-P']);
    });

    it('combines the tab, the search and the type filter', () => {
        const visible = filterReportsByType(
            filterReportsBySearch(pendingTab, 'priority seat'),
            'ISSUE'
        );

        expect(visible.map((report) => report.documentId)).toEqual(['ISS-P']);
    });

    it('finds positive feedback by the words its own card shows', () => {
        // The search already reads the positive category and its label, so the
        // type filter is a narrowing rather than the only way to find feedback.
        expect(filterReportsBySearch(all, 'helpful driver').map((r) => r.documentId)).toEqual([
            'POS-P',
            'POS-V',
        ]);
    });

    it('leaves the counts describing the tab rather than the search', () => {
        // The summary is the shape of the queue an admin narrows against, so it
        // must not move as they type.
        expect(adminReportTypeCounts(all).positive).toBe(2);
        expect(adminReportTypeCounts(filterReportsBySearch(all, 'NB-5678')).positive).toBe(1);
    });
});

// ==================================================================
// The verification workflow, unchanged
// ==================================================================
describe('deciding a report after these changes', () => {
    it('still offers Verify and Reject on a pending report of either kind', () => {
        expect(canDecideReport(mapAdminReviewReport(issueReport({ status: 'PENDING' })))).toBe(true);
        expect(canDecideReport(mapAdminReviewReport(positiveReport({ status: 'PENDING' })))).toBe(
            true
        );
    });

    it('still refuses to re-decide a report that was already decided', () => {
        expect(canDecideReport(mapAdminReviewReport(issueReport({ status: 'VERIFIED' })))).toBe(
            false
        );
        expect(isDecidedReport(mapAdminReviewReport(positiveReport({ status: 'REJECTED' })))).toBe(
            true
        );
    });

    it('still names the same three actions', () => {
        expect(REPORT_REVIEW_ACTIONS).toEqual([VERIFY_ACTION, REJECT_ACTION, REMARK_ACTION]);
    });
});
