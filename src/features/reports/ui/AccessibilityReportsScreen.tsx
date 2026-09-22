import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View
} from 'react-native';
import { AccessibilityReport, ReportScope } from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSearchField } from '../../admin/ui/AdminSearchField';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { isReportOwnedBy } from '../utils/reportOwnership';
import {
    positiveFeedbackFormPath,
    reportDetailsPath,
    reportFormPath,
} from '../utils/reportRoutes';
import { reportsRequestPath } from '../utils/reportScopes';
import {
    DEFAULT_REPORT_FILTERS,
    REPORT_SEARCH_PLACEHOLDER,
    ReportListFilters,
    activeReportFilterCount,
    narrowReportList,
    reportRouteFilterOptions,
} from '../utils/reportSearch';
import { reportCardSummary } from '../utils/reportSummary';
import { ReportFilterSheet } from './ReportFilterSheet';
import { ReportListCard } from './ReportListCard';

/**
 * The two tabs: the whole community's reports, and the passenger's own.
 *
 * Verified reports are reached through the filter sheet's Status → Verified
 * rather than a tab of their own: `scope=all` already carries every verified
 * report, so the filter shows exactly what the old tab did without a third
 * request.
 */
const SCOPE_TABS: { value: ReportScope; label: string }[] = [
    { value: 'all', label: 'All Reports' },
    { value: 'my', label: 'My Reports' },
];

/**
 * What each tab shows when it comes back with nothing. Both offer the same way
 * out — file a report — because an empty list means there is nothing to read,
 * not that something went wrong.
 */
const EMPTY_STATES: Record<
    ReportScope,
    { icon: keyof typeof Ionicons.glyphMap; title: string; description: string }
