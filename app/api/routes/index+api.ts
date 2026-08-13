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
      startLocation,
      endLocation,
      stops,
      distanceKm,
      estimatedDuration,
      status,
    } = body;

    // Validate required fields
    if (
      !routeId ||
      !routeNumber ||
      !routeName ||
      !startLocation ||
      !endLocation ||
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

    // Validate stops
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

    const adminDb = getAdminDb();

    // Check whether routeId already exists
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

    // Create route document
    const routeData = {
      routeId,
      routeNumber,
      routeName,
      startLocation,
      endLocation,
      stops,
      distanceKm: distanceKm ?? null,
      estimatedDuration: estimatedDuration ?? null,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await routeRef.set(routeData);

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