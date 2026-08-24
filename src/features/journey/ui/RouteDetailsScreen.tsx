import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { searchJourneys } from '../api/journeySearchApi';
import { setSelectedJourney, useSelectedJourney } from '../store/selectedRouteStore';
import { listAccessibilityFacilities } from '../utils/accessibilityFacilities';
import { buildJourneyLegs, describeJourneyForDisplay } from '../utils/journeyRecommendations';
import { resolveJourneyTiming } from '../utils/journeyTiming';
import { formatLocationAge, resolveVehiclePosition } from '../utils/liveStatus';
import { resolveIntermediateStops } from '../utils/routeMapStops';
import { LiveStatusCard } from './LiveStatusCard';
import { RouteMapVehicle } from './RouteMap';
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

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshError, setRefreshError] = useState<string | null>(null);

    /**
     * Fetches this journey again so the bus position is current.
     *
     * The position on screen is a snapshot from the search that produced it —
     * there is no live feed — so this repeats that one search rather than
     * polling or calling a second endpoint, and only when the passenger asks.
     * The held selection is replaced with the same route and departure taken
     * from the fresh response, so every part of the screen stays consistent.
     */
    const handleRefresh = useCallback(async () => {
        if (!selection?.travelDate || !selection.travelTime) return;

        const { route, option, travelDate, travelTime } = selection;

        setIsRefreshing(true);
        setRefreshError(null);

        try {
            const response = await searchJourneys({
                origin: route.origin,
                destination: route.destination,
                travelDate,
                travelTime,
            });

            const freshRoute = response.routes?.find(
                (candidate) => candidate.routeId === route.routeId
            );
            const freshOption = freshRoute?.trips.find(
                (candidate) => candidate.trip.tripId === option.trip.tripId
            );

            // The departure has gone from the results. Keeping what is already
            // shown beats blanking the screen the passenger is reading.
            if (!freshRoute || !freshOption) {
                setRefreshError(
                    'This departure is no longer listed. The details below are from your earlier search.'
                );
                return;
            }

            setSelectedJourney({
                route: freshRoute,
                option: freshOption,
                geo: response.geo ?? null,
                travelDate,
                travelTime,
                selectedAt: Date.now(),
            });
        } catch {
            setRefreshError('Could not refresh the bus location. Please try again.');
        } finally {
            setIsRefreshing(false);
        }
    }, [selection]);

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
    const { bus } = option;

    // The same passenger-journey timing the results card shows, from the same
    // function on the same data (MOV-88) — so the duration a passenger chose a
    // route by does not change when they open its details. Boarding and
    // alighting times are theirs when the route's configured stop-to-stop
    // timings can place them; otherwise the trip's own whole-route times stand
    // in and are labelled as such below.
    const journeyTiming = resolveJourneyTiming(buildJourneyLegs(route, option));

    // The same derivation the results card uses, so a passenger who picked a
    // journey by its duration sees that same duration here. Nothing falls back
    // to the trip's or the route's own whole-route figures: on a
    // Kaduwela -> Malabe journey the trip's arrival is when the bus reaches
    // Kollupitiya and `route.distanceKm` is the full 20 km, neither of which
    // this passenger travels.
    const {
        departureLabel,
        arrivalLabel,
        durationLabel: duration,
        distanceLabel,
        stopCount,
        travelsWholeRoute,
        hasIncompleteTimes,
    } = describeJourneyForDisplay(route, journeyTiming);
    const facilities = listAccessibilityFacilities(bus?.accessibilityFacilities);
    const mapStops = resolveIntermediateStops(route.journeyStops, geo);

    // The live vehicle (MOV-119). Optional-chained because a selection held from
    // an earlier response may predate the live block entirely; a departure with
    // no usable position simply gets no marker.
    const liveStatus = option.liveStatus;
    const vehiclePosition = resolveVehiclePosition(liveStatus);
    const locationAgeLabel = formatLocationAge(liveStatus?.locationAgeSeconds);

    const mapVehicle: RouteMapVehicle | null = vehiclePosition
        ? {
              ...vehiclePosition,
              title: `Route ${route.routeNumber}`,
              subtitle: bus?.numberPlate,
              updatedLabel: locationAgeLabel ?? undefined,
          }
        : null;

    const canRefresh = !!(selection.travelDate && selection.travelTime);


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
                            <Text style={departureLabel ? styles.timeValue : styles.timeValueUnknown}>
                                {departureLabel ?? NOT_AVAILABLE}
                            </Text>
                            <Text style={styles.timeCaption} numberOfLines={2}>
                                Departs {route.origin}
                            </Text>
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
                                {arrivalLabel ?? NOT_AVAILABLE}
                            </Text>
                            <Text
                                style={[styles.timeCaption, styles.timeCaptionEnd]}
                                numberOfLines={2}
                            >
                                Arrives {route.destination}
                            </Text>
                        </View>
                    </View>

                    {hasIncompleteTimes && (
                        <Text style={styles.timesScopeNote}>
                            {travelsWholeRoute
                                ? 'Some timings are not recorded for this route yet.'
                                : `Stop-by-stop timings are not recorded for this route yet, so the times for ${route.origin} to ${route.destination} are not known. The route's own end-to-end times are not shown here because they cover stops beyond your journey.`}
                        </Text>
                    )}

                    <View style={styles.metaRow}>
                        <MetaItem
                            icon="time-outline"
                            label="Your journey"
                            value={duration ?? NOT_AVAILABLE}
                        />
                        <MetaItem
                            icon="navigate-outline"
                            label={travelsWholeRoute ? 'Route distance' : 'Journey distance'}
                            value={distanceLabel ?? NOT_AVAILABLE}
                        />
                        <MetaItem
                            icon="git-commit-outline"
                            label="Stops"
                            value={`${stopCount}`}
                        />
                    </View>
                </View>

                {/* ---------------- Live status ---------------- */}
                {/* Directly under the scheduled times and directly above the
                    map: the passenger reads the timetable, then whether the bus
                    is actually reporting, then where it is. */}
                <LiveStatusCard
                    liveStatus={liveStatus}
                    numberPlate={bus?.numberPlate}
                    onRefresh={canRefresh ? handleRefresh : undefined}
                    isRefreshing={isRefreshing}
                    refreshError={refreshError}
                />

                {/* ---------------- Map ---------------- */}
                <RouteMapCard
                    geo={geo}
                    stops={mapStops.stops}
                    unmappedStopCount={mapStops.unmappedCount}
                    road={route.road}
                    vehicle={mapVehicle}
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
    timeValueUnknown: {
        fontSize: 15,
        fontWeight: '700',
        color: '#64748B',
        letterSpacing: -0.2,
    },
    timeCaptionEnd: {
        textAlign: 'right',
    },
    timesScopeNote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 17,
        marginTop: -4,
        marginBottom: 12,
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
