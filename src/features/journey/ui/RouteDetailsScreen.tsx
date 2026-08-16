import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSelectedJourney } from '../store/selectedRouteStore';
import { listAccessibilityFacilities } from '../utils/accessibilityFacilities';
import { formatDurationBetween, formatFriendlyTime, parseApiTimeString } from '../utils/dateTime';
import { RouteMapCard } from './RouteMapCard';
import { RouteStopTimeline } from './RouteStopTimeline';

const NOT_AVAILABLE = 'Not available';

/**
 * Route Details (MOV-75).
 *
 * Everything shown here comes from the journey option the passenger selected on
 * the Recommended Routes screen — nothing about a specific route is hardcoded.
 */
export const RouteDetailsScreen = () => {
    const { routeId, tripId } = useLocalSearchParams<{ routeId?: string; tripId?: string }>();
    const held = useSelectedJourney();

    // The route and trip ids arrive as navigation params; the journey object
    // itself arrives in the selection store. If the two disagree the held
    // selection belongs to an earlier tap, so it is not shown as if it were
    // this one.
    const selection =
        held &&
        (!routeId || held.route.routeId === routeId) &&
        (!tripId || held.option.trip.tripId === tripId)
            ? held
            : null;

    // Reached without a matching selection (for example a deep link or a
    // reload), so there is nothing to describe. Send the passenger back rather
    // than inventing a route.
    if (!selection) {
        return (
            <View style={styles.container}>
                <Header />
                <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                    <View style={styles.stateIconBadge}>
                        <Ionicons name="bus-outline" size={32} color="#94A3B8" />
                    </View>
                    <Text style={styles.stateTitle}>No route selected</Text>
                    <Text style={styles.stateDescription}>
                        Choose a route from your search results to see its full details.
                    </Text>
                    <TouchableOpacity
                        style={styles.stateButton}
                        onPress={() => router.back()}
                        accessibilityRole="button"
                        accessibilityLabel="Back to results"
                    >
                        <Text style={styles.stateButtonText}>BACK TO RESULTS</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const { route, option, geo } = selection;
    const { trip, bus } = option;

    const departureLabel = formatFriendlyTime(parseApiTimeString(trip.departureTime));
    const arrivalLabel = formatFriendlyTime(parseApiTimeString(trip.estimatedArrivalTime));
    const duration = formatDurationBetween(trip.departureTime, trip.estimatedArrivalTime);

    const stopCount = route.journeyStops.length;
    const distanceLabel = route.distanceKm != null ? `${route.distanceKm} km` : null;
    const facilities = listAccessibilityFacilities(bus?.accessibilityFacilities);

    const handleBook = () =>
        router.push({
            pathname: '/booking/options',
            params: {
                routeId: route.routeId,
                origin: route.origin,
                destination: route.destination,
            },
        });

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <Header />

                {/* ---------------- Route summary ---------------- */}
                <View style={styles.summaryCard}>
                    <View style={styles.identityRow}>
                        <View style={styles.routeNumberBadge}>
                            <Text style={styles.routeNumberText}>{route.routeNumber}</Text>
                        </View>
                        <View style={styles.identityTextGroup}>
                            <Text style={styles.identityJourney}>
                                {route.origin} → {route.destination}
                            </Text>
                            <Text style={styles.identityRouteName} numberOfLines={2}>
                                {route.routeName}
                            </Text>
                        </View>
                    </View>

                    {/* Departure → arrival: the key decision information */}
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

                    <View style={styles.metaRow}>
                        <MetaItem
                            icon="time-outline"
                            label="Duration"
                            value={duration ?? NOT_AVAILABLE}
                        />
                        <MetaItem
                            icon="navigate-outline"
                            label="Route distance"
                            value={distanceLabel ?? NOT_AVAILABLE}
                        />
                        <MetaItem
                            icon="git-commit-outline"
                            label="Stops"
                            value={`${stopCount}`}
                        />
                    </View>
                </View>

                {/* ---------------- Map ---------------- */}
                <RouteMapCard
                    geo={geo}
                    originLabel={route.origin}
                    destinationLabel={route.destination}
                />

                {/* ---------------- Vehicle ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="bus-outline" title="Your bus" />

                    {bus ? (
                        <>
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

                            <View style={styles.detailGrid}>
                                <View style={styles.detailItem}>
                                    <Text style={styles.detailLabel}>Manufacturer</Text>
                                    <Text style={styles.detailValue}>
                                        {bus.manufacturer || NOT_AVAILABLE}
                                    </Text>
                                </View>
                                <View style={styles.detailItem}>
                                    <Text style={styles.detailLabel}>Seats</Text>
                                    <Text style={styles.detailValue}>
                                        {bus.seatCapacity != null ? bus.seatCapacity : NOT_AVAILABLE}
                                    </Text>
                                </View>
                            </View>
                        </>
                    ) : (
                        <Text style={styles.mutedText}>
                            Bus details are not available for this departure.
                        </Text>
                    )}
                </View>

                {/* ---------------- Stops ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="list-outline" title="Stops on your journey" />
                    <RouteStopTimeline stops={route.journeyStops} />
                </View>

                {/* ---------------- Accessibility ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="accessibility-outline" title="Accessibility" />

                    {facilities.length > 0 ? (
                        <>
                            <View style={styles.facilityWrap}>
                                {facilities.map((facility) => (
                                    <View
                                        key={facility.key}
                                        style={styles.facilityChip}
                                        accessible
                                        accessibilityLabel={`Available: ${facility.label}`}
                                    >
                                        <Ionicons
                                            name="checkmark-circle"
                                            size={14}
                                            color="#0F766E"
                                        />
                                        <Text style={styles.facilityChipText}>{facility.label}</Text>
                                    </View>
                                ))}
                            </View>
                            <Text style={styles.mutedFootnote}>
                                Only the facilities recorded for this bus are listed.
                            </Text>
                        </>
                    ) : (
                        <Text style={styles.mutedText}>
                            {bus
                                ? 'No accessibility facilities are recorded for this bus.'
                                : 'Accessibility details are not available for this departure.'}
                        </Text>
                    )}
                </View>

                {/* ---------------- Action ---------------- */}
                <TouchableOpacity
                    style={styles.bookButton}
                    onPress={handleBook}
                    accessibilityRole="button"
                    accessibilityLabel={`Book this trip on route ${route.routeNumber}`}
                >
                    <Ionicons name="ticket-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.bookButtonText}>Book this trip</Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
function Header() {
    return (
        <View style={styles.headerRow}>
            <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
            >
                <Ionicons name="arrow-back" size={24} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} accessibilityRole="header">
                Route Details
            </Text>
        </View>
    );
}

function SectionHeading({
    icon,
    title,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
}) {
    return (
        <View style={styles.sectionHeadingRow}>
            <Ionicons name={icon} size={16} color="#0F172A" />
            <Text style={styles.sectionHeadingText}>{title}</Text>
        </View>
    );
}

function MetaItem({
    icon,
    label,
    value,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
}) {
    return (
        <View style={styles.metaItem} accessible accessibilityLabel={`${label}: ${value}`}>
            <Ionicons name={icon} size={15} color="#64748B" />
            <Text style={styles.metaValue} numberOfLines={1}>
                {value}
            </Text>
            <Text style={styles.metaLabel} numberOfLines={1}>
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 32,
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
    summaryCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
    },

    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 18,
    },
    routeNumberBadge: {
        backgroundColor: '#EBF3FA',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginRight: 12,
    },
    routeNumberText: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0066CC',
        letterSpacing: 0.3,
    },
    identityTextGroup: {
        flex: 1,
    },
    identityJourney: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
    },
    identityRouteName: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 3,
    },

    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
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

    metaRow: {
        flexDirection: 'row',
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 8,
    },
    metaItem: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    metaValue: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
        marginTop: 5,
    },
    metaLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 2,
    },

    sectionHeadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    sectionHeadingText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
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
    detailGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 14,
    },
    detailItem: {
        width: '50%',
        marginBottom: 4,
    },
    detailLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        marginBottom: 2,
    },
    detailValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },

    facilityWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    facilityChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0FDFA',
        borderWidth: 1,
        borderColor: '#CCFBF1',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    facilityChipText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#0F766E',
        marginLeft: 5,
    },

    mutedText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 20,
    },
    mutedFootnote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#94A3B8',
        marginTop: 12,
        lineHeight: 17,
    },

    bookButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0066CC',
        minHeight: 54,
        borderRadius: 14,
        paddingHorizontal: 24,
        marginTop: 6,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 4,
    },
    bookButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
        marginLeft: 8,
    },

    stateContainer: {
        alignItems: 'center',
        paddingTop: 40,
        paddingHorizontal: 32,
    },
    stateIconBadge: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    stateTitle: {
        fontSize: 19,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 8,
        textAlign: 'center',
    },
    stateDescription: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 20,
        maxWidth: 320,
    },
    stateButton: {
        backgroundColor: '#0066CC',
        minHeight: 52,
        minWidth: 200,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    stateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
});
