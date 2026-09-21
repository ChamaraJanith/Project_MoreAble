import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { JOURNEY_SHARING_SCOPE, generateJourneySharingToken } from '../../../../src/shared/config/jwt';
import { authoriseLocationReport } from '../../../../src/shared/server/vehicleLocationAuthorization';
import {
  TripJourneyRecord,
  isJourneyActive,
  journeyExpiresAt,
} from '../../../../src/shared/utils/journeyLifecycle';

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
  return Response.json(
    { success: false, message, ...(code ? { code } : {}) },
    { status, headers: corsHeaders }
  );
}

async function journeyResponse(
  message: string,
  journey: TripJourneyRecord,
  now: Date,
  shareFor?: { busId: string; tripId: string }
) {
  const active = isJourneyActive(journey, now);
  const expiresAt = journeyExpiresAt(journey);

  // A running journey hands the device its location-sharing credential, so
  // sharing can carry on after the dashboard signs out (see jwt.ts).
  const sharingToken =
    shareFor && active && expiresAt
      ? await generateJourneySharingToken(shareFor.busId, shareFor.tripId, expiresAt)
      : undefined;

  return Response.json(
    {
      success: true,
      message,
      journey,
      active,
      expiresAt: expiresAt?.toISOString() ?? null,
      ...(sharingToken ? { sharingToken } : {}),
    },
    { status: 200, headers: corsHeaders }
  );
}

/** Pulls the trip id out of /api/trips/:tripId/journey. */
function extractTripId(request: Request, context: any): string {
  const fromContext = context?.params?.tripId ?? context?.tripId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const journeyIndex = parts.lastIndexOf('journey');
  const candidate = journeyIndex > 0 ? parts[journeyIndex - 1] : '';

  return candidate && candidate !== 'trips' ? decodeURIComponent(candidate) : '';
}

// POST /api/trips/:tripId/journey   { "action": "START" | "END" | "SHARE" }
//
// The persisted journey lifecycle (MOV-294). Start Journey records that THIS
// trip is running, stamped with the server's time; End Journey records that it
// has stopped. The record lives on the trip itself (trips/{tripId}.journey), so
// it outlives the bus session that created it: signing the device out ends the
// session, never the journey.
//
// Only the bus assigned to the trip may start or end it — the same "a vehicle
// session may act for its own vehicle only" rule the location endpoint applies.
// A bus runs one journey at a time: starting a trip while another of the same
// bus's trips is running is refused.
//
// START and END are idempotent. Starting a running journey returns it unchanged
// (its startedAt is never reset), and ending one that is not running reports
// the record as it stands.
//
// START and SHARE return the journey's location-sharing credential. SHARE is
// for a signed-in device that finds the journey already running and has no
// credential of its own (another phone, or cleared storage): it never starts,
// restarts or extends a journey, and is refused when none is running.
//
// A location-sharing credential may not call this route: it can report where
// the bus is, never start or end its journey.
export async function POST(request: Request, context?: any) {
  try {
    const tripId = extractTripId(request, context);

    if (!tripId) {
      return fail(400, 'Trip ID is required.');
    }

    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action !== 'START' && action !== 'END' && action !== 'SHARE') {
      return fail(400, 'action must be "START", "END" or "SHARE".');
    }

    const account = await authenticateRequest(request);

    if (!account) {
      return unauthorizedResponse('Authentication required.', corsHeaders);
    }

    if (account.scope === JOURNEY_SHARING_SCOPE) {
      return fail(403, 'Sign in to the bus device to start or end a journey.');
    }

    const adminDb = getAdminDb();
    const tripRef = adminDb.collection('trips').doc(tripId);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return fail(404, 'Trip not found.');
    }

    const trip = tripDoc.data() || {};
    const tripBusId = typeof trip.busId === 'string' ? trip.busId.trim() : '';

    // Authorised against the bus the trip is assigned to, not anything the
    // caller supplied: a bus may only run its own trips.
    const authorization = authoriseLocationReport(account, tripBusId);

    if (!authorization.allowed) {
      if (authorization.status === 401) {
        return unauthorizedResponse(authorization.message, corsHeaders);
      }
      return fail(authorization.status, 'Only the bus assigned to this trip may start or end its journey.');
    }

    const now = new Date();
    const current: TripJourneyRecord | undefined = trip.journey;
    const shareFor = { busId: tripBusId, tripId };

    if (action === 'SHARE') {
      return isJourneyActive(current, now)
        ? journeyResponse('Journey is running.', current, now, shareFor)
        : fail(409, 'This journey is not running.', 'JOURNEY_NOT_STARTED');
    }

    if (action === 'END') {
      if (!isJourneyActive(current, now)) {
        return current
          ? await journeyResponse('This journey is not running.', current, now)
          : fail(409, 'This journey has not been started.', 'JOURNEY_NOT_STARTED');
      }

      const ended: TripJourneyRecord = { ...current, status: 'ENDED', endedAt: now.toISOString() };
      await tripRef.update({ journey: ended });

      return await journeyResponse('Journey ended.', ended, now);
    }

    // ---- START ----
    if (isJourneyActive(current, now)) {
      return await journeyResponse('Journey already started.', current, now, shareFor);
    }

    if (trip.status && trip.status !== 'ACTIVE') {
      return fail(409, 'This trip is not in service.', 'TRIP_INACTIVE');
    }

    const busTrips = await adminDb.collection('trips').where('busId', '==', tripBusId).get();
    const running = busTrips.docs
      .map((doc: any) => doc.data())
      .find((other: any) => other?.tripId !== tripId && isJourneyActive(other?.journey, now));

    if (running) {
      return fail(
        409,
        'This bus is already running another trip. End that journey first.',
        'ANOTHER_JOURNEY_ACTIVE'
      );
    }

    const started: TripJourneyRecord = {
      status: 'STARTED',
      startedAt: now.toISOString(),
      endedAt: null,
      busId: tripBusId,
    };

    await tripRef.update({ journey: started });

    return await journeyResponse('Journey started.', started, now, shareFor);
  } catch (error: any) {
    console.error('Trip Journey API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update the journey.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
