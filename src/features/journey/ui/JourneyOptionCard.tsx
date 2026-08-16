import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    JourneyGeoInformation,
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../entities/route/model/types';
import { setSelectedJourney } from '../store/selectedRouteStore';
import { formatDurationBetween, formatFriendlyTime, parseApiTimeString } from '../utils/dateTime';

interface JourneyOptionCardProps {
    route: JourneySearchMatch;
    option: JourneySearchOption;
    /** Map data from the search response, handed on to the details screen. */
    geo?: JourneyGeoInformation | null;
    travelDate?: string;
    travelTime?: string;
}

export function JourneyOptionCard({
    route,
    option,
    geo = null,
    travelDate,
    travelTime,
}: JourneyOptionCardProps) {
    const { trip, bus } = option;

    const departureLabel = formatFriendlyTime(parseApiTimeString(trip.departureTime));
    const arrivalLabel = formatFriendlyTime(parseApiTimeString(trip.estimatedArrivalTime));
    const duration = formatDurationBetween(trip.departureTime, trip.estimatedArrivalTime);

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
        `Departs ${departureLabel}, estimated arrival ${arrivalLabel}` +
        `${duration ? `, journey time ${duration}` : ''}. ` +
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
            </View>

            {/* Departure → arrival: the most important information on the card */}
            <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                    <Text style={styles.timeValue}>{departureLabel}</Text>
                    <Text style={styles.timeCaption}>Departs</Text>
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
                    <Text style={styles.timeValue}>{arrivalLabel}</Text>
                    <Text style={styles.timeCaption}>Est. arrival</Text>
                </View>
            </View>

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
                    {route.distanceKm != null ? `${route.distanceKm} km` : 'Distance N/A'}
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
    timeCaption: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 2,
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
