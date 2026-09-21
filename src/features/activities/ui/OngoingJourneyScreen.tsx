import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../shared/store/authStore';
import { AppText as Text } from '../../../shared/ui/AppText';
import { VEHICLE_MARKER_COLOR } from '../../../shared/ui/mapTheme';
import { RouteMapVehicle } from '../../journey/ui/RouteMap';
import { RouteMapCard } from '../../journey/ui/RouteMapCard';
import { RouteStopTimeline } from '../../journey/ui/RouteStopTimeline';
import { formatLocationAge } from '../../journey/utils/liveStatus';
import { useOngoingJourneyTracking } from '../hooks/useOngoingJourneyTracking';
import {
    buildOngoingMapData,
    computeJourneyProgress,
    describeBusPosition,
    describeOngoingSchedule,
    formatClockTime,
    formatOngoingFare,
    liveVehicleFor,
    upcomingStops,
} from '../utils/ongoingJourneyTracking';

const LIVE_MAP_HEIGHT = 340;

/** How many upcoming stops the summary lists; the full list is in the timeline. */
const UPCOMING_PREVIEW_COUNT = 3;

function goToActivities() {
    if (router.canGoBack()) router.back();
    else router.replace('/activities');
}

/**
 * Live Journey (MOV-297): Activities > Ongoing > View Journey.
 *
 * The passenger's journey as it happens — where the bus is along the planned
 * road, which stops are behind and ahead, and the trip's scheduled details.
 * It is not the ticket: Booking > View Ticket keeps that role, unchanged.
 *
 * Everything comes from GET /api/journeys/ongoing (MOV-295/MOV-296). The
 * booking id in the URL only picks which of the passenger's own authorised
 * journeys to show; it is never sent to the server.
 */
