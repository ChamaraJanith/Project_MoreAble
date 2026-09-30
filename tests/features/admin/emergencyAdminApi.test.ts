import {
    createEmergencyRequestApi,
    getEmergencies,
    getEmergencyById,
    updateEmergencyStatusApi,
    EmergencyFilters,
} from '../../../src/features/admin/api/emergencyAdminApi';
import {
    CreateEmergencyInput,
    EmergencyRequest,
    UpdateEmergencyStatusInput,
} from '../../../src/entities/emergency/model/types';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
        headers: {
            get: (key: string) => headers[key] || headers[key.toLowerCase()] || null,
        },
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

const MOCK_EMERGENCY_PENDING: EmergencyRequest = {
    id: 'EMG-12345',
    status: 'PENDING',
    priority: 'CRITICAL',
    bookingId: 'BKG-998877',
    passenger: {
        id: 'PAS-01',
        name: 'Nimal Silva',
        phone: '0771234567',
        email: 'nimal@example.com',
        specialAssistance: 'Wheelchair Commuter',
    },
    vehicle: {
        plateNumber: 'WP-ND-4521',
        model: 'Isuzu Transit Low-Floor',
        routeNumber: '138',
        driverId: 'DRV-882',
        driverName: 'Sunil Shantha',
    },
    location: {
        latitude: 6.9271,
        longitude: 79.8612,
        address: '123 High Level Road',
        stopName: 'Nugegoda Junction',
        landmark: 'Near Supermarket',
    },
    alertRecipients: {
        caregiver: '0779988776',
        driver: 'DRV-882',
        admin: 'ADMIN_CONTROL_TOPIC',
    },
    statusHistory: [
        {
            status: 'PENDING',
            changedAt: '2026-09-28T12:00:00.000Z',
            changedBy: 'Passenger SOS Beacon',
            notes: 'Emergency SOS initiated by commuter',
        },
    ],
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
};

const MOCK_EMERGENCY_ASSIGNED: EmergencyRequest = {
    ...MOCK_EMERGENCY_PENDING,
    status: 'ASSIGNED',
    assignment: {
        responderName: 'Officer Kamal Perera',
        responderContact: '0712345678',
        etaMinutes: 8,
        assignedAt: '2026-09-28T12:05:00.000Z',
        assignedBy: 'Dispatcher Chamara',
        notes: 'Bus crew instructed to stop and assist commuter immediately',
    },
    statusHistory: [
        ...MOCK_EMERGENCY_PENDING.statusHistory,
        {
            status: 'ASSIGNED',
            changedAt: '2026-09-28T12:05:00.000Z',
            changedBy: 'Dispatcher Chamara',
            notes: 'Bus crew instructed to stop and assist commuter immediately',
            responderName: 'Officer Kamal Perera',
            responderContact: '0712345678',
            etaMinutes: 8,
        },
    ],
    updatedAt: '2026-09-28T12:05:00.000Z',
};

const MOCK_EMERGENCY_RESOLVED: EmergencyRequest = {
    ...MOCK_EMERGENCY_ASSIGNED,
    status: 'RESOLVED',
    resolution: {
        resolvedAt: '2026-09-28T12:20:00.000Z',
        resolvedBy: 'Dispatcher Chamara',
        actionTaken: 'Wheelchair safely ramped down at Maharagama Station. Commuter escorted to platform.',
        notes: 'Incident resolved safely with no injuries.',
    },
    statusHistory: [
        ...MOCK_EMERGENCY_ASSIGNED.statusHistory,
        {
            status: 'RESOLVED',
            changedAt: '2026-09-28T12:20:00.000Z',
            changedBy: 'Dispatcher Chamara',
            actionTaken: 'Wheelchair safely ramped down at Maharagama Station. Commuter escorted to platform.',
            notes: 'Incident resolved safely with no injuries.',
        },
    ],
    updatedAt: '2026-09-28T12:20:00.000Z',
};

