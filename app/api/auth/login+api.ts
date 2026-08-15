// POST /api/auth/login
import bcrypt from 'bcryptjs';
import { getAdminAuth, getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { generateToken } from '../../../src/shared/config/jwt';
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

    // Verify password using bcrypt
    // Admin account uses hardcoded check as a fallback
    const isAdmin = userQueryDoc.role === 'ADMIN';

    if (isAdmin && cleanIdentifier.toLowerCase() === 'admin@gmail.com') {
      // Admin hardcoded password verification (legacy fallback)
      if (password !== 'SecureAdmin123.me') {
        return Response.json(
          { success: false, message: 'Invalid credentials.' },
          { status: 401, headers: corsHeaders }
        );
      }
    } else {
      // Standard bcrypt password verification
      const storedHash = userQueryDoc.passwordHash;

      if (!storedHash) {
        return Response.json(
          { success: false, message: 'Account requires password reset. No password hash found.' },
          { status: 401, headers: corsHeaders }
        );
      }

      const isPasswordValid = await bcrypt.compare(password, storedHash);
      if (!isPasswordValid) {
        return Response.json(
          { success: false, message: 'Invalid credentials.' },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    // Generate JWT token
    const token = await generateToken({
      uid: userQueryDoc.uid,
      passengerId: userQueryDoc.passengerId,
      role: userQueryDoc.role,
      email: userQueryDoc.email,
    });

    // Build sanitized user object (exclude passwordHash from response)
    const { passwordHash: _hash, ...sanitizedUser } = userQueryDoc;

    // Return successful login response with JWT token and user profile
    return Response.json(
      {
        success: true,
        message: 'Login successful!',
        token,
        user: sanitizedUser,
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
