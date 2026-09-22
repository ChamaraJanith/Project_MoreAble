// What the Accessibility Analytics screen puts on screen (MOV-168).
//
// The screen itself cannot be rendered here — the project's Jest is
// `testEnvironment: node` with no React Native renderer — so what it SAYS lives
// in a module and is tested here, the same arrangement reportSummary and
// systemStatistics use. Every assertion below is about a string or a figure the
// screen draws directly from these functions.
//
// The rule running through all of it is the one the backend is careful about
// and a screen is the easiest place to lose: `null` is not `0`. No score, no
// ranked route and no recorded week are each stated as themselves, because a
// screen that renders them as zero tells an admin the platform is failing when
// it is merely new.
//
// Nothing here scores anything. Every number arrives from the API, which got it
// from MOV-79 by way of MOV-169; the band below is a label for a figure that
// already exists.

import {
    ACCESSIBILITY_SCORE_BAND_LABELS,
    NO_AVERAGE_SCORE_CAPTION,
    NO_TREND_DATA_SUMMARY,
    accessibilityScoreBand,
    accessibilityScoreBandLabel,
    averageScoreDisplay,
    formatBusCount,
    formatReportCount,
    formatScore,
    formatTrendDate,
    routeRows,
    trendView,
    vehicleRows,
} from '../../../src/features/admin/utils/accessibilityAnalyticsPresentation';

// ==================================================================
// 1. How a score reads
// ==================================================================
describe('score bands', () => {
    it('names each band at its boundary', () => {
        expect(accessibilityScoreBand(100)).toBe('EXCELLENT');
        expect(accessibilityScoreBand(90)).toBe('EXCELLENT');
        expect(accessibilityScoreBand(89)).toBe('GOOD');
        expect(accessibilityScoreBand(75)).toBe('GOOD');
        expect(accessibilityScoreBand(74)).toBe('MODERATE');
        expect(accessibilityScoreBand(50)).toBe('MODERATE');
        expect(accessibilityScoreBand(49)).toBe('NEEDS_IMPROVEMENT');
        expect(accessibilityScoreBand(0)).toBe('NEEDS_IMPROVEMENT');
    });

    it('words every band', () => {
        expect(accessibilityScoreBandLabel(95)).toBe('Excellent');
        expect(accessibilityScoreBandLabel(80)).toBe('Good');
        expect(accessibilityScoreBandLabel(60)).toBe('Moderate');
        expect(accessibilityScoreBandLabel(20)).toBe('Needs Improvement');
        expect(Object.keys(ACCESSIBILITY_SCORE_BAND_LABELS)).toHaveLength(4);
    });

    it('states a score on one scale wherever it appears', () => {
        expect(formatScore(82)).toBe('82 / 100');
        expect(formatScore(0)).toBe('0 / 100');
    });

    it('counts buses and reports in the singular and the plural', () => {
        expect(formatBusCount(1)).toBe('1 bus');
        expect(formatBusCount(4)).toBe('4 buses');
        expect(formatBusCount(0)).toBe('0 buses');
        expect(formatReportCount(1)).toBe('1 report');
        expect(formatReportCount(12)).toBe('12 reports');
    });
});

// ==================================================================
// 2. Average Accessibility Score
// ==================================================================
describe('average score card', () => {
    it('shows the score, its band and how many buses it rests on', () => {
        const display = averageScoreDisplay({ value: 82, busesIncluded: 5 });

        expect(display.hasScore).toBe(true);
        expect(display.value).toBe('82');
        expect(display.outOf).toBe('/ 100');
        expect(display.bandLabel).toBe('Good');
        expect(display.caption).toBe('Based on 5 buses in service');
    });

    it('states the count in the singular for one bus', () => {
        expect(averageScoreDisplay({ value: 90, busesIncluded: 1 }).caption).toBe(
            'Based on 1 bus in service'
        );
    });

    it('announces the whole card as one label', () => {
        const display = averageScoreDisplay({ value: 91, busesIncluded: 3 });

        expect(display.accessibilityLabel).toBe(
            'Average accessibility score 91 / 100. Excellent. Based on 3 buses in service.'
        );
    });

    it('says there is no score rather than showing a 0', () => {
        const display = averageScoreDisplay({ value: null, busesIncluded: 0 });

        expect(display.hasScore).toBe(false);
        expect(display.value).toBeNull();
        expect(display.value).not.toBe('0');
        expect(display.bandLabel).toBeNull();
        expect(display.caption).toBe(NO_AVERAGE_SCORE_CAPTION);
        expect(display.accessibilityLabel).toContain(NO_AVERAGE_SCORE_CAPTION);
    });

    it('shows a real score of 0 as a score, not as an absence', () => {
        const display = averageScoreDisplay({ value: 0, busesIncluded: 2 });

        expect(display.hasScore).toBe(true);
        expect(display.value).toBe('0');
        expect(display.bandLabel).toBe('Needs Improvement');
        expect(display.caption).toBe('Based on 2 buses in service');
    });

    it('says there is no score when nothing arrived at all', () => {
        expect(averageScoreDisplay(undefined).hasScore).toBe(false);
        expect(averageScoreDisplay(null).hasScore).toBe(false);
    });
});

