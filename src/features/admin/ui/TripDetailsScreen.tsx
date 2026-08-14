import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bus, CountedFacility } from '../../../entities/bus/model/types';
import { Route } from '../../../entities/route/model/types';
import { Trip } from '../../../entities/trip/model/types';
import {
    formatDurationBetween,
    formatFriendlyTime,
    parseApiTimeString,
} from '../../journey/utils/dateTime';
import { getBus } from '../api/busAdminApi';
import { getRoute } from '../api/routeAdminApi';
import { getTrip, setTripStatus } from '../api/tripAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState, ConfirmDialog } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

interface TripDetailsScreenProps {
    tripId: string;
}

const BOOLEAN_FACILITIES: {
    key: 'wheelchairRamp' | 'audioAnnouncement' | 'lowFloorVehicle' | 'walkingAssistance';
    label: string;
}[] = [
    { key: 'wheelchairRamp', label: 'Wheelchair Ramp' },
    { key: 'audioAnnouncement', label: 'Audio Announcement' },
    { key: 'lowFloorVehicle', label: 'Low Floor Vehicle' },
    { key: 'walkingAssistance', label: 'Walking Assistance' },
];

const COUNTED_FACILITIES: {
    key: 'wheelchairSpace' | 'guardianSeats' | 'prioritySeats' | 'elderlySeats';
    label: string;
}[] = [
    { key: 'wheelchairSpace', label: 'Wheelchair Space' },
    { key: 'guardianSeats', label: 'Guardian Seats' },
    { key: 'prioritySeats', label: 'Priority Seats' },
    { key: 'elderlySeats', label: 'Elderly Seats' },
];

