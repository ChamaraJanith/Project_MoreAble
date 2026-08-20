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
     * This is the claim Bus Login fills once it has resolved the number plate
     * it was given to a bus record. It is what lets a route tell WHICH bus is
     * calling, instead of trusting the id in the URL. Optional because every
     * token minted today is person-shaped and carries no such claim.
     */
    busId?: string;
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
        // is; omitted entirely from the person-shaped sessions minted today.
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
        };
    } catch (error) {
        console.error('JWT Verification Failed:', error);
        return null;
    }
}
