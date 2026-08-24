import {
  adminReviewerId,
  applyReviewDecision,
  isReviewConflict,
  loadAdminReportContext,
  readReviewInstruction,
  reviewConflictStatus,
  reviewCorsHeaders,
  reviewErrorResponse,
  toAdminReviewReport,
} from '../../../../src/shared/server/reportAdminReview';
import {
  countReportVotes,
  readReportComments,
} from '../../../../src/shared/server/reportFeedback';

const corsHeaders = reviewCorsHeaders;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// GET /api/reports/:reportId/review
//
// One report, with everything the admin review page needs to decide it: the
// report itself, how the community answered it, the thread they argued in, and
// whatever review has already been recorded against it.
//
// Admin only. The passenger-facing GET /api/reports/[reportId] is unchanged and
// still open to any authenticated passenger — this route exists alongside it
// because what it adds (the votes, the thread and the review) is the reviewer's
// view, not a bigger version of the passenger's.
export async function GET(request: Request, context: any) {
  try {
    const loaded = await loadAdminReportContext(request, context);

    if (!loaded.ok) return loaded.response;

    const { adminDb, reportId, reportRef, report } = loaded.value;

    // The stored tallies are what the vote route last wrote, and they are what
    // the list shows. Counting the votes again here means the one screen that
    // decides a report reads the votes themselves rather than a number that
    // could have drifted from them.
    const [counts, comments] = await Promise.all([
      countReportVotes(adminDb, reportId),
      readReportComments(adminDb, reportId),
    ]);

    const serialized = toAdminReviewReport(report, reportRef.id, comments.length);

    return Response.json(
      {
        success: true,
        message: 'Report retrieved for review.',
        report: {
          ...serialized,
          agreeCount: counts.agreeCount,
          disagreeCount: counts.disagreeCount,
        },
        comments,
        review: serialized.review,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Get Report For Review API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve the report for review.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// POST /api/reports/:reportId/review
//
// Records an admin's decision: VERIFY, REJECT, or REMARK to write a remark
// without deciding anything.
//
// The body names an ACTION, never a status. What VERIFY means is decided here,
// so there is no request that can put a report into a state this route did not
// choose — and `reportId`, `passengerId`, `createdAt`, `agreeCount`,
// `disagreeCount` and `requiresAdminReview` are simply never read from it.
//
// The write is a partial `update` naming only the review's own keys, so
// everything else the document holds is untouched by construction rather than
// by care, and it is made inside a transaction that re-reads the status, so a
// report cannot be decided twice by two admins arriving together.
export async function POST(request: Request, context: any) {
  try {
    const loaded = await loadAdminReportContext(request, context);

    if (!loaded.ok) return loaded.response;

    const { admin, adminDb, reportId, reportRef } = loaded.value;

    const body = await request.json().catch(() => null);

    const instructionCheck = readReviewInstruction(body);

    if (!instructionCheck.ok) {
      return reviewErrorResponse(400, instructionCheck.message);
    }

    const instruction = instructionCheck.value;

    // The whole decision — re-reading the status, checking it is still PENDING,
    // and writing the review against that read — happens in one transaction, so
    // two admins deciding the same report cannot both succeed. A conflict comes
    // back as a thrown sentinel and is answered below.
    const applied = await applyReviewDecision(
      adminDb,
      reportRef,
      instruction,
      adminReviewerId(admin)
    );

    const commentCount = (await readReportComments(adminDb, reportId)).length;
    const serialized = toAdminReviewReport(applied.report, reportRef.id, commentCount);

    return Response.json(
      {
        success: true,
        message:
          instruction.status === null
            ? 'Review remark saved.'
            : `Report marked ${instruction.status}.`,
        report: serialized,
        review: serialized.review,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    // The report was decided or deleted while this admin was deciding it. Not a
    // fault — the transaction did its job — so it is answered rather than
    // logged as a failure, the way POST /api/booking/confirm answers a seat
    // taken out from under a passenger.
    if (isReviewConflict(error)) {
      return reviewErrorResponse(reviewConflictStatus(error), error.message);
    }

    console.error('Review Report API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to review the report.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
