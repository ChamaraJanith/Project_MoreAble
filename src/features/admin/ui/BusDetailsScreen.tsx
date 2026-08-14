import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bus, CountedFacility } from '../../../entities/bus/model/types';
import { deleteBus, getBus, setBusStatus } from '../api/busAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState, ConfirmDialog } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

interface BusDetailsScreenProps {
    numberPlate: string;
}

const BOOLEAN_FACILITIES: { key: 'wheelchairRamp' | 'audioAnnouncement' | 'lowFloorVehicle' | 'walkingAssistance'; label: string }[] = [
    { key: 'wheelchairRamp', label: 'Wheelchair Ramp' },
    { key: 'audioAnnouncement', label: 'Audio Announcement' },
    { key: 'lowFloorVehicle', label: 'Low Floor Vehicle' },
    { key: 'walkingAssistance', label: 'Walking Assistance' },
];

const COUNTED_FACILITIES: { key: 'wheelchairSpace' | 'guardianSeats' | 'prioritySeats' | 'elderlySeats'; label: string }[] = [
    { key: 'wheelchairSpace', label: 'Wheelchair Space' },
    { key: 'guardianSeats', label: 'Guardian Seats' },
    { key: 'prioritySeats', label: 'Priority Seats' },
    { key: 'elderlySeats', label: 'Elderly Seats' },
];

