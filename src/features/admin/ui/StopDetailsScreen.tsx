import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stop } from '../../../entities/stop/model/types';
import { deleteStop, getStop } from '../api/stopAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState, ConfirmDialog } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

interface StopDetailsScreenProps {
    stopId: string;
}

export const StopDetailsScreen = ({ stopId }: StopDetailsScreenProps) => {
    const [stop, setStop] = useState<Stop | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            setStop(await getStop(stopId));
        } catch (err: any) {
            setError(err?.message || 'Unable to load this stop.');
        } finally {
            setIsLoading(false);
        }
    }, [stopId]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const handleDelete = async () => {
        if (!stop) return;

        setIsBusy(true);
        setActionError('');

        try {
            await deleteStop(stop.stopId);
            setConfirmDelete(false);
            router.back();
        } catch (err: any) {
            // Covers the backend's 409 when a route still references this stop.
            setActionError(err?.message || 'Unable to delete this stop.');
            setConfirmDelete(false);
        } finally {
            setIsBusy(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Stop Details" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading stop details…</Text>
                </View>
            </View>
        );
    }

    if (error || !stop) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Stop Details" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this stop"
                        message={error || 'The stop could not be found.'}
                        onRetry={load}
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <AdminScreenHeader title={stop.name} subtitle="Bus stop details" />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Hero */}
                <View style={styles.heroCard}>
                    <View style={styles.heroIcon}>
                        <Ionicons name="location" size={30} color={adminColors.primary} />
                    </View>
                    <Text style={styles.heroName}>{stop.name}</Text>
                    <Text style={styles.heroCoordinates}>
                        {stop.latitude}, {stop.longitude}
                    </Text>
                </View>

                {!!actionError && (
                    <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color={adminColors.danger} />
                        <Text style={styles.errorBannerText}>{actionError}</Text>
                    </View>
                )}

                {/* Location */}
                <Text style={styles.sectionTitle}>Location</Text>
                <View style={styles.card}>
                    <DetailRow label="Stop Name" value={stop.name} />
                    <DetailRow label="Latitude" value={String(stop.latitude)} />
                    <DetailRow label="Longitude" value={String(stop.longitude)} />
                    <DetailRow
                        label="Coordinates"
                        value={`${stop.latitude}, ${stop.longitude}`}
                        isLast
                    />
                </View>

                {/* Manage */}
                <Text style={styles.sectionTitle}>Manage</Text>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() =>
                            router.push({
                                pathname: '/(admin)/stops/edit/[stopId]',
                                params: { stopId: stop.stopId },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Edit this stop"
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.primarySoft }]}>
                            <Ionicons name="create-outline" size={20} color={adminColors.primary} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>Edit Stop</Text>
                            <Text style={styles.actionHint}>Update the name or coordinates</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, styles.actionRowBordered]}
                        onPress={() => setConfirmDelete(true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${stop.name}`}
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.dangerSoft }]}>
                            <Ionicons name="trash-outline" size={20} color={adminColors.danger} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={[styles.actionLabel, { color: adminColors.danger }]}>
                                Delete Stop
                            </Text>
                            <Text style={styles.actionHint}>
                                Blocked while any route still uses this stop
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <ConfirmDialog
                visible={confirmDelete}
                title="Delete Bus Stop?"
                message={`Are you sure you want to delete ${stop.name}? This action cannot be undone.`}
                confirmLabel="Delete Stop"
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
    heroIcon: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    heroName: {
        fontSize: 22,
        fontWeight: '800',
        color: adminColors.textPrimary,
        textAlign: 'center',
    },
    heroCoordinates: {
        fontSize: 13,
        color: adminColors.textSecondary,
        marginTop: 6,
    },

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