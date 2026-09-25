import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AdminUserSummary } from '../../../entities/user/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import {
    reportCategoryIcon,
    reportCategoryLabel,
} from '../../reports/ui/reportCategories';
import { formatReportDateTime } from '../../reports/utils/reportFormat';
import { getComplaints } from '../api/complaintAdminApi';
import { getUsers } from '../api/userAdminApi';
import {
    AdminComplaint,
    COMPLAINT_SEARCH_PLACEHOLDER,
    COMPLAINT_STATUS_FILTERS,
    ComplaintStatusFilter,
    complaintAssigneeLabel,
    complaintDetailsPath,
    complaintErrorMessage,
    countComplaintsByStatus,
    filterComplaintsBySearch,
} from '../utils/complaintWorkflow';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminSearchField } from './AdminSearchField';
import { AdminSelectModal } from './AdminSelectModal';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

/** The assignee filter's "no filter" choice. Never a user document id. */
const ALL_ADMINS = '__ALL__';

/**
 * Complaint Management (MOV-176): every complaint opened from a verified
 * report, and where each one stands in getting fixed.
 *
 * One request per load. The assignee filter is the API's own `?assignedTo=`;
 * the status tab narrows what came back, so the four tiles above it keep
 * counting the whole workload whichever tab is open — the same arrangement the
 * review queue uses for its counts. Being an admin is checked by the API; the
 * screen only decides what to draw.
 *
 * Nothing here changes a complaint. Every workflow action lives on the detail
 * screen, where there is the complaint and its source report to act on.
 */
