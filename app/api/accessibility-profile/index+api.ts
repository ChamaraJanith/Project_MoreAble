// GET, POST, PUT & DELETE /api/accessibility-profile
// Manages Accessibility Profiles in Firestore collection 'accessibility_needs_persons'
import { AccessibilityProfile } from '../../../src/entities/user/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { parseAccessibilityRequirements } from '../../../src/shared/utils/accessibility';

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

    // MOV-93: the stored preference is sanitised on the way out, never trusted
    // as stored. Firestore is schema-less, so this field can hold anything a
    // past write or a hand edit left there; only recognised keys survive, in
    // canonical order, and anything else reads as no preference at all. A
    // passenger is never handed a filter the system cannot honour, and a
    // malformed document never fails the read.
    const storedRequirements = parseAccessibilityRequirements(
      accData?.journeyAccessibilityRequirements
    );

    return Response.json(
      {
        success: true,
        profile: {
          ...accData,
          // Always an array, so "no preference saved" and "preference saved as
          // empty" reach the client as the same thing it already handles.
          journeyAccessibilityRequirements: storedRequirements.requirements,
        },
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
      otherDescription,
      requestedServices,
      journeyAccessibilityRequirements,
    } = body;

    // MOV-93. Absent means "this request is not about the journey filters",
    // which is every request that predates the field — the stored preference is
    // then left exactly as it was rather than being cleared.
    const statesJourneyRequirements =
      journeyAccessibilityRequirements !== undefined && journeyAccessibilityRequirements !== null;
    const journeyRequirements = parseAccessibilityRequirements(journeyAccessibilityRequirements);

    if (journeyRequirements.malformed) {
      return Response.json(
        {
          success: false,
          message: 'journeyAccessibilityRequirements must be a list of accessibility requirements.',
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Rejected rather than stored and ignored later: an arbitrary string kept on
    // the record would look like a saved requirement that silently never
    // filters anything.
    if (journeyRequirements.unrecognized.length > 0) {
      return Response.json(
        {
          success: false,
          message: `Unknown accessibility requirement: ${journeyRequirements.unrecognized.join(', ')}.`,
        },
        { status: 400, headers: corsHeaders }
      );
    }

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

    let profileIdIsNew = false;

    if (!targetProfileId) {
      const formattedSequence = String(Math.floor(Math.random() * 90000) + 10000).padStart(5, '0');
      targetProfileId = `ACC-${currentYear}-${formattedSequence}`;
      profileIdIsNew = true;
    }

    // MOV-93: a request that states ONLY the journey filters updates only those.
    //
    // The journey screen holds the passenger's filter selection, not their
    // accessibility profile, so it cannot resend the rest of the record. Taking
    // the path below with the fields it does not have would blank the
    // passenger's accessibility needs, their description and their requested
    // services. Guarded on `accessibilityNeeds` being absent, so every existing
    // caller — all of which send it — behaves exactly as it always has.
    if (statesJourneyRequirements && accessibilityNeeds === undefined) {
      const profileRef = adminDb.collection('accessibility_needs_persons').doc(targetProfileId);
      const existingProfile = await profileRef.get();

      await profileRef.set(
        {
          accessibilityProfileId: targetProfileId,
          // Written even when empty: clearing every filter is a preference in
          // its own right and must survive leaving the screen.
          journeyAccessibilityRequirements: journeyRequirements.requirements,
          // Only for a record this request is creating, so an existing
          // profile's own creation time is never rewritten.
          ...(existingProfile.exists
            ? {}
            : {
                userId: userId || '',
                passengerId: passengerId || '',
                hasAccessibilityNeeds: false,
                accessibilityNeeds: [],
                createdAt: now,
              }),
          updatedAt: now,
        },
        { merge: true }
      );

      // Without this, a preference saved against a freshly generated id would
      // be written to a document nothing could find again. Only the pointer is
      // touched — none of the user's accessibility indicator flags.
      if (passengerId && profileIdIsNew) {
        await adminDb
          .collection('users')
          .doc(passengerId)
          .set({ accessibilityProfileId: targetProfileId, updatedAt: now }, { merge: true });
      }

      return Response.json(
        {
          success: true,
          message: 'Accessibility filter preference saved successfully!',
          profileId: targetProfileId,
          journeyAccessibilityRequirements: journeyRequirements.requirements,
        },
        { status: 200, headers: corsHeaders }
      );
    }

    const selectedNeeds = Array.isArray(accessibilityNeeds) ? accessibilityNeeds : [];
    const isWheelchairUser = selectedNeeds.includes('wheelchair');
    const isLowVisionPerson = selectedNeeds.includes('low_vision');
    const isHearingImpaired = selectedNeeds.includes('hearing_impairment');
    const isWalkingDifficultyPerson = selectedNeeds.includes('walking_difficulty');
    const isOtherAccessibilityPerson = selectedNeeds.includes('other');
    const otherDesc = otherDescription ? otherDescription.trim() : null;
    const hasNeeds = selectedNeeds.length > 0;

    const profileRecord: AccessibilityProfile = {
      accessibilityProfileId: targetProfileId,
      userId: userId || '',
      passengerId: passengerId || '',
      hasAccessibilityNeeds: hasNeeds,
      accessibilityNeeds: selectedNeeds,
      otherDescription: otherDesc,
      requestedServices: requestedServices || {},
      // Omitted entirely when the request does not state it, so a full profile
      // save from the accessibility profile screen leaves a preference saved
      // from the journey screen untouched (the write below merges).
      ...(statesJourneyRequirements
        ? { journeyAccessibilityRequirements: journeyRequirements.requirements }
        : {}),
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
          isWalkingDifficultyPerson: isWalkingDifficultyPerson,
          isOtherAccessibilityPerson: isOtherAccessibilityPerson,
          otherDescription: otherDesc,
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
