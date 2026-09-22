import {
  isReportDecided,
  isReportType,
  reportDecisionStatus,
  reportTypeOf,
} from '../../../src/entities/report/model/types';
import {
  authenticateRequest,
  unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { recordAccessibilityScoreSafely } from '../../../src/shared/server/accessibilityScoreHistory';
import { readReportContent } from '../../../src/shared/server/reportContent';
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
 * Whether the report is still the author's to edit, or why it is not.
 *
 * A report's content leaves its author's hands the moment an admin decides it.
 * Editing a verified report would change the account behind a finding somebody
 * stands behind, and a rejection is the record its author is owed and must not
 * be edited into something else either. So edits are refused once the report
 * is off PENDING. Deleting is not: the author may always withdraw their own
 * report, whatever state it reached.
 *
 * 409 rather than 403: the caller IS the owner and the request IS well formed
 * — what stopped it is the state the report has reached, which is exactly what
 * the review route already answers 409 for. The status is named in the message
 * so the app can say what happened rather than that something did.
 */
function checkReportIsOpenToEdit(report: Record<string, any>): Response | null {
  if (!isReportDecided(report)) return null;

  return errorResponse(
    409,
    `This report has already been reviewed (${reportDecisionStatus(report)}) and can no longer be edited.`
  );
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
    // The report has to still be open to change
    //
    // Checked before the body is read, so an edit to a decided report costs a
    // 409 and no validation of fields that were never going to be stored.
    // --------------------------------
    const closed = checkReportIsOpenToEdit(existing);

    if (closed) return closed;

    // --------------------------------
    // Read request body
    // --------------------------------
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid request body.');
    }

    const { busId, routeId, photoUrls } = body as Record<string, any>;

    // --------------------------------
    // The report's type is fixed by what was filed (MOV-301)
    //
    // An edit changes what a report says, not what kind of report it is:
    // turning praise into a complaint, or the reverse, would rewrite the
    // record under the votes and comments it has already drawn. A body may
    // restate the type, but only as the one already stored.
    // --------------------------------
    const reportType = reportTypeOf(existing);
    const requestedType = (body as Record<string, any>).type;

    if (requestedType !== undefined && requestedType !== null && requestedType !== '') {
      if (!isReportType(requestedType)) {
        return errorResponse(400, 'Invalid report type.');
      }

      if (requestedType !== reportType) {
        return errorResponse(400, "A report's type cannot be changed.");
      }
    }

    // --------------------------------
    // Validate — the same rules POST applies, so a report cannot be edited
    // into a state it could never have been created in.
    // --------------------------------
    const contentCheck = readReportContent(body as Record<string, any>, reportType);

    if (!contentCheck.ok) {
      return errorResponse(400, contentCheck.message);
    }

    const reportContent = contentCheck.value;

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
      // What the report says is re-added from the validated body below. The
      // type is re-added with it for positive feedback, and stays absent on an
      // issue report exactly as it was filed.
      type: _previousType,
      issueCategory: _previousIssueCategory,
      category: _previousCategory,
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

      ...reportContent,

      ...busReference.value,
      ...routeReference.value,
      ...(reportPhotoUrls.length > 0 ? { photoUrls: reportPhotoUrls } : {}),

      updatedAt: new Date(),
    };

    await docRef.set(updatedReport);

    return Response.json(
      {
        success: true,
        message:
          reportType === 'POSITIVE'
            ? 'Positive accessibility feedback updated successfully.'
            : 'Accessibility report updated successfully.',
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
// Owner only (403 for anybody else), in any status: a passenger may delete
// their own pending, verified or rejected report.
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

    // A VERIFIED report was part of its bus's accessibility score; withdrawing
    // it can change that score. Any other status never counted (MOV-113). Best
    // effort: the report is already deleted.
    const deletedBusId = loaded.report.busId;

    if (loaded.report.status === 'VERIFIED' && typeof deletedBusId === 'string' && deletedBusId) {
      await recordAccessibilityScoreSafely(getAdminDb(), deletedBusId);
    }

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
