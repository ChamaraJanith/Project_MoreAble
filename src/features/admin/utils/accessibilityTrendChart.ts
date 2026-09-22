/**
 * The geometry of the Accessibility Trends chart (MOV-170).
 *
 * Turns the weekly series MOV-168 prepared into the coordinates the SVG draws:
 * where each grid line sits, where each week's marker goes, which runs of weeks
 * are joined by a line, and which x-axis labels fit. Pure arithmetic and no
 * React, so it can be tested under this project's node-only Jest — the same
 * arrangement accessibilityAnalyticsPresentation and systemStatistics use.
 *
 * NOTHING HERE TOUCHES A SCORE. Every value arrives from the API, which got it
 * from MOV-79 by way of MOV-169, and this only decides where on a canvas to put
 * it. There is no averaging, no bucketing and no interpolation: a week's marker
 * is its own score and nothing else.
 *
 * THE Y-AXIS IS FIXED AT 0–100, ALWAYS.
 * This is the point of the module and the reason it does not reuse
 * `TrendPointView.heightRatio`. That ratio is normalised between the lowest and
 * highest weeks in the window, which is the right scale for a bar strip and the
 * wrong one for this chart: it would redraw the same fleet differently every
 * time its range moved, so a line sitting at the top could mean 95 one week and
 * 62 the next, and two screenshots a month apart could not be compared. An
 * accessibility score is a figure on a fixed 0–100 scale, and the chart shows
 * it on one.
 *
 * A WEEK WITH NO SCORE HAS NO POINT.
 * `null` is "nothing was recorded", not a score of zero. Such a week keeps its
 * place on the x-axis — the window is twelve weeks whatever was recorded in
 * them — but produces no marker and breaks the line, so the chart shows a gap
 * where there is no evidence rather than a plunge to the floor.
 */

import { TrendPointView } from './accessibilityAnalyticsPresentation';

/** The scale every accessibility score is on, and the chart's y-axis. */
export const TREND_CHART_MIN_SCORE = 0;
export const TREND_CHART_MAX_SCORE = 100;

/** The scores that get a grid line and a y-axis label, top first. */
export const TREND_CHART_Y_TICKS: readonly number[] = [100, 80, 60, 40, 20, 0];

/**
 * Roughly how wide one x-axis label needs to be, in points.
 *
 * '24 Sep' at the axis font size, plus room to breathe. Used to decide how many
 * of the twelve weeks can be labelled before they start colliding.
 */
export const TREND_CHART_MIN_LABEL_WIDTH = 44;

/** How much of the canvas the axes take. */
export interface TrendChartPadding {
    /** Room for the y-axis labels. */
    left: number;
    right: number;
    top: number;
    /** Room for the x-axis labels. */
    bottom: number;
}

export const DEFAULT_TREND_CHART_PADDING: TrendChartPadding = {
    left: 30,
    right: 8,
    top: 10,
    bottom: 22,
};

