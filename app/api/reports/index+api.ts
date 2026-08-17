import {
    authenticateRequest,
    unauthorizedResponse,
} from '../../../src/shared/api/authMiddleware';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

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

    const {
      issueCategory,
      description,
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
    // --------------------------------
    const allowedCategories = [
      'BROKEN_RAMP',
      'LIFT_NOT_WORKING',
      'PRIORITY_SEAT_MISUSE',
      'BUS_OVERCROWDED',
      'DRIVER_DID_NOT_ASSIST',
      'AUDIO_ANNOUNCEMENT_NOT_WORKING',
    ];

    if (!allowedCategories.includes(issueCategory)) {
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
    // Get Firebase Admin DB
    // --------------------------------
    const adminDb = getAdminDb();

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

    // --------------------------------
    // Get Firebase Admin DB
    // --------------------------------
    const adminDb = getAdminDb();

    // --------------------------------
    // Retrieve reports
    // --------------------------------
    let reportsQuery: any = adminDb.collection('reports');

    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');

    if (scope === 'my') {
      reportsQuery = reportsQuery.where('passengerId', '==', user.passengerId);
    } else if (scope === 'verified') {
      reportsQuery = reportsQuery.where('status', '==', 'VERIFIED');
    }

    const snapshot = await reportsQuery
      .orderBy('createdAt', 'desc')
      .get();

    const reports = snapshot.docs.map((doc: any) => ({
      ...doc.data(),
      documentId: doc.id,
      // Firestore timestamps need to be converted to ISO strings or serialized
      createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : doc.data().createdAt,
      updatedAt: doc.data().updatedAt?.toDate ? doc.data().updatedAt.toDate() : doc.data().updatedAt,
    }));

    // --------------------------------
    // Success response
    // --------------------------------
    return Response.json(
      {
        success: true,
        message: 'Accessibility reports retrieved successfully.',
        count: reports.length,
        reports,
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