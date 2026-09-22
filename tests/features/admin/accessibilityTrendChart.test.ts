// The Accessibility Trends chart (MOV-170).
//
// The chart component cannot be rendered here — the project's Jest is
// `testEnvironment: node` with no React Native renderer — so everything the
// chart decides lives in a pure geometry module and is asserted on directly:
// where a score lands, which weeks are joined by a line, which are not, and
// which labels fit. What is left in the component is the SVG elements
// themselves, which take those coordinates and draw them.
//
// Two rules are what these tests exist for.
//
// 1. THE Y-AXIS IS FIXED AT 0–100. The chart must not rescale to whatever range
//    it happens to have been given: a score of 80 has to sit in the same place
//    this week as it did last week, or the chart cannot be compared with
//    itself. The presentation layer's `heightRatio` IS range-normalised, which
//    is exactly why the chart does not use it, and the first block below pins
//    the fixed mapping so it cannot quietly drift back.
//
// 2. NULL IS NOT ZERO. A week with no recorded score must produce no marker and
//    must break the line — never a point on the floor, and never a straight
//    line drawn across the gap as though the weeks either side were measured
//    continuously.

import { TrendPointView } from '../../../src/features/admin/utils/accessibilityAnalyticsPresentation';
import {
    DEFAULT_TREND_CHART_PADDING,
    TREND_CHART_MAX_SCORE,
    TREND_CHART_MIN_SCORE,
    TREND_CHART_Y_TICKS,
    accessibilityTrendGeometry,
    scoreToY,
    trendChartAccessibilityLabel,
    trendLabelIndices,
    trendSegmentPath,
    weekToX,
} from '../../../src/features/admin/utils/accessibilityTrendChart';

// A canvas big enough that the plot is a round 200 x 148.
const WIDTH = 238;
const HEIGHT = 180;

const PLOT = {
    left: DEFAULT_TREND_CHART_PADDING.left,
    top: DEFAULT_TREND_CHART_PADDING.top,
    right: WIDTH - DEFAULT_TREND_CHART_PADDING.right,
    bottom: HEIGHT - DEFAULT_TREND_CHART_PADDING.bottom,
    width: WIDTH - DEFAULT_TREND_CHART_PADDING.left - DEFAULT_TREND_CHART_PADDING.right,
    height: HEIGHT - DEFAULT_TREND_CHART_PADDING.top - DEFAULT_TREND_CHART_PADDING.bottom,
};

/** One week, shaped exactly as the presentation layer hands it over. */
function week(date: string, score: number | null): TrendPointView {
    if (score === null) {
        return {
            date,
            label: date.slice(8),
            hasValue: false,
            score: null,
            scoreLabel: null,
            heightRatio: null,
            accessibilityLabel: `Week of ${date}, no data`,
        };
    }

    return {
        date,
        label: date.slice(8),
        hasValue: true,
        score,
        scoreLabel: `${score} / 100`,
        // Deliberately a value the chart must IGNORE: if the geometry ever
        // reads this instead of the score, the fixed-scale tests below fail.
        heightRatio: 0.5,
        accessibilityLabel: `Week of ${date}, average score ${score}`,
    };
}

function geometryOf(points: TrendPointView[], width = WIDTH, height = HEIGHT) {
    return accessibilityTrendGeometry(points, width, height);
}

