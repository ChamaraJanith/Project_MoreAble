import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { apiTimeToMinutes, formatFriendlyTime, parseApiTimeString } from '../../journey/utils/dateTime';
import { AssignedTrip } from '../utils/assignedTrips';
import { ActiveJourney, StartJourneyRefusal, TripCardState, tripCardState } from '../utils/journeyControl';
import { LocationStatusCard } from './LocationStatusCard';
import { TripJourney } from './useTripJourney';

interface TripControlTabProps {
    /** The bus's trips, running journey and its location sharing. */
    journey: TripJourney;
}

const REFUSAL_MESSAGES: Record<StartJourneyRefusal, string> = {
    ANOTHER_JOURNEY_ACTIVE: 'End the current journey before starting another trip.',
    TRIP_NOT_ASSIGNED: 'This trip is not assigned to the bus signed in on this device.',
    IN_PROGRESS: 'Please wait — the last change is still being saved.',
    FAILED: 'The journey could not be started. Please try again.',
};

/** '06:00' -> '6:00 AM'; anything unreadable is shown as stored. */
function formatTime(value: string): string {
    if (apiTimeToMinutes(value) === null) return value || '—';
    return formatFriendlyTime(parseApiTimeString(value));
}

/** An ISO timestamp as a local clock time, e.g. '8:35 PM'. */
function formatClock(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const hour24 = date.getHours();
    return formatFriendlyTime({
        hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
        minute: date.getMinutes(),
        period: hour24 >= 12 ? 'PM' : 'AM',
    });
}

function stopsLabel(trip: AssignedTrip): string {
    return trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : 'Route details unavailable';
}

/**
 * Trip Control on the Transit Console (MOV-294).
 *
 * Lists every trip assigned to this bus. The driver starts a SPECIFIC trip with
 * its Start Journey button, which records the start on the server and begins
 * the existing location sharing for that trip.
 *
 * A started journey belongs to the trip, not to this sign-in: logging out ends
 * the sign-in only. The journey keeps running and its location sharing keeps
 * going, and signing back in simply shows it again with End Journey — End
 * Journey is the only thing that stops sharing.
 *
 * Only one trip runs at a time: while one is active, every other card's start
 * is disabled.
 */
export function TripControlTab({ journey }: TripControlTabProps) {
    const [notice, setNotice] = useState('');

    const { trips, loading, refreshing, error, reload, busy, sharing, startJourney, endJourney } = journey;
    const active = journey.journey;

    const handleStart = useCallback(
        async (trip: AssignedTrip) => {
            setNotice('');
            const result = await startJourney(trip);
            if (!result.ok) setNotice(result.message || REFUSAL_MESSAGES[result.reason]);
        },
        [startJourney]
    );

    const handleEnd = useCallback(async () => {
        setNotice('');
        const result = await endJourney();
        if (!result.ok && result.reason === 'FAILED') {
            setNotice(
                `${result.message || 'The journey could not be ended.'} It is still running for passengers — please try again.`
            );
        }
    }, [endJourney]);

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => reload('refresh')}
                    colors={['#0066CC']}
                    tintColor="#0066CC"
                />
            }
        >
            <View style={styles.headerTitleRow}>
                <Ionicons name="navigate-outline" size={22} color="#0066CC" />
                <Text style={styles.headerTitle} accessibilityRole="header">
                    Trip Control
                </Text>
            </View>

            {!!notice && (
                <View style={styles.noticeRow} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
                    <Text style={styles.noticeText}>{notice}</Text>
                </View>
            )}

            {active && (
                <>
                    <Text style={styles.sectionLabel}>Active journey</Text>
                    <View style={styles.activeSummary}>
                        <TripSummary trip={active.trip} />
                        <JourneyStarted journey={active} />
                    </View>

                    <LocationStatusCard tracking={sharing} onEndJourney={handleEnd} />
                </>
            )}

            <Text style={[styles.sectionLabel, active && styles.sectionLabelSpaced]}>
                Assigned trips{trips.length > 0 ? ` (${trips.length})` : ''}
            </Text>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="small" color="#0066CC" />
                    <Text style={styles.mutedText}>Loading assigned trips...</Text>
                </View>
            ) : error ? (
                <View style={styles.messageCard}>
                    <Ionicons name="warning-outline" size={28} color="#D32F2F" />
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={() => reload('initial')} accessibilityRole="button">
                        <Text style={styles.retryBtnText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            ) : trips.length === 0 ? (
                <View style={styles.messageCard}>
                    <Ionicons name="calendar-outline" size={28} color="#94A3B8" />
                    <Text style={styles.messageTitle}>No trips assigned</Text>
                    <Text style={styles.mutedText}>
                        Trips scheduled for this bus will appear here. Ask your depot admin if you expected one.
                    </Text>
                </View>
            ) : (
                trips.map((trip) => (
                    <AssignedTripCard
                        key={trip.tripId}
                        trip={trip}
                        state={tripCardState(trip, active)}
                        busy={busy}
                        onStart={handleStart}
                    />
                ))
            )}
        </ScrollView>
    );
}

