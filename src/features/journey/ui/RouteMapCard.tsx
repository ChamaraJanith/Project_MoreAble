import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GeoPoint, JourneyGeoInformation } from '../../../entities/route/model/types';
import { RouteMap, RouteMapStop } from './RouteMap';

interface RouteMapCardProps {
    /** Geographic data from the Journey Search response; may be absent. */
    geo?: JourneyGeoInformation | null;
    /** Intermediate stops with coordinates, when the data provides them. */
    stops?: RouteMapStop[];
    originLabel: string;
    destinationLabel: string;
}

const MAP_HEIGHT = 260;

function hasCoordinates(point?: GeoPoint): point is GeoPoint {
    return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

/**
 * The route map section of the Route Details screen.
 *
 * Presents the interactive map inside the screen's standard card, along with the
 * endpoint key, the road figures and the required OpenStreetMap attribution.
 * The geographic services are best-effort by design, so when the journey could
 * not be resolved this explains that instead of showing a broken map — the rest
 * of the screen is unaffected either way.
 */
export function RouteMapCard({
    geo,
    stops = [],
    originLabel,
    destinationLabel,
}: RouteMapCardProps) {
    const origin = geo?.origin;
    const destination = geo?.destination;
    const road = geo?.road;

    const canRenderMap = hasCoordinates(origin) && hasCoordinates(destination);
    const hasRoadPath = !!road?.geometry?.coordinates?.length;

    return (
        <View style={styles.card}>
            <View style={styles.headingRow}>
                <Ionicons name="map-outline" size={16} color="#0F172A" />
                <Text style={styles.heading}>Route map</Text>
            </View>

            <View style={styles.mapFrame}>
                {canRenderMap ? (
                    <RouteMap
                        origin={origin}
                        destination={destination}
                        stops={stops}
                        geometry={road?.geometry}
                        originLabel={originLabel}
                        destinationLabel={destinationLabel}
                        height={MAP_HEIGHT}
                    />
                ) : (
                    <View style={[styles.placeholder, { height: MAP_HEIGHT }]}>
                        <Ionicons name="map-outline" size={30} color="#94A3B8" />
                        <Text style={styles.placeholderText}>
                            {geo?.message ||
                                'Map information is currently unavailable for this journey.'}
                        </Text>
                    </View>
                )}
            </View>

            {/* Endpoint key: shape and wording, never colour alone */}
            {canRenderMap && (
                <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                        <View style={styles.legendStartDot} />
                        <Text style={styles.legendText} numberOfLines={1}>
                            {originLabel}
                        </Text>
                    </View>
                    <View style={styles.legendItem}>
                        <View style={styles.legendEndSquare} />
                        <Text style={styles.legendText} numberOfLines={1}>
                            {destinationLabel}
                        </Text>
                    </View>
                    {stops.length > 0 && (
                        <View style={styles.legendItem}>
                            <View style={styles.legendStopDot} />
                            <Text style={styles.legendText} numberOfLines={1}>
                                Stops on the way
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {road && (
                <Text style={styles.footnote}>
                    Road distance {road.distanceKm} km · about {road.durationMinutes} min by road.
                    Scheduled times are shown above.
                </Text>
            )}

            {canRenderMap && !hasRoadPath && (
                <Text style={styles.footnote}>
                    The detailed road path is unavailable, so only the start and end points are
                    marked.
                </Text>
            )}

            {canRenderMap && (
                <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
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
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    mapFrame: {
        borderRadius: 14,
        backgroundColor: '#EAF1F8',
        borderWidth: 1,
        borderColor: '#DCE7F1',
        // Clips the map's square corners to the card's rounded frame.
        overflow: 'hidden',
    },
    placeholder: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    placeholderText: {
        marginTop: 10,
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 19,
    },
    legendRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 14,
        marginTop: 12,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
    },
    legendStartDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 3,
        borderColor: '#0066CC',
        backgroundColor: '#FFFFFF',
        marginRight: 6,
    },
    legendEndSquare: {
        width: 12,
        height: 12,
        borderRadius: 3,
        backgroundColor: '#0F172A',
        marginRight: 6,
    },
    legendStopDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: '#64748B',
        backgroundColor: '#FFFFFF',
        marginRight: 6,
    },
    legendText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#475569',
    },
    footnote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 8,
        lineHeight: 17,
    },
    attribution: {
        fontSize: 11,
        fontWeight: '500',
        color: '#94A3B8',
        marginTop: 8,
    },
});
