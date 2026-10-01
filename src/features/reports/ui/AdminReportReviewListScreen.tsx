import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    
    TouchableOpacity,
    View
} from 'react-native';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSearchField } from '../../admin/ui/AdminSearchField';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { getComplaints } from '../../admin/api/complaintAdminApi';
import { fetchReportsForReview } from '../api/reportReviewApi';
import {
    ADMIN_COMPLAINT_FILTERS,
    COMPLAINT_INDEX_ERROR,
    COMPLAINT_INDEX_LOADING,
    COMPLAINT_STATUS_UNAVAILABLE_MESSAGE,
    ComplaintBadge,
    ComplaintBadgeTone,
    ComplaintIndex,
    ComplaintPresenceFilter,
    adminComplaintFilterLabel,
    filterReportsByComplaint,
    indexComplaintsByReport,
    reportComplaintBadge,
} from '../utils/reportComplaintStatus';
import {
    ADMIN_REPORT_TYPE_FILTERS,
    ADMIN_REVIEW_FILTERS,
    AdminReviewFilter,
    AdminReviewReport,
    NEEDS_REVIEW_LABEL,
    adminReportTypeCounts,
    adminReportTypeFilterLabel,
    adminReviewCardSummary,
    adminReviewQueueSummary,
    filterReportsByType,
    reportsForReviewFilter,
    reviewErrorMessage,
} from '../utils/reportReview';
import { adminReviewDetailsPath } from '../utils/reportRoutes';
import {
    REPORT_SEARCH_PLACEHOLDER,
    ReportTypeFilter,
    filterReportsBySearch,
} from '../utils/reportSearch';
import { ReportListCard } from './ReportListCard';

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

    // Positive feedback or issue reports, on top of both. Held beside the
    // search rather than inside it for the same reason: the tab is the slice
    // the API was asked for, and splitting that slice by type is not another
    // question to ask it — both reports have always come from the one
    // collection, told apart by the `type` the report already carries.
    const [typeFilter, setTypeFilter] = useState<ReportTypeFilter>('ALL');

    // Whether a verified issue already has a complaint, beside the type. Read
    // off the existing complaint list, matched to the reports on screen — the
    // report's own status never says, because it stays VERIFIED whatever
    // happens to the complaint.
    const [complaintFilter, setComplaintFilter] = useState<ComplaintPresenceFilter>('ALL');
    const [complaintIndex, setComplaintIndex] = useState<ComplaintIndex>(COMPLAINT_INDEX_LOADING);

    const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

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

            // Asked together, landing independently: complaints that fail to
            // load cost the complaint badges, never the queue itself.
            const [result, complaints] = await Promise.all([
                fetchReportsForReview(token, target),
                getComplaints(token),
            ]);

            setComplaintIndex(
                complaints.ok ? indexComplaintsByReport(complaints.value) : COMPLAINT_INDEX_ERROR
            );

            if (result.ok) {
                // Replaces the list outright, so a refresh can never duplicate
                // rows or leave a decided report on a queue that no longer
                // contains it. Kept to the tab by type as well as status, so
                // positive feedback never sits on Pending or Verified.
                setReports(reportsForReviewFilter(result.value.reports, target));
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

    // Status (the tab, asked of the API), then the search, then the type.
    // Each narrows what the one before it left, so the three compose: Pending +
    // "NB-5678" + Positive Feedback is the pending positive feedback about that
    // bus, and clearing any one of them widens the list without disturbing the
    // other two.
    //
    // The complaint filter narrows last, and only ever to verified issue
    // reports: positive feedback cannot have a complaint.
    const visibleReports = useMemo(
        () =>
            filterReportsByComplaint(
                filterReportsByType(filterReportsBySearch(reports, search), typeFilter),
                complaintFilter,
                complaintIndex
            ),
        [reports, search, typeFilter, complaintFilter, complaintIndex]
    );

    const activeFilterCount = (typeFilter !== 'ALL' ? 1 : 0) + (complaintFilter !== 'ALL' ? 1 : 0);
    const filterSummary = [
        ...(typeFilter !== 'ALL' ? [adminReportTypeFilterLabel(typeFilter)] : []),
        ...(complaintFilter !== 'ALL' ? [adminComplaintFilterLabel(complaintFilter)] : []),
    ].join(', ');

    // Counted over what is actually on screen, so the line above the list
    // describes the queue the admin is looking at.
    const summary = useMemo(() => adminReviewQueueSummary(visibleReports), [visibleReports]);

    // The four numbers above the tabs, counted over everything the tab loaded
    // rather than over what the search and the type filter have left. They are
    // the shape of the queue — which is what the admin narrows against — so
    // they must not move every time a key is pressed.
    const typeCounts = useMemo(() => adminReportTypeCounts(reports), [reports]);

    // The row is only worth drawing over a queue there is something to narrow.
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
                    icon="documents-outline"
                    title="No reports to review"
                    description="Accessibility reports submitted by passengers will appear here."
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
                    description={
                        complaintFilter !== 'ALL'
                            ? complaintIndex.status === 'error'
                                ? COMPLAINT_STATUS_UNAVAILABLE_MESSAGE
                                : `No verified issue reports here match "${adminComplaintFilterLabel(
                                      complaintFilter
                                  )}". Try another tab, or show all complaint statuses.`
                            : typeFilter === 'ALL'
                              ? 'No reports match your search. Try an issue, a bus, a route or a word from the description.'
                              : `No ${adminReportTypeFilterLabel(
                                    typeFilter
                                ).toLowerCase()} match your search. Try another word, or show all report types.`
                    }
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
                        complaintBadge={reportComplaintBadge(report, complaintIndex)}
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
                subtitle="Verify or reject issue reports. Positive feedback is accepted automatically."
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
                {/* How the queue divides, before any of it is narrowed: how
                    much positive feedback there is (never reviewed), and how
                    many issue reports — in total, waiting and upheld. Four numbers off
                    the reports already loaded — no second request, and nothing
                    an admin has to open a report to find out. */}
                {canSearch && (
                    <View style={styles.countsGrid}>
                        <CountTile
                            label="Positive Feedback"
                            value={typeCounts.positive}
                            tone={adminColors.success}
                        />
                        <CountTile
                            label="Issue Reports"
                            value={typeCounts.issue}
                            tone={adminColors.warning}
                        />
                        <CountTile
                            label="Pending Issue Reports"
                            value={typeCounts.pendingIssue}
                            tone={adminColors.warning}
                        />
                        <CountTile
                            label="Verified Issue Reports"
                            value={typeCounts.verifiedIssue}
                            tone={adminColors.warning}
                        />
                    </View>
                )}

                {/* Pending and Verified are the issue review workflow; Published
                    is positive feedback, accepted without review. See
                    isInReviewFilter for exactly what each tab holds. */}
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

                {/* Below the tabs, so it reads as narrowing the slice that is
                    open — which is exactly what it does. The type filter sits
                    beside the box in the row the passenger reports list already
                    uses for the same pair. */}
                {canSearch && (
                    <View style={styles.searchRow}>
                        <View style={styles.searchField}>
                            <AdminSearchField
                                value={search}
                                onChangeText={setSearch}
                                placeholder={REPORT_SEARCH_PLACEHOLDER}
                                accessibilityLabel="Search reports"
                                resultLabel={`${visibleReports.length}/${reports.length}`}
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
                                activeFilterCount === 0
                                    ? 'Filter reports'
                                    : `Filter reports, showing ${filterSummary}`
                            }
                        >
                            <Ionicons
                                name="options-outline"
                                size={20}
                                color={activeFilterCount > 0 ? '#FFFFFF' : adminColors.primary}
                            />
                            {activeFilterCount > 0 && (
                                <View style={styles.filterCount}>
                                    <Text style={styles.filterCountText}>{activeFilterCount}</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>
                )}

                {/* Said once, above the list, rather than as a blank chip on
                    every card: the queue is fine, only the complaint badges are
                    missing. */}
                {canSearch && complaintIndex.status === 'error' && (
                    <View style={styles.complaintNotice} accessibilityLiveRegion="polite">
                        <Ionicons
                            name="alert-circle-outline"
                            size={15}
                            color={adminColors.textSecondary}
                        />
                        <Text style={styles.complaintNoticeText}>
                            {COMPLAINT_STATUS_UNAVAILABLE_MESSAGE}
                        </Text>
                    </View>
                )}

                {renderBody()}
            </ScrollView>

            <ReviewFilterSheet
                visible={isFilterSheetOpen}
                typeFilter={typeFilter}
                complaintFilter={complaintFilter}
                onChangeType={setTypeFilter}
                onChangeComplaint={setComplaintFilter}
                onClose={() => setIsFilterSheetOpen(false)}
            />
        </View>
    );
};

