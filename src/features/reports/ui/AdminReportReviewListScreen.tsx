import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Image,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSearchField } from '../../admin/ui/AdminSearchField';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { fetchReportsForReview } from '../api/reportReviewApi';
import {
    ADMIN_REVIEW_FILTERS,
    AdminReviewFilter,
    AdminReviewReport,
    NEEDS_REVIEW_LABEL,
    adminReviewCardSummary,
    adminReviewQueueSummary,
    reviewErrorMessage,
} from '../utils/reportReview';
import { adminReviewDetailsPath } from '../utils/reportRoutes';
import {
    REPORT_SEARCH_PLACEHOLDER,
    filterReportsBySearch,
} from '../utils/reportSearch';
import { ReportFeedbackStats } from './ReportFeedbackStats';

/**
 * The reports waiting on an administrator (MOV-160).
 *
 * Answered by GET /api/reports?scope=review, which is the same listing endpoint
 * the passenger tabs use, told apart by the scope — so the queue and the report
 * screens describe one report identically. Being an admin is checked by that
 * route before any query runs; the screen only decides what to draw.
 *
 * Every number on a card comes with the list: the vote tallies are stored on
 * the report, the comment count is tallied for the whole page by the API, and
 * the review flag is the backend's own. Nothing here counts, guesses or fetches
 * per card — thirty reports cost the one request they always did.
 *
 * The report id is not on the card. It travels in the path, exactly as it does
 * on the passenger list, because the card is opened rather than looked up.
 */
