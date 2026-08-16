import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
    GeoPoint,
    JourneyStopPoint,
    RouteGeometry,
} from '../../../entities/route/model/types';

export interface RouteMapProps {
    origin: GeoPoint;
    destination: GeoPoint;
    stops?: JourneyStopPoint[];
    geometry?: RouteGeometry;
    originLabel: string;
    destinationLabel: string;
    height: number;
}

/**
 * Web stand-in for the interactive route map.
 *
 * react-native-maps is native-only — importing it into the web bundle fails at
 * build time — and MoveAble's target is the mobile app. Metro picks this file
 * for the web platform, so the web build keeps working and the rest of the
 * Route Details screen (summary, stops, bus, accessibility) renders unchanged.
 */
export function RouteMap({ originLabel, destinationLabel, height }: RouteMapProps) {
    return (
        <View
            style={[styles.container, { height }]}
            accessible
            accessibilityLabel={
                `Route from ${originLabel} to ${destinationLabel}. ` +
                'The interactive map is available in the MoveAble mobile app.'
            }
        >
            <Ionicons name="map-outline" size={30} color="#94A3B8" />
            <Text style={styles.text}>
                The interactive route map is available in the MoveAble mobile app.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    text: {
        marginTop: 10,
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 19,
    },
});
