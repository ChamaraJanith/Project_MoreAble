import { AccountStatus } from '../../../../src/entities/user/model/types';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

const ACCOUNT_STATUSES: AccountStatus[] = ['ACTIVE', 'SUSPENDED'];

/** Documents predating this field are treated as active until an admin says otherwise. */
export const DEFAULT_ACCOUNT_STATUS: AccountStatus = 'ACTIVE';

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && (ACCOUNT_STATUSES as string[]).includes(value);
}

/** Resolves a stored value, defaulting legacy documents to ACTIVE. */
export function resolveAccountStatus(value: unknown): AccountStatus {
  return isAccountStatus(value) ? value : DEFAULT_ACCOUNT_STATUS;
}

/**
 * Pulls the user id out of /api/users/:userId/status.
 *
 * The id is the second-to-last segment here, unlike the flat resource routes
 * where it is last.
 */
function extractUserId(request: Request, context: any): string {
  const fromContext = context?.params?.userId;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const statusIndex = parts.lastIndexOf('status');
  const candidate = statusIndex > 0 ? parts[statusIndex - 1] : '';

  return candidate && candidate !== 'users' ? decodeURIComponent(candidate) : '';
}

// PATCH /api/users/:userId/status
//
// Suspends or reactivates a single account. Deliberately narrow: it can write
// accountStatus and updatedAt only, so it can never be used to alter
// credentials, verification state, role or any other user field.
export async function PATCH(request: Request, context?: any) {
  try {
    const userId = extractUserId(request, context);

    if (!userId) {
      return Response.json(
        {
          success: false,
          message: 'User ID is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return Response.json(
        {
          success: false,
          message: 'A valid request body is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const { accountStatus } = body as { accountStatus?: unknown };

    if (accountStatus === undefined || accountStatus === null || accountStatus === '') {
      return Response.json(
        {
          success: false,
          message: 'Account status is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!isAccountStatus(accountStatus)) {
      return Response.json(
        {
          success: false,
          message: 'Account status must be ACTIVE or SUSPENDED.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const adminDb = getAdminDb();

    const userRef = adminDb.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return Response.json(
        {
          success: false,
          message: 'User not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // Only these two keys are written — every other field is left untouched.
    await userRef.update({
      accountStatus,
      updatedAt: new Date().toISOString(),
    });

    const updatedDoc = await userRef.get();
    const updated = updatedDoc.data() ?? {};

    return Response.json(
      {
        success: true,
        message: 'User account status updated successfully.',
        user: {
          documentId: userId,
          passengerId:
            typeof updated.passengerId === 'string' ? updated.passengerId : userId,
          accountStatus: resolveAccountStatus(updated.accountStatus),
          updatedAt: typeof updated.updatedAt === 'string' ? updated.updatedAt : null,
        },
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update User Status API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update user account status.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}