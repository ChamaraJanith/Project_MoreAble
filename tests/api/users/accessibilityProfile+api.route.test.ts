import {
    DELETE as deleteAccessibilityProfile,
    GET as getAccessibilityProfile,
    OPTIONS as optionsAccessibilityProfile,
    POST as saveAccessibilityProfile,
} from '../../../app/api/accessibility-profile/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

// Mock firebaseAdmin to prevent real Firestore connection
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

function buildRequest(path: string, options: RequestInit = {}): Request {
    return new Request(`http://localhost${path}`, options);
}

function storedUser(overrides: Record<string, any> = {}) {
    const passengerId = overrides.passengerId ?? 'PAS-2026-00012';

    return {
        id: passengerId,
        uid: 'user-uid-12345',
        passengerId,
        userName: 'Sunil Perera',
        email: 'sunil.p@example.com',
        accessibilityProfileId: 'ACC-2026-00012',
        hasAccessibilityNeeds: true,
        isWheelchairUser: true,
        isLowVisionPerson: false,
        isHearingImpaired: false,
        ...overrides,
    };
}

function storedAccessibilityProfile(overrides: Record<string, any> = {}) {
    const profileId = overrides.accessibilityProfileId ?? 'ACC-2026-00012';

    return {
        id: profileId,
        accessibilityProfileId: profileId,
        userId: 'user-uid-12345',
        passengerId: 'PAS-2026-00012',
        hasAccessibilityNeeds: true,
        accessibilityNeeds: ['wheelchair', 'low_vision'],
        otherDescription: null,
        requestedServices: {
            wheelchairRamp: true,
            wheelchairSpace: true,
            prioritySeats: true,
            clearAnnouncements: true,
            vibratedDevices: false,
            visualAnnouncements: true,
        },
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        ...overrides,
    };
}

function failingFirestore(message = 'Firestore unavailable') {
    return {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn().mockRejectedValue(new Error(message)),
                set: jest.fn().mockRejectedValue(new Error(message)),
                delete: jest.fn().mockRejectedValue(new Error(message)),
            })),
        })),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// OPTIONS (CORS)
// ==================================================================
describe('OPTIONS /api/accessibility-profile', () => {
    it('returns status 204 with CORS headers', async () => {
        const response = await optionsAccessibilityProfile();
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
});

// ==================================================================
// GET - RETRIEVAL & AUTHORIZATION VALIDATION
// ==================================================================
describe('GET /api/accessibility-profile', () => {
    it('returns 400 bad request if neither profileId nor passengerId is provided', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const request = buildRequest('/api/accessibility-profile');
        const response = await getAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toContain('Accessibility Profile ID or Passenger ID is required');
    });

    it('returns 404 if accessibility profile record is not found', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const request = buildRequest('/api/accessibility-profile?profileId=ACC-9999-99999');
        const response = await getAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
        expect(json.message).toContain('Accessibility Profile record not found');
    });

    it('successfully retrieves accessibility profile by profileId directly', async () => {
        const profile = storedAccessibilityProfile();
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ accessibility_needs_persons: [profile] })
        );

        const request = buildRequest('/api/accessibility-profile?profileId=ACC-2026-00012');
        const response = await getAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.profile).toBeDefined();
        expect(json.profile.accessibilityProfileId).toBe('ACC-2026-00012');
        expect(json.profile.accessibilityNeeds).toEqual(['wheelchair', 'low_vision']);
    });

    it('successfully resolves profileId via passengerId lookup and returns accessibility profile', async () => {
        const userDoc = storedUser({ passengerId: 'PAS-2026-00012', accessibilityProfileId: 'ACC-2026-00012' });
        const profileDoc = storedAccessibilityProfile({ accessibilityProfileId: 'ACC-2026-00012' });

        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                users: [userDoc],
                accessibility_needs_persons: [profileDoc],
            })
        );

        const request = buildRequest('/api/accessibility-profile?passengerId=PAS-2026-00012');
        const response = await getAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.profile.accessibilityProfileId).toBe('ACC-2026-00012');
        expect(json.profile.passengerId).toBe('PAS-2026-00012');
    });

    it('returns 500 when Firestore database query fails', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const request = buildRequest('/api/accessibility-profile?profileId=ACC-2026-00012');
        const response = await getAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toBe('Internal Server Error');
    });
});

