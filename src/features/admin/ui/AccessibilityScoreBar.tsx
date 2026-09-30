import React from 'react';
import { StyleSheet, View } from 'react-native';
import { adminColors } from './adminTheme';

/**
 * A plain horizontal bar for a 0–100 figure, drawn from Views.
 *
 * Decorative: every place it appears prints the figure and its band beside it,
 * so it is hidden from screen readers rather than announced a second time.
 * `progress` is already 0–1 (scoreProgress); nothing is calculated here.
 */
export function ScoreBar({
    progress,
    color,
    height = 8,
}: {
    progress: number;
    color: string;
    height?: number;
}) {
    const width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` as const;

    return (
        <View
            style={[styles.track, { height, borderRadius: height / 2 }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <View style={[styles.fill, { width, backgroundColor: color, borderRadius: height / 2 }]} />
        </View>
    );
}

const styles = StyleSheet.create({
    track: {
        width: '100%',
        backgroundColor: adminColors.border,
        overflow: 'hidden',
    },
    fill: { height: '100%' },
});