export const AdminReportReviewListScreen = () => {
    const { token, isAuthenticated } = useAuthStore();

    const [reports, setReports] = useState<AdminReviewReport[]>([]);
    const [filter, setFilter] = useState<AdminReviewFilter>('ALL');

    // Applied on top of the filter rather than instead of it: the filter is a
    // parameter on the review scope the API answers, and the search narrows
    // the queue that came back. Needs Review + "138" is the flagged reports
    // about route 138, not a second filtering system.
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Read on a focus event rather than depended on, so switching filter does
    // not re-subscribe the effect below. Always well after the commit that
    // last set it.
    const filterRef = useRef(filter);

    useEffect(() => {
        filterRef.current = filter;
    }, [filter]);

    const load = useCallback(
        async (target: AdminReviewFilter, mode: 'initial' | 'refresh' = 'initial') => {
            if (!isAuthenticated || !token) {
                setError('Authentication required.');
                setIsLoading(false);
                setIsRefreshing(false);
                return;
            }

            if (mode === 'refresh') setIsRefreshing(true);
            else setIsLoading(true);

            setError(null);

            const result = await fetchReportsForReview(token, target);

            if (result.ok) {
                // Replaces the list outright, so a refresh can never duplicate
                // rows or leave a decided report on a queue that no longer
                // contains it.
                setReports(result.value.reports);
            } else {
                setError(reviewErrorMessage(result.status, result.message));
            }

            setIsLoading(false);
            setIsRefreshing(false);
        },
        [isAuthenticated, token]
    );

    // Reloaded on focus, so a report decided on the review screen is already
    // showing its new status by the time the admin comes back to the queue.
    useFocusEffect(
        useCallback(() => {
            load(filterRef.current);
        }, [load])
    );

    const changeFilter = (next: AdminReviewFilter) => {
        setFilter(next);
        load(next);
    };

    const visibleReports = useMemo(
        () => filterReportsBySearch(reports, search),
        [reports, search]
    );

    // Counted over what is actually on screen, so the line above the list
    // describes the queue the admin is looking at.
    const summary = useMemo(() => adminReviewQueueSummary(visibleReports), [visibleReports]);

    // The box is only worth drawing over a queue there is something to search.
    const canSearch = !isLoading && !error && reports.length > 0;

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={3} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load reports"
                    message={error}
                    retryLabel="Try Again"
                    onRetry={() => load(filter)}
                />
            );
        }

        if (reports.length === 0) {
            return (
                <AdminEmptyState
                    icon={filter === 'FLAGGED' ? 'shield-checkmark-outline' : 'documents-outline'}
                    title={
                        filter === 'FLAGGED'
                            ? 'No reports need review'
                            : 'No reports to review'
                    }
                    description={
                        filter === 'FLAGGED'
                            ? 'Reports the community flags for review will appear here.'
                            : 'Accessibility reports submitted by passengers will appear here.'
                    }
                />
            );
        }

        // Told apart from the empty queue above: there are reports here, the
        // search is simply not finding them, so the way out is different words
        // rather than a different filter.
        if (visibleReports.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching reports"
                    description="No reports match your search. Try an issue, a bus, a route or a word from the description."
                />
            );
        }

        return (
            <>
                <View style={styles.summaryRow}>
                    <Text style={styles.resultCount}>
                        {search.trim()
                            ? `${summary.total} of ${reports.length} report${
                                  reports.length === 1 ? '' : 's'
                              }`
                            : `${summary.total} report${summary.total === 1 ? '' : 's'}`}
                    </Text>

                    {summary.flagged > 0 && (
                        <Text style={styles.summaryFlagged}>
                            {summary.flagged} flagged · {summary.pending} pending
                        </Text>
                    )}
                </View>

                {visibleReports.map((report) => (
                    <ReviewQueueCard
                        key={report.documentId || report.reportId}
                        report={report}
                        // The id travels in the path and nowhere else — it is
                        // how the report is addressed, not something an admin
                        // reads off a row. The decision itself lives on the
                        // screen this opens, where there is the evidence to
                        // make it.
                        onOpen={() =>
                            router.push(
                                adminReviewDetailsPath(
                                    report.documentId || report.reportId
                                ) as Href
                            )
                        }
                    />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Review Reports"
                subtitle="Verify or reject accessibility issues reported by passengers"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                // So a card can be opened on the first tap while the search
                // keyboard is up, rather than the tap only dismissing it.
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={() => load(filter, 'refresh')}
                    />
                }
            >
                {/* Each filter is a parameter on the review scope, so the queue
                    asks the API for the slice it means to show rather than
                    narrowing a wider list here. */}
                <View style={styles.segmentedControl} accessibilityRole="tablist">
                    {ADMIN_REVIEW_FILTERS.map((tab) => {
                        const isSelected = filter === tab.value;

                        return (
                            <TouchableOpacity
                                key={tab.value}
                                style={[styles.segment, isSelected && styles.segmentSelected]}
                                onPress={() => changeFilter(tab.value)}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: isSelected }}
                                accessibilityLabel={`Show ${tab.label} reports`}
                            >
                                <Text
                                    style={[
                                        styles.segmentText,
                                        isSelected && styles.segmentTextSelected,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {/* Below the filters, so it reads as searching the slice
                    that is open — which is exactly what it does. */}
                {canSearch && (
                    <AdminSearchField
                        value={search}
                        onChangeText={setSearch}
                        placeholder={REPORT_SEARCH_PLACEHOLDER}
                        accessibilityLabel="Search reports"
                        resultLabel={`${visibleReports.length}/${reports.length}`}
                    />
                )}

                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------

/**
 * One report, as a row in the review queue.
 *
 * The whole card is the control: there is exactly one thing to do with a report
 * from here — open it to decide it — so a button inside the card would only be
 * a smaller target for the same action. It carries a single accessibility label
 * that leads with the status and the review flag, because those are why the row
 * is worth an admin's attention.
 */
function ReviewQueueCard({
    report,
    onOpen,
}: {
    report: AdminReviewReport;
    onOpen: () => void;
}) {
    // Everything the card puts on screen, derived in one place — including the
    // fact that the report id is not part of it.
    const summary = adminReviewCardSummary(report);

    // The first photo filed with the report stands in as the card's thumbnail,
    // exactly as it does on the passenger list. A report without photos keeps
    // the category icon, and the count of the rest stays in the meta line.
    const thumbnailUrl = report.photoUrls?.[0];

    return (
        <TouchableOpacity
            style={[styles.card, summary.needsReview && styles.cardFlagged]}
            onPress={onOpen}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={summary.accessibilityLabel}
            accessibilityHint="Opens the report for review"
        >
            {/* Said in words and with an icon, never by the border alone: a
                flag carried only by colour is a flag half the admins using
                this screen never see. */}
            {summary.needsReview && (
                <View style={styles.needsReviewBanner}>
                    <Ionicons name="flag" size={12} color={adminColors.warning} />
                    <Text style={styles.needsReviewText}>{NEEDS_REVIEW_LABEL}</Text>
                </View>
            )}

            <View style={styles.cardTop}>
                {/* Decorative either way: everything it stands for — the issue
                    and the photos — is already in the card's one label. */}
                <View
                    style={styles.thumbnail}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    {thumbnailUrl ? (
                        <Image
                            source={{ uri: thumbnailUrl }}
                            style={styles.thumbnailImage}
                            resizeMode="cover"
                        />
                    ) : (
                        <Ionicons name={summary.icon} size={26} color={adminColors.primary} />
                    )}
                </View>

                <View style={styles.cardHeadings}>
                    <View style={styles.titleRow}>
                        <Text style={styles.categoryText} numberOfLines={2}>
                            {summary.title}
                        </Text>

                        <StatusBadge status={summary.status} size="small" />
                    </View>

                    {summary.chips.length > 0 && (
                        <View style={styles.chipWrap}>
                            {summary.chips.map((chip) => (
                                <View key={chip.label} style={styles.metaChip}>
                                    <Ionicons
                                        name={chip.icon}
                                        size={12}
                                        color={adminColors.textSecondary}
                                    />
                                    <Text style={styles.metaChipText} numberOfLines={1}>
                                        {chip.label}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <Text style={styles.descriptionText} numberOfLines={2}>
                        {summary.description}
                    </Text>
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
                        size={18}
                        color={adminColors.textPlaceholder}
                    />
                </View>
            </View>

            <View style={styles.cardFooter}>
                <View style={styles.submittedGroup}>
                    <Ionicons name="calendar-outline" size={13} color={adminColors.textMuted} />
                    <Text style={styles.footerText} numberOfLines={1}>
                        {summary.submittedLabel}
                    </Text>
                </View>

                <View style={styles.footerActions}>
                    {/* The comment count and both vote tallies, all off the
                        list response — the same row the passenger cards
                        carry. */}
                    <ReportFeedbackStats counts={summary.feedbackCounts} variant="inline" />

                    <Text style={styles.viewReport}>View Report</Text>
                </View>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

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

    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        fontWeight: '600',
    },
    summaryFlagged: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.warning,
    },

    // The same row the passenger cards draw: the thumbnail leads, everything
    // read about the report sits beside it, and the footer closes the card
    // off — so one report describes itself identically on both sides of the
    // app. What stays admin-only is the review flag and "View Report".
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        ...adminShadow.card,
    },
    cardFlagged: {
        borderLeftWidth: 3,
        borderLeftColor: adminColors.warning,
    },

    needsReviewBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: adminColors.warningSoft,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 4,
        marginBottom: 10,
    },
    needsReviewText: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.warning,
        marginLeft: 4,
        letterSpacing: 0.2,
    },

    cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
    thumbnail: {
        width: 64,
        height: 64,
        borderRadius: 12,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        // Keeps a photo inside the rounded corner on Android.
        overflow: 'hidden',
    },
    thumbnailImage: { width: '100%', height: '100%' },
    cardHeadings: { flex: 1, marginLeft: 12, marginRight: 6 },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    categoryText: {
        flex: 1,
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.textPrimary,
        lineHeight: 20,
    },
    chevron: {
        width: 20,
        // Aligned to the title beside it rather than centred on a row whose
        // height changes with the description.
        paddingTop: 4,
        alignItems: 'flex-end',
    },

    descriptionText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 18,
        marginTop: 6,
    },

    // The bus, the route and the photo count read as one scannable line of
    // metadata, so they carry their icons without a pill each.
    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        rowGap: 4,
        columnGap: 10,
        marginTop: 5,
    },
    metaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
    },
    metaChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 4,
        flexShrink: 1,
    },

    cardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        rowGap: 6,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 10,
        paddingTop: 9,
    },
    // Shrinks before the tallies do, so a narrow phone trims the date rather
    // than pushing a count off the card.
    submittedGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        marginRight: 10,
    },
    footerText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginLeft: 5,
        flexShrink: 1,
    },
    footerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    viewReport: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.primary,
        letterSpacing: 0.2,
    },
});
