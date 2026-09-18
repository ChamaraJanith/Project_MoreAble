import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function extractUserId(request: Request, context: any): string {
  const fromContext = context?.params?.userId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const statusIndex = parts.lastIndexOf('verification');
  const candidate = statusIndex > 0 ? parts[statusIndex - 1] : '';

  return candidate && candidate !== 'users' ? decodeURIComponent(candidate) : '';
}

// PATCH /api/users/:userId/verification
export async function PATCH(request: Request, context?: any) {
  try {
    const userId = extractUserId(request, context);

    if (!userId) {
      return Response.json(
        { success: false, message: 'User ID is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return Response.json(
        { success: false, message: 'A valid request body is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { isVerified } = body as { isVerified?: unknown };

    if (typeof isVerified !== 'boolean') {
      return Response.json(
        { success: false, message: 'isVerified must be a boolean.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const userRef = adminDb.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return Response.json(
        { success: false, message: 'User not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    await userRef.update({
      isVerified,
      updatedAt: new Date().toISOString(),
    });

    const updatedDoc = await userRef.get();
    const updated = updatedDoc.data() ?? {};

    return Response.json(
      {
        success: true,
        message: 'User verification status updated successfully.',
        user: {
          documentId: userId,
          passengerId: typeof updated.passengerId === 'string' ? updated.passengerId : userId,
          isVerified: Boolean(updated.isVerified),
          updatedAt: typeof updated.updatedAt === 'string' ? updated.updatedAt : null,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Update User Verification API Error:', error);
    return Response.json(
      {
        success: false,
        message: 'Failed to update user verification status.',
        error: error?.message || 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
