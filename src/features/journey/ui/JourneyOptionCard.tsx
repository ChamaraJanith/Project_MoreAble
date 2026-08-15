import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BusAccessibilityFacilities } from '../../../entities/bus/model/types';
import { JourneySearchMatch, JourneySearchOption } from '../../../entities/route/model/types';
import { formatDurationBetween, formatFriendlyTime, parseApiTimeString } from '../utils/dateTime';

interface JourneyOptionCardProps {
    route: JourneySearchMatch;
    option: JourneySearchOption;
}

// Only facilities that are actually recorded on the bus are surfaced, as plain
// factual labels. No score, percentage or ranking is derived from them — that is
// a separate, future feature.
function listAccessibilityFeatures(facilities?: BusAccessibilityFacilities): string[] {
    if (!facilities) return [];

    const features: string[] = [];

    if (facilities.wheelchairRamp) features.push('Wheelchair ramp');
    if (facilities.lowFloorVehicle) features.push('Low floor');
    if (facilities.audioAnnouncement) features.push('Audio announcements');
    if (facilities.walkingAssistance) features.push('Walking assistance');

    const counted: [keyof BusAccessibilityFacilities, string][] = [
        ['wheelchairSpace', 'wheelchair space'],
        ['prioritySeats', 'priority seat'],
        ['elderlySeats', 'elderly seat'],
        ['guardianSeats', 'guardian seat'],
    ];

    for (const [key, label] of counted) {
        const facility = facilities[key];
        if (typeof facility === 'object' && facility?.available) {
            features.push(
                facility.count > 0 ? `${facility.count} ${label}${facility.count > 1 ? 's' : ''}` : label
            );
        }
    }

    return features;
}

export function JourneyOptionCard({ route, option }: JourneyOptionCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const { trip, bus } = option;

    const departureLabel = formatFriendlyTime(parseApiTimeString(trip.departureTime));
    const arrivalLabel = formatFriendlyTime(parseApiTimeString(trip.estimatedArrivalTime));
    const duration = formatDurationBetween(trip.departureTime, trip.estimatedArrivalTime);

    // The first/last entries are the boarding/alighting stops shown separately.
    const intermediateStops = route.journeyStops.slice(1, -1);
    const accessibilityFeatures = listAccessibilityFeatures(bus?.accessibilityFacilities);

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

            {/* Footer: distance / stop count + details toggle */}
            <View style={styles.footerRow}>
                <Text style={styles.footerMetaText}>
                    {route.distanceKm != null ? `${route.distanceKm} km` : 'Distance N/A'}
                    {intermediateStops.length > 0 ? ` · ${intermediateStops.length} stops on the way` : ''}
                </Text>



                <TouchableOpacity
                    style={styles.bookButton}
                    onPress={() => router.push({ pathname: '/booking', params: { routeId: route.routeId } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Book this trip on route ${route.routeNumber}`}
                >
                    <Ionicons name="ticket-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.bookButtonText}>Book</Text>
                </TouchableOpacity>



                <TouchableOpacity
                    style={styles.detailsButton}
                    onPress={() => setIsExpanded((previous) => !previous)}
                    accessibilityRole="button"
                    accessibilityLabel={isExpanded ? 'Hide journey details' : 'View journey details'}
                    accessibilityState={{ expanded: isExpanded }}
                    accessibilityHint="Double tap to show the full list of stops and bus information"
                >
                    <Text style={styles.detailsButtonText}>{isExpanded ? 'Hide details' : 'View details'}</Text>
                    <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="#0066CC"
                        style={styles.detailsChevron}
                    />
                </TouchableOpacity>
            </View>

            {isExpanded && (
                <View style={styles.expandedSection}>
                    <Text style={styles.expandedHeading}>Stops on your journey</Text>
                    <View style={styles.stopList}>
                        {route.journeyStops.map((stop, index) => {
                            const isFirst = index === 0;
                            const isLast = index === route.journeyStops.length - 1;

                            return (
                                <View key={`${stop}-${index}`} style={styles.stopItem}>
                                    <View style={styles.stopMarkerColumn}>
                                        <View style={[styles.stopDot, (isFirst || isLast) && styles.stopDotEndpoint]} />
                                        {!isLast && <View style={styles.stopLine} />}
                                    </View>
                                    <Text
                                        style={[styles.stopText, (isFirst || isLast) && styles.stopTextEndpoint]}
                                        numberOfLines={1}
                                    >
                                        {stop}
                                        {isFirst ? '  ·  Board here' : ''}
                                        {isLast ? '  ·  Get off here' : ''}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>

                    {bus && (
                        <>
                            <Text style={styles.expandedHeading}>Bus information</Text>
                            <View style={styles.busDetailGrid}>
                                <View style={styles.busDetailItem}>
                                    <Text style={styles.busDetailLabel}>Number plate</Text>
                                    <Text style={styles.busDetailValue}>{bus.numberPlate}</Text>
                                </View>
                                <View style={styles.busDetailItem}>
                                    <Text style={styles.busDetailLabel}>Model</Text>
                                    <Text style={styles.busDetailValue}>{bus.busModel}</Text>
                                </View>
                                <View style={styles.busDetailItem}>
                                    <Text style={styles.busDetailLabel}>Manufacturer</Text>
                                    <Text style={styles.busDetailValue}>{bus.manufacturer}</Text>
                                </View>
                                <View style={styles.busDetailItem}>
                                    <Text style={styles.busDetailLabel}>Seats</Text>
                                    <Text style={styles.busDetailValue}>{bus.seatCapacity}</Text>
                                </View>
                            </View>

                            {accessibilityFeatures.length > 0 && (
                                <>
                                    <Text style={styles.expandedHeading}>Onboard facilities</Text>
                                    <View style={styles.featureWrap}>
                                        {accessibilityFeatures.map((feature) => (
                                            <View key={feature} style={styles.featureChip}>
                                                <Ionicons name="checkmark-circle" size={13} color="#0F766E" />
                                                <Text style={styles.featureChipText}>{feature}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </>
                            )}
                        </>
                    )}
                </View>
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
    expandedSection: {
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: '#EEF2F7',
    },
    expandedHeading: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    stopList: {
        marginBottom: 16,
    },
    stopItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    stopMarkerColumn: {
        alignItems: 'center',
        width: 18,
    },
    stopDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#CBD5E1',
        marginTop: 5,
    },
    stopDotEndpoint: {
        backgroundColor: '#0066CC',
        width: 10,
        height: 10,
        borderRadius: 5,
        marginTop: 4,
    },
    stopLine: {
        width: 2,
        flex: 1,
        minHeight: 18,
        backgroundColor: '#E2E8F0',
        marginVertical: 2,
    },
    stopText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        color: '#475569',
        marginLeft: 10,
        paddingBottom: 10,
    },
    stopTextEndpoint: {
        fontWeight: '700',
        color: '#0F172A',
    },
    busDetailGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 6,
    },
    busDetailItem: {
        width: '50%',
        marginBottom: 12,
    },
    busDetailLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        marginBottom: 2,
    },
    busDetailValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },
    featureWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    featureChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0FDFA',
        borderWidth: 1,
        borderColor: '#CCFBF1',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    featureChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#0F766E',
        marginLeft: 5,
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