export const ComplaintListScreen = () => {
    const { token, isAuthenticated, user } = useAuthStore();

    const [complaints, setComplaints] = useState<AdminComplaint[]>([]);
    const [statusFilter, setStatusFilter] = useState<ComplaintStatusFilter>('ALL');
    const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    const [admins, setAdmins] = useState<AdminUserSummary[]>([]);
    const [isAssigneePickerOpen, setIsAssigneePickerOpen] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Read on focus rather than depended on, so changing the filter does not
    // re-subscribe the focus effect below.
    const assigneeRef = useRef(assigneeFilter);

    useEffect(() => {
        assigneeRef.current = assigneeFilter;
    }, [assigneeFilter]);

    const load = useCallback(
        async (assignedTo: string | null, mode: 'initial' | 'refresh' = 'initial') => {
            if (!isAuthenticated || !token) {
                setError(complaintErrorMessage(401));
                setIsLoading(false);
                setIsRefreshing(false);
                return;
            }

            if (mode === 'refresh') setIsRefreshing(true);
            else setIsLoading(true);

            setError(null);

            const result = await getComplaints(token, { assignedTo });

            if (result.ok) {
                // Replaced outright, so a complaint moved on the detail screen
                // shows its new status and assignee here straight away.
                setComplaints(result.value);
            } else {
                setError(complaintErrorMessage(result.status, result.message));
            }

            setIsLoading(false);
            setIsRefreshing(false);
        },
        [isAuthenticated, token]
    );

    // The administrators the assignee filter offers. Best effort: without them
    // the list still works, the filter simply has nobody to offer.
    const loadAdmins = useCallback(async () => {
        try {
            setAdmins(await getUsers('ADMIN'));
        } catch {
            setAdmins([]);
        }
    }, []);

    // Reloaded on focus, so coming back from a complaint that was just assigned
    // or resolved shows it as it now stands.
    useFocusEffect(
        useCallback(() => {
            load(assigneeRef.current);
            loadAdmins();
        }, [load, loadAdmins])
    );

    const changeAssignee = (next: string | null) => {
        setAssigneeFilter(next);
        setIsAssigneePickerOpen(false);
        load(next);
    };

    const counts = useMemo(() => countComplaintsByStatus(complaints), [complaints]);

    const visibleComplaints = useMemo(() => {
        const byStatus =
            statusFilter === 'ALL'
                ? complaints
                : complaints.filter((complaint) => complaint.status === statusFilter);

        return filterComplaintsBySearch(byStatus, search, reportCategoryLabel);
    }, [complaints, statusFilter, search]);

    // Every admin account, suspended ones included: a suspended admin can
    // still hold complaints that need finding.
    const assigneeOptions = useMemo(
        () => [
            { value: ALL_ADMINS, label: 'All administrators' },
            ...admins
                .filter((admin) => admin.role === 'ADMIN' && !!admin.documentId)
                .map((admin) => ({
                    value: admin.documentId,
                    label:
                        (admin.userName?.trim() || admin.documentId) +
                        (admin.documentId === user?.passengerId ? ' (you)' : ''),
                    description: admin.documentId,
                    status: admin.accountStatus === 'SUSPENDED' ? 'SUSPENDED' : undefined,
                })),
        ],
        [admins, user?.passengerId]
    );

    const assigneeFilterLabel = useMemo(() => {
        if (!assigneeFilter) return null;

        return (
            assigneeOptions.find((option) => option.value === assigneeFilter)?.label ??
            assigneeFilter
        );
    }, [assigneeFilter, assigneeOptions]);

    const isFiltered = statusFilter !== 'ALL' || !!assigneeFilter || !!search.trim();

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={3} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load complaints"
                    message={error}
                    retryLabel="Try Again"
                    onRetry={() => load(assigneeFilter)}
                />
            );
        }

        if (complaints.length === 0 && !assigneeFilter) {
            return (
                <AdminEmptyState
                    icon="construct-outline"
                    title="No complaints yet"
                    description="Complaints opened from verified accessibility reports will appear here."
                />
            );
        }

        if (visibleComplaints.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching complaints"
                    description="No complaints match the selected filters. Try another status, administrator or search."
                    actionLabel={isFiltered ? 'Clear Filters' : undefined}
                    actionIcon="close-circle-outline"
                    onAction={
                        isFiltered
                            ? () => {
                                  setStatusFilter('ALL');
                                  setSearch('');
                                  if (assigneeFilter) changeAssignee(null);
                              }
                            : undefined
                    }
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {visibleComplaints.length === complaints.length
                        ? `${complaints.length} complaint${complaints.length === 1 ? '' : 's'}`
                        : `${visibleComplaints.length} of ${complaints.length} complaints`}
                </Text>

                {visibleComplaints.map((complaint) => (
                    <ComplaintCard
                        key={complaint.complaintId}
                        complaint={complaint}
                        isMine={!!user?.passengerId && complaint.assignedTo === user.passengerId}
                        onOpen={() =>
                            router.push(complaintDetailsPath(complaint.complaintId) as Href)
                        }
                    />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Complaint Management"
                subtitle="Assign, track and resolve complaints from verified reports"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={() => load(assigneeFilter, 'refresh')}
                    />
                }
            >
                {/* The workload by state. Each tile also opens its tab. */}
                {!isLoading && !error && (
                    <View style={styles.countsGrid}>
                        <CountTile
                            label="Pending"
                            value={counts.PENDING}
                            tone={adminColors.warning}
                            selected={statusFilter === 'PENDING'}
                            onPress={() => setStatusFilter('PENDING')}
                        />
                        <CountTile
                            label="Assigned"
                            value={counts.ASSIGNED}
                            tone={adminColors.primary}
                            selected={statusFilter === 'ASSIGNED'}
                            onPress={() => setStatusFilter('ASSIGNED')}
                        />
                        <CountTile
                            label="In Progress"
                            value={counts.IN_PROGRESS}
                            tone={adminColors.accent}
                            selected={statusFilter === 'IN_PROGRESS'}
                            onPress={() => setStatusFilter('IN_PROGRESS')}
                        />
                        <CountTile
                            label="Resolved"
                            value={counts.RESOLVED}
                            tone={adminColors.success}
                            selected={statusFilter === 'RESOLVED'}
                            onPress={() => setStatusFilter('RESOLVED')}
                        />
                    </View>
                )}

                <View style={styles.segmentedControl} accessibilityRole="tablist">
                    {COMPLAINT_STATUS_FILTERS.map((tab) => {
                        const isSelected = statusFilter === tab.value;

                        return (
                            <TouchableOpacity
                                key={tab.value}
                                style={[styles.segment, isSelected && styles.segmentSelected]}
                                onPress={() => setStatusFilter(tab.value)}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: isSelected }}
                                accessibilityLabel={`Show ${tab.label} complaints`}
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

                {!isLoading && !error && (
                    <View style={styles.searchRow}>
                        <View style={styles.searchField}>
                            <AdminSearchField
                                value={search}
                                onChangeText={setSearch}
                                placeholder={COMPLAINT_SEARCH_PLACEHOLDER}
                                accessibilityLabel="Search complaints"
                                resultLabel={`${visibleComplaints.length}/${complaints.length}`}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.filterButton, !!assigneeFilter && styles.filterButtonActive]}
                            onPress={() => setIsAssigneePickerOpen(true)}
                            accessibilityRole="button"
                            accessibilityLabel={
                                assigneeFilterLabel
                                    ? `Filter by assigned administrator, showing ${assigneeFilterLabel}`
                                    : 'Filter by assigned administrator'
                            }
                        >
                            <Ionicons
                                name="person-outline"
                                size={20}
                                color={assigneeFilter ? '#FFFFFF' : adminColors.primary}
                            />
                        </TouchableOpacity>
                    </View>
                )}

                {!!assigneeFilterLabel && (
                    <TouchableOpacity
                        style={styles.activeFilterChip}
                        onPress={() => changeAssignee(null)}
                        accessibilityRole="button"
                        accessibilityLabel={`Assigned to ${assigneeFilterLabel}. Clear this filter`}
                    >
                        <Ionicons name="person" size={13} color={adminColors.primary} />
                        <Text style={styles.activeFilterText} numberOfLines={1}>
                            Assigned to {assigneeFilterLabel}
                        </Text>
                        <Ionicons name="close" size={15} color={adminColors.primary} />
                    </TouchableOpacity>
                )}

                {renderBody()}
            </ScrollView>

            <AdminSelectModal
                visible={isAssigneePickerOpen}
                title="Assigned Administrator"
                options={assigneeOptions}
                selectedValue={assigneeFilter ?? ALL_ADMINS}
                emptyMessage="No administrators found."
                onClose={() => setIsAssigneePickerOpen(false)}
                onSelect={(value) => changeAssignee(value === ALL_ADMINS ? null : value)}
            />
        </View>
    );
};

// ------------------------------------------------------------------

function CountTile({
    label,
    value,
    tone,
    selected,
    onPress,
}: {
    label: string;
    value: number;
    tone: string;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.countTile, selected && { borderColor: tone }]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label}: ${value}. Show ${label.toLowerCase()} complaints`}
        >
            <Text style={[styles.countValue, { color: tone }]}>{value}</Text>
            <Text style={styles.countLabel} numberOfLines={1}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

/**
 * One complaint, as a row. The whole card opens it: there is one thing to do
 * with a complaint from here, and the actions live where it can be read in full.
 */
function ComplaintCard({
    complaint,
    isMine,
    onOpen,
}: {
    complaint: AdminComplaint;
    isMine: boolean;
    onOpen: () => void;
}) {
    const category = reportCategoryLabel(complaint.issueCategory);
    const assignee = complaintAssigneeLabel(complaint);
    const bus = complaint.vehicle?.numberPlate ?? complaint.busId;
    const route = complaint.route
        ? [complaint.route.routeNumber, complaint.route.routeName].filter(Boolean).join(' · ')
        : complaint.routeId;

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onOpen}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={[
                `Complaint ${complaint.complaintId}`,
                category,
                `Status ${complaint.status.replace('_', ' ').toLowerCase()}`,
                assignee ? `Assigned to ${assignee}` : 'Not assigned',
            ].join(', ')}
            accessibilityHint="Opens the complaint"
        >
            <View style={styles.cardTop}>
                <View style={styles.cardIcon}>
                    <Ionicons
                        name={reportCategoryIcon(complaint.issueCategory)}
                        size={20}
                        color={adminColors.primary}
                    />
                </View>

                <View style={styles.cardTitleGroup}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                        {category}
                    </Text>
                    <Text style={styles.cardId}>{complaint.complaintId}</Text>
                </View>

                <StatusBadge status={complaint.status} size="small" />
            </View>

            {!!complaint.description && (
                <Text style={styles.cardDescription} numberOfLines={2}>
                    {complaint.description}
                </Text>
            )}

            <View style={styles.metaRow}>
                {!!bus && <MetaChip icon="bus-outline" text={bus} />}
                {!!route && <MetaChip icon="git-branch-outline" text={route} />}
                <MetaChip
                    icon={assignee ? 'person-outline' : 'person-add-outline'}
                    text={assignee ? `${assignee}${isMine ? ' (you)' : ''}` : 'Unassigned'}
                    muted={!assignee}
                />
            </View>

            <View style={styles.cardFooter}>
                <Text style={styles.cardDate}>Created {formatReportDateTime(complaint.createdAt)}</Text>
                <Text style={styles.cardDate}>Updated {formatReportDateTime(complaint.updatedAt)}</Text>
            </View>
        </TouchableOpacity>
    );
}

function MetaChip({
    icon,
    text,
    muted = false,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
    muted?: boolean;
}) {
    return (
        <View style={styles.metaChip}>
            <Ionicons
                name={icon}
                size={13}
                color={muted ? adminColors.textPlaceholder : adminColors.textSecondary}
            />
            <Text style={[styles.metaText, muted && styles.metaTextMuted]} numberOfLines={1}>
                {text}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 16, paddingBottom: 40 },

    countsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 16,
    },
    countTile: {
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 64,
        backgroundColor: adminColors.surface,
        borderWidth: 1.5,
        borderColor: adminColors.border,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        ...adminShadow.card,
    },
    countValue: { fontSize: 20, fontWeight: '700' },
    countLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 2,
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
        paddingHorizontal: 4,
        borderRadius: 9,
    },
    segmentSelected: { backgroundColor: adminColors.primary },
    segmentText: { fontSize: 12, fontWeight: '700', color: adminColors.textSecondary },
    segmentTextSelected: { color: '#FFFFFF' },

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

    activeFilterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        minHeight: 36,
        backgroundColor: adminColors.primarySoft,
        borderRadius: 18,
        paddingHorizontal: 12,
        marginBottom: 14,
        maxWidth: '100%',
    },
    activeFilterText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.primary,
    },

    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        fontWeight: '600',
        marginBottom: 10,
    },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center' },
    cardIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitleGroup: { flex: 1, marginHorizontal: 12 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: adminColors.textPrimary },
    cardId: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 2,
    },
    cardDescription: {
        fontSize: 14,
        color: adminColors.textSecondary,
        lineHeight: 20,
        marginTop: 12,
    },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    metaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
        maxWidth: '100%',
    },
    metaText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textSecondary,
    },
    metaTextMuted: { color: adminColors.textPlaceholder },
    cardFooter: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 6,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 12,
        paddingTop: 10,
    },
    cardDate: { fontSize: 11, fontWeight: '600', color: adminColors.textMuted },
});
