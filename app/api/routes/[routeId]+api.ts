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