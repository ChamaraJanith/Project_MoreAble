// What the driver sees while the bus is tracking (MOV-268).
//
// MOV-267 built the loop and deliberately left the screen alone. This is the
// missing half: it turns the state that loop produces into words, an icon and
// a button.
//
// It is a VIEW over the existing state model, not a second state machine.
// There are no new statuses and no new transitions — `phoneLocationState` still
// owns all of those. The only thing added here is the second dimension the card
// needs and a single status could never carry: whether the loop is running.
// "No fix yet" reads very differently when tracking is on (temporary, it will
// try again) from when it is off (that attempt is over).
//
// So the pair (status, isTracking) decides the wording. When tracking is off
// this delegates to `describePhoneLocationState`, which keeps every state the
// driver already knew reading exactly as it did before MOV-268.
//
// Kept free of React and of UI imports, like the rest of `driver/utils`, so the
// mapping is testable in a project that has no React renderer.

import {
    PhoneLocationAction,
    PhoneLocationIcon,
    PhoneLocationState,
    PhoneLocationTone,
    describePhoneLocationState,
} from './phoneLocationState';

/** Everything the card renders for one (state, tracking) pair. */
export interface TrackingCardView {
    tone: PhoneLocationTone;
    icon: PhoneLocationIcon;
    title: string;
    description: string;
    /** True while a round is mid-flight, so the badge can show a spinner. */
    isBusy: boolean;
    /**
     * The tracking on/off control.
     *
     * Absent only when there is nothing to toggle — a signed-out phone has
     * nothing to publish as, so it is offered sign in instead.
     */
    trackingAction?: PhoneLocationAction;
    /** A problem-fixing action, such as opening settings or signing in. */
    primaryAction?: PhoneLocationAction;
    secondaryAction?: PhoneLocationAction;
}

const START_TRACKING: PhoneLocationAction = {
    kind: 'START_TRACKING',
    label: 'Start sharing location',
};

const STOP_TRACKING: PhoneLocationAction = {
    kind: 'STOP_TRACKING',
    label: 'Stop sharing location',
};

const OPEN_SETTINGS: PhoneLocationAction = { kind: 'OPEN_SETTINGS', label: 'Open settings' };

/**
 * States where the one-off "update now" button is redundant once a tracking
 * control is on the card.
 *
 * In these the driver has no problem to fix, so two buttons offering to send a
 * position — one once, one continuously — is a choice with no meaning. In every
 * other state the existing action reads as recovery ("Try again", "Allow
 * location") and is kept.
 *
 * Nothing is lost by dropping it: starting tracking publishes immediately.
 */
const REDUNDANT_MANUAL_ACTION_STATES = ['IDLE', 'AVAILABLE', 'PUBLISHED'] as const;

/**
 * Turns the current state and the loop's on/off flag into one card.
 *
 * Never reports a GPS problem as a sending problem or the other way round: the
 * two arrive as different statuses and are given different titles, different
 * icons and different descriptions here.
 *
 * Nothing internal is ever put in front of the driver — no status name, no
 * reason code, no server wording, and nothing from the session.
 */
export function describeTrackingCard(
    state: PhoneLocationState,
    isTracking: boolean
): TrackingCardView {
    return isTracking ? describeWhileTracking(state) : describeWhileStopped(state);
}

/**
 * Tracking is off.
 *
 * The existing description is reused unchanged, so every state a driver already
 * recognised still reads the same, and the tracking control is added on top.
 */
function describeWhileStopped(state: PhoneLocationState): TrackingCardView {
    const view = describePhoneLocationState(state);

    // A phone with no bus session cannot publish, so starting is not offered —
    // the existing view already points at sign in, which is the only thing that
    // will help.
    if (state.status === 'NOT_SIGNED_IN') {
        return {
            tone: view.tone,
            icon: view.icon,
            title: view.title,
            description: view.description,
            isBusy: view.isBusy,
            primaryAction: view.primaryAction,
            secondaryAction: view.secondaryAction,
        };
    }

    const manualActionIsRedundant = (
        REDUNDANT_MANUAL_ACTION_STATES as readonly string[]
    ).includes(state.status);

    return {
        tone: view.tone,
        icon: view.icon,
        // The one state whose wording changes: "off" now means tracking is off,
        // which is a thing the driver can turn on, rather than a phone that has
        // simply not been asked yet.
        title: state.status === 'IDLE' ? 'Location tracking is off' : view.title,
        description:
            state.status === 'IDLE'
                ? 'Start sharing to let passengers see where this bus is on their journey.'
                : view.description,
        isBusy: view.isBusy,
        trackingAction: START_TRACKING,
        primaryAction: manualActionIsRedundant ? undefined : view.primaryAction,
        secondaryAction: manualActionIsRedundant ? undefined : view.secondaryAction,
    };
}

