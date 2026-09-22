import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { accessibilityScoreColor } from '../../../shared/utils/accessibility';
import { useAuthStore } from '../../../shared/store/authStore';
import {
    AccessibilityAnalyticsResponse,
    ANALYTICS_FALLBACK_MESSAGE,
    fetchAccessibilityAnalytics,
} from '../api/accessibilityAnalyticsApi';
import {
    RouteRow,
    TrendView,
    VehicleRow,
    averageScoreDisplay,
    routeRows,
    trendView,
    vehicleRows,
} from '../utils/accessibilityAnalyticsPresentation';
import { AccessibilityTrendChart } from './AccessibilityTrendChart';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

// Accessibility Analytics for admins (MOV-168, for MOV-133).
//
// Reads the four figures off GET /api/analytics/accessibility and draws them.
// Nothing on this screen is calculated: the average, the two rankings and the
// weekly trend are all the backend's, which derives them from MOV-79's
// accessibility score. What lives here is how they are laid out; what they SAY
// lives in utils/accessibilityAnalyticsPresentation, so it can be tested under
// a Jest with no renderer.
//
// Built from the admin components the other management screens use —
// AdminScreenHeader, AdminListSkeleton, AdminEmptyState, AdminErrorState and
// the adminTheme tokens — so it reads as part of the same application rather
// than a second one. No new colour system, and no new dependency: the trend
// strip below is plain Views, and the chart itself is MOV-170.

/** The session state this screen can be in. One of them, never two. */
type ScreenState = 'loading' | 'error' | 'ready';

