// POST /api/auth/reset-password
// Resets a user's password using Email, NIC Number, or Phone Number
import bcrypt from 'bcryptjs';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { parseSriLankanNic } from '../../../src/shared/utils/nicUtils';

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
    const { identifier, newPassword } = body;

    if (!identifier || !newPassword) {
      return Response.json(
        { success: false, message: 'Account identifier (Email, NIC, or Mobile) and new password are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (newPassword.length < 6) {
      return Response.json(
        { success: false, message: 'New password must be at least 6 characters long.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const cleanIdentifier = identifier.trim();

    // Query user by NIC, Email, or Phone Number
    const nicInfo = parseSriLankanNic(cleanIdentifier);
    let userDocRef: any = null;

    if (nicInfo.isValid) {
      const snapshot = await adminDb
        .collection('users')
        .where('nicNo', '==', nicInfo.nicNumber)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        userDocRef = snapshot.docs[0].ref;
      }
    }

    // Try finding by Email if not found by NIC
    if (!userDocRef) {
      const emailSnapshot = await adminDb
        .collection('users')
        .where('email', '==', cleanIdentifier.toLowerCase())
        .limit(1)
        .get();

      if (!emailSnapshot.empty) {
        userDocRef = emailSnapshot.docs[0].ref;
      }
    }

    // Try finding by Primary Phone Number if not found
    if (!userDocRef) {
      const phoneSnapshot = await adminDb
        .collection('users')
        .where('phoneNumber', '==', cleanIdentifier)
        .limit(1)
        .get();

      if (!phoneSnapshot.empty) {
        userDocRef = phoneSnapshot.docs[0].ref;
      }
    }

    // Try finding by Secondary Phone Number if not found
    if (!userDocRef) {
      const secPhoneSnapshot = await adminDb
        .collection('users')
        .where('secondaryPhoneNumber', '==', cleanIdentifier)
        .limit(1)
        .get();

      if (!secPhoneSnapshot.empty) {
        userDocRef = secPhoneSnapshot.docs[0].ref;
      }
    }

    if (!userDocRef) {
      return Response.json(
        { success: false, message: 'No registered account found matching the provided Email, NIC, or Mobile number.' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update passwordHash in Firestore
    await userDocRef.update({
      passwordHash,
      updatedAt: new Date().toISOString(),
    });

    return Response.json(
      {
        success: true,
        message: 'Password reset successfully! You can now log in with your new password.',
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Reset Password API Error:', error);
    return Response.json(
      { success: false, message: 'Internal server error while resetting password.', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
