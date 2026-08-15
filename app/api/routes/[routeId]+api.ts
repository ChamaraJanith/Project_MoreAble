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
// GET /api/routes/:routeId
// Get a single route by routeId
// ============================================================

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

// ============================================================
// PUT /api/routes/:routeId
// Update an existing route
// ============================================================

export async function PUT(request: Request) {
  try {
    const adminDb = getAdminDb();

    // --------------------------------------------------------
    // Get routeId from URL
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Read request body
    // --------------------------------------------------------

    const body = await request.json();

    const {
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

    // --------------------------------------------------------
    // Firestore route reference
    // --------------------------------------------------------

    const routeRef = adminDb.collection('routes').doc(routeId);

    // Check whether route exists
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

    // --------------------------------------------------------
    // Validate direction
    // --------------------------------------------------------

    if (
      direction !== undefined &&
      !['OUTBOUND', 'RETURN'].includes(direction)
    ) {
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

    // --------------------------------------------------------
    // Validate stops
    // --------------------------------------------------------

    if (stops !== undefined) {
      if (!Array.isArray(stops)) {
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

      if (stops.length < 2) {
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
    }

    // --------------------------------------------------------
    // Validate distance
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Validate status
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Build update object
    // --------------------------------------------------------

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (routeNumber !== undefined) {
      updateData.routeNumber = routeNumber;
    }

    if (routeName !== undefined) {
      updateData.routeName = routeName;
    }

    if (direction !== undefined) {
      updateData.direction = direction;
    }

    if (startLocation !== undefined) {
      updateData.startLocation = startLocation;
    }

    if (endLocation !== undefined) {
      updateData.endLocation = endLocation;
    }

    if (startStopId !== undefined) {
      updateData.startStopId = startStopId;
    }

    if (endStopId !== undefined) {
      updateData.endStopId = endStopId;
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

    // --------------------------------------------------------
    // Update Firestore
    // --------------------------------------------------------

    await routeRef.update(updateData);

    // --------------------------------------------------------
    // Get updated route document
    // --------------------------------------------------------

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

// ============================================================
// DELETE /api/routes/:routeId
// Delete a route
// ============================================================

export async function DELETE(request: Request) {
  try {
    const adminDb = getAdminDb();

    // --------------------------------------------------------
    // Get routeId from URL
    // --------------------------------------------------------

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const routeId = pathParts[pathParts.length - 1];

    console.log('DELETE Route ID:', routeId);

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

    // --------------------------------------------------------
    // Firestore route reference
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Delete route
    // --------------------------------------------------------

    await routeRef.delete();

    return Response.json(
      {
        success: true,
        message: 'Route deleted successfully.',
        routeId,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Delete Route API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to delete route.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}