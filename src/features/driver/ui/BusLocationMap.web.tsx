import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BusMapFreshness, BusMapPoint } from '../utils/busMapView';

/**
 * Web stand-in for the dashboard bus map (MOV-262).
 *
 * react-native-maps is native-only — importing it into the web bundle fails at
 * build time — and a driver's dashboard is a phone screen in a vehicle. Metro
 * picks this file for the web platform, so the web build keeps working and the
 * rest of the dashboard renders unchanged.
 *
 * Nothing is lost but the picture. The coordinates and the tracking state are
 * on the card above on every platform, and the same caption appears here, so
 * the position and how fresh it is are still readable.
 *
 * The same rule applies as on native: with no marker there is no position, and
 * none is invented to fill the space.
 */
export interface BusLocationMapProps {
    marker: BusMapPoint | null;
    freshness: BusMapFreshness;
    caption: string;
    accessibilityLabel: string;
    height: number;
}

export function BusLocationMap({
    marker,
    freshness,
    caption,
    accessibilityLabel,
    height,
}: BusLocationMapProps) {
    return (
        <View
            style={[styles.container, { height }]}
            accessible
            accessibilityLabel={accessibilityLabel}
        >
            <Ionicons
                name={marker ? 'bus' : 'location-outline'}
                size={26}
                color={marker ? '#047857' : '#94A3B8'}
            />

            <Text style={styles.text}>
                {marker
                    ? 'The live bus map is available in the MoreAble mobile app.'
                    : caption}
            </Text>

            {!!marker && (
                <Text style={[styles.caption, freshness === 'LIVE' && styles.captionLive]}>
                    {caption}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        backgroundColor: '#F4F7FB',
        marginTop: 16,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    text: {
        marginTop: 8,
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 19,
    },
    caption: {
        marginTop: 6,
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
        textAlign: 'center',
    },
    captionLive: {
        color: '#065F46',
    },
});
