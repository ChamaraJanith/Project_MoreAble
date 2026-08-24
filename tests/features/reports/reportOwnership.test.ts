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
    isReportOpenToChange,
    isReportOwnedBy,
    reportActionsFor,
} from '../../../src/features/reports/utils/reportOwnership';

const OWNER = 'PSG-00001';
const OTHER_PASSENGER = 'PSG-00002';

const ownReport = { passengerId: OWNER, status: 'PENDING' };
const someoneElsesReport = { passengerId: OTHER_PASSENGER, status: 'PENDING' };

/** The author's own report, in whatever state a review has left it. */
const ownReportWith = (status: string) => ({ passengerId: OWNER, status });

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

    it('stays available while the report is still pending a decision', () => {
        // Correcting a description is exactly what a passenger asked for more
        // detail has to do, so waiting to be reviewed does not close a report.
        expect(canEditReport(ownReportWith('PENDING'), OWNER)).toBe(true);
    });

    it('is not offered on a report an admin has verified', () => {
        // MOV-272: a verified report is a finding somebody stands behind, and
        // editing the account underneath it would change what was verified.
        expect(canEditReport(ownReportWith('VERIFIED'), OWNER)).toBe(false);
    });

    it('is not offered on a report an admin has rejected', () => {
        expect(canEditReport(ownReportWith('REJECTED'), OWNER)).toBe(false);
    });

    it('is not offered on any state past pending, known or not', () => {
        // Widened deliberately: a status the backend introduces later is a
        // decision this app has not heard of, not an open report.
        ['REVIEWED', 'RESOLVED', 'ESCALATED'].forEach((status) => {
            expect(canEditReport(ownReportWith(status), OWNER)).toBe(false);
        });
    });

    it('treats a report with no stored status as pending', () => {
        // POST /api/reports always writes PENDING, so a record without one was
        // written before that was always true — unreviewed, not undecidable.
        expect(canEditReport({ passengerId: OWNER }, OWNER)).toBe(true);
    });
});

describe('whether a report is still open to change at all', () => {
    it('is open while it is pending', () => {
        expect(isReportOpenToChange(ownReportWith('PENDING'))).toBe(true);
        expect(isReportOpenToChange({ passengerId: OWNER })).toBe(true);
    });

    it('is closed once an admin has decided it', () => {
        expect(isReportOpenToChange(ownReportWith('VERIFIED'))).toBe(false);
        expect(isReportOpenToChange(ownReportWith('REJECTED'))).toBe(false);
    });

    it('says nothing about who is asking', () => {
        // Ownership is the other half of the question, asked separately so the
        // details screen can tell the two refusals apart.
        expect(isReportOpenToChange(someoneElsesReport)).toBe(true);
    });

    it('is not a report at all when there is nothing there', () => {
        expect(isReportOpenToChange(null)).toBe(false);
        expect(isReportOpenToChange(undefined)).toBe(false);
    });
});

describe('deleting', () => {
    it('is offered to the owner', () => {
        expect(canDeleteReport(ownReport, OWNER)).toBe(true);
    });

    it('is not offered on another passenger‘s report', () => {
        expect(canDeleteReport(someoneElsesReport, OWNER)).toBe(false);
    });

    it('is not offered once the report has been decided', () => {
        // Deleting a verified report would take the finding out of the record,
        // and deleting a rejected one would erase the answer its author is owed.
        expect(canDeleteReport(ownReportWith('VERIFIED'), OWNER)).toBe(false);
        expect(canDeleteReport(ownReportWith('REJECTED'), OWNER)).toBe(false);
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

    it('leaves the author of a decided report with viewing alone', () => {
        // Which is the whole of what a decision costs them: the report stays
        // readable, with the outcome and the community's feedback on it.
        expect(reportActionsFor(ownReportWith('VERIFIED'), OWNER)).toEqual(['view']);
        expect(reportActionsFor(ownReportWith('REJECTED'), OWNER)).toEqual(['view']);
    });
});
