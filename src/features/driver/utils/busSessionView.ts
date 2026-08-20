// What the Vehicle Dashboard shows about the bus it is signed in as (MOV-265).
//
// The dashboard reads the stored session and has to decide two things: whether
// this device is genuinely signed in as a vehicle, and what to put on screen
// either way. Both decisions live here rather than in the screen, because the
// project has no React renderer configured for tests — so this is the part that
// can be covered, and the screen stays a thin shell around it.
//
// The token is deliberately absent from the view model. It is needed later to
// authenticate requests, but nothing on a dashboard should ever display it, and
// leaving it out of the only object the screen renders from is what guarantees
// it cannot be shown by accident.
//
// Nothing here reads GPS or contacts the network.

import { BusSession } from '../../../shared/utils/busSession';

export interface BusIdentityView {
    /** True only when a usable vehicle session is stored on this device. */
    signedIn: boolean;
    /** Heading for the identity card, or for the signed-out explanation. */
    title: string;
    /** One line of supporting text. */
    description: string;
    /** The plate, for display. Empty when there is nothing to show. */
    numberPlate: string;
    /** The authenticated bus id, for display. Empty when signed out. */
    busId: string;
}

const SIGNED_OUT_TITLE = 'Bus session unavailable';

/**
 * Whether a stored session can be acted on as a vehicle identity.
 *
 * `getBusSession` already rejects a half-written record, so this is a second,
 * explicit gate at the point of use: a session with no bus cannot say which
 * vehicle this is, and one with no token cannot prove it. Either way the
 * dashboard must not carry on as an authenticated bus.
 */
export function isUsableBusSession(session: BusSession | null | undefined): session is BusSession {
    return (
        !!session &&
        typeof session.busId === 'string' &&
        session.busId.trim().length > 0 &&
        typeof session.token === 'string' &&
        session.token.trim().length > 0
    );
}

/**
 * Turns the stored session into what the dashboard puts on screen.
 *
 * The signed-in case names the vehicle so a driver can confirm at a glance that
 * the right bus is signed in — mixing two buses up is the mistake this display
 * exists to prevent.
 */
export function describeBusSession(session: BusSession | null | undefined): BusIdentityView {
    if (!isUsableBusSession(session)) {
        return {
            signedIn: false,
            title: SIGNED_OUT_TITLE,
            description:
                'This device is not signed in to a bus. Sign in with the bus number plate and password to continue.',
            numberPlate: '',
            busId: '',
        };
    }

    return {
        signedIn: true,
        title: 'Signed in as this bus',
        description: 'Passenger features for this vehicle are linked to this device.',
        // A plate can be absent from an older stored record without making the
        // session unusable, so the id stands in rather than showing a blank.
        numberPlate: session.numberPlate?.trim() || session.busId,
        busId: session.busId,
    };
}
