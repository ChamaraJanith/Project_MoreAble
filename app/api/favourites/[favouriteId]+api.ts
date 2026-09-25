// DELETE /api/favourites/[favouriteId] — remove a saved journey pair (MOV-101).
//
// Owner only. The ownership check itself lives in MOV-100's
// `removeFavouriteRoute`, which compares the stored passengerId against the one
// it is given and answers NOT_FOUND for a favourite that is missing AND for one
// belonging to somebody else. That indistinguishability is the point — a
// passenger learns nothing about anyone else's favourites by trying ids — so
// this route passes the verified identity through and maps the answer, rather
// than re-deciding it.

import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { removeFavouriteRoute } from '../../../src/shared/server/favouriteRoutes';
import { authoriseOngoingJourneyAccess } from '../../../src/shared/server/ongoingJourneyAuthorization';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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

/**
 * The favourite id from the route.
 *
 * Read from the router's params where they are given, and from the path
 * otherwise, because the handlers are also called directly with a plain params
 * object — the same arrangement /api/reports/[reportId] already uses.
 *
 * The path branch decodes, which matters more here than it does for a report
 * id: a favourite id is itself percent-encoded (MOV-100 escapes '/' and every
 * other unsafe character in a stop name), so a client sends it
 * `encodeURIComponent`-ed and one decode restores exactly the stored id.
 */
function extractFavouriteId(request: Request, context: any): string {
  if (context?.params?.favouriteId) return String(context.params.favouriteId).trim();
  if (context?.favouriteId) return String(context.favouriteId).trim();

  try {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];

    if (last && last !== 'favourites') return decodeURIComponent(last).trim();
  } catch {
    // A malformed url simply yields no id, and the caller answers 404.
  }

  return '';
}

export async function DELETE(request: Request, context: any) {
  try {
    const account = await authenticateRequest(request);
    const authorization = authoriseOngoingJourneyAccess(account);

    if (!authorization.allowed) {
      return authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(403, 'Only a passenger account has favourite routes.');
    }

    const favouriteId = extractFavouriteId(request, context);

    const result = await removeFavouriteRoute(
      getAdminDb(),
      authorization.passengerId,
      favouriteId
    );

    if (result.kind === 'MISSING_PASSENGER') {
      // Unreachable behind the gate above; answered rather than assumed away.
      return unauthorizedResponse('Authentication required.', corsHeaders);
    }

    // Covers an id that is missing from the path, one that no longer exists,
    // and one that belongs to another passenger — deliberately the same answer
    // for all three.
    if (result.kind === 'NOT_FOUND') {
      return fail(404, 'Favourite route not found.');
    }

    return Response.json(
      { success: true, message: 'Removed from your favourite routes.' },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Remove Favourite Route API Error:', error);

    // Fixed wording: no Firebase detail, token or stack reaches the client.
    return fail(500, 'Failed to remove this favourite route.');
  }
}
