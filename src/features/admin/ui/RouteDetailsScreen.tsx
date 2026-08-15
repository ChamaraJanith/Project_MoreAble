import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Route } from '../../../entities/route/model/types';
import { deleteRoute, getRoute, setRouteStatus } from '../api/routeAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState, ConfirmDialog } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

interface RouteDetailsScreenProps {
    routeId: string;
}

export const RouteDetailsScreen = ({ routeId }: RouteDetailsScreenProps) => {
    const [route, setRoute] = useState<Route | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [confirmStatus, setConfirmStatus] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            setRoute(await getRoute(routeId));
        } catch (err: any) {
            setError(err?.message || 'Unable to load this route.');
        } finally {
            setIsLoading(false);
        }
    }, [routeId]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const handleToggleStatus = async () => {
        if (!route) return;

        setIsBusy(true);
        setActionError('');

        try {
            const nextStatus = route.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
            setRoute(await setRouteStatus(route, nextStatus));
            setConfirmStatus(false);
        } catch (err: any) {
            setActionError(err?.message || 'Unable to update the route status.');
            setConfirmStatus(false);
        } finally {
            setIsBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!route) return;

        setIsBusy(true);
        setActionError('');

        try {
            await deleteRoute(route.routeId);
            setConfirmDelete(false);
            router.back();
        } catch (err: any) {
            setActionError(err?.message || 'Unable to delete this route.');
            setConfirmDelete(false);
        } finally {
            setIsBusy(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Route Details" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading route details…</Text>
                </View>
            </View>
        );
    }

    if (error || !route) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Route Details" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this route"
                        message={error || 'The route could not be found.'}
                        onRetry={load}
                    />
                </View>
            </View>
        );
    }

    const stops = Array.isArray(route.stops) ? route.stops : [];

    return (
        <View style={styles.container}>
            <AdminScreenHeader title={`Route ${route.routeNumber}`} subtitle={route.routeName} />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Hero */}
                <View style={styles.heroCard}>
                    <View style={styles.heroNumberBadge}>
                        <Text style={styles.heroNumberText}>{route.routeNumber}</Text>
                    </View>

                    <View style={styles.heroEndpointRow}>
                        <Text style={styles.heroEndpointText} numberOfLines={1}>
                            {route.startLocation}
                        </Text>
                        <Ionicons
                            name="arrow-forward"
                            size={16}
                            color={adminColors.textMuted}
                            style={styles.heroArrow}
                        />
                        <Text style={styles.heroEndpointText} numberOfLines={1}>
                            {route.endLocation}
                        </Text>
                    </View>

                    <View style={styles.heroBadges}>
                        <StatusBadge status={route.status} />
                        {!!route.direction && <StatusBadge status={route.direction} />}
                    </View>
                </View>

                {!!actionError && (
                    <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color={adminColors.danger} />
                        <Text style={styles.errorBannerText}>{actionError}</Text>
                    </View>
                )}

                {/* Route Information */}
                <Text style={styles.sectionTitle}>Route Information</Text>
                <View style={styles.card}>
                    <DetailRow label="Route Number" value={route.routeNumber} />
                    <DetailRow label="Route Name" value={route.routeName} />
                    <DetailRow
                        label="Direction"
                        value={route.direction === 'RETURN' ? 'Return' : route.direction ? 'Outbound' : '—'}
                    />
                    <DetailRow
                        label="Distance"
                        value={route.distanceKm != null ? `${route.distanceKm} km` : 'Not recorded'}
                    />
                    <DetailRow
                        label="Estimated Duration"
                        value={route.estimatedDuration || 'Not recorded'}
                    />
                    <DetailRow label="Total Stops" value={`${stops.length}`} />
                    <DetailRow label="Status" value={route.status} isLast />
                </View>

                {/* Stops timeline */}
                <Text style={styles.sectionTitle}>Stops</Text>
                <View style={styles.card}>
                    {stops.length === 0 ? (
                        <Text style={styles.noStopsText}>No stops recorded for this route.</Text>
                    ) : (
                        stops.map((stop, index) => {
                            const isFirst = index === 0;
                            const isLast = index === stops.length - 1;

                            return (
                                <View key={`${stop}-${index}`} style={styles.stopItem}>
                                    <View style={styles.stopMarkerColumn}>
                                        {!isFirst && <View style={styles.stopLineTop} />}
                                        <View
                                            style={[
                                                styles.stopDot,
                                                (isFirst || isLast) && styles.stopDotEndpoint,
                                            ]}
                                        />
                                        {!isLast && <View style={styles.stopLineBottom} />}
                                    </View>

                                    <View style={styles.stopTextGroup}>
                                        <Text
                                            style={[
                                                styles.stopName,
                                                (isFirst || isLast) && styles.stopNameEndpoint,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {stop}
                                        </Text>
                                        {(isFirst || isLast) && (
                                            <View
                                                style={[
                                                    styles.endpointTag,
                                                    isLast && styles.endpointTagEnd,
                                                ]}
                                            >
                                                <Text
                                                    style={[
                                                        styles.endpointTagText,
                                                        isLast && styles.endpointTagTextEnd,
                                                    ]}
                                                >
                                                    {isFirst ? 'START' : 'END'}
                                                </Text>
                                            </View>
                                        )}
                                    </View>

                                    <Text style={styles.stopIndex}>{index + 1}</Text>
                                </View>
                            );
                        })
                    )}
                </View>

                {/* Manage */}
                <Text style={styles.sectionTitle}>Manage</Text>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() =>
                            router.push({
                                pathname: '/(admin)/routes/edit/[routeId]',
                                params: { routeId: route.routeId },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Edit route"
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.primarySoft }]}>
                            <Ionicons name="create-outline" size={20} color={adminColors.primary} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>Edit Route</Text>
                            <Text style={styles.actionHint}>Update details and stops</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, styles.actionRowBordered]}
                        onPress={() => setConfirmStatus(true)}
                        accessibilityRole="button"
                        accessibilityLabel={
                            route.status === 'ACTIVE' ? 'Deactivate this route' : 'Reactivate this route'
                        }
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.warningSoft }]}>
                            <Ionicons
                                name={route.status === 'ACTIVE' ? 'pause-circle-outline' : 'play-circle-outline'}
                                size={20}
                                color={adminColors.warning}
                            />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>
                                {route.status === 'ACTIVE' ? 'Deactivate Route' : 'Reactivate Route'}
                            </Text>
                            <Text style={styles.actionHint}>
                                {route.status === 'ACTIVE'
                                    ? 'Hide it from journey searches without deleting'
                                    : 'Make this route available again'}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, styles.actionRowBordered]}
                        onPress={() => setConfirmDelete(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Delete this route permanently"
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.dangerSoft }]}>
                            <Ionicons name="trash-outline" size={20} color={adminColors.danger} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={[styles.actionLabel, { color: adminColors.danger }]}>
                                Delete Route
                            </Text>
                            <Text style={styles.actionHint}>Permanently remove this route</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <ConfirmDialog
                visible={confirmStatus}
                title={route.status === 'ACTIVE' ? 'Deactivate Route?' : 'Reactivate Route?'}
                message={
                    route.status === 'ACTIVE'
                        ? `Route ${route.routeNumber} will stop appearing in passenger journey searches. You can reactivate it later.`
                        : `Route ${route.routeNumber} will appear in passenger journey searches again.`
                }
                confirmLabel={route.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                isBusy={isBusy}
                onCancel={() => setConfirmStatus(false)}
                onConfirm={handleToggleStatus}
            />

            <ConfirmDialog
                visible={confirmDelete}
                title={`Delete Route ${route.routeNumber}?`}
                message="This will remove the route from the admin system and cannot be undone. Consider deactivating it instead."
                confirmLabel="Delete Permanently"
                destructive
                isBusy={isBusy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={handleDelete}
            />
        </View>
    );
};

function DetailRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
    return (
        <View style={[styles.detailRow, isLast && styles.detailRowLast]}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue} numberOfLines={2}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    heroCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 22,
        alignItems: 'center',
        ...adminShadow.card,
    },
    heroNumberBadge: {
        minWidth: 64,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: adminColors.primarySoft,
        alignItems: 'center',
        marginBottom: 14,
    },
    heroNumberText: {
        fontSize: 24,
        fontWeight: '800',
        color: adminColors.primary,
    },
    heroEndpointRow: { flexDirection: 'row', alignItems: 'center' },
    heroEndpointText: {
        flexShrink: 1,
        fontSize: 16,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    heroArrow: { marginHorizontal: 8 },
    heroBadges: { flexDirection: 'row', gap: 8, marginTop: 14 },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 20,
    },
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        ...adminShadow.card,
    },

    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: adminColors.borderSubtle,
    },
    detailRowLast: { borderBottomWidth: 0 },
    detailLabel: { fontSize: 13, color: adminColors.textSecondary, marginRight: 12 },
    detailValue: {
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
        textAlign: 'right',
    },

    noStopsText: {
        fontSize: 14,
        color: adminColors.textSecondary,
        textAlign: 'center',
        paddingVertical: 12,
    },
    stopItem: { flexDirection: 'row', alignItems: 'center', minHeight: 46 },
    stopMarkerColumn: {
        width: 22,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stopLineTop: {
        position: 'absolute',
        top: 0,
        height: '50%',
        width: 2,
        backgroundColor: adminColors.border,
    },
    stopLineBottom: {
        position: 'absolute',
        bottom: 0,
        height: '50%',
        width: 2,
        backgroundColor: adminColors.border,
    },
    stopDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: adminColors.border,
        borderWidth: 2,
        borderColor: adminColors.surface,
        zIndex: 1,
    },
    stopDotEndpoint: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: adminColors.primary,
    },
    stopTextGroup: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 12,
    },
    stopName: {
        flexShrink: 1,
        fontSize: 14,
        color: adminColors.textSecondary,
    },
    stopNameEndpoint: {
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    endpointTag: {
        marginLeft: 8,
        backgroundColor: adminColors.primarySoft,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    endpointTagEnd: { backgroundColor: adminColors.successSoft },
    endpointTagText: {
        fontSize: 10,
        fontWeight: '800',
        color: adminColors.primary,
        letterSpacing: 0.5,
    },
    endpointTagTextEnd: { color: adminColors.success },
    stopIndex: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textPlaceholder,
        marginLeft: 8,
    },

    actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, minHeight: 60 },
    actionRowBordered: { borderTopWidth: 1, borderTopColor: adminColors.borderSubtle },
    actionIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    actionTextGroup: { flex: 1 },
    actionLabel: { fontSize: 15, fontWeight: '700', color: adminColors.textPrimary },
    actionHint: { fontSize: 12, color: adminColors.textMuted, marginTop: 2 },

    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        padding: 12,
        marginTop: 12,
    },
    errorBannerText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 8,
        lineHeight: 18,
    },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    centeredText: { marginTop: 12, fontSize: 14, color: adminColors.textSecondary },
});