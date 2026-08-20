// Bus Device Login (MOV-265).
//
// A driver signs the vehicle in with the number plate on its side and the
// password an admin configured for it, and receives a session token that says
// which bus this phone is. Establishing that identity is all this route does.
//
// It mirrors the existing user login route deliberately: same JWT utility, same
// `{ success, message, ... }` response shape, same CORS handling. Normal user
// and admin authentication are untouched, and so is the way bus passwords are
// stored — this only reads the field the admin screens already write.

import { Bus } from '../../../src/entities/bus/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { generateToken } from '../../../src/shared/config/jwt';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** The role a bus session carries, distinguishing it from a person's session. */
const VEHICLE_ROLE = 'BUS';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * One answer for every credential failure.
 *
 * An unknown plate, a wrong password and a bus with no password configured all
 * respond identically, so the endpoint cannot be used to work out which plates
 * exist in the fleet or which of them are set up for driver sign in.
 */
const SIGN_IN_REFUSED = 'Incorrect number plate or password.';

function refuseSignIn(): Response {
  return Response.json(
    { success: false, message: SIGN_IN_REFUSED },
    { status: 401, headers: corsHeaders }
  );
}

/**
 * Finds a bus by the plate printed on it.
 *
 * Trimmed and upper-cased to match how plates are stored — bus creation applies
 * exactly this normalisation before writing — so a driver typing lower case or
 * with a stray space still signs in.
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
      return refuseSignIn();
    }

    // A bus an admin has not given a password to cannot be signed in to. That
    // is not a broken fleet record — the admin simply has to set one — but it
    // must never fall through to a successful sign in.
    if (typeof bus.password !== 'string' || !bus.password) {
      return refuseSignIn();
    }

    // Compared exactly as stored and as typed. This project keeps the fleet
    // credential in the clear by design, so there is no hash to verify against.
    if (password !== bus.password) {
      return refuseSignIn();
    }

    if (typeof bus.busId !== 'string' || !bus.busId.trim()) {
      // Without an id there is no identity to put in a token, and nothing
      // downstream would be able to act on the session.
      return Response.json(
        { success: false, message: 'This bus record is incomplete. Please contact your operator.' },
        { status: 409, headers: corsHeaders }
      );
    }

    // ----------------------------------------------------------
    // The session token.
    //
    // `busId` is the claim later work compares against the bus being acted on,
    // which is what will stop one bus acting as another. The password is not a
    // claim and never becomes one: it is read here and goes no further.
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
        // Built field by field rather than by stripping a stored record, so
        // there is no path by which a credential or unrelated fleet detail can
        // reach a driver's phone. The plate is included only so the app can
        // show which bus is signed in.
        bus: {
          busId: bus.busId,
          numberPlate: bus.numberPlate,
        },
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    // Only the error's own message is logged. The submitted credentials and the
    // issued token are never written anywhere.
    console.error('Bus Login API Error:', error?.message || 'Unknown error');

    return Response.json(
      { success: false, message: 'Unable to sign in right now. Please try again.' },
      { status: 500, headers: corsHeaders }
    );
  }
}
