import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    emergencyCorsHeaders,
    emergencyErrorResponse,
    getEmergencyDetail,
    updateEmergencyStatus,
    EmergencyConflictError,
} from '../../../src/shared/server/emergencies';
import {
    authenticateEmergencyAdmin,
    emergencyActorOf,
} from '../../../src/shared/server/emergencyAdminAuthorization';

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
// Retrieves detailed information for a single emergency request, exactly as
// stored. Nothing is "enriched" from other records: an old emergency with
// incomplete details is shown incomplete, never patched with another user's
// name, phone or vehicle.
//
// ADMIN ONLY (authenticateEmergencyAdmin), checked before anything is read.
export async function GET(request: Request, context: any) {
    try {
        const auth = await authenticateEmergencyAdmin(request);
        if (!auth.ok) return auth.response;

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
//
// ADMIN ONLY. The actor recorded is the verified admin session; a `changedBy`
// in the body is ignored.
export async function PATCH(request: Request, context: any) {
    try {
        const auth = await authenticateEmergencyAdmin(request);
        if (!auth.ok) return auth.response;

        const emergencyId = extractEmergencyId(request, context);
        if (!emergencyId) {
            return emergencyErrorResponse(400, 'Emergency ID is required.');
        }

        const body = await request.json().catch(() => null);
        if (!body || (!body.status && !body.directiveMessage)) {
            return emergencyErrorResponse(400, "New status ('PENDING', 'ASSIGNED', or 'RESOLVED') is required.");
        }

        const actorId = emergencyActorOf(auth.admin);

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

// DELETE /api/emergencies/:emergencyId
//
// Dismisses or clears an emergency request from the active system.
//
// ADMIN ONLY, checked before the record is read or deleted.
export async function DELETE(request: Request, context: any) {
    try {
        const auth = await authenticateEmergencyAdmin(request);
        if (!auth.ok) return auth.response;

        const emergencyId = extractEmergencyId(request, context);
        if (!emergencyId) {
            return emergencyErrorResponse(400, 'Emergency ID is required.');
        }

        const db = getAdminDb();
        const docRef = db.collection ? db.collection('emergencies').doc(emergencyId) : null;
        if (!docRef) {
            return emergencyErrorResponse(404, `Emergency request '${emergencyId}' not found.`);
        }

        const snap = await docRef.get().catch(() => null);
        if (!snap || !snap.exists) {
            return emergencyErrorResponse(404, `Emergency request '${emergencyId}' not found.`);
        }

        if (typeof docRef.delete === 'function') {
            await docRef.delete();
        }

        return Response.json(
            {
                success: true,
                message: `Emergency request '${emergencyId}' dismissed successfully.`,
            },
            { status: 200, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        console.error('Delete Emergency API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to delete emergency request.');
    }
}

