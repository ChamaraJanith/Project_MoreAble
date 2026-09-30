// Who sees which report, and what status each audience is shown.
//
// Three audiences, one set of rules (src/entities/report/model/types):
//
//   PUBLIC ALL   VERIFIED issues + positive feedback. No pending or rejected
//                issue, and no status badge — only the report's type.
//   MY REPORTS   the author's own reports in every status; an issue shows its
//                review status, positive feedback none.
//   ADMIN        everything. Positive feedback reads "Verified" through a
//                display-only key; its stored status stays PUBLISHED.
//
// None of these rules writes anything, and the scoring rule is unchanged — the
// public feed is exactly the set of reports the community factor counts.

import {
    ADMIN_POSITIVE_FEEDBACK_DISPLAY_STATUS,
    AccessibilityReport,
    adminReportDisplayStatus,
    canViewReport,
    isPubliclyVisibleReport,
    passengerReportStatusBadge,
} from '../../../src/entities/report/model/types';
import { reportListStatusBadge } from '../../../src/features/reports/utils/reportSummary';
import { isCountedCommunityReport } from '../../../src/shared/utils/accessibility';

const AUTHOR = 'PSG-00001';
const OTHER = 'PSG-00002';

function issue(status: string | undefined, passengerId = AUTHOR) {
    return { passengerId, status } as Partial<AccessibilityReport>;
}

function positive(status: string | undefined, passengerId = AUTHOR) {
    return { passengerId, type: 'POSITIVE', status } as Partial<AccessibilityReport>;
}

const passenger = (passengerId: string) => ({ passengerId, role: 'PASSENGER' });
const admin = { passengerId: 'ADM-2026-00001', role: 'ADMIN' };

describe('PUBLIC ALL', () => {
    it('shows a VERIFIED issue', () => {
        expect(isPubliclyVisibleReport(issue('VERIFIED'))).toBe(true);
    });

    it('hides a PENDING issue', () => {
        expect(isPubliclyVisibleReport(issue('PENDING'))).toBe(false);
        // A record with no stored status is pending, and hidden too.
        expect(isPubliclyVisibleReport(issue(undefined))).toBe(false);
    });

    it('hides a REJECTED issue', () => {
        expect(isPubliclyVisibleReport(issue('REJECTED'))).toBe(false);
    });

    it('shows positive feedback as soon as it is filed, with no review', () => {
        expect(isPubliclyVisibleReport(positive('PUBLISHED'))).toBe(true);
    });

    it('shows legacy positive feedback stored PENDING or VERIFIED, and hides legacy REJECTED', () => {
        expect(isPubliclyVisibleReport(positive('PENDING'))).toBe(true);
        expect(isPubliclyVisibleReport(positive('VERIFIED'))).toBe(true);
        expect(isPubliclyVisibleReport(positive('REJECTED'))).toBe(false);
    });

    it('shows no status badge on any card', () => {
        for (const report of [issue('VERIFIED'), positive('PUBLISHED')]) {
            expect(reportListStatusBadge(report as AccessibilityReport, 'all')).toBeNull();
            expect(reportListStatusBadge(report as AccessibilityReport, 'verified')).toBeNull();
        }
    });

    it('is exactly the set of reports the community score counts', () => {
        const every = [
            ...['PENDING', 'VERIFIED', 'REJECTED', 'REVIEWED', 'RESOLVED', 'PUBLISHED', undefined].map((s) => issue(s)),
            ...['PENDING', 'VERIFIED', 'REJECTED', 'PUBLISHED', undefined].map((s) => positive(s)),
        ];

        for (const report of every) {
            expect(isPubliclyVisibleReport(report)).toBe(isCountedCommunityReport(report));
        }
    });
});

describe('MY REPORTS', () => {
    it("shows the author their own PENDING issue", () => {
        expect(canViewReport(issue('PENDING', AUTHOR), passenger(AUTHOR))).toBe(true);
    });

    it('shows the author their own REJECTED issue', () => {
        expect(canViewReport(issue('REJECTED', AUTHOR), passenger(AUTHOR))).toBe(true);
    });

    it("hides another passenger's PENDING issue", () => {
        expect(canViewReport(issue('PENDING', AUTHOR), passenger(OTHER))).toBe(false);
    });

    it("hides another passenger's REJECTED issue", () => {
        expect(canViewReport(issue('REJECTED', AUTHOR), passenger(OTHER))).toBe(false);
    });

    it("shows another passenger's VERIFIED issue and positive feedback", () => {
        expect(canViewReport(issue('VERIFIED', AUTHOR), passenger(OTHER))).toBe(true);
        expect(canViewReport(positive('PUBLISHED', AUTHOR), passenger(OTHER))).toBe(true);
    });

    it('never treats a session with no passenger id as the author', () => {
        expect(canViewReport(issue('PENDING', ''), { role: 'PASSENGER' })).toBe(false);
        expect(canViewReport(issue('PENDING', AUTHOR), null)).toBe(false);
    });

    it("badges an issue with its review status for its author, and positive feedback not at all", () => {
        expect(reportListStatusBadge(issue('PENDING') as AccessibilityReport, 'my')).toBe('PENDING');
        expect(reportListStatusBadge(issue('VERIFIED') as AccessibilityReport, 'my')).toBe('VERIFIED');
        expect(reportListStatusBadge(issue('REJECTED') as AccessibilityReport, 'my')).toBe('REJECTED');
        expect(reportListStatusBadge(positive('PUBLISHED') as AccessibilityReport, 'my')).toBeNull();
    });

    it('never shows a passenger the internal PUBLISHED status', () => {
        for (const status of ['PUBLISHED', 'PENDING', 'VERIFIED']) {
            expect(passengerReportStatusBadge(positive(status))).toBeNull();
        }
    });
});

describe('ADMIN', () => {
    it('sees every report, pending and rejected issues included', () => {
        for (const report of [issue('PENDING', OTHER), issue('REJECTED', OTHER), positive('PUBLISHED', OTHER)]) {
            expect(canViewReport(report, admin)).toBe(true);
        }
    });

    it('shows positive feedback as "Verified" through a display-only key, not PUBLISHED', () => {
        const feedback = positive('PUBLISHED');

        expect(adminReportDisplayStatus(feedback)).toBe(ADMIN_POSITIVE_FEEDBACK_DISPLAY_STATUS);
        expect(adminReportDisplayStatus(feedback)).not.toBe('PUBLISHED');
        // Not the VERIFIED an admin's decision stores, either.
        expect(adminReportDisplayStatus(feedback)).not.toBe('VERIFIED');
    });

    it('leaves the stored status PUBLISHED', () => {
        const feedback = positive('PUBLISHED');

        adminReportDisplayStatus(feedback);

        expect(feedback.status).toBe('PUBLISHED');
    });
});
