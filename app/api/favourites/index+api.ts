// GET and POST /api/favourites — the passenger's saved journey pairs (MOV-101).
//
// A thin layer. Everything about how a favourite is stored — the collection, the
// deterministic document id and its encoding, duplicate prevention, ownership,
// ordering and document mapping — belongs to src/shared/server/favouriteRoutes
// (MOV-100) and is not restated here. What this route owns is HTTP: who is
// asking, whether the request is well formed, whether the two places are ones
// this network actually serves, and which status code each outcome deserves.
//
//     verified passenger session        (authoriseOngoingJourneyAccess)
//        -> passengerId                 (from the token, never from the request)
//        -> favouriteRoutes.ts          (MOV-100)
//        -> Firestore
//
// A favourite is an origin and a destination. No trip, bus, route, date, time,
// seat or booking is read from the request or written by it, so a favourite
// cannot go stale when a timetable changes.

import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { Route } from '../../../src/entities/route/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
  FavouriteRouteRejection,
  listFavouriteRoutes,
  saveFavouriteRoute,
} from '../../../src/shared/server/favouriteRoutes';
import { authoriseOngoingJourneyAccess } from '../../../src/shared/server/ongoingJourneyAuthorization';
import { collectKnownLocations, isKnownLocation } from '../journeys/search+api';

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
  return Response.json(
    { success: false, message, ...(code ? { code } : {}) },
    { status, headers: corsHeaders }
  );
}

/**
 * The signed-in passenger, or the response refusing the request.
 *
 * `authoriseOngoingJourneyAccess` is the project's existing "is this a genuine
 * passenger session, and which one" gate, and it is reused rather than
 * re-derived: it already refuses a missing or expired token, a vehicle session,
 * a narrowed journey-sharing credential, any non-passenger role, and the shared
 * GUEST id. Only the 403 wording is this route's own — the rule is not.
 *
 * The identity comes from the verified token and nothing else. No passengerId
 * in a body, query or header is read anywhere in this file.
 */
function authorisePassenger(account: Awaited<ReturnType<typeof authenticateRequest>>) {
  const authorization = authoriseOngoingJourneyAccess(account);

  if (authorization.allowed) return { ok: true as const, passengerId: authorization.passengerId };

  return {
    ok: false as const,
    response:
      authorization.status === 401
        ? unauthorizedResponse(authorization.message, corsHeaders)
        : fail(403, 'Only a passenger account has favourite routes.'),
  };
}

/**
 * The stop names this network actually serves.
 *
 * Exactly what the Journey Search validates against, from the same two sources
 * and through the same `collectKnownLocations`: the stop names of every ACTIVE
 * route, plus the `stops` master collection. Reusing it is what keeps a
 * favourite saveable if and only if it is searchable — a favourite the planner
 * could never run would be worse than a refusal.
 *
 * Stop master data is optional here for the same reason it is optional there:
 * route stops are the primary source, so failing to read it must not make a
 * valid journey unsaveable.
 */
async function loadKnownLocations(adminDb: any): Promise<Set<string>> {
  const routesSnapshot = await adminDb
    .collection('routes')
    .where('status', '==', 'ACTIVE')
    .get();

  const routes: Route[] = (routesSnapshot?.docs ?? []).map((doc: any) => doc.data() as Route);

  let stopNames: string[] = [];

  try {
    const stopsSnapshot = await adminDb.collection('stops').get();

    stopNames = (stopsSnapshot?.docs ?? [])
      .map((doc: any) => doc.data()?.name)
      .filter((name: unknown): name is string => typeof name === 'string');
  } catch {
    // Route stops still answer the question.
  }

  return collectKnownLocations(routes, stopNames);
}

/** Why MOV-100 refused a journey, in words a passenger can act on. */
function rejectionMessage(reason: FavouriteRouteRejection): string {
  if (reason === 'ORIGIN_REQUIRED') return 'A starting location is required.';
  if (reason === 'DESTINATION_REQUIRED') return 'A destination is required.';
  if (reason === 'SAME_LOCATION') return 'Your starting location and destination must be different.';

  return 'That journey is too long to save.';
}

