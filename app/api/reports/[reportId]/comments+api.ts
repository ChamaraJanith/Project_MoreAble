import {
  REPORT_COMMENTS_COLLECTION,
  feedbackCorsHeaders,
  loadFeedbackContext,
  nextReportCommentId,
  normalizeReportCommentContent,
  readReportComments,
  resolveReplyParent,
  resolveCommentAuthorName,
  serializeReportComment,
} from '../../../../src/shared/server/reportFeedback';

const corsHeaders = feedbackCorsHeaders;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// POST /api/reports/:reportId/comments
//
// Adds one comment to the report's thread. The passenger writing it comes from
// the verified token, so a comment can only ever be attributed to whoever
// actually sent the request — which is also why only a genuine passenger
// session may write one (403 otherwise).
//
// Body: { comment?, imageUrl?, parentCommentId? }. Text or a photo is required.
// `imageUrl` is a Cloudinary URL the app already uploaded to — the API never
// handles image bytes. `parentCommentId` makes it a reply, and must name a
// top-level comment under this same report.
export async function POST(request: Request, context: any) {
  try {
    const loaded = await loadFeedbackContext(request, context, 'comments', { access: 'write' });

    if (!loaded.ok) return loaded.response;

    const { adminDb, reportId, passengerId } = loaded.value;

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return Response.json(
        { success: false, message: 'Invalid request body.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validated before an id is generated, so a blank or over-long comment
    // costs a 400 and nothing else — no comment number burned on it.
    const contentCheck = normalizeReportCommentContent(body as Record<string, any>);

    if (!contentCheck.ok) {
      return Response.json(
        { success: false, message: contentCheck.message },
        { status: 400, headers: corsHeaders }
      );
    }

    const parentCheck = await resolveReplyParent(
      adminDb,
      reportId,
      (body as Record<string, any>).parentCommentId
    );

    if (!parentCheck.ok) {
      return Response.json(
        { success: false, message: parentCheck.message },
        { status: parentCheck.status, headers: corsHeaders }
      );
    }

    const authorName = await resolveCommentAuthorName(adminDb, passengerId);
    const commentId = await nextReportCommentId(adminDb);
    const now = new Date().toISOString();

    const comment = {
      commentId,
      reportId,

      // IMPORTANT:
      // passengerId comes from the verified JWT, never from the request body.
      passengerId,

      authorName,

      // Stored as `text`, which is what the thread renders it as. The request
      // key stays `comment`, because that is what the composer sends.
      text: contentCheck.value.text,

      imageUrl: contentCheck.value.imageUrl,
      parentCommentId: parentCheck.value,

      createdAt: now,
      updatedAt: now,
    };

    await adminDb.collection(REPORT_COMMENTS_COLLECTION).doc(commentId).set(comment);

    return Response.json(
      {
        success: true,
        message: parentCheck.value ? 'Reply added.' : 'Comment added.',
        comment: serializeReportComment(comment, commentId),
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Create Report Comment API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to add your comment.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// GET /api/reports/:reportId/comments
//
// The thread, newest first, as one flat list. Replies are in it too, each
// carrying the `parentCommentId` the app groups it under; only this report's
// comments are ever read (the query filters on reportId).
export async function GET(request: Request, context: any) {
  try {
    const loaded = await loadFeedbackContext(request, context, 'comments');

    if (!loaded.ok) return loaded.response;

    const { adminDb, reportId } = loaded.value;

    // Reading and ordering the thread lives in shared/server/reportFeedback, so
    // that the admin review view (MOV-161) shows the same comments in the same
    // order as the passengers arguing about the report.
    const comments = await readReportComments(adminDb, reportId);

    return Response.json(
      {
        success: true,
        message: 'Report comments retrieved successfully.',
        count: comments.length,
        comments,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Get Report Comments API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve comments for this report.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