// ==================================================================
// 3. Most Accessible Routes
// ==================================================================
describe('route rows', () => {
    const routes = [
        {
            routeId: 'R-138-OUT',
            routeNumber: '138',
            routeName: 'Colombo - Fort',
            averageScore: 91,
            busCount: 4,
        },
        {
            routeId: 'R-120-OUT',
            routeNumber: '120',
            routeName: null,
            averageScore: 87,
            busCount: 1,
        },
    ];

    it('shows the rank, number, name, score and bus count', () => {
        const [first] = routeRows(routes);

        expect(first).toEqual(
            expect.objectContaining({
                rank: 1,
                rankLabel: '#1',
                routeNumber: '138',
                routeName: 'Colombo - Fort',
                scoreLabel: '91 / 100',
                bandLabel: 'Excellent',
                busLabel: '4 buses',
            })
        );
    });

    it('ranks by the order the API returned, never re-sorting', () => {
        // Deliberately not in score order — the API owns the ranking.
        const rows = routeRows([
            { ...routes[1], averageScore: 40 },
            { ...routes[0], averageScore: 95 },
        ]);

        expect(rows.map((row) => [row.rank, row.routeNumber])).toEqual([
            [1, '120'],
            [2, '138'],
        ]);
    });

    it('omits the name line on a route stored without one', () => {
        expect(routeRows(routes)[1].routeName).toBeNull();
    });

    it('announces a row as one label', () => {
        expect(routeRows(routes)[0].accessibilityLabel).toBe(
            'Rank 1, route 138, Colombo - Fort, 91 / 100, Excellent, averaged over 4 buses'
        );
    });

    it('states a single contributing bus in the singular', () => {
        expect(routeRows(routes)[1].busLabel).toBe('1 bus');
    });

    it('is an empty list when there is nothing ranked, so the screen shows its empty state', () => {
        expect(routeRows([])).toEqual([]);
        expect(routeRows(null)).toEqual([]);
        expect(routeRows(undefined)).toEqual([]);
    });
});

// ==================================================================
// 4. Most Reported Vehicles
// ==================================================================
describe('vehicle rows', () => {
    const vehicles = [
        {
            busId: 'BUS-00001',
            numberPlate: 'NB-1234',
            busModel: 'Viking',
            manufacturer: 'Ashok Leyland',
            reportCount: 12,
            verifiedReportCount: 8,
        },
        {
            busId: 'BUS-00002',
            numberPlate: 'ND-4567',
            busModel: null,
            manufacturer: null,
            reportCount: 1,
            verifiedReportCount: 0,
        },
    ];

    it('shows the rank, plate, report count and verified count', () => {
        const [first] = vehicleRows(vehicles);

        expect(first).toEqual(
            expect.objectContaining({
                rank: 1,
                rankLabel: '#1',
                numberPlate: 'NB-1234',
                reportLabel: '12 reports',
                verifiedLabel: '8 verified',
            })
        );
    });

    it('states the verified count even when it is zero, which is a real count', () => {
        expect(vehicleRows(vehicles)[1].verifiedLabel).toBe('0 verified');
        expect(vehicleRows(vehicles)[1].reportLabel).toBe('1 report');
    });

    it('describes the vehicle from what the record holds, and omits what it does not', () => {
        expect(vehicleRows(vehicles)[0].description).toBe('Viking · Ashok Leyland');
        expect(vehicleRows(vehicles)[1].description).toBeNull();
    });

    it('announces a row as one label', () => {
        expect(vehicleRows(vehicles)[0].accessibilityLabel).toBe(
            'Rank 1, vehicle NB-1234, 12 reports, 8 verified'
        );
    });

    it('keeps the order the API ranked them in', () => {
        expect(vehicleRows(vehicles).map((row) => row.numberPlate)).toEqual([
            'NB-1234',
            'ND-4567',
        ]);
    });

    it('is an empty list when nothing has been reported, so the screen shows its empty state', () => {
        expect(vehicleRows([])).toEqual([]);
        expect(vehicleRows(null)).toEqual([]);
    });
});

