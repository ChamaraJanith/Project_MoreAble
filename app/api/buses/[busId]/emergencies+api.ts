import { authenticateRequest } from '../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { listOpenBusEmergencies } from '../../../../src/shared/server/busCrewEmergencies';
import { authoriseBusEmergencyAccess } from '../../../../src/shared/server/busEmergencyAuthorization';
import { emergencyErrorResponse } from '../../../../src/shared/server/emergencies';

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

/** Pulls the bus id out of /api/buses/:busId/emergencies. */
function extractBusId(request: Request, context: any): string {
  const fromContext = context?.params?.busId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const emergenciesIndex = parts.lastIndexOf('emergencies');
  const candidate = emergenciesIndex > 0 ? parts[emergenciesIndex - 1] : '';

  return candidate && candidate !== 'buses' ? decodeURIComponent(candidate) : '';
}

// GET /api/buses/:busId/emergencies
//
// The bus crew's emergency console: this bus's open (not RESOLVED)
// emergencies, newest first, in the narrow crew view — no passenger phone,
// email or id, no caregiver, no admin audit trail.
//
// BUS ONLY, for its own bus (authoriseBusEmergencyAccess): the token's busId
// claim must equal :busId, and only emergencies stamped with that busId are
// returned. Admins list emergencies through GET /api/emergencies.
//
//   no session (missing, malformed, expired or badly signed token)  -> 401
//   scoped credential, non-BUS role, or another bus                 -> 403
export async function GET(request: Request, context?: any) {
  try {
    const session = await authenticateRequest(request).catch(() => null);
    const authorization = authoriseBusEmergencyAccess(session, extractBusId(request, context));

    if (!authorization.allowed) {
      return emergencyErrorResponse(authorization.status, authorization.message, corsHeaders);
    }

    const emergencies = await listOpenBusEmergencies(getAdminDb(), authorization.busId);

    return Response.json(
      {
        success: true,
        message: 'Bus emergencies retrieved successfully.',
        count: emergencies.length,
        emergencies,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Get Bus Emergencies API Error:', error);
    return emergencyErrorResponse(500, 'Failed to retrieve emergencies for this bus.', corsHeaders);
  }
}
