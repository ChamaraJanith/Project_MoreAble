import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { VEHICLE_ROLE } from '../../../src/shared/server/vehicleLocationAuthorization';
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
// with that bus's live position when it was reported for that trip. See
// passengerOngoingJourney for the matching.
//
// The passenger is the session's, and only the session's. There is no
// passengerId parameter: one supplied in the URL is ignored, so no caller can
// ask about anyone else's journey.
//
// Nothing running is a normal answer, not an error:
//   { success: true, ongoing: false, journeys: [] }
export async function GET(request: Request) {
  try {
    const account = await authenticateRequest(request);

    if (!account) {
      return unauthorizedResponse('Authentication required.', corsHeaders);
    }

    // A bus session or a journey-sharing credential identifies a vehicle, not
    // a traveller, and has no bookings of its own.
    if (account.scope || account.busId || account.role === VEHICLE_ROLE) {
      return fail(403, 'Only a passenger account has ongoing journeys.');
    }

    const passengerId = typeof account.passengerId === 'string' ? account.passengerId.trim() : '';

    if (!passengerId) {
      return fail(403, 'This session does not identify a passenger.');
    }

    const journeys = await loadPassengerOngoingJourneys(getAdminDb(), passengerId);

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

    return fail(500, 'Failed to retrieve your ongoing journey.');
  }
}
