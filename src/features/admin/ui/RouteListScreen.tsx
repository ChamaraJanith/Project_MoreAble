import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Route, RouteDirection, RouteStatus } from '../../../entities/route/model/types';
import { getRoutes } from '../api/routeAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

type StatusFilter = 'ALL' | RouteStatus;
type DirectionFilter = 'ALL' | RouteDirection;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
];

const DIRECTION_FILTERS: { value: DirectionFilter; label: string }[] = [
    { value: 'ALL', label: 'Both directions' },
    { value: 'OUTBOUND', label: 'Outbound' },
    { value: 'RETURN', label: 'Return' },
];

/** Intermediate stops only — the endpoints are already shown on the card. */
function viaSummary(stops: string[]): string {
    const middle = Array.isArray(stops) ? stops.slice(1, -1) : [];
    if (middle.length === 0) return '';

    const shown = middle.slice(0, 4).join(' · ');
    const remaining = middle.length - 4;
    return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

export const RouteListScreen = () => {
    const [routes, setRoutes] = useState<Route[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');

    const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') setIsRefreshing(true);
        else setIsLoading(true);
        setError('');

        try {
            setRoutes(await getRoutes());
        } catch (err: any) {
            setError(err?.message || 'Unable to load routes.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const filteredRoutes = useMemo(() => {
        const term = search.trim().toLowerCase();

        return routes.filter((route) => {
            if (statusFilter !== 'ALL' && route.status !== statusFilter) return false;
            if (directionFilter !== 'ALL' && route.direction !== directionFilter) return false;
            if (!term) return true;

            return (
                route.routeNumber?.toLowerCase().includes(term) ||
                route.routeName?.toLowerCase().includes(term) ||
                route.startLocation?.toLowerCase().includes(term) ||
                route.endLocation?.toLowerCase().includes(term)
            );
        });
    }, [routes, search, statusFilter, directionFilter]);

    const goToAddRoute = () => router.push('/(admin)/routes/add');

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={3} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load routes"
                    message={`${error} Please check your connection and try again.`}
                    onRetry={() => load()}
                />
            );
        }

        if (routes.length === 0) {
            return (
                <AdminEmptyState
                    icon="git-branch-outline"
                    title="No routes created yet"
                    description="Create a route to start managing transport services."
                    actionLabel="Add Route"
                    onAction={goToAddRoute}
                />
            );
        }

        if (filteredRoutes.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching routes"
                    description="No routes match your search or filters. Try a different route number, name or location."
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {filteredRoutes.length} of {routes.length} route{routes.length === 1 ? '' : 's'}
                </Text>

                {filteredRoutes.map((route) => {
                    const via = viaSummary(route.stops ?? []);
                    const stopCount = route.stops?.length ?? 0;

                    return (
                        <View key={route.routeId} style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={styles.routeNumberBadge}>
                                    <Text style={styles.routeNumberText} numberOfLines={1}>
                                        {route.routeNumber}
                                    </Text>
                                </View>

                                <View style={styles.cardHeadings}>
                                    <View style={styles.endpointRow}>
                                        <Text style={styles.endpointText} numberOfLines={1}>
                                            {route.startLocation}
                                        </Text>
                                        <Ionicons
                                            name="arrow-forward"
                                            size={13}
                                            color={adminColors.textMuted}
                                            style={styles.endpointArrow}
                                        />
                                        <Text style={styles.endpointText} numberOfLines={1}>
                                            {route.endLocation}
                                        </Text>
                                    </View>
                                    <Text style={styles.routeNameText} numberOfLines={1}>
                                        {route.routeName}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.badgeRow}>
                                <StatusBadge status={route.status} size="small" />
                                {!!route.direction && <StatusBadge status={route.direction} size="small" />}
                            </View>

                            <View style={styles.metaRow}>
                                <MetaItem icon="git-commit-outline" text={`${stopCount} stops`} />
                                {route.distanceKm != null && (
                                    <MetaItem icon="navigate-outline" text={`${route.distanceKm} km`} />
                                )}
                                {!!route.estimatedDuration && (
                                    <MetaItem icon="time-outline" text={route.estimatedDuration} />
                                )}
                            </View>

                            {!!via && (
                                <View style={styles.viaRow}>
                                    <Ionicons
                                        name="ellipsis-horizontal-circle-outline"
                                        size={15}
                                        color={adminColors.textPlaceholder}
                                    />
                                    <Text style={styles.viaText} numberOfLines={2}>
                                        Via {via}
                                    </Text>
                                </View>
                            )}

                            <View style={styles.cardActions}>
                                <TouchableOpacity
                                    style={styles.secondaryAction}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/(admin)/routes/[routeId]',
                                            params: { routeId: route.routeId },
                                        })
                                    }
                                    accessibilityRole="button"
                                    accessibilityLabel={`View route ${route.routeNumber}`}
                                >
                                    <Text style={styles.secondaryActionText}>View Route</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.primaryAction}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/(admin)/routes/edit/[routeId]',
                                            params: { routeId: route.routeId },
                                        })
                                    }
                                    accessibilityRole="button"
                                    accessibilityLabel={`Edit route ${route.routeNumber}`}
                                >
                                    <Ionicons name="create-outline" size={16} color="#FFFFFF" />
                                    <Text style={styles.primaryActionText}>Edit</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    );
                })}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Bus Routes"
                subtitle="Manage transport routes and stops"
                action={
                    <TouchableOpacity
                        style={styles.headerAddButton}
                        onPress={goToAddRoute}
                        accessibilityRole="button"
                        accessibilityLabel="Add Route"
                    >
                        <Ionicons name="add" size={22} color="#FFFFFF" />
                    </TouchableOpacity>
                }
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
                        placeholder="Search number, name or location"
                        placeholderTextColor={adminColors.textPlaceholder}
                        value={search}
                        onChangeText={setSearch}
                        accessibilityLabel="Search routes"
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

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {STATUS_FILTERS.map((filter) => (
                        <FilterChip
                            key={filter.value}
                            label={filter.label}
                            isSelected={statusFilter === filter.value}
                            onPress={() => setStatusFilter(filter.value)}
                        />
                    ))}
                </ScrollView>

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {DIRECTION_FILTERS.map((filter) => (
                        <FilterChip
                            key={filter.value}
                            label={filter.label}
                            isSelected={directionFilter === filter.value}
                            onPress={() => setDirectionFilter(filter.value)}
                        />
                    ))}
                </ScrollView>

                {renderBody()}
            </ScrollView>
        </View>
    );
};

