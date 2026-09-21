import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { authoriseOngoingJourneyAccess } from '../../../src/shared/server/ongoingJourneyAuthorization';
import { loadPassengerCompletedJourneys } from '../../../src/shared/server/passengerJourneyCompletion';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function fail(status: number, message: string) {
  return Response.json({ success: false, message }, { status, headers: corsHeaders });
}

// GET /api/journeys/completed[?include=route]
//
// The signed-in passenger's finished journeys (MOV-297): each booking whose
// journey they ended themselves, or that finished when the bus ended the run.
// Same access, and the same allow-listed booking view, as
// GET /api/journeys/ongoing (MOV-296); never the raw booking document. No
// identifier is read from the request: the passenger is the session's.
//
// `?include=route` adds each journey's planned path, for the detail screen.
export async function GET(request: Request) {
  try {
    const authorization = authoriseOngoingJourneyAccess(await authenticateRequest(request));

    if (!authorization.allowed) {
      return authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(authorization.status, authorization.message);
    }

    const includeRoute = new URL(request.url).searchParams.get('include') === 'route';
    const journeys = await loadPassengerCompletedJourneys(getAdminDb(), authorization.passengerId, { includeRoute });

    return Response.json(
      {
        success: true,
        message: journeys.length > 0 ? 'Completed journeys retrieved successfully.' : 'No completed journeys.',
        journeys,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Completed Journeys API Error:', error);

    // Fixed wording: no Firebase, token or stack detail reaches the client.
    return fail(500, 'Failed to retrieve your completed journeys.');
  }
}
