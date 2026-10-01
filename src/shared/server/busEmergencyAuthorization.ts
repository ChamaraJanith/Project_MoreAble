// Who may use the bus crew's emergency console (vehicle dashboard).
//
// The dispatch side of an emergency is ADMIN ONLY (emergencyAdminAuthorization).
// The crew on the bus the passenger is riding need a much smaller slice of it:
// see their own bus's open emergencies, message Control Center about one, and
// confirm it resolved. That slice is decided here, and nothing in it widens the
// admin gate.
//
// The rule, as vehicleLocationAuthorization applies it to a bus's position:
//
//     bus device -> Bus Login -> busId claim -> /api/buses/{busId}/emergencies
//
// A Bus Login session may act for its own bus and no other. The busId in the
// URL names the bus being addressed; it must equal the token's busId claim,
// and is never itself evidence of who is calling. Nothing in a request body —
// busId, changedBy, passengerId, recipients — is read as identity.
//
//   no session (missing, malformed, expired or badly signed token)  -> 401
//   a scoped credential (journey location sharing)                  -> 403
//   any role other than BUS (PASSENGER, ADMIN, ...)                 -> 403
//   a BUS session naming no bus, or a different bus from the URL    -> 403
//
// An emergency is then the bus's only when emergency.busId — stamped by POST
// /api/emergencies from the passenger's server-verified journey — equals the
// authenticated busId (busCrewOwnsEmergency). Admins keep their own routes.
//
// Messages are fixed strings: nothing about the token is echoed back.

import { JwtPayload } from '../config/jwt';
import { VEHICLE_ROLE } from './vehicleLocationAuthorization';

export type BusEmergencyAuthorization =
    | { allowed: true; busId: string }
    | { allowed: false; status: 401 | 403; message: string };

/** Decides whether `account` may use the emergency console of `requestedBusId`. */
export function authoriseBusEmergencyAccess(
    account: JwtPayload | null,
    requestedBusId: string
): BusEmergencyAuthorization {
    if (!account) {
        return { allowed: false, status: 401, message: 'Authentication required.' };
    }

    // Checked before the role: the location-sharing credential outlives the
    // dashboard sign-in and may only report the bus's position.
    if (account.scope) {
        return { allowed: false, status: 403, message: 'Sign in to the bus device to respond to an emergency.' };
    }

    if (account.role !== VEHICLE_ROLE) {
        return { allowed: false, status: 403, message: 'Only a signed-in bus can use the bus emergency console.' };
    }

    const authenticatedBusId = typeof account.busId === 'string' ? account.busId.trim() : '';

    // Fails closed: a bus session that cannot say which bus it is owns nothing.
    if (!authenticatedBusId) {
        return { allowed: false, status: 403, message: 'This session does not identify a vehicle.' };
    }

    if (authenticatedBusId !== requestedBusId.trim()) {
        return { allowed: false, status: 403, message: "A bus may only access its own bus's emergencies." };
    }

    return { allowed: true, busId: authenticatedBusId };
}

/**
 * Whether an emergency is the authenticated bus's. Fails closed: an emergency
 * recorded without a bus (no verified journey) belongs to no bus.
 */
export function busCrewOwnsEmergency(emergency: { busId?: unknown } | null | undefined, busId: string): boolean {
    const recorded = typeof emergency?.busId === 'string' ? emergency.busId.trim() : '';
    return !!recorded && !!busId && recorded === busId;
}

/** The actor recorded on history, messages and resolution — always the session's bus. */
export function busCrewActorOf(busId: string): string {
    return `Bus Crew (${busId})`;
}
