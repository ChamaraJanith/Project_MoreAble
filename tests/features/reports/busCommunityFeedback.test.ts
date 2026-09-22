// Viewing a bus's community standing (MOV-80): how the average rating reads,
// which verified reports belong to one bus, what the two reads ask the API for,
// and where the three pieces of information actually appear on screen.
//
// The average itself is not computed here and is not computed in the app — it
// comes from the server (MOV-116). What is tested is everything the app does
// decide: the wording, the empty state, the filtering and the ordering.

import * as fs from 'fs';
import * as path from 'path';
import { AccessibilityReport } from '../../../src/entities/report/model/types';
import {
    BUS_RATING_SUMMARY_PATH,
    VERIFIED_REPORTS_PATH,
    getBusRatingSummary,
    getVerifiedBusReports,
    readBusRatingSummary,
} from '../../../src/features/reports/api/busCommunityApi';
import {
    NO_RATINGS_LABEL,
    describeRatingSummary,
    formatAverageRating,
    ratingCountLabel,
    selectVerifiedBusReports,
} from '../../../src/features/reports/utils/busCommunityFeedback';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ------------------------------------------------------------------
describe('the average rating, as it reads', () => {
    it('shows one decimal place, so 5 stars reads as 5.0 and not as a rounder number', () => {
        expect(formatAverageRating(4.6)).toBe('4.6');
        expect(formatAverageRating(5)).toBe('5.0');
        expect(formatAverageRating(4.25)).toBe('4.3');
    });

    it('has no average for anything that is not a finite number', () => {
        expect(formatAverageRating(null)).toBeNull();
        expect(formatAverageRating(undefined)).toBeNull();
        expect(formatAverageRating(Number.NaN)).toBeNull();
        expect(formatAverageRating(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('counts ratings in words, singular and plural', () => {
        expect(ratingCountLabel(1)).toBe('1 rating');
        expect(ratingCountLabel(24)).toBe('24 ratings');
        expect(ratingCountLabel(0)).toBe('0 ratings');
    });

    it('describes a rated bus as the average, the count and one spoken sentence', () => {
        const display = describeRatingSummary({ busId: 'BUS-A', average: 4.6, count: 24 });

        expect(display.hasRatings).toBe(true);
        expect(display.averageLabel).toBe('4.6');
        expect(display.countLabel).toBe('24 ratings');
        expect(display.compactLabel).toBe('4.6 (24)');
        expect(display.accessibilityLabel).toBe(
            'Average passenger rating 4.6 out of 5, from 24 ratings.'
        );
    });
});

// ------------------------------------------------------------------
describe('a bus nobody has rated', () => {
    const empty = [
        ['no summary at all', null],
        ['an absent summary', undefined],
        ['zero ratings', { busId: 'BUS-A', average: null, count: 0 }],
        // Contradictory halves: neither is reconstructed from the other.
        ['a count with no average', { busId: 'BUS-A', average: null, count: 7 }],
        ['an average with no count', { busId: 'BUS-A', average: 4.2, count: 0 }],
        ['an unusable average', { busId: 'BUS-A', average: Number.NaN, count: 3 }],
    ] as const;

    it.each(empty)('reads "No ratings yet" for %s', (_case, summary) => {
        const display = describeRatingSummary(summary as any);

        expect(display.hasRatings).toBe(false);
        expect(display.compactLabel).toBe(NO_RATINGS_LABEL);
    });

    it('never shows a 0.0, which would be a verdict the ratings never gave', () => {
        const display = describeRatingSummary({ busId: 'BUS-A', average: null, count: 0 });

        expect(display.averageLabel).toBeNull();
        expect(display.compactLabel).not.toContain('0.0');
        expect(display.compactLabel).not.toMatch(/\d/);
        expect(display.accessibilityLabel).toBe('No passenger ratings for this bus yet.');
    });

    it('says nothing about a count when there is no average to count toward', () => {
        expect(describeRatingSummary({ busId: 'BUS-A', average: null, count: 0 }).countLabel).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('which community feedback a passenger is shown', () => {
    const report = (over: Partial<AccessibilityReport>): AccessibilityReport =>
        ({
            reportId: 'REP-1',
            passengerId: 'PAS-1',
            issueCategory: 'BROKEN_RAMP',
            description: 'Ramp jammed halfway.',
            status: 'VERIFIED',
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-01T10:00:00.000Z',
            busId: 'BUS-A',
            ...over,
        }) as AccessibilityReport;

    it('shows verified reports about this bus', () => {
        const picked = selectVerifiedBusReports([report({ reportId: 'REP-1' })], 'BUS-A');

        expect(picked.map((entry) => entry.reportId)).toEqual(['REP-1']);
    });

    it('shows nothing that an administrator has not verified', () => {
        const reports = [
            report({ reportId: 'PENDING', status: 'PENDING' }),
            report({ reportId: 'REJECTED', status: 'REJECTED' }),
            report({ reportId: 'REVIEWED', status: 'REVIEWED' }),
            report({ reportId: 'RESOLVED', status: 'RESOLVED' }),
            report({ reportId: 'VERIFIED' }),
        ];

        expect(selectVerifiedBusReports(reports, 'BUS-A').map((e) => e.reportId)).toEqual([
            'VERIFIED',
        ]);
    });

    it('shows nothing filed against another bus, or against no bus', () => {
        const reports = [
            report({ reportId: 'OTHER-BUS', busId: 'BUS-B' }),
            report({ reportId: 'NO-BUS', busId: undefined }),
            report({ reportId: 'THIS-BUS' }),
        ];

        expect(selectVerifiedBusReports(reports, 'BUS-A').map((e) => e.reportId)).toEqual([
            'THIS-BUS',
        ]);
    });

    it('matches nothing at all when no bus is named', () => {
        const reports = [report({ busId: undefined }), report({})];

        expect(selectVerifiedBusReports(reports, '')).toEqual([]);
        expect(selectVerifiedBusReports(reports, '   ')).toEqual([]);
    });

    it('puts the most recent feedback first', () => {
        const reports = [
            report({ reportId: 'OLD', createdAt: '2026-08-01T10:00:00.000Z' }),
            report({ reportId: 'NEWEST', createdAt: '2026-09-20T10:00:00.000Z' }),
            report({ reportId: 'MIDDLE', createdAt: '2026-09-01T10:00:00.000Z' }),
        ];

        expect(selectVerifiedBusReports(reports, 'BUS-A').map((e) => e.reportId)).toEqual([
            'NEWEST',
            'MIDDLE',
            'OLD',
        ]);
    });

    it('sorts a report with an unreadable date last rather than reordering the rest', () => {
        const reports = [
            report({ reportId: 'BROKEN', createdAt: 'not a date' }),
            report({ reportId: 'OLD', createdAt: '2026-08-01T10:00:00.000Z' }),
            report({ reportId: 'NEW', createdAt: '2026-09-20T10:00:00.000Z' }),
        ];

        expect(selectVerifiedBusReports(reports, 'BUS-A').map((e) => e.reportId)).toEqual([
            'NEW',
            'OLD',
            'BROKEN',
        ]);
    });

    it('cuts the list to the limit, keeping the most recent', () => {
        const reports = [
            report({ reportId: 'A', createdAt: '2026-09-03T10:00:00.000Z' }),
            report({ reportId: 'B', createdAt: '2026-09-02T10:00:00.000Z' }),
            report({ reportId: 'C', createdAt: '2026-09-01T10:00:00.000Z' }),
        ];

        expect(selectVerifiedBusReports(reports, 'BUS-A', 2).map((e) => e.reportId)).toEqual([
            'A',
            'B',
        ]);
    });

    it('survives an empty, absent or ragged list', () => {
        expect(selectVerifiedBusReports([], 'BUS-A')).toEqual([]);
        expect(selectVerifiedBusReports(null, 'BUS-A')).toEqual([]);
        expect(selectVerifiedBusReports([null, undefined], 'BUS-A')).toEqual([]);
    });
});

// ------------------------------------------------------------------
describe('what the app asks the API for', () => {
    const originalFetch = global.fetch;
    let mockFetch: jest.Mock;

    beforeEach(() => {
        mockFetch = jest.fn();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    const respond = (status: number, body: unknown) =>
        mockFetch.mockResolvedValueOnce({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        });

    it('asks MOV-116 for one bus summary, with the session token', async () => {
        respond(200, { success: true, summary: { busId: 'BUS-A', average: 4.6, count: 24 } });

        const result = await getBusRatingSummary('tok', 'BUS-A');

        expect(mockFetch.mock.calls[0][0]).toBe('/api/buses/BUS-A/ratings');
        expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
        expect(result).toEqual({
            ok: true,
            value: { busId: 'BUS-A', average: 4.6, count: 24 },
        });
    });

    it('escapes a bus id into the path', () => {
        expect(BUS_RATING_SUMMARY_PATH('BUS A/1')).toBe('/api/buses/BUS%20A%2F1/ratings');
    });

    it('parses the exact envelope the MOV-116 route returns', async () => {
        // The real response, verbatim: success, a message, and the summary.
        respond(200, {
            success: true,
            message: 'Bus ratings retrieved successfully.',
            summary: { busId: 'BUS-A', average: 13 / 3, count: 3 },
        });

        const result = await getBusRatingSummary('tok', 'BUS-A');

        expect(result.ok && result.value.count).toBe(3);
        expect(result.ok && result.value.average).toBeCloseTo(4.3333333, 6);
        // The server sends the exact mean; the screen is what rounds it, once.
        expect(describeRatingSummary(result.ok ? result.value : null).averageLabel).toBe('4.3');
    });

    it('carries an unrated bus through as no ratings, not as zero stars', async () => {
        respond(200, {
            success: true,
            message: 'Bus ratings retrieved successfully.',
            summary: { busId: 'BUS-A', average: null, count: 0 },
        });

        const result = await getBusRatingSummary('tok', 'BUS-A');

        expect(result).toEqual({ ok: true, value: { busId: 'BUS-A', average: null, count: 0 } });
        expect(describeRatingSummary(result.ok ? result.value : null).compactLabel).toBe(
            NO_RATINGS_LABEL
        );
    });

    it('treats a route that is not served as unavailable, not as an error', async () => {
        respond(404, { success: false, message: 'Not found.' });

        const result = await getBusRatingSummary('tok', 'BUS-A');

        expect(result.ok).toBe(false);
        expect(!result.ok && result.reason).toBe('UNAVAILABLE');
    });

    it('reports a genuine failure as an error', async () => {
        respond(500, { success: false, message: 'Boom.' });

        const result = await getBusRatingSummary('tok', 'BUS-A');

        expect(!result.ok && result.reason).toBe('ERROR');
    });

    it('asks for nothing without a bus or a session', async () => {
        expect((await getBusRatingSummary('tok', '')).ok).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rebuilds a malformed summary as "no ratings" rather than a NaN', () => {
        expect(readBusRatingSummary({ summary: { average: 'four', count: 9 } }, 'BUS-A')).toEqual({
            busId: 'BUS-A',
            average: null,
            count: 9,
        });
        expect(readBusRatingSummary({}, 'BUS-A')).toEqual({
            busId: 'BUS-A',
            average: null,
            count: 0,
        });
        // A count of zero cannot carry an average, whatever the payload claims.
        expect(readBusRatingSummary({ summary: { average: 4.5, count: 0 } }, 'BUS-A')).toEqual({
            busId: 'BUS-A',
            average: null,
            count: 0,
        });
    });

    it('reads verified reports from the existing slice and narrows them here', async () => {
        respond(200, {
            success: true,
            reports: [
                { reportId: 'MINE', status: 'VERIFIED', busId: 'BUS-A', createdAt: '2026-09-02T00:00:00.000Z' },
                { reportId: 'PENDING', status: 'PENDING', busId: 'BUS-A', createdAt: '2026-09-03T00:00:00.000Z' },
                { reportId: 'OTHER', status: 'VERIFIED', busId: 'BUS-B', createdAt: '2026-09-04T00:00:00.000Z' },
            ],
        });

        const result = await getVerifiedBusReports('tok', 'BUS-A');

        expect(mockFetch.mock.calls[0][0]).toBe(VERIFIED_REPORTS_PATH);
        expect(result.ok && result.value.map((entry) => entry.reportId)).toEqual(['MINE']);
    });

    it('does not invent a second listing route for reports', () => {
        expect(VERIFIED_REPORTS_PATH).toBe('/api/reports?scope=verified');
    });
});

// ------------------------------------------------------------------
describe('where the three things actually appear', () => {
    const card = read('src/features/journey/ui/JourneyOptionCard.tsx');
    const details = read('src/features/journey/ui/RouteDetailsScreen.tsx');
    const feedback = read('src/features/reports/ui/BusCommunityFeedbackScreen.tsx');
    const summaryView = read('src/features/reports/ui/BusRatingSummaryView.tsx');

    it('puts a compact rating in the bus section of a search result card', () => {
        expect(card).toContain('BusRatingSummaryCompact');
        expect(card).toContain('bus.passengerRating');
    });

    it('keeps the accessibility score on the card beside it, unchanged', () => {
        expect(card).toContain('accessibilityScoreColor');
        expect(card).toContain('{accessibilityScore}%');
    });

    it('does not put reports or reviews on the search result card', () => {
        expect(card).not.toContain('ReportListCard');
        expect(card).not.toContain('selectVerifiedBusReports');
    });

    it('puts a rating summary on Route Details with a way through to the feedback', () => {
        expect(details).toContain('BusRatingSummaryCard');
        expect(details).toContain('JOURNEY_COMMUNITY_FEEDBACK_PATH');
        expect(summaryView).toContain('View community feedback');
    });

    it('does not list reports on Route Details', () => {
        expect(details).not.toContain('ReportListCard');
    });

    it('shows the bus, the average and the verified feedback on the feedback screen', () => {
        expect(feedback).toContain('Community Feedback');
        expect(feedback).toContain('BusRatingSummaryCard');
        expect(feedback).toContain('getVerifiedBusReports');
        expect(feedback).toContain('ReportListCard');
    });

    it('reuses the existing report card rather than a second one', () => {
        expect(feedback).toContain('reportCardSummary');
    });

    it('never exposes the admin side of a review to a passenger', () => {
        expect(feedback).not.toContain('adminRemark');
        expect(feedback).not.toContain('reviewedBy');
        expect(summaryView).not.toContain('adminRemark');
    });

    it('labels the rating as the passengers’ own, never as the accessibility score', () => {
        expect(summaryView).toContain('Passenger rating');
        expect(summaryView).not.toContain('accessibilityScore');
        expect(summaryView).not.toContain('computeAccessibilityScore');
    });

    it('always writes the number beside the star, never colour or icon alone', () => {
        expect(summaryView).toContain('display.averageLabel');
        expect(summaryView).toContain('accessibilityLabel={display.accessibilityLabel}');
    });

    it('is a reading, not a control: no rating can be submitted from it', () => {
        expect(summaryView).not.toContain('submitBusRating');
    });
});

// ------------------------------------------------------------------
// The MOV-116 backend, as the screens consume it.
// ------------------------------------------------------------------
describe('the rating the screens show is the backend’s', () => {
    const search = read('app/api/journeys/search+api.ts');
    const details = read('src/features/journey/ui/RouteDetailsScreen.tsx');
    const route = read('app/api/buses/[busId]/ratings+api.ts');

    it('the search response carries the summary the result card reads', () => {
        expect(search).toContain('passengerRating: busRatingSummaryFromTally(');
    });

    it('the search derives it from evidence it had already read, not a new query', () => {
        // The tally handed in is the one the accessibility score was built from,
        // so the rating costs no extra Firestore read and cannot belong to a
        // different bus than the score beside it.
        expect(search).toContain('busRatingSummaryFromTally(evidence.ratings, bus.busId)');
    });

    it('the search still reports the accessibility score separately', () => {
        expect(search).toContain('accessibilityScore: computeAccessibilityScore(');
    });

    it('the endpoint the client calls is the endpoint that exists', () => {
        expect(BUS_RATING_SUMMARY_PATH('BUS-A')).toBe('/api/buses/BUS-A/ratings');
        expect(route).toContain('export async function GET');
        expect(route).toContain('loadBusRatingSummary');
    });

    it('Route Details shows a summary the search already carried without a loading flash', () => {
        expect(details).toContain('const seededRating = bus?.passengerRating ?? null;');
        expect(details).toMatch(/seededRating \? 'READY'/);
    });

    it('Route Details still refreshes it from the endpoint', () => {
        expect(details).toContain('getBusRatingSummary(token, bus.busId)');
    });

    it('reading ratings never writes accessibility score history', () => {
        expect(route).not.toContain('recordAccessibilityScore');
        expect(route).not.toContain('accessibilityScoreHistory');
    });

    it('the endpoint does not serve reports, which already have one', () => {
        expect(route).not.toContain('getVerifiedBusReports');
        expect(route).not.toContain("collection('reports')");
    });
});