beforeEach(() => {
    mockFetch.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function lastCall() {
    const callIndex = mockFetch.mock.calls.length - 1;
    if (callIndex < 0) return { url: '', init: undefined, body: undefined };
    const [url, init] = mockFetch.mock.calls[callIndex];
    return { url, init, body: init?.body ? JSON.parse(init.body) : undefined };
}

describe('MOV-236: Emergency Admin API Client Helper Test Suite', () => {
    describe('1. getEmergencies API function', () => {
        it('fetches all emergency requests without query params when no filters passed', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, count: 1, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            const result = await getEmergencies();

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(lastCall().url).toBe('/api/emergencies');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('EMG-12345');
            expect(result[0].status).toBe('PENDING');
        });

        it('fetches emergency requests with empty object as filters', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, count: 1, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            const result = await getEmergencies({});

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(lastCall().url).toBe('/api/emergencies');
            expect(result).toHaveLength(1);
        });

        it('omits status parameter when status filter is ALL', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_PENDING, MOCK_EMERGENCY_RESOLVED] })
            );

            const result = await getEmergencies({ status: 'ALL' });

            expect(lastCall().url).toBe('/api/emergencies');
            expect(result).toHaveLength(2);
        });

        it('attaches status=PENDING parameter when filtering by PENDING status', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            const result = await getEmergencies({ status: 'PENDING' });

            expect(lastCall().url).toBe('/api/emergencies?status=PENDING');
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('PENDING');
        });

        it('attaches status=ASSIGNED parameter when filtering by ASSIGNED status', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_ASSIGNED] })
            );

            const result = await getEmergencies({ status: 'ASSIGNED' });

            expect(lastCall().url).toBe('/api/emergencies?status=ASSIGNED');
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('ASSIGNED');
        });

        it('attaches status=RESOLVED parameter when filtering by RESOLVED status', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_RESOLVED] })
            );

            const result = await getEmergencies({ status: 'RESOLVED' });

            expect(lastCall().url).toBe('/api/emergencies?status=RESOLVED');
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('RESOLVED');
        });

        it('trims whitespace and encodes search query parameter', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            const result = await getEmergencies({ search: '  WP-ND-4521  ' });

            expect(lastCall().url).toBe('/api/emergencies?search=WP-ND-4521');
            expect(result).toHaveLength(1);
        });

        it('handles search queries with special URL characters safely', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            await getEmergencies({ search: 'Bus & Van' });

            expect(lastCall().url).toBe('/api/emergencies?search=Bus+%26+Van');
        });

        it('combines both status filter and search query correctly', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            await getEmergencies({ status: 'PENDING', search: 'Nimal' });

            expect(lastCall().url).toBe('/api/emergencies?status=PENDING&search=Nimal');
        });

        it('ignores search filter when search string is empty or contains only whitespace', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergencies: [MOCK_EMERGENCY_PENDING] })
            );

            await getEmergencies({ status: 'PENDING', search: '   ' });

            expect(lastCall().url).toBe('/api/emergencies?status=PENDING');
        });

        it('returns empty array when backend response contains no emergencies field', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true })
            );

            const result = await getEmergencies();

            expect(result).toEqual([]);
        });

        it('returns empty array when backend returns an empty list', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, count: 0, emergencies: [] })
            );

            const result = await getEmergencies({ status: 'RESOLVED' });

            expect(result).toEqual([]);
        });

        it('throws an error with server message when HTTP response is not ok (400 Bad Request)', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: 'Invalid query parameters' }, 400)
            );

            await expect(getEmergencies({ status: 'INVALID' as any })).rejects.toThrow(
                'Invalid query parameters'
            );
        });

        it('throws an error when HTTP response is 401 Unauthorized', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: 'Admin authentication required.' }, 401)
            );

            await expect(getEmergencies()).rejects.toThrow('Admin authentication required.');
        });

        it('throws an error when HTTP response is 403 Forbidden', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: 'Access denied: Emergency dispatch role required.' }, 403)
            );

            await expect(getEmergencies()).rejects.toThrow('Access denied: Emergency dispatch role required.');
        });

        it('throws an error when HTTP response is 500 Internal Server Error', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: 'Firestore connection failure.' }, 500)
            );

            await expect(getEmergencies()).rejects.toThrow('Firestore connection failure.');
        });

        it('throws default error message when error response body lacks message property', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ error: 'Unexpected crash' }, 500)
            );

            await expect(getEmergencies()).rejects.toThrow('Something went wrong. Please try again.');
        });

        it('propagates network failure when fetch throws TypeError', async () => {
            mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

            await expect(getEmergencies()).rejects.toThrow('Network error. Please check your connection and try again.');
        });

        it('propagates network abort when timeout occurs', async () => {
            mockFetch.mockRejectedValueOnce(new Error('The user aborted a request.'));

            await expect(getEmergencies()).rejects.toThrow('Network error. Please check your connection and try again.');
        });
    });

    describe('2. getEmergencyById API function', () => {
        it('fetches a single emergency request by identifier', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_PENDING })
            );

            const result = await getEmergencyById('EMG-12345');

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(lastCall().url).toBe('/api/emergencies/EMG-12345');
            expect(result).toBeDefined();
            expect(result.id).toBe('EMG-12345');
            expect(result.passenger.name).toBe('Nimal Silva');
        });

        it('encodes emergency ID containing special characters or slashes', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_PENDING })
            );

            await getEmergencyById('EMG/2026/001');

            expect(lastCall().url).toBe('/api/emergencies/EMG%2F2026%2F001');
        });

        it('throws error when emergency is not found (404)', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: "Emergency request 'EMG-99999' not found." }, 404)
            );

            await expect(getEmergencyById('EMG-99999')).rejects.toThrow(
                "Emergency request 'EMG-99999' not found."
            );
        });

        it('returns assigned emergency with responder details intact', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_ASSIGNED })
            );

            const result = await getEmergencyById('EMG-12345');

            expect(result.status).toBe('ASSIGNED');
            expect(result.assignment?.responderName).toBe('Officer Kamal Perera');
            expect(result.assignment?.etaMinutes).toBe(8);
        });

        it('returns resolved emergency with resolution summary intact', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_RESOLVED })
            );

            const result = await getEmergencyById('EMG-12345');

            expect(result.status).toBe('RESOLVED');
            expect(result.resolution?.actionTaken).toContain('Wheelchair safely ramped down');
            expect(result.statusHistory).toHaveLength(3);
        });

        it('handles server network failure when retrieving details', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network offline'));

            await expect(getEmergencyById('EMG-12345')).rejects.toThrow('Network error. Please check your connection and try again.');
        });
    });

    describe('3. updateEmergencyStatusApi function', () => {
        it('sends PATCH request to transition PENDING to ASSIGNED with responder info', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_ASSIGNED })
            );

            const payload: UpdateEmergencyStatusInput = {
                status: 'ASSIGNED',
                responderName: 'Officer Kamal Perera',
                responderContact: '0712345678',
                etaMinutes: 8,
                notes: 'Bus crew instructed to stop and assist commuter immediately',
            };

            const result = await updateEmergencyStatusApi('EMG-12345', payload);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(lastCall().url).toBe('/api/emergencies/EMG-12345');
            expect(lastCall().init.method).toBe('PATCH');
            expect(lastCall().init.headers['Content-Type']).toBe('application/json');
            expect(lastCall().body).toEqual(payload);
            expect(result.status).toBe('ASSIGNED');
            expect(result.assignment?.responderName).toBe('Officer Kamal Perera');
        });

        it('sends PATCH request to transition ASSIGNED to RESOLVED with action taken', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_RESOLVED })
            );

            const payload: UpdateEmergencyStatusInput = {
                status: 'RESOLVED',
                actionTaken: 'Wheelchair safely ramped down at Maharagama Station. Commuter escorted to platform.',
                notes: 'Incident resolved safely with no injuries.',
            };

            const result = await updateEmergencyStatusApi('EMG-12345', payload);

            expect(lastCall().url).toBe('/api/emergencies/EMG-12345');
            expect(lastCall().init.method).toBe('PATCH');
            expect(lastCall().body).toEqual(payload);
            expect(result.status).toBe('RESOLVED');
            expect(result.resolution?.actionTaken).toContain('Wheelchair safely ramped down');
        });

        it('encodes emergency ID properly during status update', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_ASSIGNED })
            );

            await updateEmergencyStatusApi('EMG#Special/Id', {
                status: 'ASSIGNED',
                responderName: 'Crew A',
                responderContact: '0770000000',
            });

            expect(lastCall().url).toBe('/api/emergencies/EMG%23Special%2FId');
        });

        it('throws error when attempting invalid transition from PENDING directly to RESOLVED', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: false,
                        message: "Invalid status transition: Cannot transition from 'PENDING' to 'RESOLVED'. Workflow is: Pending -> Assigned -> Resolved.",
                    },
                    400
                )
            );

            await expect(
                updateEmergencyStatusApi('EMG-12345', {
                    status: 'RESOLVED',
                    actionTaken: 'Bypassed assignment',
                })
            ).rejects.toThrow("Invalid status transition: Cannot transition from 'PENDING' to 'RESOLVED'");
        });

        it('throws error when assignment lacks required responder name or contact', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: false,
                        message: 'Responder name and contact number are required when assigning support.',
                    },
                    400
                )
            );

            await expect(
                updateEmergencyStatusApi('EMG-12345', {
                    status: 'ASSIGNED',
                })
            ).rejects.toThrow('Responder name and contact number are required');
        });

        it('throws error when resolution lacks required action taken', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: false,
                        message: 'Resolution notes or action taken must be provided to resolve an emergency.',
                    },
                    400
                )
            );

            await expect(
                updateEmergencyStatusApi('EMG-12345', {
                    status: 'RESOLVED',
                })
            ).rejects.toThrow('Resolution notes or action taken must be provided');
        });

        it('throws error when target emergency does not exist in database (404)', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: "Emergency request 'EMG-NOT-FOUND' not found." }, 404)
            );

            await expect(
                updateEmergencyStatusApi('EMG-NOT-FOUND', {
                    status: 'ASSIGNED',
                    responderName: 'Conductor',
                    responderContact: '0771112233',
                })
            ).rejects.toThrow("Emergency request 'EMG-NOT-FOUND' not found.");
        });

        it('throws error on concurrent modification conflict (409 Conflict)', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: false,
                        message: 'Emergency request has already been updated by another dispatcher.',
                    },
                    409
                )
            );

            await expect(
                updateEmergencyStatusApi('EMG-12345', {
                    status: 'ASSIGNED',
                    responderName: 'Conductor',
                    responderContact: '0771112233',
                })
            ).rejects.toThrow('Emergency request has already been updated');
        });
    });

    describe('4. createEmergencyRequestApi function', () => {
        it('sends POST request with complete passenger SOS payload', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_PENDING }, 201)
            );

            const input: CreateEmergencyInput = {
                bookingId: 'BKG-998877',
                passenger: {
                    id: 'PAS-01',
                    name: 'Nimal Silva',
                    phone: '0771234567',
                    email: 'nimal@example.com',
                    specialAssistance: 'Wheelchair Commuter',
                },
                vehicle: {
                    plateNumber: 'WP-ND-4521',
                    model: 'Isuzu Transit Low-Floor',
                    routeNumber: '138',
                    driverId: 'DRV-882',
                    driverName: 'Sunil Shantha',
                },
                location: {
                    latitude: 6.9271,
                    longitude: 79.8612,
                    address: '123 High Level Road',
                    stopName: 'Nugegoda Junction',
                },
                alertRecipients: {
                    caregiver: '0779988776',
                    driver: 'DRV-882',
                    admin: 'ADMIN_CONTROL_TOPIC',
                },
                notes: 'Passenger pressed emergency SOS button on transit seat',
            };

            const result = await createEmergencyRequestApi(input);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(lastCall().url).toBe('/api/emergencies');
            expect(lastCall().init.method).toBe('POST');
            expect(lastCall().init.headers['Content-Type']).toBe('application/json');
            expect(lastCall().body).toEqual(input);
            expect(result.id).toBe('EMG-12345');
            expect(result.status).toBe('PENDING');
            expect(result.passenger.name).toBe('Nimal Silva');
        });

        it('sends POST request with minimal required emergency inputs', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: true,
                        emergency: {
                            ...MOCK_EMERGENCY_PENDING,
                            id: 'EMG-MINIMAL-01',
                            passenger: { name: 'Kasun', phone: '0711112222' },
                            location: { latitude: 6.9319, longitude: 79.8478 },
                        },
                    },
                    201
                )
            );

            const minimalInput: CreateEmergencyInput = {
                passenger: {
                    name: 'Kasun',
                    phone: '0711112222',
                },
                location: {
                    latitude: 6.9319,
                    longitude: 79.8478,
                },
            };

            const result = await createEmergencyRequestApi(minimalInput);

            expect(lastCall().url).toBe('/api/emergencies');
            expect(lastCall().init.method).toBe('POST');
            expect(lastCall().body.passenger.name).toBe('Kasun');
            expect(result.id).toBe('EMG-MINIMAL-01');
        });

        it('handles server validation failure when required passenger name is missing', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: false,
                        message: 'Passenger name and phone are required for emergency alerts.',
                    },
                    400
                )
            );

            await expect(
                createEmergencyRequestApi({
                    passenger: { name: '', phone: '0771234567' },
                    location: { latitude: 6.9, longitude: 79.8 },
                })
            ).rejects.toThrow('Passenger name and phone are required for emergency alerts.');
        });

        it('handles server validation failure when required coordinates are missing or invalid', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    {
                        success: false,
                        message: 'Valid GPS coordinates (latitude, longitude) are required.',
                    },
                    400
                )
            );

            await expect(
                createEmergencyRequestApi({
                    passenger: { name: 'Nimal Silva', phone: '0771234567' },
                    location: { latitude: null as any, longitude: null as any },
                })
            ).rejects.toThrow('Valid GPS coordinates (latitude, longitude) are required.');
        });

        it('handles network connection error during SOS creation', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

            await expect(
                createEmergencyRequestApi({
                    passenger: { name: 'Nimal', phone: '0771234567' },
                    location: { latitude: 6.9, longitude: 79.8 },
                })
            ).rejects.toThrow('Network error. Please check your connection and try again.');
        });
    });

    describe('5. Comprehensive Header and Protocol Integrity Tests', () => {
        it('includes Content-Type header on administrative mutations with request body', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_ASSIGNED })
            );

            await updateEmergencyStatusApi('EMG-12345', {
                status: 'ASSIGNED',
                responderName: 'Crew 1',
                responderContact: '0771234567',
            });

            const headers = lastCall().init?.headers;
            expect(headers).toBeDefined();
            expect(headers['Content-Type']).toBe('application/json');
        });

        it('sends correct JSON stringification for numeric and boolean fields in emergency input', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: true, emergency: MOCK_EMERGENCY_ASSIGNED })
            );

            await updateEmergencyStatusApi('EMG-12345', {
                status: 'ASSIGNED',
                responderName: 'Crew 1',
                responderContact: '0771234567',
                etaMinutes: 15,
            });

            const parsedBody = lastCall().body;
            expect(typeof parsedBody.etaMinutes).toBe('number');
            expect(parsedBody.etaMinutes).toBe(15);
        });

        it('handles Unicode and Sinhala/Tamil characters in emergency notes gracefully', async () => {
            const sinhalaNotes = 'මගියාට හදිසි ප්‍රතිකාර අවශ්‍යයි. වහාම පරීක්ෂා කරන්න.';
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    success: true,
                    emergency: {
                        ...MOCK_EMERGENCY_PENDING,
                        statusHistory: [{ ...MOCK_EMERGENCY_PENDING.statusHistory[0], notes: sinhalaNotes }],
                    },
                })
            );

            const result = await createEmergencyRequestApi({
                passenger: { name: 'නිමල් සිල්වා', phone: '0771234567' },
                location: { latitude: 6.9271, longitude: 79.8612 },
                notes: sinhalaNotes,
            });

            expect(lastCall().body.notes).toBe(sinhalaNotes);
            expect(lastCall().body.passenger.name).toBe('නිමල් සිල්වා');
            expect(result.statusHistory[0].notes).toBe(sinhalaNotes);
        });
    });
});
