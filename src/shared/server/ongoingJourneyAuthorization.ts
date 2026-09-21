// Who may read an ongoing journey and its live position (MOV-296).
//
// Kept apart from the route, like vehicleLocationAuthorization, so the rule can
// be read and tested on its own. The whole chain is:
//
//     verified passenger session              (this module)
//        -> CONFIRMED booking owned by it     (passengerOngoingJourney)
//        -> booking.tripId
//        -> running journey of that tripId
//        -> vehicle position stamped with that tripId and run
//
// This module decides only the first step: whether the session is a passenger,
// and which one. The identity comes from the verified token and nothing else —
// never a passengerId or tripId in the URL, body or headers, which the route
// does not read at all.

import { JwtPayload } from '../config/jwt';

/** Role carried by a passenger login session. */
export const PASSENGER_ROLE = 'PASSENGER';

/** The booking owner id used for bookings made without an account. */
const GUEST_USER_ID = 'GUEST';

export type OngoingJourneyAuthorization =
    | { allowed: true; passengerId: string }
    | { allowed: false; status: 401 | 403; message: string };

/**
 * Decides whether `account` may read its own ongoing journey, and as whom.
 *
 * - no session (missing, malformed, expired or badly signed token) -> 401
 * - a narrowed credential (e.g. journey-sharing), a vehicle session, or any
 *   role other than PASSENGER (operators included)                  -> 403
 * - a passenger session that names no usable passenger              -> 403
 *
 * Messages are fixed strings: nothing about the token is echoed back.
 */
export function authoriseOngoingJourneyAccess(account: JwtPayload | null): OngoingJourneyAuthorization {
    if (!account) {
        return { allowed: false, status: 401, message: 'Authentication required.' };
    }

    // Checked before the role: a scoped or vehicle-bound token is refused
    // whatever role it also carries.
    if (account.scope || account.busId || account.role !== PASSENGER_ROLE) {
        return { allowed: false, status: 403, message: 'Only a passenger account has ongoing journeys.' };
    }

    const passengerId = typeof account.passengerId === 'string' ? account.passengerId.trim() : '';

    // Fails closed: without an owner id there is no booking to match, and the
    // guest id is shared by every booking made without an account.
    if (!passengerId || passengerId === GUEST_USER_ID) {
        return { allowed: false, status: 403, message: 'This session does not identify a passenger.' };
    }

    return { allowed: true, passengerId };
}
