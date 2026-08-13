import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { JourneySearchMatch } from '../../../entities/route/model/types';

interface RouteResultCardProps {
    route: JourneySearchMatch;
}

export function RouteResultCard({ route }: RouteResultCardProps) {
    // The first/last entries are the origin/destination already shown above, so only
    // the stops in between are worth surfacing here.
    const intermediateStops = route.journeyStops.slice(1, -1);

    return (
        <View
            style={styles.card}
            accessible
            accessibilityLabel={`Route ${route.routeNumber}, ${route.routeName}. From ${route.origin} to ${route.destination}. Estimated duration ${route.estimatedDuration ?? 'not available'}. Distance ${route.distanceKm != null ? `${route.distanceKm} kilometers` : 'not available'}.`}
        >
            <View style={styles.topRow}>
                <View style={styles.routeNumberBadge}>
                    <Text style={styles.routeNumberText}>{route.routeNumber}</Text>
                </View>
                <Text style={styles.routeNameText} numberOfLines={1}>
                    {route.routeName}
                </Text>
            </View>

            <View style={styles.journeyRow}>
                <Text style={styles.journeyText} numberOfLines={1}>
                    {route.origin}
                </Text>
                <Ionicons name="arrow-forward" size={15} color="#64748B" style={styles.journeyArrow} />
                <Text style={styles.journeyText} numberOfLines={1}>
                    {route.destination}
                </Text>
            </View>

            <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={17} color="#0066CC" />
                    <Text style={styles.metaText}>{route.estimatedDuration ?? 'Duration N/A'}</Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                    <Ionicons name="navigate-outline" size={17} color="#0066CC" />
                    <Text style={styles.metaText}>
                        {route.distanceKm != null ? `${route.distanceKm} km` : 'Distance N/A'}
                    </Text>
                </View>
            </View>

            {intermediateStops.length > 0 && (
                <View style={styles.stopsRow}>
                    <Ionicons name="ellipsis-horizontal-circle-outline" size={16} color="#94A3B8" style={styles.stopsIcon} />
                    <Text style={styles.stopsText} numberOfLines={1}>
                        Via {intermediateStops.join(', ')}
                    </Text>
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
        marginBottom: 12,
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
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
    },
    journeyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    journeyText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: '600',
        color: '#1E293B',
    },
    journeyArrow: {
        marginHorizontal: 8,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    metaDivider: {
        width: 1,
        height: 20,
        backgroundColor: '#E2E8F0',
        marginHorizontal: 10,
    },
    metaText: {
        marginLeft: 6,
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
    },
    stopsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    stopsIcon: {
        marginRight: 6,
    },
    stopsText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
    },
});
