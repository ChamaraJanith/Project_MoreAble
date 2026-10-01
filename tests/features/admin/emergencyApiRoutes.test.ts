import { GET as getEmergenciesRoute, POST as postEmergencyRoute, OPTIONS as optionsEmergenciesRoute } from '../../../app/api/emergencies/index+api';
import { GET as getEmergencyDetailRoute, PATCH as patchEmergencyRoute, OPTIONS as optionsEmergencyDetailRoute } from '../../../app/api/emergencies/[emergencyId]+api';
import * as EmergencyServer from '../../../src/shared/server/emergencies';
import { authenticateRequest } from '../../../src/shared/api/authMiddleware';

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: jest.fn(() => ({})),
}));

jest.mock('../../../src/shared/api/authMiddleware', () => ({
    authenticateRequest: jest.fn(async () => ({ email: 'admin@moreable.lk', role: 'ADMIN' })),
}));

describe('MOV-236: Backend API Route Handlers (/api/emergencies)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('1. OPTIONS Preflight Handlers', () => {
        it('returns 204 with CORS headers for /api/emergencies OPTIONS', async () => {
            const res = await optionsEmergenciesRoute();
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
            expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
        });

        it('returns 204 with CORS headers for /api/emergencies/[emergencyId] OPTIONS', async () => {
            const res = await optionsEmergencyDetailRoute();
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
        });
    });

    describe('2. GET /api/emergencies Endpoint', () => {
        it('returns list of emergencies with 200 status code', async () => {
            const mockList: any[] = [
                { id: 'EMG-101', status: 'PENDING', passenger: { name: 'A' } },
                { id: 'EMG-102', status: 'ASSIGNED', passenger: { name: 'B' } },
            ];
            jest.spyOn(EmergencyServer, 'listEmergencies').mockResolvedValueOnce(mockList);

            const req = new Request('http://localhost:8081/api/emergencies?status=ALL');
            const res = await getEmergenciesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.count).toBe(2);
            expect(json.emergencies).toHaveLength(2);
            expect(json.emergencies[0].id).toBe('EMG-101');
            expect(json.emergencies[1].id).toBe('EMG-102');
        });

        it('passes status and search query parameters to listEmergencies', async () => {
            const listSpy = jest.spyOn(EmergencyServer, 'listEmergencies').mockResolvedValueOnce([]);

            const req = new Request('http://localhost:8081/api/emergencies?status=PENDING&search=Kamal');
            const res = await getEmergenciesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(listSpy).toHaveBeenCalledWith(expect.anything(), {
                status: 'PENDING',
                search: 'Kamal',
            });
        });

        it('maps status=ALL query parameter to undefined status filter', async () => {
            const listSpy = jest.spyOn(EmergencyServer, 'listEmergencies').mockResolvedValueOnce([]);

            const req = new Request('http://localhost:8081/api/emergencies?status=ALL');
            await getEmergenciesRoute(req);

            expect(listSpy).toHaveBeenCalledWith(expect.anything(), {
                status: undefined,
                search: undefined,
            });
        });

        it('handles URL without query parameters gracefully', async () => {
            const listSpy = jest.spyOn(EmergencyServer, 'listEmergencies').mockResolvedValueOnce([]);

            const req = new Request('http://localhost:8081/api/emergencies');
            const res = await getEmergenciesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(listSpy).toHaveBeenCalledWith(expect.anything(), {
                status: undefined,
                search: undefined,
            });
        });

        it('returns empty list and count 0 when no records match filter', async () => {
            jest.spyOn(EmergencyServer, 'listEmergencies').mockResolvedValueOnce([]);

            const req = new Request('http://localhost:8081/api/emergencies?status=RESOLVED');
            const res = await getEmergenciesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.count).toBe(0);
            expect(json.emergencies).toEqual([]);
        });

        it('returns 500 when listEmergencies throws an internal error', async () => {
            jest.spyOn(EmergencyServer, 'listEmergencies').mockRejectedValueOnce(
                new Error('Firestore read failed')
            );

            const req = new Request('http://localhost:8081/api/emergencies');
            const res = await getEmergenciesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(500);
            expect(json.success).toBe(false);
            expect(json.message).toContain('Firestore read failed');
        });
    });

    describe('3. POST /api/emergencies Endpoint', () => {
        // POST is a passenger's SOS: it needs a verified PASSENGER session
        // (the file's default mock is an ADMIN). Route-level identity, journey
        // and recipient rules are driven against a real database in
        // tests/api/emergencies/createEmergencySos+api.route.test.ts.
        const PASSENGER_SESSION = {
            uid: 'uid-PAS-2026-00010',
            passengerId: 'PAS-2026-00010',
            role: 'PASSENGER',
            email: 'passenger10@moreable.lk',
        };

        beforeEach(() => {
            (authenticateRequest as jest.Mock).mockResolvedValue(PASSENGER_SESSION);
        });

        afterAll(() => {
            (authenticateRequest as jest.Mock).mockImplementation(async () => ({ email: 'admin@moreable.lk', role: 'ADMIN' }));
        });

        it('creates a new emergency and returns 201 with created record', async () => {
            const mockCreated: any = {
                id: 'EMG-999',
                status: 'PENDING',
                passenger: { name: 'Nimal', phone: '0771234567' },
                location: { latitude: 6.9, longitude: 79.8 },
                statusHistory: [{ status: 'PENDING' }],
            };
            const createSpy = jest.spyOn(EmergencyServer, 'createEmergency').mockResolvedValueOnce(mockCreated);

            const body = {
                passenger: { name: 'Nimal', phone: '0771234567' },
                location: { latitude: 6.9, longitude: 79.8 },
            };

            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
            });

            const res = await postEmergencyRoute(req);
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json.success).toBe(true);
            expect(json.emergency.id).toBe('EMG-999');
            expect(createSpy).toHaveBeenCalledTimes(1);
        });

        it('records the creator as the passenger session, not the body', async () => {
            const mockCreated: any = { id: 'EMG-001', status: 'PENDING', passenger: { name: 'Sunil' } };
            const createSpy = jest.spyOn(EmergencyServer, 'createEmergency').mockResolvedValueOnce(mockCreated);

            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: JSON.stringify({
                    passenger: { name: 'Sunil', phone: '0771122334' },
                    location: { latitude: 6.9, longitude: 79.8 },
                }),
            });

            await postEmergencyRoute(req);

            expect(createSpy).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    passenger: expect.objectContaining({ id: 'PAS-2026-00010' }),
                }),
                'passenger10@moreable.lk'
            );
            expect(createSpy.mock.calls[0][1].passenger).not.toMatchObject({ name: 'Sunil' });
        });

        it('refuses with 401 when the request carries no verified session', async () => {
            (authenticateRequest as jest.Mock).mockRejectedValueOnce(new Error('No token'));
            const createSpy = jest.spyOn(EmergencyServer, 'createEmergency');

            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: JSON.stringify({
                    passenger: { name: 'Kamal', phone: '0711122334' },
                    location: { latitude: 6.9, longitude: 79.8 },
                }),
            });

            const res = await postEmergencyRoute(req);

            expect(res.status).toBe(401);
            expect((await res.json()).success).toBe(false);
            expect(createSpy).not.toHaveBeenCalled();
        });

        it('refuses with 403 when the session is not a passenger', async () => {
            (authenticateRequest as jest.Mock).mockResolvedValueOnce({
                email: 'operator1@transit.gov.lk',
                role: 'ADMIN',
            });
            const createSpy = jest.spyOn(EmergencyServer, 'createEmergency');

            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: JSON.stringify({
                    passenger: { name: 'Sunil', phone: '0771122334' },
                    location: { latitude: 6.9, longitude: 79.8 },
                }),
            });

            const res = await postEmergencyRoute(req);

            expect(res.status).toBe(403);
            expect(createSpy).not.toHaveBeenCalled();
        });

        it('returns 400 when request body cannot be parsed or is empty', async () => {
            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: 'INVALID-JSON-PAYLOAD',
            });

            const res = await postEmergencyRoute(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toContain('Request body is required');
        });

        it('returns 400 with validation message when EmergencyConflictError is thrown', async () => {
            jest.spyOn(EmergencyServer, 'createEmergency').mockRejectedValueOnce(
                new EmergencyServer.EmergencyConflictError('Passenger name and phone are required for emergency alerts.', 400)
            );

            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: JSON.stringify({ passenger: {}, location: {} }),
            });

            const res = await postEmergencyRoute(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toBe('Passenger name and phone are required for emergency alerts.');
        });

        it('returns 500 when unexpected server error occurs during creation', async () => {
            jest.spyOn(EmergencyServer, 'createEmergency').mockRejectedValueOnce(
                new Error('Database transaction timeout')
            );

            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: JSON.stringify({
                    passenger: { name: 'Nimal', phone: '0771234567' },
                    location: { latitude: 6.9, longitude: 79.8 },
                }),
            });

            const res = await postEmergencyRoute(req);
            const json = await res.json();

            expect(res.status).toBe(500);
            expect(json.success).toBe(false);
            expect(json.message).toContain('Database transaction timeout');
        });
    });

    describe('4. GET /api/emergencies/[emergencyId] Endpoint', () => {
        it('returns emergency details with 200 status when record is found', async () => {
            const mockRecord: any = {
                id: 'EMG-888',
                status: 'ASSIGNED',
                passenger: { name: 'Geetha', phone: '0711112222' },
                vehicle: { plateNumber: 'WP-ND-1234' },
                location: { latitude: 6.9271, longitude: 79.8612 },
            };
            jest.spyOn(EmergencyServer, 'getEmergencyDetail').mockResolvedValueOnce(mockRecord);

            const req = new Request('http://localhost:8081/api/emergencies/EMG-888');
            const res = await getEmergencyDetailRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.emergency.id).toBe('EMG-888');
            expect(json.emergency.passenger.name).toBe('Geetha');
        });

        it('returns 404 when emergency record is not found', async () => {
            jest.spyOn(EmergencyServer, 'getEmergencyDetail').mockResolvedValueOnce(null);

            const req = new Request('http://localhost:8081/api/emergencies/EMG-NOT-FOUND');
            const res = await getEmergencyDetailRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-NOT-FOUND' }) });
            const json = await res.json();

            expect(res.status).toBe(404);
            expect(json.success).toBe(false);
            expect(json.message).toContain('not found');
        });

        it('returns 400 when emergencyId parameter is missing or empty', async () => {
            const req = new Request('http://localhost:8081/api/emergencies/');
            const res = await getEmergencyDetailRoute(req, { params: Promise.resolve({ emergencyId: '  ' }) });
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toBe('Emergency ID is required.');
        });

        it('returns 500 when getEmergencyDetail throws an unhandled error', async () => {
            jest.spyOn(EmergencyServer, 'getEmergencyDetail').mockRejectedValueOnce(
                new Error('Firestore doc fetch failure')
            );

            const req = new Request('http://localhost:8081/api/emergencies/EMG-ERR');
            const res = await getEmergencyDetailRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-ERR' }) });
            const json = await res.json();

            expect(res.status).toBe(500);
            expect(json.success).toBe(false);
            expect(json.message).toContain('Firestore doc fetch failure');
        });
    });

    describe('5. PATCH /api/emergencies/[emergencyId] Endpoint', () => {
        it('updates status to ASSIGNED and returns 200 with updated record', async () => {
            const mockUpdated: any = {
                id: 'EMG-888',
                status: 'ASSIGNED',
                assignment: { responderName: 'Driver Kamal', etaMinutes: 5 },
            };
            const updateSpy = jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockResolvedValueOnce(mockUpdated);

            const payload = {
                status: 'ASSIGNED',
                responderName: 'Driver Kamal',
                responderContact: '0771234567',
                etaMinutes: 5,
            };

            const req = new Request('http://localhost:8081/api/emergencies/EMG-888', {
                method: 'PATCH',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.emergency.status).toBe('ASSIGNED');
            expect(updateSpy).toHaveBeenCalledWith(
                expect.anything(),
                'EMG-888',
                payload,
                'admin@moreable.lk'
            );
        });

        it('updates status to RESOLVED and returns 200 with updated record', async () => {
            const mockResolved: any = {
                id: 'EMG-888',
                status: 'RESOLVED',
                resolution: { actionTaken: 'First aid rendered successfully.' },
            };
            jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockResolvedValueOnce(mockResolved);

            const payload = {
                status: 'RESOLVED',
                actionTaken: 'First aid rendered successfully.',
            };

            const req = new Request('http://localhost:8081/api/emergencies/EMG-888', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.emergency.status).toBe('RESOLVED');
        });

        it('returns 400 when PATCH request body is missing or unparseable', async () => {
            const req = new Request('http://localhost:8081/api/emergencies/EMG-888', {
                method: 'PATCH',
                body: 'INVALID-JSON',
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toContain("New status ('PENDING', 'ASSIGNED', or 'RESOLVED') is required.");
        });

        it('returns 400 when status property is missing in PATCH body', async () => {
            const req = new Request('http://localhost:8081/api/emergencies/EMG-888', {
                method: 'PATCH',
                body: JSON.stringify({ responderName: 'Officer' }),
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toContain("New status ('PENDING', 'ASSIGNED', or 'RESOLVED') is required.");
        });

        it('returns 400 with validation message when EmergencyConflictError is thrown during PATCH', async () => {
            jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockRejectedValueOnce(
                new EmergencyServer.EmergencyConflictError(
                    'Invalid status transition: Cannot transition from PENDING to RESOLVED.',
                    400
                )
            );

            const req = new Request('http://localhost:8081/api/emergencies/EMG-888', {
                method: 'PATCH',
                body: JSON.stringify({ status: 'RESOLVED' }),
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toContain('Invalid status transition');
        });

        it('returns 404 when target emergency to update does not exist', async () => {
            jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockRejectedValueOnce(
                new EmergencyServer.EmergencyConflictError("Emergency request 'EMG-404' not found.", 404)
            );

            const req = new Request('http://localhost:8081/api/emergencies/EMG-404', {
                method: 'PATCH',
                body: JSON.stringify({
                    status: 'ASSIGNED',
                    responderName: 'Crew',
                    responderContact: '0770001122',
                }),
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-404' }) });
            const json = await res.json();

            expect(res.status).toBe(404);
            expect(json.success).toBe(false);
            expect(json.message).toContain('not found');
        });

        it('returns 500 when unexpected server crash occurs during PATCH', async () => {
            jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockRejectedValueOnce(
                new Error('Firestore write quota exceeded')
            );

            const req = new Request('http://localhost:8081/api/emergencies/EMG-888', {
                method: 'PATCH',
                body: JSON.stringify({
                    status: 'ASSIGNED',
                    responderName: 'Crew',
                    responderContact: '0770001122',
                }),
            });

            const res = await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-888' }) });
            const json = await res.json();

            expect(res.status).toBe(500);
            expect(json.success).toBe(false);
            expect(json.message).toContain('Firestore write quota exceeded');
        });
    });

    describe('6. Comprehensive Security, Actor Injection & CORS Headers Verification', () => {
        it('ensures CORS headers are present on successful GET responses', async () => {
            jest.spyOn(EmergencyServer, 'listEmergencies').mockResolvedValueOnce([]);

            const req = new Request('http://localhost:8081/api/emergencies');
            const res = await getEmergenciesRoute(req);

            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
        });

        it('ensures CORS headers are present on error responses (400 Bad Request)', async () => {
            // POST needs a passenger session to reach body validation.
            (authenticateRequest as jest.Mock).mockResolvedValueOnce({
                uid: 'uid-PAS-2026-00010',
                passengerId: 'PAS-2026-00010',
                role: 'PASSENGER',
                email: 'passenger10@moreable.lk',
            });
            const req = new Request('http://localhost:8081/api/emergencies', {
                method: 'POST',
                body: 'not a json',
            });

            const res = await postEmergencyRoute(req);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(res.status).toBe(400);
        });

        it('ensures CORS headers are present on not found error responses (404)', async () => {
            jest.spyOn(EmergencyServer, 'getEmergencyDetail').mockResolvedValueOnce(null);

            const req = new Request('http://localhost:8081/api/emergencies/EMG-NONE');
            const res = await getEmergencyDetailRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-NONE' }) });

            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(res.status).toBe(404);
        });

        it('extracts actor ID from authenticated user token during PATCH status transition', async () => {
            (authenticateRequest as jest.Mock).mockResolvedValueOnce({
                email: 'lead_dispatcher@transport.lk',
                role: 'ADMIN',
            });

            const updateSpy = jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockResolvedValueOnce({
                id: 'EMG-TEST',
                status: 'ASSIGNED',
            } as any);

            const req = new Request('http://localhost:8081/api/emergencies/EMG-TEST', {
                method: 'PATCH',
                body: JSON.stringify({
                    status: 'ASSIGNED',
                    responderName: 'Bus Conductor',
                    responderContact: '0712345678',
                }),
            });

            await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-TEST' }) });

            expect(updateSpy).toHaveBeenCalledWith(
                expect.anything(),
                'EMG-TEST',
                expect.anything(),
                'lead_dispatcher@transport.lk'
            );
        });

        it('falls back to default actor ID when request authentication is unverified', async () => {
            (authenticateRequest as jest.Mock).mockRejectedValueOnce(new Error('Invalid token'));

            const updateSpy = jest.spyOn(EmergencyServer, 'updateEmergencyStatus').mockResolvedValueOnce({
                id: 'EMG-TEST',
                status: 'ASSIGNED',
            } as any);

            const req = new Request('http://localhost:8081/api/emergencies/EMG-TEST', {
                method: 'PATCH',
                body: JSON.stringify({
                    status: 'ASSIGNED',
                    responderName: 'Bus Conductor',
                    responderContact: '0712345678',
                }),
            });

            await patchEmergencyRoute(req, { params: Promise.resolve({ emergencyId: 'EMG-TEST' }) });

            expect(updateSpy).toHaveBeenCalledWith(
                expect.anything(),
                'EMG-TEST',
                expect.anything(),
                'Admin Dispatcher'
            );
        });
    });
});
