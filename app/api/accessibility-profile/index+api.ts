// GET, POST, PUT & DELETE /api/accessibility-profile
// Manages Accessibility Profiles in Firestore collection 'accessibility_needs_persons'
import { AccessibilityProfile } from '../../../src/entities/user/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/accessibility-profile?profileId=ACC-2026-00012 or ?passengerId=PAS-2026-00012
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const passengerId = searchParams.get('passengerId');

    const adminDb = getAdminDb();
    let targetProfileId = profileId;

    // Lookup profileId by passengerId if not directly provided
    if (!targetProfileId && passengerId) {
      const userDoc = await adminDb.collection('users').doc(passengerId).get();
      if (userDoc.exists) {
        targetProfileId = userDoc.data()?.accessibilityProfileId || null;
      }
    }

    if (!targetProfileId) {
      return Response.json(
        { success: false, message: 'Accessibility Profile ID or Passenger ID is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const accDoc = await adminDb.collection('accessibility_needs_persons').doc(targetProfileId).get();

    if (!accDoc.exists) {
      return Response.json(
        { success: false, message: 'Accessibility Profile record not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const accData = accDoc.data() as AccessibilityProfile;
    return Response.json(
      {
        success: true,
        profile: accData,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('GET /api/accessibility-profile Error:', error);
    return Response.json(
      { success: false, message: 'Internal Server Error', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

// POST / PUT /api/accessibility-profile — Create or Update Accessibility Profile
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      passengerId,
      userId,
      accessibilityProfileId,
      accessibilityNeeds,
      requestedServices,
    } = body;

    const adminDb = getAdminDb();
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    let targetProfileId = accessibilityProfileId;

    if (!targetProfileId && passengerId) {
      // Lookup existing accessibilityProfileId from user document
      const userDoc = await adminDb.collection('users').doc(passengerId).get();
      if (userDoc.exists) {
        targetProfileId = userDoc.data()?.accessibilityProfileId || null;
      }
    }

    if (!targetProfileId) {
      const formattedSequence = String(Math.floor(Math.random() * 90000) + 10000).padStart(5, '0');
      targetProfileId = `ACC-${currentYear}-${formattedSequence}`;
    }

    const selectedNeeds = Array.isArray(accessibilityNeeds) ? accessibilityNeeds : [];
    const isWheelchairUser = selectedNeeds.includes('wheelchair');
    const isLowVisionPerson = selectedNeeds.includes('low_vision');
    const isHearingImpaired = selectedNeeds.includes('hearing_impairment');
    const hasNeeds = selectedNeeds.length > 0;

    const profileRecord: AccessibilityProfile = {
      accessibilityProfileId: targetProfileId,
      userId: userId || '',
      passengerId: passengerId || '',
      hasAccessibilityNeeds: hasNeeds,
      accessibilityNeeds: selectedNeeds,
      requestedServices: requestedServices || {},
      createdAt: now,
      updatedAt: now,
    };

    // 1. Save document in accessibility_needs_persons collection
    await adminDb
      .collection('accessibility_needs_persons')
      .doc(targetProfileId)
      .set(profileRecord, { merge: true });

    // 2. Sync indicator flags & profile ID to user document
    if (passengerId) {
      await adminDb.collection('users').doc(passengerId).set(
        {
          accessibilityProfileId: targetProfileId,
          hasAccessibilityNeeds: hasNeeds,
          isWheelchairUser: isWheelchairUser,
          isLowVisionPerson: isLowVisionPerson,
          isHearingImpaired: isHearingImpaired,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    return Response.json(
      {
        success: true,
        message: 'Accessibility profile saved successfully!',
        profileId: targetProfileId,
        profile: profileRecord,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/accessibility-profile Error:', error);
    return Response.json(
      { success: false, message: 'Failed to save accessibility profile', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

// DELETE /api/accessibility-profile — Remove Accessibility Profile record
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const passengerId = searchParams.get('passengerId');

    const adminDb = getAdminDb();

    if (profileId) {
      await adminDb.collection('accessibility_needs_persons').doc(profileId).delete();
    }

    if (passengerId) {
      await adminDb.collection('users').doc(passengerId).set(
        {
          accessibilityProfileId: null,
          hasAccessibilityNeeds: false,
          isWheelchairUser: false,
          isLowVisionPerson: false,
          isHearingImpaired: false,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return Response.json(
      { success: true, message: 'Accessibility profile removed successfully' },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('DELETE /api/accessibility-profile Error:', error);
    return Response.json(
      { success: false, message: 'Failed to delete accessibility profile', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