// ==================================================================
// 1. The fixed 0–100 y-axis
// ==================================================================
describe('the y-axis', () => {
    it('puts 0 at the bottom of the plot', () => {
        expect(scoreToY(0, PLOT)).toBe(PLOT.bottom);
    });

    it('puts 100 at the top of the plot', () => {
        expect(scoreToY(100, PLOT)).toBe(PLOT.top);
    });

    it('puts 50 exactly halfway', () => {
        expect(scoreToY(50, PLOT)).toBeCloseTo(PLOT.top + PLOT.height / 2);
    });

    it('is linear across the whole scale', () => {
        expect(scoreToY(25, PLOT)).toBeCloseTo(PLOT.top + PLOT.height * 0.75);
        expect(scoreToY(75, PLOT)).toBeCloseTo(PLOT.top + PLOT.height * 0.25);
    });

    it('does not rescale around the values it is given', () => {
        // The same score, in two series with very different ranges.
        const tight = geometryOf([week('2026-09-10', 80), week('2026-09-17', 81)]);
        const wide = geometryOf([week('2026-09-10', 80), week('2026-09-17', 10)]);

        const tight80 = tight.markers.find((marker) => marker.score === 80);
        const wide80 = wide.markers.find((marker) => marker.score === 80);

        // A chart normalised to its own range would put these in wildly
        // different places. On a fixed axis, 80 is 80.
        expect(tight80?.y).toBe(wide80?.y);
        expect(tight80?.y).toBeCloseTo(scoreToY(80, PLOT));
    });

    it('ignores the presentation layer\'s range-normalised heightRatio', () => {
        // Every fixture carries heightRatio 0.5; if the geometry used it, both
        // of these would land in the middle.
        const geometry = geometryOf([week('2026-09-10', 100), week('2026-09-17', 0)]);

        expect(geometry.markers[0].y).toBe(PLOT.top);
        expect(geometry.markers[1].y).toBe(PLOT.bottom);
    });

    it('clamps a score outside the scale into the frame', () => {
        expect(scoreToY(120, PLOT)).toBe(PLOT.top);
        expect(scoreToY(-20, PLOT)).toBe(PLOT.bottom);
    });

    it('labels the axis at fixed scores, top first', () => {
        expect(TREND_CHART_Y_TICKS).toEqual([100, 80, 60, 40, 20, 0]);
        expect(TREND_CHART_MIN_SCORE).toBe(0);
        expect(TREND_CHART_MAX_SCORE).toBe(100);

        const { gridLines } = geometryOf([week('2026-09-24', 80)]);

        expect(gridLines.map((line) => line.label)).toEqual(['100', '80', '60', '40', '20', '0']);
        expect(gridLines[0].y).toBe(PLOT.top);
        expect(gridLines[5].y).toBe(PLOT.bottom);
    });
});

// ==================================================================
// 2. The x-axis
// ==================================================================
describe('the x-axis', () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
        week(`2026-07-${String(index + 1).padStart(2, '0')}`, 70 + index)
    );

    it('spreads the weeks evenly, first at the left and last at the right', () => {
        const geometry = geometryOf(twelve);

        expect(geometry.markers[0].x).toBe(PLOT.left);
        expect(geometry.markers[11].x).toBe(PLOT.right);
    });

    it('centres a single week', () => {
        expect(weekToX(0, 1, PLOT)).toBe(PLOT.left + PLOT.width / 2);
    });

    it('keeps the weeks in chronological order', () => {
        const geometry = geometryOf(twelve);

        const xs = geometry.markers.map((marker) => marker.x);

        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        expect(geometry.markers.map((marker) => marker.date)).toEqual(
            twelve.map((point) => point.date)
        );
    });

    it('keeps a slot for a week with no score, so the axis stays a calendar', () => {
        const series = [week('2026-09-10', 70), week('2026-09-17', null), week('2026-09-24', 75)];
        const geometry = geometryOf(series);

        // Three slots, evenly spaced: the missing week is not squeezed out.
        expect(geometry.markers[0].x).toBe(PLOT.left);
        expect(geometry.gaps[0].x).toBeCloseTo(PLOT.left + PLOT.width / 2);
        expect(geometry.markers[1].x).toBe(PLOT.right);
    });

    it('represents every weekly slot exactly once', () => {
        const series = [
            week('2026-09-03', null),
            week('2026-09-10', 70),
            week('2026-09-17', null),
            week('2026-09-24', 75),
        ];
        const geometry = geometryOf(series);

        expect(geometry.markers.length + geometry.gaps.length).toBe(series.length);
        expect([...geometry.markers, ...geometry.gaps].map((entry) => entry.date).sort()).toEqual(
            series.map((point) => point.date).sort()
        );
    });

    it('thins the labels so they cannot overlap on a narrow plot', () => {
        // 200 points of plot fits four 44-point labels, not twelve.
        const indices = trendLabelIndices(12, 200);

        expect(indices.length).toBeLessThan(12);
        expect(indices[0]).toBe(0);
        expect(indices[indices.length - 1]).toBe(11);
    });

    it('labels every week when they all fit', () => {
        expect(trendLabelIndices(4, 600)).toEqual([0, 1, 2, 3]);
    });

    it('always labels the most recent week', () => {
        for (const count of [2, 5, 7, 12, 13]) {
            const indices = trendLabelIndices(count, 200);

            expect(indices[indices.length - 1]).toBe(count - 1);
            // And never labels the same week twice.
            expect(new Set(indices).size).toBe(indices.length);
        }
    });

    it('keeps the chosen labels spread apart', () => {
        const indices = trendLabelIndices(12, 200);

        for (let index = 1; index < indices.length; index += 1) {
            expect(indices[index]).toBeGreaterThan(indices[index - 1]);
        }
    });

    it('handles an empty and a single-week window', () => {
        expect(trendLabelIndices(0, 200)).toEqual([]);
        expect(trendLabelIndices(1, 200)).toEqual([0]);
    });
});

