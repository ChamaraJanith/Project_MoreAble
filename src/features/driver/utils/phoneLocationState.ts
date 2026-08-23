// What the driver sees about their phone's location (MOV-264).
//
// The location service (MOV-263) answers with a reading or a typed failure.
// This turns either into something a driver can act on: what happened, and
// which button will actually fix it.
//
// Kept as plain functions with no React and no UI imports, because the project
// has no React renderer configured for tests — so this is the part that CAN be
// covered, and the screen above it stays a thin shell around it.
//
// It decides nothing about publishing. Sending a reading to the backend is
// MOV-265, and repeating it on a timer is MOV-262.

import { PublishLocationError } from '../api/busLocationApi';
import { PhoneLocation, PhoneLocationError } from '../../../shared/utils/phoneLocation';

export type PhoneLocationStatus =
    /** Nothing asked for yet. The driver has not pressed anything. */
    | 'IDLE'
    /** A request is in flight. */
    | 'REQUESTING'
    /** A real reading was obtained. */
    | 'AVAILABLE'
    /** The app does not have location permission. */
    | 'PERMISSION_DENIED'
    /** Location is switched off for the whole device. */
    | 'LOCATION_SERVICES_DISABLED'
    /** Permission and services are fine, but no position could be fixed. */
    | 'POSITION_UNAVAILABLE'
    /** Something failed that the location service did not classify. */
    | 'UNKNOWN_ERROR'
    /** A reading is on its way to the backend. */
    | 'PUBLISHING'
    /** A reading reached the backend and passengers can see it. */
    | 'PUBLISHED'
    /** A reading was obtained but could not be sent. */
    | 'PUBLISH_FAILED'
    /** No bus is signed in on this phone, so there is nothing to publish as. */
    | 'NOT_SIGNED_IN';

export interface PhoneLocationState {
    status: PhoneLocationStatus;
    /** The last successful reading, or null. Never a stand-in value. */
    location: PhoneLocation | null;
    /**
     * Whether the system will still prompt for permission. Only meaningful on
     * `PERMISSION_DENIED`, and only when the platform actually reported it.
     */
    canAskAgain?: boolean;
}

export const initialPhoneLocationState: PhoneLocationState = {
    status: 'IDLE',
    location: null,
};

/**
 * A request has started.
 *
 * The previous reading is kept: it was true when it was taken, and blanking the
 * screen while a refresh runs would be a worse experience than leaving it up.
 */
export function locationRequestStarted(state: PhoneLocationState): PhoneLocationState {
    return { status: 'REQUESTING', location: state.location };
}

/** A real reading arrived. */
export function locationReceived(location: PhoneLocation): PhoneLocationState {
    return { status: 'AVAILABLE', location };
}

/**
 * A request failed.
 *
 * The three reasons the service distinguishes stay distinguished here, because
 * a driver fixes each of them somewhere different. Anything unrecognised
 * becomes `UNKNOWN_ERROR` rather than being reported as a permission problem
 * the driver does not actually have.
 *
 * The previous reading is dropped: once a request has failed there is no
 * telling whether the bus has moved since, and a stale position presented as
 * current is exactly what the live-status feature must not do.
 */
export function locationRequestFailed(error: unknown): PhoneLocationState {
    if (error instanceof PhoneLocationError) {
        if (error.reason === 'PERMISSION_DENIED') {
            return {
                status: 'PERMISSION_DENIED',
                location: null,
                canAskAgain: error.canAskAgain,
            };
        }

        if (error.reason === 'LOCATION_SERVICES_DISABLED') {
            return { status: 'LOCATION_SERVICES_DISABLED', location: null };
        }

        if (error.reason === 'POSITION_UNAVAILABLE') {
            return { status: 'POSITION_UNAVAILABLE', location: null };
        }
    }

    return { status: 'UNKNOWN_ERROR', location: null };
}

/**
 * The reading is on its way to the backend.
 *
 * The position stays on screen throughout — it was really obtained, and only
 * the sharing of it is still in doubt.
 */
