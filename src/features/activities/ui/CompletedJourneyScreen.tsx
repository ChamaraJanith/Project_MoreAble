import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PassengerCompletedJourney } from '../../../entities/booking/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import { AppText as Text } from '../../../shared/ui/AppText';
import { RouteMapCard } from '../../journey/ui/RouteMapCard';
import { RouteStopTimeline } from '../../journey/ui/RouteStopTimeline';
import { getCompletedJourneys, OngoingJourneyRequestError } from '../api/ongoingJourneyApi';
import {
    completionReasonLabel,
    completionTimeCaption,
    findCompletedJourney,
    formatDistanceKm,
    formatJourneyDay,
    timeOnBoardLabel,
} from '../utils/completedJourney';
import {
    buildOngoingMapData,
    describeOngoingSchedule,
    formatClockTime,
    formatOngoingFare,
} from '../utils/ongoingJourneyTracking';

type LoadState = 'LOADING' | 'READY' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'ERROR';

function goToActivities() {
    if (router.canGoBack()) router.back();
    else router.replace('/activities');
}

/**
 * Completed Journey (MOV-297): Activities > Completed > View Details.
 *
 * A summary of a journey that has finished — how and when it finished, the
 * planned route and stops, the fare paid. History, not tracking: there is no
 * bus on the map, nothing refreshes, and nothing here can change the journey.
 *
 * Everything comes from GET /api/journeys/completed (MOV-296 access and data
 * rules). The booking id in the URL only picks which of the passenger's own
 * completed journeys to show; it is never sent to the server.
 */
