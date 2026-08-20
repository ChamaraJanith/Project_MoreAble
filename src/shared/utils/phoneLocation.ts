// The driver's phone as a GPS source (MOV-263).
//
// One reading, on request. This is the only place in the app that talks to the
// device's location hardware, so the permission prompt and the native error
// handling live here once rather than in every screen that wants a position.
//
// Deliberately not to be confused with `shared/api/locationService`, which
// turns a place NAME into coordinates via Nominatim for passenger journey
// search. This module is the opposite direction and a different source: it asks
// the handset where it physically is.
//
// It has no knowledge of buses, sessions or the network. Publishing a reading
// to `PUT /api/buses/{busId}/location` belongs to MOV-265, and repeating the
// reading on a timer belongs to MOV-262 — neither happens here.

import * as Location from 'expo-location';

/**
 * One position fix from the handset.
 *
 * Shaped to match the body the GPS ingestion endpoint already accepts, so
 * MOV-265 can forward it without reshaping anything.
 */
export interface PhoneLocation {
    latitude: number;
    longitude: number;
    /** ISO 8601 time of the fix itself, not of the request that published it. */
    recordedAt: string;
}

/**
 * Why a reading could not be taken.
 *
 * Separated from the message so a caller can branch on the cause — MOV-264
 * needs to tell "turn on location services" apart from "grant the app
 * permission", which are different things for the driver to fix.
 */
export type PhoneLocationErrorReason =
    | 'PERMISSION_DENIED'
    | 'LOCATION_SERVICES_DISABLED'
    | 'POSITION_UNAVAILABLE';

const MESSAGES: Record<PhoneLocationErrorReason, string> = {
    PERMISSION_DENIED:
        'Location permission is needed to share this bus location. Please allow location access.',
    LOCATION_SERVICES_DISABLED:
        'Location services are turned off on this device. Please turn them on and try again.',
    POSITION_UNAVAILABLE:
        'Could not get the current location. Please make sure the device has a clear GPS signal and try again.',
};

/**
 * A location failure the app can act on.
 *
 * Still a plain `Error` carrying a message safe to show, which is how the rest
 * of this project reports a failed operation; `reason` is the addition that
 * lets a caller respond to the specific cause. The underlying native error is
 * kept on `cause` for diagnostics and is never surfaced to a driver.
 */
export class PhoneLocationError extends Error {
    readonly reason: PhoneLocationErrorReason;

    /**
     * The underlying native error, for diagnostics only.
     *
     * Declared here rather than relying on the built-in `Error.cause`, which
     * this project's TypeScript target does not expose — and changing that
     * target for one field would be a change to shared config.
     */
    readonly cause?: unknown;

    constructor(reason: PhoneLocationErrorReason, options?: { cause?: unknown }) {
        super(MESSAGES[reason]);
        this.name = 'PhoneLocationError';
        this.reason = reason;
        if (options?.cause !== undefined) {
            this.cause = options.cause;
        }
    }
}

/**
 * Accuracy for a vehicle on a road.
 *
 * `High` is roughly ten metres, enough to place a bus on the right street.
 * `BestForNavigation` is deliberately avoided: it turns on sensor fusion meant
 * for turn-by-turn guidance and costs noticeably more battery, which matters on
 * a phone expected to last a driver's whole shift.
 */
const LOCATION_ACCURACY = Location.Accuracy.High;

function isUsableCoordinate(latitude: unknown, longitude: unknown): boolean {
    return (
        typeof latitude === 'number' &&
        typeof longitude === 'number' &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    );
}

/**
 * Turns the platform's fix time into the ISO string the backend stores.
 *
 * Falls back to the current time only when the platform reports no usable
 * timestamp, which is a stand-in for a moment that has just happened — not an
 * invented one. The coordinates themselves are never substituted this way.
 */
function toRecordedAt(timestamp: unknown): string {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        const fixTime = new Date(timestamp);
        if (!Number.isNaN(fixTime.getTime())) {
            return fixTime.toISOString();
        }
    }

    return new Date().toISOString();
}

/**
 * Asks the handset where it is, once.
 *
 * Requests foreground location permission if it has not been granted yet —
 * only foreground, because this reads a position while the driver has the app
 * open. Background permission belongs with continuous tracking (MOV-262) and
 * is not requested here.
 *
 * Resolves with a real reading or throws a `PhoneLocationError`. There is no
 * fallback coordinate: when the phone cannot say where it is, the honest answer
 * is a failure, and a made-up position would put a bus somewhere it is not on
 * a passenger's map.
 *
 * Coordinates are never logged — a driver's precise position is personal data,
 * and this returns it to the caller rather than writing it anywhere.
 */
export async function getCurrentPhoneLocation(): Promise<PhoneLocation> {
    let permission: Location.LocationPermissionResponse;

    try {
        permission = await Location.requestForegroundPermissionsAsync();
    } catch (error) {
        // The prompt itself can fail — an unsupported platform, or a config
        // problem. Treated as "no permission" rather than crashing the caller.
        throw new PhoneLocationError('PERMISSION_DENIED', { cause: error });
    }

    if (!permission?.granted) {
        throw new PhoneLocationError('PERMISSION_DENIED');
    }

    // Checked separately because granting the app permission does nothing while
    // location is switched off for the whole device, and the driver fixes those
    // two situations in different places.
    let servicesEnabled: boolean;

    try {
        servicesEnabled = await Location.hasServicesEnabledAsync();
    } catch (error) {
        throw new PhoneLocationError('LOCATION_SERVICES_DISABLED', { cause: error });
    }

    if (!servicesEnabled) {
        throw new PhoneLocationError('LOCATION_SERVICES_DISABLED');
    }

    let position: Location.LocationObject;

    try {
        position = await Location.getCurrentPositionAsync({ accuracy: LOCATION_ACCURACY });
    } catch (error) {
        // Indoors, no signal yet, or a native failure. All the same to a
        // caller: there is no position to report right now.
        throw new PhoneLocationError('POSITION_UNAVAILABLE', { cause: error });
    }

    const latitude = position?.coords?.latitude;
    const longitude = position?.coords?.longitude;

    // A reading that is not a real point on the Earth is no reading at all.
    // Catching it here keeps it out of the ingestion endpoint, which would
    // reject it anyway, and out of any map that might draw it first.
    if (!isUsableCoordinate(latitude, longitude)) {
        throw new PhoneLocationError('POSITION_UNAVAILABLE');
    }

    return {
        latitude,
        longitude,
        recordedAt: toRecordedAt(position.timestamp),
    };
}
