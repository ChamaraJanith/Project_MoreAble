// JWT Token Utilities (Server-Side) — used by API Routes
// Uses 'jose' library which is Edge-compatible (no Node.js native deps)

import { jwtVerify, SignJWT } from 'jose';

// JWT Secret — loaded from environment variable
// The secret is encoded to Uint8Array for jose
const getJwtSecret = (): Uint8Array => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is not set.');
    }
    return new TextEncoder().encode(secret);
};

// JWT Payload shape — claims embedded in every token
export interface JwtPayload {
    uid: string;
    passengerId: string;
    role: string;
    email: string;
    /**
     * Set only on a session that represents a vehicle rather than a person.
     *
     * Bus Login fills this once it has resolved a number plate to a bus
     * record; it is what later lets a route tell WHICH bus is calling rather
     * than trusting an id supplied in a request. Optional because every
     * person-shaped session minted by the user login carries no such claim.
     */
    busId?: string;
    /**
     * Narrows what a token may be used for. Absent on every login session.
     * Set to JOURNEY_SHARING_SCOPE on the credential a started journey shares
     * its location with (MOV-294).
     */
    scope?: string;
    /** The trip a journey-sharing token was issued for. */
    tripId?: string;
}

/**
 * The scope of a journey's location-sharing credential (MOV-294).
 *
 * Start Journey hands the device this narrow token so location sharing can
 * outlive the dashboard sign-in: logging out ends the bus session, not the
 * journey. It names one bus and one trip, expires with the journey's window,
 * and may only report that bus's position — routes that change a journey
 * refuse it.
 */
export const JOURNEY_SHARING_SCOPE = 'JOURNEY_LOCATION';

/** Issues the location-sharing credential for a started journey. */
export async function generateJourneySharingToken(
    busId: string,
    tripId: string,
    expiresAt: Date
): Promise<string> {
    const secret = getJwtSecret();

    return new SignJWT({
        uid: busId,
        passengerId: busId,
        role: 'BUS',
        email: '',
        busId,
        tripId,
        scope: JOURNEY_SHARING_SCOPE,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .setIssuer('moreable-api')
        .setSubject(busId)
        .sign(secret);
}

/**
 * Generate a signed JWT token with user claims.
 * Token expires in 7 days.
 */
export async function generateToken(payload: JwtPayload): Promise<string> {
    const secret = getJwtSecret();

    const token = await new SignJWT({
        uid: payload.uid,
        passengerId: payload.passengerId,
        role: payload.role,
        email: payload.email,
        // Only ever set by a caller that has already established which bus it
        // is; omitted entirely from person-shaped sessions.
        ...(payload.busId ? { busId: payload.busId } : {}),
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .setIssuer('moreable-api')
        .setSubject(payload.uid)
        .sign(secret);

    return token;
}

/**
 * Verify a JWT token and return the decoded payload.
 * Returns null if the token is invalid or expired.
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
    try {
        const secret = getJwtSecret();

        const { payload } = await jwtVerify(token, secret, {
            issuer: 'moreable-api',
        });

        return {
            uid: payload.uid as string,
            passengerId: payload.passengerId as string,
            role: payload.role as string,
            email: payload.email as string,
            busId: typeof payload.busId === 'string' ? payload.busId : undefined,
            scope: typeof payload.scope === 'string' ? payload.scope : undefined,
            tripId: typeof payload.tripId === 'string' ? payload.tripId : undefined,
        };
    } catch (error) {
        console.error('JWT Verification Failed:', error);
        return null;
    }
}
