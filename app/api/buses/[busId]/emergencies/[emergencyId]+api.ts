import { authenticateRequest } from '../../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../../src/shared/config/firebaseAdmin';
import { resolveBusEmergency, sendBusCrewMessage } from '../../../../../src/shared/server/busCrewEmergencies';
import { authoriseBusEmergencyAccess } from '../../../../../src/shared/server/busEmergencyAuthorization';
import { EmergencyConflictError, emergencyErrorResponse } from '../../../../../src/shared/server/emergencies';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/** Pulls :busId and :emergencyId out of /api/buses/:busId/emergencies/:emergencyId. */
function extractIds(request: Request, context: any): { busId: string; emergencyId: string } {
  const params = context?.params ?? {};
  let busId = typeof params.busId === 'string' ? params.busId.trim() : '';
  let emergencyId = typeof params.emergencyId === 'string' ? params.emergencyId.trim() : '';

  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const emergenciesIndex = parts.lastIndexOf('emergencies');

  if (!busId && emergenciesIndex > 0 && parts[emergenciesIndex - 1] !== 'buses') {
    busId = decodeURIComponent(parts[emergenciesIndex - 1]).trim();
  }
  if (!emergencyId && emergenciesIndex >= 0 && parts[emergenciesIndex + 1]) {
    emergencyId = decodeURIComponent(parts[emergenciesIndex + 1]).trim();
  }

  return { busId, emergencyId };
}

// PATCH /api/buses/:busId/emergencies/:emergencyId
//
//   { "action": "MESSAGE", "message": "..." }   crew message to Control Center
//   { "action": "RESOLVE" }                      crew confirms passenger assisted
//
// BUS ONLY, for its own bus's emergency: the token's busId claim must equal
// :busId (authoriseBusEmergencyAccess) and the emergency must be stamped with
// that busId — another bus's emergency, or one with no bus, is a 404 exactly
// like a missing one.
//
// Only `action` and `message` are read from the body. The sender, the actor on
// the history, the responder and the resolution text are all derived from the
// authenticated bus; a busId, changedBy, passengerId, status, responder or
// recipient in the body is ignored. Admin operations (assigning a responder,
// arbitrary status changes, dismissing) stay on PATCH/DELETE
// /api/emergencies/:emergencyId, which remain ADMIN ONLY.
//
//   no session (missing, malformed, expired or badly signed token)  -> 401
//   scoped credential, non-BUS role, or another bus in the URL      -> 403
//   another bus's emergency, or none                                -> 404
//   already resolved                                                -> 409
export async function PATCH(request: Request, context?: any) {
  try {
    const { busId, emergencyId } = extractIds(request, context);

    const session = await authenticateRequest(request).catch(() => null);
    const authorization = authoriseBusEmergencyAccess(session, busId);

    if (!authorization.allowed) {
      return emergencyErrorResponse(authorization.status, authorization.message, corsHeaders);
    }

    if (!emergencyId) {
      return emergencyErrorResponse(400, 'Emergency ID is required.', corsHeaders);
    }

    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action !== 'MESSAGE' && action !== 'RESOLVE') {
      return emergencyErrorResponse(400, 'action must be "MESSAGE" or "RESOLVE".', corsHeaders);
    }

    const db = getAdminDb();
    const emergency =
      action === 'MESSAGE'
        ? await sendBusCrewMessage(db, emergencyId, authorization.busId, body.message)
        : await resolveBusEmergency(db, emergencyId, authorization.busId);

    return Response.json(
      {
        success: true,
        message: action === 'MESSAGE' ? 'Message sent to Control Center.' : 'Emergency marked as resolved.',
        emergency,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    if (error instanceof EmergencyConflictError) {
      return emergencyErrorResponse(error.statusCode, error.message, corsHeaders);
    }
    console.error('Bus Emergency Action API Error:', error);
    return emergencyErrorResponse(500, 'Failed to update the emergency.', corsHeaders);
  }
}
