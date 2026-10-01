// Who may read, update and dismiss emergency requests.
//
// The dispatch side of an emergency — listing every SOS, reading one, moving it
// through Pending -> Assigned -> Resolved, dismissing it — is an operator's job,
// and each of those records carries a passenger's name, phone, location and
// accessibility needs. So it is ADMIN ONLY, decided here rather than by which
// screen happens to call it.
//
// The rule is the project's existing admin gate (authenticateAdmin, as the
// report review and analytics routes use), with one narrowing on top, taken
// from ongoingJourneyAuthorization: a scoped credential (journey sharing) or a
// vehicle-bound session is refused whatever role it also carries.
//
//   no session (missing, malformed, expired or badly signed token) -> 401
//   any role other than ADMIN, a scoped or vehicle-bound token     -> 403
//
// Messages are fixed strings: nothing about the token is echoed back.

import { JwtPayload } from '../config/jwt';
import { emergencyCorsHeaders, emergencyErrorResponse } from './emergencies';
import { adminReviewerId, authenticateAdmin } from './reportAdminReview';

const FORBIDDEN_MESSAGE = 'Only an administrator can manage emergency requests.';

export type EmergencyAdminAuthorization =
    | { ok: true; admin: JwtPayload }
    | { ok: false; response: Response };

/** Authenticates the caller and establishes that they are an unscoped admin. */
export async function authenticateEmergencyAdmin(request: Request): Promise<EmergencyAdminAuthorization> {
    const auth = await authenticateAdmin(request, emergencyCorsHeaders, FORBIDDEN_MESSAGE);

    if (!auth.ok) return auth;

    if (auth.admin.scope || auth.admin.busId) {
        return { ok: false, response: emergencyErrorResponse(403, FORBIDDEN_MESSAGE) };
    }

    return auth;
}

/**
 * The actor recorded on an emergency's history, assignment and resolution.
 *
 * Read off the verified admin session — its email, as this route has always
 * recorded, else the account id — and never from the request body: a
 * `changedBy` the client sends is a claim, not an audit trail.
 */
export function emergencyActorOf(admin: JwtPayload): string {
    const email = typeof admin.email === 'string' ? admin.email.trim() : '';

    return email || adminReviewerId(admin) || 'Admin Dispatcher';
}
