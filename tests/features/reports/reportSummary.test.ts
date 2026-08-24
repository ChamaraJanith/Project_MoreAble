// What a report shows on a card and on the details screen.
//
// Two things are worth pinning down here. The first is that the report id is
// not on the card any more: it read as a reference number a passenger was
// expected to quote, which is not how the feature works. The second is that the
// details screen shows every photo — a gallery that quietly stopped short would
// be hiding evidence from the person reviewing it.

import { AccessibilityReport } from '../../../src/entities/report/model/types';
import { formatReportDateTime } from '../../../src/features/reports/utils/reportFormat';
import {
    galleryColumnsForWidth,
    hasBeenEdited,
    reportCardSummary,
    reportCardVisibleText,
    reportGalleryPhotos,
    reportJourneyEntries,
    reportReviewOutcome,
    reportTimelineRows,
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

/** The bus half of the journey section. */
function busEntry(input: AccessibilityReport) {
    return reportJourneyEntries(input)[0];
}

/** The route half. */
function routeEntry(input: AccessibilityReport) {
    return reportJourneyEntries(input)[1];
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

describe('what a screen reader announces for a card', () => {
    it('says what tapping the card does, and which report it opens', () => {
        // The whole card is one control, so it gets one label rather than a
        // scattering of separately readable fragments.
        expect(reportCardSummary(report()).accessibilityLabel).toBe(
            'View accessibility report: Broken Wheelchair Ramp, 0 comments, 0 agree, 0 disagree'
        );
    });

    it('names the issue the same way the card shows it', () => {
        const summary = reportCardSummary(report({ issueCategory: 'BUS_OVERCROWDED' }));

        expect(summary.accessibilityLabel).toContain(summary.title);
    });

    it('does not read out the report id', () => {
        expect(reportCardSummary(report()).accessibilityLabel).not.toContain('REP-');
    });

    it('announces all three tallies the card draws', () => {
        // The numbers are drawn beside the icons, and an icon row is hidden
        // from screen readers — so the card's one label is where they have to
        // be said, or they are said to nobody.
        expect(
            reportCardSummary(report({ commentCount: 2, agreeCount: 18, disagreeCount: 1 }))
                .accessibilityLabel
        ).toBe(
            'View accessibility report: Broken Wheelchair Ramp, 2 comments, 18 agree, 1 disagree'
        );
    });

    it('pluralises a single comment', () => {
        expect(
            reportCardSummary(report({ commentCount: 1 })).accessibilityLabel
        ).toContain('1 comment,');
    });
});

// ==================================================================
// Community feedback on a card
// ==================================================================
describe('the feedback tallies on a card', () => {
    it('takes all three counts from the report data', () => {
        // The votes are written onto the report by POST
        // /api/reports/:reportId/vote and the comment count is attached by
        // GET /api/reports — so a list of thirty cards still costs the one
        // request it always did.
        expect(
            reportCardSummary(report({ commentCount: 2, agreeCount: 18, disagreeCount: 1 }))
                .feedbackCounts
        ).toEqual({ commentCount: 2, agreeCount: 18, disagreeCount: 1 });
    });

    it('reads a report nobody has answered as three zeroes', () => {
        expect(reportCardSummary(report()).feedbackCounts).toEqual({
            commentCount: 0,
            agreeCount: 0,
            disagreeCount: 0,
        });
    });

    it('shows a real zero on a side nobody took', () => {
        expect(reportCardSummary(report({ agreeCount: 3 })).feedbackCounts).toEqual({
            commentCount: 0,
            agreeCount: 3,
            disagreeCount: 0,
        });
    });

    it('reads a comment count of zero as zero rather than as missing', () => {
        expect(
            reportCardSummary(report({ commentCount: 0, agreeCount: 4 })).feedbackCounts
                .commentCount
        ).toBe(0);
    });

    it('falls back to zero rather than breaking on a value it cannot use', () => {
        const counts = reportCardSummary(
            report({
                commentCount: undefined,
                agreeCount: 'many' as unknown as number,
                disagreeCount: -3,
            })
        ).feedbackCounts;

        expect(counts).toEqual({ commentCount: 0, agreeCount: 0, disagreeCount: 0 });
    });

    it('never invents a count of its own', () => {
        const counts = reportCardSummary(
            report({ commentCount: 2, agreeCount: 4, disagreeCount: 1 })
        ).feedbackCounts;

        expect(counts.commentCount).toBe(2);
        expect(counts.agreeCount).toBe(4);
        expect(counts.disagreeCount).toBe(1);
    });
});

// ==================================================================
// Journey details
// ==================================================================
describe('the journey section', () => {
    it('always shows both halves of the journey', () => {
        // A fixed shape: an absent bus is stated, not implied by a gap.
        expect(reportJourneyEntries(report()).map((entry) => entry.label)).toEqual([
            'Bus / Vehicle',
            'Route',
        ]);
    });

    it('leads the bus row with its number plate', () => {
        expect(busEntry(report()).primary).toBe('NB-1234');
    });

    it('puts the model and manufacturer underneath', () => {
        expect(busEntry(report()).secondary).toBe('Rosa · Mitsubishi');
    });

    it('shows only what the vehicle snapshot actually holds', () => {
        const entry = busEntry(report({ vehicle: { numberPlate: 'NB-1234' } }));

        expect(entry.primary).toBe('NB-1234');
        expect(entry.secondary).toBeUndefined();
    });

    it('reads the route as its number and name together', () => {
        expect(routeEntry(report()).primary).toBe('138 · Colombo - Kandy');
    });

    it('puts the direction underneath, in words', () => {
        expect(routeEntry(report()).secondary).toBe('Outbound');
        expect(
            routeEntry(report({ route: { routeNumber: '400', direction: 'RETURN' } })).secondary
        ).toBe('Return');
    });

    it('shows the route number alone when the snapshot has no name', () => {
        expect(routeEntry(report({ route: { routeNumber: '138' } })).primary).toBe('138');
    });

    it('falls back to the raw ids when the snapshots are missing', () => {
        const bare = report({ vehicle: undefined, route: undefined });

        expect(busEntry(bare).primary).toBe('BUS-00007');
        expect(routeEntry(bare).primary).toBe('R-138-OUT');
    });

    it('has no value at all for a journey half that was never recorded', () => {
        // Which the screen renders as "Not provided" — a normal report, since
        // the passenger may not have known the vehicle.
        const noBus = report({ busId: undefined, vehicle: undefined });

        expect(busEntry(noBus).primary).toBeNull();
        expect(routeEntry(noBus).primary).not.toBeNull();
    });

    it('still lists both rows when neither was recorded', () => {
        const neither = report({
            busId: undefined,
            vehicle: undefined,
            routeId: undefined,
            route: undefined,
        });

        expect(reportJourneyEntries(neither)).toHaveLength(2);
        expect(reportJourneyEntries(neither).every((entry) => entry.primary === null)).toBe(true);
    });
});

// ==================================================================
// Timeline
// ==================================================================
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
        expect(reportTimelineRows(report()).some((row) => row.label === 'Last Updated')).toBe(
            false
        );
    });
});

