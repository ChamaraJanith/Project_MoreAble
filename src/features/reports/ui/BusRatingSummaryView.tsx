import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { BusRatingSummary } from '../../../entities/rating/model/types';
import { AppText as Text } from '../../../shared/ui/AppText';
import { describeRatingSummary } from '../utils/busCommunityFeedback';

/** The amber the Rate this bus screen already uses for a star. */
const STAR_COLOR = '#F59E0B';

/**
 * How passengers rated a bus — read-only (MOV-80).
 *
 * The counterpart of BusRatingScreen, which is where a rating is GIVEN. Nothing
 * here is tappable as a rating: these stars are a reading, not a control.
 *
 * Shown in two places and two shapes:
 *
 *   compact  — one line on a journey result card: ⭐ 4.6 (24)
 *   detailed — a block on Route Details: the average, the count, and a way
 *              through to the full community feedback
 *
 * Never shown as, or beside, the accessibility score without its own label. The
 * two are different measurements — the score weighs facilities, verified reports
 * and ratings together; this is the rating average alone — and a passenger who
 * reads one as the other is being misinformed about the bus.
 *
 * The number always carries the meaning. The star is an addition to it, never a
 * substitute, and the whole control is labelled as one sentence for a screen
 * reader — the same rule the accessibility score follows.
 */

interface BusRatingSummaryViewProps {
    summary: BusRatingSummary | null | undefined;
    /**
     * True while the summary is still being read. Renders nothing rather than a
     * spinner in the compact shape: a card must not reflow as each bus answers.
     */
    loading?: boolean;
    /**
     * The ratings could not be read at all — which is not the same as a bus
     * nobody has rated, and must not read as one.
     */
    unavailable?: boolean;
}

/** ⭐ 4.6 (24) — one line, for a journey result card. */
export function BusRatingSummaryCompact({
    summary,
    loading = false,
    unavailable = false,
}: BusRatingSummaryViewProps) {
    const display = describeRatingSummary(summary);

    // A card is a dense place and the rating is the least of what it says. While
    // the figure is unknown the row is simply absent, so the card never jumps a
    // line taller the moment an answer arrives.
    if (loading || unavailable) return null;

    return (
        <View
            style={styles.compactRow}
            accessible
            accessibilityLabel={display.accessibilityLabel}
        >
            <Ionicons
                name={display.hasRatings ? 'star' : 'star-outline'}
                size={13}
                color={display.hasRatings ? STAR_COLOR : '#94A3B8'}
            />
            <Text
                style={[styles.compactText, !display.hasRatings && styles.compactTextMuted]}
                numberOfLines={1}
            >
                {display.compactLabel}
            </Text>
        </View>
    );
}

interface BusRatingSummaryCardProps extends BusRatingSummaryViewProps {
    /** Opens the community feedback screen. Omitted when there is nowhere to go. */
    onViewFeedback?: () => void;
}

/**
 * The Passenger Rating block on Route Details.
 *
 * Sits with the bus and the accessibility information rather than above them:
 * what the bus IS comes before what people thought of it. The full feedback is
 * a screen away rather than a list here, so Route Details stays readable.
 */
export function BusRatingSummaryCard({
    summary,
    loading = false,
    unavailable = false,
    onViewFeedback,
}: BusRatingSummaryCardProps) {
    const display = describeRatingSummary(summary);

    return (
        <View style={styles.card}>
            <View style={styles.sectionHeadingRow}>
                <Ionicons name="star-outline" size={16} color="#0F172A" />
                <Text style={styles.sectionHeadingText} accessibilityRole="header">
                    Passenger rating
                </Text>
            </View>

            {loading ? (
                <Text style={styles.mutedText}>Loading passenger ratings…</Text>
            ) : unavailable ? (
                <Text style={styles.mutedText}>
                    Passenger ratings are not available for this bus right now.
                </Text>
            ) : display.hasRatings ? (
                <View
                    style={styles.averageRow}
                    accessible
                    accessibilityLabel={display.accessibilityLabel}
                >
                    <Ionicons name="star" size={22} color={STAR_COLOR} />
                    <Text style={styles.averageValue}>{display.averageLabel}</Text>
                    <Text style={styles.averageScale}>/ 5</Text>
                    <Text style={styles.averageCount}>{display.countLabel}</Text>
                </View>
            ) : (
                <View
                    style={styles.averageRow}
                    accessible
                    accessibilityLabel={display.accessibilityLabel}
                >
                    <Ionicons name="star-outline" size={22} color="#94A3B8" />
                    <Text style={styles.emptyValue}>No ratings yet</Text>
                </View>
            )}

            <Text style={styles.footnote}>
                The average of ratings passengers gave after travelling on this bus. Separate
                from the accessibility score, which also weighs the bus&apos;s facilities and
                verified reports.
            </Text>

            {onViewFeedback ? (
                <TouchableOpacity
                    style={styles.ctaRow}
                    onPress={onViewFeedback}
                    accessibilityRole="button"
                    accessibilityLabel="View community feedback"
                    accessibilityHint="Opens passenger ratings and verified reports for this bus"
                >
                    <Text style={styles.ctaText}>View community feedback</Text>
                    <Ionicons name="arrow-forward" size={16} color="#0066CC" />
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    // --- compact ---
    compactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
    },
    compactText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#B45309',
    },
    compactTextMuted: {
        fontWeight: '600',
        color: '#64748B',
    },

    // --- detailed ---
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 16,
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    sectionHeadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
    },
    sectionHeadingText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
    },
    averageRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    averageValue: {
        fontSize: 26,
        fontWeight: '800',
        color: '#0F172A',
    },
    averageScale: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748B',
    },
    averageCount: {
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
        marginLeft: 6,
    },
    emptyValue: {
        fontSize: 16,
        fontWeight: '700',
        color: '#64748B',
    },
    mutedText: {
        fontSize: 13,
        color: '#64748B',
    },
    footnote: {
        fontSize: 11,
        lineHeight: 16,
        color: '#94A3B8',
        marginTop: 10,
    },
    ctaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    ctaText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
    },
});
