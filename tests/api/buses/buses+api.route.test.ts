import {
    DELETE as deleteBus,
    GET as getBus,
    PUT as updateBus,
} from '../../../app/api/buses/[busId]+api';
import { POST as createBus, GET as getBuses } from '../../../app/api/buses/index+api';
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
function buildRequest(path: string, method: string, body?: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

/** A realistic, valid create payload matching the documented bus model. */
function validBusPayload(overrides: Record<string, any> = {}) {
    return {
        numberPlate: 'NB-1234',
        chassisNumber: 'CHS-2026-00001',
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: {
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            walkingAssistance: false,
            wheelchairSpace: { available: true, count: 2 },
            guardianSeats: { available: true, count: 2 },
            prioritySeats: { available: true, count: 2 },
            elderlySeats: { available: true, count: 2 },
        },
        ...overrides,
    };
}

/** An existing stored bus document, as the create endpoint would have written it. */
function storedBus(overrides: Record<string, any> = {}) {
    return {
        id: 'BUS-00001',
        busId: 'BUS-00001',
        numberPlate: 'NB-1234',
        chassisNumber: 'CHS-2026-00001',
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: {
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            walkingAssistance: false,
            wheelchairSpace: { available: true, count: 2 },
            guardianSeats: { available: true, count: 2 },
            prioritySeats: { available: true, count: 2 },
            elderlySeats: { available: true, count: 2 },
        },
        status: 'ACTIVE',
        ...overrides,
    };
}

/** A Firestore double whose reads reject, for error-path coverage. */
function failingFirestore(message = 'Firestore unavailable') {
    return {
        collection: jest.fn(() => ({
            orderBy: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error(message)) })),
            where: jest.fn(() => ({
                limit: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error(message)) })),
            })),
            doc: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error(message)) })),
        })),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// CREATE
