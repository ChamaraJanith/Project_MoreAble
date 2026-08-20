// Bus Device Login, from the driver's phone (MOV-265).
//
// Exchanges the plate and the credential the driver typed for a session token,
// once. The credential goes to this one route and nowhere else: it is not
// stored on the device, not kept after this call, and not written to any log.
//
// Follows the same contract as the rest of the project's clients — a response
// counts as successful only when the transport succeeded AND the body says so,
// and a failure throws an Error carrying a message safe to show.

import { API_BASE_URL } from '../../../shared/api/config';
import { BusSession } from '../../../shared/utils/busSession';

const SIGN_IN_FAILED = 'Unable to sign in right now. Please try again.';

/**
 * Signs a bus in.
 *
 * Returns the session to persist: the authenticated bus id, the plate for
 * display, and the token proving this phone is that bus.
 *
 * The bus id comes from the response and only from the response. The plate the
 * driver typed identifies the vehicle to the backend, but it is not an id and
 * is never used as one.
 */
export async function loginBus(numberPlate: string, password: string): Promise<BusSession> {
    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}/api/auth/bus-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numberPlate, password }),
        });
    } catch {
        // Offline, DNS, server unreachable — distinct from a refused sign in,
        // because trying again may well work.
        throw new Error('Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    // Both halves are required. A 2xx alone does not mean the bus was
    // authenticated: anything that is not this route — a proxy, a tunnel, a
    // page served for an unmatched path — can answer 200, and treating that as
    // a sign in would send a driver onward with no real session.
    if (!response.ok || !data?.success) {
        throw new Error(data?.message || SIGN_IN_FAILED);
    }

    const busId = data.bus?.busId;
    const token = data.token;

    if (typeof busId !== 'string' || !busId.trim() || typeof token !== 'string' || !token.trim()) {
        // Half a session is worse than none: it would be stored, then fail
        // later somewhere far less obvious than here.
        throw new Error('Sign in did not complete. Please try again.');
    }

    return {
        busId,
        numberPlate: typeof data.bus?.numberPlate === 'string' ? data.bus.numberPlate : '',
        token,
    };
}