export function locationPublishStarted(state: PhoneLocationState): PhoneLocationState {
    return { status: 'PUBLISHING', location: state.location };
}

/** The backend confirmed it stored the reading. */
export function locationPublished(state: PhoneLocationState): PhoneLocationState {
    return { status: 'PUBLISHED', location: state.location };
}

/**
 * The reading could not be sent.
 *
 * A signed-out phone is separated from every other failure, because retrying
 * will never fix it — the driver has to sign the bus in again. Everything else
 * is worth another attempt.
 */
export function locationPublishFailed(
    state: PhoneLocationState,
    error: unknown
): PhoneLocationState {
    if (error instanceof PublishLocationError && error.reason === 'NOT_AUTHENTICATED') {
        return { status: 'NOT_SIGNED_IN', location: state.location };
    }

    return { status: 'PUBLISH_FAILED', location: state.location };
}

/** No bus session on this device, so nothing can be published. */
export function busNotSignedIn(state: PhoneLocationState): PhoneLocationState {
    return { status: 'NOT_SIGNED_IN', location: state.location };
}

/**
 * True while anything is running, so the screen can refuse a second attempt.
 *
 * Covers publishing as well as the GPS read: a driver pressing twice must not
 * start two requests, whichever half of the flow is still going.
 */
export function isLocationRequestInFlight(state: PhoneLocationState): boolean {
    return state.status === 'REQUESTING' || state.status === 'PUBLISHING';
}

/** What pressing a button should do. */
export type PhoneLocationActionKind =
    /** Ask the location service again, then publish what it returns. */
    | 'REQUEST'
    /** Send the driver to the system settings screen. */
    | 'OPEN_SETTINGS'
    /** Send the driver back to bus sign in. */
    | 'SIGN_IN'
    /** Turn the periodic tracking loop on (MOV-268). */
    | 'START_TRACKING'
    /** Turn the periodic tracking loop off (MOV-268). */
    | 'STOP_TRACKING';

export interface PhoneLocationAction {
    kind: PhoneLocationActionKind;
    label: string;
}

/** The three colour treatments the card has styling for. */
export type PhoneLocationTone = 'neutral' | 'success' | 'warning';

/**
 * The Ionicons this card may show.
 *
 * Named so the tracking view (MOV-268) draws from exactly this set rather than
 * introducing icons the card has no styling for.
 */
export type PhoneLocationIcon =
    | 'locate-outline'
    | 'navigate'
    | 'lock-closed-outline'
    | 'location-outline'
    | 'alert-circle-outline';

/**
 * Everything the screen needs to render one state.
 *
 * `icon` and `title` both change with the state, so the difference is never
 * carried by colour alone — a requirement for this project's users, and one
 * that a tone value on its own would quietly break.
 */
export interface PhoneLocationView {
    tone: PhoneLocationTone;
    icon: PhoneLocationIcon;
    title: string;
    description: string;
    /** Absent while a request is in flight, so nothing can be pressed twice. */
    primaryAction?: PhoneLocationAction;
    secondaryAction?: PhoneLocationAction;
    isBusy: boolean;
}

/**
 * Turns a state into driver-facing words and buttons.
 *
 * The wording is deliberately about the phone and what to do next, never about
 * the internal reason code or the native error underneath it. A driver reading
 * "POSITION_UNAVAILABLE" learns nothing they can act on.
 */
