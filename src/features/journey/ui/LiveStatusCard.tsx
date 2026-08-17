import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { JourneyLiveStatus } from '../../../entities/route/model/types';
import { formatLocationAge, resolveVehiclePosition } from '../utils/liveStatus';

interface LiveStatusCardProps {
    /** The live block for the selected departure. Absent on older responses. */
    liveStatus?: JourneyLiveStatus | null;
    /** The vehicle's number plate, when the departure has a known bus. */
    numberPlate?: string;
    /** Fetches the journey search again. Omitted when it cannot be repeated. */
    onRefresh?: () => void;
    isRefreshing?: boolean;
    /** Set when the last refresh attempt failed; the shown data is still valid. */
    refreshError?: string | null;
}

const UNAVAILABLE_TITLE = 'Live location unavailable';
const UNAVAILABLE_BODY =
    'This bus has not reported where it is yet. Your scheduled journey details below are unaffected.';

/**
 * Live bus status (MOV-119).
 *
 * Answers one question — is this bus telling us where it is, and how recently —
 * and stops there. It shows no delay, no live arrival time and no moving or
 * stopped state, because the backend provides none of those and a passenger
 * acting on an invented one could miss their bus.
 *
 * Both states are ordinary. A bus that is not reporting is not an error, and is
 * styled calmly rather than as a warning.
 */
export function LiveStatusCard({
    liveStatus,
    numberPlate,
    onRefresh,
    isRefreshing = false,
    refreshError,
}: LiveStatusCardProps) {
    // A position that cannot be plotted is treated as no position at all, so
    // the card never claims a location the map cannot show.
    const isLive = resolveVehiclePosition(liveStatus) !== null;
    const updatedLabel = isLive ? formatLocationAge(liveStatus?.locationAgeSeconds) : null;

    return (
        <View style={styles.card}>
            <View style={styles.headingRow}>
                <Ionicons name="radio-outline" size={16} color="#0F172A" />
                <Text style={styles.heading}>Live bus status</Text>

                {!!onRefresh && (
                    <TouchableOpacity
                        style={styles.refreshButton}
                        onPress={onRefresh}
                        disabled={isRefreshing}
                        accessibilityRole="button"
                        accessibilityLabel="Refresh bus location"
                        accessibilityState={{ disabled: isRefreshing, busy: isRefreshing }}
                    >
                        {isRefreshing ? (
                            <ActivityIndicator size="small" color="#0066CC" />
                        ) : (
                            <>
                                <Ionicons name="refresh" size={15} color="#0066CC" />
                                <Text style={styles.refreshText}>Refresh</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* Icon, wording and background all carry the state — never colour
                on its own. */}
            <View
                style={[styles.statusRow, isLive ? styles.statusRowLive : styles.statusRowIdle]}
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={
                    isLive
                        ? `Live location available. ${updatedLabel ?? ''}`.trim()
                        : `${UNAVAILABLE_TITLE}. ${UNAVAILABLE_BODY}`
                }
            >
                <View style={[styles.statusIcon, isLive ? styles.statusIconLive : styles.statusIconIdle]}>
                    <Ionicons
                        name={isLive ? 'navigate' : 'cloud-offline-outline'}
                        size={18}
                        color={isLive ? '#FFFFFF' : '#64748B'}
                    />
                </View>

                <View style={styles.statusTextGroup}>
                    <Text style={[styles.statusTitle, isLive && styles.statusTitleLive]}>
                        {isLive ? 'Live location available' : UNAVAILABLE_TITLE}
                    </Text>

                    {isLive ? (
                        !!updatedLabel && <Text style={styles.statusDetail}>{updatedLabel}</Text>
                    ) : (
                        <Text style={styles.statusDetail}>{UNAVAILABLE_BODY}</Text>
                    )}
                </View>
            </View>

            {isLive && (
                <Text style={styles.footnote}>
                    {numberPlate
                        ? `Bus ${numberPlate} is marked on the map below.`
                        : 'Your bus is marked on the map below.'}
                </Text>
            )}

            {/* Said plainly: the position is from the last search, not a feed.
                The departure and arrival times on this screen are the timetable,
                and nothing here revises them. */}
            <Text style={styles.footnote}>
                Departure and arrival times shown above are scheduled times.
                {onRefresh ? ' Tap Refresh for the latest location.' : ''}
            </Text>

            {!!refreshError && (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {refreshError}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#EEF2F7',
    },
    headingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    heading: {
        flex: 1,
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    refreshButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        // Comfortably tappable for someone with limited dexterity.
        minHeight: 44,
        minWidth: 88,
        paddingLeft: 12,
    },
    refreshText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
        marginLeft: 5,
    },

    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderWidth: 1,
    },
    statusRowLive: {
        backgroundColor: '#ECFDF5',
        borderColor: '#A7F3D0',
    },
    statusRowIdle: {
        backgroundColor: '#F8FAFC',
        borderColor: '#E2E8F0',
    },
    statusIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    statusIconLive: {
        backgroundColor: '#047857',
    },
    statusIconIdle: {
        backgroundColor: '#E2E8F0',
    },
    statusTextGroup: {
        flex: 1,
    },
    statusTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#334155',
    },
    statusTitleLive: {
        color: '#065F46',
    },
    statusDetail: {
        fontSize: 13,
        fontWeight: '500',
        color: '#475569',
        marginTop: 3,
        lineHeight: 18,
    },

    footnote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 8,
        lineHeight: 17,
    },
    errorText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#B91C1C',
        marginTop: 8,
        lineHeight: 17,
    },
});
