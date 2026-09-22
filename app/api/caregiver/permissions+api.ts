/**
 * Caregiver Permissions & Sharing Control API (MOV-229)
 *
 * PUT: Updates granular sharing preferences or applies the master sharing toggle.
 */

import { CaregiverPermissions } from '../../../src/entities/caregiver/model/types';
import { CAREGIVER_LINKS_COLLECTION } from '../../../src/features/caregiver/services/caregiverAlertService';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { linkId, passengerId, permissions, masterSharingActive } = body;

    if (!passengerId) {
      return Response.json(
        { success: false, message: 'passengerId is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const now = new Date().toISOString();

    // 1. If masterSharingActive is provided without a single linkId, apply master toggle to ALL links of this passenger
    if (masterSharingActive !== undefined && !linkId) {
      const snapshot = await adminDb
        .collection(CAREGIVER_LINKS_COLLECTION)
        .where('passengerId', '==', passengerId)
        .get();

      const batch = adminDb.batch();
      snapshot.forEach((doc: any) => {
        batch.set(
          doc.ref,
          {
            'permissions.isSharingActive': Boolean(masterSharingActive),
            updatedAt: now,
          },
          { merge: true }
        );
      });

      await batch.commit();

      return Response.json(
        {
          success: true,
          message: `Master sharing ${masterSharingActive ? 'enabled' : 'paused'} for all caregivers.`,
          isSharingActive: Boolean(masterSharingActive),
        },
        { status: 200, headers: corsHeaders }
      );
    }

    // 2. Otherwise, update specific caregiver link's granular permissions
    if (!linkId) {
      return Response.json(
        { success: false, message: 'linkId is required to update specific caregiver permissions.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const linkDoc = await adminDb.collection(CAREGIVER_LINKS_COLLECTION).doc(linkId).get();
    if (!linkDoc.exists) {
      return Response.json(
        { success: false, message: 'Caregiver link not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    const currentData = linkDoc.data();
    if (currentData?.passengerId !== passengerId) {
      return Response.json(
        { success: false, message: 'Unauthorized to modify permissions for this caregiver.' },
        { status: 403, headers: corsHeaders }
      );
    }

    const updatedPermissions: CaregiverPermissions = {
      ...currentData?.permissions,
      ...permissions,
    };

    await adminDb.collection(CAREGIVER_LINKS_COLLECTION).doc(linkId).set(
      {
        permissions: updatedPermissions,
        updatedAt: now,
      },
      { merge: true }
    );

    return Response.json(
      {
        success: true,
        message: 'Caregiver permissions updated successfully.',
        permissions: updatedPermissions,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('PUT /api/caregiver/permissions Error:', error);
    return Response.json(
      { success: false, message: 'Failed to update caregiver permissions', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
