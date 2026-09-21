import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { authoriseOngoingJourneyAccess } from '../../../src/shared/server/ongoingJourneyAuthorization';
import { loadPassengerOngoingJourneys } from '../../../src/shared/server/passengerOngoingJourney';

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

// GET /api/journeys/ongoing
//
// The signed-in passenger's ongoing journey (MOV-295): their own CONFIRMED
// booking whose exact trip the bus has started with Start Journey (MOV-294),
// with that bus's live position when it was reported for that trip's current
// run. See passengerOngoingJourney for the matching.
//
// Access (MOV-296): a verified PASSENGER session only — see
// ongoingJourneyAuthorization. The passenger is the session's, and the trip is
// derived from that passenger's own bookings. Nothing is read from the URL,
// body or custom headers, so a passengerId or tripId supplied there cannot
// change whose journey, or which trip, is returned.
//
// Nothing running is a normal answer, not an error:
//   { success: true, ongoing: false, journeys: [] }
export async function GET(request: Request) {
  try {
    const authorization = authoriseOngoingJourneyAccess(await authenticateRequest(request));

    if (!authorization.allowed) {
      return authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(authorization.status, authorization.message);
    }

    const journeys = await loadPassengerOngoingJourneys(getAdminDb(), authorization.passengerId);

    return Response.json(
      {
        success: true,
        message: journeys.length > 0 ? 'Ongoing journey retrieved successfully.' : 'No ongoing journey.',
        ongoing: journeys.length > 0,
        journeys,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Ongoing Journey API Error:', error);

    // Fixed wording: no Firebase, token or stack detail reaches the client.
    return fail(500, 'Failed to retrieve your ongoing journey.');
  }
}
