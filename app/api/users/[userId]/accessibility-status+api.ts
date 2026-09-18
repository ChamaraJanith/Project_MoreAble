import { AccessibilityVerificationStatus } from '../../../../src/entities/user/model/types';
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

const ACCESSIBILITY_STATUSES: AccessibilityVerificationStatus[] = ['PENDING', 'VERIFIED', 'REJECTED'];

export function isAccessibilityStatus(value: unknown): value is AccessibilityVerificationStatus {
  return typeof value === 'string' && (ACCESSIBILITY_STATUSES as string[]).includes(value);
}

/**
 * Pulls the user id out of /api/users/:userId/accessibility-status.
 */
function extractUserId(request: Request, context: any): string {
  const fromContext = context?.params?.userId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const statusIndex = parts.lastIndexOf('accessibility-status');
  const candidate = statusIndex > 0 ? parts[statusIndex - 1] : '';

  return candidate && candidate !== 'users' ? decodeURIComponent(candidate) : '';
}

// PATCH /api/users/:userId/accessibility-status
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

    const { accessibilityVerificationStatus } = body as { accessibilityVerificationStatus?: unknown };

    if (!accessibilityVerificationStatus) {
      return Response.json(
        { success: false, message: 'Accessibility verification status is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!isAccessibilityStatus(accessibilityVerificationStatus)) {
      return Response.json(
        { success: false, message: 'Status must be PENDING, VERIFIED, or REJECTED.' },
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
    
    const data = userDoc.data() || {};
    const accessibilityProfileId = data.accessibilityProfileId;

    // We write accessibilityVerificationStatus to both the user and the profile if it exists.
    const batch = adminDb.batch();

    batch.update(userRef, {
      accessibilityVerificationStatus,
      updatedAt: new Date().toISOString(),
    });
    
    if (accessibilityProfileId) {
       const profileRef = adminDb.collection('accessibilityProfiles').doc(accessibilityProfileId);
       batch.update(profileRef, {
           accessibilityVerificationStatus,
           updatedAt: new Date().toISOString(),
       });
    }

    await batch.commit();

    const updatedDoc = await userRef.get();
    const updated = updatedDoc.data() ?? {};

    return Response.json(
      {
        success: true,
        message: 'Accessibility verification status updated successfully.',
        user: {
          documentId: userId,
          passengerId: typeof updated.passengerId === 'string' ? updated.passengerId : userId,
          accessibilityVerificationStatus: updated.accessibilityVerificationStatus || null,
          updatedAt: typeof updated.updatedAt === 'string' ? updated.updatedAt : null,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Update User Accessibility Status API Error:', error);

    return Response.json(
      { success: false, message: 'Failed to update accessibility status.', error: error?.message || 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
