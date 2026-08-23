import { ReportVoteChoice } from '../../../../src/entities/report/model/types';
import {
  REPORT_VOTES_COLLECTION,
  applyVoteCountsToReport,
  countReportVotes,
  feedbackCorsHeaders,
  loadFeedbackContext,
  readVoteChoice,
  reportVoteDocumentId,
} from '../../../../src/shared/server/reportFeedback';

const corsHeaders = feedbackCorsHeaders;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * This session's own vote on the report, or null.
 *
 * Read by key rather than by query: the id is derived from the report and the
 * passenger, so there is exactly one document it could be.
 */
async function readMyVote(
  adminDb: any,
  reportId: string,
  passengerId: string
): Promise<ReportVoteChoice | null> {
  const doc = await adminDb
    .collection(REPORT_VOTES_COLLECTION)
    .doc(reportVoteDocumentId(reportId, passengerId))
    .get();

  if (!doc.exists) return null;

  const vote = doc.data()?.vote;

  return vote === 'AGREE' || vote === 'DISAGREE' ? vote : null;
}

// POST /api/reports/:reportId/vote
//
// Casts or changes this passenger's vote. Not "adds a vote": the document is
// keyed by report + passenger, so pressing Agree twice writes the same document
// twice and the tally does not move, while Agree then Disagree replaces it.
// That is the whole one-passenger-one-voice rule, and it is enforced by the key
// rather than by the app remembering what it last sent.
export async function POST(request: Request, context: any) {
  try {
    const loaded = await loadFeedbackContext(request, context, 'vote');

    if (!loaded.ok) return loaded.response;

    const { adminDb, reportId, reportRef, passengerId } = loaded.value;

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return Response.json(
        { success: false, message: 'Invalid request body.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const voteCheck = readVoteChoice((body as Record<string, any>).vote);

    if (!voteCheck.ok) {
      return Response.json(
        { success: false, message: voteCheck.message },
        { status: 400, headers: corsHeaders }
      );
    }

    const vote = voteCheck.value;

    const voteRef = adminDb
      .collection(REPORT_VOTES_COLLECTION)
      .doc(reportVoteDocumentId(reportId, passengerId));

    const existing = await voteRef.get();
    const now = new Date().toISOString();

    // IMPORTANT:
    // passengerId comes from the verified JWT. It is NOT accepted from the
    // request body, so a caller cannot vote as somebody else or overwrite
    // anybody's vote but their own.
    await voteRef.set({
      voteId: voteRef.id,
      reportId,
      passengerId,
      vote,
      createdAt: existing.exists ? existing.data()?.createdAt ?? now : now,
      updatedAt: now,
    });

    // Counted after the write, so the numbers returned are the ones this vote
    // produced rather than the ones it was cast against.
    const counts = await countReportVotes(adminDb, reportId);
    const requiresAdminReview = await applyVoteCountsToReport(reportRef, counts);

    return Response.json(
      {
        success: true,
        message: 'Vote recorded.',
        vote,
        agreeCount: counts.agreeCount,
        disagreeCount: counts.disagreeCount,
        requiresAdminReview,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Report Vote API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to record your vote.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// GET /api/reports/:reportId/vote
//
// What the details screen needs to draw the two pills: which way this session
// voted, if at all, and how the report stands with everybody else.
export async function GET(request: Request, context: any) {
  try {
    const loaded = await loadFeedbackContext(request, context, 'vote');

    if (!loaded.ok) return loaded.response;

    const { adminDb, reportId, passengerId } = loaded.value;

    const [myVote, counts] = await Promise.all([
      readMyVote(adminDb, reportId, passengerId),
      countReportVotes(adminDb, reportId),
    ]);

    return Response.json(
      {
        success: true,
        message: 'Report votes retrieved successfully.',
        myVote,
        agreeCount: counts.agreeCount,
        disagreeCount: counts.disagreeCount,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Get Report Votes API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve votes for this report.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