// ==================================================================
describe('POST /api/buses - add vehicle', () => {
    it('creates a valid bus and returns 201 with the created record', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await createBus(buildRequest('/api/buses', 'POST', validBusPayload()));
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.message).toMatch(/created successfully/i);
        expect(json.bus.numberPlate).toBe('NB-1234');
        expect(json.bus.busModel).toBe('Ashok Leyland Viking');
        expect(json.bus.manufacturer).toBe('Ashok Leyland');
        expect(json.bus.manufactureYear).toBe(2025);
        expect(json.bus.seatCapacity).toBe(54);
    });

    it('generates a sequential BUS-xxxxx identifier', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await createBus(buildRequest('/api/buses', 'POST', validBusPayload()));
        const json = await response.json();

        expect(json.bus.busId).toMatch(/^BUS-\d{5}$/);
    });

    it('defaults status to ACTIVE when none is supplied', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await createBus(buildRequest('/api/buses', 'POST', validBusPayload()));
        const json = await response.json();

        expect(json.bus.status).toBe('ACTIVE');
    });

    it('honours an explicitly supplied status', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await createBus(
            buildRequest('/api/buses', 'POST', validBusPayload({ status: 'MAINTENANCE' }))
        );
        const json = await response.json();

        expect(json.bus.status).toBe('MAINTENANCE');
    });

    it('normalises the number plate to trimmed uppercase', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await createBus(
            buildRequest('/api/buses', 'POST', validBusPayload({ numberPlate: '  nb-5678  ' }))
        );
        const json = await response.json();

        expect(json.bus.numberPlate).toBe('NB-5678');
    });

    it('trims surrounding whitespace from text fields', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await createBus(
            buildRequest(
                '/api/buses',
                'POST',
                validBusPayload({
                    chassisNumber: '  CHS-2026-00009  ',
                    busModel: '  Lanka Ashok  ',
                    manufacturer: '  Ashok Leyland  ',
                })
            )
        );
        const json = await response.json();

        expect(json.bus.chassisNumber).toBe('CHS-2026-00009');
        expect(json.bus.busModel).toBe('Lanka Ashok');
        expect(json.bus.manufacturer).toBe('Ashok Leyland');
    });

    describe('required field validation', () => {
        const requiredFields = [
            'numberPlate',
            'chassisNumber',
            'busModel',
            'manufacturer',
            'manufactureYear',
            'seatCapacity',
        ];

        it.each(requiredFields)('rejects a create request missing %s', async (field) => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const payload = validBusPayload();
            delete (payload as any)[field];

            const response = await createBus(buildRequest('/api/buses', 'POST', payload));
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(/required bus details are missing/i);
        });

        it('rejects an empty number plate', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const response = await createBus(
                buildRequest('/api/buses', 'POST', validBusPayload({ numberPlate: '' }))
            );

            expect(response.status).toBe(400);
        });

        it('does not crash on a malformed request body', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const malformed = new Request('http://localhost/api/buses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{"numberPlate":',
            });

            const response = await createBus(malformed);
            const json = await response.json();

            // Handled by the catch-all rather than throwing.
            expect(response.status).toBe(500);
            expect(json.success).toBe(false);
        });
    });

    describe('duplicate number plate', () => {
        it('rejects a duplicate plate with 409', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

            const response = await createBus(
                buildRequest('/api/buses', 'POST', validBusPayload({ numberPlate: 'NB-1234' }))
            );
            const json = await response.json();

            expect(response.status).toBe(409);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(/already exists/i);
        });

        it('detects a duplicate regardless of case and padding', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

            const response = await createBus(
                buildRequest('/api/buses', 'POST', validBusPayload({ numberPlate: '  nb-1234 ' }))
            );

            expect(response.status).toBe(409);
        });

        it('allows a different plate', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

            const response = await createBus(
                buildRequest('/api/buses', 'POST', validBusPayload({ numberPlate: 'NB-9999' }))
            );

            expect(response.status).toBe(201);
        });
    });

    describe('accessibility facilities', () => {
        it('stores every supplied facility exactly', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const response = await createBus(buildRequest('/api/buses', 'POST', validBusPayload()));
            const json = await response.json();
            const facilities = json.bus.accessibilityFacilities;

            expect(facilities.wheelchairRamp).toBe(true);
            expect(facilities.audioAnnouncement).toBe(true);
            expect(facilities.lowFloorVehicle).toBe(true);
            expect(facilities.walkingAssistance).toBe(false);
            expect(facilities.wheelchairSpace).toEqual({ available: true, count: 2 });
            expect(facilities.guardianSeats).toEqual({ available: true, count: 2 });
            expect(facilities.prioritySeats).toEqual({ available: true, count: 2 });
            expect(facilities.elderlySeats).toEqual({ available: true, count: 2 });
        });

        it('defaults every facility to unavailable when none are supplied', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const payload = validBusPayload();
            delete (payload as any).accessibilityFacilities;

            const response = await createBus(buildRequest('/api/buses', 'POST', payload));
            const json = await response.json();
            const facilities = json.bus.accessibilityFacilities;

            expect(facilities.wheelchairRamp).toBe(false);
            expect(facilities.audioAnnouncement).toBe(false);
            expect(facilities.lowFloorVehicle).toBe(false);
            expect(facilities.walkingAssistance).toBe(false);
            expect(facilities.wheelchairSpace).toEqual({ available: false, count: 0 });
            expect(facilities.elderlySeats).toEqual({ available: false, count: 0 });
        });

        it('forces the seat count to zero when a facility is unavailable', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const response = await createBus(
                buildRequest(
                    '/api/buses',
                    'POST',
                    validBusPayload({
                        accessibilityFacilities: {
                            wheelchairSpace: { available: false, count: 5 },
                            prioritySeats: { available: true, count: 4 },
                        },
                    })
                )
            );
            const json = await response.json();
            const facilities = json.bus.accessibilityFacilities;

            // An unavailable facility must never carry a non-zero count.
            expect(facilities.wheelchairSpace).toEqual({ available: false, count: 0 });
            expect(facilities.prioritySeats).toEqual({ available: true, count: 4 });
        });
    });

    it('returns 500 when Firestore fails during creation', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const response = await createBus(buildRequest('/api/buses', 'POST', validBusPayload()));
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/failed to create bus/i);
    });

    // ----------------------------------------------------------------
    // Field-value validation.
    //
    // POST must reject exactly what PUT /api/buses/:busId rejects, so a
    // bus can never be created with data that could not later be saved.
    // Regression coverage for defects VM-1 .. VM-5 (MOV-167).
    // ----------------------------------------------------------------
    describe('field value validation (regression: VM-1 .. VM-5)', () => {
        /** Asserts a 400 and that nothing reached the datastore. */
        async function expectRejectedWithoutPersisting(
            payload: Record<string, any>,
            expectedMessage: RegExp
        ) {
            const db = createFakeFirestore({ buses: [] });
            mockGetAdminDb.mockReturnValue(db);

            const response = await createBus(buildRequest('/api/buses', 'POST', payload));
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(expectedMessage);

            // The invalid bus must not have been written.
            const listResponse = await getBuses();
            const listJson = await listResponse.json();
            expect(listJson.count).toBe(0);
            expect(listJson.buses).toEqual([]);
        }

        it('VM-1: rejects a whitespace-only number plate', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ numberPlate: '   ' }),
                /invalid number plate/i
            );
        });

        it('VM-2: rejects a non-numeric seat capacity', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ seatCapacity: 'fifty' }),
                /seat capacity must be a positive number/i
            );
        });

        it('VM-3: rejects a negative seat capacity', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ seatCapacity: -10 }),
                /seat capacity must be a positive number/i
            );
        });

        it('VM-4: rejects an implausible manufacture year', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ manufactureYear: 1500 }),
                /invalid manufacture year/i
            );
        });

        it('VM-5: rejects a whitespace-only chassis number', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ chassisNumber: '   ' }),
                /invalid chassis number/i
            );
        });

        it('rejects a fractional seat capacity', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ seatCapacity: 12.5 }),
                /seat capacity must be a positive number/i
            );
        });

        it('rejects a future manufacture year', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ manufactureYear: new Date().getFullYear() + 5 }),
                /invalid manufacture year/i
            );
        });

        it('rejects a whitespace-only bus model', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ busModel: '   ' }),
                /invalid bus model/i
            );
        });

        it('rejects a whitespace-only manufacturer', async () => {
            await expectRejectedWithoutPersisting(
                validBusPayload({ manufacturer: '   ' }),
                /invalid manufacturer/i
            );
        });

        it('still accepts a numeric string seat capacity, as PUT does', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

            const response = await createBus(
                buildRequest('/api/buses', 'POST', validBusPayload({ seatCapacity: '54' }))
            );
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.bus.seatCapacity).toBe(54);
        });
    });
});