/** When the running journey actually started. */
function JourneyStarted({ journey }: { journey: ActiveJourney }) {
    return (
        <View style={styles.journeyTimes}>
            <View style={styles.activePillInline}>
                <Ionicons name="navigate" size={14} color="#047857" />
                <Text style={styles.activePillText}>Journey started at {formatClock(journey.startedAt)}</Text>
            </View>
        </View>
    );
}

function TripSummary({ trip }: { trip: AssignedTrip }) {
    const arrival = trip.estimatedArrivalTime ? ` → ${formatTime(trip.estimatedArrivalTime)}` : '';

    return (
        <View>
            <View style={styles.routeRow}>
                <View style={styles.routeBadge}>
                    <Ionicons name="bus" size={14} color="#FFFFFF" />
                    <Text style={styles.routeBadgeText}>{trip.routeNumber ?? '—'}</Text>
                </View>
                {!!trip.routeName && (
                    <Text style={styles.routeName} numberOfLines={1}>
                        {trip.routeName}
                    </Text>
                )}
            </View>
            <Text style={styles.timeText}>
                {formatTime(trip.departureTime)}
                {arrival}
            </Text>
            <Text style={styles.stopsText}>{stopsLabel(trip)}</Text>
            {trip.turnNumber !== null && <Text style={styles.turnText}>Turn {trip.turnNumber}</Text>}
        </View>
    );
}

interface AssignedTripCardProps {
    trip: AssignedTrip;
    state: TripCardState;
    /** A start or end is being saved; starting is paused until it settles. */
    busy: boolean;
    onStart: (trip: AssignedTrip) => void;
}

function AssignedTripCard({ trip, state, busy, onStart }: AssignedTripCardProps) {
    const isActive = state === 'ACTIVE';
    const isBlocked = state === 'BLOCKED';
    const isDisabled = isBlocked || busy;
    const description = `Route ${trip.routeNumber ?? 'unknown'}, ${formatTime(trip.departureTime)}, ${stopsLabel(trip)}`;

    return (
        <View style={[styles.card, isActive && styles.cardActive]}>
            <TripSummary trip={trip} />

            {isActive ? (
                <View style={styles.activePill} accessibilityLabel={`${description}. Journey started`}>
                    <Ionicons name="navigate" size={14} color="#047857" />
                    <Text style={styles.activePillText}>Journey started</Text>
                </View>
            ) : (
                <TouchableOpacity
                    style={[styles.startButton, isDisabled && styles.startButtonDisabled]}
                    onPress={() => onStart(trip)}
                    disabled={isDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={`Start Journey, ${description}`}
                    accessibilityHint={
                        isBlocked
                            ? 'Unavailable while another journey is active'
                            : 'Starts this trip and shares this bus location with its passengers'
                    }
                    accessibilityState={{ disabled: isDisabled }}
                >
                    <Ionicons name="play" size={16} color={isDisabled ? '#94A3B8' : '#FFFFFF'} />
                    <Text style={[styles.startButtonText, isDisabled && styles.startButtonTextDisabled]}>
                        Start Journey
                    </Text>
                </TouchableOpacity>
            )}

            {isBlocked && <Text style={styles.blockedHint}>Another journey is active</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
    },
    content: {
        paddingVertical: 10,
        paddingBottom: 30,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 8,
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '800',
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
    },
    sectionLabelSpaced: {
        marginTop: 22,
    },
    noticeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        gap: 8,
    },
    noticeText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#92400E',
    },
    activeSummary: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        borderWidth: 2,
        borderColor: '#10B981',
        marginBottom: 12,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    cardActive: {
        borderColor: '#10B981',
        backgroundColor: '#F0FDF4',
    },
    routeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
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
        fontSize: 15,
        fontWeight: '900',
        color: '#FFFFFF',
    },
    routeName: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
    },
    timeText: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
    },
    stopsText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1E293B',
        marginTop: 4,
    },
    turnText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 4,
    },
    journeyTimes: {
        marginTop: 14,
    },
    startButton: {
        flexDirection: 'row',
        backgroundColor: '#0066CC',
        // Large enough to hit comfortably, including with reduced dexterity.
        minHeight: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginTop: 16,
        gap: 8,
    },
    startButtonDisabled: {
        backgroundColor: '#E2E8F0',
    },
    startButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    startButtonTextDisabled: {
        color: '#64748B',
    },
    blockedHint: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 8,
    },
    activePill: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        alignItems: 'center',
        backgroundColor: '#D1FAE5',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginTop: 14,
        gap: 6,
    },
    activePillInline: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        alignItems: 'center',
        backgroundColor: '#D1FAE5',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 6,
    },
    activePillText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#065F46',
    },
    center: {
        padding: 30,
        alignItems: 'center',
    },
    messageCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 24,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        gap: 8,
    },
    messageTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    mutedText: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 6,
    },
    errorText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#D32F2F',
        textAlign: 'center',
    },
    retryBtn: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
        marginTop: 4,
    },
    retryBtnText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0066CC',
    },
});