// ==================================================================
// POST - CREATING, EDITING & SAVING PROFILE
// ==================================================================
describe('POST /api/accessibility-profile - save/edit accessibility profile', () => {
    it('creates a new accessibility profile record and updates passenger flags when profileId is absent', async () => {
        const userDoc = storedUser({ passengerId: 'PAS-2026-00099', accessibilityProfileId: null });
        const fakeDb = createFakeFirestore({ users: [userDoc] });
        mockGetAdminDb.mockReturnValue(fakeDb);

        const payload = {
            passengerId: 'PAS-2026-00099',
            userId: 'user-uid-99',
            accessibilityNeeds: ['wheelchair', 'hearing_impairment'],
            requestedServices: {
                wheelchairRamp: true,
                visualAnnouncements: true,
            },
        };

        const request = buildRequest('/api/accessibility-profile', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        const response = await saveAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toBe('Accessibility profile saved successfully!');
        expect(json.profileId).toMatch(/^ACC-\d{4}-\d{5}$/);
        expect(json.profile.accessibilityNeeds).toEqual(['wheelchair', 'hearing_impairment']);
        expect(json.profile.hasAccessibilityNeeds).toBe(true);
    });

    it('edits an existing accessibility profile and updates user flags and requested services in Firestore', async () => {
        const profileDoc = storedAccessibilityProfile({
            accessibilityProfileId: 'ACC-2026-00012',
            accessibilityNeeds: ['wheelchair'],
        });
        const userDoc = storedUser({
            passengerId: 'PAS-2026-00012',
            accessibilityProfileId: 'ACC-2026-00012',
            isWheelchairUser: true,
            isLowVisionPerson: false,
        });

        const fakeDb = createFakeFirestore({
            users: [userDoc],
            accessibility_needs_persons: [profileDoc],
        });
        mockGetAdminDb.mockReturnValue(fakeDb);

        const updatedPayload = {
            passengerId: 'PAS-2026-00012',
            userId: 'user-uid-12345',
            accessibilityProfileId: 'ACC-2026-00012',
            accessibilityNeeds: ['low_vision', 'walking_difficulty', 'other'],
            otherDescription: 'Requires assistance with stairs',
            requestedServices: {
                prioritySeats: true,
                vibratedDevices: true,
            },
        };

        const request = buildRequest('/api/accessibility-profile', {
            method: 'POST',
            body: JSON.stringify(updatedPayload),
        });

        const response = await saveAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.profile.accessibilityProfileId).toBe('ACC-2026-00012');
        expect(json.profile.accessibilityNeeds).toEqual(['low_vision', 'walking_difficulty', 'other']);
        expect(json.profile.otherDescription).toBe('Requires assistance with stairs');

        // Check updated user document sync in fakeDb
        const updatedUserDoc = await fakeDb.collection('users').doc('PAS-2026-00012').get();
        const updatedUser = updatedUserDoc.data()!;
        expect(updatedUser.isLowVisionPerson).toBe(true);
        expect(updatedUser.isWalkingDifficultyPerson).toBe(true);
        expect(updatedUser.isOtherAccessibilityPerson).toBe(true);
        expect(updatedUser.isWheelchairUser).toBe(false);
        expect(updatedUser.otherDescription).toBe('Requires assistance with stairs');
    });

    it('returns 500 when saving profile fails in database', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const request = buildRequest('/api/accessibility-profile', {
            method: 'POST',
            body: JSON.stringify({ passengerId: 'PAS-1' }),
        });

        const response = await saveAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toBe('Failed to save accessibility profile');
    });
});

// ==================================================================
// DELETE - REMOVING ACCESSIBILITY PROFILE
// ==================================================================
describe('DELETE /api/accessibility-profile - remove profile', () => {
    it('deletes accessibility profile document and resets passenger indicator flags', async () => {
        const profileDoc = storedAccessibilityProfile({ accessibilityProfileId: 'ACC-2026-00012' });
        const userDoc = storedUser({
            passengerId: 'PAS-2026-00012',
            accessibilityProfileId: 'ACC-2026-00012',
            hasAccessibilityNeeds: true,
            isWheelchairUser: true,
        });

        const fakeDb = createFakeFirestore({
            users: [userDoc],
            accessibility_needs_persons: [profileDoc],
        });
        mockGetAdminDb.mockReturnValue(fakeDb);

        const request = buildRequest(
            '/api/accessibility-profile?profileId=ACC-2026-00012&passengerId=PAS-2026-00012',
            { method: 'DELETE' }
        );

        const response = await deleteAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toBe('Accessibility profile removed successfully');

        // Verify sync to user record
        const updatedUserDoc = await fakeDb.collection('users').doc('PAS-2026-00012').get();
        const updatedUser = updatedUserDoc.data()!;
        expect(updatedUser.accessibilityProfileId).toBeNull();
        expect(updatedUser.hasAccessibilityNeeds).toBe(false);
        expect(updatedUser.isWheelchairUser).toBe(false);
    });

    it('returns 500 when deleting profile fails in database', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const request = buildRequest('/api/accessibility-profile?profileId=ACC-2026-00012', {
            method: 'DELETE',
        });

        const response = await deleteAccessibilityProfile(request);
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toBe('Failed to delete accessibility profile');
    });
});
