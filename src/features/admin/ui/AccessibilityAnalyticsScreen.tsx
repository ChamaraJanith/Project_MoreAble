import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuthStore } from '../../../shared/store/authStore';
import {
    ANALYTICS_FALLBACK_MESSAGE,
    fetchAccessibilityAnalytics,
} from '../api/accessibilityAnalyticsApi';
import { BusAccessibilitySummary } from '../utils/accessibilityAnalytics';
import {
    BUS_SCORE_SORT_LABELS,
    BusScoreRow,
    BusScoreSort,
    BusStatusFilter,
    busScoreRows,
    filterBusScoreRows,
} from '../utils/accessibilityAnalyticsPresentation';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { ScoreBar } from './AccessibilityScoreBar';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

// Accessibility Analytics for admins: every bus, each with its own score.
//
// Reads GET /api/analytics/accessibility once and draws its `buses` list. No
// score is calculated here: each bus arrives with the number MOV-79's
// computeAccessibilityScore produced on the server, and what it SAYS (band,
// colour, wording, search and order) lives in
// utils/accessibilityAnalyticsPresentation so it can be tested without a
// renderer. There is deliberately no fleet-wide figure on this page — no
// average, no route ranking and no average-over-time chart.
//
// Search and the status filter follow the Buses management screen, so an admin
// finds a bus the same way on both.

type ScreenState = 'loading' | 'error' | 'ready';

const STATUS_FILTERS: { value: BusStatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'MAINTENANCE', label: 'Maintenance' },
];

const SORTS: BusScoreSort[] = ['SCORE_ASC', 'SCORE_DESC', 'PLATE'];