export function CompletedJourneyScreen() {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
    const token = useAuthStore((store) => store.token);

    const [loadState, setLoadState] = useState<LoadState>('LOADING');
    const [journey, setJourney] = useState<PassengerCompletedJourney | null>(null);
    const [attempt, setAttempt] = useState(0);

    /** One read; `isCurrent` turns false once the screen is left, so a late answer is dropped. */
    const load = useCallback(
        async (isCurrent: () => boolean) => {
            if (!token || !bookingId) {
                setLoadState('UNAUTHORIZED');
                return;
            }

            setLoadState('LOADING');

            try {
                const journeys = await getCompletedJourneys(token, { includeRoute: true });
                if (!isCurrent()) return;
                const found = findCompletedJourney(journeys, bookingId);
                setJourney(found);
                setLoadState(found ? 'READY' : 'NOT_FOUND');
            } catch (error) {
                if (!isCurrent()) return;
                const status = error instanceof OngoingJourneyRequestError ? error.status : null;
                setJourney(null);
                setLoadState(status === 401 || status === 403 ? 'UNAUTHORIZED' : 'ERROR');
            }
        },
        [bookingId, token]
    );

    // Loaded once per visit (and again on Retry). A finished journey does not
    // change, so there is nothing to poll.
    useFocusEffect(
        useCallback(() => {
            let current = true;
            load(() => current);
            return () => {
                current = false;
            };
            // `attempt` re-runs the load when the passenger taps Retry.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [load, attempt])
    );

    const retry = () => setAttempt((count) => count + 1);

    const containerPadding = {
        paddingTop: insets.top > 0 ? insets.top + 10 : 20,
        paddingBottom: insets.bottom > 0 ? insets.bottom + 32 : 32,
    };

    const header = (
        <View style={styles.headerRow}>
            <TouchableOpacity
                style={styles.backButton}
                onPress={goToActivities}
                accessibilityRole="button"
                accessibilityLabel={t('completedJourney.back', 'Back to Activities')}
            >
                <Ionicons name="arrow-back" size={24} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} accessibilityRole="header">
                {t('completedJourney.title', 'Completed Journey')}
            </Text>
        </View>
    );

    if (loadState !== 'READY' || !journey) {
        const content =
            loadState === 'LOADING'
                ? null
                : {
                      NOT_FOUND: {
                          title: t('completedJourney.notFoundTitle', 'Journey not found'),
                          body: t('completedJourney.notFoundDesc', 'This completed journey could not be found.'),
                          action: t('completedJourney.backToActivities', 'BACK TO ACTIVITIES'),
                          onPress: goToActivities,
                      },
                      UNAUTHORIZED: {
                          title: t('ongoingJourney.signInTitle', 'Please sign in again'),
                          body: t('completedJourney.signInDesc', 'Sign in with your passenger account to see your journeys.'),
                          action: t('activities.goToSignIn', 'GO TO SIGN IN'),
                          onPress: () => router.replace('/(auth)'),
                      },
                      ERROR: {
                          title: t('completedJourney.errorTitle', 'Unable to load this journey'),
                          body: t('ongoingJourney.errorDesc', 'Please check your connection and try again.'),
                          action: t('activities.retryBtn', 'RETRY'),
                          onPress: retry,
                      },
                      READY: null,
                  }[loadState];

        return (
            <View style={[styles.container, containerPadding, styles.padded]}>
                {header}
                <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                    {!content ? (
                        <>
                            <ActivityIndicator size="large" color="#0066CC" />
                            <Text style={styles.stateDescription}>{t('completedJourney.loading', 'Loading your journey...')}</Text>
                        </>
                    ) : (
                        <>
                            <Text style={styles.stateTitle}>{content.title}</Text>
                            <Text style={styles.stateDescription}>{content.body}</Text>
                            <TouchableOpacity style={styles.primaryButton} onPress={content.onPress} accessibilityRole="button">
                                <Text style={styles.primaryButtonText}>{content.action}</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            </View>
        );
    }

    const { booking, completion, route } = journey;
    const origin = booking.journey?.startLocation || '—';
    const destination = booking.journey?.endLocation || '—';
    const routeName = booking.journey?.routeName && booking.journey.routeName !== '—' ? booking.journey.routeName : '';
    const mapData = buildOngoingMapData(route);
    const schedule = describeOngoingSchedule(journey, route ?? null);
    const fare = formatOngoingFare(journey);
    const distance = formatDistanceKm(completion.plannedDistanceKm);
    const onBoard = timeOnBoardLabel(booking, completion);
    const journeyDay = formatJourneyDay(completion.journeyStartedAt);
    const busStarted = formatClockTime(completion.journeyStartedAt);
    const completedAt = formatClockTime(completion.completedAt);
    const reason = completionReasonLabel(completion.completionReason);
    const stops = route?.journeyStops ?? (completion.journeyStops.length >= 2 ? completion.journeyStops : [origin, destination]);
    const seat = booking.pairedSeatNumber ? `${booking.seatNumber} + ${booking.pairedSeatNumber}` : booking.seatNumber;
    const notAvailable = t('ongoingJourney.notAvailable', 'Not available');

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={[styles.scrollContent, containerPadding]} showsVerticalScrollIndicator={false}>
                {header}

                {/* ---------------- Summary ---------------- */}
                <View style={styles.card}>
                    <View style={styles.statusPill} accessibilityLabel={t('completedJourney.completed', 'Completed')}>
                        <Ionicons name="checkmark-circle" size={14} color="#065F46" />
                        <Text style={styles.statusPillText}>{t('completedJourney.completed', 'Completed')}</Text>
                    </View>

                    <View style={styles.identityRow}>
                        <View style={styles.routeBadge}>
                            <Ionicons name="bus" size={16} color="#FFFFFF" />
                            <Text style={styles.routeBadgeText}>{booking.journey?.routeNumber || '—'}</Text>
                        </View>
                        <View style={styles.identityText}>
                            <Text style={styles.identityJourney}>
                                {origin} → {destination}
                            </Text>
                            {!!routeName && <Text style={styles.identityRouteName}>{routeName}</Text>}
                        </View>
                    </View>

                    <Text style={styles.reasonText} accessibilityLiveRegion="polite">
                        {reason}
                    </Text>

                    <InfoRow icon="calendar-outline" label={t('completedJourney.date', 'Journey date')} value={journeyDay ?? notAvailable} />
                    <InfoRow icon="play-circle-outline" label={t('completedJourney.busStarted', 'Bus started the journey')} value={busStarted ?? notAvailable} />
                    <InfoRow
                        icon="flag-outline"
                        label={t(
                            completion.completionReason === 'PASSENGER' ? 'completedJourney.youCompletedAt' : 'completedJourney.completedAt',
                            completionTimeCaption(completion.completionReason)
                        )}
                        value={completedAt ?? notAvailable}
                    />
                    {!!booking.vehicle?.numberPlate && (
                        <InfoRow icon="bus-outline" label={t('completedJourney.bus', 'Bus')} value={booking.vehicle.numberPlate} />
                    )}
                </View>

                {/* ---------------- Route map: the plan, never a bus ---------------- */}
                <RouteMapCard
                    title={t('completedJourney.mapTitle', 'Journey route')}
                    geo={mapData?.geo}
                    stops={mapData?.stops}
                    unmappedStopCount={mapData?.unmappedStopCount}
                    road={mapData?.road}
                    originLabel={origin}
                    destinationLabel={destination}
                />

                {/* ---------------- Details ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="information-circle-outline" title={t('completedJourney.details', 'Journey details')} />
                    <InfoRow icon="radio-button-on" label={t('ongoingJourney.from', 'From')} value={origin} />
                    <InfoRow icon="location" label={t('ongoingJourney.to', 'To')} value={destination} />
                    <InfoRow icon="navigate-outline" label={t('completedJourney.distance', 'Planned distance')} value={distance ?? notAvailable} />
                    {!!onBoard && <InfoRow icon="hourglass-outline" label={t('completedJourney.onBoard', 'Time on board')} value={onBoard} />}
                    <InfoRow
                        icon="time-outline"
                        label={
                            schedule.departure.isPassengerStop
                                ? t('ongoingJourney.scheduledAtStop', 'Scheduled at {{stop}}', { stop: origin })
                                : t('ongoingJourney.tripDeparture', 'Trip departure (route start)')
                        }
                        value={schedule.departure.time ?? notAvailable}
                    />
                    <InfoRow
                        icon="time-outline"
                        label={
                            schedule.arrival.isPassengerStop
                                ? t('ongoingJourney.scheduledArrival', 'Scheduled arrival at {{stop}}', { stop: destination })
                                : t('ongoingJourney.tripArrival', 'Trip arrival (route end)')
                        }
                        value={schedule.arrival.time ?? notAvailable}
                    />
                    {!!schedule.durationLabel && (
                        <InfoRow icon="hourglass-outline" label={t('ongoingJourney.journeyTime', 'Scheduled journey time')} value={schedule.durationLabel} />
                    )}
                </View>

                {/* ---------------- Ticket ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="ticket-outline" title={t('ongoingJourney.ticket', 'Ticket')} />
                    <InfoRow icon="cash-outline" label={t('completedJourney.farePaid', 'Fare paid')} value={fare ?? notAvailable} />
                    <InfoRow icon="person-outline" label={t('ongoingJourney.seat', 'Seat')} value={seat || '—'} />
                    <InfoRow icon="barcode-outline" label={t('ongoingJourney.bookingId', 'Booking ID')} value={booking.bookingId} />
                </View>

                {/* ---------------- Stops ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="git-commit-outline" title={t('completedJourney.stops', 'Stops')} />
                    <RouteStopTimeline stops={stops} boardLabel={t('completedJourney.boarded', 'Start')} alightLabel={t('completedJourney.alighted', 'End')} />
                </View>

                <TouchableOpacity style={styles.secondaryButton} onPress={() => router.navigate('/activities')} accessibilityRole="button">
                    <Ionicons name="arrow-back" size={18} color="#0066CC" />
                    <Text style={styles.secondaryButtonText}>{t('completedJourney.backToActivities', 'Back to Activities')}</Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

function SectionHeading({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
    return (
        <View style={styles.sectionHeadingRow}>
            <Ionicons name={icon} size={16} color="#0F172A" />
            <Text style={styles.sectionHeadingText} accessibilityRole="header">
                {title}
            </Text>
        </View>
    );
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
    return (
        <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value}`}>
            <Ionicons name={icon} size={18} color="#0066CC" style={styles.infoIcon} />
            <View style={styles.infoText}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue}>{value}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    padded: {
        paddingHorizontal: 20,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 20,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    backButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'flex-start',
        marginRight: 4,
    },
    headerTitle: {
        flex: 1,
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.5,
    },
    stateContainer: {
        alignItems: 'center',
        paddingTop: 40,
        paddingHorizontal: 16,
    },
    stateTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        textAlign: 'center',
    },
    stateDescription: {
        fontSize: 14,
        color: '#475569',
        textAlign: 'center',
        marginTop: 10,
        marginBottom: 20,
        lineHeight: 20,
    },
    primaryButton: {
        minHeight: 48,
        backgroundColor: '#0066CC',
        paddingHorizontal: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
    },
    secondaryButton: {
        flexDirection: 'row',
        minHeight: 52,
        backgroundColor: '#EBF3FA',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    secondaryButtonText: {
        color: '#0066CC',
        fontWeight: '800',
        fontSize: 15,
    },
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
    statusPill: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        alignItems: 'center',
        backgroundColor: '#D1FAE5',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 6,
        marginBottom: 12,
    },
    statusPillText: {
        fontSize: 12,
        fontWeight: '900',
        color: '#065F46',
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    routeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        gap: 6,
    },
    routeBadgeText: {
        fontSize: 18,
        fontWeight: '900',
        color: '#FFFFFF',
    },
    identityText: {
        flex: 1,
    },
    identityJourney: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
    },
    identityRouteName: {
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
        marginTop: 2,
    },
    reasonText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#065F46',
        marginTop: 14,
        marginBottom: 4,
    },
    sectionHeadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 6,
    },
    sectionHeadingText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
    },
    infoIcon: {
        marginTop: 2,
        marginRight: 12,
    },
    infoText: {
        flex: 1,
    },
    infoLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
    },
    infoValue: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
        marginTop: 2,
    },
});
