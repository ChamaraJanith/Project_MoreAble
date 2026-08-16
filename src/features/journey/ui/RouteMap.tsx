import React, { useCallback, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, LatLng, Marker, Polyline, UrlTile } from 'react-native-maps';
import { GeoPoint, RouteGeometry } from '../../../entities/route/model/types';
import { Stop } from '../../../entities/stop/model/types';

/** The part of a Stop the map needs: a named coordinate. */
export type RouteMapStop = Pick<Stop, 'name' | 'latitude' | 'longitude'>;

export interface RouteMapProps {
    origin: GeoPoint;
    destination: GeoPoint;
    /** Intermediate stops, in travel order. Rendered only when coordinates exist. */
    stops?: RouteMapStop[];
    /** OSRM road geometry from the Journey Search response. */
    geometry?: RouteGeometry;
    originLabel: string;
    destinationLabel: string;
    height: number;
}

// OpenStreetMap's standard tile server. Its usage policy asks for light,
// non-bulk use — a single journey map opened on demand is well within that.
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_MAX_ZOOM = 19;

const FIT_EDGE_PADDING = { top: 55, right: 55, bottom: 55, left: 55 };

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
    originLabel,
    destinationLabel,
    height,
}: RouteMapProps) {
    const mapRef = useRef<MapView | null>(null);

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

    // Everything the opening view must contain.
    const fitTargets = useMemo<LatLng[]>(
        () => [originCoordinate, ...roadPath, ...drawableStops, destinationCoordinate],
        [originCoordinate, roadPath, drawableStops, destinationCoordinate]
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

            {/* Intermediate stops: smaller than the endpoints, tappable for the name */}
            {drawableStops.map((stop, index) => (
                <Marker
                    key={`${stop.name}-${index}`}
                    coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    accessibilityLabel={`Stop: ${stop.name}`}
                >
                    <View style={styles.stopMarker} />
                    <Callout tooltip>
                        <View style={styles.callout}>
                            <Text style={styles.calloutText}>{stop.name}</Text>
                        </View>
                    </Callout>
                </Marker>
            ))}

            {/* Origin: hollow ring, labelled "Start" so it is not colour-only */}
            <Marker
                coordinate={originCoordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                accessibilityLabel={`Start: ${originLabel}`}
            >
                <View style={styles.originMarker}>
                    <View style={styles.originMarkerCore} />
                </View>
                <Callout tooltip>
                    <View style={styles.callout}>
                        <Text style={styles.calloutCaption}>Start</Text>
                        <Text style={styles.calloutText}>{originLabel}</Text>
                    </View>
                </Callout>
            </Marker>

            {/* Destination: solid square, a different shape as well as a different tone */}
            <Marker
                coordinate={destinationCoordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                accessibilityLabel={`Destination: ${destinationLabel}`}
            >
                <View style={styles.destinationMarker} />
                <Callout tooltip>
                    <View style={styles.callout}>
                        <Text style={styles.calloutCaption}>Destination</Text>
                        <Text style={styles.calloutText}>{destinationLabel}</Text>
                    </View>
                </Callout>
            </Marker>
        </MapView>
    );
}

const styles = StyleSheet.create({
    map: {
        width: '100%',
    },

    originMarker: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 4,
        borderColor: '#0066CC',
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    originMarkerCore: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#0066CC',
    },
    destinationMarker: {
        width: 20,
        height: 20,
        borderRadius: 5,
        backgroundColor: '#0F172A',
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    stopMarker: {
        width: 13,
        height: 13,
        borderRadius: 6.5,
        backgroundColor: '#FFFFFF',
        borderWidth: 3,
        borderColor: '#64748B',
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
});
