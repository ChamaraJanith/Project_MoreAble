import {
    DELETE as deleteMedicalProfile,
    GET as getMedicalProfile,
    OPTIONS as optionsMedicalProfile,
    POST as saveMedicalProfile,
} from '../../../app/api/medical-profile/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { verifyToken } from '../../../src/shared/config/jwt';

const mockGetAdminDb = jest.fn();

// Mock firebaseAdmin to prevent real Firestore connection
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: jest.fn(),
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
        hasMedicalInformation: false,
        ...overrides,
    };
}

function storedMedicalProfile(overrides: Record<string, any> = {}) {
    const profileId = overrides.medicalProfileId ?? 'MED-2026-00012';

    return {
        id: profileId,
        medicalProfileId: profileId,
        userId: 'user-uid-12345',
        passengerId: 'PAS-2026-00012',
        bloodType: 'O+',
        allergies: 'Peanuts',
        currentMedications: null,
        chronicConditions: null,
        emergencyNotes: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        ...overrides,
    };
}

describe('Medical Profile API', () => {
    let fakeDb: any;

    beforeEach(() => {
        jest.clearAllMocks();
        fakeDb = createFakeFirestore();
        mockGetAdminDb.mockReturnValue(fakeDb);
    });

    describe('Security & Authorization', () => {
        it('OPTIONS handles preflight requests', async () => {
            const req = buildRequest('/api/medical-profile');
            const res = await optionsMedicalProfile();
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET, POST, DELETE, OPTIONS');
        });

        it('GET returns 401 when no token is provided', async () => {
            const req = buildRequest('/api/medical-profile?passengerId=PAS-123');
            const res = await getMedicalProfile(req);
            const json = await res.json();
            
            expect(res.status).toBe(401);
            expect(json.success).toBe(false);
            expect(json.message).toBe('Unauthorized');
        });

        it('POST returns 401 when no token is provided', async () => {
            const req = buildRequest('/api/medical-profile', { method: 'POST', body: JSON.stringify({}) });
            const res = await saveMedicalProfile(req);
            expect(res.status).toBe(401);
        });

        it('DELETE returns 401 when no token is provided', async () => {
            const req = buildRequest('/api/medical-profile?passengerId=PAS-123', { method: 'DELETE' });
            const res = await deleteMedicalProfile(req);
            expect(res.status).toBe(401);
        });

        it('Returns 403 Forbidden if user tries to access another users profile (GET)', async () => {
            (verifyToken as jest.Mock).mockResolvedValue({ uid: 'intruder-uid' });
            
            fakeDb = createFakeFirestore({
                'medical_profiles': [storedMedicalProfile()]
            });
            mockGetAdminDb.mockReturnValue(fakeDb);

            const req = buildRequest('/api/medical-profile?profileId=MED-2026-00012', {
                headers: { 'Authorization': 'Bearer test-token' }
            });
            const res = await getMedicalProfile(req);
            const json = await res.json();
            
            expect(res.status).toBe(403);
            expect(json.message).toBe('Forbidden');
        });
        
        it('Returns 403 Forbidden if user tries to update another users profile (POST)', async () => {
            (verifyToken as jest.Mock).mockResolvedValue({ uid: 'intruder-uid' });
            
            const req = buildRequest('/api/medical-profile', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer test-token' },
                body: JSON.stringify({ passengerId: 'PAS-123', userId: 'user-uid-12345' })
            });
            const res = await saveMedicalProfile(req);
            
            expect(res.status).toBe(403);
        });
    });

    describe('GET /api/medical-profile', () => {
        beforeEach(() => {
            (verifyToken as jest.Mock).mockResolvedValue({ uid: 'user-uid-12345' });
        });

        it('fetches medical profile successfully by profileId', async () => {
            fakeDb = createFakeFirestore({
                'medical_profiles': [storedMedicalProfile()]
            });
            mockGetAdminDb.mockReturnValue(fakeDb);

            const req = buildRequest('/api/medical-profile?profileId=MED-2026-00012', {
                headers: { 'Authorization': 'Bearer valid-token' }
            });
            const res = await getMedicalProfile(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.profile.bloodType).toBe('O+');
        });

        it('fetches medical profile successfully by passengerId', async () => {
            fakeDb = createFakeFirestore({
                'medical_profiles': [storedMedicalProfile()]
            });
            mockGetAdminDb.mockReturnValue(fakeDb);

            const req = buildRequest('/api/medical-profile?passengerId=PAS-2026-00012', {
                headers: { 'Authorization': 'Bearer valid-token' }
            });
            const res = await getMedicalProfile(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.profile.medicalProfileId).toBe('MED-2026-00012');
        });

        it('returns 404 if profile does not exist', async () => {
            const req = buildRequest('/api/medical-profile?profileId=MED-NON-EXISTENT', {
                headers: { 'Authorization': 'Bearer valid-token' }
            });
            const res = await getMedicalProfile(req);
            const json = await res.json();

            expect(res.status).toBe(404);
            expect(json.success).toBe(false);
        });
    });

    describe('POST /api/medical-profile', () => {
        beforeEach(() => {
            (verifyToken as jest.Mock).mockResolvedValue({ uid: 'user-uid-12345' });
            fakeDb = createFakeFirestore({
                'users': [storedUser()]
            });
            mockGetAdminDb.mockReturnValue(fakeDb);
        });

        it('creates a new medical profile and updates user flags', async () => {
            const payload = {
                passengerId: 'PAS-2026-00012',
                userId: 'user-uid-12345',
                bloodType: 'A-',
                allergies: 'None'
            };

            const req = buildRequest('/api/medical-profile', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer valid-token' },
                body: JSON.stringify(payload),
            });

            const res = await saveMedicalProfile(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.profileId).toContain('MED-');
            
            // Check that it was saved in firestore mock
            const docsRef = await fakeDb.collection('medical_profiles').get();
            expect(docsRef.docs.length).toBe(1);
            expect(docsRef.docs[0].data().bloodType).toBe('A-');
            
            // Check that user document was updated
            const userDoc = await fakeDb.collection('users').doc('PAS-2026-00012').get();
            expect(userDoc.data().hasMedicalInformation).toBe(true);
        });
        
        it('updates an existing medical profile', async () => {
            fakeDb = createFakeFirestore({
                'users': [storedUser()],
                'medical_profiles': [storedMedicalProfile({ bloodType: 'O+' })]
            });
            mockGetAdminDb.mockReturnValue(fakeDb);
            
            const payload = {
                medicalProfileId: 'MED-2026-00012',
                passengerId: 'PAS-2026-00012',
                userId: 'user-uid-12345',
                bloodType: 'AB+' // Changing blood type
            };

            const req = buildRequest('/api/medical-profile', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer valid-token' },
                body: JSON.stringify(payload),
            });

            const res = await saveMedicalProfile(req);
            expect(res.status).toBe(200);
            
            const doc = await fakeDb.collection('medical_profiles').doc('MED-2026-00012').get();
            expect(doc.data().bloodType).toBe('AB+');
        });
    });

    describe('DELETE /api/medical-profile', () => {
        beforeEach(() => {
            (verifyToken as jest.Mock).mockResolvedValue({ uid: 'user-uid-12345' });
            fakeDb = createFakeFirestore({
                'users': [storedUser({ hasMedicalInformation: true })],
                'medical_profiles': [storedMedicalProfile()]
            });
            mockGetAdminDb.mockReturnValue(fakeDb);
        });

        it('deletes medical profile and resets user flag', async () => {
            const req = buildRequest('/api/medical-profile?passengerId=PAS-2026-00012', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer valid-token' }
            });

            const res = await deleteMedicalProfile(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            
            // Profile should be deleted
            const doc = await fakeDb.collection('medical_profiles').doc('MED-2026-00012').get();
            expect(doc.exists).toBe(false);
            
            // User flag should be false
            const userDoc = await fakeDb.collection('users').doc('PAS-2026-00012').get();
            expect(userDoc.data().hasMedicalInformation).toBe(false);
        });
        
        it('Returns 403 Forbidden if user tries to delete another users profile', async () => {
            (verifyToken as jest.Mock).mockResolvedValue({ uid: 'intruder-uid' });
            
            const req = buildRequest('/api/medical-profile?passengerId=PAS-2026-00012', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer valid-token' }
            });

            const res = await deleteMedicalProfile(req);
            expect(res.status).toBe(403);
            
            // Should still exist
            const doc = await fakeDb.collection('medical_profiles').doc('MED-2026-00012').get();
            expect(doc.exists).toBe(true);
        });
    });
});
