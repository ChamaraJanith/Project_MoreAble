import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { LatLng, Marker, UrlTile } from 'react-native-maps';
import { OSM_MAX_ZOOM, OSM_TILE_URL, VEHICLE_MARKER_COLOR } from '../../../shared/ui/mapTheme';
import { BusMapPoint, BusMapFreshness } from '../utils/busMapView';

/**
 * The signed-in bus, on a map (MOV-262).
 *
 * A deliberately dumb component. It reads no GPS, reads no session, publishes
 * nothing, subscribes to nothing and runs no timer of its own — every decision
 * about whether there is anything to draw was already made by `busMapView`, and
 * the position it draws was produced by the MOV-267 tracking loop. Handing it a
 * marker is the only way to make it show a bus.
 *
 * It is the same map technology as the passenger route map: react-native-maps
 * over OpenStreetMap tiles, sharing the tile source and the vehicle colour
 * through `shared/ui/mapTheme`. The passenger map draws a whole journey and
 * this draws one vehicle, so they are separate components rather than one with
 * a mode switch — but a bus looks like a bus in both.
 *
 * Native only. Metro picks `BusLocationMap.web.tsx` for the web bundle, where
 * react-native-maps cannot load.
 */
export interface BusLocationMapProps {
    /** Where the bus is, or null while there is nothing to draw. */
    marker: BusMapPoint | null;
    freshness: BusMapFreshness;
    caption: string;
    accessibilityLabel: string;
    height: number;
}

/**
 * How closely the map sits around the bus.
 *
 * Roughly a few streets across: close enough to read which road the vehicle is
 * on, wide enough that a driver glancing down still recognises where they are.
 */
const SPAN = 0.008;

/** Long enough to read as movement rather than a jump; short enough not to nag. */
const CAMERA_ANIMATION_MS = 450;

/**
 * Below this the camera stays put.
 *
 * GPS jitters by a few metres even standing still, and a map that slides on
 * every reading is unpleasant to look at and drains the battery for nothing.
 * About 11 metres — under a bus length, so real movement always wins.
 */
const CAMERA_MOVE_THRESHOLD = 0.0001;

const MARKER_BADGE_SIZE = 38;

/** A vehicle badge is centred on its coordinate rather than hanging above it. */
const MARKER_ANCHOR = { x: 0.5, y: 0.5 } as const;

