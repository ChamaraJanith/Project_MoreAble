import { AppText as Text } from '../../../shared/ui/AppText';
import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { accessibilityScoreColor } from '../../../shared/utils/accessibility';
import { TrendPointView } from '../utils/accessibilityAnalyticsPresentation';
import {
    DEFAULT_TREND_CHART_PADDING,
    accessibilityTrendGeometry,
    trendChartAccessibilityLabel,
    trendSegmentPath,
} from '../utils/accessibilityTrendChart';
import { adminColors } from './adminTheme';

// The Accessibility Trends chart (MOV-170).
//
// Draws the weekly series the screen already has. It fetches nothing, scores
// nothing and buckets nothing: the points arrive as props, prepared by MOV-168
// from MOV-169's response, and where they go on the canvas is worked out by the
// pure geometry in utils/accessibilityTrendChart so it can be tested without a
// renderer.
//
// Built on react-native-svg, which the project already depends on and already
// uses for the profile-completion ring in UserDetailsScreen. No chart library
// and no new dependency.
//
// The y-axis is always 0–100. See the geometry module for why that matters more
// than it looks: a chart that rescaled to its own range would draw the same
// fleet differently every week and could not be compared with itself.

/** Tall enough for six grid lines to be distinct, short enough for a phone. */
export const TREND_CHART_HEIGHT = 180;

const GRID_LABEL_FONT_SIZE = 9;
const AXIS_LABEL_FONT_SIZE = 9;
const MARKER_RADIUS = 3.5;
const LINE_WIDTH = 2;

export interface AccessibilityTrendChartProps {
    /** The weekly series, exactly as the presentation layer prepared it. */
    series: readonly TrendPointView[];
    /** Overridable so a caller can make it shorter; width is always measured. */
    height?: number;
}

/**
 * The chart.
 *
 * Its width is MEASURED rather than assumed — `onLayout` reports what the card
 * actually gave it — so the same component fills a small phone and a tablet
 * with no fixed width anywhere and nothing to overflow. Nothing is drawn until
 * that first measurement arrives, which is one frame.
 */
export function AccessibilityTrendChart({
    series,
    height = TREND_CHART_HEIGHT,
}: AccessibilityTrendChartProps) {
    const [width, setWidth] = useState(0);

    const onLayout = (event: LayoutChangeEvent) => {
        const measured = event.nativeEvent.layout.width;

        // Re-rendering on a sub-pixel change would be a loop with no end and no
        // visible difference.
        if (Math.abs(measured - width) > 1) setWidth(measured);
    };

    const geometry = useMemo(
        () => accessibilityTrendGeometry(series, width, height),
        [series, width, height]
    );

    const label = useMemo(() => trendChartAccessibilityLabel(series), [series]);

    return (
        <View
            style={[styles.container, { height }]}
            onLayout={onLayout}
            accessible
            accessibilityRole="image"
            accessibilityLabel={label}
        >
            {geometry.isDrawable && (
                <Svg width={width} height={height}>
                    {/* Grid and y-axis. The labels are what make the chart
                        readable without relying on colour at all. */}
                    <G>
                        {geometry.gridLines.map((line) => (
                            <G key={line.score}>
                                <Line
                                    x1={geometry.plot.left}
                                    y1={line.y}
                                    x2={geometry.plot.right}
                                    y2={line.y}
                                    stroke={adminColors.borderSubtle}
                                    strokeWidth={1}
                                />
                                <SvgText
                                    x={geometry.plot.left - 6}
                                    y={line.y + GRID_LABEL_FONT_SIZE / 3}
                                    fontSize={GRID_LABEL_FONT_SIZE}
                                    fill={adminColors.textPlaceholder}
                                    textAnchor="end"
                                >
                                    {line.label}
                                </SvgText>
                            </G>
                        ))}
                    </G>

                    {/* A week with nothing recorded: a short muted tick on the
                        baseline, keeping the MOV-168 convention that an absence
                        is shown as an absence rather than as a zero. It sits on
                        the axis, deliberately not on the 0 grid line, so it can
                        never be read as a score. */}
                    <G>
                        {geometry.gaps.map((gap) => (
                            <Line
                                key={`gap-${gap.date}`}
                                x1={gap.x}
                                y1={geometry.plot.bottom}
                                x2={gap.x}
                                y2={geometry.plot.bottom + 4}
                                stroke={adminColors.border}
                                strokeWidth={2}
                                strokeLinecap="round"
                            />
                        ))}
                    </G>

                    {/* The score line. One path per run of consecutive recorded
                        weeks, so a missing week is a gap and never a straight
                        line across it. */}
                    <G>
                        {geometry.segments.map((segment) => {
                            const path = trendSegmentPath(segment);

                            if (!path) return null;

                            return (
                                <Path
                                    key={`segment-${segment[0].date}`}
                                    d={path}
                                    fill="none"
                                    stroke={adminColors.primary}
                                    strokeWidth={LINE_WIDTH}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            );
                        })}
                    </G>

                    {/* The markers. Each is tinted by the project's own
                        accessibility-score scale, so a point reads the same as
                        the score does everywhere else in the app — an addition
                        to its position, never the only way to read it. */}
                    <G>
                        {geometry.markers.map((marker) => (
                            <Circle
                                key={`marker-${marker.date}`}
                                cx={marker.x}
                                cy={marker.y}
                                r={MARKER_RADIUS}
                                fill={accessibilityScoreColor(marker.score)}
                                stroke={adminColors.surface}
                                strokeWidth={1.5}
                            />
                        ))}
                    </G>

                    {/* The x-axis, and as many week labels as actually fit. */}
                    <G>
                        <Line
                            x1={geometry.plot.left}
                            y1={geometry.plot.bottom}
                            x2={geometry.plot.right}
                            y2={geometry.plot.bottom}
                            stroke={adminColors.border}
                            strokeWidth={1}
                        />

                        {geometry.xLabels.map((tick) => (
                            <SvgText
                                key={`x-${tick.date}`}
                                x={tick.x}
                                y={geometry.plot.bottom + 15}
                                fontSize={AXIS_LABEL_FONT_SIZE}
                                fill={adminColors.textMuted}
                                textAnchor="middle"
                            >
                                {tick.label}
                            </SvgText>
                        ))}
                    </G>
                </Svg>
            )}

            {/* Every point, as text, for a screen reader.
                The SVG above is one image with one label, which tells a
                screen-reader user the shape but not the figures. These carry
                the figures. They are laid out off-screen rather than hidden,
                because an element with `display: none` is not announced at
                all. */}
            <View style={styles.screenReaderOnly} importantForAccessibility="yes">
                {series.map((point) => (
                    <Text key={`sr-${point.date}`} accessibilityLabel={point.accessibilityLabel}>
                        {point.accessibilityLabel}
                    </Text>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    // No width: the chart takes whatever the card gives it, on every device.
    container: {
        width: '100%',
        paddingLeft: 0,
        paddingRight: DEFAULT_TREND_CHART_PADDING.right,
    },
    screenReaderOnly: {
        position: 'absolute',
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        left: -9999,
    },
});
