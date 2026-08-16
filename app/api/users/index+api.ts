import { AdminUserSummary, UserRole } from '../../../src/entities/user/model/types';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { resolveAccountStatus } from './[userId]/status+api';

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

const USER_ROLES: UserRole[] = ['PASSENGER', 'GUARDIAN', 'ADMIN'];

// "Manage Users" administers passenger accounts. Operator/ADMIN records live in
// the same collection but are not customer accounts, so they are excluded by
// default and only returned when explicitly asked for.
const DEFAULT_ROLE: UserRole = 'PASSENGER';

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Projects a stored user document onto the fields the admin dashboard needs.
 *
 * This is an allow-list: any field not named here — passwordHash above all, but
 * equally any token, OTP or secret added to the schema later — is simply never
 * copied into the response. Firestore is untouched.
 */
export function toAdminUserSummary(documentId: string, data: any): AdminUserSummary {
  return {
    documentId,
    passengerId: typeof data?.passengerId === 'string' ? data.passengerId : documentId,
    userName: typeof data?.userName === 'string' ? data.userName : '',
    email: typeof data?.email === 'string' ? data.email : '',
    phoneNumber: toNullableString(data?.phoneNumber),
    secondaryPhoneNumber: toNullableString(data?.secondaryPhoneNumber),
    nicNo: typeof data?.nicNo === 'string' ? data.nicNo : '',
    calculatedAge: typeof data?.calculatedAge === 'number' ? data.calculatedAge : null,
    isElderPerson: data?.isElderPerson === true,
    isVerified: data?.isVerified === true,
    // Documents created before MOV-158 have no stored value; they read as ACTIVE
    // without being written to.
    accountStatus: resolveAccountStatus(data?.accountStatus),
    role: USER_ROLES.includes(data?.role) ? data.role : DEFAULT_ROLE,
    guardianId: toNullableString(data?.guardianId),
    accessibilityProfileId: toNullableString(data?.accessibilityProfileId),
    createdAt: toNullableString(data?.createdAt),
    updatedAt: toNullableString(data?.updatedAt),
  };
}

/** Resolves the ?role= filter. 'ALL' returns every role. */
export function resolveRoleFilter(rawRole: string | null): UserRole | 'ALL' {
  if (!rawRole) return DEFAULT_ROLE;

  const normalized = rawRole.trim().toUpperCase();

  if (normalized === 'ALL') return 'ALL';
  if ((USER_ROLES as string[]).includes(normalized)) return normalized as UserRole;

  return DEFAULT_ROLE;
}

// GET /api/users
//
// Read-only retrieval of registered users for the admin dashboard.
// Optional query parameter:
//   ?role=PASSENGER | GUARDIAN | ADMIN | ALL   (default: PASSENGER)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roleFilter = resolveRoleFilter(url.searchParams.get('role'));

    const adminDb = getAdminDb();

    // Ordered by creation only. Combining a role `where` with this `orderBy`
    // would require a composite Firestore index, so the role filter is applied
    // in memory instead.
    const snapshot = await adminDb
      .collection('users')
      .orderBy('createdAt', 'desc')
      .get();

    const users = snapshot.docs
      .map((doc: any) => toAdminUserSummary(doc.id, doc.data()))
      .filter((user: AdminUserSummary) => roleFilter === 'ALL' || user.role === roleFilter);

    return Response.json(
      {
        success: true,
        message: 'Users retrieved successfully.',
        count: users.length,
        users,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Users API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve users.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}