function FilterChip({
    label,
    isSelected,
    onPress,
}: {
    label: string;
    isSelected: boolean;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.filterChip, isSelected && styles.filterChipSelected]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`Filter by ${label}`}
        >
            <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

function MetaItem({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
    return (
        <View style={styles.metaItem}>
            <Ionicons name={icon} size={14} color={adminColors.textMuted} />
            <Text style={styles.metaText}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    headerAddButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: adminColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },

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

    filterRow: { gap: 8, paddingBottom: 10 },
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

    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        marginTop: 6,
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
    routeNumberBadge: {
        minWidth: 52,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: adminColors.primarySoft,
        alignItems: 'center',
    },
    routeNumberText: {
        fontSize: 17,
        fontWeight: '800',
        color: adminColors.primary,
    },
    cardHeadings: { flex: 1, marginLeft: 14 },
    endpointRow: { flexDirection: 'row', alignItems: 'center' },
    endpointText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    endpointArrow: { marginHorizontal: 6 },
    routeNameText: {
        fontSize: 12,
        color: adminColors.textSecondary,
        marginTop: 3,
    },

    badgeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },

    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 16,
        marginTop: 12,
    },
    metaItem: { flexDirection: 'row', alignItems: 'center' },
    metaText: {
        fontSize: 13,
        color: adminColors.textMuted,
        fontWeight: '600',
        marginLeft: 5,
    },

    viaRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 },
    viaText: {
        flex: 1,
        fontSize: 12,
        color: adminColors.textSecondary,
        marginLeft: 6,
        lineHeight: 17,
    },

    cardActions: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 10 },
    secondaryAction: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    secondaryActionText: { fontSize: 14, fontWeight: '700', color: adminColors.textPrimary },
    primaryAction: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 44,
        borderRadius: 10,
        backgroundColor: adminColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryActionText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
        marginLeft: 6,
    },
});