export const AccessibilityAnalyticsScreen = () => {
    // The endpoint is admin-only and takes the admin from the verified token,
    // so the session is what the request is made with — not something the
    // screen asserts about itself.
    const { token, isAuthenticated } = useAuthStore();

    const [analytics, setAnalytics] = useState<AccessibilityAnalyticsResponse | null>(null);
    const [state, setState] = useState<ScreenState>('loading');
    const [errorMessage, setErrorMessage] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const load = useCallback(
        async (mode: 'initial' | 'refresh' = 'initial') => {
            if (mode === 'refresh') setIsRefreshing(true);
            else setState('loading');

            if (!isAuthenticated || !token) {
                setAnalytics(null);
                setErrorMessage('Your session has expired. Please sign in again.');
                setState('error');
                setIsRefreshing(false);
                return;
            }

            const result = await fetchAccessibilityAnalytics(token);

            if (result.ok) {
                setAnalytics(result.value);
                setErrorMessage('');
                setState('ready');
            } else {
                // Nothing stale is left on screen behind a failure: a figure an
                // admin cannot tell is out of date is worse than no figure.
                setAnalytics(null);
                setErrorMessage(result.message || ANALYTICS_FALLBACK_MESSAGE);
                setState('error');
            }

            setIsRefreshing(false);
        },
        [isAuthenticated, token]
    );

    // Refreshed on focus, the same as the dashboard, so the figures are current
    // after an admin has verified a report or edited a bus.
    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const average = useMemo(() => averageScoreDisplay(analytics?.averageScore), [analytics]);
    const routes = useMemo(() => routeRows(analytics?.mostAccessibleRoutes), [analytics]);
    const vehicles = useMemo(() => vehicleRows(analytics?.mostReportedVehicles), [analytics]);
    const trend = useMemo(() => trendView(analytics?.trend), [analytics]);

    const renderBody = () => {
        if (state === 'loading') {
            // The skeleton mirrors the real card shape, so the layout does not
            // jump when the figures arrive — and no fake statistic is shown.
            return <AdminListSkeleton count={4} />;
        }

        if (state === 'error') {
            return (
                <AdminErrorState
                    title="Unable to load accessibility analytics."
                    message={errorMessage}
                    onRetry={() => load()}
                />
            );
        }

        return (
            <>
                <AverageScoreCard display={average} />

                <SectionHeading
                    icon="trending-up-outline"
                    title="Most Accessible Routes"
                    caption="Ranked by the average score of the buses that run them"
                />
                {routes.length === 0 ? (
                    <AdminEmptyState
                        icon="map-outline"
                        title="No ranked routes yet"
                        description="A route is ranked once it has an active trip operated by an active bus."
                    />
                ) : (
                    <View style={styles.listCard}>
                        {routes.map((row, index) => (
                            <RouteRowView key={row.routeId} row={row} isLast={index === routes.length - 1} />
                        ))}
                    </View>
                )}

                <SectionHeading
                    icon="alert-circle-outline"
                    title="Most Reported Vehicles"
                    caption="Ranked by accessibility issue reports filed against them"
                />
                {vehicles.length === 0 ? (
                    <AdminEmptyState
                        icon="bus-outline"
                        title="No reported vehicles"
                        description="No accessibility issue has been reported against a vehicle yet."
                    />
                ) : (
                    <View style={styles.listCard}>
                        {vehicles.map((row, index) => (
                            <VehicleRowView key={row.busId} row={row} isLast={index === vehicles.length - 1} />
                        ))}
                    </View>
                )}

                <SectionHeading
                    icon="stats-chart-outline"
                    title="Accessibility Trends"
                    caption={`The fleet's average score over the last ${analytics?.trendWeeks ?? 0} weeks`}
                />
                <TrendSection trend={trend} />
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Accessibility Analytics"
                subtitle="Monitor accessibility performance across routes and vehicles"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={() => load('refresh')} />
                }
            >
                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
// Sections
// ------------------------------------------------------------------

function SectionHeading({
    icon,
    title,
    caption,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    caption: string;
}) {
    return (
        <View style={styles.sectionHeading}>
            <Ionicons name={icon} size={18} color={adminColors.textMuted} />
            <View style={styles.sectionHeadingText}>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                    {title}
                </Text>
                <Text style={styles.sectionCaption}>{caption}</Text>
            </View>
        </View>
    );
}

/**
 * The hero figure.
 *
 * The colour is `accessibilityScoreColor` — the project's own scale, the one
 * the booking and journey screens already show a score with, so a score reads
 * the same wherever it appears. It is an ADDITION to the printed figure and the
 * band word, never the only way to read the score: an admin who cannot
 * distinguish these colours still gets "82 / 100" and "Good".
 */
function AverageScoreCard({ display }: { display: ReturnType<typeof averageScoreDisplay> }) {
    const tint = display.hasScore ? accessibilityScoreColor(Number(display.value)) : adminColors.textMuted;

    return (
        <View
            style={styles.heroCard}
            accessible
            accessibilityLabel={display.accessibilityLabel}
            accessibilityLiveRegion="polite"
        >
            <Text style={styles.heroLabel}>Average Accessibility Score</Text>

            {display.hasScore ? (
                <>
                    <View style={styles.heroScoreRow}>
                        <Text style={[styles.heroScore, { color: tint }]}>{display.value}</Text>
                        <Text style={styles.heroOutOf}>{display.outOf}</Text>
                    </View>

                    <View style={[styles.heroBadge, { backgroundColor: `${tint}1A` }]}>
                        <Text style={[styles.heroBadgeText, { color: tint }]}>{display.bandLabel}</Text>
                    </View>
                </>
            ) : (
                // No score is stated as no score. It is never drawn as a 0,
                // which is a real and much worse finding.
                <View style={styles.heroEmptyRow}>
                    <Ionicons name="remove-circle-outline" size={26} color={adminColors.textPlaceholder} />
                    <Text style={styles.heroEmptyText}>Not available</Text>
                </View>
            )}

            <Text style={styles.heroCaption}>{display.caption}</Text>
        </View>
    );
}

function RouteRowView({ row, isLast }: { row: RouteRow; isLast: boolean }) {
    const tint = accessibilityScoreColor(row.score);

    return (
        <View
            style={[styles.row, isLast && styles.rowLast]}
            accessible
            accessibilityLabel={row.accessibilityLabel}
        >
            <View style={styles.rankBadge}>
                <Text style={styles.rankText}>{row.rankLabel}</Text>
            </View>

            <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.routeNumber}
                </Text>
                {!!row.routeName && (
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {row.routeName}
                    </Text>
                )}
                <Text style={styles.rowMeta}>{row.busLabel}</Text>
            </View>

            <View style={styles.rowTrailing}>
                <Text style={[styles.rowScore, { color: tint }]}>{row.scoreLabel}</Text>
                <Text style={styles.rowBand}>{row.bandLabel}</Text>
            </View>
        </View>
    );
}

function VehicleRowView({ row, isLast }: { row: VehicleRow; isLast: boolean }) {
    return (
        <View
            style={[styles.row, isLast && styles.rowLast]}
            accessible
            accessibilityLabel={row.accessibilityLabel}
        >
            <View style={styles.rankBadge}>
                <Text style={styles.rankText}>{row.rankLabel}</Text>
            </View>

            <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.numberPlate}
                </Text>
                {!!row.description && (
                    <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {row.description}
                    </Text>
                )}
            </View>

            <View style={styles.rowTrailing}>
                <Text style={[styles.rowScore, styles.rowReportCount]}>{row.reportLabel}</Text>
                <Text style={styles.rowBand}>{row.verifiedLabel}</Text>
            </View>
        </View>
    );
}

