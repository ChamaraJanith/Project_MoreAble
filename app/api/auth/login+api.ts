// POST /api/auth/login
import { getAdminAuth, getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { parseSriLankanNic } from '../../../src/shared/utils/nicUtils';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identifier, password } = body;

    if (!identifier || !password) {
      return Response.json(
        { success: false, message: 'Email or NIC and password are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const cleanIdentifier = identifier.trim();

    // Verify admin password if it's the admin email
    if (cleanIdentifier.toLowerCase() === 'admin@gmail.com') {
      if (password !== 'SecureAdmin123.me') {
        return Response.json(
          { success: false, message: 'Invalid credentials.' },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    // Check if identifier is a valid Sri Lankan NIC or Email
    const nicInfo = parseSriLankanNic(cleanIdentifier);
    let userQueryDoc: any = null;

    if (nicInfo.isValid) {
      // Query users collection by nicNo
      const snapshot = await adminDb
        .collection('users')
        .where('nicNo', '==', nicInfo.nicNumber)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        userQueryDoc = snapshot.docs[0].data();
      }
    } else {
      // Query users collection by email
      const snapshot = await adminDb
        .collection('users')
        .where('email', '==', cleanIdentifier.toLowerCase())
        .limit(1)
        .get();

      if (!snapshot.empty) {
        userQueryDoc = snapshot.docs[0].data();
      }
    }

    if (!userQueryDoc) {
      return Response.json(
        { success: false, message: 'No account found with provided Email or NIC.' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Return successful login response with User profile
    return Response.json(
      {
        success: true,
        message: 'Login successful!',
        user: userQueryDoc,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Login API Error:', error);
    return Response.json(
      {
        success: false,
        message: 'Internal server error during login.',
        error: error.message,
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
