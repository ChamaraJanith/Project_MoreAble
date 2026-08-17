import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, LatLng, Marker, Polyline, UrlTile } from 'react-native-maps';
import {
    GeoPoint,
    JourneyStopPoint,
    RouteGeometry,
} from '../../../entities/route/model/types';

/**
 * Where the bus reported itself, ready to draw (MOV-119).
 *
 * Only ever built from the live vehicle position; the caller resolves it and
 * passes nothing at all when the bus is not reporting, so this component never
 * has to decide what to fall back to.
 */
export interface RouteMapVehicle {
    latitude: number;
    longitude: number;
    /** What the vehicle is, e.g. "Route 177". */
    title: string;
    /** How it is identified to a passenger, e.g. its number plate. */
    subtitle?: string;
    /** How recent the report is, e.g. "Updated 2 mins ago". */
    updatedLabel?: string;
}

export interface RouteMapProps {
    origin: GeoPoint;
    destination: GeoPoint;
    /** Intermediate stops, in travel order. Rendered only when coordinates exist. */
    stops?: JourneyStopPoint[];
    /** OSRM road geometry from the Journey Search response. */
    geometry?: RouteGeometry;
    /** The live vehicle position. Absent when the bus is not reporting. */
    vehicle?: RouteMapVehicle | null;
    originLabel: string;
    destinationLabel: string;
    height: number;
}

// OpenStreetMap's standard tile server. Its usage policy asks for light,
// non-bulk use — a single journey map opened on demand is well within that.
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_MAX_ZOOM = 19;

const FIT_EDGE_PADDING = { top: 55, right: 55, bottom: 55, left: 55 };

const ENDPOINT_PIN_SIZE = 38;

/** Standard map convention: start is blue, destination is red, stops are grey. */
export const ORIGIN_COLOR = '#0066CC';
export const DESTINATION_COLOR = '#DC2626';
export const STOP_COLOR = '#64748B';

/**
 * The live vehicle, in a green reserved for it alone.
 *
 * Colour is the least of what separates it from the other markers: it is the
 * only round badge on the map and the only one carrying a vehicle glyph, so it
 * stays distinguishable without relying on colour vision.
 */
export const VEHICLE_COLOR = '#047857';

const VEHICLE_BADGE_SIZE = 34;

/** A pin hangs above its coordinate, so its tip is the anchor. */
const PIN_ANCHOR = { x: 0.5, y: 1 } as const;

/** A stop dot is centred on its coordinate. */
const DOT_ANCHOR = { x: 0.5, y: 0.5 } as const;

/**
 * A dropped location pin, drawn from the icon set the app already uses.
 *
 * Endpoints and intermediate stops share this one shape so they read as the
 * same kind of thing at different weights, and the contrasting centre keeps the
 * head legible against busy map detail.
 */
function MapPin({
    size,
    color,
    coreColor,
}: {
    size: number;
    color: string;
    coreColor: string;
}) {
    const coreSize = size * 0.26;

    return (
        <View style={{ width: size, height: size }}>
            <Ionicons name="location" size={size} color={color} />
            <View
                style={[
                    styles.pinCore,
                    {
                        width: coreSize,
                        height: coreSize,
                        borderRadius: coreSize / 2,
                        backgroundColor: coreColor,
                        // Centres the dot on the pin's head rather than the box.
                        top: size * 0.24,
                        left: size * 0.37,
                    },
                ]}
            />
        </View>
    );
}

/**
 * Converts one GeoJSON position to a react-native-maps coordinate.
 *
 * GeoJSON orders positions [longitude, latitude]; react-native-maps expects
 * { latitude, longitude }. Getting this backwards silently places the route in
 * the wrong hemisphere, so the conversion lives in one named place.
 */
function toLatLng([longitude, latitude]: [number, number]): LatLng {
    return { latitude, longitude };
}

