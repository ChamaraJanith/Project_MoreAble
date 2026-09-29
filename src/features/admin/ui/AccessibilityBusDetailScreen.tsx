import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useAuthStore } from '../../../shared/store/authStore';
import { positiveFeedbackCategoryLabel } from '../../reports/ui/positiveFeedbackCategories';
import { reportCategoryLabel } from '../../reports/ui/reportCategories';
import { formatReportDateTime } from '../../reports/utils/reportFormat';
import {
    BUS_ACCESSIBILITY_FALLBACK_MESSAGE,
    fetchBusAccessibility,
} from '../api/accessibilityAnalyticsApi';
import { BusAccessibilityDetail, BusEvidenceReport } from '../utils/accessibilityAnalytics';
import {
    ACCESSIBILITY_SCORE_BAND_LABELS,
    TOTAL_ACCESSIBILITY_FACILITIES,
    accessibilityScoreBand,
    accessibilityScoreBandColor,
    communityEvidenceView,
    facilityRows,
    factorRows,
    ratingEvidenceView,
    scoreProgress,
} from '../utils/accessibilityAnalyticsPresentation';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState } from './AdminStates';
import { ScoreBar } from './AccessibilityScoreBar';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

// One bus's accessibility, and the evidence behind it.
//
// Reads GET /api/analytics/buses/:busId once. The score, the three factors and
// every count are the server's, produced by MOV-79's own functions — this screen
// lays them out and does no arithmetic. The layout follows the admin Bus Details
// screen (hero card, titled sections, facility rows) so the two read as one
// application.

type ScreenState =
    | { kind: 'loading' }
    | { kind: 'ready'; bus: BusAccessibilityDetail }
    | { kind: 'missing'; message: string }
    | { kind: 'error'; message: string };

/** How many reports of each kind are shown before "Show all". */
const COLLAPSED_REPORT_LIMIT = 5;

export const AccessibilityBusDetailScreen = ({ busId }: { busId: string }) => {
    const { token, isAuthenticated } = useAuthStore();
    const [state, setState] = useState<ScreenState>({ kind: 'loading' });

    const load = useCallback(async () => {
        setState({ kind: 'loading' });

        if (!isAuthenticated || !token) {
            setState({ kind: 'error', message: 'Your session has expired. Please sign in again.' });
            return;
        }

        const result = await fetchBusAccessibility(token, busId);

        if (result.ok) {
            setState({ kind: 'ready', bus: result.value });
        } else if (result.status === 400 || result.status === 404) {
            setState({ kind: 'missing', message: result.message });
        } else {
            setState({ kind: 'error', message: result.message || BUS_ACCESSIBILITY_FALLBACK_MESSAGE });
        }
    }, [busId, isAuthenticated, token]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/(admin)/analytics');
    };

    if (state.kind === 'loading') {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Bus Accessibility" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading accessibility details…</Text>
                </View>
            </View>
        );
    }

    if (state.kind === 'missing') {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Bus Accessibility" />
                <View style={styles.content}>
                    <AdminEmptyState
                        icon="bus-outline"
                        title="Bus not found"
                        description={state.message}
                        actionLabel="Back to Analytics"
                        actionIcon="arrow-back"
                        onAction={goBack}
                    />
                </View>
            </View>
        );
    }

    if (state.kind === 'error') {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Bus Accessibility" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this bus's accessibility"
                        message={state.message}
                        onRetry={load}
                    />
                </View>
            </View>
        );
    }

    return <BusDetail bus={state.bus} />;
};

