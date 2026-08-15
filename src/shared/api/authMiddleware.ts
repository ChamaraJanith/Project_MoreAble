// Auth Middleware — Extracts and verifies JWT from API request headers
// Usage: const user = await authenticateRequest(request);

import { JwtPayload, verifyToken } from '../config/jwt';

/**
 * Extract the Bearer token from the Authorization header,
 * verify it, and return the decoded user payload.
 *
 * Returns null if no token is present or if the token is invalid/expired.
 */
export async function authenticateRequest(
    request: Request
): Promise<JwtPayload | null> {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    return verifyToken(token);
}

/**
 * Helper to create a standardized 401 Unauthorized response.
 */
export function unauthorizedResponse(
    message = 'Authentication required.',
    headers: Record<string, string> = {}
): Response {
    return Response.json(
        { success: false, message },
        {
            status: 401,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                ...headers,
            },
        }
    );
}