export const BusDetailsScreen = ({ numberPlate }: BusDetailsScreenProps) => {
    const [bus, setBus] = useState<Bus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [confirmDeactivate, setConfirmDeactivate] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            setBus(await getBus(numberPlate));
        } catch (err: any) {
            setError(err?.message || 'Unable to load this bus.');
        } finally {
            setIsLoading(false);
        }
    }, [numberPlate]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const handleToggleStatus = async () => {
        if (!bus) return;

        setIsBusy(true);
        setActionError('');

        try {
            const nextStatus = bus.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
            setBus(await setBusStatus(bus, nextStatus));
            setConfirmDeactivate(false);
        } catch (err: any) {
            setActionError(err?.message || 'Unable to update the bus status.');
            setConfirmDeactivate(false);
        } finally {
            setIsBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!bus) return;

        setIsBusy(true);
        setActionError('');

        try {
            await deleteBus(bus.numberPlate);
            setConfirmDelete(false);
            router.back();
        } catch (err: any) {
            setActionError(err?.message || 'Unable to delete this bus.');
            setConfirmDelete(false);
        } finally {
            setIsBusy(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Bus Details" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading bus details…</Text>
                </View>
            </View>
        );
    }

    if (error || !bus) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Bus Details" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this bus"
                        message={error || 'The bus could not be found.'}
                        onRetry={load}
                    />
                </View>
            </View>
        );
    }

    const facilities = bus.accessibilityFacilities;

    return (
        <View style={styles.container}>
            <AdminScreenHeader title={bus.numberPlate} subtitle={bus.busModel} />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Hero */}
                <View style={styles.heroCard}>
                    <View style={styles.heroIcon}>
                        <Ionicons name="bus" size={30} color={adminColors.primary} />
                    </View>
                    <Text style={styles.heroPlate}>{bus.numberPlate}</Text>
                    <Text style={styles.heroModel}>
                        {bus.busModel}
                        {bus.manufacturer ? ` · ${bus.manufacturer}` : ''}
                    </Text>
                    <View style={styles.heroBadge}>
                        <StatusBadge status={bus.status} />
                    </View>
                </View>

                {!!actionError && (
                    <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color={adminColors.danger} />
                        <Text style={styles.errorBannerText}>{actionError}</Text>
                    </View>
                )}

                {/* Vehicle Information */}
                <Text style={styles.sectionTitle}>Vehicle Information</Text>
                <View style={styles.card}>
                    <DetailRow label="Number Plate" value={bus.numberPlate} />
                    <DetailRow label="Chassis Number" value={bus.chassisNumber || '—'} />
                    <DetailRow label="Bus Model" value={bus.busModel || '—'} />
                    <DetailRow label="Manufacturer" value={bus.manufacturer || '—'} />
                    <DetailRow
                        label="Manufacture Year"
                        value={bus.manufactureYear ? String(bus.manufactureYear) : '—'}
                    />
                    <DetailRow
                        label="Seat Capacity"
                        value={bus.seatCapacity ? `${bus.seatCapacity} seats` : '—'}
                    />
                    <DetailRow label="Status" value={bus.status} isLast />
                </View>

                {/* Accessibility Facilities */}
                <Text style={styles.sectionTitle}>Accessibility Facilities</Text>
                <View style={styles.card}>
                    {BOOLEAN_FACILITIES.map((facility, index) => (
                        <FacilityRow
                            key={facility.key}
                            label={facility.label}
                            available={!!facilities?.[facility.key]}
                            isFirst={index === 0}
                        />
                    ))}

                    {COUNTED_FACILITIES.map((facility) => {
                        const value = facilities?.[facility.key] as CountedFacility | undefined;

                        return (
                            <FacilityRow
                                key={facility.key}
                                label={facility.label}
                                available={!!value?.available}
                                detail={
                                    value?.available
                                        ? `${value.count} seat${value.count === 1 ? '' : 's'}`
                                        : undefined
                                }
                            />
                        );
                    })}
                </View>

                {/* Actions */}
                <Text style={styles.sectionTitle}>Manage</Text>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() =>
                            router.push({
                                pathname: '/(admin)/buses/edit/[numberPlate]',
                                params: { numberPlate: bus.numberPlate },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Edit bus details"
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.primarySoft }]}>
                            <Ionicons name="create-outline" size={20} color={adminColors.primary} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>Edit Bus</Text>
                            <Text style={styles.actionHint}>Update details and facilities</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, styles.actionRowBordered]}
                        onPress={() => setConfirmDeactivate(true)}
                        accessibilityRole="button"
                        accessibilityLabel={
                            bus.status === 'ACTIVE' ? 'Deactivate this bus' : 'Reactivate this bus'
                        }
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.warningSoft }]}>
                            <Ionicons
                                name={bus.status === 'ACTIVE' ? 'pause-circle-outline' : 'play-circle-outline'}
                                size={20}
                                color={adminColors.warning}
                            />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>
                                {bus.status === 'ACTIVE' ? 'Deactivate Bus' : 'Reactivate Bus'}
                            </Text>
                            <Text style={styles.actionHint}>
                                {bus.status === 'ACTIVE'
                                    ? 'Take it out of service without deleting it'
                                    : 'Return this bus to active service'}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, styles.actionRowBordered]}
                        onPress={() => setConfirmDelete(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Delete this bus permanently"
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.dangerSoft }]}>
                            <Ionicons name="trash-outline" size={20} color={adminColors.danger} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={[styles.actionLabel, { color: adminColors.danger }]}>Delete Bus</Text>
                            <Text style={styles.actionHint}>Permanently remove this record</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <ConfirmDialog
                visible={confirmDeactivate}
                title={bus.status === 'ACTIVE' ? 'Deactivate Bus?' : 'Reactivate Bus?'}
                message={
                    bus.status === 'ACTIVE'
                        ? `Bus ${bus.numberPlate} will be marked inactive and taken out of service. You can reactivate it later.`
                        : `Bus ${bus.numberPlate} will be returned to active service.`
                }
                confirmLabel={bus.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                isBusy={isBusy}
                onCancel={() => setConfirmDeactivate(false)}
                onConfirm={handleToggleStatus}
            />

            <ConfirmDialog
                visible={confirmDelete}
                title="Delete Bus?"
                message={`Are you sure you want to delete bus ${bus.numberPlate}? This action cannot be undone. Consider deactivating it instead.`}
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

function FacilityRow({
    label,
    available,
    detail,
    isFirst,
}: {
    label: string;
    available: boolean;
    detail?: string;
    isFirst?: boolean;
}) {
    return (
        <View style={[styles.facilityRow, isFirst && styles.facilityRowFirst]}>
            <View
                style={[
                    styles.facilityIcon,
                    { backgroundColor: available ? adminColors.successSoft : adminColors.borderSubtle },
                ]}
            >
                <Ionicons
                    name={available ? 'checkmark' : 'close'}
                    size={16}
                    color={available ? adminColors.success : adminColors.textMuted}
                />
            </View>

            <View style={styles.facilityTextGroup}>
                <Text style={styles.facilityLabel}>{label}</Text>
                <Text style={styles.facilityStatus}>
                    {available ? 'Available' : 'Not Available'}
                    {detail ? ` · ${detail}` : ''}
                </Text>
            </View>
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
        marginBottom: 8,
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
    heroPlate: {
        fontSize: 24,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: 0.5,
    },
    heroModel: {
        fontSize: 14,
        color: adminColors.textSecondary,
        marginTop: 4,
        textAlign: 'center',
    },
    heroBadge: { marginTop: 12 },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 16,
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

    facilityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 11,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    facilityRowFirst: { borderTopWidth: 0 },
    facilityIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    facilityTextGroup: { flex: 1 },
    facilityLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    facilityStatus: {
        fontSize: 12,
        color: adminColors.textSecondary,
        marginTop: 2,
    },

    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        minHeight: 60,
    },
    actionRowBordered: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    actionIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    actionTextGroup: { flex: 1 },
    actionLabel: {
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    actionHint: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 2,
    },

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