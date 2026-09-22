/**
 * Caregiver Linking & Management API (MOV-228)
 *
 * GET: Fetches all linked caregivers for a passenger (auto-syncing registration guardian).
 * POST: Links a new caregiver or creates an invite.
 * DELETE: Removes/unlinks a caregiver.
 */

import { CaregiverLink } from '../../../src/entities/caregiver/model/types';
import {
  createDefaultCaregiverPermissions,
  generateCaregiverInviteCode,
  isValidEmail,
  isValidSriLankanMobile,
  normalizeSriLankanPhoneNumber,
} from '../../../src/features/caregiver/model/caregiverUtils';
import {
  CAREGIVER_LINKS_COLLECTION,
  syncRegisteredGuardianAsCaregiver,
} from '../../../src/features/caregiver/services/caregiverAlertService';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const passengerId = searchParams.get('passengerId');

    if (!passengerId) {
      return Response.json(
        { success: false, message: 'passengerId query parameter is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();

    // 1. Auto-sync registered guardian if present
    await syncRegisteredGuardianAsCaregiver(passengerId, adminDb);

    // 2. Fetch all caregiver links for this passenger
    const snapshot = await adminDb
      .collection(CAREGIVER_LINKS_COLLECTION)
      .where('passengerId', '==', passengerId)
      .get();

    const caregivers: CaregiverLink[] = [];
    snapshot.forEach((doc: any) => {
      caregivers.push(doc.data() as CaregiverLink);
    });

    // Sort primary guardian first, then by createdAt desc
    caregivers.sort((a, b) => {
      if (a.isPrimaryGuardian) return -1;
      if (b.isPrimaryGuardian) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    return Response.json(
      {
        success: true,
        caregivers,
        count: caregivers.length,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('GET /api/caregiver/link Error:', error);
    return Response.json(
      { success: false, message: 'Failed to retrieve caregiver links', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      passengerId,
      fullName,
      mobileNo,
      email,
      nicNo,
      relationship,
      notes,
      permissions,
    } = body;

    if (!passengerId || !fullName || (!mobileNo && !email)) {
      return Response.json(
        { success: false, message: 'Passenger ID, Full Name, and at least one contact method (Mobile or Email) are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (mobileNo && !isValidSriLankanMobile(mobileNo)) {
      return Response.json(
        { success: false, message: 'Please provide a valid 10-digit Sri Lankan mobile number (e.g., 0771234567).' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (email && !isValidEmail(email)) {
      return Response.json(
        { success: false, message: 'Please provide a valid email address.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();
    const linkId = `LNK-${currentYear}-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const inviteCode = generateCaregiverInviteCode();

    // Fetch passenger name for greeting
    let passengerName = 'Passenger';
    const userDoc = await adminDb.collection('users').doc(passengerId).get();
    if (userDoc.exists) {
      passengerName = userDoc.data()?.userName || 'Passenger';
    }

    const newLink: CaregiverLink = {
      linkId,
      passengerId,
      passengerName,
      fullName: fullName.trim(),
      mobileNo: mobileNo ? normalizeSriLankanPhoneNumber(mobileNo) : '',
      email: email ? email.trim() : '',
      nicNo: nicNo ? nicNo.trim() : undefined,
      relationship: relationship ? relationship.trim() : 'Caregiver',
      notes: notes ? notes.trim() : undefined,
      isPrimaryGuardian: false,
      status: 'ACTIVE',
      inviteCode,
      permissions: permissions || createDefaultCaregiverPermissions(),
      createdAt: now,
      updatedAt: now,
    };

    await adminDb.collection(CAREGIVER_LINKS_COLLECTION).doc(linkId).set(newLink);

    return Response.json(
      {
        success: true,
        message: 'Caregiver linked successfully!',
        link: newLink,
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/caregiver/link Error:', error);
    return Response.json(
      { success: false, message: 'Failed to create caregiver link', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const linkId = searchParams.get('linkId');
    const passengerId = searchParams.get('passengerId');

    if (!linkId || !passengerId) {
      return Response.json(
        { success: false, message: 'linkId and passengerId are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const linkDoc = await adminDb.collection(CAREGIVER_LINKS_COLLECTION).doc(linkId).get();

    if (!linkDoc.exists) {
      return Response.json(
        { success: false, message: 'Caregiver link not found.' },
        { status: 404, headers: corsHeaders }
      );
    }

    const linkData = linkDoc.data() as CaregiverLink;
    if (linkData.passengerId !== passengerId) {
      return Response.json(
        { success: false, message: 'Unauthorized to remove this caregiver link.' },
        { status: 403, headers: corsHeaders }
      );
    }

    // Delete or mark status as REVOKED
    await adminDb.collection(CAREGIVER_LINKS_COLLECTION).doc(linkId).delete();

    return Response.json(
      {
        success: true,
        message: 'Caregiver link removed successfully.',
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('DELETE /api/caregiver/link Error:', error);
    return Response.json(
      { success: false, message: 'Failed to delete caregiver link', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