// GET /api/favourites
//
// The signed-in passenger's own favourites, newest first. Which favourites are
// theirs, and what order they come back in, is decided by MOV-100 — this route
// does not query, filter or sort.
//
// No favourites is a successful empty list, never an error.
export async function GET(request: Request) {
  try {
    const authorization = authorisePassenger(await authenticateRequest(request));

    if (!authorization.ok) return authorization.response;

    const favourites = await listFavouriteRoutes(getAdminDb(), authorization.passengerId);

    // `listFavouriteRoutes` already returns the app's own FavouriteRoute shape,
    // with the stored `passengerId` dropped — so ownership never travels to a
    // client that has no use for it.
    return Response.json(
      {
        success: true,
        message: 'Favourite routes retrieved successfully.',
        count: favourites.length,
        favourites,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Favourite Routes API Error:', error);

    // Fixed wording: no Firebase detail, token or stack reaches the client.
    return fail(500, 'Failed to load your favourite routes.');
  }
}

// POST /api/favourites   { "origin": "Colombo Fort", "destination": "Kaduwela" }
//
// Saves one journey pair for the signed-in passenger.
//
// `passengerId`, `favouriteId` and `createdAt` are deliberately never read from
// the body: the owner is the session's, and the id and timestamp are MOV-100's.
// A body that sends them anyway is not refused, it is simply not believed —
// exactly how POST /api/reports treats the same fields.
//
// Saving a pair that is already saved is not an error. It returns the existing
// favourite, unchanged and with its original createdAt, so pressing the star
// twice cannot duplicate a journey or reorder the list.
export async function POST(request: Request) {
  try {
    const authorization = authorisePassenger(await authenticateRequest(request));

    if (!authorization.ok) return authorization.response;

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail(400, 'Invalid request body.');
    }

    const { origin, destination } = body as { origin?: unknown; destination?: unknown };

    if (typeof origin !== 'string' || typeof destination !== 'string') {
      return fail(400, 'origin and destination are required and must be text.');
    }

    const trimmedOrigin = origin.trim();
    const trimmedDestination = destination.trim();

    // Checked here so an empty value is reported as missing rather than as an
    // unknown stop. MOV-100 guards the same two cases again on the way in; that
    // repetition is deliberate defence in depth, not a rule owned twice — the
    // persistence layer must stay safe when called from anywhere.
    if (!trimmedOrigin) return fail(400, rejectionMessage('ORIGIN_REQUIRED'), 'ORIGIN_REQUIRED');
    if (!trimmedDestination) {
      return fail(400, rejectionMessage('DESTINATION_REQUIRED'), 'DESTINATION_REQUIRED');
    }

    const adminDb = getAdminDb();
    const knownLocations = await loadKnownLocations(adminDb);

    // The same refusal, in the same words, as the Journey Search gives an
    // unknown stop.
    if (!isKnownLocation(trimmedOrigin, knownLocations)) {
      return fail(400, 'Invalid origin location', 'UNKNOWN_ORIGIN');
    }

    if (!isKnownLocation(trimmedDestination, knownLocations)) {
      return fail(400, 'Invalid destination location', 'UNKNOWN_DESTINATION');
    }

    // Stored as the passenger gave them, trimmed and nothing more: not
    // lowercased, re-spelled to a stop record's casing or otherwise rewritten.
    // Identity is already case-insensitive inside MOV-100's document id, so the
    // same journey typed two ways is still one favourite.
    const result = await saveFavouriteRoute(adminDb, authorization.passengerId, {
      origin: trimmedOrigin,
      destination: trimmedDestination,
    });

    if (result.kind === 'MISSING_PASSENGER') {
      // Unreachable behind the gate above; answered rather than assumed away.
      return unauthorizedResponse('Authentication required.', corsHeaders);
    }

    if (result.kind === 'INVALID_JOURNEY') {
      return fail(400, rejectionMessage(result.reason), result.reason);
    }

    const alreadySaved = result.kind === 'ALREADY_SAVED';

    return Response.json(
      {
        success: true,
        message: alreadySaved
          ? 'This journey is already in your favourite routes.'
          : 'Journey saved to your favourite routes.',
        // Lets a client tell a fresh save from a repeat without comparing
        // timestamps. Both are successes.
        alreadySaved,
        favourite: result.favourite,
      },
      { status: alreadySaved ? 200 : 201, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Save Favourite Route API Error:', error);

    return fail(500, 'Failed to save this journey to your favourite routes.');
  }
}