function BusDetail({ bus }: { bus: BusAccessibilityDetail }) {
    const band = accessibilityScoreBand(bus.accessibilityScore);
    const bandLabel = ACCESSIBILITY_SCORE_BAND_LABELS[band];
    const color = accessibilityScoreBandColor(bus.accessibilityScore);

    const factors = useMemo(() => factorRows(bus.factors), [bus]);
    const facilities = useMemo(() => facilityRows(bus.facilities), [bus]);
    const community = useMemo(() => communityEvidenceView(bus.community), [bus]);
    const ratings = useMemo(() => ratingEvidenceView(bus.ratings, bus.factors), [bus]);
    const description = [bus.busModel, bus.manufacturer].filter(Boolean).join(' · ');
    const largestStarCount = Math.max(1, ...bus.ratingDistribution.map((entry) => entry.count));

    return (
        <View style={styles.container}>
            <AdminScreenHeader title={bus.numberPlate} subtitle="Accessibility details" />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Bus and score */}
                <View style={styles.heroCard}>
                    <View style={styles.heroIdentity}>
                        <View style={styles.heroIcon}>
                            <Ionicons name="bus" size={26} color={adminColors.primary} />
                        </View>
                        <View style={styles.heroText}>
                            <Text style={styles.heroPlate}>{bus.numberPlate}</Text>
                            {!!description && <Text style={styles.heroModel}>{description}</Text>}
                            <Text style={styles.heroId}>{bus.busId}</Text>
                        </View>
                        {!!bus.status && <StatusBadge status={bus.status} size="small" />}
                    </View>

                    <View
                        style={styles.heroScore}
                        accessible
                        accessibilityLabel={`Accessibility score ${bus.accessibilityScore} out of 100, ${bandLabel}`}
                    >
                        <Text style={styles.heroScoreCaption}>Accessibility Score</Text>
                        <View style={styles.heroScoreRow}>
                            <Text style={[styles.heroScoreValue, { color }]}>{bus.accessibilityScore}</Text>
                            <Text style={styles.heroScoreOutOf}>/ 100</Text>
                        </View>
                        <View style={[styles.bandBadge, { backgroundColor: `${color}1A` }]}>
                            <Text style={[styles.bandBadgeText, { color }]}>{bandLabel}</Text>
                        </View>
                        <View style={styles.heroBar}>
                            <ScoreBar progress={scoreProgress(bus.accessibilityScore)} color={color} height={10} />
                        </View>
                    </View>
                </View>

                {/* Score breakdown */}
                <Text style={styles.sectionTitle} accessibilityRole="header">
                    Score Breakdown
                </Text>
                <View style={styles.card}>
                    {factors.map((factor, index) => (
                        <View
                            key={factor.key}
                            style={[styles.factorRow, index > 0 && styles.rowBordered]}
                            accessible
                            accessibilityLabel={factor.accessibilityLabel}
                        >
                            <View style={styles.factorHeader}>
                                <Text style={styles.factorLabel}>{factor.label}</Text>
                                <Text style={[styles.factorScore, { color: factor.color }]}>{factor.scoreLabel}</Text>
                            </View>
                            <ScoreBar progress={factor.progress} color={factor.color} />
                            <View style={styles.factorFooter}>
                                <Text style={styles.factorMeta}>{factor.weightLabel}</Text>
                                <Text style={styles.factorMeta}>Contributes {factor.contributionLabel}</Text>
                            </View>
                        </View>
                    ))}
                    <Text style={styles.cardNote}>
                        The score adds the three weighted contributions and rounds to a whole number, so the
                        contributions shown may differ from it by a fraction.
                    </Text>
                </View>

                {/* Facilities */}
                <Text style={styles.sectionTitle} accessibilityRole="header">
                    Accessibility Facilities
                </Text>
                <View style={styles.card}>
                    <Text style={styles.cardLead}>
                        {bus.availableFacilityCount} of {TOTAL_ACCESSIBILITY_FACILITIES} available
                    </Text>
                    {facilities.map((facility) => (
                        <View
                            key={facility.key}
                            style={[styles.facilityRow, styles.rowBordered]}
                            accessible
                            accessibilityLabel={`${facility.label}, ${facility.statusLabel}${facility.detail ? `, ${facility.detail}` : ''}`}
                        >
                            <View
                                style={[
                                    styles.facilityIcon,
                                    {
                                        backgroundColor: facility.available
                                            ? adminColors.successSoft
                                            : adminColors.borderSubtle,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={facility.available ? 'checkmark' : 'close'}
                                    size={16}
                                    color={facility.available ? adminColors.success : adminColors.textMuted}
                                />
                            </View>
                            <View style={styles.flexText}>
                                <Text style={styles.facilityLabel}>{facility.label}</Text>
                                <Text style={styles.facilityStatus}>
                                    {facility.statusLabel}
                                    {facility.detail ? ` · ${facility.detail}` : ''}
                                </Text>
                            </View>
                        </View>
                    ))}
                </View>

                {/* Community reports */}
                <Text style={styles.sectionTitle} accessibilityRole="header">
                    Community Reports
                </Text>
                <View style={styles.card}>
                    <View style={styles.statRow}>
                        <StatTile
                            icon="alert-circle-outline"
                            tint={adminColors.warning}
                            label="Verified Issues"
                            value={String(community.issueCount)}
                        />
                        <StatTile
                            icon="happy-outline"
                            tint={adminColors.success}
                            label="Verified Positive Feedback"
                            value={String(community.positiveCount)}
                        />
                    </View>
                    <Text style={styles.cardNote}>
                        Only reports an administrator has verified count toward the score. {community.note}
                    </Text>
                </View>

                <ReportList
                    title="Issues"
                    emptyText="No verified issue reports about this bus."
                    reports={bus.verifiedIssues}
                />
                <ReportList
                    title="Positive Feedback"
                    emptyText="No verified positive feedback about this bus."
                    reports={bus.verifiedPositiveFeedback}
                />

                {/* Passenger ratings */}
                <Text style={styles.sectionTitle} accessibilityRole="header">
                    Passenger Ratings
                </Text>
                <View style={styles.card}>
                    <View style={styles.statRow}>
                        <StatTile icon="star-outline" tint="#F9A825" label="Average Rating" value={ratings.averageLabel} />
                        <StatTile
                            icon="people-outline"
                            tint={adminColors.primary}
                            label="Total Ratings"
                            value={String(bus.ratings.count)}
                        />
                    </View>
                    <View style={[styles.statRow, styles.statRowSpaced]}>
                        <StatTile
                            icon="speedometer-outline"
                            tint={adminColors.accent}
                            label="Rating Factor (used in score)"
                            value={ratings.factorLabel ?? '—'}
                        />
                    </View>

                    {ratings.hasRatings && (
                        <View style={styles.distribution}>
                            {bus.ratingDistribution.map((entry) => (
                                <View
                                    key={entry.stars}
                                    style={styles.distributionRow}
                                    accessible
                                    accessibilityLabel={`${entry.stars} star, ${entry.count} ${entry.count === 1 ? 'rating' : 'ratings'}`}
                                >
                                    <Text style={styles.distributionStars}>{entry.stars}★</Text>
                                    <View style={styles.flexText}>
                                        <ScoreBar progress={entry.count / largestStarCount} color="#F9A825" />
                                    </View>
                                    <Text style={styles.distributionCount}>{entry.count}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <Text style={styles.cardNote}>{ratings.note}</Text>
                </View>

                {/* Link to the fleet record */}
                <TouchableOpacity
                    style={styles.linkRow}
                    onPress={() =>
                        router.push({
                            pathname: '/(admin)/buses/[numberPlate]',
                            params: { numberPlate: bus.numberPlate },
                        })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Open the bus record for ${bus.numberPlate}`}
                >
                    <Ionicons name="bus-outline" size={20} color={adminColors.primary} />
                    <Text style={styles.linkText}>View bus record</Text>
                    <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

function StatTile({
    icon,
    tint,
    label,
    value,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    label: string;
    value: string;
}) {
    return (
        <View style={styles.statTile} accessible accessibilityLabel={`${label}: ${value}`}>
            <Ionicons name={icon} size={18} color={tint} />
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

function ReportList({
    title,
    emptyText,
    reports,
}: {
    title: string;
    emptyText: string;
    reports: BusEvidenceReport[];
}) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? reports : reports.slice(0, COLLAPSED_REPORT_LIMIT);

    return (
        <View style={[styles.card, styles.reportCard]}>
            <Text style={styles.reportListTitle}>
                {title} ({reports.length})
            </Text>

            {reports.length === 0 ? (
                <Text style={styles.emptyText}>{emptyText}</Text>
            ) : (
                shown.map((report) => (
                    <TouchableOpacity
                        key={report.reportId}
                        style={[styles.reportRow, styles.rowBordered]}
                        onPress={() =>
                            router.push({
                                pathname: '/(admin)/reports/[reportId]',
                                params: { reportId: report.reportId },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Open report ${report.reportId}`}
                    >
                        <View style={styles.flexText}>
                            <Text style={styles.reportCategory}>
                                {report.category
                                    ? report.type === 'POSITIVE'
                                        ? positiveFeedbackCategoryLabel(report.category)
                                        : reportCategoryLabel(report.category)
                                    : report.type === 'POSITIVE'
                                      ? 'Positive feedback'
                                      : 'Accessibility issue'}
                            </Text>
                            <Text style={styles.reportMeta}>
                                {report.reportId}
                                {report.createdAt ? ` · ${formatReportDateTime(report.createdAt)}` : ''}
                            </Text>
                            {!!report.description && (
                                <Text style={styles.reportDescription} numberOfLines={3}>
                                    {report.description}
                                </Text>
                            )}
                            <Text style={styles.reportVerified}>
                                Verified{report.reviewedAt ? ` ${formatReportDateTime(report.reviewedAt)}` : ''}
                            </Text>
                            {!!report.adminRemark && (
                                <Text style={styles.reportRemark} numberOfLines={2}>
                                    Admin remark: {report.adminRemark}
                                </Text>
                            )}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={adminColors.textMuted} />
                    </TouchableOpacity>
                ))
            )}

            {reports.length > COLLAPSED_REPORT_LIMIT && (
                <TouchableOpacity
                    style={styles.showAll}
                    onPress={() => setExpanded((value) => !value)}
                    accessibilityRole="button"
                >
                    <Text style={styles.showAllText}>
                        {expanded ? 'Show fewer' : `Show all ${reports.length}`}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    centeredText: { marginTop: 12, fontSize: 14, color: adminColors.textSecondary },
    flexText: { flex: 1, minWidth: 0 },

    heroCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 18,
        ...adminShadow.card,
    },
    heroIdentity: { flexDirection: 'row', alignItems: 'center' },
    heroIcon: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    heroText: { flex: 1, minWidth: 0, marginHorizontal: 12 },
    heroPlate: { fontSize: 20, fontWeight: '800', color: adminColors.textPrimary, letterSpacing: 0.4 },
    heroModel: { fontSize: 13, color: adminColors.textSecondary, marginTop: 2 },
    heroId: { fontSize: 12, color: adminColors.textMuted, marginTop: 2, fontWeight: '600' },
    heroScore: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        alignItems: 'center',
    },
    heroScoreCaption: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    heroScoreRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 },
    heroScoreValue: { fontSize: 48, fontWeight: '800', lineHeight: 54 },
    heroScoreOutOf: {
        fontSize: 16,
        fontWeight: '600',
        color: adminColors.textPlaceholder,
        marginLeft: 6,
        marginBottom: 8,
    },
    bandBadge: { marginTop: 4, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10 },
    bandBadgeText: { fontSize: 13, fontWeight: '700' },
    heroBar: { alignSelf: 'stretch', marginTop: 14 },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 22,
    },
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        ...adminShadow.card,
    },
    cardLead: { fontSize: 13, fontWeight: '700', color: adminColors.textSecondary, marginBottom: 4 },
    cardNote: { marginTop: 12, fontSize: 12, lineHeight: 17, color: adminColors.textMuted },
    rowBordered: { borderTopWidth: 1, borderTopColor: adminColors.borderSubtle },

    factorRow: { paddingVertical: 12, gap: 8 },
    factorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    factorLabel: { fontSize: 15, fontWeight: '700', color: adminColors.textPrimary },
    factorScore: { fontSize: 15, fontWeight: '800' },
    factorFooter: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
    factorMeta: { fontSize: 12, color: adminColors.textMuted, fontWeight: '600' },

    facilityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
    facilityIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    facilityLabel: { fontSize: 14, fontWeight: '700', color: adminColors.textPrimary },
    facilityStatus: { fontSize: 12, color: adminColors.textSecondary, marginTop: 2 },

    statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    statRowSpaced: { marginTop: 10 },
    statTile: {
        flexGrow: 1,
        flexBasis: 140,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        padding: 12,
    },
    statValue: { fontSize: 22, fontWeight: '800', color: adminColors.textPrimary, marginTop: 6 },
    statLabel: { fontSize: 12, color: adminColors.textSecondary, marginTop: 2, fontWeight: '600' },

    reportCard: { marginTop: 12 },
    reportListTitle: { fontSize: 15, fontWeight: '700', color: adminColors.textPrimary, marginBottom: 4 },
    emptyText: { fontSize: 13, color: adminColors.textMuted, paddingVertical: 8 },
    reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
    reportCategory: { fontSize: 14, fontWeight: '700', color: adminColors.textPrimary },
    reportMeta: { fontSize: 12, color: adminColors.textMuted, marginTop: 2 },
    reportDescription: { fontSize: 13, color: adminColors.textSecondary, marginTop: 6, lineHeight: 18 },
    reportVerified: { fontSize: 12, color: adminColors.success, marginTop: 6, fontWeight: '600' },
    reportRemark: { fontSize: 12, color: adminColors.textSecondary, marginTop: 4, fontStyle: 'italic' },
    showAll: { paddingTop: 12, alignItems: 'center' },
    showAllText: { fontSize: 13, fontWeight: '700', color: adminColors.primary },

    distribution: { marginTop: 14, gap: 6 },
    distributionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    distributionStars: { width: 28, fontSize: 13, fontWeight: '700', color: adminColors.textSecondary },
    distributionCount: {
        width: 32,
        textAlign: 'right',
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textSecondary,
    },

    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 22,
        minHeight: 52,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: adminColors.surface,
        ...adminShadow.card,
    },
    linkText: { flex: 1, fontSize: 15, fontWeight: '700', color: adminColors.primary },
});
