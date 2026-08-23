// One round of "where is this bus, and tell the backend" (MOV-267).
//
// This is the sequence MOV-265 established, lifted out of the screen that used
// to hold it: read the phone's position, look up the bus this phone is signed
// in as, and send the reading to that bus's location endpoint.
//
// It was extracted rather than rewritten because MOV-267 needs the same
// sequence twice — once when the driver presses the button, and once per tick
// of the tracking loop — and two copies of it would eventually disagree. None
// of the three steps is reimplemented here: `getCurrentPhoneLocation`,
// `getBusSession` and `publishBusLocation` are the same functions as before.
//
// No React, in keeping with the rest of `driver/utils`, so the orchestration
// this file describes is testable even though the screen around it is not.

import { BusSession, getBusSession } from '../../../shared/utils/busSession';
import { PhoneLocation, getCurrentPhoneLocation } from '../../../shared/utils/phoneLocation';
import { PublishLocationError, publishBusLocation } from '../api/busLocationApi';
import {
    PhoneLocationState,
    busNotSignedIn,
    locationPublishFailed,
    locationPublishStarted,
    locationPublished,
    locationReceived,
    locationRequestFailed,
    locationRequestStarted,
} from './phoneLocationState';

/**
 * How a cycle ended.
 *
 * The state model already says what to SHOW; this says what a caller should DO
 * next, which is a different question and only the tracking loop asks it. The
 * split matters for one case: a signed-out phone will fail identically forever,
 * so a loop must stop, while every other failure is worth another tick.
 */
export type PublishCycleOutcome =
    /** The backend confirmed the position. */
    | 'PUBLISHED'
    /** The phone could not say where it is. Nothing was sent. */
    | 'LOCATION_UNAVAILABLE'
    /** No usable bus session, so there is nothing to publish as. */
    | 'NOT_SIGNED_IN'
    /** A real reading could not be delivered. Worth retrying. */
    | 'PUBLISH_FAILED';

/**
 * Applies one transition to whatever the current state is.
 *
 * Shaped as a reducer rather than a value so it matches React's functional
 * `setState` exactly — the screen passes its setter straight in, and the
 * tracking loop passes a version that drops updates from a run that has since
 * been stopped.
 */
export type PhoneLocationStateUpdate = (
    reduce: (current: PhoneLocationState) => PhoneLocationState
) => void;

/**
 * The three real-world things a cycle touches.
 *
 * Injectable so a test can drive the sequence without device hardware; the
 * defaults are the production functions and nothing else is ever substituted in
 * the app itself.
 */
export interface PublishCycleDependencies {
    readLocation: () => Promise<PhoneLocation>;
    readSession: () => Promise<BusSession | null>;
    publish: (
        busId: string,
        location: PhoneLocation,
        sessionCredential: string
    ) => Promise<void>;
}

const LIVE_DEPENDENCIES: PublishCycleDependencies = {
    readLocation: getCurrentPhoneLocation,
    readSession: getBusSession,
    publish: publishBusLocation,
};

/**
 * Reads a position and publishes it once.
 *
 * Never throws: every failure becomes a driver-facing state and an outcome, so
 * a caller looping over this cannot be killed by one bad tick.
 *
 * The reading is passed through untouched — the same `recordedAt` the phone
 * reported travels to the backend, because that is the fix time passengers see
 * the age of, not the time the request happened to go out. Coordinates are
 * never substituted or defaulted: when there is no position there is no
 * publish, which is what keeps an invented location off a passenger's map.
 *
 * Both the bus id and the credential come from the stored session and nowhere
 * else. Nothing here derives an id from a number plate, and the password is
 * neither read nor held — it was exchanged for the session token at sign in.
 */
export async function runPublishCycle(
    update: PhoneLocationStateUpdate,
    dependencies: PublishCycleDependencies = LIVE_DEPENDENCIES
): Promise<PublishCycleOutcome> {
    update(locationRequestStarted);

    let reading: PhoneLocation;

    try {
        reading = await dependencies.readLocation();
    } catch (error) {
        // Classified into a driver-facing state; the native error is never
        // rendered. Nothing is published when there is no position to publish.
        update(() => locationRequestFailed(error));
        return 'LOCATION_UNAVAILABLE';
    }

    update(() => locationReceived(reading));

    // `getBusSession` already answers null for unreadable storage rather than
    // throwing, but a loop must not be able to die on a storage fault, so the
    // guarantee is made here rather than assumed.
    const session: BusSession | null = await dependencies.readSession().catch(() => null);

    if (!session) {
        update(busNotSignedIn);
        return 'NOT_SIGNED_IN';
    }

    update(locationPublishStarted);

    try {
        await dependencies.publish(session.busId, reading, session.token);
    } catch (error) {
        update((current) => locationPublishFailed(current, error));

        // Mirrors the rule `locationPublishFailed` applies to the state: a
        // credential the server will not accept is the one publishing failure
        // that retrying cannot fix.
        return error instanceof PublishLocationError && error.reason === 'NOT_AUTHENTICATED'
            ? 'NOT_SIGNED_IN'
            : 'PUBLISH_FAILED';
    }

    update(locationPublished);
    return 'PUBLISHED';
}
