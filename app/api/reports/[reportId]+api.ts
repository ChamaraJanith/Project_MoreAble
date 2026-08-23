import { isReportIssueCategory } from '../../../src/entities/report/model/types';
import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { normalizeReportPhotoUrls } from '../../../src/shared/server/reportPhotos';
import {
  resolveBusReference,
  resolveRouteReference,
} from '../../../src/shared/server/reportReferences';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function errorResponse(status: number, message: string): Response {
  return Response.json(
    {
      success: false,
      message,
    },
    {
      status,
      headers: corsHeaders,
    }
  );
}

/**
 * The report id from the route.
 *
 * Read from the router's params where they are given, and from the path
 * otherwise, because the handlers are also called directly with a plain params
 * object. The same arrangement /api/notifications/[notificationId] already
 * uses.
 */
function extractReportId(request: Request, context: any): string {
  if (context?.params?.reportId) return String(context.params.reportId).trim();
  if (context?.reportId) return String(context.reportId).trim();

  try {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];

    if (last && last !== 'reports') return decodeURIComponent(last).trim();
  } catch {
    // A malformed url simply yields no id, and the caller answers 400.
  }

  return '';
}

/**
 * A stored report, ready to send.
 *
 * Firestore hands back Timestamps, which do not survive JSON as dates — the
 * same conversion the list endpoint does, so a report reads identically whether
 * it arrived from the list or from here.
 */
function serializeReport(data: Record<string, any>, documentId: string) {
  return {
    ...data,
    documentId,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
  };
}

/**
 * Whether this session filed this report.
 *
 * The passengerId compared here is the one on the verified token, never a value
 * from the request: the point of the check is that a caller cannot claim to be
 * the author of somebody else's report.
 */
function isReportOwner(report: Record<string, any>, passengerId: string): boolean {
  return !!passengerId && report.passengerId === passengerId;
}

/**
 * Loads the report, or the response explaining why it could not be loaded.
 *
 * Shared by all three handlers so that "who may touch this report" is answered
 * in one place: hiding a button in the app is a nicety, this is the rule.
 */
async function loadReport(
  request: Request,
  context: any,
  options: { requireOwner: boolean }
): Promise<
  | { ok: true; docRef: any; report: Record<string, any>; passengerId: string; isOwner: boolean }
  | { ok: false; response: Response }
> {
  const user = await authenticateRequest(request);

  if (!user) {
    return {
      ok: false,
      response: unauthorizedResponse('Authentication required.', corsHeaders),
    };
  }

  const reportId = extractReportId(request, context);

  if (!reportId) {
    return { ok: false, response: errorResponse(400, 'Report ID is required.') };
  }

  const adminDb = getAdminDb();
  const docRef = adminDb.collection('reports').doc(reportId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return { ok: false, response: errorResponse(404, 'Report not found.') };
  }

  const report = doc.data() ?? {};
  const isOwner = isReportOwner(report, user.passengerId);

  // Deliberately the same 403 whether the report exists and belongs to somebody
  // else or not — a passenger learns nothing about other people's reports by
  // trying ids.
  if (options.requireOwner && !isOwner) {
    return {
      ok: false,
      response: errorResponse(403, 'You can only modify your own reports.'),
    };
  }

  return { ok: true, docRef, report, passengerId: user.passengerId, isOwner };
}

// GET /api/reports/[reportId]
//
// Readable by any authenticated passenger, which is what All Reports already
// exposes: the list hands back every report, so the detail view of one adds no
// access. `isOwner` says whether this session may edit or delete it.
export async function GET(request: Request, context: any) {
  try {
    const loaded = await loadReport(request, context, { requireOwner: false });

    if (!loaded.ok) return loaded.response;

    return Response.json(
      {
        success: true,
        message: 'Accessibility report retrieved successfully.',
        report: serializeReport(loaded.report, loaded.docRef.id),
        isOwner: loaded.isOwner,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Report API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve the accessibility report.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// PUT /api/reports/[reportId]
export async function PUT(request: Request, context: any) {
  try {
    const loaded = await loadReport(request, context, { requireOwner: true });

    if (!loaded.ok) return loaded.response;

    const { docRef, report: existing } = loaded;

    // --------------------------------
    // Read request body
    // --------------------------------
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid request body.');
    }

    const { issueCategory, description, busId, routeId, photoUrls } = body as Record<string, any>;

    // --------------------------------
    // Validate — the same rules POST applies, so a report cannot be edited
    // into a state it could never have been created in.
    // --------------------------------
    if (!issueCategory || !description) {
      return errorResponse(400, 'Issue category and description are required.');
    }

    if (!isReportIssueCategory(issueCategory)) {
      return errorResponse(400, 'Invalid issue category.');
    }

    if (typeof description !== 'string' || !description.trim()) {
      return errorResponse(400, 'Description cannot be empty.');
    }

    const cleanDescription = description.trim();

    const photoUrlCheck = normalizeReportPhotoUrls(photoUrls);

    if (!photoUrlCheck.ok) {
      return errorResponse(400, photoUrlCheck.message);
    }

    const reportPhotoUrls = photoUrlCheck.value;

    const adminDb = getAdminDb();

    const busReference = await resolveBusReference(adminDb, busId);

    if (!busReference.ok) {
      return errorResponse(busReference.status, busReference.message);
    }

    const routeReference = await resolveRouteReference(adminDb, routeId);

    if (!routeReference.ok) {
      return errorResponse(routeReference.status, routeReference.message);
    }

    // --------------------------------
    // Build the updated document
    //
    // Written whole rather than merged, because an edit can also REMOVE a bus,
    // a route or a photo, and a merge cannot express the absence of a key —
    // the report would keep a reference the passenger had just cleared.
    //
    // The reference and photo keys are therefore stripped first and re-added
    // from what was resolved above, while everything else the document happens
    // to carry is preserved untouched.
    // --------------------------------
    const {
      busId: _previousBusId,
      vehicle: _previousVehicle,
      routeId: _previousRouteId,
      route: _previousRoute,
      photoUrls: _previousPhotoUrls,
      ...preserved
    } = existing;

    const updatedReport = {
      ...preserved,

      // Identity, ownership and review state are not the passenger's to edit:
      // they are read back off the stored report rather than from the request.
      reportId: existing.reportId,
      passengerId: existing.passengerId,
      status: existing.status,
      createdAt: existing.createdAt,

      issueCategory,
      description: cleanDescription,

      ...busReference.value,
      ...routeReference.value,
      ...(reportPhotoUrls.length > 0 ? { photoUrls: reportPhotoUrls } : {}),

      updatedAt: new Date(),
    };

    await docRef.set(updatedReport);

    return Response.json(
      {
        success: true,
        message: 'Accessibility report updated successfully.',
        report: serializeReport(updatedReport, docRef.id),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Report API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update the accessibility report.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// DELETE /api/reports/[reportId]
//
// The Firestore document only. The photos stay in Cloudinary: this project
// uploads them from the app with an unsigned preset, which grants upload and
// nothing else, and there is no server-side Cloudinary credential to delete
// with. Adding one to the client would mean shipping an API secret inside the
// app, so the document goes and the images are left orphaned deliberately.
export async function DELETE(request: Request, context: any) {
  try {
    const loaded = await loadReport(request, context, { requireOwner: true });

    if (!loaded.ok) return loaded.response;

    await loaded.docRef.delete();

    return Response.json(
      {
        success: true,
        message: 'Accessibility report deleted successfully.',
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Delete Report API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to delete the accessibility report.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
