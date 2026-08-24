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
    AdminReviewReport,
    NEEDS_REVIEW_LABEL,
    REJECT_ACTION,
    REMARK_ACTION,
    REVIEW_FALLBACK_MESSAGE,
    VERIFY_ACTION,
    adminReviewCardSummary,
    adminReviewCardVisibleText,
    adminReviewQueueSummary,
    adminReviewRequestPath,
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

    it('asks the API for the flagged reports rather than filtering a wider list', () => {
        expect(adminReviewRequestPath('FLAGGED')).toBe(
            '/api/reports?scope=review&flagged=true'
        );
    });

    it('asks the API for the pending reports by status', () => {
        expect(adminReviewRequestPath('PENDING')).toBe(
            '/api/reports?scope=review&status=PENDING'
        );
    });

    it('names one endpoint for every filter', () => {
        // Each narrowing is a parameter on the existing scope, not a second
        // listing endpoint.
        (['ALL', 'FLAGGED', 'PENDING'] as const).forEach((filter) => {
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
