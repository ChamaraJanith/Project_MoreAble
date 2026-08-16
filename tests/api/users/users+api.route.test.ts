import {
    GET as getUsers,
    resolveRoleFilter,
    toAdminUserSummary,
} from '../../../app/api/users/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

// jest.mock is hoisted above imports by ts-jest, so the route module resolves
// getAdminDb to this mock before it runs. No real Firestore is ever touched.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function buildRequest(path = '/api/users'): Request {
    return new Request(`http://localhost${path}`, { method: 'GET' });
}

/**
 * A stored passenger document matching the structure written by
 * app/api/auth/register+api.ts - including the passwordHash that must never
 * be returned.
 */
function storedPassenger(overrides: Record<string, any> = {}) {
    const passengerId = overrides.passengerId ?? 'PAS-2026-00002';

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
        guardianId: null,
        accessibilityProfileId: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789SECRETHASH',
        ...overrides,
    };
}

/** A stored operator document matching scripts/seedAdmin.ts. */
function storedAdmin(overrides: Record<string, any> = {}) {
    return storedPassenger({
        id: 'ADM-2026-00001',
        passengerId: 'ADM-2026-00001',
        userName: 'System Admin',
        email: 'admin@moreable.lk',
        role: 'ADMIN',
        ...overrides,
    });
}

/** A Firestore double whose read rejects, for error-path coverage. */
function failingFirestore(message = 'Firestore unavailable') {
    return {
        collection: jest.fn(() => ({
            orderBy: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error(message)) })),
        })),
    };
}

/** Every field that must never appear in an API response. */
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
// RETRIEVAL
// ==================================================================
describe('GET /api/users - retrieve user data', () => {
    it('returns registered users successfully', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger()] })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toMatch(/retrieved successfully/i);
    });

    it('returns multiple users with a matching count', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                users: [
                    storedPassenger({ passengerId: 'PAS-2026-00002' }),
                    storedPassenger({ passengerId: 'PAS-2026-00004' }),
                    storedPassenger({ passengerId: 'PAS-2026-00005' }),
                ],
            })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(json.count).toBe(3);
        expect(json.users).toHaveLength(3);
        expect(json.count).toBe(json.users.length);
        expect(json.users.map((user: any) => user.passengerId)).toEqual(
            expect.arrayContaining(['PAS-2026-00002', 'PAS-2026-00004', 'PAS-2026-00005'])
        );
    });

    it('returns the expected user fields', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger()] })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();
        const [user] = json.users;

        expect(user).toEqual({
            documentId: 'PAS-2026-00002',
            passengerId: 'PAS-2026-00002',
            userName: 'Kavindu Perera',
            email: 'kavindu.p@example.com',
            phoneNumber: '+94771234567',
            secondaryPhoneNumber: null,
            nicNo: '199824501234',
            calculatedAge: 27,
            isElderPerson: false,
            isVerified: true,
            role: 'PASSENGER',
            guardianId: null,
            accessibilityProfileId: null,
            createdAt: '2026-08-01T10:00:00.000Z',
            updatedAt: '2026-08-01T10:00:00.000Z',
        });
    });

    it('includes the Firestore document id', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger()] })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(json.users[0].documentId).toBe('PAS-2026-00002');
    });

    it('handles an empty users collection', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [] }));

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        expect(json.users).toEqual([]);
    });

    it('returns 500 when Firestore fails', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/failed to retrieve users/i);
    });
});

// ==================================================================
// SECURITY
// ==================================================================
describe('GET /api/users - sensitive data exclusion', () => {
    it('never returns passwordHash', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger()] })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(json.users[0].passwordHash).toBeUndefined();
        // Belt and braces: the hash must not appear anywhere in the payload.
        expect(JSON.stringify(json)).not.toContain('SECRETHASH');
    });

    it('never returns any authentication or secret field', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                users: [
                    storedPassenger({
                        password: 'plaintext',
                        otp: '123456',
                        otpCode: '123456',
                        token: 'jwt-token',
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        secret: 'firebase-secret',
                    }),
                ],
            })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();
        const [user] = json.users;

        for (const field of SENSITIVE_FIELDS) {
            expect(user[field]).toBeUndefined();
        }
    });

    it('does not leak unexpected fields added to the schema later', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                users: [storedPassenger({ someFutureSecret: 'must-not-leak' })],
            })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();

        // The projection is an allow-list, so unknown fields are dropped.
        expect(json.users[0].someFutureSecret).toBeUndefined();
        expect(JSON.stringify(json)).not.toContain('must-not-leak');
    });

    it('does not modify the stored user documents', async () => {
        const stored = storedPassenger();
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ users: [stored] }));

        await getUsers(buildRequest());

        // A second read still sees the full document, hash intact - the
        // retrieval is purely read-only.
        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(json.count).toBe(1);
        expect(stored.passwordHash).toBe(
            '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789SECRETHASH'
        );
        expect(stored.email).toBe('kavindu.p@example.com');
    });
});

