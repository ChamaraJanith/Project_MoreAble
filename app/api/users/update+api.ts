// POST & PUT /api/users/update
// Updates passenger user profile details in Firestore users collection
import { parseSriLankanNic } from '../../../src/shared/utils/nicUtils';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      passengerId,
      uid,
      userName,
      email,
      phoneNumber,
      secondaryPhoneNumber,
      nicNo,
    } = body;

    if (!passengerId && !uid) {
      return Response.json(
        { success: false, message: 'Passenger ID or UID is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const docId = passengerId || uid;
    const now = new Date().toISOString();

    // Recalculate age & elderly status if NIC is updated
    let calculatedAge: number | null = null;
    let isElderPerson = false;

    if (nicNo) {
      const nicInfo = parseSriLankanNic(nicNo);
      if (nicInfo.isValid) {
        calculatedAge = nicInfo.age;
        isElderPerson = nicInfo.age >= 60;
      }
    }

    const updatePayload: Record<string, any> = {
      updatedAt: now,
    };

    if (userName !== undefined) updatePayload.userName = userName.trim();
    if (email !== undefined) updatePayload.email = email.trim().toLowerCase();
    if (phoneNumber !== undefined) updatePayload.phoneNumber = phoneNumber.trim();
    if (secondaryPhoneNumber !== undefined) updatePayload.secondaryPhoneNumber = secondaryPhoneNumber ? secondaryPhoneNumber.trim() : null;
    if (nicNo !== undefined) {
      updatePayload.nicNo = nicNo.trim();
      if (calculatedAge !== null) {
        updatePayload.calculatedAge = calculatedAge;
        updatePayload.isElderPerson = isElderPerson;
      }
    }

    // 1. Update document in users collection
    await adminDb.collection('users').doc(docId).set(updatePayload, { merge: true });

    // 2. Read updated user document
    const updatedDoc = await adminDb.collection('users').doc(docId).get();
    const updatedUser = updatedDoc.data();

    return Response.json(
      {
        success: true,
        message: 'Profile details updated successfully!',
        user: updatedUser,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/users/update Error:', error);
    return Response.json(
      { success: false, message: 'Failed to update user profile details', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