/**
 * The trend section.
 *
 * The container and the series are in place; the chart itself is MOV-170. What
 * is drawn here is a plain bar strip built from Views — no chart library and no
 * new dependency — and MOV-170 replaced those bars with the real chart.
 *
 * The summary row above it is unchanged and still reads its latest, high and
 * low straight off `trendView`: the chart draws the same series and computes
 * none of those figures again, so the line and the numbers beside it cannot
 * disagree.
 *
 * A week with no recorded score is still shown as an absence rather than a
 * zero — the chart breaks its line and marks the week on the axis. The fleet
 * did not score nothing that week; nothing was recorded, and the two must not
 * look alike.
 */
function TrendSection({ trend }: { trend: TrendView }) {
    if (!trend.hasAnyValue) {
        return (
            <AdminEmptyState
                icon="stats-chart-outline"
                title="No trend data available yet"
                description="A weekly figure appears once a bus's accessibility score has been recorded."
                secondaryDescription="Scores are recorded when a bus is added or edited, a report is verified, or a passenger rates a journey."
            />
        );
    }

    return (
        <View style={styles.trendCard}>
            <View style={styles.trendSummaryRow}>
                <View>
                    <Text style={styles.trendLatestLabel}>Latest week</Text>
                    <Text
                        style={[
                            styles.trendLatestValue,
                            { color: accessibilityScoreColor(trend.latestScore as number) },
                        ]}
                    >
                        {trend.latestScore}
                    </Text>
                </View>

                <View style={styles.trendRangeGroup}>
                    <Text style={styles.trendRangeText}>High {trend.highestScore}</Text>
                    <Text style={styles.trendRangeText}>Low {trend.lowestScore}</Text>
                </View>
            </View>

            <AccessibilityTrendChart series={trend.points} />

            <Text style={styles.trendSummary}>{trend.summary}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    // ---- Average score ----
    heroCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
        ...adminShadow.card,
    },
    heroLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    heroScoreRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginTop: 10,
    },
    heroScore: { fontSize: 52, fontWeight: '800', lineHeight: 58 },
    heroOutOf: {
        fontSize: 16,
        fontWeight: '600',
        color: adminColors.textPlaceholder,
        marginLeft: 6,
        marginBottom: 10,
    },
    heroBadge: {
        marginTop: 4,
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 10,
    },
    heroBadgeText: { fontSize: 13, fontWeight: '700' },
    heroEmptyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        marginBottom: 6,
        gap: 8,
    },
    heroEmptyText: { fontSize: 18, fontWeight: '700', color: adminColors.textPlaceholder },
    heroCaption: {
        marginTop: 12,
        fontSize: 13,
        color: adminColors.textSecondary,
        textAlign: 'center',
    },

    // ---- Section headings ----
    sectionHeading: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 26,
        marginBottom: 12,
        gap: 8,
    },
    sectionHeadingText: { flex: 1 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: adminColors.textPrimary },
    sectionCaption: {
        marginTop: 2,
        fontSize: 12,
        color: adminColors.textMuted,
        lineHeight: 17,
    },

    // ---- Ranked lists ----
    listCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        paddingHorizontal: 16,
        ...adminShadow.card,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: adminColors.borderSubtle,
        gap: 12,
    },
    rowLast: { borderBottomWidth: 0 },
    rankBadge: {
        minWidth: 34,
        height: 30,
        paddingHorizontal: 6,
        borderRadius: 8,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    rankText: { fontSize: 12, fontWeight: '800', color: adminColors.primary },
    // flex + flexShrink keeps long route names from pushing the score off a
    // narrow screen; nothing here is a fixed width.
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: adminColors.textPrimary },
    rowSubtitle: { marginTop: 2, fontSize: 13, color: adminColors.textSecondary },
    rowMeta: { marginTop: 3, fontSize: 12, color: adminColors.textMuted },
    rowTrailing: { alignItems: 'flex-end', flexShrink: 0 },
    rowScore: { fontSize: 15, fontWeight: '800' },
    rowReportCount: { color: adminColors.warning },
    rowBand: { marginTop: 2, fontSize: 11, color: adminColors.textMuted },

    // ---- Trend ----
    trendCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        ...adminShadow.card,
    },
    trendSummaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    trendLatestLabel: { fontSize: 12, color: adminColors.textMuted, fontWeight: '600' },
    trendLatestValue: { fontSize: 28, fontWeight: '800', marginTop: 2 },
    trendRangeGroup: { alignItems: 'flex-end', gap: 2 },
    trendRangeText: { fontSize: 12, color: adminColors.textSecondary, fontWeight: '600' },
    trendSummary: {
        marginTop: 14,
        fontSize: 12,
        color: adminColors.textMuted,
        textAlign: 'center',
    },
});