// ==================================================================
// ROLE SCOPING
// ==================================================================
describe('GET /api/users - role scoping', () => {
    it('returns only passenger accounts by default', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                users: [
                    storedPassenger({ passengerId: 'PAS-2026-00002' }),
                    storedAdmin(),
                    storedPassenger({ passengerId: 'PAS-2026-00007' }),
                ],
            })
        );

        const response = await getUsers(buildRequest());
        const json = await response.json();

        expect(json.count).toBe(2);
        expect(json.users.every((user: any) => user.role === 'PASSENGER')).toBe(true);
        expect(json.users.map((user: any) => user.passengerId)).not.toContain('ADM-2026-00001');
    });

    it('returns operator accounts only when explicitly requested', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger(), storedAdmin()] })
        );

        const response = await getUsers(buildRequest('/api/users?role=ADMIN'));
        const json = await response.json();

        expect(json.count).toBe(1);
        expect(json.users[0].role).toBe('ADMIN');
        expect(json.users[0].passengerId).toBe('ADM-2026-00001');
    });

    it('returns every role when role=ALL', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger(), storedAdmin()] })
        );

        const response = await getUsers(buildRequest('/api/users?role=ALL'));
        const json = await response.json();

        expect(json.count).toBe(2);
    });

    it('treats the role filter case-insensitively', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger(), storedAdmin()] })
        );

        const response = await getUsers(buildRequest('/api/users?role=admin'));
        const json = await response.json();

        expect(json.count).toBe(1);
        expect(json.users[0].role).toBe('ADMIN');
    });

    it('falls back to passengers for an unrecognised role', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ users: [storedPassenger(), storedAdmin()] })
        );

        const response = await getUsers(buildRequest('/api/users?role=SUPERVISOR'));
        const json = await response.json();

        expect(json.count).toBe(1);
        expect(json.users[0].role).toBe('PASSENGER');
    });
});

// ==================================================================
// PROJECTION HELPERS
// ==================================================================
describe('toAdminUserSummary', () => {
    it('drops every field outside the allow-list', () => {
        const summary = toAdminUserSummary('PAS-2026-00002', storedPassenger()) as any;

        expect(summary.passwordHash).toBeUndefined();
        expect(summary.uid).toBeUndefined();
        expect(summary.id).toBeUndefined();
    });

    it('falls back to the document id when passengerId is absent', () => {
        const summary = toAdminUserSummary('PAS-2026-00009', { userName: 'No Id' });

        expect(summary.passengerId).toBe('PAS-2026-00009');
    });

    it('normalises missing optional values to null', () => {
        const summary = toAdminUserSummary('PAS-2026-00010', {});

        expect(summary.phoneNumber).toBeNull();
        expect(summary.guardianId).toBeNull();
        expect(summary.accessibilityProfileId).toBeNull();
        expect(summary.calculatedAge).toBeNull();
        expect(summary.createdAt).toBeNull();
    });

    it('coerces flag fields to real booleans', () => {
        const summary = toAdminUserSummary('PAS-2026-00010', {});

        expect(summary.isElderPerson).toBe(false);
        expect(summary.isVerified).toBe(false);
    });

    it('preserves a supplied guardianId', () => {
        const summary = toAdminUserSummary(
            'PAS-2026-00008',
            storedPassenger({ guardianId: 'GRD-2026-00003' })
        );

        expect(summary.guardianId).toBe('GRD-2026-00003');
    });
});

describe('resolveRoleFilter', () => {
    it('defaults to PASSENGER when no role is supplied', () => {
        expect(resolveRoleFilter(null)).toBe('PASSENGER');
        expect(resolveRoleFilter('')).toBe('PASSENGER');
    });

    it('accepts each known role', () => {
        expect(resolveRoleFilter('PASSENGER')).toBe('PASSENGER');
        expect(resolveRoleFilter('GUARDIAN')).toBe('GUARDIAN');
        expect(resolveRoleFilter('ADMIN')).toBe('ADMIN');
    });

    it('accepts ALL', () => {
        expect(resolveRoleFilter('ALL')).toBe('ALL');
    });

    it('ignores case and padding', () => {
        expect(resolveRoleFilter('  admin  ')).toBe('ADMIN');
    });

    it('falls back to PASSENGER for anything unrecognised', () => {
        expect(resolveRoleFilter('SUPERVISOR')).toBe('PASSENGER');
    });
});