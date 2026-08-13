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

// GET /api/routes/:routeId
export async function GET(
  request: Request,
  { routeId }: { routeId: string }
) {
  try {
    if (!routeId) {
      return Response.json(
        {
          success: false,
          message: 'Route ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    const routeRef = adminDb.collection('routes').doc(routeId);
    const routeSnapshot = await routeRef.get();

    if (!routeSnapshot.exists) {
      return Response.json(
        {
          success: false,
          message: 'Route not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const route = {
      ...routeSnapshot.data(),
      documentId: routeSnapshot.id,
    };

    return Response.json(
      {
        success: true,
        message: 'Route retrieved successfully.',
        route,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Route API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while retrieving route.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// PUT /api/routes/:routeId
export async function PUT(request: Request) {
  try {
    const adminDb = getAdminDb();

    // Get routeId from URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const routeId = pathParts[pathParts.length - 1];

    console.log('PUT Route ID:', routeId);

    if (!routeId || routeId === 'routes') {
      return Response.json(
        {
          success: false,
          message: 'Route ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const body = await request.json();

    const {
      routeNumber,
      routeName,
      startLocation,
      endLocation,
      stops,
      distanceKm,
      estimatedDuration,
      status,
    } = body;

    // Firestore route reference
    const routeRef = adminDb.collection('routes').doc(routeId);

    // Check route exists
    const routeDoc = await routeRef.get();

    if (!routeDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Route not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // Validate stops
    if (stops !== undefined && !Array.isArray(stops)) {
      return Response.json(
        {
          success: false,
          message: 'Stops must be an array.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Validate distance
    if (
      distanceKm !== undefined &&
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

    // Validate status
    if (
      status !== undefined &&
      !['ACTIVE', 'INACTIVE'].includes(status)
    ) {
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

    // Build update object
    const updateData: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (routeNumber !== undefined) {
      updateData.routeNumber = routeNumber;
    }

    if (routeName !== undefined) {
      updateData.routeName = routeName;
    }

    if (startLocation !== undefined) {
      updateData.startLocation = startLocation;
    }

    if (endLocation !== undefined) {
      updateData.endLocation = endLocation;
    }

    if (stops !== undefined) {
      updateData.stops = stops;
    }

    if (distanceKm !== undefined) {
      updateData.distanceKm = distanceKm;
    }

    if (estimatedDuration !== undefined) {
      updateData.estimatedDuration = estimatedDuration;
    }

    if (status !== undefined) {
      updateData.status = status;
    }

    // Update Firestore
    await routeRef.update(updateData);

    // Get updated document
    const updatedRouteDoc = await routeRef.get();

    return Response.json(
      {
        success: true,
        message: 'Route updated successfully.',
        route: {
          ...updatedRouteDoc.data(),
          documentId: updatedRouteDoc.id,
        },
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Route API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update route.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}