> = {
    all: {
        icon: 'documents-outline',
        title: 'No accessibility reports yet',
        description: 'Reports and feedback shared by passengers will appear here.',
    },
    my: {
        icon: 'document-text-outline',
        title: 'You have not submitted any reports yet',
        description: 'Issues you report and feedback you share will appear here.',
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

/** A `?scope=` search param, when it names one of the two tabs. */
function scopeFromParam(value: string | string[] | undefined): ReportScope | null {
    const scope = Array.isArray(value) ? value[0] : value;

    return scope === 'all' || scope === 'my' ? scope : null;
}

export const AccessibilityReportsScreen = () => {
    const { token, user, isAuthenticated } = useAuthStore();

    // "View My Reports" on the submission screen returns here with
    // `?scope=my`, so the passenger lands on the tab holding what they filed.
    const params = useLocalSearchParams<{ scope?: string | string[] }>();
    const requestedScope = scopeFromParam(params.scope);

    const [feeds, setFeeds] = useState<Record<ReportScope, ReportFeed>>({
        all: INITIAL_FEED,
        my: INITIAL_FEED,
        verified: INITIAL_FEED,
    });
    const [scope, setScope] = useState<ReportScope>(requestedScope ?? 'all');

    // Follow the param when it changes while this screen stays mounted —
    // dismissing back to it updates the param rather than remounting it. The
    // state is adjusted during render (React's "storing information from
    // previous renders" pattern) rather than in an effect.
    const [lastRequestedScope, setLastRequestedScope] = useState(requestedScope);

    if (requestedScope !== lastRequestedScope) {
        setLastRequestedScope(requestedScope);
        if (requestedScope) setScope(requestedScope);
    }

    // The search and the filters are kept for the screen rather than per tab:
    // a passenger looking for one route wants the same narrowing applied as
    // they move between All and My, not two sets to redo.
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState<ReportListFilters>(DEFAULT_REPORT_FILTERS);
    const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

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
                // The tabs differ only by this parameter. The narrowing is
                // applied by the API — `my` against the passengerId on the
                // verified token — never by this screen against a wider list
                // it has already been given.
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

    // Reload the visible tab on focus, so a report submitted on a form screen
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

    // Positive feedback (MOV-300) sits beside the issue form, group-qualified
    // for the same reason.
    const goToPositiveFeedback = () => router.push(positiveFeedbackFormPath() as Href);

    const feed = feeds[scope];

    // Narrowed here, against the tab's own reports, because they are already
    // on the device: the scope is what the API was asked for, and searching or
    // filtering within it is not another question to ask it.
    const visibleReports = useMemo(
        () => narrowReportList(feed.reports, search, filters),
        [feed.reports, search, filters]
    );

    const routeOptions = useMemo(() => reportRouteFilterOptions(feed.reports), [feed.reports]);
    const activeFilterCount = activeReportFilterCount(filters);
    const isNarrowed = !!search.trim() || activeFilterCount > 0;

    // The controls are only worth drawing over a list there is something to
    // narrow — but they stay while a narrowing has emptied it, so it can be
    // undone from where it was set.
    const canNarrow = !feed.isLoading && !feed.error && feed.reports.length > 0;

    const clearNarrowing = () => {
        setSearch('');
        setFilters(DEFAULT_REPORT_FILTERS);
    };

    const renderBody = () => {
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
                    actionLabel="Report an Issue"
                    onAction={goToReportForm}
                />
            );
        }

        // Told apart from the empty tab above on purpose: there are reports
        // here, the search or the filters are simply not finding them, so the
        // way out is to change those rather than to file a report.
        if (visibleReports.length === 0) {
            // All Reports never carries a rejected report — the API keeps a
            // rejection for its author alone — so say where to find one.
            const rejectedHint =
                scope === 'all' && filters.status === 'REJECTED'
                    ? ' Rejected reports are only shown to the passenger who filed them, under My Reports.'
                    : '';

            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching reports"
                    description={`No reports match your search or filters.${rejectedHint}`}
                    actionLabel="Clear Search & Filters"
                    onAction={clearNarrowing}
                />
            );
        }

        return (
            <>
                <View style={styles.resultRow}>
                    <Text style={styles.resultCount}>
                        {isNarrowed
                            ? `${visibleReports.length} of ${feed.reports.length} report${
                                  feed.reports.length === 1 ? '' : 's'
                              }`
                            : `${feed.reports.length} report${feed.reports.length === 1 ? '' : 's'}`}
                    </Text>

                    {activeFilterCount > 0 && (
                        <TouchableOpacity
                            onPress={() => setFilters(DEFAULT_REPORT_FILTERS)}
                            style={styles.clearFiltersButton}
                            accessibilityRole="button"
                            accessibilityLabel="Clear filters"
                        >
                            <Text style={styles.clearFiltersText}>Clear filters</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {visibleReports.map((report) => (
                    <ReportListCard
                        key={report.reportId}
                        summary={reportCardSummary(report, {
                            // Marks the passenger's own reports on both tabs,
                            // so a card reads the same wherever it appears.
                            isOwnReport: isReportOwnedBy(report, user?.passengerId),
                        })}
                        status={typeof report.status === 'string' ? report.status : 'PENDING'}
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
                tone="brand"
                title="Accessibility Reports"
                subtitle="Share and track accessibility experiences"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                // So a card can be opened on the first tap while the search
                // keyboard is up, rather than the tap only dismissing it.
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={feed.isRefreshing}
                        onRefresh={() => fetchReports(scope, 'refresh')}
                    />
                }
            >
                {/* The two things this screen invites, side by side in one
                    card, so "something went wrong" and "something worked well"
                    read as equal choices. Red and green only mark which is
                    which; the card itself stays in the app's palette. */}
                <View style={styles.helpCard}>
                    <View style={styles.helpHeader}>
                        <View
                            style={styles.helpIcon}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                        >
                            <Ionicons name="accessibility" size={22} color={adminColors.primary} />
                        </View>
                        <View style={styles.helpHeaderText}>
                            <Text style={styles.helpTitle} accessibilityRole="header">
                                Help Improve Accessibility
                            </Text>
                            <Text style={styles.helpDescription}>
                                Report an issue or share a positive experience to make public
                                transport more inclusive for everyone.
                            </Text>
                        </View>
                    </View>

                    <View style={styles.actionList}>
                        <ActionTile
                            tone="issue"
                            icon="warning-outline"
                            title="Report an Issue"
                            description="Tell us what went wrong"
                            onPress={goToReportForm}
                        />
                        <ActionTile
                            tone="positive"
                            icon="thumbs-up-outline"
                            title="Share Positive Feedback"
                            description="Tell us what worked well"
                            onPress={goToPositiveFeedback}
                        />
                    </View>
                </View>

                {/* Scope tabs */}
                <View style={styles.segmentedControl} accessibilityRole="tablist">
                    {SCOPE_TABS.map((tab) => {
                        const isSelected = scope === tab.value;

                        return (
                            <TouchableOpacity
                                key={tab.value}
                                style={[styles.segment, isSelected && styles.segmentSelected]}
                                onPress={() => {
                                    setScope(tab.value);
                                    // Kept in step with the tab, so a later
                                    // return with ?scope=my is always a change.
                                    router.setParams({ scope: tab.value });
                                }}
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

                {/* Below the tabs, so it reads as narrowing the tab that is
                    open rather than the whole collection — which is exactly
                    what it does. */}
                {canNarrow && (
                    <View style={styles.searchRow}>
                        <View style={styles.searchField}>
                            <AdminSearchField
                                value={search}
                                onChangeText={setSearch}
                                placeholder={REPORT_SEARCH_PLACEHOLDER}
                                accessibilityLabel="Search reports"
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.filterButton,
                                activeFilterCount > 0 && styles.filterButtonActive,
                            ]}
                            onPress={() => setIsFilterSheetOpen(true)}
                            accessibilityRole="button"
                            accessibilityLabel={
                                activeFilterCount > 0
                                    ? `Filter reports, ${activeFilterCount} applied`
                                    : 'Filter reports'
                            }
                        >
                            <Ionicons
                                name="options-outline"
                                size={20}
                                color={activeFilterCount > 0 ? '#FFFFFF' : adminColors.primary}
                            />
                            {activeFilterCount > 0 && (
                                <View style={styles.filterBadge}>
                                    <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>
                )}

                {renderBody()}
            </ScrollView>

            {isFilterSheetOpen && (
                <ReportFilterSheet
                    filters={filters}
                    routeOptions={routeOptions}
                    onClose={() => setIsFilterSheetOpen(false)}
                    onApply={(next) => {
                        setFilters(next);
                        setIsFilterSheetOpen(false);
                    }}
                />
            )}
        </View>
    );
};

// ------------------------------------------------------------------

const TONES = {
    issue: {
        background: adminColors.dangerSoft,
        border: adminColors.dangerBorder,
        icon: adminColors.danger,
    },
    positive: {
        background: adminColors.successSoft,
        border: '#CFE8D1',
        icon: adminColors.success,
    },
} as const;

/**
 * One of the two actions in the help card.
 *
 * Both share one shape — a full-width row with an icon, a title, a line of
 * explanation and a chevron — so they read as two choices of the same feature.
 * Only the soft accent tells them apart, and the wording says it too.
 */
function ActionTile({
    tone,
    icon,
    title,
    description,
    onPress,
}: {
    tone: keyof typeof TONES;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
    onPress: () => void;
}) {
    const colors = TONES[tone];

    return (
        <TouchableOpacity
            style={[styles.actionTile, { backgroundColor: colors.background, borderColor: colors.border }]}
            onPress={onPress}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={description}
        >
            <View
                style={[styles.actionIconCircle, { borderColor: colors.border }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <Ionicons name={icon} size={22} color={colors.icon} />
            </View>

            <View style={styles.actionText}>
                <Text style={styles.actionTitle}>{title}</Text>
                <Text style={styles.actionDescription}>{description}</Text>
            </View>

            <View
                style={styles.actionArrow}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <Ionicons name="chevron-forward" size={20} color={colors.icon} />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 16, paddingBottom: 40 },

    helpCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 18,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderTopWidth: 4,
        borderTopColor: adminColors.primary,
        ...adminShadow.card,
    },
    helpHeader: { flexDirection: 'row', alignItems: 'flex-start' },
    helpIcon: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    helpHeaderText: { flex: 1, minWidth: 0 },
    helpTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: adminColors.textPrimary,
    },
    helpDescription: {
        marginTop: 4,
        fontSize: 14,
        color: adminColors.textSecondary,
        lineHeight: 20,
    },
    // Stacked full-width rows: each has room for its whole title on a narrow
    // phone, and a row with a chevron reads unmistakably as tappable.
    actionList: { gap: 10, marginTop: 16 },
    actionTile: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 72,
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 12,
        paddingHorizontal: 12,
    },
    actionIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        backgroundColor: adminColors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionText: { flex: 1, minWidth: 0, marginLeft: 12 },
    actionTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: adminColors.textPrimary,
        lineHeight: 21,
    },
    actionDescription: {
        marginTop: 2,
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 18,
    },
    actionArrow: { marginLeft: 8 },

    segmentedControl: {
        flexDirection: 'row',
        backgroundColor: adminColors.surface,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 12,
        padding: 4,
        marginBottom: 12,
    },
    segment: {
        flex: 1,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderRadius: 9,
    },
    segmentSelected: { backgroundColor: adminColors.primary },
    segmentText: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textSecondary,
    },
    segmentTextSelected: { color: '#FFFFFF' },

    // The search field keeps its own bottom margin, so the row aligns its
    // children to the top and the filter button matches the field's height.
    searchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    searchField: { flex: 1, minWidth: 0 },
    filterButton: {
        width: 48,
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    filterButtonActive: { backgroundColor: adminColors.primary, borderColor: adminColors.primary },
    filterBadge: {
        position: 'absolute',
        top: -5,
        right: -5,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 4,
        backgroundColor: adminColors.danger,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: adminColors.background,
    },
    filterBadgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },

    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        fontWeight: '600',
    },
    clearFiltersButton: { minHeight: 32, justifyContent: 'center', paddingLeft: 10 },
    clearFiltersText: { fontSize: 13, fontWeight: '700', color: adminColors.primary },
});