// ------------------------------------------------------------------

/**
 * One number in the summary above the queue.
 *
 * Deliberately smaller than the dashboard's Overview cards: this is a line of
 * context over a list, not a dashboard, so it borrows the same surface, border
 * radius and shadow from the admin theme and none of the icon work. The number
 * is coloured by what it counts — the project's success green for feedback,
 * its warning amber for issues — which is the pairing the report type badges
 * already use.
 */
function CountTile({ label, value, tone }: { label: string; value: number; tone: string }) {
    return (
        <View style={styles.countTile} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text style={[styles.countValue, { color: tone }]}>{value}</Text>
            <Text style={styles.countLabel} numberOfLines={2}>
                {label}
            </Text>
        </View>
    );
}

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
    complaintBadge,
    onOpen,
}: {
    report: AdminReviewReport;
    /** Verified issue reports only; null on everything else. */
    complaintBadge: ComplaintBadge | null;
    onOpen: () => void;
}) {
    // Everything the card puts on screen, derived in one place — including the
    // fact that the report id is not part of it.
    const summary = adminReviewCardSummary(report);

    // The passenger list's card, so one report describes itself identically on
    // both sides of the app. What stays admin-only is passed in: the review
    // flag, and a label that leads with the status and the flag.
    return (
        <ReportListCard
            summary={summary}
            status={summary.status}
            onOpen={onOpen}
            accessibilityLabel={
                complaintBadge
                    ? `${summary.accessibilityLabel}, ${complaintBadge.label}`
                    : summary.accessibilityLabel
            }
            accessibilityHint="Opens the report for review"
            flagged={summary.needsReview}
            statusAccessory={
                complaintBadge ? <ComplaintStatusChip badge={complaintBadge} /> : null
            }
            banner={
                // Said in words and with an icon, never by the border alone: a
                // flag carried only by colour is a flag half the admins using
                // this screen never see.
                summary.needsReview ? (
                    <View style={styles.needsReviewBanner}>
                        <Ionicons name="flag" size={12} color={adminColors.warning} />
                        <Text style={styles.needsReviewText}>{NEEDS_REVIEW_LABEL}</Text>
                    </View>
                ) : summary.statusNote ? (
                    // Beside the "Verified" badge of positive feedback, so it
                    // is not read as an admin having reviewed it.
                    <View style={styles.autoAcceptedBanner}>
                        <Ionicons name="checkmark-circle-outline" size={12} color={adminColors.textMuted} />
                        <Text style={styles.autoAcceptedText}>{summary.statusNote}</Text>
                    </View>
                ) : null
            }
        />
    );
}