/**
 * Tracking is on.
 *
 * Every state here says so, because the single most useful thing a driver can
 * know is whether passengers are still being told where the bus is. A failure
 * while tracking is a setback the loop will retry, not the end of it, and the
 * wording says that rather than implying the driver has to do something.
 *
 * Stopping is offered in every one of these, and never taken away mid-round: a
 * driver must always be able to turn sharing off.
 */
function describeWhileTracking(state: PhoneLocationState): TrackingCardView {
    switch (state.status) {
        // The gap between starting and the first reading arriving.
        case 'IDLE':
        case 'REQUESTING':
            return {
                tone: 'neutral',
                icon: 'locate-outline',
                title: 'Waiting for GPS',
                description:
                    'Tracking is on. Getting the current position from this phone.',
                isBusy: true,
                trackingAction: STOP_TRACKING,
            };

        // A fix is in hand and on its way out.
        case 'AVAILABLE':
        case 'PUBLISHING':
            return {
                tone: 'neutral',
                icon: 'locate-outline',
                title: 'Sending your location',
                description: 'Tracking is on. Sharing this bus position with passengers.',
                isBusy: true,
                trackingAction: STOP_TRACKING,
            };

        case 'PUBLISHED':
            return {
                tone: 'success',
                icon: 'navigate',
                title: 'Tracking active',
                description:
                    'Your location is being updated automatically. Passengers can see where this bus is.',
                isBusy: false,
                trackingAction: STOP_TRACKING,
            };

        // ----------------------------------------------------------
        // The position could not be obtained.
        //
        // Three separate causes, kept apart because the driver fixes each one
        // somewhere different. None of them mentions sending, because sending
        // is not what failed.
        // ----------------------------------------------------------
        case 'PERMISSION_DENIED':
            return {
                tone: 'warning',
                icon: 'lock-closed-outline',
                title: 'Location permission is off',
                description:
                    'Tracking is on but this phone will not share its position. Allow location access for MoreAble to start sharing again.',
                isBusy: false,
                trackingAction: STOP_TRACKING,
                primaryAction: OPEN_SETTINGS,
            };

        case 'LOCATION_SERVICES_DISABLED':
            return {
                tone: 'warning',
                icon: 'location-outline',
                title: 'Location services are off',
                description:
                    'Tracking is on but location is switched off for this phone. Turn it on and sharing will pick up by itself.',
                isBusy: false,
                trackingAction: STOP_TRACKING,
                primaryAction: OPEN_SETTINGS,
            };

        case 'POSITION_UNAVAILABLE':
            return {
                tone: 'warning',
                icon: 'alert-circle-outline',
                title: 'Location unavailable',
                description:
                    'Your location is temporarily unavailable. Tracking is still on and will keep trying.',
                isBusy: false,
                trackingAction: STOP_TRACKING,
            };

        // ----------------------------------------------------------
        // The position was fine; getting it to the backend was not.
        //
        // Worded so it can never be mistaken for a GPS problem — the driver has
        // no reason to go looking at the sky or at their location settings.
        // ----------------------------------------------------------
        case 'PUBLISH_FAILED':
            return {
                tone: 'warning',
                icon: 'alert-circle-outline',
                title: 'Unable to send location',
                description:
                    'Your location was found, but could not be sent. Tracking is still on and will try again.',
                isBusy: false,
                trackingAction: STOP_TRACKING,
            };

        // The loop stops itself on this one, so the card is normally already
        // showing the stopped version by the time anything renders. Handled
        // anyway rather than falling through to a wrong message.
        case 'NOT_SIGNED_IN':
            return describeWhileStopped(state);

        case 'UNKNOWN_ERROR':
        default:
            return {
                tone: 'warning',
                icon: 'alert-circle-outline',
                title: 'Location unavailable',
                description:
                    'The location could not be checked just now. Tracking is still on and will keep trying.',
                isBusy: false,
                trackingAction: STOP_TRACKING,
            };
    }
}
