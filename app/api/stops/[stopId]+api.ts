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
// GET /api/stops/:stopId
// Get a single stop by stopId
// ============================================================

export async function GET(
  request: Request,
  { stopId }: { stopId: string }
) {
  try {
    // --------------------------------------------------------
    // Validate stopId
    // --------------------------------------------------------

    if (!stopId) {
      return Response.json(
        {
          success: false,
          message: 'Stop ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    // --------------------------------------------------------
    // Get stop document
    // --------------------------------------------------------

    const stopRef = adminDb.collection('stops').doc(stopId);
    const stopSnapshot = await stopRef.get();

    if (!stopSnapshot.exists) {
      return Response.json(
        {
          success: false,
          message: 'Stop not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Build stop response
    // --------------------------------------------------------

    const stop = {
      stopId: stopSnapshot.id,
      ...stopSnapshot.data(),
    };

    return Response.json(
      {
        success: true,
        message: 'Stop retrieved successfully.',
        stop,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Stop API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while retrieving stop.',
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
// PUT /api/stops/:stopId
// Update an existing stop
// ============================================================

export async function PUT(request: Request) {
  try {
    const adminDb = getAdminDb();

    // --------------------------------------------------------
    // Get stopId from URL
    // --------------------------------------------------------

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const stopId = pathParts[pathParts.length - 1];

    console.log('PUT Stop ID:', stopId);

    if (!stopId || stopId === 'stops') {
      return Response.json(
        {
          success: false,
          message: 'Stop ID is required.',
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
      name,
      latitude,
      longitude,
    } = body;

    // --------------------------------------------------------
    // Firestore stop reference
    // --------------------------------------------------------

    const stopRef = adminDb.collection('stops').doc(stopId);

    // Check whether stop exists
    const stopDoc = await stopRef.get();

    if (!stopDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Stop not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Validate name
    // --------------------------------------------------------

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return Response.json(
          {
            success: false,
            message: 'Stop name must be a non-empty string.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }
    }

    // --------------------------------------------------------
    // Validate latitude
    // --------------------------------------------------------

    if (latitude !== undefined) {
      if (
        typeof latitude !== 'number' ||
        latitude < -90 ||
        latitude > 90
      ) {
        return Response.json(
          {
            success: false,
            message:
              'Latitude must be a valid number between -90 and 90.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }
    }

    // --------------------------------------------------------
    // Validate longitude
    // --------------------------------------------------------

    if (longitude !== undefined) {
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
    }

    // --------------------------------------------------------
    // Build update object
    // --------------------------------------------------------

    const updateData: Record<string, any> = {};

    if (name !== undefined) {
      updateData.name = name.trim();
    }

    if (latitude !== undefined) {
      updateData.latitude = latitude;
    }

    if (longitude !== undefined) {
      updateData.longitude = longitude;
    }

    // --------------------------------------------------------
    // Make sure there is something to update
    // --------------------------------------------------------

    if (Object.keys(updateData).length === 0) {
      return Response.json(
        {
          success: false,
          message: 'No valid fields were provided for update.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Update Firestore
    // --------------------------------------------------------

    await stopRef.update(updateData);

    // --------------------------------------------------------
    // Get updated stop document
    // --------------------------------------------------------

    const updatedStopDoc = await stopRef.get();

    const updatedStop = {
      stopId: updatedStopDoc.id,
      ...updatedStopDoc.data(),
    };

    return Response.json(
      {
        success: true,
        message: 'Stop updated successfully.',
        stop: updatedStop,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Stop API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update stop.',
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
// DELETE /api/stops/:stopId
// Delete a stop
// ============================================================

export async function DELETE(request: Request) {
  try {
    const adminDb = getAdminDb();

    // --------------------------------------------------------
    // Get stopId from URL
    // --------------------------------------------------------

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const stopId = pathParts[pathParts.length - 1];

    console.log('DELETE Stop ID:', stopId);

    if (!stopId || stopId === 'stops') {
      return Response.json(
        {
          success: false,
          message: 'Stop ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Firestore stop reference
    // --------------------------------------------------------

    const stopRef = adminDb.collection('stops').doc(stopId);

    // Check whether stop exists
    const stopDoc = await stopRef.get();

    if (!stopDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Stop not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Referential integrity
    //
    // Routes reference a stop in two ways: by document id
    // (startStopId / endStopId) and by name inside the ordered stops array.
    // Deleting a referenced stop would silently corrupt those routes, so the
    // deletion is refused while any route still uses it.
    // --------------------------------------------------------

    const stopName = stopDoc.data()?.name;

    const routesSnapshot = await adminDb.collection('routes').get();

    const referencingRoutes = routesSnapshot.docs
      .map((doc: any) => doc.data())
      .filter((route: any) => {
        if (route?.startStopId === stopId || route?.endStopId === stopId) {
          return true;
        }

        if (typeof stopName === 'string' && Array.isArray(route?.stops)) {
          return route.stops.some(
            (stop: any) =>
              typeof stop === 'string' &&
              stop.trim().toLowerCase() === stopName.trim().toLowerCase()
          );
        }

        return false;
      });

    if (referencingRoutes.length > 0) {
      const routeNumbers = referencingRoutes
        .map((route: any) => route?.routeNumber)
        .filter((routeNumber: unknown): routeNumber is string => typeof routeNumber === 'string');

      return Response.json(
        {
          success: false,
          message:
            'Unable to delete this stop because it is currently used by one or more routes.',
          routeCount: referencingRoutes.length,
          routeNumbers,
        },
        {
          status: 409,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------------
    // Delete stop
    // --------------------------------------------------------

    await stopRef.delete();

    return Response.json(
      {
        success: true,
        message: 'Stop deleted successfully.',
        stopId,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Delete Stop API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to delete stop.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}