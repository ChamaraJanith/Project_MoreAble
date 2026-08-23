// What the dashboard map is allowed to draw (MOV-262).
//
// The map is VISUALISATION ONLY. It reads no GPS, publishes nothing, holds no
// session and runs no timer — the tracking engine (MOV-267) remains the single
// source of truth, and this turns the state that engine already produces into
// a marker or into nothing.
//
// The whole point of putting it here rather than in the component is the word
// "nothing". A map is very good at being convincing, so the rules about when
// NOT to draw a bus matter more than the drawing:
//
//   * there is no fallback coordinate, and no default position
//   * a marker is only ever a position the phone actually reported
//   * a position kept from an earlier fix is labelled as one, never as live
//   * a signed-out phone shows no bus at all
//
// Kept free of React and of map imports, like the rest of `driver/utils`, so
// every one of those rules is testable in a project with no React renderer.

import { PhoneLocation } from '../../../shared/utils/phoneLocation';
import { PhoneLocationState } from './phoneLocationState';

/** A point the map may draw. Only ever copied from a real reading. */
export interface BusMapPoint {
    latitude: number;
    longitude: number;
}

/**
 * How much the marker can be trusted right now.
 *
 * The distinction is the difference between a map that informs a driver and one
 * that misleads them: an old position drawn without qualification says "the bus
 * is here", which may simply not be true any more.
 */
export type BusMapFreshness =
    /** The current fix, and passengers have it. */
    | 'LIVE'
    /** The current fix, but the backend has not confirmed it. */
    | 'UNSENT'
    /** An earlier fix, kept because there is no newer one yet. */
    | 'LAST_KNOWN';

export interface BusMapView {
    /** Whether the map section belongs on the card at all. */
    visible: boolean;
    /** Where to draw the bus, or null when nothing may honestly be drawn. */
    marker: BusMapPoint | null;
    /** Only meaningful when there is a marker. */
    freshness: BusMapFreshness;
    /** A short caption under the map, so the marker is never unqualified. */
    caption: string;
    /** What a screen reader says instead of the picture. */
    accessibilityLabel: string;
}

/** A coordinate the map may draw: a real point on the Earth, and nothing else. */
function isDrawable(location: PhoneLocation | null | undefined): location is PhoneLocation {
    return (
        !!location &&
        typeof location.latitude === 'number' &&
        typeof location.longitude === 'number' &&
        Number.isFinite(location.latitude) &&
        Number.isFinite(location.longitude) &&
        location.latitude >= -90 &&
        location.latitude <= 90 &&
        location.longitude >= -180 &&
        location.longitude <= 180
    );
}

function toPoint(location: PhoneLocation): BusMapPoint {
    // Copied field by field rather than passed through, so nothing else from a
    // reading — or from whatever produced it — reaches the map layer.
    return { latitude: location.latitude, longitude: location.longitude };
}

/**
 * Carries a position forward across a momentary failure.
 *
 * The state model deliberately drops its reading when a GPS request fails
 * (MOV-264), because a stale position presented as the current one is exactly
 * what this feature must not do. That rule is right and is left alone — this
 * keeps the last real fix beside it instead, so the map can go on showing where
 * the bus was while clearly saying that is what it is.
 *
 * Forgotten in the two cases where it would become a lie: when tracking is off,
 * and when the bus is signed out. A restart therefore begins with an empty map
 * rather than flashing wherever the phone was last time.
 */
export function nextLastKnownLocation(
    previous: PhoneLocation | null,
    state: PhoneLocationState,
    isTracking: boolean
): PhoneLocation | null {
    if (!isTracking || state.status === 'NOT_SIGNED_IN') {
        return null;
    }

    return isDrawable(state.location) ? state.location : previous;
}

/**
 * Decides what the map shows for one moment of the tracking flow.
 *
 * `lastKnown` is whatever `nextLastKnownLocation` has carried forward; passing
 * null simply means the map has nothing older to fall back on.
 */
export function describeBusMap(
    state: PhoneLocationState,
    isTracking: boolean,
    lastKnown: PhoneLocation | null = null
): BusMapView {
    // Tracking off, or no bus signed in: no map. Nothing here is being updated,
    // so a marker could only say something that is not currently true.
    if (!isTracking || state.status === 'NOT_SIGNED_IN') {
        return {
            visible: false,
            marker: null,
            freshness: 'LAST_KNOWN',
            caption: '',
            accessibilityLabel: '',
        };
    }

    if (isDrawable(state.location)) {
        // The reading survives a failed publish, so this covers the case where
        // the position is real and current but has not reached passengers. The
        // marker does not move for that — it is the same fix either way — but
        // the caption stops short of claiming it was shared.
        const unsent = state.status === 'PUBLISH_FAILED';

        return {
            visible: true,
            marker: toPoint(state.location),
            freshness: unsent ? 'UNSENT' : 'LIVE',
            caption: unsent ? 'Current position — not sent yet' : 'Live position',
            accessibilityLabel: unsent
                ? 'Map showing this bus at its current position. The position has not been sent to passengers yet.'
                : 'Map showing this bus at its current location.',
        };
    }

    if (isDrawable(lastKnown)) {
        return {
            visible: true,
            marker: toPoint(lastKnown),
            freshness: 'LAST_KNOWN',
            // Never presented as where the bus is — only where it last was.
            caption: 'Last known position',
            accessibilityLabel:
                'Map showing the last known position of this bus. Waiting for a newer location.',
        };
    }

    // Tracking is on but nothing has ever been fixed. An empty frame is the
    // honest answer; there is no position to centre on and none to invent.
    return {
        visible: true,
        marker: null,
        freshness: 'LAST_KNOWN',
        caption: 'Waiting for a GPS fix',
        accessibilityLabel: 'Map area. Waiting for this phone to find its position.',
    };
}
