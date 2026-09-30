import {
  FeedbackAccess,
  REPORT_COMMENTS_COLLECTION,
  commentCorsHeaders,
  extractFeedbackCommentId,
  feedbackErrorResponse,
  loadFeedbackContext,
  normalizeReportComment,
  removeReportComment,
  serializeReportComment,
} from '../../../../../src/shared/server/reportFeedback';

const corsHeaders = commentCorsHeaders;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function errorResponse(status: number, message: string): Response {
  return feedbackErrorResponse(status, message, corsHeaders);
}

/**
 * Loads the report and the one comment being addressed, or the response
 * explaining why they could not be loaded.
 *
 * The report is loaded through the same `loadFeedbackContext` the thread uses,
 * so who may touch a comment starts from the same rules as who may write one:
 * a session that cannot see the report gets 404, and one that may not take
 * this action at all gets 403.
 *
 * A comment is answered 404 when it does not exist AND when it exists under a
 * different report: the report in the path is part of the address, and a
 * comment cannot be edited or removed through a report it does not belong to.
 */
async function loadComment(
  request: Request,
  context: any,
  access: FeedbackAccess
): Promise<
  | {
      ok: true;
      adminDb: any;
      commentRef: any;
      comment: Record<string, any>;
      commentId: string;
      passengerId: string;
      isAdmin: boolean;
    }
  | { ok: false; response: Response }
> {
  const loaded = await loadFeedbackContext(request, context, 'comments', {
    access,
    headers: corsHeaders,
  });

  if (!loaded.ok) return loaded;

  const { adminDb, reportId, passengerId, isAdmin } = loaded.value;

  const commentId = extractFeedbackCommentId(request, context);

  if (!commentId || commentId.includes('/')) {
    return { ok: false, response: errorResponse(400, 'Comment ID is required.') };
  }

  const commentRef = adminDb.collection(REPORT_COMMENTS_COLLECTION).doc(commentId);
  const commentDoc = await commentRef.get();
  const comment = commentDoc.exists ? commentDoc.data() ?? null : null;

  if (!comment || comment.reportId !== reportId) {
    return { ok: false, response: errorResponse(404, 'Comment not found.') };
  }

  return { ok: true, adminDb, commentRef, comment, commentId, passengerId, isAdmin };
}

/**
 * Whether this session wrote the comment.
 *
 * The passengerId compared is the one on the verified token, never a value from
 * the request, and a comment with no author is nobody's.
 */
function isCommentAuthor(comment: Record<string, any>, passengerId: string): boolean {
  return !!passengerId && comment.passengerId === passengerId;
}

// PATCH /api/reports/:reportId/comments/:commentId
//
// Edits a comment's text. Its author only, and only while they can still see
// the report: a passenger session (403 for a bus device, a journey-sharing
// credential or an admin — an admin removes comments, it does not rewrite what
// a passenger said), and the comment's own author (403 for anybody else).
//
// The text is validated exactly as a new comment's is, under the same key the
// composer sends (`comment`). The write names only `text` and `editedAt`, so
// the author, the report, the name shown and when it was first written cannot
// be moved through an edit.
export async function PATCH(request: Request, context: any) {
  try {
    const loaded = await loadComment(request, context, 'write');

    if (!loaded.ok) return loaded.response;

    const { commentRef, comment, commentId, passengerId } = loaded;

    // A deleted comment kept as a placeholder for its replies has nothing
    // left to edit.
    if (comment.deleted) {
      return errorResponse(404, 'Comment not found.');
    }

    if (!isCommentAuthor(comment, passengerId)) {
      return errorResponse(403, 'You can only edit your own comments.');
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(400, 'Invalid request body.');
    }

    const commentCheck = normalizeReportComment((body as Record<string, any>).comment);

    if (!commentCheck.ok) {
      return errorResponse(400, commentCheck.message);
    }

    const update = {
      text: commentCheck.value,
      editedAt: new Date().toISOString(),
    };

    await commentRef.update(update);

    return Response.json(
      {
        success: true,
        message: 'Comment updated.',
        comment: serializeReportComment({ ...comment, ...update }, commentId),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Update Report Comment API Error:', error);

    return errorResponse(500, 'Failed to update your comment.');
  }
}

// DELETE /api/reports/:reportId/comments/:commentId
//
// Removes a comment: its author may remove their own, and an admin may remove
// any comment (moderation). Anybody else is refused with 403 — another
// passenger, a bus device, a journey-sharing credential.
//
// The comment record is deleted outright rather than marked, so the thread and
// the comment counts on the report list (both read from the comments
// collection) drop it with no further change — except for a top-level comment
// that other passengers have replied to, which is emptied into a `deleted`
// placeholder so their replies are not deleted with it (removeReportComment).
export async function DELETE(request: Request, context: any) {
  try {
    const loaded = await loadComment(request, context, 'moderate');

    if (!loaded.ok) return loaded.response;

    const { adminDb, commentRef, comment, commentId, passengerId, isAdmin } = loaded;

    if (comment.deleted) {
      return errorResponse(404, 'Comment not found.');
    }

    if (!isAdmin && !isCommentAuthor(comment, passengerId)) {
      return errorResponse(403, 'You can only delete your own comments.');
    }

    const outcome = await removeReportComment(adminDb, commentRef, comment, commentId);

    return Response.json(
      {
        success: true,
        message: 'Comment deleted.',
        commentId,
        // Only when the thread rules did more than remove this one comment,
        // so a plain delete answers exactly as it always has.
        ...(outcome.alsoRemovedCommentIds.length > 0
          ? { alsoRemovedCommentIds: outcome.alsoRemovedCommentIds }
          : {}),
        ...(outcome.placeholder ? { comment: outcome.placeholder } : {}),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Delete Report Comment API Error:', error);

    return errorResponse(500, 'Failed to delete the comment.');
  }
}
