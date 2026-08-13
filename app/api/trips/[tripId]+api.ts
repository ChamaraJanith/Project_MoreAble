import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTripTime(value: unknown): boolean {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function isValidTurnNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// GET /api/trips/:tripId
export async function GET(
  request: Request,
  { tripId }: { tripId: string }
) {
  try {
    if (!tripId) {
      return Response.json(
        {
          success: false,
          message: 'Trip ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    const tripRef = adminDb.collection('trips').doc(tripId);
    const tripSnapshot = await tripRef.get();

    if (!tripSnapshot.exists) {
      return Response.json(
        {
          success: false,
          message: 'Trip not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    return Response.json(
      {
        success: true,
        message: 'Trip retrieved successfully.',
        trip: tripSnapshot.data(),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Trip API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Internal server error while retrieving trip.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// PUT /api/trips/:tripId
export async function PUT(request: Request) {
  try {
    const adminDb = getAdminDb();

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const tripId = pathParts[pathParts.length - 1];

    if (!tripId || tripId === 'trips') {
      return Response.json(
        {
          success: false,
          message: 'Trip ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const tripRef = adminDb.collection('trips').doc(tripId);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Trip not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const body = await request.json();

    const {
      routeId,
      busId,
      departureTime,
      estimatedArrivalTime,
      turnNumber,
      status,
    } = body;

    // --------------------------------------------------
    // Validate + resolve route reference, if being changed
    // --------------------------------------------------

    if (routeId !== undefined) {
      const routeDoc = await adminDb.collection('routes').doc(routeId).get();

      if (!routeDoc.exists) {
        return Response.json(
          {
            success: false,
            message: 'Referenced route does not exist.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      if (routeDoc.data()?.status !== 'ACTIVE') {
        return Response.json(
          {
            success: false,
            message: 'Referenced route is not ACTIVE.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }
    }

    // --------------------------------------------------
    // Validate + resolve bus reference, if being changed
    // --------------------------------------------------

    if (busId !== undefined) {
      const busDoc = await adminDb.collection('buses').doc(busId).get();

      if (!busDoc.exists) {
        return Response.json(
          {
            success: false,
            message: 'Referenced bus does not exist.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      if (busDoc.data()?.status !== 'ACTIVE') {
        return Response.json(
          {
            success: false,
            message: 'Referenced bus is not ACTIVE.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }
    }

    if (departureTime !== undefined && !isValidTripTime(departureTime)) {
      return Response.json(
        {
          success: false,
          message: 'A valid departureTime (HH:MM) is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (estimatedArrivalTime !== undefined && !isValidTripTime(estimatedArrivalTime)) {
      return Response.json(
        {
          success: false,
          message: 'A valid estimatedArrivalTime (HH:MM) is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (turnNumber !== undefined && !isValidTurnNumber(turnNumber)) {
      return Response.json(
        {
          success: false,
          message: 'turnNumber must be a positive whole number.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (status !== undefined && !['ACTIVE', 'INACTIVE'].includes(status)) {
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
    // Build update object — references only, never copied
    // route/bus data.
    // --------------------------------------------------

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (routeId !== undefined) updateData.routeId = routeId;
    if (busId !== undefined) updateData.busId = busId;
    if (departureTime !== undefined) updateData.departureTime = departureTime;
    if (estimatedArrivalTime !== undefined) updateData.estimatedArrivalTime = estimatedArrivalTime;
    if (turnNumber !== undefined) updateData.turnNumber = Number(turnNumber);
    if (status !== undefined) updateData.status = status;

    await tripRef.update(updateData);

    const updatedTripDoc = await tripRef.get();

    return Response.json(
      {
        success: true,
        message: 'Trip updated successfully.',
        trip: updatedTripDoc.data(),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Trip API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update trip.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// DELETE /api/trips/:tripId
//
// Soft-deactivates the trip (status -> INACTIVE) rather than removing the
// document, so historical trips are preserved and simply excluded from
// journey search once inactive.
export async function DELETE(request: Request) {
  try {
    const adminDb = getAdminDb();

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const tripId = pathParts[pathParts.length - 1];

    if (!tripId || tripId === 'trips') {
      return Response.json(
        {
          success: false,
          message: 'Trip ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const tripRef = adminDb.collection('trips').doc(tripId);
    const tripDoc = await tripRef.get();

    if (!tripDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Trip not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    await tripRef.update({
      status: 'INACTIVE',
      updatedAt: new Date(),
    });

    const updatedTripDoc = await tripRef.get();

    return Response.json(
      {
        success: true,
        message: 'Trip deactivated successfully.',
        trip: updatedTripDoc.data(),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Deactivate Trip API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to deactivate trip.',
        error: error.message,
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
