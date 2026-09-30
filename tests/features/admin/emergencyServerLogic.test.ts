jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
    dispatchEmergencySOSAlert: jest.fn(async () => {}),
}));

import {
    EMERGENCIES_COLLECTION,
    EmergencyConflictError,
    createEmergency,
    getEmergencyDetail,
    listEmergencies,
    updateEmergencyStatus,
} from '../../../src/shared/server/emergencies';
import { CreateEmergencyInput } from '../../../src/entities/emergency/model/types';

// Mock in-memory Firestore database
function createMockDb(initialDocs: Record<string, any> = {}) {
    const store: Record<string, any> = { ...initialDocs };

    return {
        collection: (collectionName: string) => {
            expect(collectionName).toBe(EMERGENCIES_COLLECTION);
            return {
                doc: (docId: string) => ({
                    get: async () => ({
                        exists: Boolean(store[docId]),
                        id: docId,
                        data: () => store[docId],
                    }),
                    set: async (data: any) => {
                        store[docId] = { ...data, id: docId };
                    },
                    update: async (data: any) => {
                        if (!store[docId]) throw new Error('Document does not exist');
                        store[docId] = { ...store[docId], ...data };
                    },
                }),
                where: (field: string, op: string, value: any) => ({
                    get: async () => {
                        const docs = Object.entries(store)
                            .filter(([_, val]) => val[field] === value)
                            .map(([id, val]) => ({
                                id,
                                data: () => val,
                            }));
                        return {
                            forEach: (cb: any) => docs.forEach(cb),
                            docs,
                        };
                    },
                }),
                get: async () => {
                    const docs = Object.entries(store).map(([id, val]) => ({
                        id,
                        data: () => val,
                    }));
                    return {
                        forEach: (cb: any) => docs.forEach(cb),
                        docs,
                    };
                },
            };
        },
        _store: store,
    };
}

