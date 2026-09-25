import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
  complaintCorsHeaders,
  complaintErrorResponse,
  authenticateComplaintAdmin,
  createComplaintFromReport,
  listComplaints,
  readComplaintListFilters,
  readCreateComplaintRequest,
  serializeComplaint,
} from '../../../src/shared/server/complaints';
import {
  adminReviewerId,
  isReviewConflict,
  reviewConflictStatus,
} from '../../../src/shared/server/reportAdminReview';

const corsHeaders = complaintCorsHeaders;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// POST /api/complaints
//
// Opens a complaint from a VERIFIED accessibility issue report (MOV-177).
// Admin only. The body names the report and nothing else: the status, the
// creator and the copied report fields are all decided here, never read from
// the request. The report itself is left exactly as it was.
export async function POST(request: Request) {
  try {
    const auth = await authenticateComplaintAdmin(request);

    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const requestCheck = readCreateComplaintRequest(body);

    if (!requestCheck.ok) {
      return complaintErrorResponse(400, requestCheck.message);
    }

    const createdBy = adminReviewerId(auth.admin);

    // Unreachable for a real admin token; refused rather than stored blank.
    if (!createdBy) {
      return complaintErrorResponse(401, 'Authentication required.');
    }

    const complaint = await createComplaintFromReport(
      getAdminDb(),
      requestCheck.value.reportId,
      createdBy
    );

    return Response.json(
      {
        success: true,
        message: 'Complaint created successfully.',
        complaint: serializeComplaint(complaint, complaint.complaintId),
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error: any) {
    // A missing report, a report in the wrong state, or a complaint that
    // already exists — raised from inside the transaction and answered with
    // the status it carries rather than as a fault.
    if (isReviewConflict(error)) {
      return complaintErrorResponse(reviewConflictStatus(error), error.message);
    }

    console.error('Create Complaint API Error:', error);

    // Fixed wording: no Firestore detail reaches the client.
    return complaintErrorResponse(500, 'Failed to create the complaint.');
  }
}

// GET /api/complaints
//
// Every complaint, newest first. Admin only. Optionally narrowed by
// `?status=` (one of the complaint statuses) and `?assignedTo=<userId>`.
export async function GET(request: Request) {
  try {
    const auth = await authenticateComplaintAdmin(request);

    if (!auth.ok) return auth.response;

    const filterCheck = readComplaintListFilters(new URL(request.url).searchParams);

    if (!filterCheck.ok) {
      return complaintErrorResponse(400, filterCheck.message);
    }

    const complaints = await listComplaints(getAdminDb(), filterCheck.value);

    return Response.json(
      {
        success: true,
        message: 'Complaints retrieved successfully.',
        count: complaints.length,
        complaints,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Get Complaints API Error:', error);

    return complaintErrorResponse(500, 'Failed to retrieve complaints.');
  }
}
