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

// POST /api/buses
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      numberPlate,
      chassisNumber,
      busModel,
      manufacturer,
      manufactureYear,
      seatCapacity,
      accessibilityFacilities,
      status,
    } = body;

    // --------------------------------
    // Validate required fields
    // --------------------------------
    if (
      !numberPlate ||
      !chassisNumber ||
      !busModel ||
      !manufacturer ||
      !manufactureYear ||
      !seatCapacity
    ) {
      return Response.json(
        {
          success: false,
          message: 'Required bus details are missing.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    // --------------------------------
    // Check duplicate number plate
    // --------------------------------
    const cleanNumberPlate = numberPlate.trim().toUpperCase();

    const existingBus = await adminDb
      .collection('buses')
      .where('numberPlate', '==', cleanNumberPlate)
      .limit(1)
      .get();

    if (!existingBus.empty) {
      return Response.json(
        {
          success: false,
          message: 'A bus with this number plate already exists.',
        },
        {
          status: 409,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------
    // Generate auto-increment Bus ID
    //
    // BUS-00001
    // BUS-00002
    // BUS-00003
    // --------------------------------
    const counterRef = adminDb
      .collection('counters')
      .doc('buses');

    const busId = await adminDb.runTransaction(
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

        return `BUS-${String(nextNumber).padStart(5, '0')}`;
      }
    );

    // --------------------------------
    // Timestamps
    // --------------------------------
    const now = new Date();

    // --------------------------------
    // Create Bus object
    // --------------------------------
    const bus = {
      busId,

      numberPlate: cleanNumberPlate,

      chassisNumber: chassisNumber.trim(),

      busModel: busModel.trim(),

      manufacturer: manufacturer.trim(),

      manufactureYear: Number(manufactureYear),

      seatCapacity: Number(seatCapacity),

  accessibilityFacilities: {
  wheelchairRamp:
    accessibilityFacilities?.wheelchairRamp ?? false,

  audioAnnouncement:
    accessibilityFacilities?.audioAnnouncement ?? false,

  lowFloorVehicle:
    accessibilityFacilities?.lowFloorVehicle ?? false,

  walkingAssistance:
    accessibilityFacilities?.walkingAssistance ?? false,

  wheelchairSpace: {
    available:
      accessibilityFacilities?.wheelchairSpace?.available ?? false,

    count:
      accessibilityFacilities?.wheelchairSpace?.available
        ? Number(accessibilityFacilities?.wheelchairSpace?.count ?? 0)
        : 0,
  },

  guardianSeats: {
    available:
      accessibilityFacilities?.guardianSeats?.available ?? false,

    count:
      accessibilityFacilities?.guardianSeats?.available
        ? Number(accessibilityFacilities?.guardianSeats?.count ?? 0)
        : 0,
  },

  prioritySeats: {
    available:
      accessibilityFacilities?.prioritySeats?.available ?? false,

    count:
      accessibilityFacilities?.prioritySeats?.available
        ? Number(accessibilityFacilities?.prioritySeats?.count ?? 0)
        : 0,
  },

  elderlySeats: {
    available:
      accessibilityFacilities?.elderlySeats?.available ?? false,

    count:
      accessibilityFacilities?.elderlySeats?.available
        ? Number(accessibilityFacilities?.elderlySeats?.count ?? 0)
        : 0,
  },
},

      status: status || 'ACTIVE',

      createdAt: now,

      updatedAt: now,
    };

    // --------------------------------
    // Save bus to Firestore
    // --------------------------------
    await adminDb
      .collection('buses')
      .doc(busId)
      .set(bus);

    // --------------------------------
    // Success response
    // --------------------------------
    return Response.json(
      {
        success: true,
        message: 'Bus created successfully.',
        bus,
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Create Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to create bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// GET /api/buses
export async function GET() {
  try {
    const adminDb = getAdminDb();

    const snapshot = await adminDb
      .collection('buses')
      .orderBy('createdAt', 'desc')
      .get();

 const buses = snapshot.docs.map((doc: any) => ({
  ...doc.data(),
  documentId: doc.id,
}));

    return Response.json(
      {
        success: true,
        message: 'Buses retrieved successfully.',
        count: buses.length,
        buses,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Buses API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve buses.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}