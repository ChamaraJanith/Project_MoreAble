import { AccountStatus, AdminUserSummary, UserRole } from '../../../entities/user/model/types';
import { adminFetch } from './adminHttp';

/** Roles the retrieval endpoint accepts; 'ALL' returns every role. */
export type UserRoleFilter = UserRole | 'ALL';

/**
 * GET /api/users
 *
 * Returns registered users. The endpoint defaults to PASSENGER accounts, which
 * is what "Manage Users" administers; pass a role only when another set is
 * genuinely needed.
 *
 * The backend already strips passwordHash and every other credential field, so
 * nothing sensitive reaches the UI.
 */
export async function getUsers(role?: UserRoleFilter): Promise<AdminUserSummary[]> {
    const query = role ? `?role=${encodeURIComponent(role)}` : '';
    const data = await adminFetch(`/api/users${query}`);

    return Array.isArray(data.users) ? (data.users as AdminUserSummary[]) : [];
}

/**
 * Resolves a single user by document id.
 *
 * MOV-157 exposes a list endpoint only, so the lookup is done here in the data
 * layer rather than in a component. Returns null when the user is no longer
 * present, letting the caller show a proper not-found state.
 */
export async function getUserById(documentId: string): Promise<AdminUserSummary | null> {
    const users = await getUsers('ALL');

    return users.find((user) => user.documentId === documentId) ?? null;
}

/** The account status acknowledgement returned by the status endpoint. */
export interface AccountStatusUpdateResult {
    documentId: string;
    passengerId: string;
    accountStatus: AccountStatus;
    updatedAt: string | null;
}

/**
 * PATCH /api/users/:userId/status
 *
 * Suspends or reactivates one account. `documentId` is the identifier the
 * retrieval endpoint exposes and the status endpoint expects.
 *
 * adminFetch throws with the backend's own message when the request fails, so
 * callers can surface it directly.
 */
export async function updateUserAccountStatus(
    documentId: string,
    accountStatus: AccountStatus
): Promise<AccountStatusUpdateResult> {
    const data = await adminFetch(`/api/users/${encodeURIComponent(documentId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ accountStatus }),
    });

    return data.user as AccountStatusUpdateResult;
}