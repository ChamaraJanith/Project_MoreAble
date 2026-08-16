import {
    isAccountStatus,
    resolveAccountStatus,
    PATCH as updateUserStatus,
} from '../../../app/api/users/[userId]/status+api';
import { GET as getUsers } from '../../../app/api/users/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

// jest.mock is hoisted above imports by ts-jest, so the route modules resolve
// getAdminDb to this mock before they run. No real Firestore is ever touched.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const USER_ID = 'PAS-2026-00002';

function statusRequest(body: unknown, userId: string = USER_ID): Request {
    return new Request(`http://localhost/api/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const patchContext = (userId: string = USER_ID) => ({ params: { userId } });

/**
 * A stored passenger document matching the structure written by
 * app/api/auth/register+api.ts, including the passwordHash that must never
 * be returned.
 */
function storedPassenger(overrides: Record<string, any> = {}): Record<string, any> {
    const passengerId = overrides.passengerId ?? USER_ID;

    return {
        id: passengerId,
        uid: 'firebase-uid-0002',
        passengerId,
        userName: 'Kavindu Perera',
        email: 'kavindu.p@example.com',
        nicNo: '199824501234',
        calculatedAge: 27,
        isElderPerson: false,
        role: 'PASSENGER',
        phoneNumber: '+94771234567',
        secondaryPhoneNumber: null,
        isVerified: true,
        guardianId: 'GRD-2026-00003',
        accessibilityProfileId: 'ACC-2026-00005',
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789SECRETHASH',
        ...overrides,
    };
}

/** A Firestore double whose document update rejects. */
function failingUpdateFirestore(message = 'Firestore unavailable') {
    return {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => storedPassenger(),
                }),
                update: jest.fn().mockRejectedValue(new Error(message)),
            })),
        })),
    };
}

/**
 * Reads a document back through the fake's own API.
 *
 * createFakeFirestore copies the seed objects, so asserting against the seed
 * reference would silently pass regardless of what the handler wrote.
 */
async function readStoredUser(db: any, userId: string = USER_ID): Promise<Record<string, any>> {
    const doc = await db.collection('users').doc(userId).get();
    return doc.data() ?? {};
}

const SENSITIVE_FIELDS = [
    'passwordHash',
    'password',
    'otp',
    'otpCode',
    'token',
    'accessToken',
    'refreshToken',
    'secret',
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// SUSPEND
// ==================================================================
describe('PATCH /api/users/:userId/status - suspend', () => {
    it('suspends an active user', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger({ accountStatus: 'ACTIVE' })] })
        );

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'SUSPENDED' }),
            patchContext()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toMatch(/updated successfully/i);
        expect(json.user.accountStatus).toBe('SUSPENDED');
        expect(json.user.documentId).toBe(USER_ID);
    });

    it('persists the suspension to the stored document', async () => {
        const db = createFakeFirestore({ users: [storedPassenger({ accountStatus: 'ACTIVE' })] });
        mockGetAdminDb.mockReturnValue(db);

        await updateUserStatus(statusRequest({ accountStatus: 'SUSPENDED' }), patchContext());

        expect((await readStoredUser(db)).accountStatus).toBe('SUSPENDED');
    });

    it('refreshes updatedAt', async () => {
        const db = createFakeFirestore({ users: [storedPassenger({ accountStatus: 'ACTIVE' })] });
        mockGetAdminDb.mockReturnValue(db);

        await updateUserStatus(statusRequest({ accountStatus: 'SUSPENDED' }), patchContext());

        const after = await readStoredUser(db);
        expect(after.updatedAt).not.toBe('2026-08-01T10:00:00.000Z');
        expect(Number.isNaN(Date.parse(after.updatedAt))).toBe(false);
    });

    it('leaves every other stored field untouched', async () => {
        const db = createFakeFirestore({ users: [storedPassenger({ accountStatus: 'ACTIVE' })] });
        mockGetAdminDb.mockReturnValue(db);

        await updateUserStatus(statusRequest({ accountStatus: 'SUSPENDED' }), patchContext());

        const after = await readStoredUser(db);
        expect(after.accountStatus).toBe('SUSPENDED');
        expect(after.isVerified).toBe(true);
        expect(after.role).toBe('PASSENGER');
        expect(after.email).toBe('kavindu.p@example.com');
        expect(after.phoneNumber).toBe('+94771234567');
        expect(after.nicNo).toBe('199824501234');
        expect(after.passengerId).toBe(USER_ID);
        expect(after.guardianId).toBe('GRD-2026-00003');
        expect(after.accessibilityProfileId).toBe('ACC-2026-00005');
        expect(after.calculatedAge).toBe(27);
        expect(after.createdAt).toBe('2026-08-01T10:00:00.000Z');
        expect(after.passwordHash).toBe(
            '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789SECRETHASH'
        );
    });

    it('does not change isVerified when suspending an unverified user', async () => {
        const db = createFakeFirestore({
            users: [storedPassenger({ isVerified: false, accountStatus: 'ACTIVE' })],
        });
        mockGetAdminDb.mockReturnValue(db);

        await updateUserStatus(statusRequest({ accountStatus: 'SUSPENDED' }), patchContext());

        const after = await readStoredUser(db);
        expect(after.isVerified).toBe(false);
        expect(after.accountStatus).toBe('SUSPENDED');
    });
});

// ==================================================================
// ACTIVATE
// ==================================================================
describe('PATCH /api/users/:userId/status - activate', () => {
    it('activates a suspended user', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger({ accountStatus: 'SUSPENDED' })] })
        );

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'ACTIVE' }),
            patchContext()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.user.accountStatus).toBe('ACTIVE');
    });

    it('persists the activation and preserves other fields', async () => {
        const db = createFakeFirestore({
            users: [storedPassenger({ accountStatus: 'SUSPENDED', isVerified: true })],
        });
        mockGetAdminDb.mockReturnValue(db);

        await updateUserStatus(statusRequest({ accountStatus: 'ACTIVE' }), patchContext());

        const after = await readStoredUser(db);
        expect(after.accountStatus).toBe('ACTIVE');
        expect(after.isVerified).toBe(true);
        expect(after.role).toBe('PASSENGER');
        expect(after.guardianId).toBe('GRD-2026-00003');
        expect(after.accessibilityProfileId).toBe('ACC-2026-00005');
    });

    it('is idempotent when the user is already active', async () => {
        const db = createFakeFirestore({ users: [storedPassenger({ accountStatus: 'ACTIVE' })] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'ACTIVE' }),
            patchContext()
        );

        expect(response.status).toBe(200);
        expect((await readStoredUser(db)).accountStatus).toBe('ACTIVE');
    });
});

// ==================================================================
// LEGACY DOCUMENTS (no accountStatus stored)
// ==================================================================
describe('PATCH /api/users/:userId/status - documents without accountStatus', () => {
    it('suspends a legacy user that has no stored status', async () => {
        const legacy = storedPassenger();
        delete legacy.accountStatus;
        const db = createFakeFirestore({ users: [legacy] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'SUSPENDED' }),
            patchContext()
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.user.accountStatus).toBe('SUSPENDED');
        expect((await readStoredUser(db)).accountStatus).toBe('SUSPENDED');
    });

    it('reports a legacy user as ACTIVE through GET /api/users without writing to it', async () => {
        const legacy = storedPassenger();
        delete legacy.accountStatus;
        const db = createFakeFirestore({ users: [legacy] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await getUsers(new Request('http://localhost/api/users'));
        const json = await response.json();

        expect(json.users[0].accountStatus).toBe('ACTIVE');
        // Reading must never backfill the field onto the document.
        expect('accountStatus' in (await readStoredUser(db))).toBe(false);
    });
});

// ==================================================================
// VALIDATION
// ==================================================================
describe('PATCH /api/users/:userId/status - validation', () => {
    it('rejects a missing accountStatus', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(statusRequest({}), patchContext());
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/account status is required/i);
    });

    it('rejects an empty accountStatus', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            statusRequest({ accountStatus: '' }),
            patchContext()
        );

        expect(response.status).toBe(400);
    });

    it('rejects an unsupported status such as BLOCKED', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'BLOCKED' }),
            patchContext()
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/must be ACTIVE or SUSPENDED/i);
    });

    it('rejects a lowercase status', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'suspended' }),
            patchContext()
        );

        expect(response.status).toBe(400);
    });

    it('rejects a non-string status', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 123 }),
            patchContext()
        );

        expect(response.status).toBe(400);
    });

    it('does not write anything when validation fails', async () => {
        const db = createFakeFirestore({ users: [storedPassenger({ accountStatus: 'ACTIVE' })] });
        mockGetAdminDb.mockReturnValue(db);

        await updateUserStatus(statusRequest({ accountStatus: 'BLOCKED' }), patchContext());

        const after = await readStoredUser(db);
        expect(after.accountStatus).toBe('ACTIVE');
        expect(after.updatedAt).toBe('2026-08-01T10:00:00.000Z');
    });

    it('rejects a missing user identifier', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            new Request('http://localhost/api/users/status', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountStatus: 'SUSPENDED' }),
            })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/user id is required/i);
    });

    it('returns 404 for a user that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'SUSPENDED' }, 'PAS-2026-99999'),
            patchContext('PAS-2026-99999')
        );
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/user not found/i);
    });

    it('rejects a malformed JSON body with 400', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const malformed = new Request(`http://localhost/api/users/${USER_ID}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: '{"accountStatus":',
        });

        const response = await updateUserStatus(malformed, patchContext());
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/valid request body is required/i);
    });
});

