import {
    authenticateRequest,
    unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { isReportIssueCategory } from '../../../src/entities/report/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { normalizeReportPhotoUrls } from '../../../src/shared/server/reportPhotos';

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

// --------------------------------
// Optional bus / route references
//
// A report stores two things about the vehicle and the route: the canonical
// document id, which is what links it back to the fleet, and a snapshot of how
// that bus or route read on the day the report was filed.
//
// The snapshot is not redundancy. A report is a historical record — a bus can
// be retired and a route renamed long before anyone reviews the report — so
// without it the card would eventually describe the wrong thing, or nothing.
// The same arrangement a booking already uses.
// --------------------------------

/**
 * A Firestore document id cannot contain a slash, so a value carrying one is
 * malformed rather than merely missing: `.doc(id)` would throw on it instead of
 * answering "not found".
 */
function isValidReferenceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    !value.includes('/')
  );
}

/** Whether the caller supplied this optional reference at all. */
function isReferenceSupplied(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function trimmedOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// POST /api/reports
export async function POST(request: Request) {
  try {
    // --------------------------------
    // Authenticate passenger
    // --------------------------------
    const user = await authenticateRequest(request);

    if (!user) {
      return unauthorizedResponse(
        'Authentication required.',
        corsHeaders
      );
    }

    // --------------------------------
    // Only passengers can create reports
    // --------------------------------
    if (user.role !== 'PASSENGER') {
      return Response.json(
        {
          success: false,
          message: 'Only passengers can create accessibility reports.',
        },
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------
    // Read request body
    // --------------------------------
    const body = await request.json();

    // `photoUrls` are the Cloudinary URLs the app uploaded to before
    // submitting. No image data reaches this route, and no device uri reaches
    // Firestore — see normalizeReportPhotoUrls.
    const {
      issueCategory,
      description,
      busId,
      routeId,
      photoUrls,
    } = body;

    // --------------------------------
    // Validate required fields
    // --------------------------------
    if (!issueCategory || !description) {
      return Response.json(
        {
          success: false,
          message: 'Issue category and description are required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------
    // Validate issue category
    //
    // Checked against the entity model's list, which is the same list the
    // picker is built from — so a category can never be offered on screen and
    // refused here, or the reverse.
    // --------------------------------
    if (!isReportIssueCategory(issueCategory)) {
      return Response.json(
        {
          success: false,
          message: 'Invalid issue category.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------
    // Validate description
    // --------------------------------
    if (
      typeof description !== 'string' ||
      !description.trim()
    ) {
      return Response.json(
        {
          success: false,
          message: 'Description cannot be empty.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const cleanDescription = description.trim();

    // --------------------------------
    // Validate photo evidence
    //
    // Done before anything is generated or written, so a malformed URL costs
    // nothing but a 400 — no report id burned.
    // --------------------------------
    const photoUrlCheck = normalizeReportPhotoUrls(photoUrls);

    if (!photoUrlCheck.ok) {
      return Response.json(
        {
          success: false,
          message: photoUrlCheck.message,
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const reportPhotoUrls = photoUrlCheck.value;

    // --------------------------------
    // Get Firebase Admin DB
    // --------------------------------
    const adminDb = getAdminDb();

    // --------------------------------
    // Resolve the bus reference
    //
    // Both references stay optional: a passenger who does not know which bus
    // they were on must still be able to report the issue. But a reference that
    // IS supplied has to point at something — an id that does not resolve is
    // refused rather than stored, so a report never carries a dangling
    // reference that reads as a bus nobody can look up.
    // --------------------------------
    let resolvedBusId: string | undefined;
    let vehicleSnapshot: Record<string, any> | undefined;

    if (isReferenceSupplied(busId)) {
      if (!isValidReferenceId(busId)) {
        return Response.json(
          {
            success: false,
            message: 'Invalid bus reference.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const busDoc = await adminDb
        .collection('buses')
        .doc(busId.trim())
        .get();

      if (!busDoc.exists) {
        return Response.json(
          {
            success: false,
            message: 'Selected bus was not found.',
          },
          {
            status: 404,
            headers: corsHeaders,
          }
        );
      }

      const bus = busDoc.data() ?? {};
      const numberPlate = trimmedOrUndefined(bus.numberPlate);
      const busModel = trimmedOrUndefined(bus.busModel);
      const manufacturer = trimmedOrUndefined(bus.manufacturer);

      resolvedBusId = busId.trim();

      // Only the fields the fleet record actually holds are written, so the
      // snapshot never carries empty keys.
      vehicleSnapshot = {
        // Falls back to the id so the snapshot always identifies something,
        // even against an incomplete fleet record.
        numberPlate: numberPlate ?? resolvedBusId,
        ...(busModel ? { busModel } : {}),
        ...(manufacturer ? { manufacturer } : {}),
      };
    }

    // --------------------------------
    // Resolve the route reference
    // --------------------------------
    let resolvedRouteId: string | undefined;
    let routeSnapshot: Record<string, any> | undefined;

    if (isReferenceSupplied(routeId)) {
      if (!isValidReferenceId(routeId)) {
        return Response.json(
          {
            success: false,
            message: 'Invalid route reference.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const routeDoc = await adminDb
        .collection('routes')
        .doc(routeId.trim())
        .get();

      if (!routeDoc.exists) {
        return Response.json(
          {
            success: false,
            message: 'Selected route was not found.',
          },
          {
            status: 404,
            headers: corsHeaders,
          }
        );
      }

      const route = routeDoc.data() ?? {};
      const routeNumber = trimmedOrUndefined(route.routeNumber);
      const routeName = trimmedOrUndefined(route.routeName);
      const direction = trimmedOrUndefined(route.direction);

      resolvedRouteId = routeId.trim();

      routeSnapshot = {
        routeNumber: routeNumber ?? resolvedRouteId,
        ...(routeName ? { routeName } : {}),
        // Every route created through /api/routes carries a direction, but an
        // older record without one is snapshotted without it rather than being
        // given a direction it never had.
        ...(direction === 'OUTBOUND' || direction === 'RETURN'
          ? { direction }
          : {}),
      };
    }

    // --------------------------------
    // Generate Report ID
    //
    // REP-00001
    // REP-00002
    // REP-00003
    // --------------------------------
    const counterRef = adminDb
      .collection('counters')
      .doc('reports');

    const reportId = await adminDb.runTransaction(
      async (transaction: any) => {
        const counterDoc = await transaction.get(counterRef);

        let nextNumber = 1;

        if (counterDoc.exists) {
          const counterData = counterDoc.data();

          nextNumber =
            Number(counterData?.lastNumber || 0) + 1;
        }

        transaction.set(
          counterRef,
          {
            lastNumber: nextNumber,
            updatedAt: new Date(),
          },
          {
            merge: true,
          }
        );

        return `REP-${String(nextNumber).padStart(5, '0')}`;
      }
    );

    // --------------------------------
    // Timestamps
    // --------------------------------
    const now = new Date();

    // --------------------------------
    // Create report
    // --------------------------------
    const report = {
      reportId,

      // IMPORTANT:
      // passengerId comes from verified JWT.
      // It is NOT accepted from request body.
      passengerId: user.passengerId,

      issueCategory,

      description: cleanDescription,

      // Present only when the passenger actually selected one, so a report
      // filed without a bus or route carries no empty keys at all.
      ...(resolvedBusId ? { busId: resolvedBusId } : {}),
      ...(vehicleSnapshot ? { vehicle: vehicleSnapshot } : {}),
      ...(resolvedRouteId ? { routeId: resolvedRouteId } : {}),
      ...(routeSnapshot ? { route: routeSnapshot } : {}),

      // Absent rather than an empty array when no photos were attached.
      ...(reportPhotoUrls.length > 0 ? { photoUrls: reportPhotoUrls } : {}),

      status: 'PENDING',

      createdAt: now,

      updatedAt: now,
    };

    // --------------------------------
    // Save report to Firestore
    // --------------------------------
    await adminDb
      .collection('reports')
      .doc(reportId)
      .set(report);

    // --------------------------------
    // Success response
    // --------------------------------
    return Response.json(
      {
        success: true,
        message: 'Accessibility report submitted successfully.',
        report,
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Create Report API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to create accessibility report.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// GET /api/reports
export async function GET(request: Request) {
  try {
    // --------------------------------
    // Authenticate user
    // --------------------------------
    const user = await authenticateRequest(request);

    if (!user) {
      return unauthorizedResponse(
        'Authentication required.',
        corsHeaders
      );
    }

    // --------------------------------
    // Get Firebase Admin DB
    // --------------------------------
    const adminDb = getAdminDb();

    // --------------------------------
    // Retrieve reports
    // --------------------------------
    let reportsQuery: any = adminDb.collection('reports');

    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');

    if (scope === 'my') {
      reportsQuery = reportsQuery.where('passengerId', '==', user.passengerId);
    } else if (scope === 'verified') {
      reportsQuery = reportsQuery.where('status', '==', 'VERIFIED');
    }

    const snapshot = await reportsQuery
      .orderBy('createdAt', 'desc')
      .get();

    const reports = snapshot.docs.map((doc: any) => ({
      ...doc.data(),
      documentId: doc.id,
      // Firestore timestamps need to be converted to ISO strings or serialized
      createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : doc.data().createdAt,
      updatedAt: doc.data().updatedAt?.toDate ? doc.data().updatedAt.toDate() : doc.data().updatedAt,
    }));

    // --------------------------------
    // Success response
    // --------------------------------
    return Response.json(
      {
        success: true,
        message: 'Accessibility reports retrieved successfully.',
        count: reports.length,
        reports,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Reports API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve accessibility reports.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}