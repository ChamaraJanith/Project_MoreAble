import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    JourneyGeoInformation,
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../entities/route/model/types';
import { accessibilityScoreColor } from '../../../shared/utils/accessibility';
import { setSelectedJourney } from '../store/selectedRouteStore';
import {
    buildJourneyLegs,
    describeJourneyForDisplay,
    JourneyDisplay,
} from '../utils/journeyRecommendations';
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
    const { trip, bus } = option;

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
            pathname: '/journey/route-details',
            params: { routeId: route.routeId, tripId: trip.tripId },
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

            {/* Departure → arrival: the most important information on the card */}
            <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                    <Text style={departureLabel ? styles.timeValue : styles.timeValueUnknown}>
                        {departureLabel ?? 'Not available'}
                    </Text>
                    <Text style={styles.timeCaption}>Departs {route.origin}</Text>
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
                    <Text style={styles.timeCaption}>Arrives {route.destination}</Text>
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
                        <Text style={styles.busPlateText} numberOfLines={1}>
                            {bus.numberPlate}
                        </Text>
                        <Text style={styles.busModelText} numberOfLines={1}>
                            {bus.busModel}
                        </Text>
                    </View>
                </View>
            ) : (
                <View style={styles.busRow}>
                    <View style={styles.busIconBadge}>
                        <Ionicons name="bus-outline" size={17} color="#94A3B8" />
                    </View>
                    <Text style={styles.busUnavailableText}>Bus details unavailable</Text>
                </View>
            )}

            {/* Footer: distance / stop count + book and details actions */}
            <View style={styles.footerRow}>
                <Text style={styles.footerMetaText}>
                    {distanceLabel ?? 'Distance N/A'}
                    {intermediateStops.length > 0 ? ` · ${intermediateStops.length} stops on the way` : ''}
                </Text>



                <TouchableOpacity
                    style={styles.bookButton}
                    onPress={() =>
                        router.push({
                            pathname: '/booking/options',
                            params: {
                                routeId: route.routeId,
                                origin: route.origin,
                                destination: route.destination,
                            },
                        })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Book this trip on route ${route.routeNumber}`}
                >
                    <Ionicons name="ticket-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.bookButtonText}>Book</Text>
                </TouchableOpacity>



                <TouchableOpacity
                    style={styles.detailsButton}
                    onPress={handleViewDetails}
                    accessibilityRole="button"
                    accessibilityLabel={`View details for route ${route.routeNumber}`}
                    accessibilityHint="Opens the full route details, including the map, stops and accessibility"
                >
                    <Text style={styles.detailsButtonText}>View details</Text>
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

    bookButton: {
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: '#0066CC', 
        minHeight: 40, borderRadius: 10, 
        paddingHorizontal: 14, 
        marginLeft: 10 },


    bookButtonText: { 
        color: '#fff', 
        fontWeight: '700', 
        fontSize: 13, 
        marginLeft: 6 },


});
