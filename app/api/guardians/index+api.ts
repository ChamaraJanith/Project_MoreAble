// GET & POST /api/guardians
// Fetches or creates/updates Guardian details in Firestore
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guardianId = searchParams.get('guardianId');
    const passengerId = searchParams.get('passengerId');

    const adminDb = getAdminDb();

    let targetGuardianId = guardianId;

    // If passengerId provided but no guardianId, lookup user's guardianId
    if (!targetGuardianId && passengerId) {
      const userDoc = await adminDb.collection('users').doc(passengerId).get();
      if (userDoc.exists) {
        targetGuardianId = userDoc.data()?.guardianId || null;
      }
    }

    if (!targetGuardianId) {
      return Response.json(
        { success: false, message: 'Guardian ID or Passenger ID required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Fetch from guardians collection
    const gDoc = await adminDb.collection('guardians').doc(targetGuardianId).get();

    if (!gDoc.exists) {
      return Response.json(
        { success: false, message: 'Guardian record not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const gData = gDoc.data();
    return Response.json(
      {
        success: true,
        guardian: {
          guardianId: targetGuardianId,
          fullName: gData?.fullName || '',
          nicNo: gData?.nicNo || '',
          mobileNo: gData?.mobileNo || '',
          relationship: gData?.relationship || '',
          email: gData?.email || '',
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('GET /api/guardians Error:', error);
    return Response.json(
      { success: false, message: 'Internal Server Error', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { passengerId, guardianId, fullName, nicNo, mobileNo, relationship, email } = body;

    if (!fullName || !nicNo || !mobileNo) {
      return Response.json(
        { success: false, message: 'Full name, NIC, and mobile number are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    let finalGuardianId = guardianId;

    if (!finalGuardianId) {
      const formattedSequence = String(Math.floor(Math.random() * 90000) + 10000).padStart(5, '0');
      finalGuardianId = `GUD-${currentYear}-${formattedSequence}`;
    }

    const guardianRecord = {
      guardianId: finalGuardianId,
      fullName: fullName.trim(),
      nicNo: nicNo.trim(),
      mobileNo: mobileNo.trim(),
      relationship: relationship ? relationship.trim() : 'Son / Daughter',
      email: email ? email.trim() : '',
      updatedAt: now,
    };

    // 1. Save or update document in guardians collection
    await adminDb.collection('guardians').doc(finalGuardianId).set(guardianRecord, { merge: true });

    // 2. Link to user document if passengerId provided
    if (passengerId) {
      await adminDb.collection('users').doc(passengerId).set(
        {
          guardianId: finalGuardianId,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    return Response.json(
      {
        success: true,
        message: 'Guardian details saved successfully!',
        guardianId: finalGuardianId,
        guardian: guardianRecord,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/guardians Error:', error);
    return Response.json(
      { success: false, message: 'Failed to save guardian details', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
