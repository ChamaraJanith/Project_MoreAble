// Which controls a report offers, and to whom.
//
// The app decides this to draw Edit and Delete; the API decides it again, from
// the verified token, before changing anything. These tests cover the app's
// half — that the buttons appear on the passenger's own reports and on nobody
// else's. The half that actually protects a report is covered in
// tests/api/reports/reportById+api.route.test.ts.

import {
    canDeleteReport,
    canEditReport,
    isReportOwnedBy,
    reportActionsFor,
} from '../../../src/features/reports/utils/reportOwnership';

const OWNER = 'PSG-00001';
const OTHER_PASSENGER = 'PSG-00002';

const ownReport = { passengerId: OWNER };
const someoneElsesReport = { passengerId: OTHER_PASSENGER };

describe('who owns a report', () => {
    it('recognises the passenger who filed it', () => {
        expect(isReportOwnedBy(ownReport, OWNER)).toBe(true);
    });

    it('does not recognise anybody else', () => {
        expect(isReportOwnedBy(someoneElsesReport, OWNER)).toBe(false);
    });

    it('owns nothing without a session', () => {
        expect(isReportOwnedBy(ownReport, null)).toBe(false);
        expect(isReportOwnedBy(ownReport, undefined)).toBe(false);
        expect(isReportOwnedBy(ownReport, '')).toBe(false);
    });

    it('treats a report with no author as nobody‘s', () => {
        // Not everybody's: an empty passengerId matching an empty session is
        // the one comparison that must not come out true.
        expect(isReportOwnedBy({ passengerId: '' }, '')).toBe(false);
        expect(isReportOwnedBy(null, OWNER)).toBe(false);
        expect(isReportOwnedBy(undefined, OWNER)).toBe(false);
    });
});

describe('editing', () => {
    it('is offered to the owner', () => {
        expect(canEditReport(ownReport, OWNER)).toBe(true);
    });

    it('is not offered on another passenger‘s report', () => {
        expect(canEditReport(someoneElsesReport, OWNER)).toBe(false);
    });

    it('stays available while the report is under review', () => {
        // Correcting a description is exactly what a passenger asked for more
        // detail has to do, so the review status is not part of the decision.
        expect(canEditReport(ownReport, OWNER)).toBe(true);
    });
});

describe('deleting', () => {
    it('is offered to the owner', () => {
        expect(canDeleteReport(ownReport, OWNER)).toBe(true);
    });

    it('is not offered on another passenger‘s report', () => {
        expect(canDeleteReport(someoneElsesReport, OWNER)).toBe(false);
    });
});

describe('the actions a card shows', () => {
    it('gives the owner all three', () => {
        expect(reportActionsFor(ownReport, OWNER)).toEqual(['view', 'edit', 'delete']);
    });

    it('gives everybody else viewing only', () => {
        // All Reports lists every passenger's reports, so opening one is
        // expected; changing it is not.
        expect(reportActionsFor(someoneElsesReport, OWNER)).toEqual(['view']);
    });

    it('gives a signed-out session viewing only', () => {
        expect(reportActionsFor(ownReport, null)).toEqual(['view']);
    });

    it('always offers viewing', () => {
        [OWNER, OTHER_PASSENGER, null, undefined].forEach((passengerId) => {
            expect(reportActionsFor(ownReport, passengerId)).toContain('view');
        });
    });
});
