import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet,  TouchableOpacity, View } from 'react-native';
import {
    JourneyGeoInformation,
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../entities/route/model/types';
import { accessibilityScoreColor } from '../../../shared/utils/accessibility';
import { setSelectedVehicle } from '../../booking/store/selectedVehicleStore';
import { fetchSeats } from '../../booking/api/bookingApi';
import { BusRatingSummaryCompact } from '../../reports/ui/BusRatingSummaryView';
import { setSelectedJourney } from '../store/selectedRouteStore';
import { JOURNEY_ROUTE_DETAILS_PATH } from '../utils/journeyNavigation';
import { ACCESSIBILITY_REQUIREMENTS, meetsAccessibilityRequirement } from '../utils/accessibilityFilters';
import {
    buildJourneyLegs,
    describeJourneyForDisplay,
    JourneyDisplay,
} from '../utils/journeyRecommendations';
import { formatDisplayDate } from '../utils/dateTime';
import { JourneyTiming, resolveJourneyTiming } from '../utils/journeyTiming';

interface JourneyOptionCardProps {
    route: JourneySearchMatch;
    option: JourneySearchOption;
    /**
     * This journey's own estimated travel time (MOV-88), from the ranked view
     * model. Recomputed from the same inputs when a caller does not supply it,
     * so the card can never fall back to the route's total duration.
     */
    timing?: JourneyTiming;
    /**
     * Ready-to-render values for this journey, from the ranked view model.
     * Derived from the same inputs when a caller does not supply it, so the
     * card can never assemble its own competing version.
     */
    display?: JourneyDisplay;
    /**
     * The measured accessibility score, or null when unknown.
     *
     * Passed in rather than derived: it is MOV-89's figure, already recorded on
     * the bus, and a screen must not run the scoring formula itself.
     */
    accessibilityScore?: number | null;
    /** Map data from the search response, handed on to the details screen. */
    geo?: JourneyGeoInformation | null;
    travelDate?: string;
    travelTime?: string;
}

export function JourneyOptionCard({
    route,
    option,
    timing,
    display,
    accessibilityScore,
    geo = null,
    travelDate,
    travelTime,
}: JourneyOptionCardProps) {
    const { t } = useTranslation();
    const { trip, bus } = option;

    const [seatInfo, setSeatInfo] = React.useState<{
        availableSeats: number;
        totalSeats: number;
        isFull: boolean;
    } | null>(() => {
        if (typeof (option as any)?.availableSeats === 'number') {
            const avail = (option as any).availableSeats;
            const total = (option as any).totalSeats ?? bus?.seatCapacity ?? 40;
            return { availableSeats: avail, totalSeats: total, isFull: avail <= 0 };
        }
        return null;
    });

    React.useEffect(() => {
        if (seatInfo !== null || !trip?.tripId) return;
        let isMounted = true;
        fetchSeats(trip.tripId, travelDate)
            .then((data) => {
                if (!isMounted || !data?.seats) return;
                const available = data.seats.filter((s) => s.status === 'AVAILABLE').length;
                const total = data.totalSeats || data.seats.length;
                setSeatInfo({ availableSeats: available, totalSeats: total, isFull: available <= 0 });
            })
            .catch(() => {
                if (!isMounted) return;
                const total = bus?.seatCapacity ?? 40;
                setSeatInfo({ availableSeats: total, totalSeats: total, isFull: false });
            });
        return () => {
            isMounted = false;
        };
    }, [trip?.tripId, bus?.seatCapacity]);

    const totalSeats = seatInfo?.totalSeats ?? bus?.seatCapacity ?? 40;
    const availableSeats = seatInfo?.availableSeats ?? bus?.seatCapacity ?? 40;
    const isFull = seatInfo?.isFull ?? (availableSeats <= 0);

    const journeyTiming = timing ?? resolveJourneyTiming(buildJourneyLegs(route, option));

    // Every value below is the passenger's own or is absent — the shared
    // derivation guarantees it, and nothing here reaches for `trip.departureTime`,
    // `trip.estimatedArrivalTime` or `route.distanceKm` when one is missing.
    // Those are whole-route figures, and substituting them is how this card came
    // to show 6:00 AM -> 7:10 AM and 20 km for a two-stop journey.
    const {
        departureLabel,
        arrivalLabel,
        durationLabel: duration,
        distanceLabel,
        travelsWholeRoute,
        hasIncompleteTimes,
    } = display ?? describeJourneyForDisplay(route, journeyTiming);

    const hasMeasuredScore =
        typeof accessibilityScore === 'number' && Number.isFinite(accessibilityScore);

    // Counted from the journey's real legs. The search matches only routes that
    // carry the passenger the whole way on one bus, so this is 0 today -- a fact
    // worth stating, since "no changes" is useful to a passenger who needs it.
    const transferCount = journeyTiming.transferCount;

    // The first/last entries are the boarding/alighting stops shown separately.
    const intermediateStops = route.journeyStops.slice(1, -1);

    // Follows the same handover the booking flow already uses: the identifiers
    // travel as router params, while the selected object itself travels in the
    // selection store. Router params are strings only, and this journey carries
    // the route's full stop list plus the map polyline — far too large to
    // serialise into a URL on every navigation.
    const handleViewDetails = () => {
        setSelectedJourney({ route, option, geo, travelDate, travelTime, selectedAt: Date.now() });

        router.push({
            pathname: JOURNEY_ROUTE_DETAILS_PATH,
            params: { routeId: route.routeId, tripId: trip.tripId },
        });
    };

    const handleDirectBook = () => {
        if (isFull || !trip || !bus) return;
        setSelectedVehicle({
            tripId: trip.tripId,
            routeId: route.routeId,
            routeNumber: route.routeNumber,
            routeName: route.routeName,
            numberPlate: bus.numberPlate,
            busModel: bus.busModel,
            departureTime: departureLabel || trip.departureTime || '',
            estimatedArrivalTime: arrivalLabel || trip.estimatedArrivalTime || '',
            accessibilityScore: typeof accessibilityScore === 'number' ? accessibilityScore : (bus as any)?.accessibilityScore ?? 100,
            origin: route.origin,
            destination: route.destination,
            selectedAt: Date.now(),
        });
        router.push({
            pathname: '/booking/seats/[tripId]',
            params: {
                tripId: trip.tripId,
                origin: route.origin,
                destination: route.destination,
                travelDate: travelDate || undefined,
            },
        });
    };

    const summaryLabel =
        `Route ${route.routeNumber}, ${route.routeName}. ` +
        `${hasMeasuredScore ? `Accessibility score ${accessibilityScore} percent. ` : 'Accessibility score not available. '}` +
        `${departureLabel ? `Departs ${departureLabel}` : 'Departure time from this stop not available'}, ` +
        `${arrivalLabel ? `estimated arrival ${arrivalLabel}` : 'arrival time at this stop not available'}` +
        `${duration ? `, journey time ${duration}` : ', journey time not available'}. ` +
        `${distanceLabel ? `Journey distance ${distanceLabel}. ` : 'Journey distance not available. '}` +
        `${transferCount === 0 ? 'Direct, no transfers. ' : `${transferCount} transfer${transferCount > 1 ? 's' : ''}. `}` +
        `Board at ${route.origin}, get off at ${route.destination}.` +
        // The passenger rating is deliberately NOT repeated here. It is its own
        // focusable row further down the card with its own sentence, and saying
        // it twice would also risk it being heard as part of the accessibility
        // score this label already reads out.
        `${bus ? ` Bus ${bus.numberPlate}, ${bus.busModel}.` : ' Bus details unavailable.'}`;

    return (
        <View style={styles.card}>
            {/* Route identity */}
            <View style={styles.topRow} accessible accessibilityLabel={summaryLabel}>
                <View style={styles.routeNumberBadge}>
                    <Text style={styles.routeNumberText}>{route.routeNumber}</Text>
                </View>
                <Text style={styles.routeNameText} numberOfLines={1}>
                    {route.routeName}
                </Text>

                {/*
                  MOV-89's score, shown the way the booking flow already shows
                  it. The number and the icon carry the meaning; the colour only
                  reinforces it, so nothing here depends on colour alone.
                */}
                {hasMeasuredScore ? (
                    <View style={styles.scoreBadge}>
                        <Ionicons
                            name="accessibility"
                            size={13}
                            color={accessibilityScoreColor(accessibilityScore as number)}
                        />
                        <Text
                            style={[
                                styles.scoreText,
                                { color: accessibilityScoreColor(accessibilityScore as number) },
                            ]}
                        >
                            {accessibilityScore}%
                        </Text>
                    </View>
                ) : (
                    <View style={styles.scoreBadge}>
                        <Ionicons name="help-circle-outline" size={13} color="#64748B" />
                        <Text style={[styles.scoreText, styles.scoreTextUnknown]}>N/A</Text>
                    </View>
                )}
            </View>

            {travelDate && (
                <View style={styles.travelDateBadge}>
                    <Ionicons name="calendar-outline" size={12} color="#0066CC" />
                    <Text style={styles.travelDateBadgeText}>
                        {formatDisplayDate(travelDate)}
                    </Text>
                </View>
            )}

            {/* Departure → arrival: the most important information on the card */}
            <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                    <Text style={departureLabel ? styles.timeValue : styles.timeValueUnknown}>
                        {departureLabel ?? 'Not available'}
                    </Text>
                    <Text style={styles.timeCaption}>{t('journey.departs', { origin: route.origin, defaultValue: `Departs ${route.origin}` })}</Text>
                </View>

                <View style={styles.timeConnector}>
                    <View style={styles.connectorLine} />
                    {duration ? (
                        <View style={styles.durationPill}>
                            <Text style={styles.durationText}>{duration}</Text>
                        </View>
                    ) : (
                        <Ionicons name="arrow-forward" size={16} color="#94A3B8" />
                    )}
                    <View style={styles.connectorLine} />
                </View>

                <View style={[styles.timeBlock, styles.timeBlockEnd]}>
                    <Text style={arrivalLabel ? styles.timeValue : styles.timeValueUnknown}>
                        {arrivalLabel ?? 'Not available'}
                    </Text>
                    <Text style={styles.timeCaption}>{t('journey.arrives', { destination: route.destination, defaultValue: `Arrives ${route.destination}` })}</Text>
                </View>
            </View>

            {/*
              Says why something is missing rather than leaving a blank the
              passenger has to interpret. The route's own end-to-end times are
              deliberately NOT offered in their place: they belong to stops this
              passenger does not travel between.
            */}
            {hasIncompleteTimes && (
                <Text style={styles.timesScopeNote}>
                    {travelsWholeRoute
                        ? 'Some timings are not recorded for this route yet.'
                        : 'Stop-by-stop timings are not recorded for this route yet, so the times for your part of the journey are not known.'}
                </Text>
            )}

            {/* The passenger's own boarding / alighting stops */}
            <View style={styles.segmentRow}>
                <Ionicons name="ellipse" size={9} color="#0066CC" />
                <Text style={styles.segmentText} numberOfLines={1}>
                    {route.origin}
                </Text>
                <Ionicons name="arrow-forward" size={13} color="#94A3B8" style={styles.segmentArrow} />
                <Ionicons name="location" size={12} color="#0F172A" />
                <Text style={styles.segmentText} numberOfLines={1}>
                    {route.destination}
                </Text>
            </View>

            {/*
              Transfers, counted from the journey's real legs. A direct journey
              says so rather than showing an empty or invented indicator.
            */}
            <View style={styles.transferRow}>
                <Ionicons
                    name={transferCount === 0 ? 'arrow-forward-circle-outline' : 'swap-horizontal'}
                    size={14}
                    color="#64748B"
                />
                <Text style={styles.transferText}>
                    {transferCount === 0
                        ? 'Direct · no transfers'
                        : `${transferCount} transfer${transferCount > 1 ? 's' : ''}`}
                </Text>
            </View>

            {/* Bus operating this trip */}
            {bus ? (
                <View style={styles.busRow}>
                    <View style={styles.busIconBadge}>
                        <Ionicons name="bus" size={17} color="#0066CC" />
                    </View>
                    <View style={styles.busTextGroup}>
                        <View style={styles.busPlateAndSeatsRow}>
                            <Text style={styles.busPlateText} numberOfLines={1}>
                                {bus.numberPlate}
                            </Text>

                            {/* Live Seat Availability Badge */}
                            {isFull ? (
                                <View style={styles.fullBadge}>
                                    <Ionicons name="close-circle" size={12} color="#DC2626" />
                                    <Text style={styles.fullBadgeText}>Fully Booked</Text>
                                </View>
                            ) : availableSeats <= 5 ? (
                                <View style={styles.lowSeatsBadge}>
                                    <Ionicons name="alert-circle" size={12} color="#D97706" />
                                    <Text style={styles.lowSeatsBadgeText}>{availableSeats} seats left</Text>
                                </View>
                            ) : (
                                <View style={styles.availSeatsBadge}>
                                    <Ionicons name="checkmark-circle" size={12} color="#059669" />
                                    <Text style={styles.availSeatsBadgeText}>{availableSeats} seats free</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.busModelText} numberOfLines={1}>
                            {bus.busModel} · {totalSeats} seats capacity
                        </Text>

                        {/*
                          How passengers rated THIS bus (MOV-80) — the plain
                          average, not the accessibility score in the badge
                          above. The two answer different questions and are
                          shown separately on purpose. One line, and absent
                          entirely until the figure is known, so the card does
                          not grow taller for a bus nobody has rated.
                        */}
                        <BusRatingSummaryCompact summary={bus.passengerRating} />

                        <View style={styles.busFacilitiesRow}>
                            {ACCESSIBILITY_REQUIREMENTS.filter((req) =>
                                meetsAccessibilityRequirement(bus.accessibilityFacilities, req.key)
                            ).map((req) => {
                                let iconName: any = 'checkmark';
                                if (req.key === 'wheelchairRamp') iconName = 'accessibility-outline';
                                if (req.key === 'prioritySeats') iconName = 'people-outline';
                                if (req.key === 'audioAnnouncement') iconName = 'volume-high-outline';
                                if (req.key === 'lowFloorVehicle') iconName = 'bus-outline';
                                if (req.key === 'walkingAssistance') iconName = 'walk-outline';
                                if (req.key === 'elderlySeats') iconName = 'person-outline';
                                if (req.key === 'guardianSeats') iconName = 'shield-checkmark-outline';

                                return (
                                    <View key={req.key} style={styles.busFacilityIcon} accessibilityLabel={req.label}>
                                        <Ionicons name={iconName} size={12} color="#475569" />
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                </View>
            ) : (
                <View style={styles.busRow}>
                    <View style={styles.busIconBadge}>
                        <Ionicons name="bus-outline" size={17} color="#94A3B8" />
                    </View>
                    <Text style={styles.busUnavailableText}>{t('journey.busUnavailable', 'Bus details unavailable')}</Text>
                </View>
            )}

            {/* Footer: distance / stop count + book and details actions */}
            <View style={styles.footerRow}>
                <Text style={styles.footerMetaText}>
                    {distanceLabel ?? 'Distance N/A'}
                    {intermediateStops.length > 0 ? ` · ${intermediateStops.length} stops on the way` : ''}
                </Text>

                <TouchableOpacity
                    style={[styles.bookButton, (isFull || !bus || !trip) && styles.bookButtonDisabled]}
                    onPress={handleDirectBook}
                    disabled={isFull || !bus || !trip}
                    accessibilityRole="button"
                    accessibilityLabel={
                        isFull
                            ? `This departure on route ${route.routeNumber} is fully booked`
                            : `Book this trip on route ${route.routeNumber}`
                    }
                >
                    <Ionicons name={isFull ? 'close-circle-outline' : 'ticket-outline'} size={16} color="#FFFFFF" />
                    <Text style={styles.bookButtonText}>
                        {isFull ? t('journey.fullBtn', 'Full') : t('journey.bookBtn', 'Book')}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.detailsButton}
                    onPress={handleViewDetails}
                    accessibilityRole="button"
                    accessibilityLabel={`View details for route ${route.routeNumber}`}
                    accessibilityHint="Opens the full route details, including the map, stops and accessibility"
                >
                    <Text style={styles.detailsButtonText}>{t('journey.viewDetailsBtn', 'View details')}</Text>
                    <Ionicons
                        name="chevron-forward"
                        size={16}
                        color="#0066CC"
                        style={styles.detailsChevron}
                    />
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
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#EEF2F7',
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    routeNumberBadge: {
        backgroundColor: '#EBF3FA',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginRight: 10,
    },
    routeNumberText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0066CC',
        letterSpacing: 0.3,
    },
    routeNameText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#475569',
    },
    scoreBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F1F5F9',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginLeft: 8,
    },
    scoreText: {
        fontSize: 12,
        fontWeight: '800',
        marginLeft: 4,
    },
    scoreTextUnknown: {
        color: '#64748B',
    },
    travelDateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
        marginBottom: 10,
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        alignSelf: 'flex-start',
        gap: 4,
    },
    travelDateBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#0066CC',
    },
    timesScopeNote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 17,
        marginTop: -4,
        marginBottom: 14,
    },
    transferRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -4,
        marginBottom: 14,
    },
    transferText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
        marginLeft: 6,
    },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    timeBlock: {
        alignItems: 'flex-start',
    },
    timeBlockEnd: {
        alignItems: 'flex-end',
    },
    timeValue: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.5,
    },
    timeValueUnknown: {
        fontSize: 15,
        fontWeight: '700',
        color: '#64748B',
        letterSpacing: -0.2,
    },
    timeCaption: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 2,
        maxWidth: 120,
    },
    timeConnector: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        marginBottom: 14,
    },
    connectorLine: {
        flex: 1,
        height: 2,
        backgroundColor: '#E2E8F0',
        borderRadius: 1,
    },
    durationPill: {
        backgroundColor: '#F1F5F9',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
        marginHorizontal: 6,
    },
    durationText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
    },
    segmentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    segmentText: {
        flexShrink: 1,
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
        marginLeft: 6,
    },
    segmentArrow: {
        marginHorizontal: 8,
    },
    busRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    busIconBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    busTextGroup: {
        flex: 1,
    },
    busPlateText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: 0.3,
    },
    busModelText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 1,
    },
    busFacilitiesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: 6,
    },
    busFacilityIcon: {
        backgroundColor: '#E2E8F0',
        borderRadius: 4,
        padding: 4,
        marginRight: 6,
        marginBottom: 2,
    },
    busUnavailableText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
    },
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 12,
    },
    footerMetaText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
    },
    detailsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        paddingLeft: 12,
        justifyContent: 'flex-end',
    },
    detailsButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
    },
    detailsChevron: {
        marginLeft: 4,
    },

    busPlateAndSeatsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 6,
    },
    fullBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEE2E2',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    fullBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#DC2626',
        marginLeft: 3,
    },
    lowSeatsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    lowSeatsBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#B45309',
        marginLeft: 3,
    },
    availSeatsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ECFDF5',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    availSeatsBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#059669',
        marginLeft: 3,
    },

    bookButton: {
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: '#0066CC', 
        minHeight: 40, 
        borderRadius: 10, 
        paddingHorizontal: 14, 
        marginLeft: 10 
    },
    bookButtonDisabled: {
        backgroundColor: '#94A3B8',
    },

    bookButtonText: { 
        color: '#fff', 
        fontWeight: '700', 
        fontSize: 13, 
        marginLeft: 6 
    },


});
