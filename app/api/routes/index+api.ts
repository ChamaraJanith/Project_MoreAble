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

// POST /api/routes
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      routeId,
      routeNumber,
      routeName,
      direction,
      startLocation,
      endLocation,
      startStopId,
      endStopId,
      stops,
      distanceKm,
      estimatedDuration,
      status,
    } = body;

    // --------------------------------------------------
    // Validate required fields
    // --------------------------------------------------

    if (
      !routeId ||
      !routeNumber ||
      !routeName ||
      !direction ||
      !startLocation ||
      !endLocation ||
      !startStopId ||
      !endStopId ||
      !stops ||
      !status
    ) {
      return Response.json(
        {
          success: false,
          message: 'Required route fields are missing.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Validate direction
    // --------------------------------------------------

    if (!['OUTBOUND', 'RETURN'].includes(direction)) {
      return Response.json(
        {
          success: false,
          message: 'Direction must be OUTBOUND or RETURN.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Validate stops
    // --------------------------------------------------

    if (!Array.isArray(stops) || stops.length < 2) {
      return Response.json(
        {
          success: false,
          message: 'A route must contain at least two stops.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Every stop must be a string
    if (!stops.every((stop: any) => typeof stop === 'string')) {
      return Response.json(
        {
          success: false,
          message: 'Every stop in the stops array must be a string.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Validate distance
    // --------------------------------------------------

    if (
      distanceKm !== undefined &&
      distanceKm !== null &&
      (typeof distanceKm !== 'number' || distanceKm < 0)
    ) {
      return Response.json(
        {
          success: false,
          message: 'Distance must be a valid positive number.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Validate status
    // --------------------------------------------------

    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return Response.json(
        {
          success: false,
          message: 'Status must be ACTIVE or INACTIVE.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Validate start and end stops exist in stops array
    // --------------------------------------------------

    if (!stops.includes(startLocation)) {
      return Response.json(
        {
          success: false,
          message: 'Start location must exist in the stops array.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!stops.includes(endLocation)) {
      return Response.json(
        {
          success: false,
          message: 'End location must exist in the stops array.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Get Firestore database
    // --------------------------------------------------

    const adminDb = getAdminDb();

    // --------------------------------------------------
    // Check whether routeId already exists
    // --------------------------------------------------

    const routeRef = adminDb.collection('routes').doc(routeId);
    const routeSnapshot = await routeRef.get();

    if (routeSnapshot.exists) {
      return Response.json(
        {
          success: false,
          message: 'A route with this routeId already exists.',
        },
        {
          status: 409,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Create route document
    // --------------------------------------------------

    const routeData = {
      routeId,
      routeNumber,
      routeName,

      // Route direction
      // OUTBOUND or RETURN
      direction,

      // Route starting and ending locations
      startLocation,
      endLocation,

      // References to the start and end stops
      startStopId,
      endStopId,

      // Ordered list of stops
      // Example:
      // [
      //   "Kaduwela",
      //   "SLIIT Campus",
      //   "Malabe",
      //   ...
      //   "Kollupitiya"
      // ]
      stops,

      // Optional route information
      distanceKm: distanceKm ?? null,
      estimatedDuration: estimatedDuration ?? null,

      // Route status
      status,

      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // --------------------------------------------------
    // Save route to Firestore
    // --------------------------------------------------

    await routeRef.set(routeData);

    // --------------------------------------------------
    // Return success response
    // --------------------------------------------------

    return Response.json(
      {
        success: true,
        message: 'Route created successfully.',
        route: routeData,
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Create Route API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while creating route.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// GET /api/routes
export async function GET() {
  try {
    const adminDb = getAdminDb();

    // Retrieve all routes
    const snapshot = await adminDb
      .collection('routes')
      .orderBy('createdAt', 'desc')
      .get();

    const routes = snapshot.docs.map((doc: any) => ({
      ...doc.data(),
      documentId: doc.id,
    }));

    return Response.json(
      {
        success: true,
        message: 'Routes retrieved successfully.',
        routes,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Routes API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while retrieving routes.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}