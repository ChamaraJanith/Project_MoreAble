import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { recordAccessibilityScoreSafely } from '../../../../src/shared/server/accessibilityScoreHistory';
import { loadBusRatingContext, submitBusRating } from '../../../../src/shared/server/busRating';
import { authoriseOngoingJourneyAccess } from '../../../../src/shared/server/ongoingJourneyAuthorization';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function bookingIdOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The same refusals for reading and rating: nothing about someone else's booking leaks. */
function journeyRefusal(kind: 'NOT_FOUND' | 'NOT_COMPLETED' | 'NO_BUS') {
  if (kind === 'NOT_FOUND') return fail(404, 'Completed journey not found.', 'JOURNEY_NOT_FOUND');
  if (kind === 'NOT_COMPLETED') return fail(409, 'You can rate the bus once your journey has completed.', 'JOURNEY_NOT_COMPLETED');
  return fail(409, 'The bus for this journey is not recorded, so it cannot be rated.', 'BUS_NOT_RECORDED');
}

// GET /api/journeys/completed/rating?bookingId=BK-...
//
// What the Rate this bus screen shows: the bus that ran the signed-in
// passenger's completed journey (from the fleet record, allow-listed), its
// accessibility facilities, and the passenger's own rating for that run if
// they already gave one. Access is GET /api/journeys/completed's (MOV-296).
//
// POST /api/journeys/completed/rating   { "bookingId": "BK-...", "rating": 1-5, "busId"?: "BUS-..." }
//
// Rates that bus, once per passenger per run. The passenger is the session's;
// the bus and the run come from the booking's completion record. `busId`, if
// sent, must be that bus — it is never used in its place. Skipping sends
// nothing, so there is no 0-star rating. Rating never touches the journey.
export async function GET(request: Request) {
  try {
    const authorization = authoriseOngoingJourneyAccess(await authenticateRequest(request));

    if (!authorization.allowed) {
      return authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(authorization.status, authorization.message);
    }

    const bookingId = bookingIdOf(new URL(request.url).searchParams.get('bookingId'));
    if (!bookingId) return fail(400, 'bookingId is required.');

    const result = await loadBusRatingContext(getAdminDb(), authorization.passengerId, bookingId);
    if (result.kind !== 'OK') return journeyRefusal(result.kind);

    return Response.json(
      { success: true, message: 'Bus rating details retrieved successfully.', ...result.context },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Bus Rating Details API Error:', error);

    // Fixed wording: no Firebase, token or stack detail reaches the client.
    return fail(500, 'Failed to load the bus for this journey.');
  }
}

export async function POST(request: Request) {
  try {
    const authorization = authoriseOngoingJourneyAccess(await authenticateRequest(request));

    if (!authorization.allowed) {
      return authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(authorization.status, authorization.message);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Invalid request body.');

    const bookingId = bookingIdOf(body.bookingId);
    if (!bookingId) return fail(400, 'bookingId is required.');

    const adminDb = getAdminDb();

    // Only these three are read. passengerId, userId, tripId and createdAt in
    // the body are ignored: they come from the session and the server.
    const result = await submitBusRating(adminDb, authorization.passengerId, {
      bookingId,
      busId: typeof body.busId === 'string' ? body.busId : null,
      rating: body.rating,
    });

    switch (result.kind) {
      case 'RATED':
        // A new rating can change the bus's accessibility score (MOV-113).
        // Best effort: the rating is already saved.
        await recordAccessibilityScoreSafely(adminDb, result.rating.busId);

        return Response.json(
          { success: true, message: 'Thank you for rating this bus.', rating: result.rating },
          { status: 201, headers: corsHeaders }
        );
      case 'INVALID_RATING':
        return fail(400, 'Rating must be a whole number from 1 to 5.', 'INVALID_RATING');
      case 'ALREADY_RATED':
        return fail(409, 'You have already rated the bus for this journey.', 'ALREADY_RATED');
      case 'BUS_MISMATCH':
        return fail(409, 'This is not the bus you travelled on for this journey.', 'BUS_MISMATCH');
      default:
        return journeyRefusal(result.kind);
    }
  } catch (error: any) {
    console.error('Bus Rating Submit API Error:', error);

    return fail(500, 'Failed to save your rating.');
  }
}
