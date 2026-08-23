import {
    authenticateRequest,
    unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import {
  isReportIssueCategory,
  isReportStatus,
} from '../../../src/entities/report/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
  ADMIN_ROLE,
  reviewErrorResponse,
  toAdminReviewReport,
} from '../../../src/shared/server/reportAdminReview';
import { countCommentsByReport } from '../../../src/shared/server/reportFeedback';
import { normalizeReportPhotoUrls } from '../../../src/shared/server/reportPhotos';
import {
  resolveBusReference,
  resolveRouteReference,
} from '../../../src/shared/server/reportReferences';

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
// Resolving each one and snapshotting how it read lives in
// shared/server/reportReferences, so that editing a report through
// PUT /api/reports/[reportId] applies exactly the rules that created it here.
// --------------------------------

/**
 * A report's createdAt as a sortable number.
 *
 * By the time this sees the value a Firestore Timestamp has already been
 * unwrapped to a Date, but a record written by an older path may carry a string
 * or nothing at all — and one that cannot be read sorts last rather than
 * reordering everything around it.
 */
function sortableTime(value: unknown): number {
  const time = new Date(value as any).getTime();

  return Number.isNaN(time) ? -Infinity : time;
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
    // Resolve the bus and route references
    // --------------------------------
    const busReference = await resolveBusReference(adminDb, busId);

    if (!busReference.ok) {
      return Response.json(
        {
          success: false,
          message: busReference.message,
        },
        {
          status: busReference.status,
          headers: corsHeaders,
        }
      );
    }

    const routeReference = await resolveRouteReference(adminDb, routeId);

    if (!routeReference.ok) {
      return Response.json(
        {
          success: false,
          message: routeReference.message,
        },
        {
          status: routeReference.status,
          headers: corsHeaders,
        }
      );
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
      // filed without a bus or route carries no empty keys at all — each
      // resolver returns an empty object when its reference was not supplied.
      ...busReference.value,
      ...routeReference.value,

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

    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');

    // --------------------------------
    // The admin review queue (MOV-161)
    //
    // `scope=review` is the one slice of this endpoint that is not a
    // passenger's. It is answered by the same handler because it is the same
    // question - which reports are there - asked by somebody allowed to decide
    // them, and duplicating the query, the comment tally and the serialisation
    // into a second listing route would give the review page a subtly
    // different report than every other screen reads.
    //
    // What is NOT shared is who may ask. A non-admin session is refused here,
    // before any query runs, whatever the app happens to render.
    // --------------------------------
    const isReviewScope = scope === 'review';

    if (isReviewScope && user.role !== ADMIN_ROLE) {
      return reviewErrorResponse(
        403,
        'Only an administrator can review accessibility reports.',
        corsHeaders
      );
    }

    // The review queue may be narrowed to one status. Validated against the
    // stored vocabulary rather than passed through, so an unknown status is a
    // 400 and not an empty queue that reads like "nothing to review".
    const statusFilter = url.searchParams.get('status');

    if (isReviewScope && statusFilter !== null && !isReportStatus(statusFilter)) {
      return reviewErrorResponse(400, 'Invalid report status.', corsHeaders);
    }

    const flaggedOnly = isReviewScope && url.searchParams.get('flagged') === 'true';

    // --------------------------------
    // Get Firebase Admin DB
    // --------------------------------
    const adminDb = getAdminDb();

    // --------------------------------
    // Retrieve reports
    //
    // A filtered scope deliberately does not ask Firestore to order the result.
    // An equality filter combined with orderBy on a different field is the one
    // pair Firestore cannot answer from its automatic single-field indexes: it
    // needs a composite index, and without one the query does not come back
    // unordered, it fails outright with FAILED_PRECONDITION.
    //
    // So a filtered scope asks the database for the filter alone — already
    // covered by a single-field index — and the ordering is applied below to
    // what comes back. Only the ordering moves. The filter stays in the query,
    // so `scope=my` still reads nothing but the caller's own reports, which is
    // the part that must not be done after the fact.
    //
    // `scope=all` has no filter, so orderBy on its own needs no composite index
    // either: it keeps ordering in the query, exactly as before.
    // --------------------------------
    let reportsQuery: any = adminDb.collection('reports');

    let isFiltered = false;

    if (scope === 'my') {
      reportsQuery = reportsQuery.where('passengerId', '==', user.passengerId);
      isFiltered = true;
    } else if (scope === 'verified') {
      reportsQuery = reportsQuery.where('status', '==', 'VERIFIED');
      isFiltered = true;
    }

    if (!isFiltered) {
      reportsQuery = reportsQuery.orderBy('createdAt', 'desc');
    }

    const snapshot = await reportsQuery.get();

    // --------------------------------
    // Comment counts
    //
    // One query for the whole page, tallied by report below. The vote tallies
    // are already on each report document — POST /api/reports/[reportId]/vote
    // writes them there — but comments are not counted onto anything, so the
    // number has to be derived. Deriving it per report would be one query per
    // card; deriving it in the app would be one request per card.
    // --------------------------------
    const commentCounts = await countCommentsByReport(adminDb);

    // The review queue carries the same reports with the things a reviewer needs
    // and a passenger card does not: the counts as numbers, whether the report
    // is flagged for review, and any decision already recorded against it.
    // Serialising it in shared/server/reportAdminReview is what makes the queue
    // and GET /api/reports/:id/review describe a report identically.
    const reports = isReviewScope
      ? snapshot.docs.map((doc: any) =>
          toAdminReviewReport(
            doc.data() ?? {},
            doc.id,
            commentCounts.get(doc.data()?.reportId ?? doc.id) ?? 0
          )
        )
      : snapshot.docs.map((doc: any) => ({
          ...doc.data(),
          documentId: doc.id,
          // Firestore timestamps need to be converted to ISO strings or serialized
          createdAt: doc.data().createdAt?.toDate
            ? doc.data().createdAt.toDate()
            : doc.data().createdAt,
          updatedAt: doc.data().updatedAt?.toDate
            ? doc.data().updatedAt.toDate()
            : doc.data().updatedAt,
          // Always a number: a report nobody has commented on has no entry in the
          // map, and that is a zero rather than a missing field the card has to
          // guard against.
          commentCount: commentCounts.get(doc.data().reportId ?? doc.id) ?? 0,
        }));

    if (isFiltered) {
      // The order the query would have returned had an index existed: newest
      // report first, matching what `scope=all` gets from Firestore.
      reports.sort(
        (first: any, second: any) =>
          sortableTime(second.createdAt) - sortableTime(first.createdAt)
      );
    }

    // Narrowing happens after the read for the same reason the sort does: an
    // equality filter on `status` combined with the orderBy above needs a
    // composite index, and the queue is a screen's worth of reports either way.
    const visibleReports = isReviewScope
      ? reports.filter(
          (report: any) =>
            (statusFilter === null || report.status === statusFilter) &&
            (!flaggedOnly || report.flagged === true)
        )
      : reports;

    // --------------------------------
    // Success response
    // --------------------------------
    return Response.json(
      {
        success: true,
        message: isReviewScope
          ? 'Reports retrieved for review.'
          : 'Accessibility reports retrieved successfully.',
        count: visibleReports.length,
        // How many of the returned reports the community has pushed over the
        // review threshold - the number the queue leads with, so the page does
        // not have to re-derive a rule the backend already owns.
        ...(isReviewScope
          ? {
              flaggedCount: visibleReports.filter(
                (report: any) => report.flagged === true
              ).length,
            }
          : {}),
        reports: visibleReports,
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