import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import {
    FAVOURITE_ROUTE_CARD_HINT,
    FavouriteRoute,
    favouriteRouteCardLabel,
    removeFavouriteLabel,
} from '../utils/favouriteRoutes';

interface FavouriteRouteCardProps {
    favourite: FavouriteRoute;
    /** Plan this journey — fills the planner, never searches. */
    onPress: () => void;
    /**
     * Remove this favourite. Omitted on the planner, where the list is a
     * shortcut rather than the place favourites are managed.
     */
    onRemove?: () => void;
}

/**
 * One saved journey pair, as a row (MOV-99).
 *
 * Shows the origin and the destination and nothing else. A bus, a trip id, a
 * departure time, an accessibility score or a rating would all describe one
 * particular departure, and a favourite is not one — it is the pair a passenger
 * searches with, whose departures are looked up fresh every time it is used.
 *
 * Deliberately the same shape as the planner's existing Recent Searches row
 * (icon badge, origin above an arrowed destination, trailing control), because
 * the two lists sit next to each other and a passenger should read them as the
 * same kind of thing. The star badge and the wording are what tell them apart.
 *
 * The remove control is a SIBLING of the tappable body rather than a child of
 * it: nesting it would leave a screen reader announcing one target where there
 * are two, and reaching the second would be impossible.
 */
export function FavouriteRouteCard({ favourite, onPress, onRemove }: FavouriteRouteCardProps) {
    return (
        <View style={styles.card}>
            <TouchableOpacity
                style={styles.body}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={favouriteRouteCardLabel(favourite)}
                accessibilityHint={FAVOURITE_ROUTE_CARD_HINT}
            >
                <View style={styles.iconBadge}>
                    <Ionicons name="star" size={20} color="#0066CC" />
                </View>

                <View style={styles.textContainer}>
                    <Text style={styles.originText} numberOfLines={1}>
                        {favourite.origin}
                    </Text>
                    <View style={styles.destinationRow}>
                        <Ionicons
                            name="arrow-forward"
                            size={13}
                            color="#64748B"
                            style={styles.destinationArrow}
                        />
                        <Text style={styles.destinationText} numberOfLines={1}>
                            {favourite.destination}
                        </Text>
                    </View>
                </View>
            </TouchableOpacity>

            {onRemove ? (
                <TouchableOpacity
                    style={styles.removeButton}
                    onPress={onRemove}
                    accessibilityRole="button"
                    accessibilityLabel={removeFavouriteLabel(favourite)}
                    accessibilityHint="Double tap to remove this favourite route"
                >
                    <Ionicons name="trash-outline" size={20} color="#D32F2F" />
                </TouchableOpacity>
            ) : (
                <Ionicons
                    name="chevron-forward"
                    size={22}
                    color="#94A3B8"
                    style={styles.chevron}
                    // Decorative: the card's own label already says what
                    // tapping it does.
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 16,
        paddingLeft: 14,
        paddingRight: 6,
        paddingVertical: 8,
        marginBottom: 12,
        minHeight: 58,
    },
    body: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        paddingVertical: 6,
    },
    iconBadge: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    textContainer: {
        flex: 1,
    },
    originText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
    },
    destinationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 3,
    },
    destinationArrow: {
        marginRight: 4,
    },
    destinationText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#334155',
    },
    removeButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    chevron: {
        width: 44,
        textAlign: 'center',
    },
});
