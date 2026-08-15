import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTripTime(value: unknown): boolean {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function isValidTurnNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// POST /api/trips
export async function POST(request: Request) {
  try {
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
    // Validate required fields
    // --------------------------------------------------

    if (!routeId || !busId) {
      return Response.json(
        {
          success: false,
          message: 'routeId and busId are required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!isValidTripTime(departureTime)) {
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

    if (!isValidTripTime(estimatedArrivalTime)) {
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

    if (!isValidTurnNumber(turnNumber)) {
      return Response.json(
        {
          success: false,
          message: 'turnNumber is required and must be a positive whole number.',
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

    const adminDb = getAdminDb();

    // --------------------------------------------------
    // Referenced route must exist and be ACTIVE
    // --------------------------------------------------

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

    // --------------------------------------------------
    // Referenced bus must exist and be ACTIVE
    // --------------------------------------------------

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

    // --------------------------------------------------
    // Generate auto-increment Trip ID
    //
    // TRIP-00001
    // TRIP-00002
    // TRIP-00003
    // --------------------------------------------------

    const counterRef = adminDb.collection('counters').doc('trips');

    const tripId = await adminDb.runTransaction(async (transaction: any) => {
      const counterDoc = await transaction.get(counterRef);

      let nextNumber = 1;

      if (counterDoc.exists) {
        const counterData = counterDoc.data();
        nextNumber = Number(counterData?.lastNumber || 0) + 1;
      }

      transaction.set(
        counterRef,
        {
          lastNumber: nextNumber,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return `TRIP-${String(nextNumber).padStart(5, '0')}`;
    });

    // --------------------------------------------------
    // Create Trip document
    // Only references to the route/bus are stored — never a copy of their data.
    // --------------------------------------------------

    const now = new Date();

    const trip = {
      tripId,
      routeId,
      busId,
      departureTime,
      estimatedArrivalTime,
      turnNumber: Number(turnNumber),
      status: status || 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    await adminDb.collection('trips').doc(tripId).set(trip);

    return Response.json(
      {
        success: true,
        message: 'Trip created successfully.',
        trip,
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Create Trip API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to create trip.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// GET /api/trips
export async function GET() {
  try {
    const adminDb = getAdminDb();

    const snapshot = await adminDb.collection('trips').orderBy('createdAt', 'desc').get();

    const trips = snapshot.docs.map((doc: any) => doc.data());

    return Response.json(
      {
        success: true,
        message: 'Trips retrieved successfully.',
        count: trips.length,
        trips,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Trips API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve trips.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