function isDrawablePoint(point: { latitude: number; longitude: number }): boolean {
    return Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

/**
 * The interactive route map.
 *
 * Renders an OpenStreetMap base layer with the road path the backend already
 * resolved through OSRM. It performs no geocoding or routing of its own — every
 * coordinate here arrives as a prop from the Journey Search response.
 */
export function RouteMap({
    origin,
    destination,
    stops = [],
    geometry,
    vehicle,
    originLabel,
    destinationLabel,
    height,
}: RouteMapProps) {
    const mapRef = useRef<MapView | null>(null);

    // The pins are icon-font glyphs, and a marker snapshotted before the font
    // has painted comes out blank. Tracking stays on just long enough for the
    // first paint, then switches off so panning and zooming stay cheap.
    const [tracksMarkerChanges, setTracksMarkerChanges] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setTracksMarkerChanges(false), 1500);
        return () => clearTimeout(timer);
    }, []);

    const originCoordinate = useMemo<LatLng>(
        () => ({ latitude: origin.latitude, longitude: origin.longitude }),
        [origin.latitude, origin.longitude]
    );

    const destinationCoordinate = useMemo<LatLng>(
        () => ({ latitude: destination.latitude, longitude: destination.longitude }),
        [destination.latitude, destination.longitude]
    );

    // One polyline for the whole road path — drawn only from real OSRM geometry,
    // never as a straight origin-to-destination line.
    const roadPath = useMemo<LatLng[]>(() => {
        if (!geometry || !Array.isArray(geometry.coordinates)) return [];

        return geometry.coordinates
            .filter(
                (position): position is [number, number] =>
                    Array.isArray(position) &&
                    position.length >= 2 &&
                    Number.isFinite(position[0]) &&
                    Number.isFinite(position[1])
            )
            .map(toLatLng);
    }, [geometry]);

    const drawableStops = useMemo(
        () => stops.filter(isDrawablePoint),
        [stops]
    );

    const vehicleCoordinate = useMemo<LatLng | null>(
        () =>
            vehicle && isDrawablePoint(vehicle)
                ? { latitude: vehicle.latitude, longitude: vehicle.longitude }
                : null,
        [vehicle]
    );

    // Everything the opening view must contain. The bus joins it so a vehicle
    // slightly off the drawn corridor is still on screen when the map opens.
    const fitTargets = useMemo<LatLng[]>(
        () => [
            originCoordinate,
            ...roadPath,
            ...drawableStops,
            ...(vehicleCoordinate ? [vehicleCoordinate] : []),
            destinationCoordinate,
        ],
        [originCoordinate, roadPath, drawableStops, vehicleCoordinate, destinationCoordinate]
    );

    // Fitting once the map is laid out avoids a hardcoded region and keeps the
    // whole journey visible without the passenger zooming out.
    const fitToRoute = useCallback(() => {
        if (fitTargets.length < 2) return;

        mapRef.current?.fitToCoordinates(fitTargets, {
            edgePadding: FIT_EDGE_PADDING,
            animated: false,
        });
    }, [fitTargets]);

    return (
        <MapView
            ref={mapRef}
            style={[styles.map, { height }]}
            // Android draws the Google base map underneath unless it is switched
            // off; with 'none' only the OpenStreetMap tiles below are shown. iOS
            // does not support 'none', where the opaque tiles cover the base map.
            mapType={Platform.OS === 'android' ? 'none' : 'standard'}
            onMapReady={fitToRoute}
            onLayout={fitToRoute}
            zoomEnabled
            scrollEnabled
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            accessibilityLabel={`Map of the route from ${originLabel} to ${destinationLabel}`}
        >
            <UrlTile
                urlTemplate={OSM_TILE_URL}
                maximumZ={OSM_MAX_ZOOM}
                shouldReplaceMapContent
                zIndex={-1}
            />

            {roadPath.length >= 2 && (
                <>
                    {/* Casing under the line keeps it legible over busy map detail. */}
                    <Polyline
                        coordinates={roadPath}
                        strokeColor="#FFFFFF"
                        strokeWidth={9}
                        lineCap="round"
                        lineJoin="round"
                    />
                    <Polyline
                        coordinates={roadPath}
                        strokeColor="#0066CC"
                        strokeWidth={5}
                        lineCap="round"
                        lineJoin="round"
                    />
                </>
            )}

            {/* Intermediate stops: a plain View dot, so nothing depends on an
                icon font having painted before the marker is snapshotted. */}
            {drawableStops.map((stop, index) => (
                <Marker
                    key={`${stop.name}-${index}`}
                    coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                    anchor={DOT_ANCHOR}
                    tracksViewChanges={false}
                    accessibilityLabel={`Stop: ${stop.name}`}
                >
                    <View style={styles.stopDot} />
                    <Callout tooltip>
                        <View style={styles.callout}>
                            <Text style={styles.calloutText}>{stop.name}</Text>
                        </View>
                    </Callout>
                </Marker>
            ))}

            {/* Origin: blue pin, captioned "Start" so it is never colour-only */}
            <Marker
                coordinate={originCoordinate}
                anchor={PIN_ANCHOR}
                tracksViewChanges={tracksMarkerChanges}
                accessibilityLabel={`Start: ${originLabel}`}
            >
                <MapPin size={ENDPOINT_PIN_SIZE} color={ORIGIN_COLOR} coreColor="#FFFFFF" />
                <Callout tooltip>
                    <View style={styles.callout}>
                        <Text style={styles.calloutCaption}>Start</Text>
                        <Text style={styles.calloutText}>{originLabel}</Text>
                    </View>
                </Callout>
            </Marker>

            {/* Destination: the same pin in red, captioned "Destination" */}
            <Marker
                coordinate={destinationCoordinate}
                anchor={PIN_ANCHOR}
                tracksViewChanges={tracksMarkerChanges}
                accessibilityLabel={`Destination: ${destinationLabel}`}
            >
                <MapPin size={ENDPOINT_PIN_SIZE} color={DESTINATION_COLOR} coreColor="#FFFFFF" />
                <Callout tooltip>
                    <View style={styles.callout}>
                        <Text style={styles.calloutCaption}>Destination</Text>
                        <Text style={styles.calloutText}>{destinationLabel}</Text>
                    </View>
                </Callout>
            </Marker>

            {/* The bus itself, drawn last so it sits above the route and stops.
                A round badge rather than a pin: it marks where the vehicle is,
                not a fixed place on the route. It does not animate — the
                position is a snapshot, and movement would imply otherwise. */}
            {vehicle && vehicleCoordinate && (
                <Marker
                    coordinate={vehicleCoordinate}
                    anchor={DOT_ANCHOR}
                    tracksViewChanges={tracksMarkerChanges}
                    accessibilityLabel={
                        `Live bus location: ${vehicle.title}` +
                        (vehicle.updatedLabel ? `. ${vehicle.updatedLabel}` : '')
                    }
                >
                    <View style={styles.vehicleBadge}>
                        <Ionicons name="bus" size={18} color="#FFFFFF" />
                    </View>
                    <Callout tooltip>
                        <View style={styles.callout}>
                            <Text style={styles.calloutCaption}>Bus location</Text>
                            <Text style={styles.calloutText}>{vehicle.title}</Text>
                            {!!vehicle.subtitle && (
                                <Text style={styles.calloutSubtext}>{vehicle.subtitle}</Text>
                            )}
                            {!!vehicle.updatedLabel && (
                                <Text style={styles.calloutSubtext}>{vehicle.updatedLabel}</Text>
                            )}
                        </View>
                    </Callout>
                </Marker>
            )}
        </MapView>
    );
}

const styles = StyleSheet.create({
    map: {
        width: '100%',
    },

    pinCore: {
        position: 'absolute',
    },
    stopDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: STOP_COLOR,
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    vehicleBadge: {
        width: VEHICLE_BADGE_SIZE,
        height: VEHICLE_BADGE_SIZE,
        borderRadius: VEHICLE_BADGE_SIZE / 2,
        backgroundColor: VEHICLE_COLOR,
        justifyContent: 'center',
        alignItems: 'center',
        // A white ring keeps the badge readable over both the route line and
        // busy map detail.
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },

    callout: {
        backgroundColor: '#FFFFFF',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        maxWidth: 220,
    },
    calloutCaption: {
        fontSize: 10,
        fontWeight: '700',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 2,
    },
    calloutText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0F172A',
    },
    calloutSubtext: {
        fontSize: 12,
        fontWeight: '500',
        color: '#475569',
        marginTop: 2,
    },
});