// ==================================================================
// ERRORS
// ==================================================================
describe('PATCH /api/users/:userId/status - failures', () => {
    it('returns 500 when the Firestore update fails', async () => {
        mockGetAdminDb.mockReturnValue(failingUpdateFirestore());

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'SUSPENDED' }),
            patchContext()
        );
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/failed to update user account status/i);
    });
});

// ==================================================================
// SECURITY
// ==================================================================
describe('PATCH /api/users/:userId/status - response safety', () => {
    it('never returns passwordHash or any credential field', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                users: [
                    storedPassenger({
                        password: 'plaintext',
                        otp: '123456',
                        token: 'jwt-token',
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        secret: 'firebase-secret',
                    }),
                ],
            })
        );

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'SUSPENDED' }),
            patchContext()
        );
        const json = await response.json();

        for (const field of SENSITIVE_FIELDS) {
            expect(json.user[field]).toBeUndefined();
        }
        expect(JSON.stringify(json)).not.toContain('SECRETHASH');
    });

    it('returns only the intended acknowledgement fields', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [storedPassenger()] }));

        const response = await updateUserStatus(
            statusRequest({ accountStatus: 'SUSPENDED' }),
            patchContext()
        );
        const json = await response.json();

        expect(Object.keys(json.user).sort()).toEqual([
            'accountStatus',
            'documentId',
            'passengerId',
            'updatedAt',
        ]);
    });
});

// ==================================================================
// HELPERS
// ==================================================================
describe('account status helpers', () => {
    it('accepts only the supported statuses', () => {
        expect(isAccountStatus('ACTIVE')).toBe(true);
        expect(isAccountStatus('SUSPENDED')).toBe(true);
        expect(isAccountStatus('BLOCKED')).toBe(false);
        expect(isAccountStatus('active')).toBe(false);
        expect(isAccountStatus(undefined)).toBe(false);
        expect(isAccountStatus(null)).toBe(false);
        expect(isAccountStatus(1)).toBe(false);
    });

    it('defaults unknown or missing values to ACTIVE', () => {
        expect(resolveAccountStatus(undefined)).toBe('ACTIVE');
        expect(resolveAccountStatus(null)).toBe('ACTIVE');
        expect(resolveAccountStatus('BLOCKED')).toBe('ACTIVE');
        expect(resolveAccountStatus('SUSPENDED')).toBe('SUSPENDED');
        expect(resolveAccountStatus('ACTIVE')).toBe('ACTIVE');
    });
});