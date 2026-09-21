import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { ReportCardSummary, ReportChip } from '../utils/reportSummary';
import { ReportFeedbackStats } from './ReportFeedbackStats';

/**
 * Red for an issue, green for positive feedback — as a soft tile behind the
 * category icon only, so the semantic colour marks the kind of report without
 * competing with the app's blue.
 */
const TYPE_ACCENT = {
    ISSUE: { background: adminColors.dangerSoft, icon: adminColors.danger },
    POSITIVE: { background: adminColors.successSoft, icon: adminColors.success },
} as const;

interface ReportListCardProps {
    summary: ReportCardSummary;
    /** The stored status, for the badge. */
    status: string;
    onOpen: () => void;
    /** Overrides the summary's label, e.g. the admin queue's review wording. */
    accessibilityLabel?: string;
    accessibilityHint?: string;
    /** Drawn above the card's content — the admin queue's "Needs Review". */
    banner?: React.ReactNode;
    /** Adds a warning edge, for a report the community flagged. */
    flagged?: boolean;
}

/**
 * One report, as a row in a list — the passenger tabs and the admin review
 * queue draw this same card, so a report describes itself identically on both
 * sides of the app. What stays screen-specific is passed in: the admin queue's
 * review banner and its accessibility wording.
 *
 * The whole card is the control: there is exactly one thing to do with a report
 * from a list — open it — so nothing inside it is a separate touch target, and
 * it carries a single accessibility label rather than readable fragments.
 */
export function ReportListCard({
    summary,
    status,
    onOpen,
    accessibilityLabel,
    accessibilityHint = 'Opens the full report',
    banner,
    flagged = false,
}: ReportListCardProps) {
    const accent = TYPE_ACCENT[summary.reportType];

    // Bus, route and "Your report" identify the report; the photo count is
    // evidence, so it sits with the other tallies in the footer.
    const metaChips = summary.chips.filter((chip) => chip.icon !== 'images-outline');
    const photoChip = summary.chips.find((chip) => chip.icon === 'images-outline');

    return (
        <TouchableOpacity
            style={[styles.card, flagged && styles.cardFlagged]}
            onPress={onOpen}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? summary.accessibilityLabel}
            accessibilityHint={accessibilityHint}
        >
            {banner}

            <View style={styles.row}>
                {/* Decorative: the category it stands for is the title. */}
                <View
                    style={[styles.iconTile, { backgroundColor: accent.background }]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <Ionicons name={summary.icon} size={22} color={accent.icon} />
                </View>

                <View style={styles.body}>
                    <View style={styles.titleRow}>
                        <Text style={styles.title} numberOfLines={2}>
                            {summary.title}
                        </Text>

                        <StatusBadge status={status} size="small" />
                    </View>

                    {metaChips.length > 0 && (
                        <View style={styles.metaRow}>
                            {metaChips.map((chip) => (
                                <MetaChip key={chip.label} chip={chip} />
                            ))}
                        </View>
                    )}

                    <Text style={styles.description} numberOfLines={2}>
                        {summary.description}
                    </Text>

                    <View style={styles.footer}>
                        <View style={styles.footerStats}>
                            <ReportFeedbackStats counts={summary.feedbackCounts} variant="inline" />

                            {!!photoChip && (
                                <View
                                    style={styles.photoIndicator}
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons
                                        name="images-outline"
                                        size={14}
                                        color={adminColors.textMuted}
                                    />
                                    <Text style={styles.footerText}>{photoChip.label}</Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.dateGroup}>
                            <Ionicons name="time-outline" size={13} color={adminColors.textMuted} />
                            <Text style={styles.footerText} numberOfLines={1}>
                                {summary.dateLabel}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Decorative: the card itself is the control. */}
                <View
                    style={styles.chevron}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <Ionicons name="chevron-forward" size={18} color={adminColors.textPlaceholder} />
                </View>
            </View>
        </TouchableOpacity>
    );
}

function MetaChip({ chip }: { chip: ReportChip }) {
    const color = chip.highlighted ? adminColors.primary : adminColors.textSecondary;

    return (
        <View style={[styles.metaChip, chip.highlighted && styles.metaChipHighlighted]}>
            <Ionicons name={chip.icon} size={12} color={color} />
            <Text style={[styles.metaChipText, { color }]} numberOfLines={1}>
                {chip.label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        paddingVertical: 14,
        paddingLeft: 14,
        paddingRight: 10,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: adminColors.borderSubtle,
        ...adminShadow.card,
    },
    cardFlagged: {
        borderLeftWidth: 3,
        borderLeftColor: adminColors.warning,
    },

    row: { flexDirection: 'row', alignItems: 'flex-start' },
    iconTile: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    body: { flex: 1, minWidth: 0, marginLeft: 12 },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    title: {
        flex: 1,
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.textPrimary,
        lineHeight: 20,
    },

    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        rowGap: 4,
        columnGap: 10,
        marginTop: 5,
    },
    metaChip: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    metaChipHighlighted: {
        backgroundColor: adminColors.primarySoft,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    metaChipText: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
        flexShrink: 1,
    },

    description: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 18,
        marginTop: 6,
    },

    // Wraps on a narrow phone rather than squeezing: the date drops beneath
    // the tallies instead of being truncated into nothing.
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        rowGap: 6,
        columnGap: 10,
        marginTop: 10,
    },
    footerStats: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    photoIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dateGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    footerText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginLeft: 4,
        flexShrink: 1,
    },

    chevron: {
        width: 22,
        paddingTop: 12,
        alignItems: 'flex-end',
    },
});
