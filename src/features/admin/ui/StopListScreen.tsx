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
import { Stop } from '../../../entities/stop/model/types';
import { getStops } from '../api/stopAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

/** Formats a coordinate for display without implying more precision than stored. */
export function formatCoordinate(value: number): string {
    return Number.isFinite(value) ? String(value) : '—';
}

export const StopListScreen = () => {
    const [stops, setStops] = useState<Stop[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') setIsRefreshing(true);
        else setIsLoading(true);
        setError('');

        try {
            setStops(await getStops());
        } catch (err: any) {
            setError(err?.message || 'Something went wrong while retrieving stop information.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    // Reload on focus so a newly added, edited or deleted stop shows immediately.
    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const filteredStops = useMemo(() => {
        const term = search.trim().toLowerCase();

        const matching = term
            ? stops.filter((stop) => stop.name?.toLowerCase().includes(term))
            : stops;

        return [...matching].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }, [stops, search]);

    const goToAddStop = () => router.push('/(admin)/stops/add');

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={4} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load bus stops"
                    message={`${error} Please check your connection and try again.`}
                    onRetry={() => load()}
                />
            );
        }

        if (stops.length === 0) {
            return (
                <AdminEmptyState
                    icon="location-outline"
                    title="No bus stops yet"
                    description="Add your first bus stop to start building the transport network."
                    actionLabel="Add Stop"
                    onAction={goToAddStop}
                />
            );
        }

        if (filteredStops.length === 0) {
            return (
                <AdminEmptyState
                    icon="search-outline"
                    title="No stops found"
                    description="Try searching with a different stop name."
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {filteredStops.length} of {stops.length} stop{stops.length === 1 ? '' : 's'}
                </Text>

                {filteredStops.map((stop) => (
                    <View key={stop.stopId} style={styles.card}>
                        <TouchableOpacity
                            style={styles.cardTop}
                            onPress={() =>
                                router.push({
                                    pathname: '/(admin)/stops/[stopId]',
                                    params: { stopId: stop.stopId },
                                })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`View details for ${stop.name}`}
                            accessibilityHint="Opens the stop details screen"
                        >
                            <View style={styles.pinCircle}>
                                <Ionicons name="location" size={22} color={adminColors.primary} />
                            </View>

                            <View style={styles.cardHeadings}>
                                <Text style={styles.stopName} numberOfLines={1}>
                                    {stop.name}
                                </Text>
                                <Text style={styles.coordinateSummary} numberOfLines={1}>
                                    {formatCoordinate(stop.latitude)}, {formatCoordinate(stop.longitude)}
                                </Text>
                            </View>

                            <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                        </TouchableOpacity>

                        <View style={styles.coordinateRow}>
                            <View style={styles.coordinateBlock}>
                                <Text style={styles.coordinateLabel}>Latitude</Text>
                                <Text style={styles.coordinateValue}>
                                    {formatCoordinate(stop.latitude)}
                                </Text>
                            </View>

                            <View style={styles.coordinateDivider} />

                            <View style={styles.coordinateBlock}>
                                <Text style={styles.coordinateLabel}>Longitude</Text>
                                <Text style={styles.coordinateValue}>
                                    {formatCoordinate(stop.longitude)}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.cardActions}>
                            <TouchableOpacity
                                style={styles.secondaryAction}
                                onPress={() =>
                                    router.push({
                                        pathname: '/(admin)/stops/[stopId]',
                                        params: { stopId: stop.stopId },
                                    })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`View details for ${stop.name}`}
                            >
                                <Text style={styles.secondaryActionText}>View Details</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.primaryAction}
                                onPress={() =>
                                    router.push({
                                        pathname: '/(admin)/stops/edit/[stopId]',
                                        params: { stopId: stop.stopId },
                                    })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`Edit ${stop.name}`}
                            >
                                <Ionicons name="create-outline" size={16} color="#FFFFFF" />
                                <Text style={styles.primaryActionText}>Edit</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Bus Stops"
                subtitle="Manage registered bus stops and location information"
                action={
                    <TouchableOpacity
                        style={styles.headerAddButton}
                        onPress={goToAddStop}
                        accessibilityRole="button"
                        accessibilityLabel="Add Stop"
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
                        placeholder="Search stops..."
                        placeholderTextColor={adminColors.textPlaceholder}
                        value={search}
                        onChangeText={setSearch}
                        accessibilityLabel="Search stops by name"
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
        marginBottom: 16,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 15,
        color: adminColors.textPrimary,
        paddingVertical: 10,
    },
    clearSearchButton: { padding: 6 },

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
    cardTop: { flexDirection: 'row', alignItems: 'center', minHeight: 46 },
    pinCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardHeadings: { flex: 1, marginHorizontal: 14 },
    stopName: {
        fontSize: 17,
        fontWeight: '800',
        color: adminColors.textPrimary,
    },
    coordinateSummary: {
        fontSize: 12,
        color: adminColors.textSecondary,
        marginTop: 3,
    },

    coordinateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginTop: 14,
    },
    coordinateBlock: { flex: 1 },
    coordinateDivider: {
        width: 1,
        height: 30,
        backgroundColor: adminColors.border,
        marginHorizontal: 12,
    },
    coordinateLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    coordinateValue: {
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginTop: 3,
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