import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Booking } from '../../../entities/booking/model/types';
import { AppText as Text } from '../../../shared/ui/AppText';
import {
    apiTimeToMinutes,
    formatFriendlyDate,
    formatFriendlyTime,
    parseApiTimeString,
} from '../../journey/utils/dateTime';

export type ActivityCardVariant = 'ongoing' | 'completed';

interface ActivityJourneyCardProps {
    booking: Booking;
    variant: ActivityCardVariant;
    /**
     * The card's one action: "View Journey" when ongoing, "View Details" when
     * completed. The screen decides where it leads (see activityRoutes), so
     * MOV-297 can point an ongoing journey at live tracking without touching
     * this component.
     */
    onPress: (booking: Booking) => void;
}

/** '06:30' -> '6:30 AM'; anything unreadable is shown as stored rather than hidden. */
function formatScheduledTime(value?: string): string {
    if (apiTimeToMinutes(value) === null) return value || '—';
    return formatFriendlyTime(parseApiTimeString(value as string));
}

/** When the bus actually pressed Start Journey, in local time. */
function formatStartedAt(value?: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const hour24 = date.getHours();
    return formatFriendlyTime({
        hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
        minute: date.getMinutes(),
        period: hour24 >= 12 ? 'PM' : 'AM',
    });
}

function formatJourneyDate(value?: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : formatFriendlyDate(date);
}

/**
 * One journey in the Activities list (MOV-294).
 *
 * Compact on purpose: enough to recognise the trip — route, stops, scheduled
 * times, bus — and a single action. It deliberately contains no map; the live
 * tracking view is a separate screen (MOV-297).
 */
export function ActivityJourneyCard({ booking, variant, onPress }: ActivityJourneyCardProps) {
    const { t } = useTranslation();
    const isOngoing = variant === 'ongoing';

    const routeNumber = booking.journey?.routeNumber || '—';
    const routeName = booking.journey?.routeName && booking.journey.routeName !== '—' ? booking.journey.routeName : '';
    const origin = booking.journey?.startLocation || '—';
    const destination = booking.journey?.endLocation || '—';
    const departure = formatScheduledTime(booking.journey?.departureTime);
    const arrival = formatScheduledTime(booking.journey?.estimatedArrivalTime);
    const journeyDate = isOngoing ? null : formatJourneyDate(booking.boardedAt);
    const startedAt = isOngoing ? formatStartedAt(booking.activeJourney?.startedAt) : null;
    const numberPlate = booking.vehicle?.numberPlate;

    const statusLabel = isOngoing
        ? t('activities.inProgress', 'In Progress')
        : t('activities.completedStatus', 'Completed');
    const actionLabel = isOngoing
        ? t('activities.viewJourney', 'View Journey')
        : t('activities.viewDetails', 'View Details');

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <View style={styles.routeGroup}>
                    <View style={styles.routeBadge}>
                        <Ionicons name="bus" size={14} color="#FFFFFF" />
                        <Text style={styles.routeBadgeText}>{routeNumber}</Text>
                    </View>
                    {!!routeName && (
                        <Text style={styles.routeName} numberOfLines={1}>
                            {routeName}
                        </Text>
                    )}
                </View>

                <View
                    style={[styles.statusPill, isOngoing ? styles.statusPillOngoing : styles.statusPillCompleted]}
                    accessibilityLabel={statusLabel}
                >
                    <Ionicons
                        name={isOngoing ? 'radio-button-on' : 'checkmark-circle'}
                        size={12}
                        color={isOngoing ? '#0066CC' : '#065F46'}
                    />
                    <Text style={[styles.statusText, isOngoing ? styles.statusTextOngoing : styles.statusTextCompleted]}>
                        {statusLabel}
                    </Text>
                </View>
            </View>

            <Text style={styles.stopsText} numberOfLines={2}>
                {origin} → {destination}
            </Text>

            <View style={styles.metaRow}>
                <View style={styles.metaBadge}>
                    <Ionicons name="time-outline" size={14} color="#0066CC" />
                    <Text style={styles.metaText}>
                        {departure} → {arrival}
                    </Text>
                </View>

                {!!numberPlate && (
                    <View style={styles.metaBadge}>
                        <Ionicons name="bus-outline" size={14} color="#0066CC" />
                        <Text style={styles.metaText}>{numberPlate}</Text>
                    </View>
                )}

                {!!startedAt && (
                    <View style={styles.metaBadge}>
                        <Ionicons name="play-circle-outline" size={14} color="#0066CC" />
                        <Text style={styles.metaText}>
                            {t('activities.startedAt', 'Started {{time}}', { time: startedAt })}
                        </Text>
                    </View>
                )}

                {!!journeyDate && (
                    <View style={styles.metaBadge}>
                        <Ionicons name="calendar-outline" size={14} color="#0066CC" />
                        <Text style={styles.metaText}>{journeyDate}</Text>
                    </View>
                )}
            </View>

            <View style={styles.divider} />

            <View style={styles.footerRow}>
                <Text style={styles.bookingIdText}>ID: {booking.bookingId}</Text>
                <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => onPress(booking)}
                    accessibilityRole="button"
                    accessibilityLabel={`${actionLabel}, route ${routeNumber}, ${origin} to ${destination}, ${statusLabel}`}
                >
                    <Text style={styles.actionBtnText}>{actionLabel}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        gap: 10,
    },
    routeGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        gap: 8,
    },
    routeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 5,
    },
    routeBadgeText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#FFFFFF',
    },
    routeName: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 5,
    },
    statusPillOngoing: {
        backgroundColor: '#EBF3FA',
    },
    statusPillCompleted: {
        backgroundColor: '#D1FAE5',
    },
    statusText: {
        fontSize: 11,
        fontWeight: '900',
    },
    statusTextOngoing: {
        color: '#0066CC',
    },
    statusTextCompleted: {
        color: '#065F46',
    },
    stopsText: {
        fontSize: 17,
        fontWeight: '800',
        color: '#1E293B',
        marginBottom: 12,
    },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    metaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        gap: 6,
    },
    metaText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#1E293B',
    },
    divider: {
        height: 1.5,
        backgroundColor: '#F1F5F9',
        marginBottom: 10,
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    bookingIdText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    actionBtn: {
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 14,
        borderRadius: 10,
        gap: 6,
        justifyContent: 'center',
    },
    actionBtnText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#FFFFFF',
    },
});
