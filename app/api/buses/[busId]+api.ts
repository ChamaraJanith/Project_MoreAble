import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// OPTIONS /api/buses/:identifier
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// GET /api/buses/:identifier
//
// Can retrieve using:
// 1. Bus ID      -> /api/buses/BUS-00001
// 2. Number Plate -> /api/buses/NB-1234
//
export async function GET(request: Request) {
  try {
    // --------------------------------
    // Get identifier from URL
    // --------------------------------
    const url = new URL(request.url);

    const pathParts = url.pathname.split('/').filter(Boolean);

    const identifier = pathParts[pathParts.length - 1];

    // --------------------------------
    // Validate identifier
    // --------------------------------
    if (!identifier) {
      return Response.json(
        {
          success: false,
          message: 'Bus ID or number plate is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const searchValue = decodeURIComponent(identifier)
      .trim()
      .toUpperCase();

    const adminDb = getAdminDb();

    let busDoc;

    // --------------------------------
    // Search by Bus ID
    // Example:
    // BUS-00001
    // --------------------------------
    if (searchValue.startsWith('BUS-')) {
      busDoc = await adminDb
        .collection('buses')
        .doc(searchValue)
        .get();
    }

    // --------------------------------
    // Search by Number Plate
    // Example:
    // NB-1234
    // --------------------------------
    else {
      const snapshot = await adminDb
        .collection('buses')
        .where('numberPlate', '==', searchValue)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        busDoc = snapshot.docs[0];
      }
    }

    // --------------------------------
    // Bus not found
    // --------------------------------
    if (!busDoc || !busDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
          searchValue,
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------
    // Prepare bus data
    // --------------------------------
    const bus = {
      ...busDoc.data(),
      documentId: busDoc.id,
    };

    // --------------------------------
    // Success response
    // --------------------------------
    return Response.json(
      {
        success: true,
        message: 'Bus retrieved successfully.',
        bus,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}


// PUT /api/buses/:busId
export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const busId = pathParts[pathParts.length - 1];

    if (!busId || busId === 'buses') {
      return Response.json(
        {
          success: false,
          message: 'Bus ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const normalizedBusId = decodeURIComponent(busId)
      .trim()
      .toUpperCase();

    const body = await request.json();

    const {
      chassisNumber,
      busModel,
      manufacturer,
      manufactureYear,
      seatCapacity,
      accessibilityFacilities,
      status,
    } = body;

    const adminDb = getAdminDb();

    const busRef = adminDb
      .collection('buses')
      .doc(normalizedBusId);

    const busDoc = await busRef.get();

    // Check bus exists
    if (!busDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
          busId: normalizedBusId,
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // Build update object
    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (chassisNumber !== undefined) {
      updateData.chassisNumber = chassisNumber.trim();
    }

    if (busModel !== undefined) {
      updateData.busModel = busModel.trim();
    }

    if (manufacturer !== undefined) {
      updateData.manufacturer = manufacturer.trim();
    }

    if (manufactureYear !== undefined) {
      updateData.manufactureYear = Number(manufactureYear);
    }

    if (seatCapacity !== undefined) {
      updateData.seatCapacity = Number(seatCapacity);
    }

    if (accessibilityFacilities !== undefined) {
      updateData.accessibilityFacilities = {
        wheelchairRamp:
          accessibilityFacilities?.wheelchairRamp ?? false,

        wheelchairSpace:
          accessibilityFacilities?.wheelchairSpace ?? false,

        prioritySeats:
          accessibilityFacilities?.prioritySeats ?? false,

        audioAnnouncement:
          accessibilityFacilities?.audioAnnouncement ?? false,

        lowFloorVehicle:
          accessibilityFacilities?.lowFloorVehicle ?? false,

        walkingAssistance:
          accessibilityFacilities?.walkingAssistance ?? false,
      };
    }

    if (status !== undefined) {
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

      updateData.status = status;
    }

    // Update Firestore
    await busRef.update(updateData);

    // Get updated bus
    const updatedBusDoc = await busRef.get();

    const updatedBus = {
      ...updatedBusDoc.data(),
      documentId: updatedBusDoc.id,
    };

    return Response.json(
      {
        success: true,
        message: 'Bus updated successfully.',
        bus: updatedBus,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// DELETE /api/buses/:busId
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const busId = pathParts[pathParts.length - 1];

    if (!busId || busId === 'buses') {
      return Response.json(
        {
          success: false,
          message: 'Bus ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const normalizedBusId = decodeURIComponent(busId)
      .trim()
      .toUpperCase();

    const adminDb = getAdminDb();

    const busRef = adminDb
      .collection('buses')
      .doc(normalizedBusId);

    const busDoc = await busRef.get();

    // Check whether bus exists
    if (!busDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
          busId: normalizedBusId,
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // Delete bus
    await busRef.delete();

    return Response.json(
      {
        success: true,
        message: 'Bus deleted successfully.',
        busId: normalizedBusId,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Delete Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to delete bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}