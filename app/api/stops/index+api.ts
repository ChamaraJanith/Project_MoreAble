import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ============================================================
// POST /api/stops
// Create a new stop
// ============================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      stopId,
      name,
      latitude,
      longitude,
    } = body;

    // --------------------------------------------------------
    // Validate required fields
    // --------------------------------------------------------

    if (
      !stopId ||
      !name ||
      latitude === undefined ||
      longitude === undefined
    ) {
      return Response.json(
        {
          success: false,
          message: 'Required stop fields are missing.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Validate latitude
    // --------------------------------------------------------

    if (
      typeof latitude !== 'number' ||
      latitude < -90 ||
      latitude > 90
    ) {
      return Response.json(
        {
          success: false,
          message: 'Latitude must be a valid number between -90 and 90.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Validate longitude
    // --------------------------------------------------------

    if (
      typeof longitude !== 'number' ||
      longitude < -180 ||
      longitude > 180
    ) {
      return Response.json(
        {
          success: false,
          message:
            'Longitude must be a valid number between -180 and 180.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    // --------------------------------------------------------
    // Check whether stopId already exists
    // --------------------------------------------------------

    const stopRef = adminDb.collection('stops').doc(stopId);
    const stopSnapshot = await stopRef.get();

    if (stopSnapshot.exists) {
      return Response.json(
        {
          success: false,
          message: 'A stop with this stopId already exists.',
        },
        {
          status: 409,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Create stop document
    // --------------------------------------------------------

    const stopData = {
      name,
      latitude,
      longitude,
    };

    // Save stop to Firestore
    await stopRef.set(stopData);

    // --------------------------------------------------------
    // Return success response
    // --------------------------------------------------------

    return Response.json(
      {
        success: true,
        message: 'Stop created successfully.',
        stop: {
          stopId,
          ...stopData,
        },
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Create Stop API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while creating stop.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// ============================================================
// GET /api/stops
// Get all stops
// ============================================================

export async function GET() {
  try {
    const adminDb = getAdminDb();

    // Retrieve all stops
    const snapshot = await adminDb
      .collection('stops')
      .orderBy('name', 'asc')
      .get();

    const stops = snapshot.docs.map((doc: any) => ({
      stopId: doc.id,
      ...doc.data(),
    }));

    return Response.json(
      {
        success: true,
        message: 'Stops retrieved successfully.',
        stops,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Stops API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while retrieving stops.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}