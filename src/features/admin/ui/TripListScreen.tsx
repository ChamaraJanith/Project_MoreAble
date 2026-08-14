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
import { Bus } from '../../../entities/bus/model/types';
import { Route, RouteDirection } from '../../../entities/route/model/types';
import { Trip, TripStatus } from '../../../entities/trip/model/types';
import { formatFriendlyTime, parseApiTimeString } from '../../journey/utils/dateTime';
import { getBuses } from '../api/busAdminApi';
import { getRoutes } from '../api/routeAdminApi';
import { getTrips } from '../api/tripAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

type StatusFilter = 'ALL' | TripStatus;
type DirectionFilter = 'ALL' | RouteDirection;
type SortMode = 'DEPARTURE' | 'ROUTE' | 'BUS';

/** A trip joined with the route and bus it references. */
export interface ResolvedTrip {
    trip: Trip;
    route: Route | null;
    bus: Bus | null;
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
];

const DIRECTION_FILTERS: { value: DirectionFilter; label: string }[] = [
    { value: 'ALL', label: 'All directions' },
    { value: 'OUTBOUND', label: 'Outbound' },
    { value: 'RETURN', label: 'Return' },
];

const SORT_MODES: { value: SortMode; label: string }[] = [
    { value: 'DEPARTURE', label: 'Earliest departure' },
    { value: 'ROUTE', label: 'By route' },
    { value: 'BUS', label: 'By bus' },
];

