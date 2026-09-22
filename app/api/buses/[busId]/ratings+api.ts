import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { loadBusRatingSummary } from '../../../../src/shared/server/busRating';

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

/**
 * Pulls the bus id out of /api/buses/:busId/ratings.
 *
 * The id is the second-to-last segment, read exactly as the sibling location
 * route reads its own.
 */
function extractBusId(request: Request, context: any): string {
  const fromContext = context?.params?.busId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const ratingsIndex = parts.lastIndexOf('ratings');
  const candidate = ratingsIndex > 0 ? parts[ratingsIndex - 1] : '';

  return candidate && candidate !== 'buses' ? decodeURIComponent(candidate) : '';
}

// GET /api/buses/:busId/ratings
//
// How one bus stands with its passengers (MOV-80): the average of the ratings
// they gave it after travelling on it, and how many there are.
//
// Read-only, and deliberately so. Nothing here recalculates an accessibility
// score or appends to the score history (MOV-113) — that belongs to the routes
// that CHANGE the evidence, and a passenger opening a bus's feedback must not
// write a history entry.
//
// The figure returned is NOT the accessibility score's rating component. That
// one is pulled toward a neutral 3 and remapped onto 0–100 before being weighed
// at 20% against facilities and community reports; this is the plain mean on the
// 1–5 scale the passenger chose from. Both exist, and the app shows them apart.
//
// Verified community reports are NOT served here. They already have an endpoint
// — GET /api/reports?scope=verified — and adding a second path to the same
// documents would be two places for "what a passenger may read about a bus" to
// drift apart.
export async function GET(request: Request, context?: any) {
  try {
    // A passenger-facing read, behind the same sign-in every other passenger
    // read sits behind. Any authenticated account may ask: the response says
    // how a bus was rated and names nobody who rated it.
    const account = await authenticateRequest(request);

    if (!account) {
      return unauthorizedResponse('Authentication required.', corsHeaders);
    }

    const busId = extractBusId(request, context);

    if (!busId) {
      return Response.json(
        {
          success: false,
          message: 'Bus ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // The summary is of the ratings filed against this id, which is the whole
    // question. Whether a bus document still exists is a different one: a
    // retired vehicle keeps the ratings it earned, and a bus nobody has rated
    // and one that was never in the fleet both honestly answer "no ratings".
    // So the fleet record is not read, and no 404 is invented from its absence.
    const summary = await loadBusRatingSummary(getAdminDb(), busId);

    return Response.json(
      {
        success: true,
        message: 'Bus ratings retrieved successfully.',
        summary,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Bus Ratings API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve bus ratings.',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