export const AccessibilityAnalyticsScreen = () => {
    const { token, isAuthenticated } = useAuthStore();

    const [buses, setBuses] = useState<BusAccessibilitySummary[]>([]);
    const [state, setState] = useState<ScreenState>('loading');
    const [errorMessage, setErrorMessage] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<BusStatusFilter>('ALL');
    const [sort, setSort] = useState<BusScoreSort>('SCORE_ASC');

    const load = useCallback(
        async (mode: 'initial' | 'refresh' = 'initial') => {
            if (mode === 'refresh') setIsRefreshing(true);
            else setState('loading');

            if (!isAuthenticated || !token) {
                setBuses([]);
                setErrorMessage('Your session has expired. Please sign in again.');
                setState('error');
                setIsRefreshing(false);
                return;
            }

            const result = await fetchAccessibilityAnalytics(token);

            if (result.ok) {
                setBuses(result.value.buses);
                setErrorMessage('');
                setState('ready');
            } else {
                // Nothing stale is left behind a failure: a score an admin
                // cannot tell is out of date is worse than no score.
                setBuses([]);
                setErrorMessage(result.message || ANALYTICS_FALLBACK_MESSAGE);
                setState('error');
            }

            setIsRefreshing(false);
        },
        [isAuthenticated, token]
    );

    // Refreshed on focus, so the scores are current after an admin verifies a
    // report or edits a bus and comes back.
    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const rows = useMemo(() => busScoreRows(buses), [buses]);
    const visibleRows = useMemo(
        () => filterBusScoreRows(rows, { search, status: statusFilter, sort }),
        [rows, search, statusFilter, sort]
    );

    const openBus = (busId: string) =>
        router.push({ pathname: '/(admin)/analytics/[busId]', params: { busId } });

    const renderBody = () => {
        if (state === 'loading') return <AdminListSkeleton count={4} />;

        if (state === 'error') {
            return (
                <AdminErrorState
                    title="Unable to load accessibility analytics."
                    message={errorMessage}
                    onRetry={() => load()}
                />
            );
        }

        if (rows.length === 0) {
            return (
                <AdminEmptyState
                    icon="bus-outline"
                    title="No buses registered yet"
                    description="Each bus appears here with its accessibility score once it is added to the fleet."
                />
            );
        }

        if (visibleRows.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching buses"
                    description="No buses match your search or filter. Try a different number plate, bus ID, model or status."
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {visibleRows.length} of {rows.length} bus{rows.length === 1 ? '' : 'es'}
                </Text>

                {visibleRows.map((row) => (
                    <BusScoreCard key={row.busId} row={row} onPress={() => openBus(row.busId)} />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Accessibility Analytics"
                subtitle="Monitor accessibility performance across all buses"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={() => load('refresh')} />
                }
            >
                <View style={styles.searchWrapper}>
                    <Ionicons name="search" size={18} color={adminColors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search plate, bus ID, model or manufacturer"
                        placeholderTextColor={adminColors.textPlaceholder}
                        value={search}
                        onChangeText={setSearch}
                        autoCapitalize="characters"
                        accessibilityLabel="Search buses"
                    />
                    {!!search && (
                        <TouchableOpacity
                            onPress={() => setSearch('')}
                            accessibilityRole="button"
                            accessibilityLabel="Clear search"
                            style={styles.clearSearchButton}
                        >
                            <Ionicons name="close-circle" size={18} color={adminColors.textPlaceholder} />
                        </TouchableOpacity>
                    )}
                </View>

                <ChipRow
                    options={STATUS_FILTERS}
                    selected={statusFilter}
                    onSelect={setStatusFilter}
                    labelPrefix="Filter by"
                />

                <View style={styles.sortRow}>
                    <Text style={styles.sortLabel}>Sort</Text>
                    <ChipRow
                        options={SORTS.map((value) => ({ value, label: BUS_SCORE_SORT_LABELS[value] }))}
                        selected={sort}
                        onSelect={setSort}
                        labelPrefix="Sort by"
                        compact
                    />
                </View>

                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
// Pieces
// ------------------------------------------------------------------

function ChipRow<T extends string>({
    options,
    selected,
    onSelect,
    labelPrefix,
    compact,
}: {
    options: { value: T; label: string }[];
    selected: T;
    onSelect: (value: T) => void;
    labelPrefix: string;
    compact?: boolean;
}) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.filterRow, compact && styles.filterRowCompact]}
        >
            {options.map((option) => {
                const isSelected = selected === option.value;

                return (
                    <TouchableOpacity
                        key={option.value}
                        style={[styles.filterChip, isSelected && styles.filterChipSelected]}
                        onPress={() => onSelect(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={`${labelPrefix} ${option.label}`}
                    >
                        <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                            {option.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    );
}

function BusScoreCard({ row, onPress }: { row: BusScoreRow; onPress: () => void }) {
    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={row.accessibilityLabel}
            accessibilityHint="Opens the accessibility details for this bus"
        >
            <View style={styles.cardTop}>
                <View style={styles.busIconCircle}>
                    <Ionicons name="bus" size={22} color={adminColors.primary} />
                </View>

                <View style={styles.cardHeadings}>
                    <Text style={styles.plateText} numberOfLines={1}>
                        {row.numberPlate}
                    </Text>
                    <Text style={styles.modelText} numberOfLines={1}>
                        {row.description ?? row.busId}
                    </Text>
                </View>

                {!!row.status && <StatusBadge status={row.status} size="small" />}
            </View>

            <View style={styles.scoreBlock}>
                <View style={styles.scoreHeader}>
                    <Text style={styles.scoreCaption}>Accessibility Score</Text>
                    <View style={[styles.bandBadge, { backgroundColor: `${row.color}1A` }]}>
                        <Text style={[styles.bandBadgeText, { color: row.color }]}>{row.bandLabel}</Text>
                    </View>
                </View>

                <View style={styles.scoreValueRow}>
                    <Text style={[styles.scoreValue, { color: row.color }]}>{row.score}</Text>
                    <Text style={styles.scoreOutOf}>/ 100</Text>
                </View>

                <ScoreBar progress={row.progress} color={row.color} />
            </View>

            <View style={styles.cardFooter}>
                <View style={styles.footerText}>
                    <Text style={styles.metaText} numberOfLines={1}>
                        {row.facilitiesLabel}
                    </Text>
                    <Text style={styles.metaText} numberOfLines={2}>
                        {row.evidenceLabel}
                    </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    searchWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.border,
        paddingHorizontal: 14,
        minHeight: 50,
        marginBottom: 12,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 15,
        color: adminColors.textPrimary,
        paddingVertical: 10,
    },
    clearSearchButton: { padding: 6 },

    filterRow: { gap: 8, paddingBottom: 12 },
    filterRowCompact: { paddingBottom: 0 },
    filterChip: {
        minHeight: 38,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surface,
    },
    filterChipSelected: {
        backgroundColor: adminColors.primary,
        borderColor: adminColors.primary,
    },
    filterChipText: { fontSize: 13, fontWeight: '600', color: adminColors.textSecondary },
    filterChipTextSelected: { color: '#FFFFFF' },

    sortRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    sortLabel: { fontSize: 13, fontWeight: '700', color: adminColors.textMuted },

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
    busIconCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardHeadings: { flex: 1, minWidth: 0, marginLeft: 14, marginRight: 8 },
    plateText: {
        fontSize: 17,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: 0.3,
    },
    modelText: { fontSize: 13, color: adminColors.textSecondary, marginTop: 2 },

    scoreBlock: {
        marginTop: 14,
        padding: 12,
        borderRadius: 10,
        backgroundColor: adminColors.surfaceMuted,
    },
    scoreHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    scoreCaption: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    bandBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    bandBadgeText: { fontSize: 12, fontWeight: '700' },
    scoreValueRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4, marginBottom: 8 },
    scoreValue: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
    scoreOutOf: {
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textPlaceholder,
        marginLeft: 4,
        marginBottom: 5,
    },

    cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    footerText: { flex: 1, minWidth: 0, gap: 2 },
    metaText: { fontSize: 12, color: adminColors.textMuted, fontWeight: '600' },
});
