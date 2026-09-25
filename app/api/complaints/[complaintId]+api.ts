import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
  applyComplaintAction,
  authenticateComplaintAdmin,
  complaintErrorResponse,
  isComplaintId,
  readComplaintActionInstruction,
  readComplaintDetail,
} from '../../../src/shared/server/complaints';
import {
  adminReviewerId,
  isReviewConflict,
  reviewConflictStatus,
} from '../../../src/shared/server/reportAdminReview';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

// PATCH /api/complaints/:complaintId
//
// Moves a complaint through its workflow (MOV-178). Admin only.
//
// The body names an ACTION — ASSIGN, REASSIGN, START or RESOLVE — never a
// status: what each action does, and from which state, is decided in the
// complaint model. Only the fields that action writes are read from the body,
// and the write is a partial update made inside a transaction that re-reads the
// complaint, so a stale screen cannot apply a transition that is no longer
// valid. The source report is never touched.
export async function PATCH(request: Request, context: any) {
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

    const body = await request.json().catch(() => null);
    const instructionCheck = readComplaintActionInstruction(body);

    if (!instructionCheck.ok) {
      return complaintErrorResponse(400, instructionCheck.message, corsHeaders);
    }

    const instruction = instructionCheck.value;
    const actorId = adminReviewerId(auth.admin);

    // Unreachable for a real admin token; refused rather than stored blank.
    if (!actorId) {
      return complaintErrorResponse(401, 'Authentication required.', corsHeaders);
    }

    const applied = await applyComplaintAction(
      getAdminDb(),
      complaintId,
      instruction,
      actorId
    );

    return Response.json(
      {
        success: true,
        message:
          instruction.action === 'REASSIGN'
            ? `Complaint reassigned to ${applied.complaint.assignedTo}.`
            : `Complaint marked ${applied.nextStatus}.`,
        complaint: applied.complaint,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    // A complaint or assignee that does not exist, or a transition the
    // complaint's current state does not allow — raised from inside the
    // transaction and answered with the status it carries.
    if (isReviewConflict(error)) {
      return complaintErrorResponse(reviewConflictStatus(error), error.message, corsHeaders);
    }

    console.error('Update Complaint Status API Error:', error);

    return complaintErrorResponse(500, 'Failed to update the complaint.', corsHeaders);
  }
}
