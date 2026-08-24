import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { AccessibilityReport, ReportScope } from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { isReportOwnedBy } from '../utils/reportOwnership';
import { reportDetailsPath, reportFormPath } from '../utils/reportRoutes';
import { reportsRequestPath } from '../utils/reportScopes';
import { reportCardSummary } from '../utils/reportSummary';
import { ReportFeedbackStats } from './ReportFeedbackStats';

const SCOPE_TABS: { value: ReportScope; label: string }[] = [
    { value: 'all', label: 'All Reports' },
    { value: 'my', label: 'My Reports' },
    { value: 'verified', label: 'Verified Reports' },
];

/**
 * What each tab shows when it comes back with nothing.
 *
 * All three offer the same way out — file a report — because on any of them an
 * empty list means there is nothing to read, not that something went wrong.
 * Verified Reports says who does the verifying, since it is the one tab a
 * passenger cannot fill by themselves.
 */
const EMPTY_STATES: Record<
    ReportScope,
    { icon: keyof typeof Ionicons.glyphMap; title: string; description: string }
> = {
    all: {
        icon: 'documents-outline',
        title: 'No accessibility reports yet',
        description: 'Reports submitted by passengers will appear here.',
    },
    my: {
        icon: 'document-text-outline',
        title: 'You have not submitted any reports yet',
        description: 'Accessibility issues you report will appear here.',
    },
    verified: {
        icon: 'checkmark-circle-outline',
        title: 'No verified reports yet',
        description: 'Reports an administrator has verified will appear here.',
    },
};

/**
 * One tab's worth of state.
 *
 * Each scope keeps its own, so switching tabs never shows another tab's
 * reports, its skeleton, or an error it had no part in — and so a tab that
 * already has data can be returned to without refetching it.
 */
interface ReportFeed {
    reports: AccessibilityReport[];
    isLoading: boolean;
    isRefreshing: boolean;
    error: string | null;
}

const INITIAL_FEED: ReportFeed = {
    reports: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
};

