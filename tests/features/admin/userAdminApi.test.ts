// The user data layer, and the one thing about it MOV-134 depends on.
//
// `GET /api/users` answers with PASSENGER accounts unless it is told otherwise,
// and two screens read it for opposite reasons:
//
//   "Manage Users" administers passenger accounts, and calls getUsers() with no
//   role so the backend default applies;
//
//   the Admin Dashboard Overview states Total Users, a statistic about the
//   platform, and calls getUsers('ALL') so guardian and operator records are
//   included too.
//
// The difference is one query parameter, and getting it wrong is silent: both
// screens still work, the Overview number is just quietly about a smaller set
// of people than it claims. So what is asserted here is the request itself —
// that the default is still bare, and that 'ALL' really does travel.
//
// Rendering is not covered, for the reason busAdminApi.test.ts already gives:
// this project's Jest is `testEnvironment: node` with no React Native renderer.

import { AdminUserSummary } from '../../../src/entities/user/model/types';
import { getUserById, getUsers } from '../../../src/features/admin/api/userAdminApi';

// Hoisted above the imports by ts-jest, so the module graph never pulls in
// react-native / expo-constants, which cannot load under the node environment.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, ok = true) {
    return { ok, json: async () => body };
}

function storedUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
    return {
        documentId: 'PAS-2026-00001',
        passengerId: 'PAS-2026-00001',
        userName: 'Kavindu Perera',
        email: 'kavindu.p@example.com',
        phoneNumber: '+94771234567',
        secondaryPhoneNumber: null,
        nicNo: '199824501234',
        calculatedAge: 27,
        isElderPerson: false,
        isVerified: true,
        accountStatus: 'ACTIVE',
        role: 'PASSENGER',
        guardianId: null,
        accessibilityProfileId: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        ...overrides,
    };
}

/** The path the client asked for on its most recent call. */
function requestedPath(): string {
    return mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
}

function respondWith(users: AdminUserSummary[]) {
    mockFetch.mockResolvedValue(
        jsonResponse({ success: true, message: 'ok', count: users.length, users })
    );
}

beforeEach(() => {
    mockFetch.mockReset();
});

// ==================================================================
// Which slice of the collection is asked for
// ==================================================================
describe('the role the request asks for', () => {
    it('sends no role parameter when none was given', async () => {
        respondWith([]);

        await getUsers();

        // The backend default — PASSENGER — is what "Manage Users" administers,
        // and it has to keep applying. Sending a role here would change what
        // UserListScreen lists without anything on that screen having changed.
        expect(requestedPath()).toBe('/api/users');
    });

    it('sends ?role=ALL when every account is wanted', async () => {
        respondWith([]);

        await getUsers('ALL');

        // What the Admin Dashboard asks for so that Total Users counts everyone
        // registered rather than the passengers alone (MOV-134).
        expect(requestedPath()).toBe('/api/users?role=ALL');
    });

    it('sends a single role when one is named', async () => {
        respondWith([]);

        await getUsers('ADMIN');

        expect(requestedPath()).toBe('/api/users?role=ADMIN');
    });

    it('returns every role the ALL request answered with', async () => {
        respondWith([
            storedUser({ documentId: 'PAS-1', role: 'PASSENGER' }),
            storedUser({ documentId: 'GUA-1', role: 'GUARDIAN' }),
            storedUser({ documentId: 'ADM-1', role: 'ADMIN' }),
        ]);

        // Nothing is filtered on the way back: the role asked for IS the
        // filter, and the statistic counts what arrived.
        expect(await getUsers('ALL')).toHaveLength(3);
    });
});

// ==================================================================
// What comes back
// ==================================================================
describe('the response', () => {
    it('reads an absent users array as no users rather than failing', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, message: 'ok' }));

        expect(await getUsers('ALL')).toEqual([]);
    });

    it('throws with the backend message when the request was refused', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: false, message: 'Failed to retrieve users.' }, false)
        );

        // The dashboard turns this into its Overview error banner, which is how
        // a failed read becomes a dash rather than a stale number.
        await expect(getUsers('ALL')).rejects.toThrow('Failed to retrieve users.');
    });

    it('resolves one user out of the full list', async () => {
        respondWith([
            storedUser({ documentId: 'PAS-1' }),
            storedUser({ documentId: 'ADM-1', role: 'ADMIN' }),
        ]);

        const found = await getUserById('ADM-1');

        // The lookup reads across every role, which is why it asks for ALL.
        expect(requestedPath()).toBe('/api/users?role=ALL');
        expect(found?.documentId).toBe('ADM-1');
    });

    it('returns null for a user that is no longer present', async () => {
        respondWith([]);

        expect(await getUserById('PAS-GONE')).toBeNull();
    });
});