// ==================================================================
// 3. Markers
// ==================================================================
describe('markers', () => {
    it('plots one for every week that has a score', () => {
        const geometry = geometryOf([
            week('2026-09-10', 70),
            week('2026-09-17', 80),
            week('2026-09-24', 90),
        ]);

        expect(geometry.markers).toHaveLength(3);
        expect(geometry.markers.map((marker) => marker.score)).toEqual([70, 80, 90]);
    });

    it('plots none for a week with no score', () => {
        const geometry = geometryOf([week('2026-09-17', null), week('2026-09-24', 80)]);

        expect(geometry.markers).toHaveLength(1);
        expect(geometry.markers[0].date).toBe('2026-09-24');
        expect(geometry.gaps.map((gap) => gap.date)).toEqual(['2026-09-17']);
    });

    it('plots a real score of 0 at the bottom, not as a gap', () => {
        const geometry = geometryOf([week('2026-09-24', 0)]);

        // The distinction the whole feature rests on: 0 is a finding.
        expect(geometry.markers).toHaveLength(1);
        expect(geometry.gaps).toHaveLength(0);
        expect(geometry.markers[0].y).toBe(PLOT.bottom);
    });

    it('never turns a null week into a 0', () => {
        const geometry = geometryOf([week('2026-09-24', null)]);

        expect(geometry.markers).toHaveLength(0);
        expect(geometry.gaps).toHaveLength(1);
        // Nothing anywhere claims a score of zero for that week.
        expect(geometry.markers.some((marker) => marker.score === 0)).toBe(false);
    });

    it('keeps every marker inside the plot', () => {
        const geometry = geometryOf([
            week('2026-09-03', 0),
            week('2026-09-10', 50),
            week('2026-09-17', 100),
        ]);

        for (const marker of geometry.markers) {
            expect(marker.y).toBeGreaterThanOrEqual(PLOT.top);
            expect(marker.y).toBeLessThanOrEqual(PLOT.bottom);
            expect(marker.x).toBeGreaterThanOrEqual(PLOT.left);
            expect(marker.x).toBeLessThanOrEqual(PLOT.right);
        }
    });

    it('carries the week\'s own accessibility label onto the marker', () => {
        const geometry = geometryOf([week('2026-09-24', 82)]);

        expect(geometry.markers[0].accessibilityLabel).toBe(
            'Week of 2026-09-24, average score 82'
        );
    });
});