export function describePhoneLocationState(state: PhoneLocationState): PhoneLocationView {
    switch (state.status) {
        case 'REQUESTING':
            return {
                tone: 'neutral',
                icon: 'locate-outline',
                title: 'Getting your location…',
                description: 'Please keep the app open while the phone finds its position.',
                isBusy: true,
            };

        case 'AVAILABLE':
            return {
                tone: 'success',
                icon: 'navigate',
                title: 'Location available',
                description: 'This phone can share where the bus is.',
                primaryAction: { kind: 'REQUEST', label: 'Update location' },
                isBusy: false,
            };

        case 'PUBLISHING':
            return {
                tone: 'neutral',
                icon: 'locate-outline',
                title: 'Sharing your location…',
                description: 'Sending this bus position so passengers can see it.',
                isBusy: true,
            };

        case 'PUBLISHED':
            return {
                tone: 'success',
                icon: 'navigate',
                title: 'Location shared',
                description: 'Passengers can now see where this bus is.',
                primaryAction: { kind: 'REQUEST', label: 'Update location' },
                isBusy: false,
            };

        case 'PUBLISH_FAILED':
            // The position was obtained; only sending it failed, so the same
            // action that got it will try the whole thing again.
            return {
                tone: 'warning',
                icon: 'alert-circle-outline',
                title: 'Location not shared',
                description:
                    'The bus position could not be sent just now. Passengers will not see it until it goes through.',
                primaryAction: { kind: 'REQUEST', label: 'Try again' },
                isBusy: false,
            };

        case 'NOT_SIGNED_IN':
            // Retrying cannot fix this one, so no retry is offered.
            return {
                tone: 'warning',
                icon: 'lock-closed-outline',
                title: 'This bus is signed out',
                description:
                    'Sign in with the bus number plate and password to start sharing its location again.',
                primaryAction: { kind: 'SIGN_IN', label: 'Go to bus sign in' },
                isBusy: false,
            };

        case 'PERMISSION_DENIED':
            // The one state where the right button depends on the platform:
            // once the system will not prompt again, an "Allow" button does
            // nothing at all and settings is the only way through.
            return state.canAskAgain === false
                ? {
                      tone: 'warning',
                      icon: 'lock-closed-outline',
                      title: 'Location permission is off',
                      description:
                          'MoreAble can no longer ask for location on this phone. Turn on location permission for MoreAble in your phone settings.',
                      primaryAction: { kind: 'OPEN_SETTINGS', label: 'Open settings' },
                      isBusy: false,
                  }
                : {
                      tone: 'warning',
                      icon: 'lock-closed-outline',
                      title: 'Location permission is needed',
                      description:
                          "Allow location access so passengers can see where this bus is. Nothing is shared until you're ready.",
                      primaryAction: { kind: 'REQUEST', label: 'Allow location' },
                      secondaryAction: { kind: 'OPEN_SETTINGS', label: 'Open settings' },
                      isBusy: false,
                  };

        case 'LOCATION_SERVICES_DISABLED':
            return {
                tone: 'warning',
                icon: 'location-outline',
                title: 'Location services are turned off',
                description:
                    'Turn on location services for this phone, then try again. This is a phone setting, not a MoreAble one.',
                primaryAction: { kind: 'OPEN_SETTINGS', label: 'Open settings' },
                secondaryAction: { kind: 'REQUEST', label: 'Try again' },
                isBusy: false,
            };

        case 'POSITION_UNAVAILABLE':
            return {
                tone: 'warning',
                icon: 'alert-circle-outline',
                title: 'Current location unavailable',
                description:
                    'The phone could not find its position. Move somewhere with a clearer view of the sky and try again.',
                primaryAction: { kind: 'REQUEST', label: 'Try again' },
                isBusy: false,
            };

        case 'UNKNOWN_ERROR':
            return {
                tone: 'warning',
                icon: 'alert-circle-outline',
                title: 'Something went wrong',
                description: 'The location could not be checked just now. Please try again.',
                primaryAction: { kind: 'REQUEST', label: 'Try again' },
                isBusy: false,
            };

        case 'IDLE':
        default:
            // Nothing is requested until the driver asks, so opening the screen
            // never triggers a permission prompt on its own.
            return {
                tone: 'neutral',
                icon: 'locate-outline',
                title: 'Location sharing is off',
                description:
                    'Turn on location to let passengers see where this bus is on their journey.',
                primaryAction: { kind: 'REQUEST', label: 'Enable location' },
                isBusy: false,
            };
    }
}
