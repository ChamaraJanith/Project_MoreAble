import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    createEmergency,
    emergencyCorsHeaders,
    emergencyErrorResponse,
    listEmergencies,
    EmergencyConflictError,
} from '../../../src/shared/server/emergencies';
import { authenticateRequest } from '../../../src/shared/api/authMiddleware';

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: emergencyCorsHeaders,
    });
}

// GET /api/emergencies
//
// Lists emergency requests, ordered by newest first.
// Supports ?status=PENDING|ASSIGNED|RESOLVED|ALL and ?search=
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const statusParam = url.searchParams.get('status') || undefined;
        const searchParam = url.searchParams.get('search') || undefined;

        const db = getAdminDb();
        const emergencies = await listEmergencies(db, {
            status: statusParam === 'ALL' ? undefined : statusParam,
            search: searchParam,
        });

        return Response.json(
            {
                success: true,
                message: 'Emergency requests retrieved successfully.',
                count: emergencies.length,
                emergencies,
            },
            { status: 200, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        console.error('Get Emergencies API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to retrieve emergency requests.');
    }
}

// POST /api/emergencies
//
// Triggered when an SOS emergency is initiated by a passenger or conductor.
// Initializes the request with status 'PENDING' and records initial status history.
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body) {
            return emergencyErrorResponse(400, 'Request body is required.');
        }

        const user = await authenticateRequest(request).catch(() => null);
        const creatorName = user?.email || (user as any)?.name || body.passenger?.name || 'Passenger SOS';

        const db = getAdminDb();
        const emergency = await createEmergency(db, body, creatorName);

        return Response.json(
            {
                success: true,
                message: 'Emergency request registered successfully. Dispatching support.',
                emergency,
            },
            { status: 201, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        if (error instanceof EmergencyConflictError) {
            return emergencyErrorResponse(error.statusCode, error.message);
        }
        console.error('Create Emergency API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to create emergency request.');
    }
}