// ==================================================================
// 5. Accessibility Trends
// ==================================================================
describe('trend view', () => {
    const trend = [
        { date: '2026-09-03', averageScore: null },
        { date: '2026-09-10', averageScore: 70 },
        { date: '2026-09-17', averageScore: 80 },
        { date: '2026-09-24', averageScore: 90 },
    ];

    it('passes every week through, in the order the API sent them', () => {
        const view = trendView(trend);

        expect(view.points).toHaveLength(4);
        expect(view.points.map((point) => point.date)).toEqual([
            '2026-09-03',
            '2026-09-10',
            '2026-09-17',
            '2026-09-24',
        ]);
    });

    it('reports the latest, lowest and highest weeks', () => {
        const view = trendView(trend);

        expect(view.hasAnyValue).toBe(true);
        expect(view.latestScore).toBe(90);
        expect(view.lowestScore).toBe(70);
        expect(view.highestScore).toBe(90);
    });

    it('leaves a week with no data as a gap rather than a zero', () => {
        const [empty] = trendView(trend).points;

        expect(empty.hasValue).toBe(false);
        expect(empty.score).toBeNull();
        expect(empty.score).not.toBe(0);
        // Null, not 0 — a chart must draw no bar, not a bar on the floor.
        expect(empty.heightRatio).toBeNull();
        expect(empty.accessibilityLabel).toContain('no data');
    });

    it('places each week between the lowest and the highest', () => {
        const view = trendView(trend);

        expect(view.points[1].heightRatio).toBe(0);
        expect(view.points[2].heightRatio).toBeCloseTo(0.5);
        expect(view.points[3].heightRatio).toBe(1);
    });

    it('draws a flat series at full height rather than at nothing', () => {
        const view = trendView([
            { date: '2026-09-17', averageScore: 80 },
            { date: '2026-09-24', averageScore: 80 },
        ]);

        expect(view.points.every((point) => point.heightRatio === 1)).toBe(true);
    });

    it('keeps a recorded score of 0 as a value', () => {
        const view = trendView([{ date: '2026-09-24', averageScore: 0 }]);

        expect(view.points[0].hasValue).toBe(true);
        expect(view.points[0].score).toBe(0);
        expect(view.points[0].scoreLabel).toBe('0 / 100');
        expect(view.hasAnyValue).toBe(true);
    });

    it('says there is no trend when no week has a score', () => {
        const view = trendView([
            { date: '2026-09-17', averageScore: null },
            { date: '2026-09-24', averageScore: null },
        ]);

        expect(view.hasAnyValue).toBe(false);
        expect(view.latestScore).toBeNull();
        expect(view.summary).toBe(NO_TREND_DATA_SUMMARY);
    });

    it('says there is no trend when nothing arrived at all', () => {
        expect(trendView([]).hasAnyValue).toBe(false);
        expect(trendView(null).hasAnyValue).toBe(false);
        expect(trendView(undefined).points).toEqual([]);
    });

    it('summarises how much of the window was recorded', () => {
        expect(trendView(trend).summary).toBe('3 of 4 weeks recorded · low 70, high 90');
    });

    it('labels a week by its date', () => {
        expect(formatTrendDate('2026-09-21')).toBe('21 Sep');
        expect(trendView(trend).points[3].label).toBe('24 Sep');
    });

    it('falls back to the raw value for a date it cannot read', () => {
        expect(formatTrendDate('not-a-date')).toBe('not-a-date');
    });

    it('takes the latest score from the last week that has one', () => {
        const view = trendView([
            { date: '2026-09-17', averageScore: 75 },
            { date: '2026-09-24', averageScore: null },
        ]);

        // The most recent RECORDED week, not the most recent bucket.
        expect(view.latestScore).toBe(75);
    });
});
