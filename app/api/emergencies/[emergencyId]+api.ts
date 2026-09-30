import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    emergencyCorsHeaders,
    emergencyErrorResponse,
    getEmergencyDetail,
    updateEmergencyStatus,
    EmergencyConflictError,
} from '../../../src/shared/server/emergencies';
import { authenticateRequest } from '../../../src/shared/api/authMiddleware';

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: emergencyCorsHeaders,
    });
}

function extractEmergencyId(request: Request, context: any): string {
    if (context?.params?.emergencyId) return String(context.params.emergencyId).trim();
    if (context?.emergencyId) return String(context.emergencyId).trim();

    try {
        const url = new URL(request.url);
        const segments = url.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        if (last && last !== 'emergencies') return decodeURIComponent(last).trim();
    } catch {
        // Malformed url yields no id
    }

    return '';
}

// GET /api/emergencies/:emergencyId
//
// Retrieves detailed information for a single emergency request.
export async function GET(request: Request, context: any) {
    try {
        const emergencyId = extractEmergencyId(request, context);
        if (!emergencyId) {
            return emergencyErrorResponse(400, 'Emergency ID is required.');
        }

        const db = getAdminDb();
        const emergency = await getEmergencyDetail(db, emergencyId);

        if (!emergency) {
            return emergencyErrorResponse(404, `Emergency request '${emergencyId}' not found.`);
        }

        return Response.json(
            {
                success: true,
                message: 'Emergency request retrieved successfully.',
                emergency,
            },
            { status: 200, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        console.error('Get Emergency Detail API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to retrieve emergency details.');
    }
}

// PATCH /api/emergencies/:emergencyId
//
// Updates emergency status: Pending -> Assigned -> Resolved
// Enforces history recording with timestamp, actor, notes, and responder data.
export async function PATCH(request: Request, context: any) {
    try {
        const emergencyId = extractEmergencyId(request, context);
        if (!emergencyId) {
            return emergencyErrorResponse(400, 'Emergency ID is required.');
        }

        const body = await request.json().catch(() => null);
        if (!body || !body.status) {
            return emergencyErrorResponse(400, "New status ('PENDING', 'ASSIGNED', or 'RESOLVED') is required.");
        }

        const user = await authenticateRequest(request).catch(() => null);
        const actorId = body.changedBy || user?.email || (user as any)?.name || 'Admin Dispatcher';

        const db = getAdminDb();
        const updated = await updateEmergencyStatus(db, emergencyId, body, actorId);

        return Response.json(
            {
                success: true,
                message: `Emergency status updated to '${updated.status}' successfully.`,
                emergency: updated,
            },
            { status: 200, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        if (error instanceof EmergencyConflictError) {
            return emergencyErrorResponse(error.statusCode, error.message);
        }
        console.error('Update Emergency Status API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to update emergency status.');
    }
}
