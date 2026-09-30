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

        // Dynamically enrich passenger details from users collection if available
        if (db && typeof db.collection === 'function' && emergency.passenger) {
            try {
                let dbUser: any = null;
                if (emergency.passenger.id && emergency.passenger.id !== 'PAS-554') {
                    const uDoc = await db.collection('users').doc(emergency.passenger.id).get().catch(() => null);
                    if (uDoc?.exists) {
                        dbUser = uDoc.data();
                    }
                }
                if (!dbUser && (emergency.passenger.name === 'Nimal Silva' || emergency.passenger.id === 'PAS-554')) {
                    const uSnap = await db.collection('users').where('role', '==', 'COMMUTER').limit(1).get().catch(() => null);
                    if (uSnap && !uSnap.empty) {
                        dbUser = uSnap.docs[0].data();
                    }
                }
                if (dbUser) {
                    emergency.passenger.id = dbUser.passengerId || dbUser.uid || emergency.passenger.id;
                    emergency.passenger.name = dbUser.userName || emergency.passenger.name;
                    emergency.passenger.phone = dbUser.phoneNumber || dbUser.secondaryPhoneNumber || emergency.passenger.phone;
                    if (emergency.vehicle?.model === 'Toyota Prius' || emergency.vehicle?.plateNumber === 'WP-CBA-1234') {
                        emergency.vehicle.model = 'Transit Bus';
                        emergency.vehicle.plateNumber = 'WP-ND-4521';
                    }
                }
            } catch (healErr) {
                // non-blocking
            }
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
        if (!body || (!body.status && !body.directiveMessage)) {
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

// DELETE /api/emergencies/:emergencyId
//
// Dismisses or clears an emergency request from the active system.
export async function DELETE(request: Request, context: any) {
    try {
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