export const TripDetailsScreen = ({ tripId }: TripDetailsScreenProps) => {
    const [trip, setTrip] = useState<Trip | null>(null);
    const [route, setRoute] = useState<Route | null>(null);
    const [bus, setBus] = useState<Bus | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [confirmStatus, setConfirmStatus] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            const loadedTrip = await getTrip(tripId);
            setTrip(loadedTrip);

            // The related records are fetched in parallel, and a missing one is
            // tolerated so the trip still renders.
            const [loadedRoute, loadedBus] = await Promise.all([
                getRoute(loadedTrip.routeId).catch(() => null),
                getBus(loadedTrip.busId).catch(() => null),
            ]);

            setRoute(loadedRoute);
            setBus(loadedBus);
        } catch (err: any) {
            setError(err?.message || 'Unable to load this trip.');
        } finally {
            setIsLoading(false);
        }
    }, [tripId]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const handleToggleStatus = async () => {
        if (!trip) return;

        setIsBusy(true);
        setActionError('');

        try {
            const nextStatus = trip.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
            setTrip(await setTripStatus(trip.tripId, nextStatus));
            setConfirmStatus(false);
        } catch (err: any) {
            setActionError(err?.message || 'Unable to update the trip status.');
            setConfirmStatus(false);
        } finally {
            setIsBusy(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Trip Details" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading trip details…</Text>
                </View>
            </View>
        );
    }

    if (error || !trip) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Trip Details" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this trip"
                        message={error || 'The trip could not be found.'}
                        onRetry={load}
                    />
                </View>
            </View>
        );
    }

    const departureLabel = formatFriendlyTime(parseApiTimeString(trip.departureTime));
    const arrivalLabel = formatFriendlyTime(parseApiTimeString(trip.estimatedArrivalTime));
    const duration = formatDurationBetween(trip.departureTime, trip.estimatedArrivalTime);
    const stops = Array.isArray(route?.stops) ? route!.stops : [];
    const facilities = bus?.accessibilityFacilities;

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Trip Details"
                subtitle={route ? `${route.routeNumber} · ${route.routeName}` : undefined}
            />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Schedule hero */}
                <View style={styles.heroCard}>
                    <View style={styles.heroTimes}>
                        <View style={styles.heroTimeBlock}>
                            <Text style={styles.heroTimeValue}>{departureLabel}</Text>
                            <Text style={styles.heroTimeCaption}>Departs</Text>
                        </View>

                        <View style={styles.heroConnector}>
                            <View style={styles.heroLine} />
                            {duration ? (
                                <View style={styles.durationPill}>
                                    <Text style={styles.durationText}>{duration}</Text>
                                </View>
                            ) : (
                                <Ionicons name="arrow-forward" size={16} color={adminColors.textMuted} />
                            )}
                            <View style={styles.heroLine} />
                        </View>

                        <View style={[styles.heroTimeBlock, styles.heroTimeBlockEnd]}>
                            <Text style={styles.heroTimeValue}>{arrivalLabel}</Text>
                            <Text style={styles.heroTimeCaption}>Est. arrival</Text>
                        </View>
                    </View>

                    <View style={styles.heroBadges}>
                        <StatusBadge status={trip.status} />
                        {!!route?.direction && <StatusBadge status={route.direction} />}
                    </View>
                </View>

                {!!actionError && (
                    <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color={adminColors.danger} />
                        <Text style={styles.errorBannerText}>{actionError}</Text>
                    </View>
                )}

                {/* Route */}
                <Text style={styles.sectionTitle}>Route</Text>
                <View style={styles.card}>
                    {route ? (
                        <>
                            <DetailRow label="Route Number" value={route.routeNumber} />
                            <DetailRow label="Route Name" value={route.routeName} />
                            <DetailRow
                                label="Direction"
                                value={
                                    route.direction === 'RETURN'
                                        ? 'Return'
                                        : route.direction
                                        ? 'Outbound'
                                        : '—'
                                }
                            />
                            <DetailRow label="Departure Stop" value={route.startLocation} />
                            <DetailRow label="Arrival Stop" value={route.endLocation} />
                            <DetailRow
                                label="Distance"
                                value={route.distanceKm != null ? `${route.distanceKm} km` : 'Not recorded'}
                            />
                            <DetailRow label="Route Status" value={route.status} isLast />
                        </>
                    ) : (
                        <Text style={styles.unavailableText}>
                            Route information is unavailable for this trip.
                        </Text>
                    )}
                </View>

                {/* Stops timeline */}
                {stops.length > 0 && (
                    <>
                        <Text style={styles.sectionTitle}>Stops on this trip</Text>
                        <View style={styles.card}>
                            {stops.map((stop, index) => {
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
                                    </View>
                                );
                            })}
                        </View>
                    </>
                )}

                {/* Bus */}
                <Text style={styles.sectionTitle}>Operating Bus</Text>
                <View style={styles.card}>
                    {bus ? (
                        <>
                            <View style={styles.busHeaderRow}>
                                <View style={styles.busIconCircle}>
                                    <Ionicons name="bus" size={22} color={adminColors.primary} />
                                </View>
                                <View style={styles.busHeaderText}>
                                    <Text style={styles.busPlate}>{bus.numberPlate}</Text>
                                    <Text style={styles.busModel} numberOfLines={1}>
                                        {bus.busModel}
                                    </Text>
                                </View>
                                <StatusBadge status={bus.status} size="small" />
                            </View>

                            <View style={styles.busDivider} />

                            <DetailRow label="Manufacturer" value={bus.manufacturer || '—'} />
                            <DetailRow
                                label="Seat Capacity"
                                value={bus.seatCapacity ? `${bus.seatCapacity} seats` : '—'}
                            />
                            <DetailRow
                                label="Manufacture Year"
                                value={bus.manufactureYear ? String(bus.manufactureYear) : '—'}
                                isLast
                            />

                            <TouchableOpacity
                                style={styles.linkRow}
                                onPress={() =>
                                    router.push({
                                        pathname: '/(admin)/buses/[numberPlate]',
                                        params: { numberPlate: bus.numberPlate },
                                    })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`Open full details for bus ${bus.numberPlate}`}
                            >
                                <Text style={styles.linkText}>View full bus record</Text>
                                <Ionicons name="chevron-forward" size={16} color={adminColors.primary} />
                            </TouchableOpacity>
                        </>
                    ) : (
                        <Text style={styles.unavailableText}>
                            Bus information is unavailable for this trip.
                        </Text>
                    )}
                </View>

                {/* Accessibility facilities (facts only — no score) */}
                {!!facilities && (
                    <>
                        <Text style={styles.sectionTitle}>Onboard Facilities</Text>
                        <View style={styles.card}>
                            {BOOLEAN_FACILITIES.map((facility, index) => (
                                <FacilityRow
                                    key={facility.key}
                                    label={facility.label}
                                    available={!!facilities[facility.key]}
                                    isFirst={index === 0}
                                />
                            ))}

                            {COUNTED_FACILITIES.map((facility) => {
                                const value = facilities[facility.key] as CountedFacility | undefined;

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
                    </>
                )}

                {/* Schedule facts */}
                <Text style={styles.sectionTitle}>Schedule</Text>
                <View style={styles.card}>
                    <DetailRow label="Departure Time" value={departureLabel} />
                    <DetailRow label="Estimated Arrival" value={arrivalLabel} />
                    {!!duration && <DetailRow label="Estimated Duration" value={duration} />}
                    <DetailRow label="Turn Number" value={`Turn ${trip.turnNumber}`} />
                    <DetailRow label="Trip Status" value={trip.status} isLast />
                </View>

                {/* Manage */}
                <Text style={styles.sectionTitle}>Manage</Text>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() =>
                            router.push({
                                pathname: '/(admin)/trips/edit/[tripId]',
                                params: { tripId: trip.tripId },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Edit this trip"
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.primarySoft }]}>
                            <Ionicons name="create-outline" size={20} color={adminColors.primary} />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>Edit Trip</Text>
                            <Text style={styles.actionHint}>Change the bus, route or times</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, styles.actionRowBordered]}
                        onPress={() => setConfirmStatus(true)}
                        accessibilityRole="button"
                        accessibilityLabel={
                            trip.status === 'ACTIVE' ? 'Cancel this trip' : 'Restore this trip'
                        }
                    >
                        <View style={[styles.actionIcon, { backgroundColor: adminColors.warningSoft }]}>
                            <Ionicons
                                name={
                                    trip.status === 'ACTIVE'
                                        ? 'close-circle-outline'
                                        : 'play-circle-outline'
                                }
                                size={20}
                                color={adminColors.warning}
                            />
                        </View>
                        <View style={styles.actionTextGroup}>
                            <Text style={styles.actionLabel}>
                                {trip.status === 'ACTIVE' ? 'Cancel Trip' : 'Restore Trip'}
                            </Text>
                            <Text style={styles.actionHint}>
                                {trip.status === 'ACTIVE'
                                    ? 'Removes it from journey searches — the record is kept'
                                    : 'Return this trip to the active schedule'}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>
                </View>
            </ScrollView>

            <ConfirmDialog
                visible={confirmStatus}
                title={trip.status === 'ACTIVE' ? 'Cancel Trip?' : 'Restore Trip?'}
                message={
                    trip.status === 'ACTIVE'
                        ? `Are you sure you want to cancel this scheduled trip?\n\n${
                              route ? `${route.routeNumber} ${route.startLocation} → ${route.endLocation}\n` : ''
                          }${bus ? `Bus ${bus.numberPlate}\n` : ''}${departureLabel}\n\nThe trip record is kept and can be restored later.`
                        : `This trip will return to the active schedule and appear in journey searches again.`
                }
                confirmLabel={trip.status === 'ACTIVE' ? 'Cancel Trip' : 'Restore Trip'}
                destructive={trip.status === 'ACTIVE'}
                isBusy={isBusy}
                onCancel={() => setConfirmStatus(false)}
                onConfirm={handleToggleStatus}
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
                    size={15}
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
        padding: 20,
        ...adminShadow.card,
    },
    heroTimes: { flexDirection: 'row', alignItems: 'center' },
    heroTimeBlock: { alignItems: 'flex-start' },
    heroTimeBlockEnd: { alignItems: 'flex-end' },
    heroTimeValue: {
        fontSize: 22,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: -0.3,
    },
    heroTimeCaption: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 2,
    },
    heroConnector: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        marginBottom: 13,
    },
    heroLine: {
        flex: 1,
        height: 2,
        backgroundColor: adminColors.border,
        borderRadius: 1,
    },
    durationPill: {
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 9,
        paddingHorizontal: 8,
        paddingVertical: 3,
        marginHorizontal: 6,
    },
    durationText: { fontSize: 11, fontWeight: '700', color: adminColors.textSecondary },
    heroBadges: { flexDirection: 'row', gap: 8, marginTop: 16 },

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
        paddingVertical: 11,
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
    unavailableText: {
        fontSize: 14,
        color: adminColors.textMuted,
        fontStyle: 'italic',
        paddingVertical: 8,
        textAlign: 'center',
    },

    busHeaderRow: { flexDirection: 'row', alignItems: 'center' },
    busIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    busHeaderText: { flex: 1, marginHorizontal: 12 },
    busPlate: {
        fontSize: 17,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: 0.3,
    },
    busModel: { fontSize: 12, color: adminColors.textSecondary, marginTop: 2 },
    busDivider: {
        height: 1,
        backgroundColor: adminColors.borderSubtle,
        marginTop: 14,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        marginTop: 4,
    },
    linkText: { fontSize: 14, fontWeight: '700', color: adminColors.primary },

    stopItem: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
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
    stopName: { flexShrink: 1, fontSize: 14, color: adminColors.textSecondary },
    stopNameEndpoint: { fontWeight: '700', color: adminColors.textPrimary },
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

    facilityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    facilityRowFirst: { borderTopWidth: 0 },
    facilityIcon: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    facilityTextGroup: { flex: 1 },
    facilityLabel: { fontSize: 14, fontWeight: '700', color: adminColors.textPrimary },
    facilityStatus: { fontSize: 12, color: adminColors.textSecondary, marginTop: 2 },

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
