// GET, POST, DELETE /api/medical-profile
// Manages Medical Profiles in Firestore collection 'medical_profiles'
import { MedicalProfile } from '../../../src/entities/user/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/medical-profile?profileId=MED-2026-00001 or ?passengerId=PAS-2026-00001
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const passengerId = searchParams.get('passengerId');

    const adminDb = getAdminDb();
    let targetProfileId = profileId;

    // Lookup by passengerId
    if (!targetProfileId && passengerId) {
      const snapshot = await adminDb
        .collection('medical_profiles')
        .where('passengerId', '==', passengerId)
        .limit(1)
        .get();
        
      if (!snapshot.empty) {
        targetProfileId = snapshot.docs[0].id;
      }
    }

    if (!targetProfileId) {
      return Response.json(
        { success: false, message: 'Medical Profile ID or Passenger ID is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const medDoc = await adminDb.collection('medical_profiles').doc(targetProfileId).get();

    if (!medDoc.exists) {
      return Response.json(
        { success: false, message: 'Medical Profile record not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const medData = medDoc.data() as MedicalProfile;
    return Response.json(
      {
        success: true,
        profile: medData,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('GET /api/medical-profile Error:', error);
    return Response.json(
      { success: false, message: 'Internal Server Error', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

// POST /api/medical-profile - Create or Update Medical Profile
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      passengerId,
      userId,
      medicalProfileId,
      bloodType,
      allergies,
      currentMedications,
      chronicConditions,
      emergencyNotes,
    } = body;

    if (!passengerId || !userId) {
      return Response.json(
        { success: false, message: 'passengerId and userId are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    let targetProfileId = medicalProfileId;

    // Auto-generate ID if none is provided
    if (!targetProfileId) {
      // Check if one already exists for this passenger first
      const existingSnapshot = await adminDb
        .collection('medical_profiles')
        .where('passengerId', '==', passengerId)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        targetProfileId = existingSnapshot.docs[0].id;
      } else {
        const formattedSequence = String(Math.floor(Math.random() * 90000) + 10000).padStart(5, '0');
        targetProfileId = `MED-${currentYear}-${formattedSequence}`;
      }
    }

    const profileRecord: MedicalProfile = {
      medicalProfileId: targetProfileId,
      userId,
      passengerId,
      bloodType: bloodType || null,
      allergies: allergies || null,
      currentMedications: currentMedications || null,
      chronicConditions: chronicConditions || null,
      emergencyNotes: emergencyNotes || null,
      createdAt: now,
      updatedAt: now,
    };

    // 1. Save document in medical_profiles collection
    await adminDb
      .collection('medical_profiles')
      .doc(targetProfileId)
      .set(profileRecord, { merge: true });

    // 2. Sync indicator flag back to user document
    await adminDb.collection('users').doc(passengerId).set(
      {
        hasMedicalInformation: true,
        updatedAt: now,
      },
      { merge: true }
    );

    return Response.json(
      {
        success: true,
        message: 'Medical profile saved successfully!',
        profileId: targetProfileId,
        profile: profileRecord,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/medical-profile Error:', error);
    return Response.json(
      { success: false, message: 'Failed to save medical profile', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

// DELETE /api/medical-profile - Remove Medical Profile record
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const passengerId = searchParams.get('passengerId');

    const adminDb = getAdminDb();
    
    let targetProfileId = profileId;

    // Lookup by passengerId
    if (!targetProfileId && passengerId) {
      const snapshot = await adminDb
        .collection('medical_profiles')
        .where('passengerId', '==', passengerId)
        .limit(1)
        .get();
        
      if (!snapshot.empty) {
        targetProfileId = snapshot.docs[0].id;
      }
    }

    if (targetProfileId) {
      await adminDb.collection('medical_profiles').doc(targetProfileId).delete();
    }

    if (passengerId) {
      await adminDb.collection('users').doc(passengerId).set(
        {
          hasMedicalInformation: false,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return Response.json(
      { success: true, message: 'Medical profile removed successfully' },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('DELETE /api/medical-profile Error:', error);
    return Response.json(
      { success: false, message: 'Failed to delete medical profile', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
