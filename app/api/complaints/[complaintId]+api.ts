import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
  authenticateComplaintAdmin,
  complaintErrorResponse,
  isComplaintId,
  readComplaintDetail,
} from '../../../src/shared/server/complaints';

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
 * The complaint id from the route.
 *
 * Read from the router's params where they are given, and from the path
 * otherwise, because the handlers are also called directly with a plain params
 * object — the same arrangement /api/reports/[reportId] uses.
 */
function extractComplaintId(request: Request, context: any): string {
  if (context?.params?.complaintId) return String(context.params.complaintId).trim();
  if (context?.complaintId) return String(context.complaintId).trim();

  try {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];

    if (last && last !== 'complaints') return decodeURIComponent(last).trim();
  } catch {
    // A malformed url simply yields no id, and the caller answers 400.
  }

  return '';
}

// GET /api/complaints/:complaintId
//
// One complaint, admin only. `sourceReport` is the report it was opened from as
// that report stands now, or null once its passenger has deleted it — the
// complaint carries its own copy of the issue, bus and route either way.
export async function GET(request: Request, context: any) {
  try {
    const auth = await authenticateComplaintAdmin(request, corsHeaders);

    if (!auth.ok) return auth.response;

    const complaintId = extractComplaintId(request, context);

    if (!complaintId) {
      return complaintErrorResponse(400, 'Complaint ID is required.', corsHeaders);
    }

    if (!isComplaintId(complaintId)) {
      return complaintErrorResponse(400, 'Invalid complaint ID.', corsHeaders);
    }

    const detail = await readComplaintDetail(getAdminDb(), complaintId);

    if (!detail) {
      return complaintErrorResponse(404, 'Complaint not found.', corsHeaders);
    }

    return Response.json(
      {
        success: true,
        message: 'Complaint retrieved successfully.',
        complaint: detail.complaint,
        sourceReport: detail.sourceReport,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Get Complaint API Error:', error);

    return complaintErrorResponse(500, 'Failed to retrieve the complaint.', corsHeaders);
  }
}
