import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { reportStatusLabel } from '../utils/reportFormat';
import { ReportCardSummary, ReportChip } from '../utils/reportSummary';
import { ReportFeedbackStats } from './ReportFeedbackStats';
import { REPORT_TYPE_TONES, ReportTypeBadge } from './ReportTypeBadge';

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
 * Layout, top to bottom beside the thumbnail:
 *   Title                               [STATUS]
 *   [ISSUE / POSITIVE]  [Your Report]
 *   🚌 Bus   🛣 Route
 *   Short description…
 *   💬 0  👍 2  👎 0              🕒 2h ago
 *
 * The thumbnail is the report's first photo when it has one, and the category
 * icon on a soft circle when it does not — never both.
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
    const tone = REPORT_TYPE_TONES[summary.reportType];

    // A photo that fails to load falls back to the category icon rather than
    // leaving an empty grey square on the card.
    const [photoFailed, setPhotoFailed] = useState(false);
    const showPhoto = !!summary.thumbnailUrl && !photoFailed;

    // Bus and route identify the report. "Your report" is drawn beside the
    // type badge instead, and the photo count sits with the other tallies.
    const metaChips = summary.chips.filter(
        (chip) => chip.icon === 'bus-outline' || chip.icon === 'git-branch-outline'
    );
    const photoChip = summary.chips.find((chip) => chip.icon === 'images-outline');

    const defaultLabel = [
        summary.accessibilityLabel,
        `Status: ${reportStatusLabel(status)}`,
        ...(summary.isOwnReport ? ['Your report'] : []),
    ].join(', ');

    return (
        <TouchableOpacity
            style={[styles.card, flagged && styles.cardFlagged]}
            onPress={onOpen}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? defaultLabel}
            accessibilityHint={accessibilityHint}
        >
            {banner}

            <View style={styles.row}>
                {/* Decorative: the category it stands for is the title, and the
                    photos themselves are on the details screen. */}
                <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    {showPhoto ? (
                        <Image
                            source={{ uri: summary.thumbnailUrl }}
                            style={styles.thumbnail}
                            resizeMode="cover"
                            onError={() => setPhotoFailed(true)}
                        />
                    ) : (
                        <View style={[styles.iconCircle, { backgroundColor: tone.background }]}>
                            <Ionicons name={summary.icon} size={24} color={tone.iconColor} />
                        </View>
                    )}
                </View>

                <View style={styles.body}>
                    <View style={styles.titleRow}>
                        <Text style={styles.title} numberOfLines={2}>
                            {summary.title}
                        </Text>

                        <StatusBadge status={status} size="small" />
                    </View>

                    <View style={styles.badgeRow}>
                        <ReportTypeBadge type={summary.reportType} />

                        {summary.isOwnReport && (
                            <View style={styles.ownChip}>
                                <Ionicons
                                    name="person-circle-outline"
                                    size={12}
                                    color={adminColors.primary}
                                />
                                <Text style={styles.ownChipText}>Your Report</Text>
                            </View>
                        )}
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
                                {summary.relativeDateLabel}
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
    return (
        <View style={styles.metaChip}>
            <Ionicons name={chip.icon} size={13} color={adminColors.primary} />
            <Text style={styles.metaChipText} numberOfLines={1}>
                {chip.label}
            </Text>
        </View>
    );
}

const THUMBNAIL_SIZE = 72;

const styles = StyleSheet.create({
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 16,
        paddingVertical: 14,
        paddingLeft: 14,
        paddingRight: 8,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: adminColors.border,
        ...adminShadow.card,
    },
    cardFlagged: {
        borderLeftWidth: 3,
        borderLeftColor: adminColors.warning,
    },

    row: { flexDirection: 'row', alignItems: 'flex-start' },

    // Square and cropped to fill: the photo keeps its proportions (it is
    // never stretched), whether it was taken portrait or landscape.
    thumbnail: {
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        borderRadius: 12,
        backgroundColor: adminColors.borderSubtle,
    },
    iconCircle: {
        width: 52,
        height: 52,
        borderRadius: 26,
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
        fontSize: 16,
        fontWeight: '800',
        color: adminColors.textPrimary,
        lineHeight: 21,
    },

    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        marginTop: 6,
    },
    ownChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.primarySoft,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 2,
        gap: 4,
    },
    ownChipText: { fontSize: 11, fontWeight: '700', color: adminColors.primary },

    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        rowGap: 4,
        columnGap: 12,
        marginTop: 8,
    },
    metaChip: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    metaChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textPrimary,
        marginLeft: 4,
        flexShrink: 1,
    },

    description: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 19,
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
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
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
        alignSelf: 'center',
        alignItems: 'flex-end',
    },
});
