import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
    GeoPoint,
    JourneyStopPoint,
    RouteGeometry,
} from '../../../entities/route/model/types';

export interface RouteMapVehicle {
    latitude: number;
    longitude: number;
    title: string;
    subtitle?: string;
    updatedLabel?: string;
}

export interface RouteMapProps {
    origin: GeoPoint;
    destination: GeoPoint;
    stops?: JourneyStopPoint[];
    geometry?: RouteGeometry;
    vehicle?: RouteMapVehicle | null;
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
 *
 * The bus cannot be plotted without a map, so its report is stated in words
 * instead. The live status card above the map carries the same information on
 * every platform, so nothing is lost here — only the pin.
 */
export function RouteMap({
    vehicle,
    originLabel,
    destinationLabel,
    height,
}: RouteMapProps) {
    const vehicleSummary = vehicle
        ? `${vehicle.title} is reporting its location` +
          (vehicle.updatedLabel ? `. ${vehicle.updatedLabel}` : '')
        : null;

    return (
        <View
            style={[styles.container, { height }]}
            accessible
            accessibilityLabel={
                `Route from ${originLabel} to ${destinationLabel}. ` +
                (vehicleSummary ? `${vehicleSummary}. ` : '') +
                'The interactive map is available in the MoveAble mobile app.'
            }
        >
            <Ionicons name="map-outline" size={30} color="#94A3B8" />
            <Text style={styles.text}>
                The interactive route map is available in the MoveAble mobile app.
            </Text>

            {!!vehicleSummary && (
                <View style={styles.vehicleRow}>
                    <Ionicons name="bus" size={16} color="#047857" />
                    <Text style={styles.vehicleText}>{vehicleSummary}.</Text>
                </View>
            )}
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
    vehicleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
        paddingHorizontal: 8,
    },
    vehicleText: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '600',
        color: '#065F46',
        marginLeft: 6,
        textAlign: 'center',
        lineHeight: 19,
    },
});