// ==================================================================
// READ
// ==================================================================
describe('GET /api/buses - list vehicles', () => {
    it('returns all buses with a matching count', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                buses: [
                    storedBus(),
                    storedBus({ id: 'BUS-00002', busId: 'BUS-00002', numberPlate: 'NB-5678' }),
                ],
            })
        );

        const response = await getBuses();
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(2);
        expect(json.buses).toHaveLength(2);
        expect(json.count).toBe(json.buses.length);
    });

    it('returns the expected fields on each bus', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await getBuses();
        const json = await response.json();
        const [bus] = json.buses;

        expect(bus).toMatchObject({
            busId: 'BUS-00001',
            numberPlate: 'NB-1234',
            chassisNumber: 'CHS-2026-00001',
            busModel: 'Ashok Leyland Viking',
            manufacturer: 'Ashok Leyland',
            manufactureYear: 2025,
            seatCapacity: 54,
            status: 'ACTIVE',
        });
        expect(bus.accessibilityFacilities).toBeDefined();
    });

    it('handles an empty fleet without error', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await getBuses();
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        expect(json.buses).toEqual([]);
    });

    it('returns 500 when Firestore fails', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const response = await getBuses();
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/failed to retrieve buses/i);
    });
});

describe('GET /api/buses/:identifier - single vehicle', () => {
    it('resolves a bus by its bus id', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await getBus(buildRequest('/api/buses/BUS-00001', 'GET'), {
            params: { busId: 'BUS-00001' },
        });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.bus.busId).toBe('BUS-00001');
    });

    it('resolves a bus by its number plate', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await getBus(buildRequest('/api/buses/NB-1234', 'GET'), {
            params: { busId: 'NB-1234' },
        });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.bus.numberPlate).toBe('NB-1234');
    });

    it('returns 404 for an unknown identifier', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await getBus(buildRequest('/api/buses/BUS-99999', 'GET'), {
            params: { busId: 'BUS-99999' },
        });
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/not found/i);
    });
});

