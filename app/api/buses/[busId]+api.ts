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