describe('whether a report has been edited', () => {
    it('is false on a report nobody has touched', () => {
        // Which is what keeps the timeline section off the screen entirely:
        // the hero already says when the report was submitted.
        expect(hasBeenEdited(report())).toBe(false);
    });

    it('is true once the two timestamps differ', () => {
        expect(hasBeenEdited(report({ updatedAt: '2026-08-22T09:30:00.000Z' }))).toBe(true);
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

describe('how wide the gallery grid is', () => {
    it('uses three columns on an ordinary phone', () => {
        expect(galleryColumnsForWidth(390)).toBe(3);
        expect(galleryColumnsForWidth(412)).toBe(3);
    });

    it('drops to two on a narrow screen', () => {
        // Three tiles across a 320pt phone are too small to make out what the
        // photo shows, which is the whole point of the grid.
        expect(galleryColumnsForWidth(320)).toBe(2);
    });

    it('never asks for fewer than two', () => {
        [280, 320, 360, 390, 430, 768].forEach((width) => {
            expect(galleryColumnsForWidth(width)).toBeGreaterThanOrEqual(2);
        });
    });
});

// ==================================================================
// What the admin decided
//
// The passenger who filed a report is the one person entitled to learn what
// became of it — including that it was rejected. These pin down that a report
// nobody has looked at shows no decision at all, that one that has been shows
// the wording rather than the stored value, and that the reviewing admin's uid
// never travels with it.
// ==================================================================
describe('the admin review shown to the passenger', () => {
    const REVIEWED_AT = '2026-08-23T11:00:00.000Z';

    it('is absent on a freshly submitted report', () => {
        // Nothing has been decided, and the Pending badge already says so.
        expect(reportReviewOutcome(report())).toBeNull();
    });

    it('shows the decision in words, not as a stored value', () => {
        const outcome = reportReviewOutcome(
            report({ status: 'VERIFIED', reviewedAt: REVIEWED_AT })
        );

        expect(outcome?.statusLabel).toBe('Verified');
    });

    it('shows a rejection to the passenger who filed it', () => {
        const outcome = reportReviewOutcome(
            report({
                status: 'REJECTED',
                reviewedAt: REVIEWED_AT,
                adminRemark: 'Duplicate of REP-00003.',
            })
        );

        expect(outcome?.statusLabel).toBe('Rejected');
        expect(outcome?.remark).toBe('Duplicate of REP-00003.');
    });

    it('formats when it was reviewed the way every other date is formatted', () => {
        const outcome = reportReviewOutcome(
            report({ status: 'VERIFIED', reviewedAt: REVIEWED_AT })
        );

        expect(outcome?.reviewedAt).toBe(formatReportDateTime(REVIEWED_AT));
    });

    it('carries the remark even when no decision was recorded with it', () => {
        // REMARK leaves the report where it stood, so a pending report can
        // carry something an admin wrote about it.
        const outcome = reportReviewOutcome(
            report({ adminRemark: 'Chasing the depot for a repair date.' })
        );

        expect(outcome?.statusLabel).toBe('Pending');
        expect(outcome?.remark).toBe('Chasing the depot for a repair date.');
        expect(outcome?.reviewedAt).toBeNull();
    });

    it('treats a blank remark as no remark', () => {
        expect(reportReviewOutcome(report({ adminRemark: '   ' }))).toBeNull();

        const outcome = reportReviewOutcome(
            report({ status: 'VERIFIED', reviewedAt: REVIEWED_AT, adminRemark: '  ' })
        );

        expect(outcome?.remark).toBeNull();
    });

    it('never carries the reviewing admin uid', () => {
        const outcome = reportReviewOutcome(
            report({
                status: 'VERIFIED',
                reviewedAt: REVIEWED_AT,
                reviewedBy: 'UID-ADMIN-0001',
                adminRemark: 'Depot confirmed the ramp motor had failed.',
            })
        );

        expect(JSON.stringify(outcome)).not.toContain('UID-ADMIN-0001');
    });

    it('falls back to an unknown status rather than inventing wording', () => {
        const outcome = reportReviewOutcome(
            report({ status: 'ESCALATED', reviewedAt: REVIEWED_AT })
        );

        expect(outcome?.statusLabel).toBe('ESCALATED');
    });
});