// ==================================================================
// 4. The line, and the gaps in it
// ==================================================================
describe('the score line', () => {
    it('joins consecutive recorded weeks', () => {
        const geometry = geometryOf([
            week('2026-09-10', 70),
            week('2026-09-17', 75),
            week('2026-09-24', 80),
        ]);

        expect(geometry.segments).toHaveLength(1);
        expect(geometry.segments[0]).toHaveLength(3);
    });

    it('breaks across a week with no score rather than drawing through it', () => {
        const geometry = geometryOf([
            week('2026-09-10', 70),
            week('2026-09-17', null),
            week('2026-09-24', 75),
        ]);

        // Two runs, not one line from 70 to 75 across the missing week.
        expect(geometry.segments).toHaveLength(2);
        expect(geometry.segments[0].map((marker) => marker.score)).toEqual([70]);
        expect(geometry.segments[1].map((marker) => marker.score)).toEqual([75]);
    });

    it('draws no path across the gap', () => {
        const geometry = geometryOf([
            week('2026-09-03', 70),
            week('2026-09-10', 72),
            week('2026-09-17', null),
            week('2026-09-24', 75),
        ]);

        const paths = geometry.segments.map(trendSegmentPath).filter(Boolean);

        // The only line covers the two adjacent recorded weeks; the lone week
        // after the gap has a marker and no line reaching back to them.
        expect(paths).toHaveLength(1);
        expect(paths[0].split('L')).toHaveLength(2);
    });

    it('draws no line for a single recorded week', () => {
        const geometry = geometryOf([week('2026-09-24', 80)]);

        expect(geometry.segments).toHaveLength(1);
        expect(trendSegmentPath(geometry.segments[0])).toBe('');
    });

    it('builds a path from the markers it was given', () => {
        const geometry = geometryOf([week('2026-09-17', 0), week('2026-09-24', 100)]);

        expect(trendSegmentPath(geometry.segments[0])).toBe(
            `M ${PLOT.left} ${PLOT.bottom} L ${PLOT.right} ${PLOT.top}`
        );
    });

    it('has no segments when nothing was recorded', () => {
        const geometry = geometryOf([week('2026-09-17', null), week('2026-09-24', null)]);

        expect(geometry.segments).toEqual([]);
        expect(geometry.markers).toEqual([]);
        expect(geometry.gaps).toHaveLength(2);
    });

    it('answers an empty path for anything that is not a run', () => {
        expect(trendSegmentPath([])).toBe('');
        expect(trendSegmentPath(null as any)).toBe('');
    });
});

// ==================================================================
// 5. Sizing
// ==================================================================
describe('sizing', () => {
    it('is not drawable before the width has been measured', () => {
        // The component measures its own width, so the first render has none.
        expect(geometryOf([week('2026-09-24', 80)], 0).isDrawable).toBe(false);
    });

    it('is not drawable with nothing to draw', () => {
        expect(geometryOf([]).isDrawable).toBe(false);
    });

    it('is drawable once there is a width and a series', () => {
        expect(geometryOf([week('2026-09-24', 80)]).isDrawable).toBe(true);
    });

    it('fills whatever width it is given, with no fixed size anywhere', () => {
        const narrow = geometryOf([week('2026-09-10', 70), week('2026-09-24', 80)], 320);
        const wide = geometryOf([week('2026-09-10', 70), week('2026-09-24', 80)], 900);

        expect(narrow.plot.right).toBe(320 - DEFAULT_TREND_CHART_PADDING.right);
        expect(wide.plot.right).toBe(900 - DEFAULT_TREND_CHART_PADDING.right);
        // And the last week stays on the right edge at both sizes.
        expect(narrow.markers[1].x).toBe(narrow.plot.right);
        expect(wide.markers[1].x).toBe(wide.plot.right);
    });

    it('never produces a negative plot on a canvas smaller than its padding', () => {
        const geometry = geometryOf([week('2026-09-24', 80)], 10, 10);

        expect(geometry.plot.width).toBeGreaterThanOrEqual(0);
        expect(geometry.plot.height).toBeGreaterThanOrEqual(0);
        expect(geometry.isDrawable).toBe(false);
    });

    it('survives being handed no series at all', () => {
        expect(accessibilityTrendGeometry(null, WIDTH, HEIGHT).isDrawable).toBe(false);
        expect(accessibilityTrendGeometry(undefined, WIDTH, HEIGHT).markers).toEqual([]);
    });
});

// ==================================================================
// 6. Accessibility
// ==================================================================
describe('the chart label', () => {
    it('describes the window, the scale and the span that was recorded', () => {
        const label = trendChartAccessibilityLabel([
            week('2026-09-10', 70),
            week('2026-09-17', null),
            week('2026-09-24', 82),
        ]);

        expect(label).toContain('last 3 weeks');
        expect(label).toContain('out of 100');
        expect(label).toContain('2 weeks recorded');
        expect(label).toContain('from 70');
        expect(label).toContain('to 82');
    });

    it('says so when nothing was recorded', () => {
        expect(
            trendChartAccessibilityLabel([week('2026-09-17', null), week('2026-09-24', null)])
        ).toContain('No scores recorded');
    });

    it('says so when there is no series', () => {
        expect(trendChartAccessibilityLabel([])).toBe('Accessibility score trend. No data.');
        expect(trendChartAccessibilityLabel(null)).toContain('No data');
    });
});