// ==================================================================
// UPDATE
// ==================================================================
describe('PUT /api/buses/:identifier - update vehicle', () => {
    const putRequest = (body: unknown) => buildRequest('/api/buses/BUS-00001', 'PUT', body);
    const putContext = { params: { busId: 'BUS-00001' } };

    it('updates supplied fields and persists them', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(
            putRequest({ busModel: 'Tata Starbus', seatCapacity: 48 }),
            putContext
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.bus.busModel).toBe('Tata Starbus');
        expect(json.bus.seatCapacity).toBe(48);
        // Untouched fields must survive a partial update.
        expect(json.bus.numberPlate).toBe('NB-1234');
        expect(json.bus.manufacturer).toBe('Ashok Leyland');
    });

    it('updates the status', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ status: 'MAINTENANCE' }), putContext);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.bus.status).toBe('MAINTENANCE');
    });

    it('updates accessibility facilities', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(
            putRequest({
                accessibilityFacilities: {
                    wheelchairRamp: false,
                    prioritySeats: { available: true, count: 6 },
                },
            }),
            putContext
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.bus.accessibilityFacilities.wheelchairRamp).toBe(false);
        expect(json.bus.accessibilityFacilities.prioritySeats).toEqual({
            available: true,
            count: 6,
        });
    });

    it('zeroes the count when a facility is turned off', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(
            putRequest({
                accessibilityFacilities: { wheelchairSpace: { available: false, count: 9 } },
            }),
            putContext
        );
        const json = await response.json();

        expect(json.bus.accessibilityFacilities.wheelchairSpace).toEqual({
            available: false,
            count: 0,
        });
    });

    it('rejects a non-positive seat capacity', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ seatCapacity: 0 }), putContext);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/seat capacity must be a positive number/i);
    });

    it('rejects a non-numeric seat capacity', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ seatCapacity: 'fifty' }), putContext);

        expect(response.status).toBe(400);
    });

    it('rejects an implausible manufacture year', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ manufactureYear: 1800 }), putContext);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/invalid manufacture year/i);
    });

    it('rejects a future manufacture year', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(
            putRequest({ manufactureYear: new Date().getFullYear() + 5 }),
            putContext
        );

        expect(response.status).toBe(400);
    });

    it('rejects a blank chassis number', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ chassisNumber: '   ' }), putContext);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/invalid chassis number/i);
    });

    it('rejects an unsupported status', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ status: 'RETIRED' }), putContext);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/ACTIVE, INACTIVE, MAINTENANCE/);
    });

    it('rejects an update containing no recognised fields', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(putRequest({ unknownField: 'value' }), putContext);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/no valid fields/i);
    });

    it('ignores numberPlate because it is not updatable', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await updateBus(
            putRequest({ numberPlate: 'NB-0000', busModel: 'Tata Starbus' }),
            putContext
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.bus.numberPlate).toBe('NB-1234');
        expect(json.bus.busModel).toBe('Tata Starbus');
    });

    it('returns 404 when updating a bus that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await updateBus(
            buildRequest('/api/buses/BUS-99999', 'PUT', { busModel: 'Tata Starbus' }),
            { params: { busId: 'BUS-99999' } }
        );
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
    });
});

// ==================================================================
// DELETE
// ==================================================================
describe('DELETE /api/buses/:identifier - remove vehicle', () => {
    it('deletes an existing bus', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        const response = await deleteBus(buildRequest('/api/buses/BUS-00001', 'DELETE'), {
            params: { busId: 'BUS-00001' },
        });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toMatch(/deleted successfully/i);
    });

    it('removes the bus from subsequent reads', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [storedBus()] }));

        await deleteBus(buildRequest('/api/buses/BUS-00001', 'DELETE'), {
            params: { busId: 'BUS-00001' },
        });

        const listResponse = await getBuses();
        const listJson = await listResponse.json();

        expect(listJson.count).toBe(0);
        expect(listJson.buses).toEqual([]);
    });

    it('returns 404 when deleting a bus that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [] }));

        const response = await deleteBus(buildRequest('/api/buses/BUS-99999', 'DELETE'), {
            params: { busId: 'BUS-99999' },
        });
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/not found/i);
    });
});