// Bus Device Login, from the phone (MOV-265).
//
// Sends the plate and password once, in exchange for a session token. The
// password goes to this route and nowhere else — it is never stored on the
// device and never travels to the location endpoint.

import { API_BASE_URL } from '../../../shared/api/config';
import { BusSession } from '../../../shared/utils/busSession';

/**
 * Signs a bus in.
 *
 * Returns the session to store: the authenticated bus id, its plate for
 * display, and the token that proves this phone is that bus.
 *
 * Throws an `Error` carrying a message safe to show, the way every other client
 * in this project reports a failed request. The server's wording is used when
 * it has one, since the login route writes its messages for the driver.
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
        throw new Error('Network error. Please check your connection and try again.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to sign in right now. Please try again.');
    }

    if (typeof data.token !== 'string' || typeof data.bus?.busId !== 'string') {
        // A response without both halves cannot produce a working session, and
        // storing half of one would fail later at the location endpoint with a
        // much more confusing message.
        throw new Error('Sign in did not complete. Please try again.');
    }

    return {
        busId: data.bus.busId,
        numberPlate: data.bus.numberPlate ?? numberPlate.trim().toUpperCase(),
        token: data.token,
    };
}