const COMPLAINT_CHIP_TONES: Record<
    ComplaintBadgeTone,
    { icon: keyof typeof Ionicons.glyphMap; color: string; background: string; border: string }
> = {
    // Neutral: not a problem, nothing has happened yet.
    none: {
        icon: 'remove-circle-outline',
        color: adminColors.textSecondary,
        background: adminColors.surfaceMuted,
        border: adminColors.border,
    },
    // Pending, Assigned, In Progress: being worked on.
    active: {
        icon: 'alert-circle-outline',
        color: adminColors.warning,
        background: adminColors.warningSoft,
        border: adminColors.warningSoft,
    },
    // Resolved: done, said quietly.
    resolved: {
        icon: 'checkmark-done-outline',
        color: adminColors.success,
        background: adminColors.successSoft,
        border: adminColors.successSoft,
    },
};

/**
 * The complaint status of a verified issue report, as a chip of its own.
 *
 * Deliberately not a StatusBadge: "Verified" is the report's status and this is
 * the complaint's, and drawing them alike would read as one fact. Smaller,
 * outlined rather than solid, and always carrying its words and an icon, so
 * the colour is never the only thing that says which state it is in.
 */
function ComplaintStatusChip({ badge }: { badge: ComplaintBadge }) {
    const tone = COMPLAINT_CHIP_TONES[badge.tone];

    return (
        <View
            style={[
                styles.complaintChip,
                { backgroundColor: tone.background, borderColor: tone.border },
            ]}
            // Part of the card's own label already.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <Ionicons name={tone.icon} size={12} color={tone.color} />
            <Text style={[styles.complaintChipText, { color: tone.color }]} numberOfLines={1}>
                {badge.label}
            </Text>
        </View>
    );
}

// ------------------------------------------------------------------

/**
 * The queue's filters, behind the one filter button: report type, and whether
 * a verified issue already has a complaint. Each choice applies at once, the
 * way the single type picker before it did.
 */
