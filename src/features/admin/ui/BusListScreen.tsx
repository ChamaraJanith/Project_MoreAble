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
import { Bus, BusStatus } from '../../../entities/bus/model/types';
import { getBuses } from '../api/busAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

type StatusFilter = 'ALL' | BusStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'MAINTENANCE', label: 'Maintenance' },
];

/** Short labels for the always-on facilities, shown as chips on the card. */
function primaryFacilities(bus: Bus): string[] {
    const facilities = bus.accessibilityFacilities;
    if (!facilities) return [];

    const labels: string[] = [];
    if (facilities.wheelchairRamp) labels.push('Wheelchair Ramp');
    if (facilities.audioAnnouncement) labels.push('Audio Announcement');
    if (facilities.lowFloorVehicle) labels.push('Low Floor');
    if (facilities.walkingAssistance) labels.push('Walking Assistance');
    return labels;
}

export const BusListScreen = () => {
    const [buses, setBuses] = useState<Bus[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

    const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') setIsRefreshing(true);
        else setIsLoading(true);
        setError('');

        try {
            setBuses(await getBuses());
        } catch (err: any) {
            setError(err?.message || 'Unable to load buses.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    // Reload on focus so returning from Add/Edit always shows fresh data.
    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const filteredBuses = useMemo(() => {
        const term = search.trim().toLowerCase();

        return buses.filter((bus) => {
            if (statusFilter !== 'ALL' && bus.status !== statusFilter) return false;
            if (!term) return true;

            return (
                bus.numberPlate?.toLowerCase().includes(term) ||
                bus.busModel?.toLowerCase().includes(term) ||
                bus.manufacturer?.toLowerCase().includes(term)
            );
        });
    }, [buses, search, statusFilter]);

    const goToAddBus = () => router.push('/(admin)/buses/add');

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={3} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load buses"
                    message={`${error} Please check your connection and try again.`}
                    onRetry={() => load()}
                />
            );
        }

        if (buses.length === 0) {
            return (
                <AdminEmptyState
                    icon="bus-outline"
                    title="No buses registered yet"
                    description="Add your first bus to start managing the fleet."
                    actionLabel="Add Bus"
                    onAction={goToAddBus}
                />
            );
        }

        if (filteredBuses.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No matching buses"
                    description="No buses match your search or filter. Try a different number plate, model or status."
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {filteredBuses.length} of {buses.length} bus{buses.length === 1 ? '' : 'es'}
                </Text>

                {filteredBuses.map((bus) => {
                    const facilities = primaryFacilities(bus);

                    return (
                        <View key={bus.numberPlate} style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={styles.busIconCircle}>
                                    <Ionicons name="bus" size={22} color={adminColors.primary} />
                                </View>

                                <View style={styles.cardHeadings}>
                                    <Text style={styles.plateText} numberOfLines={1}>
                                        {bus.numberPlate}
                                    </Text>
                                    <Text style={styles.modelText} numberOfLines={1}>
                                        {bus.busModel}
                                        {bus.manufacturer ? ` · ${bus.manufacturer}` : ''}
                                    </Text>
                                </View>

                                <StatusBadge status={bus.status} size="small" />
                            </View>

                            <View style={styles.metaRow}>
                                <Ionicons name="people-outline" size={15} color={adminColors.textMuted} />
                                <Text style={styles.metaText}>{bus.seatCapacity} seats</Text>
                                {!!bus.manufactureYear && (
                                    <>
                                        <View style={styles.metaDot} />
                                        <Text style={styles.metaText}>{bus.manufactureYear}</Text>
                                    </>
                                )}
                            </View>

                            {facilities.length > 0 && (
                                <View style={styles.chipWrap}>
                                    {facilities.map((label) => (
                                        <View key={label} style={styles.facilityChip}>
                                            <Ionicons name="accessibility" size={11} color={adminColors.primary} />
                                            <Text style={styles.facilityChipText}>{label}</Text>
                                        </View>
                                    ))}
                                </View>
                            )}

                            <View style={styles.cardActions}>
                                <TouchableOpacity
                                    style={styles.secondaryAction}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/(admin)/buses/[numberPlate]',
                                            params: { numberPlate: bus.numberPlate },
                                        })
                                    }
                                    accessibilityRole="button"
                                    accessibilityLabel={`View details for bus ${bus.numberPlate}`}
                                >
                                    <Text style={styles.secondaryActionText}>View Details</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.primaryAction}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/(admin)/buses/edit/[numberPlate]',
                                            params: { numberPlate: bus.numberPlate },
                                        })
                                    }
                                    accessibilityRole="button"
                                    accessibilityLabel={`Edit bus ${bus.numberPlate}`}
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
                title="Buses"
                subtitle="Manage registered buses and accessibility facilities"
                action={
                    <TouchableOpacity
                        style={styles.headerAddButton}
                        onPress={goToAddBus}
                        accessibilityRole="button"
                        accessibilityLabel="Add Bus"
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
                {/* Search */}
                <View style={styles.searchWrapper}>
                    <Ionicons name="search" size={18} color={adminColors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search plate, model or manufacturer"
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

                {/* Status filter */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {STATUS_FILTERS.map((filter) => {
                        const isSelected = statusFilter === filter.value;

                        return (
                            <TouchableOpacity
                                key={filter.value}
                                style={[styles.filterChip, isSelected && styles.filterChipSelected]}
                                onPress={() => setStatusFilter(filter.value)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isSelected }}
                                accessibilityLabel={`Filter by ${filter.label}`}
                            >
                                <Text
                                    style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}
                                >
                                    {filter.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {renderBody()}
            </ScrollView>
        </View>
    );
};

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
    clearSearchButton: {
        padding: 6,
    },

    filterRow: {
        gap: 8,
        paddingBottom: 16,
    },
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
    filterChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textSecondary,
    },
    filterChipTextSelected: { color: '#FFFFFF' },

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
    cardHeadings: { flex: 1, marginLeft: 14, marginRight: 8 },
    plateText: {
        fontSize: 17,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: 0.3,
    },
    modelText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        marginTop: 2,
    },

    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    metaText: {
        fontSize: 13,
        color: adminColors.textMuted,
        fontWeight: '600',
        marginLeft: 6,
    },
    metaDot: {
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: adminColors.textPlaceholder,
        marginHorizontal: 10,
    },

    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    facilityChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.primarySoft,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    facilityChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.primary,
        marginLeft: 4,
    },

    cardActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        gap: 10,
    },
    secondaryAction: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    secondaryActionText: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
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