// Bus Device Login (MOV-265).
//
// The driver signs the vehicle in with the number plate on its side and the
// password the admin set for it, and gets back a token that says which bus this
// phone is. That token is what the GPS endpoint checks before accepting a
// position, so this is the only place a bus identity is established.
//
// It deliberately mirrors the existing user login route: same JWT utility, same
// `{ success, message, ... }` response shape, same CORS handling. Normal user
// and admin authentication are untouched.

import { Bus } from '../../../src/entities/bus/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { generateToken } from '../../../src/shared/config/jwt';
import { withoutBusCredentials } from '../../../src/shared/server/busCredentials';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** The role a bus session carries, as the location endpoint expects it. */
const VEHICLE_ROLE = 'BUS';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * One message for every credential failure.
 *
 * An unknown plate and a wrong password answer identically, so the response
 * cannot be used to work out which number plates exist in the fleet.
 */
const INVALID_CREDENTIALS = 'Incorrect number plate or password.';

function invalidCredentials(): Response {
  return Response.json(
    { success: false, message: INVALID_CREDENTIALS },
    { status: 401, headers: corsHeaders }
  );
}

/**
 * Finds a bus by the plate printed on it.
 *
 * Upper-cased to match how plates are stored — the create endpoint upper-cases
 * on the way in — so a driver typing lower case still signs in.
 */
async function findBusByNumberPlate(adminDb: any, numberPlate: string): Promise<Bus | null> {
  const snapshot = await adminDb
    .collection('buses')
    .where('numberPlate', '==', numberPlate.trim().toUpperCase())
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  return snapshot.docs[0].data() as Bus;
}

// POST /api/auth/bus-login
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { numberPlate, password } = body ?? {};

    if (typeof numberPlate !== 'string' || !numberPlate.trim()) {
      return Response.json(
        { success: false, message: 'Bus number plate is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (typeof password !== 'string' || !password) {
      return Response.json(
        { success: false, message: 'Bus password is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const bus = await findBusByNumberPlate(adminDb, numberPlate);

    if (!bus) {
      return invalidCredentials();
    }

    // A bus with no password configured cannot be signed in to. It is not an
    // error in the fleet record — an admin simply has to set one — but it must
    // never fall through to a successful login.
    if (typeof bus.password !== 'string' || !bus.password) {
      return invalidCredentials();
    }

    // Compared exactly as stored and as typed. The project stores this
    // credential in the clear by design, so there is no hash to verify against.
    if (password !== bus.password) {
      return invalidCredentials();
    }

    if (typeof bus.busId !== 'string' || !bus.busId.trim()) {
      // Without an id there is nothing to put in the token, and the GPS
      // endpoint would have no bus to match against.
      return Response.json(
        { success: false, message: 'This bus record is incomplete. Please contact your operator.' },
        { status: 409, headers: corsHeaders }
      );
    }

    // ----------------------------------------------------------
    // The session token.
    //
    // `busId` is what the location endpoint compares against the id in the URL,
    // which is what stops one bus reporting a position for another. The
    // password is not part of the token and never travels beyond this route.
    // ----------------------------------------------------------
    const token = await generateToken({
      uid: bus.busId,
      passengerId: '',
      role: VEHICLE_ROLE,
      email: '',
      busId: bus.busId,
    });

    return Response.json(
      {
        success: true,
        message: 'Bus signed in successfully.',
        token,
        // Stripped of the credential, like every other bus response.
        bus: withoutBusCredentials(bus),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    // The caught error is logged, never the submitted credentials.
    console.error('Bus Login API Error:', error?.message || error);

    return Response.json(
      { success: false, message: 'Unable to sign in right now. Please try again.' },
      { status: 500, headers: corsHeaders }
    );
  }
}