/** The rectangle the data is drawn inside, in SVG coordinates. */
export interface TrendChartPlot {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/** One horizontal grid line and its y-axis label. */
export interface TrendChartGridLine {
    score: number;
    label: string;
    y: number;
}

/** One week that has a score: a marker on the line. */
export interface TrendChartMarker {
    date: string;
    label: string;
    score: number;
    x: number;
    y: number;
    accessibilityLabel: string;
}

/** One week that has no score: a place on the axis, and no marker. */
export interface TrendChartGap {
    date: string;
    label: string;
    x: number;
    accessibilityLabel: string;
}

/** One x-axis label that fits. */
export interface TrendChartXLabel {
    date: string;
    label: string;
    x: number;
}

export interface TrendChartGeometry {
    plot: TrendChartPlot;
    gridLines: TrendChartGridLine[];
    /** Every week with a score, in chronological order. */
    markers: TrendChartMarker[];
    /** Every week without one, in chronological order. */
    gaps: TrendChartGap[];
    /**
     * Runs of consecutive weeks that have scores.
     *
     * A line is drawn along each run and never between them, which is what puts
     * a gap where a week is missing instead of a straight line implying a
     * measurement nobody took. A run of one week has a marker and no line.
     */
    segments: TrendChartMarker[][];
    /** Thinned so labels cannot overlap on a narrow screen. */
    xLabels: TrendChartXLabel[];
    /** False when the chart is too small to draw, or there is nothing to draw. */
    isDrawable: boolean;
}

/** A usable measurement: a finite number above zero. */
function usableSize(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Where a score sits vertically, on the fixed 0–100 scale.
 *
 * 100 is the top of the plot, 0 the bottom, 50 exactly halfway. A score outside
 * the scale is clamped into it rather than drawn outside the axes — the figure
 * is the API's and the chart's job is to show it, not to let it escape the
 * frame.
 */
export function scoreToY(score: number, plot: TrendChartPlot): number {
    const clamped = Math.min(
        TREND_CHART_MAX_SCORE,
        Math.max(TREND_CHART_MIN_SCORE, Number.isFinite(score) ? score : TREND_CHART_MIN_SCORE)
    );

    const ratio =
        (clamped - TREND_CHART_MIN_SCORE) / (TREND_CHART_MAX_SCORE - TREND_CHART_MIN_SCORE);

    return plot.top + (1 - ratio) * plot.height;
}

/**
 * Where a week sits horizontally.
 *
 * Evenly spaced across the plot, first week at the left edge and last at the
 * right, so the spacing is the passage of time and nothing else. Weeks without
 * a score take their slot like any other: dropping them would compress the
 * axis and make a quiet month look like a busy one.
 *
 * A single week is centred, since there is no span to spread it over.
 */
export function weekToX(index: number, count: number, plot: TrendChartPlot): number {
    if (count <= 1) return plot.left + plot.width / 2;

    return plot.left + (index / (count - 1)) * plot.width;
}

/**
 * Which weeks can be labelled without their labels colliding.
 *
 * Returns the indices to label. The first and the last week are always among
 * them — they are what say what window the chart covers — and the ones between
 * are taken at as fine a stride as the width allows. Where the stride would
 * leave the last two labels overlapping, the second-to-last is dropped rather
 * than the last: the most recent week is the one an admin is looking for.
 */
export function trendLabelIndices(count: number, plotWidth: number): number[] {
    if (count <= 0) return [];
    if (count === 1) return [0];

    const fits = Math.max(2, Math.floor(usableSize(plotWidth) / TREND_CHART_MIN_LABEL_WIDTH));

    if (fits >= count) return Array.from({ length: count }, (_, index) => index);

    const stride = Math.ceil((count - 1) / (fits - 1));
    const indices: number[] = [];

    for (let index = 0; index < count - 1; index += stride) indices.push(index);

    const last = count - 1;
    const previous = indices[indices.length - 1];

    // The final week always gets a label; if the stride landed too close to it,
    // that neighbour goes rather than the week itself.
    if (previous !== undefined && last - previous < stride) indices.pop();

    indices.push(last);

    return indices;
}

/**
 * The whole chart, laid out for one canvas size.
 *
 * `width` comes from the card the chart is drawn in — measured, never assumed —
 * so the same series fills a small phone and a tablet without a fixed width
 * anywhere and without overflowing either.
 *
 * `isDrawable` is false when there is no room or nothing to draw. The caller
 * renders nothing rather than an empty frame; a chart with no data is the
 * screen's existing empty state, not a grid with a flat line at zero.
 */
export function accessibilityTrendGeometry(
    points: readonly TrendPointView[] | null | undefined,
    width: number,
    height: number,
    padding: TrendChartPadding = DEFAULT_TREND_CHART_PADDING
): TrendChartGeometry {
    const series = Array.isArray(points) ? points : [];

    const canvasWidth = usableSize(width);
    const canvasHeight = usableSize(height);

    const plot: TrendChartPlot = {
        left: padding.left,
        top: padding.top,
        right: Math.max(padding.left, canvasWidth - padding.right),
        bottom: Math.max(padding.top, canvasHeight - padding.bottom),
        width: Math.max(0, canvasWidth - padding.left - padding.right),
        height: Math.max(0, canvasHeight - padding.top - padding.bottom),
    };

    const gridLines: TrendChartGridLine[] = TREND_CHART_Y_TICKS.map((score) => ({
        score,
        label: String(score),
        y: scoreToY(score, plot),
    }));

    const markers: TrendChartMarker[] = [];
    const gaps: TrendChartGap[] = [];
    const segments: TrendChartMarker[][] = [];
    let run: TrendChartMarker[] = [];

    series.forEach((point, index) => {
        const x = weekToX(index, series.length, plot);

        // `hasValue` is the presentation layer's own reading of null-vs-zero,
        // and the score is checked alongside it rather than trusted from it: a
        // real 0 must plot at the bottom, and only a null must break the line.
        if (!point?.hasValue || typeof point.score !== 'number' || !Number.isFinite(point.score)) {
            gaps.push({
                date: point?.date ?? '',
                label: point?.label ?? '',
                x,
                accessibilityLabel: point?.accessibilityLabel ?? '',
            });

            // The run ends here. The next scored week starts a new one, so no
            // line is ever drawn across the missing week.
            if (run.length > 0) {
                segments.push(run);
                run = [];
            }

            return;
        }

        const marker: TrendChartMarker = {
            date: point.date,
            label: point.label,
            score: point.score,
            x,
            y: scoreToY(point.score, plot),
            accessibilityLabel: point.accessibilityLabel,
        };

        markers.push(marker);
        run.push(marker);
    });

    if (run.length > 0) segments.push(run);

    const xLabels = trendLabelIndices(series.length, plot.width).map((index) => ({
        date: series[index]?.date ?? '',
        label: series[index]?.label ?? '',
        x: weekToX(index, series.length, plot),
    }));

    return {
        plot,
        gridLines,
        markers,
        gaps,
        segments,
        xLabels,
        isDrawable: plot.width > 0 && plot.height > 0 && series.length > 0,
    };
}

/**
 * One run of weeks as an SVG path: `M x y L x y …`.
 *
 * Straight segments rather than a smoothed curve. A curve through weekly
 * averages invents values between them that were never measured, and on a chart
 * an admin reads to decide whether accessibility is improving, an invented
 * upswing is the worst kind of decoration.
 *
 * Empty for a run of fewer than two weeks, so a lone scored week draws its
 * marker and no line.
 */
export function trendSegmentPath(segment: readonly TrendChartMarker[]): string {
    if (!Array.isArray(segment) || segment.length < 2) return '';

    return segment
        .map((marker, index) => `${index === 0 ? 'M' : 'L'} ${marker.x} ${marker.y}`)
        .join(' ');
}

/** What a screen reader announces for the chart as a whole. */
export function trendChartAccessibilityLabel(
    points: readonly TrendPointView[] | null | undefined
): string {
    const series = Array.isArray(points) ? points : [];
    const recorded = series.filter((point) => point?.hasValue);

    if (series.length === 0) return 'Accessibility score trend. No data.';

    if (recorded.length === 0) {
        return `Accessibility score trend for the last ${series.length} weeks. No scores recorded.`;
    }

    const first = recorded[0];
    const last = recorded[recorded.length - 1];

    return (
        `Accessibility score trend for the last ${series.length} weeks, scored out of 100. ` +
        `${recorded.length} weeks recorded, from ${first.score} in the week of ${first.label} ` +
        `to ${last.score} in the week of ${last.label}.`
    );
}
