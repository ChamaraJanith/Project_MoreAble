// What a report shows on a card and on the details screen.
//
// Two things are worth pinning down here. The first is that the report id is
// not on the card any more: it read as a reference number a passenger was
// expected to quote, which is not how the feature works. The second is that the
// details screen shows every photo — a gallery that quietly stopped short would
// be hiding evidence from the person reviewing it.

import { AccessibilityReport } from '../../../src/entities/report/model/types';
import {
    reportCardSummary,
    reportCardVisibleText,
    reportGalleryPhotos,
    reportRouteRows,
    reportTimelineRows,
    reportVehicleRows,
} from '../../../src/features/reports/utils/reportSummary';

const REPORT_ID = 'REP-00007';

const PHOTOS = [
    'https://res.cloudinary.com/moreable/image/upload/v1/a.jpg',
    'https://res.cloudinary.com/moreable/image/upload/v1/b.jpg',
    'https://res.cloudinary.com/moreable/image/upload/v1/c.jpg',
];

function report(overrides: Partial<AccessibilityReport> = {}): AccessibilityReport {
    return {
        reportId: REPORT_ID,
        passengerId: 'PSG-00001',
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        createdAt: '2026-08-20T14:05:00.000Z',
        updatedAt: '2026-08-20T14:05:00.000Z',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234', busModel: 'Rosa', manufacturer: 'Mitsubishi' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138', routeName: 'Colombo - Kandy', direction: 'OUTBOUND' },
        photoUrls: PHOTOS,
        ...overrides,
    };
}

// ==================================================================
// The card
// ==================================================================
describe('the report card', () => {
    it('does not show the report id', () => {
        const visible = reportCardVisibleText(reportCardSummary(report()));

        visible.forEach((text) => {
            expect(text).not.toContain(REPORT_ID);
        });
    });

    it('shows no report id even when nothing else is there to show', () => {
        // The id used to sit under the category, where it was the only other
        // line — so a bare report is the case worth checking.
        const bare = report({
            busId: undefined,
            vehicle: undefined,
            routeId: undefined,
            route: undefined,
            photoUrls: undefined,
        });

        reportCardVisibleText(reportCardSummary(bare)).forEach((text) => {
            expect(text).not.toContain('REP-');
        });
    });

    it('leads with the issue, in the wording the picker offered it in', () => {
        expect(reportCardSummary(report()).title).toBe('Broken Wheelchair Ramp');
    });

    it('keeps the description the passenger wrote', () => {
        expect(reportCardSummary(report()).description).toContain('wheelchair ramp');
    });

    it('says when the report was submitted', () => {
        expect(reportCardSummary(report()).submittedLabel).toContain('Submitted');
    });

    it('chips the bus, the route and the photo count', () => {
        const labels = reportCardSummary(report()).chips.map((chip) => chip.label);

        expect(labels).toEqual(['NB-1234', 'Route 138', '3 photos']);
    });

    it('falls back to the raw ids when the snapshot is missing', () => {
        const labels = reportCardSummary(report({ vehicle: undefined, route: undefined })).chips.map(
            (chip) => chip.label
        );

        expect(labels).toContain('BUS-00007');
        expect(labels).toContain('R-138-OUT');
    });

    it('carries no photo chip at all when there are no photos', () => {
        // Absent rather than "0 photos".
        const labels = reportCardSummary(report({ photoUrls: undefined })).chips.map(
            (chip) => chip.label
        );

        expect(labels.some((label) => label.includes('photo'))).toBe(false);
    });

    it('marks the passenger‘s own report when asked to', () => {
        const summary = reportCardSummary(report(), { isOwnReport: true });

        expect(summary.chips.some((chip) => chip.label === 'Your report')).toBe(true);
    });

    it('leaves the mark off by default', () => {
        expect(
            reportCardSummary(report()).chips.some((chip) => chip.label === 'Your report')
        ).toBe(false);
    });
});

// ==================================================================
// The details screen
// ==================================================================
describe('the bus rows', () => {
    it('shows every stored vehicle field', () => {
        const rows = reportVehicleRows(report());

        expect(rows.map((row) => row.value)).toEqual(['NB-1234', 'Rosa', 'Mitsubishi']);
    });

    it('shows only what the snapshot actually holds', () => {
        const rows = reportVehicleRows(
            report({ vehicle: { numberPlate: 'NB-1234' } })
        );

        expect(rows).toHaveLength(1);
    });

    it('is empty for a report filed without a bus', () => {
        // Which is a normal report: the passenger may not have known the
        // vehicle. The screen shows "no bus details", not an error.
        expect(reportVehicleRows(report({ busId: undefined, vehicle: undefined }))).toEqual([]);
    });
});

describe('the route rows', () => {
    it('shows every stored route field', () => {
        const rows = reportRouteRows(report());

        expect(rows.map((row) => row.value)).toEqual(['138', 'Colombo - Kandy', 'Outbound']);
    });

    it('reads the direction as words', () => {
        const rows = reportRouteRows(
            report({ route: { routeNumber: '400', direction: 'RETURN' } })
        );

        expect(rows.map((row) => row.value)).toContain('Return');
    });

    it('is empty for a report filed without a route', () => {
        expect(reportRouteRows(report({ routeId: undefined, route: undefined }))).toEqual([]);
    });
});

describe('the timeline rows', () => {
    it('always says when the report was submitted', () => {
        const rows = reportTimelineRows(report());

        expect(rows.map((row) => row.label)).toEqual(['Submitted']);
    });

    it('adds the edit date once the report has been edited', () => {
        const rows = reportTimelineRows(report({ updatedAt: '2026-08-22T09:30:00.000Z' }));

        expect(rows.map((row) => row.label)).toEqual(['Submitted', 'Last Updated']);
    });

    it('does not report an edit that never happened', () => {
        // On an untouched report the two timestamps are the same moment, and
        // showing it twice reads as an event.
        const rows = reportTimelineRows(report());

        expect(rows.some((row) => row.label === 'Last Updated')).toBe(false);
    });
});

// ==================================================================
// The gallery
// ==================================================================
describe('the photo gallery', () => {
    it('shows every photo attached to the report', () => {
        const photos = reportGalleryPhotos(report());

        expect(photos).toHaveLength(PHOTOS.length);
        expect(photos.map((photo) => photo.url)).toEqual(PHOTOS);
    });

    it('keeps the order the report was filed with', () => {
        expect(reportGalleryPhotos(report()).map((photo) => photo.url)).toEqual(PHOTOS);
    });

    it('numbers each photo for the full-screen viewer', () => {
        const photos = reportGalleryPhotos(report());

        expect(photos.map((photo) => photo.position)).toEqual([1, 2, 3]);
        expect(photos.every((photo) => photo.total === PHOTOS.length)).toBe(true);
    });

    it('labels each photo for a screen reader', () => {
        const [first] = reportGalleryPhotos(report());

        expect(first.accessibilityLabel).toBe(
            'Photo evidence 1 of 3. Tap to view full screen.'
        );
    });

    it('is empty when no photos were attached', () => {
        // What the screen turns into "No photos attached to this report."
        expect(reportGalleryPhotos(report({ photoUrls: undefined }))).toEqual([]);
        expect(reportGalleryPhotos(report({ photoUrls: [] }))).toEqual([]);
    });

    it('serves the stored Cloudinary URLs untouched', () => {
        reportGalleryPhotos(report()).forEach((photo) => {
            expect(photo.url.startsWith('https://res.cloudinary.com/')).toBe(true);
        });
    });
});