export function OngoingJourneyScreen() {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
    const token = useAuthStore((store) => store.token);

    const { state, refreshing, refresh } = useOngoingJourneyTracking(bookingId, token);
    const [focusRequest, setFocusRequest] = useState(0);

    const { phase, journey, route, connectionLost } = state;

    // React Compiler (app.json) memoises these: the static path is rebuilt only
    // when a route arrives, and the bus only when a new position does, so a
    // live update moves the marker without redrawing the road or the stops.
    const mapData = buildOngoingMapData(route);

    // The bus, only while the journey is live and updating.
    const vehiclePosition = liveVehicleFor(state);
    const updatedLabel = vehiclePosition ? formatLocationAge(journey?.liveStatus?.locationAgeSeconds) : null;
    const routeNumber = journey?.booking.journey?.routeNumber;
    const vehicle: RouteMapVehicle | null = vehiclePosition
        ? {
              ...vehiclePosition,
              title: routeNumber ? `Route ${routeNumber}` : 'Your bus',
              subtitle: journey?.booking.vehicle?.numberPlate,
              updatedLabel: updatedLabel ?? undefined,
          }
        : null;

    const progress = computeJourneyProgress(route, vehiclePosition);
    const schedule = describeOngoingSchedule(journey, route);

    const header = (
        <View style={styles.headerRow}>
            <TouchableOpacity
                style={styles.backButton}
                onPress={goToActivities}
                accessibilityRole="button"
                accessibilityLabel={t('ongoingJourney.back', 'Back to Activities')}
            >
                <Ionicons name="arrow-back" size={24} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} accessibilityRole="header">
                {t('ongoingJourney.title', 'Live Journey')}
            </Text>
        </View>
    );

    const containerPadding = {
        paddingTop: insets.top > 0 ? insets.top + 10 : 20,
        paddingBottom: insets.bottom > 0 ? insets.bottom + 32 : 32,
    };

    if (phase === 'LOADING') {
        return (
            <View style={[styles.container, containerPadding, styles.padded]}>
                {header}
                <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color="#0066CC" />
                    <Text style={styles.stateDescription}>
                        {t('ongoingJourney.loading', 'Finding your bus...')}
                    </Text>
                </View>
            </View>
        );
    }

    if (phase !== 'ACTIVE' && phase !== 'ENDED') {
        const content = {
            NOT_FOUND: {
                icon: 'bus-outline' as const,
                title: t('ongoingJourney.notFoundTitle', 'No ongoing journey'),
                body: t(
                    'ongoingJourney.notFoundDesc',
                    'This journey is not running right now. It may not have started yet, or it has already ended.'
                ),
                action: t('ongoingJourney.backToActivities', 'BACK TO ACTIVITIES'),
                onPress: goToActivities,
            },
            UNAUTHORIZED: {
                icon: 'lock-closed' as const,
                title: t('ongoingJourney.signInTitle', 'Please sign in again'),
                body: t(
                    'ongoingJourney.signInDesc',
                    'Sign in with your passenger account to follow your journey.'
                ),
                action: t('activities.goToSignIn', 'GO TO SIGN IN'),
                onPress: () => router.replace('/(auth)'),
            },
            ERROR: {
                icon: 'cloud-offline-outline' as const,
                title: t('ongoingJourney.errorTitle', 'Unable to load your journey'),
                body: t('ongoingJourney.errorDesc', 'Please check your connection and try again.'),
                action: t('activities.retryBtn', 'RETRY'),
                onPress: refresh,
            },
        }[phase];

        return (
            <View style={[styles.container, containerPadding, styles.padded]}>
                {header}
                <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                    <View style={styles.stateIconBadge}>
                        <Ionicons name={content.icon} size={32} color="#64748B" />
                    </View>
                    <Text style={styles.stateTitle}>{content.title}</Text>
                    <Text style={styles.stateDescription}>{content.body}</Text>
                    <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={content.onPress}
                        disabled={refreshing}
                        accessibilityRole="button"
                        accessibilityState={{ busy: refreshing }}
                    >
                        {refreshing ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <Text style={styles.primaryButtonText}>{content.action}</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // ACTIVE or ENDED: the journey is known.
    const booking = journey!.booking;
    const origin = booking.journey?.startLocation || '—';
    const destination = booking.journey?.endLocation || '—';
    const routeName = booking.journey?.routeName && booking.journey.routeName !== '—' ? booking.journey.routeName : '';
    const isEnded = phase === 'ENDED';
    const isLive = !!vehicle;
    const positionSentence = describeBusPosition(phase, vehiclePosition, progress, connectionLost);
    const fare = formatOngoingFare(journey);
    const startedAt = formatClockTime(journey!.activeJourney.startedAt);
    const ahead = upcomingStops(route, progress);
    const journeyStops = route?.journeyStops ?? [origin, destination];
    const seat = booking.pairedSeatNumber
        ? `${booking.seatNumber} + ${booking.pairedSeatNumber}`
        : booking.seatNumber;
    const busDetails = [booking.vehicle?.busModel, booking.vehicle?.manufacturer].filter(Boolean).join(' · ');
    const progressPercent = progress ? Math.round(progress.fraction * 100) : null;

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={[styles.scrollContent, containerPadding]}
                showsVerticalScrollIndicator={false}
            >
                {header}

                {/* ---------------- Live status ---------------- */}
                <View
                    style={[
                        styles.statusCard,
                        isEnded ? styles.statusCardEnded : isLive ? styles.statusCardLive : styles.statusCardIdle,
                    ]}
                >
                    <View style={styles.statusTopRow}>
                        <View
                            style={[
                                styles.statusPill,
                                isEnded ? styles.statusPillEnded : isLive ? styles.statusPillLive : styles.statusPillIdle,
                            ]}
                        >
                            <Ionicons
                                name={isEnded ? 'flag' : isLive ? 'radio-button-on' : 'cloud-offline-outline'}
                                size={13}
                                color={isEnded ? '#334155' : isLive ? '#FFFFFF' : '#475569'}
                            />
                            <Text
                                style={[
                                    styles.statusPillText,
                                    isEnded ? styles.statusPillTextEnded : isLive ? styles.statusPillTextLive : styles.statusPillTextIdle,
                                ]}
                            >
                                {isEnded
                                    ? t('ongoingJourney.ended', 'Journey ended')
                                    : isLive
                                      ? t('ongoingJourney.live', 'LIVE')
                                      : t('ongoingJourney.ongoing', 'Ongoing')}
                            </Text>
                        </View>

                        {!isEnded && (
                            <TouchableOpacity
                                style={styles.refreshButton}
                                onPress={refresh}
                                disabled={refreshing}
                                accessibilityRole="button"
                                accessibilityLabel={t('ongoingJourney.refresh', 'Refresh bus location')}
                                accessibilityState={{ disabled: refreshing, busy: refreshing }}
                            >
                                {refreshing ? (
                                    <ActivityIndicator size="small" color="#0066CC" />
                                ) : (
                                    <>
                                        <Ionicons name="refresh" size={16} color="#0066CC" />
                                        <Text style={styles.refreshText}>{t('ongoingJourney.refreshShort', 'Refresh')}</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Grouped on its own, so the buttons around it stay reachable
                        and a change of position is announced. */}
                    <View
                        accessible
                        accessibilityLiveRegion="polite"
                        accessibilityLabel={[positionSentence, updatedLabel].filter(Boolean).join('. ')}
                    >
                        <Text style={styles.statusSentence}>{positionSentence}</Text>
                        {!!updatedLabel && <Text style={styles.statusDetail}>{updatedLabel}</Text>}
                    </View>
                    {!isEnded && (
                        <Text style={styles.statusDetail}>
                            {t('ongoingJourney.autoUpdate', 'The bus location updates automatically while this screen is open.')}
                        </Text>
                    )}

                    {isEnded && (
                        <TouchableOpacity
                            style={[styles.primaryButton, styles.endedButton]}
                            onPress={goToActivities}
                            accessibilityRole="button"
                        >
                            <Text style={styles.primaryButtonText}>
                                {t('ongoingJourney.backToActivities', 'BACK TO ACTIVITIES')}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* ---------------- Route and bus ---------------- */}
                <View style={styles.card}>
                    <View style={styles.identityRow}>
                        <View style={styles.routeBadge}>
                            <Ionicons name="bus" size={16} color="#FFFFFF" />
                            <Text style={styles.routeBadgeText}>{booking.journey?.routeNumber || '—'}</Text>
                        </View>
                        <View style={styles.identityText}>
                            <Text style={styles.identityJourney}>
                                {origin} → {destination}
                            </Text>
                            {!!routeName && (
                                <Text style={styles.identityRouteName} numberOfLines={2}>
                                    {routeName}
                                </Text>
                            )}
                        </View>
                    </View>

                    {!!booking.vehicle?.numberPlate && (
                        <View style={styles.busRow}>
                            <Ionicons name="bus-outline" size={18} color="#0066CC" />
                            <Text style={styles.busPlate}>{booking.vehicle.numberPlate}</Text>
                            {!!busDetails && <Text style={styles.busDetails}>{busDetails}</Text>}
                        </View>
                    )}
                </View>

                {/* ---------------- Live map ---------------- */}
                <RouteMapCard
                    title={t('ongoingJourney.mapTitle', 'Live map')}
                    geo={mapData?.geo}
                    stops={mapData?.stops}
                    unmappedStopCount={mapData?.unmappedStopCount}
                    road={mapData?.road}
                    vehicle={vehicle}
                    vehicleFocusRequest={focusRequest}
                    originLabel={origin}
                    destinationLabel={destination}
                    mapHeight={LIVE_MAP_HEIGHT}
                />
                {isLive && (
                    <TouchableOpacity
                        style={styles.centerButton}
                        onPress={() => setFocusRequest((count) => count + 1)}
                        accessibilityRole="button"
                        accessibilityLabel={t('ongoingJourney.centerOnBusLabel', 'Center the map on your bus')}
                    >
                        <Ionicons name="locate" size={18} color="#FFFFFF" />
                        <Text style={styles.centerButtonText}>{t('ongoingJourney.centerOnBus', 'Center on bus')}</Text>
                    </TouchableOpacity>
                )}

                {/* ---------------- Progress ---------------- */}
                {!isEnded && (
                    <View style={styles.card}>
                        <SectionHeading icon="trending-up-outline" title={t('ongoingJourney.progress', 'Journey progress')} />
                        {progressPercent !== null ? (
                            <>
                                <View
                                    style={styles.progressTrack}
                                    accessible
                                    accessibilityRole="progressbar"
                                    accessibilityLabel={t('ongoingJourney.progressLabel', 'Distance covered on your journey')}
                                    accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}%` }}
                                >
                                    <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                                </View>
                                <Text style={styles.progressText}>
                                    {t('ongoingJourney.progressValue', '{{percent}}% of the way from {{origin}} to {{destination}}', {
                                        percent: progressPercent,
                                        origin,
                                        destination,
                                    })}
                                </Text>
                                {!!progress?.currentStop && (
                                    <InfoRow icon="location" label={t('ongoingJourney.currentStop', 'Bus is at')} value={progress.currentStop} />
                                )}
                                {!!progress?.nextStop && (
                                    <InfoRow icon="arrow-forward-circle-outline" label={t('ongoingJourney.nextStop', 'Next stop')} value={progress.nextStop} />
                                )}
                            </>
                        ) : (
                            <Text style={styles.mutedText}>
                                {isLive
                                    ? t(
                                          'ongoingJourney.progressUnknown',
                                          'Progress is shown once the bus is on your part of the route.'
                                      )
                                    : t(
                                          'ongoingJourney.progressNeedsLive',
                                          'Progress is shown while the bus is sharing its live location.'
                                      )}
                            </Text>
                        )}
                    </View>
                )}

                {/* ---------------- Journey information ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="information-circle-outline" title={t('ongoingJourney.details', 'Journey information')} />
                    <InfoRow icon="radio-button-on" label={t('ongoingJourney.from', 'From')} value={origin} />
                    <InfoRow icon="location" label={t('ongoingJourney.to', 'To')} value={destination} />
                    <InfoRow
                        icon="time-outline"
                        label={
                            schedule.departure.isPassengerStop
                                ? t('ongoingJourney.scheduledAtStop', 'Scheduled at {{stop}}', { stop: origin })
                                : t('ongoingJourney.tripDeparture', 'Trip departure (route start)')
                        }
                        value={schedule.departure.time ?? t('ongoingJourney.notAvailable', 'Not available')}
                    />
                    <InfoRow
                        icon="flag-outline"
                        label={
                            schedule.arrival.isPassengerStop
                                ? t('ongoingJourney.scheduledArrival', 'Scheduled arrival at {{stop}}', { stop: destination })
                                : t('ongoingJourney.tripArrival', 'Trip arrival (route end)')
                        }
                        value={schedule.arrival.time ?? t('ongoingJourney.notAvailable', 'Not available')}
                    />
                    {!!schedule.durationLabel && (
                        <InfoRow
                            icon="hourglass-outline"
                            label={t('ongoingJourney.journeyTime', 'Scheduled journey time')}
                            value={schedule.durationLabel}
                        />
                    )}
                    {!!startedAt && (
                        <InfoRow icon="play-circle-outline" label={t('ongoingJourney.startedAt', 'Bus started the journey')} value={startedAt} />
                    )}
                    <Text style={styles.footnote}>
                        {t(
                            'ongoingJourney.scheduleNote',
                            'Times are from the timetable. A live arrival estimate is not available yet.'
                        )}
                    </Text>
                </View>

                {/* ---------------- Ticket ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="ticket-outline" title={t('ongoingJourney.ticket', 'Ticket')} />
                    <InfoRow
                        icon="cash-outline"
                        label={t('ongoingJourney.fare', 'Ticket price')}
                        value={fare ?? t('ongoingJourney.notAvailable', 'Not available')}
                    />
                    <InfoRow icon="person-outline" label={t('ongoingJourney.seat', 'Seat')} value={seat || '—'} />
                    <InfoRow icon="barcode-outline" label={t('ongoingJourney.bookingId', 'Booking ID')} value={booking.bookingId} />
                    <InfoRow
                        icon={booking.boardingStatus === 'BOARDED' ? 'checkmark-circle-outline' : 'ellipse-outline'}
                        label={t('ongoingJourney.boarding', 'Boarding')}
                        value={
                            booking.boardingStatus === 'BOARDED'
                                ? t('ongoingJourney.boarded', 'Boarded')
                                : t('ongoingJourney.notBoarded', 'Not boarded yet')
                        }
                    />
                </View>

                {/* ---------------- Stops ---------------- */}
                {!isEnded && ahead.length > 0 && (
                    <View style={styles.card}>
                        <SectionHeading icon="list-outline" title={t('ongoingJourney.upcoming', 'Upcoming stops')} />
                        {ahead.slice(0, UPCOMING_PREVIEW_COUNT).map((stop, index) => (
                            <View
                                key={`${stop}-${index}`}
                                style={styles.upcomingRow}
                                accessible
                                accessibilityLabel={`${index + 1}. ${stop}`}
                            >
                                <View style={styles.upcomingIndex}>
                                    <Text style={styles.upcomingIndexText}>{index + 1}</Text>
                                </View>
                                <Text style={styles.upcomingText}>{stop}</Text>
                            </View>
                        ))}
                        {ahead.length > UPCOMING_PREVIEW_COUNT && (
                            <Text style={styles.mutedText}>
                                {t('ongoingJourney.moreStops', '+{{count}} more before your stop', {
                                    count: ahead.length - UPCOMING_PREVIEW_COUNT,
                                })}
                            </Text>
                        )}
                    </View>
                )}

                <View style={styles.card}>
                    <SectionHeading icon="git-commit-outline" title={t('ongoingJourney.stops', 'Your stops')} />
                    <RouteStopTimeline
                        stops={journeyStops}
                        stopStates={isEnded ? null : progress?.stopStates}
                    />
                    {!route && (
                        <Text style={styles.mutedText}>
                            {t('ongoingJourney.stopsUnavailable', 'The stops in between could not be loaded right now.')}
                        </Text>
                    )}
                </View>
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
    stateIconBadge: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#E2E8F0',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
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

    statusCard: {
        borderRadius: 20,
        padding: 18,
        marginBottom: 14,
        borderWidth: 1,
    },
    statusCardLive: {
        backgroundColor: '#ECFDF5',
        borderColor: '#A7F3D0',
    },
    statusCardIdle: {
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
    },
    statusCardEnded: {
        backgroundColor: '#F1F5F9',
        borderColor: '#CBD5E1',
    },
    statusTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 6,
    },
    statusPillLive: {
        backgroundColor: VEHICLE_MARKER_COLOR,
    },
    statusPillIdle: {
        backgroundColor: '#E2E8F0',
    },
    statusPillEnded: {
        backgroundColor: '#CBD5E1',
    },
    statusPillText: {
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    statusPillTextLive: {
        color: '#FFFFFF',
    },
    statusPillTextIdle: {
        color: '#475569',
    },
    statusPillTextEnded: {
        color: '#334155',
    },
    refreshButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        minHeight: 44,
        minWidth: 88,
        gap: 5,
    },
    refreshText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
    },
    statusSentence: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
        lineHeight: 23,
    },
    statusDetail: {
        fontSize: 13,
        fontWeight: '500',
        color: '#475569',
        marginTop: 4,
        lineHeight: 18,
    },
    endedButton: {
        marginTop: 14,
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
    busRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1.5,
        borderTopColor: '#F1F5F9',
        gap: 8,
    },
    busPlate: {
        fontSize: 16,
        fontWeight: '900',
        color: '#0F172A',
    },
    busDetails: {
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
    },

    centerButton: {
        flexDirection: 'row',
        alignSelf: 'flex-end',
        alignItems: 'center',
        minHeight: 44,
        backgroundColor: VEHICLE_MARKER_COLOR,
        paddingHorizontal: 16,
        borderRadius: 12,
        gap: 8,
        marginTop: -4,
        marginBottom: 14,
    },
    centerButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
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

    progressTrack: {
        height: 14,
        borderRadius: 7,
        backgroundColor: '#E2E8F0',
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 7,
        backgroundColor: VEHICLE_MARKER_COLOR,
    },
    progressText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1E293B',
        marginTop: 8,
        marginBottom: 4,
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

    upcomingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        gap: 12,
    },
    upcomingIndex: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
    },
    upcomingIndexText: {
        fontSize: 13,
        fontWeight: '900',
        color: '#0066CC',
    },
    upcomingText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '700',
        color: '#1E293B',
    },

    mutedText: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 19,
        marginTop: 4,
    },
    footnote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 8,
        lineHeight: 17,
    },
});
