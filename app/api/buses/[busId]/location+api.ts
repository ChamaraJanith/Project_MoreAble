import { VehicleLocation } from '../../../../src/entities/bus/model/types';
import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { authoriseLocationReport } from '../../../../src/shared/server/vehicleLocationAuthorization';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * One document per vehicle, keyed by busId, holding only its latest position.
 *
 * Kept out of the `buses` collection deliberately: a position is written far
 * more often than fleet details are edited, and mixing them would churn the
 * record the admin screens read.
 */
const VEHICLE_LOCATIONS_COLLECTION = 'vehicleLocations';

export function isValidLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Normalises the device's reported fix time to an ISO 8601 string.
 *
 * Returns null when the value is unusable. The fix time is stored rather than
 * the moment the request arrived, because how current a position is depends on
 * when it was measured, not on when the network delivered it.
 */
export function normaliseRecordedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Pulls the bus id out of /api/buses/:busId/location.
 *
 * The id is the second-to-last segment here, matching how the user status route
 * reads its own id.
 */
function extractBusId(request: Request, context: any): string {
  const fromContext = context?.params?.busId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const locationIndex = parts.lastIndexOf('location');
  const candidate = locationIndex > 0 ? parts[locationIndex - 1] : '';

  return candidate && candidate !== 'buses' ? decodeURIComponent(candidate) : '';
}

// PUT /api/buses/:busId/location
//
// The GPS ingestion point: the device on a bus reports where that bus is now,
// replacing its previous position. Deliberately narrow — it can write a
// position and nothing else, so it can never alter fleet details, schedules or
// any other record.
//
// It only records observations. Deciding whether a position is fresh enough to
// show, and deriving delay or a live arrival estimate from it, belongs to the
// retrieval layer that reads this data.
export async function PUT(request: Request, context?: any) {
  try {
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

    // ----------------------------------------------------------
    // Authenticate, then authorise the caller for THIS bus.
    //
    // The id above names the resource being addressed; it is not evidence that
    // the caller owns it. Whether a token may write to it is decided in
    // vehicleLocationAuthorization, apart from the validation and storage
    // below, so the rule can tighten as Bus Login lands without disturbing
    // anything else in this handler.
    // ----------------------------------------------------------
    const account = await authenticateRequest(request);
    const authorization = authoriseLocationReport(account, busId);

    if (!authorization.allowed) {
      if (authorization.status === 401) {
        return unauthorizedResponse(authorization.message, corsHeaders);
      }

      return Response.json(
        {
          success: false,
          message: authorization.message,
        },
        {
          status: authorization.status,
          headers: corsHeaders,
        }
      );
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return Response.json(
        {
          success: false,
          message: 'A valid request body is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const { latitude, longitude, recordedAt } = body as {
      latitude?: unknown;
      longitude?: unknown;
      recordedAt?: unknown;
    };

    if (!isValidLatitude(latitude)) {
      return Response.json(
        {
          success: false,
          message: 'Latitude must be a number between -90 and 90.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!isValidLongitude(longitude)) {
      return Response.json(
        {
          success: false,
          message: 'Longitude must be a number between -180 and 180.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const normalisedRecordedAt = normaliseRecordedAt(recordedAt);

    if (!normalisedRecordedAt) {
      return Response.json(
        {
          success: false,
          message: 'recordedAt must be a valid ISO 8601 timestamp.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    // ----------------------------------------------------------
    // The position must belong to a bus that actually exists, so an unknown id
    // cannot create an orphan location record.
    // ----------------------------------------------------------
    // The id authorisation passed, rather than the one parsed from the URL, so
    // a position can only ever be filed against a bus the caller was cleared for.
    const authorisedBusId = authorization.busId;

    const busDoc = await adminDb.collection('buses').doc(authorisedBusId).get();

    if (!busDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // Only the position is stored — never a copy of the bus's own details.
    const location: VehicleLocation = {
      busId: authorisedBusId,
      latitude,
      longitude,
      recordedAt: normalisedRecordedAt,
    };

    await adminDb
      .collection(VEHICLE_LOCATIONS_COLLECTION)
      .doc(authorisedBusId)
      .set(location);

    return Response.json(
      {
        success: true,
        message: 'Vehicle location updated successfully.',
        location,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Vehicle Location API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update vehicle location.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
