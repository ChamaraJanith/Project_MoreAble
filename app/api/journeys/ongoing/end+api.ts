import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { authoriseOngoingJourneyAccess } from '../../../../src/shared/server/ongoingJourneyAuthorization';
import { completePassengerJourney } from '../../../../src/shared/server/passengerJourneyCompletion';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function fail(status: number, message: string, code?: string) {
  return Response.json({ success: false, message, ...(code ? { code } : {}) }, { status, headers: corsHeaders });
}

// POST /api/journeys/ongoing/end   { "bookingId"?: "BK-..." }
//
// The passenger's own End Journey (MOV-297). Completes the signed-in
// passenger's running journey, and theirs only. The bus's journey on the trip
// (MOV-294) keeps running, its location sharing carries on, and every other
// passenger on it stays ongoing. See passengerJourneyCompletion.
//
// Access is exactly GET /api/journeys/ongoing's (MOV-296): a verified
// PASSENGER session only. `bookingId` is optional and only picks among the
// passenger's own running journeys. Nothing else in the body (passengerId,
// userId, tripId, busId, routeId, completedAt) is read: whose journey, which
// run and what time all come from the session and the server.
//
// Safe to repeat: a journey already finished (by an earlier request, or by the
// bus) is reported with its original record, never recorded twice.
export async function POST(request: Request) {
  try {
    const authorization = authoriseOngoingJourneyAccess(await authenticateRequest(request));

    if (!authorization.allowed) {
      return authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(authorization.status, authorization.message);
    }

    const body = await request.json().catch(() => null);
    const bookingId = typeof body?.bookingId === 'string' && body.bookingId.trim() ? body.bookingId.trim() : null;

    const result = await completePassengerJourney(getAdminDb(), authorization.passengerId, bookingId);

    if (result.kind === 'NO_ONGOING_JOURNEY') {
      return fail(409, 'You have no ongoing journey to end.', 'NO_ONGOING_JOURNEY');
    }

    if (result.kind === 'AMBIGUOUS') {
      return fail(409, 'Choose which journey to end.', 'JOURNEY_NOT_SPECIFIED');
    }

    return Response.json(
      {
        success: true,
        message: result.kind === 'COMPLETED' ? 'Journey completed.' : 'This journey was already completed.',
        alreadyCompleted: result.kind === 'ALREADY_COMPLETED',
        bookingIds: result.bookingIds,
        completion: {
          completedAt: result.completion.completedAt,
          completionReason: result.completion.completionReason,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Passenger End Journey API Error:', error);

    // Fixed wording: no Firebase, token or stack detail reaches the client.
    return fail(500, 'Failed to end your journey.');
  }
}
