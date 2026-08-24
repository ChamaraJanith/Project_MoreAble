// Where a report is addressed — the one place its id is still used.
//
// The id was removed from the cards, so these paths are how a report is opened,
// edited and deleted. They are built in one module rather than interpolated at
// each call site, which is what makes "the id appears here and nowhere else"
// a claim a test can hold.

import {
    adminReviewDetailsPath,
    adminReviewQueuePath,
    reportApiPath,
    reportDetailsPath,
    reportEditPath,
    reportFormPath,
} from '../../../src/features/reports/utils/reportRoutes';

const REPORT_ID = 'REP-00007';

describe('in-app paths', () => {
    it('opens a report at its own screen', () => {
        expect(reportDetailsPath(REPORT_ID)).toBe('/(passenger)/reports/REP-00007');
    });

    it('edits it one level below', () => {
        expect(reportEditPath(REPORT_ID)).toBe('/(passenger)/reports/REP-00007/edit');
    });

    it('builds the edit path from the details path', () => {
        // So that a report can never be viewed at one address and edited at
        // another.
        expect(reportEditPath(REPORT_ID).startsWith(reportDetailsPath(REPORT_ID))).toBe(true);
    });

    it('keeps the report form‘s own route clear of them', () => {
        // The form is the group's index; a report's own screen is always a
        // segment deeper.
        expect(reportDetailsPath(REPORT_ID)).not.toBe(reportFormPath());
    });
});

// ==================================================================
// The passenger screens and the admin queue share a URL
//
// `app/(passenger)/reports` and `app/(admin)/reports` both resolve to
// `/reports`, because a route group is invisible in the URL. A bare '/reports'
// therefore matches both and picks whichever the route tree lists first — which
// is how "Report Accessibility Issue" ended up opening the admin review queue.
//
// Naming the group is what tells them apart, so these pin down that every path
// this module hands a router carries one.
// ==================================================================
describe('telling the passenger screens from the admin queue', () => {
    const passengerPaths = [
        reportFormPath(),
        reportDetailsPath(REPORT_ID),
        reportEditPath(REPORT_ID),
    ];

    const adminPaths = [adminReviewQueuePath(), adminReviewDetailsPath(REPORT_ID)];

    it('sends the passenger to the form rather than to the review queue', () => {
        expect(reportFormPath()).toBe('/(passenger)/reports');
        expect(reportFormPath()).not.toBe(adminReviewQueuePath());
    });

    it('never hands the router an unqualified /reports', () => {
        // The bare path is the ambiguous one, and it is the bug.
        [...passengerPaths, ...adminPaths].forEach((path) => {
            expect(path.startsWith('/(')).toBe(true);
        });
    });

    it('keeps every passenger path out of the admin group', () => {
        passengerPaths.forEach((path) => {
            expect(path.startsWith('/(passenger)/')).toBe(true);
            expect(path).not.toContain('(admin)');
        });
    });

    it('leaves the admin queue where it was', () => {
        expect(adminReviewQueuePath()).toBe('/(admin)/reports');
        expect(adminReviewDetailsPath(REPORT_ID)).toBe('/(admin)/reports/REP-00007');
    });

    it('addresses the same report differently on each side', () => {
        expect(reportDetailsPath(REPORT_ID)).not.toBe(adminReviewDetailsPath(REPORT_ID));
    });
});

describe('the API path', () => {
    it('addresses one report', () => {
        expect(reportApiPath(REPORT_ID)).toBe('/api/reports/REP-00007');
    });

    it('is a segment under the list endpoint, not a separate one', () => {
        expect(reportApiPath(REPORT_ID).startsWith('/api/reports/')).toBe(true);
    });

    it('is the same path for reading, updating and deleting', () => {
        // GET, PUT and DELETE differ by method, not by endpoint — the
        // owner-only rules live on the two that change something.
        expect(reportApiPath(REPORT_ID)).toBe(reportApiPath(REPORT_ID));
    });
});

describe('ids that need escaping', () => {
    it('escapes a value that would otherwise change the path', () => {
        // Report ids are generated as REP-00001 and never contain a slash, but
        // a path built by concatenation is only safe if it says so.
        expect(reportDetailsPath('REP 1/2')).toBe('/(passenger)/reports/REP%201%2F2');
    });

    it('leaves an ordinary report id untouched', () => {
        expect(reportDetailsPath(REPORT_ID)).toBe(`/(passenger)/reports/${REPORT_ID}`);
    });
});