function ReviewFilterSheet({
    visible,
    typeFilter,
    complaintFilter,
    onChangeType,
    onChangeComplaint,
    onClose,
}: {
    visible: boolean;
    typeFilter: ReportTypeFilter;
    complaintFilter: ComplaintPresenceFilter;
    onChangeType: (value: ReportTypeFilter) => void;
    onChangeComplaint: (value: ComplaintPresenceFilter) => void;
    onClose: () => void;
}) {
    const canReset = typeFilter !== 'ALL' || complaintFilter !== 'ALL';

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.sheetBackdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close filters"
                />

                <View style={styles.sheet}>
                    <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle} accessibilityRole="header">
                            Filter Reports
                        </Text>

                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.sheetClose}
                            accessibilityRole="button"
                            accessibilityLabel="Close"
                        >
                            <Ionicons name="close" size={24} color={adminColors.textPrimary} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false}>
                        <FilterGroup
                            title="Report Type"
                            options={ADMIN_REPORT_TYPE_FILTERS}
                            selected={typeFilter}
                            onSelect={onChangeType}
                        />

                        <FilterGroup
                            title="Complaint Status"
                            hint="Verified issue reports only."
                            options={ADMIN_COMPLAINT_FILTERS}
                            selected={complaintFilter}
                            onSelect={onChangeComplaint}
                        />

                        {canReset && (
                            <TouchableOpacity
                                style={styles.sheetReset}
                                onPress={() => {
                                    onChangeType('ALL');
                                    onChangeComplaint('ALL');
                                }}
                                accessibilityRole="button"
                                accessibilityLabel="Clear all filters"
                            >
                                <Text style={styles.sheetResetText}>Clear Filters</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

/** One labelled set of choices in the filter sheet, as compact pills. */
function FilterGroup<T extends string>({
    title,
    hint,
    options,
    selected,
    onSelect,
}: {
    title: string;
    hint?: string;
    options: { value: T; label: string }[];
    selected: T;
    onSelect: (value: T) => void;
}) {
    return (
        <View style={styles.filterGroup}>
            <Text style={styles.filterGroupTitle} accessibilityRole="header">
                {title}
            </Text>
            {!!hint && <Text style={styles.filterGroupHint}>{hint}</Text>}

            <View style={styles.filterOptions} accessibilityRole="radiogroup">
                {options.map((option) => {
                    const isSelected = option.value === selected;

                    return (
                        <TouchableOpacity
                            key={option.value}
                            style={[styles.filterOption, isSelected && styles.filterOptionSelected]}
                            onPress={() => onSelect(option.value)}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: isSelected }}
                            accessibilityLabel={`${title}: ${option.label}`}
                        >
                            {isSelected && (
                                <Ionicons name="checkmark" size={15} color={adminColors.primary} />
                            )}
                            <Text
                                style={[
                                    styles.filterOptionText,
                                    isSelected && styles.filterOptionTextSelected,
                                ]}
                            >
                                {option.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 16, paddingBottom: 40 },

    // Two by two, so four numbers fit above the tabs without becoming a
    // dashboard. Same gap as the search row below it.
    countsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 16,
    },
    countTile: {
        // Half the row, less half the gap — two per line at any width.
        flexBasis: '47%',
        flexGrow: 1,
        backgroundColor: adminColors.surface,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        ...adminShadow.card,
    },
    countValue: {
        fontSize: 20,
        fontWeight: '700',
    },
    countLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 2,
    },

    // The search field keeps its own bottom margin, so the row aligns its
    // children to the top and the filter button matches the field's height —
    // the same row the passenger reports list draws for the same pair.
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
    filterButtonActive: {
        backgroundColor: adminColors.primary,
        borderColor: adminColors.primary,
    },
    // How many filters are on, so two active filters are not mistaken for one.
    filterCount: {
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        paddingHorizontal: 3,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    filterCountText: { fontSize: 10, fontWeight: '800', color: adminColors.primary },

    complaintNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: adminColors.surfaceMuted,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 9,
        marginBottom: 12,
    },
    complaintNoticeText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
        color: adminColors.textSecondary,
    },

    // ---- Complaint chip ----
    complaintChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 2,
        maxWidth: '100%',
    },
    complaintChipText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },

    // ---- Filter sheet ----
    sheetBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(26, 37, 48, 0.45)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: adminColors.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 28,
        maxHeight: '75%',
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    sheetTitle: { fontSize: 18, fontWeight: '700', color: adminColors.textPrimary },
    sheetClose: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    filterGroup: { marginTop: 14 },
    filterGroupTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    filterGroupHint: { fontSize: 12, color: adminColors.textMuted, marginTop: 3 },
    filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    filterOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surface,
    },
    filterOptionSelected: {
        borderColor: adminColors.primary,
        backgroundColor: adminColors.primarySoft,
    },
    filterOptionText: { fontSize: 14, fontWeight: '600', color: adminColors.textSecondary },
    filterOptionTextSelected: { color: adminColors.primary, fontWeight: '700' },
    sheetReset: {
        alignSelf: 'flex-start',
        minHeight: 44,
        justifyContent: 'center',
        marginTop: 14,
    },
    sheetResetText: { fontSize: 14, fontWeight: '700', color: adminColors.primary },

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
    autoAcceptedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 4,
        marginBottom: 10,
    },
    autoAcceptedText: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 4,
    },

});