export const TripListScreen = () => {
    const [trips, setTrips] = useState<Trip[]>([]);
    const [busMap, setBusMap] = useState<Map<string, Bus>>(new Map());
    const [routeMap, setRouteMap] = useState<Map<string, Route>>(new Map());

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
    const [sortMode, setSortMode] = useState<SortMode>('DEPARTURE');

    /**
     * Trips reference routes and buses by id only, so all three collections are
     * fetched once and turned into lookup maps — never one request per card.
     */
    const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') setIsRefreshing(true);
        else setIsLoading(true);
        setError('');

        try {
            const [tripList, busList, routeList] = await Promise.all([
                getTrips(),
                getBuses(),
                getRoutes(),
            ]);

            setTrips(tripList);
            setBusMap(new Map(busList.map((bus) => [bus.busId, bus])));
            setRouteMap(new Map(routeList.map((route) => [route.routeId, route])));
        } catch (err: any) {
            setError(err?.message || 'Unable to load trips.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    // Reload on focus so a newly created or edited trip appears immediately.
    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const resolvedTrips = useMemo<ResolvedTrip[]>(
        () =>
            trips.map((trip) => ({
                trip,
                route: routeMap.get(trip.routeId) ?? null,
                bus: busMap.get(trip.busId) ?? null,
            })),
        [trips, routeMap, busMap]
    );

    const visibleTrips = useMemo(() => {
        const term = search.trim().toLowerCase();

        const filtered = resolvedTrips.filter(({ trip, route, bus }) => {
            if (statusFilter !== 'ALL' && trip.status !== statusFilter) return false;
            if (directionFilter !== 'ALL' && route?.direction !== directionFilter) return false;
            if (!term) return true;

            return (
                trip.tripId?.toLowerCase().includes(term) ||
                route?.routeNumber?.toLowerCase().includes(term) ||
                route?.routeName?.toLowerCase().includes(term) ||
                route?.startLocation?.toLowerCase().includes(term) ||
                route?.endLocation?.toLowerCase().includes(term) ||
                bus?.numberPlate?.toLowerCase().includes(term) ||
                bus?.busModel?.toLowerCase().includes(term)
            );
        });

        return [...filtered].sort((a, b) => {
            if (sortMode === 'ROUTE') {
                const routeCompare = (a.route?.routeNumber ?? '').localeCompare(
                    b.route?.routeNumber ?? ''
                );
                if (routeCompare !== 0) return routeCompare;
            }

            if (sortMode === 'BUS') {
                const busCompare = (a.bus?.numberPlate ?? '').localeCompare(b.bus?.numberPlate ?? '');
                if (busCompare !== 0) return busCompare;
            }

            // Chronological within any grouping — the useful operational view.
            const timeCompare = (a.trip.departureTime ?? '').localeCompare(b.trip.departureTime ?? '');
            if (timeCompare !== 0) return timeCompare;

            return (a.trip.turnNumber ?? 0) - (b.trip.turnNumber ?? 0);
        });
    }, [resolvedTrips, search, statusFilter, directionFilter, sortMode]);

    const goToAddTrip = () => router.push('/(admin)/trips/add');

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={3} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load trips"
                    message={`${error} Please check your connection and try again.`}
                    onRetry={() => load()}
                />
            );
        }

        if (trips.length === 0) {
            return (
                <AdminEmptyState
                    icon="time-outline"
                    title="No trips scheduled yet"
                    description="Create a trip to start scheduling buses on routes."
                    actionLabel="Add Trip"
                    onAction={goToAddTrip}
                />
            );
        }

        if (visibleTrips.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching trips"
                    description="No trips match your search or filters. Try a route number, number plate or location."
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {visibleTrips.length} of {trips.length} trip{trips.length === 1 ? '' : 's'}
                </Text>

                {visibleTrips.map((resolved) => (
                    <TripCard key={resolved.trip.tripId} resolved={resolved} />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Trips"
                subtitle="Schedule and manage bus trips"
                action={
                    <TouchableOpacity
                        style={styles.headerAddButton}
                        onPress={goToAddTrip}
                        accessibilityRole="button"
                        accessibilityLabel="Add Trip"
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
                        placeholder="Search route, plate or location"
                        placeholderTextColor={adminColors.textPlaceholder}
                        value={search}
                        onChangeText={setSearch}
                        accessibilityLabel="Search trips"
                    />
                    {!!search && (
                        <TouchableOpacity
                            onPress={() => setSearch('')}
                            style={styles.clearSearchButton}
                            accessibilityRole="button"
                            accessibilityLabel="Clear search"
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

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {SORT_MODES.map((mode) => (
                        <FilterChip
                            key={mode.value}
                            label={mode.label}
                            icon="swap-vertical"
                            isSelected={sortMode === mode.value}
                            onPress={() => setSortMode(mode.value)}
                        />
                    ))}
                </ScrollView>

                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
function TripCard({ resolved }: { resolved: ResolvedTrip }) {
    const { trip, route, bus } = resolved;

    const departureLabel = formatFriendlyTime(parseApiTimeString(trip.departureTime));
    const arrivalLabel = formatFriendlyTime(parseApiTimeString(trip.estimatedArrivalTime));

    const accessibilityLabel =
        `Trip ${route ? `on route ${route.routeNumber}` : ''}` +
        `${route ? ` from ${route.startLocation} to ${route.endLocation}` : ''}. ` +
        `Departs ${departureLabel}, arrives ${arrivalLabel}. ` +
        `${bus ? `Bus ${bus.numberPlate}.` : 'Bus unavailable.'} Status ${trip.status}.`;

    return (
        <View style={styles.card}>
            {/* Route identity */}
            <View style={styles.cardTop} accessible accessibilityLabel={accessibilityLabel}>
                <View style={styles.routeNumberBadge}>
                    <Text style={styles.routeNumberText} numberOfLines={1}>
                        {route?.routeNumber ?? '—'}
                    </Text>
                </View>

                <View style={styles.cardHeadings}>
                    {route ? (
                        <>
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
                        </>
                    ) : (
                        <Text style={styles.missingText}>Route information unavailable</Text>
                    )}
                </View>

                <View style={styles.turnBadge}>
                    <Text style={styles.turnBadgeText}>Turn {trip.turnNumber}</Text>
                </View>
            </View>

            {/* Schedule — the operationally most important line */}
            <View style={styles.scheduleRow}>
                <View style={styles.timeBlock}>
                    <Text style={styles.timeValue}>{departureLabel}</Text>
                    <Text style={styles.timeCaption}>Departs</Text>
                </View>

                <View style={styles.scheduleConnector}>
                    <View style={styles.connectorLine} />
                    <Ionicons name="bus" size={15} color={adminColors.primary} />
                    <View style={styles.connectorLine} />
                </View>

                <View style={[styles.timeBlock, styles.timeBlockEnd]}>
                    <Text style={styles.timeValue}>{arrivalLabel}</Text>
                    <Text style={styles.timeCaption}>Est. arrival</Text>
                </View>
            </View>

            {/* Bus */}
            <View style={styles.busRow}>
                <View style={styles.busIconBadge}>
                    <Ionicons
                        name={bus ? 'bus' : 'bus-outline'}
                        size={16}
                        color={bus ? adminColors.primary : adminColors.textPlaceholder}
                    />
                </View>

                {bus ? (
                    <View style={styles.busTextGroup}>
                        <Text style={styles.busPlateText} numberOfLines={1}>
                            {bus.numberPlate}
                        </Text>
                        <Text style={styles.busModelText} numberOfLines={1}>
                            {bus.busModel}
                        </Text>
                    </View>
                ) : (
                    <Text style={styles.missingText}>Bus information unavailable</Text>
                )}
            </View>

            {/* Badges */}
            <View style={styles.badgeRow}>
                <StatusBadge status={trip.status} size="small" />
                {!!route?.direction && <StatusBadge status={route.direction} size="small" />}
            </View>

            {/* Actions */}
            <View style={styles.cardActions}>
                <TouchableOpacity
                    style={styles.secondaryAction}
                    onPress={() =>
                        router.push({
                            pathname: '/(admin)/trips/[tripId]',
                            params: { tripId: trip.tripId },
                        })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`View details for the ${departureLabel} trip`}
                >
                    <Text style={styles.secondaryActionText}>View Details</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.primaryAction}
                    onPress={() =>
                        router.push({
                            pathname: '/(admin)/trips/edit/[tripId]',
                            params: { tripId: trip.tripId },
                        })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Edit the ${departureLabel} trip`}
                >
                    <Ionicons name="create-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.primaryActionText}>Edit</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

function FilterChip({
    label,
    isSelected,
    onPress,
    icon,
}: {
    label: string;
    isSelected: boolean;
    onPress: () => void;
    icon?: keyof typeof Ionicons.glyphMap;
}) {
    return (
        <TouchableOpacity
            style={[styles.filterChip, isSelected && styles.filterChipSelected]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
        >
            {!!icon && (
                <Ionicons
                    name={icon}
                    size={13}
                    color={isSelected ? '#FFFFFF' : adminColors.textSecondary}
                    style={styles.filterChipIcon}
                />
            )}
            <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                {label}
            </Text>
        </TouchableOpacity>
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
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 38,
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
    filterChipIcon: { marginRight: 5 },
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
        minWidth: 48,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
        backgroundColor: adminColors.primarySoft,
        alignItems: 'center',
    },
    routeNumberText: { fontSize: 16, fontWeight: '800', color: adminColors.primary },
    cardHeadings: { flex: 1, marginHorizontal: 12 },
    endpointRow: { flexDirection: 'row', alignItems: 'center' },
    endpointText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    endpointArrow: { marginHorizontal: 6 },
    routeNameText: { fontSize: 12, color: adminColors.textSecondary, marginTop: 3 },
    turnBadge: {
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    turnBadgeText: { fontSize: 11, fontWeight: '700', color: adminColors.textSecondary },

    scheduleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    timeBlock: { alignItems: 'flex-start' },
    timeBlockEnd: { alignItems: 'flex-end' },
    timeValue: {
        fontSize: 20,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: -0.3,
    },
    timeCaption: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 2,
    },
    scheduleConnector: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        marginBottom: 13,
    },
    connectorLine: {
        flex: 1,
        height: 2,
        backgroundColor: adminColors.border,
        borderRadius: 1,
        marginHorizontal: 5,
    },

    busRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
    busIconBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    busTextGroup: { flex: 1 },
    busPlateText: {
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: 0.3,
    },
    busModelText: { fontSize: 12, color: adminColors.textSecondary, marginTop: 1 },
    missingText: { flex: 1, fontSize: 13, color: adminColors.textMuted, fontStyle: 'italic' },

    badgeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },

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