export function BusLocationMap({
    marker,
    freshness,
    caption,
    accessibilityLabel,
    height,
}: BusLocationMapProps) {
    const mapRef = useRef<MapView | null>(null);

    // The badge is an icon-font glyph, and a marker snapshotted before the font
    // has painted comes out blank. Tracking stays on just long enough for the
    // first paint, then switches off so panning stays cheap. Same approach as
    // the passenger route map, for the same reason.
    const [tracksMarkerChanges, setTracksMarkerChanges] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setTracksMarkerChanges(false), 1500);
        return () => clearTimeout(timer);
    }, []);

    // A new object on every render would move the camera on every render, so
    // the memo depends on the numbers rather than on the object holding them:
    // an identical reading re-wrapped in a fresh object changes nothing here.
    const latitude = marker?.latitude;
    const longitude = marker?.longitude;

    const coordinate = useMemo<LatLng | null>(
        () =>
            typeof latitude === 'number' && typeof longitude === 'number'
                ? { latitude, longitude }
                : null,
        [latitude, longitude]
    );

    /** Where the camera was last pointed, so a repeat reading is a no-op. */
    const cameraAt = useRef<LatLng | null>(null);

    useEffect(() => {
        if (!coordinate) return;

        const previous = cameraAt.current;
        cameraAt.current = coordinate;

        // The first fix places the camera through `initialRegion` below, so
        // there is nothing to animate towards yet.
        if (!previous) return;

        const moved =
            Math.abs(previous.latitude - coordinate.latitude) > CAMERA_MOVE_THRESHOLD ||
            Math.abs(previous.longitude - coordinate.longitude) > CAMERA_MOVE_THRESHOLD;

        if (!moved) return;

        mapRef.current?.animateCamera(
            { center: coordinate },
            { duration: CAMERA_ANIMATION_MS }
        );
    }, [coordinate]);

    // No position yet. An empty frame rather than a map centred on nowhere —
    // there is no default place a bus could be, and picking one would be a lie
    // told convincingly.
    if (!coordinate) {
        return (
            <View
                style={[styles.placeholder, { height }]}
                accessible
                accessibilityLabel={accessibilityLabel}
            >
                <Ionicons name="location-outline" size={26} color="#94A3B8" />
                <Text style={styles.placeholderText}>{caption}</Text>
            </View>
        );
    }

    return (
        <View style={styles.frame}>
            <MapView
                ref={mapRef}
                style={[styles.map, { height }]}
                // Android draws the Google base map underneath unless it is
                // switched off; with 'none' only the OpenStreetMap tiles below
                // show. iOS has no 'none', where the opaque tiles cover it.
                mapType={Platform.OS === 'android' ? 'none' : 'standard'}
                initialRegion={{
                    latitude: coordinate.latitude,
                    longitude: coordinate.longitude,
                    latitudeDelta: SPAN,
                    longitudeDelta: SPAN,
                }}
                // A driver glances at this while working. Panning and zooming
                // stay available; rotation and pitch would only disorientate.
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                accessibilityLabel={accessibilityLabel}
            >
                <UrlTile
                    urlTemplate={OSM_TILE_URL}
                    maximumZ={OSM_MAX_ZOOM}
                    shouldReplaceMapContent
                    zIndex={-1}
                />

                <Marker
                    coordinate={coordinate}
                    anchor={MARKER_ANCHOR}
                    tracksViewChanges={tracksMarkerChanges}
                    accessibilityLabel={accessibilityLabel}
                >
                    {/* Hollow while the position is older than live, so the
                        marker's own shape says how much to trust it — not the
                        caption alone, and not colour alone. */}
                    <View
                        style={[
                            styles.markerBadge,
                            freshness === 'LAST_KNOWN' && styles.markerBadgeStale,
                        ]}
                    >
                        <Ionicons
                            name="bus"
                            size={19}
                            color={freshness === 'LAST_KNOWN' ? VEHICLE_MARKER_COLOR : '#FFFFFF'}
                        />
                    </View>
                </Marker>
            </MapView>

            {/* The marker is never left unqualified: this says whether it is
                where the bus is, or only where it last was. */}
            <View style={styles.captionRow}>
                <Ionicons
                    name={freshness === 'LIVE' ? 'radio-button-on' : 'time-outline'}
                    size={13}
                    color={freshness === 'LIVE' ? VEHICLE_MARKER_COLOR : '#64748B'}
                />
                <Text
                    style={[styles.captionText, freshness === 'LIVE' && styles.captionTextLive]}
                >
                    {caption}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    frame: {
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        backgroundColor: '#F4F7FB',
        marginTop: 16,
    },
    map: {
        width: '100%',
    },

    placeholder: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        backgroundColor: '#F4F7FB',
        marginTop: 16,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    placeholderText: {
        marginTop: 8,
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
        textAlign: 'center',
    },

    markerBadge: {
        width: MARKER_BADGE_SIZE,
        height: MARKER_BADGE_SIZE,
        borderRadius: MARKER_BADGE_SIZE / 2,
        backgroundColor: VEHICLE_MARKER_COLOR,
        justifyContent: 'center',
        alignItems: 'center',
        // A white ring keeps the badge readable over busy map detail.
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    markerBadgeStale: {
        backgroundColor: '#FFFFFF',
        borderColor: VEHICLE_MARKER_COLOR,
    },

    captionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    captionText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
        marginLeft: 6,
    },
    captionTextLive: {
        color: '#065F46',
    },
});