export const AccessibilityReportsScreen = () => {
    const { token, user, isAuthenticated } = useAuthStore();

    const [feeds, setFeeds] = useState<Record<ReportScope, ReportFeed>>({
        all: INITIAL_FEED,
        my: INITIAL_FEED,
        verified: INITIAL_FEED,
    });
    const [scope, setScope] = useState<ReportScope>('all');

    // Which scopes have had a request fired for them. A ref rather than state
    // because it is read to decide whether to start a fetch, and has to be
    // already updated by the time the next effect runs in the same commit.
    const requestedScopes = useRef(new Set<ReportScope>());

    // Lets the focus refresh below read the visible tab without re-subscribing
    // every time the passenger switches tab. Only ever read on a focus event,
    // which is always well after the commit that last updated it.
    const scopeRef = useRef(scope);

    useEffect(() => {
        scopeRef.current = scope;
    }, [scope]);

    const updateFeed = useCallback((target: ReportScope, patch: Partial<ReportFeed>) => {
        setFeeds((current) => ({ ...current, [target]: { ...current[target], ...patch } }));
    }, []);

    const fetchReports = useCallback(
        async (target: ReportScope, mode: 'initial' | 'refresh' = 'initial') => {
            if (!isAuthenticated || !token) {
                // Left out of `requestedScopes` on purpose: nothing was asked
                // of the API, so opening the tab again once there is a session
                // should still try.
                updateFeed(target, {
                    error: 'Authentication required.',
                    isLoading: false,
                    isRefreshing: false,
                });
                return;
            }

            requestedScopes.current.add(target);

            updateFeed(
                target,
                mode === 'refresh'
                    ? { isRefreshing: true, error: null }
                    : { isLoading: true, error: null }
            );

            try {
                // The three tabs differ only by this parameter. Both
                // narrowings are applied by the API — `my` against the
                // passengerId on the verified token, `verified` against the
                // status an admin recorded — never by this screen against a
                // wider list it has already been given.
                const response = await fetch(`${API_BASE_URL}${reportsRequestPath(target)}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const result = await response.json().catch(() => ({}));

                if (response.ok && result.success) {
                    updateFeed(target, { reports: result.reports || [], error: null });
                } else {
                    updateFeed(target, {
                        error: result.message || 'Failed to retrieve accessibility reports.',
                    });
                }
            } catch (err) {
                console.error('Fetch Reports Error:', err);
                updateFeed(target, { error: 'Failed to retrieve accessibility reports.' });
            } finally {
                updateFeed(target, { isLoading: false, isRefreshing: false });
            }
        },
        [isAuthenticated, token, updateFeed]
    );

    // Reload the visible tab on focus, so a report submitted on the form screen
    // is already there when the passenger comes back to My Reports.
    useFocusEffect(
        useCallback(() => {
            fetchReports(scopeRef.current);
        }, [fetchReports])
    );

    // Load a tab the first time it is opened. Switching back to one that has
    // already been fetched costs no request — the focus refresh above is what
    // keeps it current.
    useEffect(() => {
        if (requestedScopes.current.has(scope)) return;

        fetchReports(scope);
    }, [scope, fetchReports]);

    // Addressed through reportFormPath rather than as a bare '/reports': the
    // admin review queue answers that same URL, and an unqualified push lands
    // on it instead of on the form.
    const goToReportForm = () => router.push(reportFormPath() as Href);

    const renderBody = () => {
        const feed = feeds[scope];

        if (feed.isLoading) return <AdminListSkeleton count={3} />;

        if (feed.error) {
            return (
                <AdminErrorState
                    title="Unable to load reports"
                    message={`${feed.error} Please check your connection and try again.`}
                    retryLabel="Try Again"
                    onRetry={() => fetchReports(scope)}
                />
            );
        }

        if (feed.reports.length === 0) {
            const emptyState = EMPTY_STATES[scope];

            return (
                <AdminEmptyState
                    icon={emptyState.icon}
                    title={emptyState.title}
                    description={emptyState.description}
                    actionLabel="Report Accessibility Issue"
                    onAction={goToReportForm}
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {feed.reports.length} report{feed.reports.length === 1 ? '' : 's'}
                </Text>

                {feed.reports.map((report) => (
                    <ReportCard
                        key={report.reportId}
                        report={report}
                        // Only worth pointing out among other people's reports.
                        // On My Reports every card would carry the chip, which
                        // tells the passenger nothing.
                        isOwnReport={
                            scope !== 'my' && isReportOwnedBy(report, user?.passengerId)
                        }
                        // The id travels in the path and nowhere else — it is
                        // how the report is addressed, not something the
                        // passenger is asked to read. Editing and deleting live
                        // on the screen this opens, where there is room to
                        // confirm them.
                        onOpen={() => router.push(reportDetailsPath(report.reportId) as Href)}
                    />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Accessibility Reports"
                subtitle="Track accessibility issues reported across the network"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={feeds[scope].isRefreshing}
                        onRefresh={() => fetchReports(scope, 'refresh')}
                    />
                }
            >
                {/* Primary action */}
                <TouchableOpacity
                    style={styles.createButton}
                    onPress={goToReportForm}
                    accessibilityRole="button"
                    accessibilityLabel="Report Accessibility Issue"
                >
                    <Ionicons name="add-circle-outline" size={22} color="#FFFFFF" />
                    <Text style={styles.createButtonText}>Report Accessibility Issue</Text>
                </TouchableOpacity>

                {/* Scope tabs */}
                <View style={styles.segmentedControl} accessibilityRole="tablist">
                    {SCOPE_TABS.map((tab) => {
                        const isSelected = scope === tab.value;

                        return (
                            <TouchableOpacity
                                key={tab.value}
                                style={[styles.segment, isSelected && styles.segmentSelected]}
                                onPress={() => setScope(tab.value)}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: isSelected }}
                                accessibilityLabel={`View ${tab.label}`}
                            >
                                <Text
                                    style={[styles.segmentText, isSelected && styles.segmentTextSelected]}
                                    numberOfLines={1}
                                >
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
interface ReportCardProps {
    report: AccessibilityReport;
    isOwnReport: boolean;
    onOpen: () => void;
}

/**
 * One report, as a row in the list.
 *
 * The whole card is the control: there is exactly one thing to do with a report
 * from here — open it — so a button inside the card would only be a smaller
 * target for the same action. The chevron says so, and the card carries a
 * single accessibility label rather than a scattering of readable fragments.
 */
function ReportCard({ report, isOwnReport, onOpen }: ReportCardProps) {
    // Everything the card puts on screen, derived in one place — including the
    // fact that the report id is not part of it.
    const summary = reportCardSummary(report, { isOwnReport });

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onOpen}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={summary.accessibilityLabel}
            accessibilityHint="Opens the full report"
        >
            <View style={styles.cardTop}>
                <View style={styles.categoryIconCircle}>
                    <Ionicons name={summary.icon} size={22} color={adminColors.primary} />
                </View>

                <View style={styles.cardHeadings}>
                    <Text style={styles.categoryText} numberOfLines={2}>
                        {summary.title}
                    </Text>

                    <View style={styles.statusRow}>
                        <StatusBadge status={report.status} size="small" />
                    </View>
                </View>

                {/* Decorative: the card itself is the control, so the arrow
                    must not become a second thing to land on. */}
                <View
                    style={styles.chevron}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={adminColors.textPlaceholder}
                    />
                </View>
            </View>

            <Text style={styles.descriptionText} numberOfLines={2}>
                {summary.description}
            </Text>

            {summary.chips.length > 0 && (
                <View style={styles.chipWrap}>
                    {summary.chips.map((chip) => (
                        <MetaChip
                            key={chip.label}
                            icon={chip.icon}
                            label={chip.label}
                            highlighted={chip.highlighted}
                        />
                    ))}
                </View>
            )}

            <View style={styles.cardFooter}>
                <Ionicons name="calendar-outline" size={14} color={adminColors.textMuted} />
                <Text style={styles.footerText}>{summary.submittedLabel}</Text>
            </View>

            <ReportFeedbackStats counts={summary.feedbackCounts} />
        </TouchableOpacity>
    );
}

function MetaChip({
    icon,
    label,
    highlighted = false,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    highlighted?: boolean;
}) {
    return (
        <View style={[styles.metaChip, highlighted && styles.metaChipHighlighted]}>
            <Ionicons
                name={icon}
                size={12}
                color={highlighted ? adminColors.primary : adminColors.textSecondary}
            />
            <Text style={[styles.metaChipText, highlighted && styles.metaChipTextHighlighted]}>
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    createButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primary,
        minHeight: 54,
        borderRadius: 12,
        paddingHorizontal: 16,
        marginBottom: 16,
        ...adminShadow.card,
    },
    createButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 8,
    },

    segmentedControl: {
        flexDirection: 'row',
        backgroundColor: adminColors.surface,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 12,
        padding: 4,
        marginBottom: 16,
    },
    segment: {
        flex: 1,
        minHeight: 40,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderRadius: 9,
    },
    segmentSelected: { backgroundColor: adminColors.primary },
    segmentText: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textSecondary,
    },
    segmentTextSelected: { color: '#FFFFFF' },

    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        marginBottom: 10,
        fontWeight: '600',
    },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center' },
    statusRow: { flexDirection: 'row', marginTop: 6 },
    chevron: {
        width: 28,
        height: 28,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    categoryIconCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardHeadings: { flex: 1, marginLeft: 14, marginRight: 8 },
    categoryText: {
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.textPrimary,
    },

    descriptionText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 19,
        marginTop: 12,
    },

    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    metaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surfaceMuted,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    metaChipHighlighted: {
        backgroundColor: adminColors.primarySoft,
        borderColor: adminColors.primarySoft,
    },
    metaChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 4,
    },
    metaChipTextHighlighted: { color: adminColors.primary },

    cardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 14,
        paddingTop: 12,
    },
    footerText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginLeft: 6,
    },
});
