// Who may report where a bus is (MOV-265).
//
// Kept apart from the location route because this is the part of GPS ingestion
// that changes as the project grows, while validating a coordinate and storing
// it do not. Isolating it means the rule can tighten later without disturbing
// anything else in that handler.
//
// The rule that matters:
//
//     driver's phone -> Bus Login -> busId claim -> PUT /api/buses/{busId}/location
//
// A session that identifies a vehicle may move that vehicle, and no other. The
// id in the URL names the resource being addressed; it is never evidence that
// the caller owns it.

import { JwtPayload } from '../config/jwt';

/** Role held by an operator (admin) account. */
export const OPERATOR_ROLE = 'ADMIN';

/** Role carried by a Bus Login session. */
export const VEHICLE_ROLE = 'BUS';

export type LocationReportAuthorization =
    | {
        allowed: true;
        /**
         * The bus the caller is cleared to move. Equal to the id in the URL,
         * but returned separately so the handler writes against a value that
         * passed authorisation rather than one it merely parsed.
         */
        busId: string;
        via: 'VEHICLE_SESSION' | 'OPERATOR_SESSION';
    }
    | { allowed: false; status: 401 | 403; message: string };

/**
 * Decides whether `account` may report a position for `busId`.
 *
 * Two paths, in this order:
 *
 * 1. A vehicle session — the intended one, now that Bus Login issues tokens
 *    carrying a bus identity. The bus is named by the token, so the token and
 *    the URL must agree before anything is written.
 *
 * 2. An operator session — retained from before drivers could authenticate as
 *    their own bus, so an admin tool reporting a position keeps working.
 *
 * The vehicle path is tested first on purpose. A session that identifies a bus
 * is answerable to the ownership rule whatever role it also happens to carry,
 * so it can never fall through and be waved past on a role alone.
 */
export function authoriseLocationReport(
    account: JwtPayload | null,
    busId: string
): LocationReportAuthorization {
    if (!account) {
        return { allowed: false, status: 401, message: 'Authentication required.' };
    }

    if (account.role === VEHICLE_ROLE || typeof account.busId === 'string') {
        const authenticatedBusId =
            typeof account.busId === 'string' ? account.busId.trim() : '';

        // Fails closed: a vehicle session that cannot say which vehicle it is
        // has nothing to compare against, so it authorises nothing.
        if (!authenticatedBusId) {
            return {
                allowed: false,
                status: 403,
                message: 'This session does not identify a vehicle.',
            };
        }

        if (authenticatedBusId !== busId) {
            return {
                allowed: false,
                status: 403,
                message: 'A vehicle may only report its own location.',
            };
        }

        return { allowed: true, busId, via: 'VEHICLE_SESSION' };
    }

    if (account.role !== OPERATOR_ROLE) {
        return {
            allowed: false,
            status: 403,
            message: 'Only an operator account may report a vehicle location.',
        };
    }

    return { allowed: true, busId, via: 'OPERATOR_SESSION' };
}