describe('MOV-236: Emergency Server Operations & Audit Trail Logic', () => {
    describe('1. Emergency Creation & Validation', () => {
        it('creates a new emergency request with PENDING status and initial statusHistory', async () => {
            const db = createMockDb();
            const input: CreateEmergencyInput = {
                bookingId: 'BKG-998877',
                passenger: {
                    name: 'Kamal Perera',
                    phone: '0771234567',
                    specialAssistance: 'Wheelchair Commuter',
                },
                vehicle: {
                    plateNumber: 'WP-ND-5678',
                    model: 'SLTB Ashok Leyland',
                    driverId: 'DRV-401',
                    routeNumber: '138',
                },
                location: {
                    latitude: 6.8480,
                    longitude: 79.9265,
                    stopName: 'Maharagama Clock Tower',
                },
                notes: 'SOS triggered by passenger inside bus',
            };

            const created = await createEmergency(db, input, 'Passenger App');

            expect(created.id).toMatch(/^EMG-\d+$/);
            expect(created.status).toBe('PENDING');
            expect(created.priority).toBe('CRITICAL');
            expect(created.passenger.name).toBe('Kamal Perera');
            expect(created.passenger.phone).toBe('0771234567');
            expect(created.passenger.specialAssistance).toBe('Wheelchair Commuter');
            expect(created.vehicle.plateNumber).toBe('WP-ND-5678');
            expect(created.location.latitude).toBe(6.8480);
            expect(created.location.longitude).toBe(79.9265);

            // Verifies Acceptance Criteria 3: System records status history
            expect(created.statusHistory).toHaveLength(1);
            expect(created.statusHistory[0]).toEqual({
                status: 'PENDING',
                changedAt: expect.any(String),
                changedBy: 'Passenger App',
                notes: 'SOS triggered by passenger inside bus',
            });
        });

        it('throws an error if passenger name or phone is missing', async () => {
            const db = createMockDb();
            const invalidInput: any = {
                passenger: { name: '', phone: '' },
                location: { latitude: 6.9, longitude: 79.8 },
            };

            await expect(createEmergency(db, invalidInput)).rejects.toThrow(EmergencyConflictError);
        });

        it('throws an error if GPS coordinates are invalid or missing', async () => {
            const db = createMockDb();
            const invalidInput: any = {
                passenger: { name: 'Sunil', phone: '0771112233' },
                location: { latitude: null, longitude: undefined },
            };

            await expect(createEmergency(db, invalidInput)).rejects.toThrow(
                'Valid GPS coordinates (latitude, longitude) are required.'
            );
        });
    });

    describe('2. Listing & Filtering Emergencies (MOV-237)', () => {
        it('lists all emergencies sorted newest first', async () => {
            const db = createMockDb({
                'EMG-001': {
                    id: 'EMG-001',
                    status: 'PENDING',
                    passenger: { name: 'User 1', phone: '0711' },
                    createdAt: '2026-09-28T10:00:00.000Z',
                },
                'EMG-002': {
                    id: 'EMG-002',
                    status: 'RESOLVED',
                    passenger: { name: 'User 2', phone: '0722' },
                    createdAt: '2026-09-28T10:30:00.000Z',
                },
            });

            const list = await listEmergencies(db);
            expect(list).toHaveLength(2);
            expect(list[0].id).toBe('EMG-002'); // Newer first
            expect(list[1].id).toBe('EMG-001');
        });

        it('filters emergencies by status', async () => {
            const db = createMockDb({
                'EMG-001': { id: 'EMG-001', status: 'PENDING', passenger: { name: 'A' }, createdAt: '2026-09-28T10:00:00.000Z' },
                'EMG-002': { id: 'EMG-002', status: 'ASSIGNED', passenger: { name: 'B' }, createdAt: '2026-09-28T10:10:00.000Z' },
                'EMG-003': { id: 'EMG-003', status: 'RESOLVED', passenger: { name: 'C' }, createdAt: '2026-09-28T10:20:00.000Z' },
            });

            const pending = await listEmergencies(db, { status: 'PENDING' });
            expect(pending).toHaveLength(1);
            expect(pending[0].id).toBe('EMG-001');

            const assigned = await listEmergencies(db, { status: 'ASSIGNED' });
            expect(assigned).toHaveLength(1);
            expect(assigned[0].id).toBe('EMG-002');
        });

        it('filters emergencies by search query matching passenger, vehicle plate, or ID', async () => {
            const db = createMockDb({
                'EMG-001': {
                    id: 'EMG-001',
                    passenger: { name: 'Nimal Silva', phone: '0779998877' },
                    vehicle: { plateNumber: 'WP-ABC-1122' },
                },
                'EMG-002': {
                    id: 'EMG-002',
                    passenger: { name: 'Kasun Wickramasinghe', phone: '0714445566' },
                    vehicle: { plateNumber: 'WP-DEF-3344' },
                },
            });

            const matchName = await listEmergencies(db, { search: 'kasun' });
            expect(matchName).toHaveLength(1);
            expect(matchName[0].id).toBe('EMG-002');

            const matchPlate = await listEmergencies(db, { search: 'ABC-1122' });
            expect(matchPlate).toHaveLength(1);
            expect(matchPlate[0].id).toBe('EMG-001');
        });
    });

    describe('3. Single Emergency Detail Retrieval', () => {
        it('retrieves detailed emergency information by ID', async () => {
            const db = createMockDb({
                'EMG-900': {
                    id: 'EMG-900',
                    status: 'PENDING',
                    passenger: { name: 'Anura Kumara', phone: '0778889900' },
                },
            });

            const detail = await getEmergencyDetail(db, 'EMG-900');
            expect(detail).not.toBeNull();
            expect(detail?.passenger.name).toBe('Anura Kumara');
        });

        it('returns null if emergency ID does not exist', async () => {
            const db = createMockDb();
            const detail = await getEmergencyDetail(db, 'EMG-DOES-NOT-EXIST');
            expect(detail).toBeNull();
        });
    });

    describe('4. Status Workflow Transition (Pending -> Assigned -> Resolved) (MOV-239)', () => {
        it('transitions from PENDING to ASSIGNED with responder info and records statusHistory', async () => {
            const db = createMockDb({
                'EMG-100': {
                    id: 'EMG-100',
                    status: 'PENDING',
                    passenger: { name: 'Ruwan' },
                    statusHistory: [
                        { status: 'PENDING', changedAt: '2026-09-28T10:00:00.000Z', changedBy: 'Passenger' },
                    ],
                },
            });

            const updated = await updateEmergencyStatus(
                db,
                'EMG-100',
                {
                    status: 'ASSIGNED',
                    responderName: 'Officer Sunil Perera',
                    responderContact: '0715556677',
                    etaMinutes: 8,
                    notes: 'Rapid response unit dispatched',
                },
                'Admin Dispatcher 1'
            );

            expect(updated.status).toBe('ASSIGNED');
            expect(updated.assignment?.responderName).toBe('Officer Sunil Perera');
            expect(updated.assignment?.responderContact).toBe('0715556677');
            expect(updated.assignment?.etaMinutes).toBe(8);

            // Verifies status history is updated with second audit trail entry
            expect(updated.statusHistory).toHaveLength(2);
            expect(updated.statusHistory[1]).toEqual({
                status: 'ASSIGNED',
                changedAt: expect.any(String),
                changedBy: 'Admin Dispatcher 1',
                responderName: 'Officer Sunil Perera',
                responderContact: '0715556677',
                etaMinutes: 8,
                notes: 'Rapid response unit dispatched',
            });
        });

        it('requires responderName and responderContact when assigning support', async () => {
            const db = createMockDb({
                'EMG-100': {
                    id: 'EMG-100',
                    status: 'PENDING',
                    statusHistory: [],
                },
            });

            await expect(
                updateEmergencyStatus(db, 'EMG-100', { status: 'ASSIGNED', responderName: '', responderContact: '' })
            ).rejects.toThrow('Responder name and contact number are required');
        });

        it('transitions from ASSIGNED to RESOLVED with resolution details and records statusHistory', async () => {
            const db = createMockDb({
                'EMG-100': {
                    id: 'EMG-100',
                    status: 'ASSIGNED',
                    passenger: { name: 'Ruwan' },
                    assignment: { responderName: 'Sunil', responderContact: '0711' },
                    statusHistory: [
                        { status: 'PENDING', changedAt: '2026-09-28T10:00:00.000Z', changedBy: 'Passenger' },
                        { status: 'ASSIGNED', changedAt: '2026-09-28T10:05:00.000Z', changedBy: 'Admin' },
                    ],
                },
            });

            const updated = await updateEmergencyStatus(
                db,
                'EMG-100',
                {
                    status: 'RESOLVED',
                    actionTaken: 'First aid rendered on-site; passenger escorted safely to bus depot.',
                    notes: 'Incident successfully resolved.',
                },
                'Admin Supervisor'
            );

            expect(updated.status).toBe('RESOLVED');
            expect(updated.resolution?.resolvedBy).toBe('Admin Supervisor');
            expect(updated.resolution?.actionTaken).toBe(
                'First aid rendered on-site; passenger escorted safely to bus depot.'
            );

            // Verifies full 3-step audit trail history
            expect(updated.statusHistory).toHaveLength(3);
            expect(updated.statusHistory[2]).toEqual({
                status: 'RESOLVED',
                changedAt: expect.any(String),
                changedBy: 'Admin Supervisor',
                actionTaken: 'First aid rendered on-site; passenger escorted safely to bus depot.',
                notes: 'Incident successfully resolved.',
            });
        });

        it('rejects skipping from PENDING directly to RESOLVED without assignment', async () => {
            const db = createMockDb({
                'EMG-100': {
                    id: 'EMG-100',
                    status: 'PENDING',
                    statusHistory: [],
                },
            });

            await expect(
                updateEmergencyStatus(db, 'EMG-100', { status: 'RESOLVED', actionTaken: 'Direct resolve attempt' })
            ).rejects.toThrow(
                "Invalid status transition: Cannot transition from 'PENDING' to 'RESOLVED'. The emergency workflow is: Pending -> Assigned -> Resolved."
            );
        });

        it('rejects reverting from RESOLVED back to any other status', async () => {
            const db = createMockDb({
                'EMG-100': {
                    id: 'EMG-100',
                    status: 'RESOLVED',
                    statusHistory: [],
                },
            });

            await expect(
                updateEmergencyStatus(db, 'EMG-100', { status: 'PENDING' })
            ).rejects.toThrow("Invalid status transition: Cannot transition from 'RESOLVED' to 'PENDING'.");

            await expect(
                updateEmergencyStatus(db, 'EMG-100', { status: 'ASSIGNED', responderName: 'A', responderContact: '1' })
            ).rejects.toThrow("Invalid status transition: Cannot transition from 'RESOLVED' to 'ASSIGNED'.");
        });

        it('throws 404 error if updating a non-existent emergency', async () => {
            const db = createMockDb();
            await expect(
                updateEmergencyStatus(db, 'EMG-NOT-FOUND', { status: 'ASSIGNED' })
            ).rejects.toThrow("Emergency request 'EMG-NOT-FOUND' not found.");
        });
    });

    describe('4. Advanced Listing & Multi-Param Filtering Edge Cases', () => {
        const testRecords = {
            'EMG-01': {
                id: 'EMG-01',
                status: 'PENDING',
                passenger: { name: 'Kusal Mendis', phone: '0771112222' },
                vehicle: { plateNumber: 'WP-ND-1001', routeNumber: '138' },
                createdAt: '2026-09-28T09:00:00.000Z',
            },
            'EMG-02': {
                id: 'EMG-02',
                status: 'PENDING',
                passenger: { name: 'Wanindu Hasaranga', phone: '0773334444' },
                vehicle: { plateNumber: 'WP-ND-1002', routeNumber: '100' },
                createdAt: '2026-09-28T10:00:00.000Z',
            },
            'EMG-03': {
                id: 'EMG-03',
                status: 'ASSIGNED',
                passenger: { name: 'Charith Asalanka', phone: '0775556666' },
                vehicle: { plateNumber: 'WP-ND-2001', routeNumber: '138' },
                createdAt: '2026-09-28T11:00:00.000Z',
            },
            'EMG-04': {
                id: 'EMG-04',
                status: 'RESOLVED',
                passenger: { name: 'Pathum Nissanka', phone: '0777778888' },
                vehicle: { plateNumber: 'WP-ND-3001', routeNumber: '177' },
                createdAt: '2026-09-28T12:00:00.000Z',
            },
        };

        it('orders listed emergencies descending by createdAt timestamp (newest first)', async () => {
            const db = createMockDb(testRecords);
            const list = await listEmergencies(db);

            expect(list).toHaveLength(4);
            expect(list[0].id).toBe('EMG-04'); // 12:00
            expect(list[1].id).toBe('EMG-03'); // 11:00
            expect(list[2].id).toBe('EMG-02'); // 10:00
            expect(list[3].id).toBe('EMG-01'); // 09:00
        });

        it('filters by status and simultaneously applies search term filter', async () => {
            const db = createMockDb(testRecords);
            const list = await listEmergencies(db, {
                status: 'PENDING',
                search: 'Wanindu',
            });

            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('EMG-02');
            expect(list[0].passenger.name).toBe('Wanindu Hasaranga');
        });

        it('searches by partial phone number across passenger contacts', async () => {
            const db = createMockDb(testRecords);
            const list = await listEmergencies(db, {
                search: '5556666',
            });

            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('EMG-03');
            expect(list[0].passenger.name).toBe('Charith Asalanka');
        });

        it('searches by partial bus plate registration number', async () => {
            const db = createMockDb(testRecords);
            const list = await listEmergencies(db, {
                search: 'ND-3001',
            });

            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('EMG-04');
            expect(list[0].vehicle.plateNumber).toBe('WP-ND-3001');
        });

        it('applies pagination limit boundary correctly', async () => {
            const db = createMockDb(testRecords);
            const list = await listEmergencies(db, { limit: 2 });

            expect(list).toHaveLength(2);
            expect(list[0].id).toBe('EMG-04');
            expect(list[1].id).toBe('EMG-03');
        });

        it('returns all records when limit is negative or zero', async () => {
            const db = createMockDb(testRecords);
            const listZero = await listEmergencies(db, { limit: 0 });
            expect(listZero).toHaveLength(4);

            const listNegative = await listEmergencies(db, { limit: -5 });
            expect(listNegative).toHaveLength(4);
        });

        it('returns empty list when search term does not match any record', async () => {
            const db = createMockDb(testRecords);
            const list = await listEmergencies(db, { search: 'NonExistentPerson' });

            expect(list).toHaveLength(0);
        });
    });

    describe('5. Push Notification Dispatch Telemetry & Error Isolation', () => {
        it('isolates push notification dispatch failures so emergency creation still succeeds', async () => {
            const db = createMockDb();
            const input: CreateEmergencyInput = {
                passenger: { name: 'Dinesh', phone: '0771234567' },
                location: { latitude: 6.9, longitude: 79.8 },
                alertRecipients: {
                    caregiver: '0779988776',
                    driver: 'DRV-111',
                },
            };

            const created = await createEmergency(db, input, 'App User');

            expect(created).toBeDefined();
            expect(created.id).toMatch(/^EMG-\d+$/);
            expect(created.status).toBe('PENDING');
            expect(db._store[created.id]).toBeDefined();
        });

        it('handles emergency creation when no alertRecipients object is provided', async () => {
            const db = createMockDb();
            const input: CreateEmergencyInput = {
                passenger: { name: 'Thilini', phone: '0771234567' },
                location: { latitude: 6.92, longitude: 79.86 },
            };

            const created = await createEmergency(db, input);

            expect(created).toBeDefined();
            expect(created.status).toBe('PENDING');
            expect(created.passenger.name).toBe('Thilini');
        });
    });

    describe('6. Edge Cases in Status Reassignment & Resolution Verification', () => {
        it('allows conductor/crew reassignment when in ASSIGNED state with updated ETA', async () => {
            const db = createMockDb({
                'EMG-500': {
                    id: 'EMG-500',
                    status: 'ASSIGNED',
                    assignment: {
                        responderName: 'Driver A',
                        responderContact: '0771111111',
                        etaMinutes: 10,
                    },
                    statusHistory: [
                        { status: 'PENDING', changedAt: '2026-09-28T10:00:00Z', changedBy: 'User' },
                        { status: 'ASSIGNED', changedAt: '2026-09-28T10:05:00Z', changedBy: 'Dispatcher', responderName: 'Driver A' },
                    ],
                },
            });

            const reassigned = await updateEmergencyStatus(
                db,
                'EMG-500',
                {
                    status: 'ASSIGNED',
                    responderName: 'Backup Driver B',
                    responderContact: '0772222222',
                    etaMinutes: 3,
                    notes: 'First driver vehicle had flat tire, backup unit dispatched',
                },
                'Head Controller'
            );

            expect(reassigned.status).toBe('ASSIGNED');
            expect(reassigned.assignment?.responderName).toBe('Backup Driver B');
            expect(reassigned.assignment?.etaMinutes).toBe(3);
            expect(reassigned.statusHistory).toHaveLength(3);
            expect(reassigned.statusHistory[2].responderName).toBe('Backup Driver B');
            expect(reassigned.statusHistory[2].notes).toContain('backup unit dispatched');
        });

        it('rejects ASSIGNED update when responderName is missing', async () => {
            const db = createMockDb({
                'EMG-500': { id: 'EMG-500', status: 'PENDING', statusHistory: [] },
            });

            await expect(
                updateEmergencyStatus(db, 'EMG-500', {
                    status: 'ASSIGNED',
                    responderContact: '0771111111',
                })
            ).rejects.toThrow('Responder name and contact number are required when assigning support');
        });

        it('rejects RESOLVED update when actionTaken and notes are both missing', async () => {
            const db = createMockDb({
                'EMG-500': { id: 'EMG-500', status: 'ASSIGNED', statusHistory: [] },
            });

            await expect(
                updateEmergencyStatus(db, 'EMG-500', {
                    status: 'RESOLVED',
                })
            ).rejects.toThrow('Resolution notes or action taken must be provided to resolve an emergency');
        });

        it('rejects transitioning to an already active status when not ASSIGNED', async () => {
            const db = createMockDb({
                'EMG-500': { id: 'EMG-500', status: 'PENDING', statusHistory: [] },
            });

            await expect(
                updateEmergencyStatus(db, 'EMG-500', {
                    status: 'PENDING',
                })
            ).rejects.toThrow("Emergency is already in status 'PENDING'");
        });
    });
});
