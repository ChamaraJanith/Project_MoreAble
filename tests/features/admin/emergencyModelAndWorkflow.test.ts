import {
    EMERGENCY_ALLOWED_TRANSITIONS,
    EMERGENCY_PRIORITIES,
    EMERGENCY_STATUSES,
    EmergencyPriority,
    EmergencyRequest,
    EmergencyStatus,
    EmergencyStatusHistoryEntry,
    isEmergencyStatus,
    isValidEmergencyTransition,
    normalizeEmergencyStatus,
    CreateEmergencyInput,
    UpdateEmergencyStatusInput,
} from '../../../src/entities/emergency/model/types';

describe('MOV-236: Emergency Request Domain Models & Workflow Transitions', () => {
    describe('1. Emergency Status Vocabulary & Validation', () => {
        it('defines the three core acceptance criteria statuses: PENDING, ASSIGNED, RESOLVED', () => {
            expect(EMERGENCY_STATUSES).toEqual(['PENDING', 'ASSIGNED', 'RESOLVED']);
            expect(EMERGENCY_STATUSES).toHaveLength(3);
        });

        it('validates recognized status strings with isEmergencyStatus', () => {
            expect(isEmergencyStatus('PENDING')).toBe(true);
            expect(isEmergencyStatus('ASSIGNED')).toBe(true);
            expect(isEmergencyStatus('RESOLVED')).toBe(true);
            expect(isEmergencyStatus('pending')).toBe(true); // case-insensitive check
            expect(isEmergencyStatus('assigned')).toBe(true);
            expect(isEmergencyStatus('resolved')).toBe(true);
            expect(isEmergencyStatus('Pending')).toBe(true);
            expect(isEmergencyStatus('Assigned')).toBe(true);
            expect(isEmergencyStatus('Resolved')).toBe(true);
        });

        it('rejects invalid, unknown, or malformed statuses', () => {
            expect(isEmergencyStatus('INVALID')).toBe(false);
            expect(isEmergencyStatus('')).toBe(false);
            expect(isEmergencyStatus('   ')).toBe(false);
            expect(isEmergencyStatus(null)).toBe(false);
            expect(isEmergencyStatus(undefined)).toBe(false);
            expect(isEmergencyStatus(123)).toBe(false);
            expect(isEmergencyStatus(0)).toBe(false);
            expect(isEmergencyStatus(true)).toBe(false);
            expect(isEmergencyStatus({})).toBe(false);
            expect(isEmergencyStatus([])).toBe(false);
            expect(isEmergencyStatus('COMPLETED')).toBe(false);
            expect(isEmergencyStatus('CANCELLED')).toBe(false);
            expect(isEmergencyStatus('IN_PROGRESS')).toBe(false);
        });

        it('normalizes statuses to uppercase and trims extraneous whitespace', () => {
            expect(normalizeEmergencyStatus('pending')).toBe('PENDING');
            expect(normalizeEmergencyStatus('  pending  ')).toBe('PENDING');
            expect(normalizeEmergencyStatus('ASSIGNED')).toBe('ASSIGNED');
            expect(normalizeEmergencyStatus('  ASSIGNED  ')).toBe('ASSIGNED');
            expect(normalizeEmergencyStatus('resolved')).toBe('RESOLVED');
            expect(normalizeEmergencyStatus('  Resolved  ')).toBe('RESOLVED');
        });

        it('maps legacy SOS trigger status ACTIVE to PENDING', () => {
            expect(normalizeEmergencyStatus('ACTIVE')).toBe('PENDING');
            expect(normalizeEmergencyStatus('active')).toBe('PENDING');
            expect(normalizeEmergencyStatus('Active')).toBe('PENDING');
            expect(normalizeEmergencyStatus('  ACTIVE  ')).toBe('PENDING');
        });

        it('returns null when normalizing unparseable inputs', () => {
            expect(normalizeEmergencyStatus('UNKNOWN')).toBeNull();
            expect(normalizeEmergencyStatus('DECLINED')).toBeNull();
            expect(normalizeEmergencyStatus('')).toBeNull();
            expect(normalizeEmergencyStatus('   ')).toBeNull();
            expect(normalizeEmergencyStatus(null)).toBeNull();
            expect(normalizeEmergencyStatus(undefined)).toBeNull();
            expect(normalizeEmergencyStatus(100 as any)).toBeNull();
            expect(normalizeEmergencyStatus({} as any)).toBeNull();
        });

        it('defines standard emergency priority tiers', () => {
            expect(EMERGENCY_PRIORITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
            expect(EMERGENCY_PRIORITIES).toHaveLength(4);
            expect(EMERGENCY_PRIORITIES).toContain('CRITICAL');
            expect(EMERGENCY_PRIORITIES).toContain('HIGH');
            expect(EMERGENCY_PRIORITIES).toContain('MEDIUM');
            expect(EMERGENCY_PRIORITIES).toContain('LOW');
        });
    });

    describe('2. Strict Status Transition Rules (Pending -> Assigned -> Resolved)', () => {
        describe('From PENDING state', () => {
            it('allows transition from PENDING only to ASSIGNED', () => {
                expect(isValidEmergencyTransition('PENDING', 'ASSIGNED')).toBe(true);
            });

            it('rejects transitioning from PENDING to PENDING (no self-transition for pending)', () => {
                expect(isValidEmergencyTransition('PENDING', 'PENDING')).toBe(false);
            });

            it('rejects transitioning directly from PENDING to RESOLVED (cannot bypass assignment)', () => {
                expect(isValidEmergencyTransition('PENDING', 'RESOLVED')).toBe(false);
            });

            it('rejects transitioning from PENDING to arbitrary status strings', () => {
                expect(isValidEmergencyTransition('PENDING', 'CANCELLED' as any)).toBe(false);
                expect(isValidEmergencyTransition('PENDING', 'CLOSED' as any)).toBe(false);
            });
        });

        describe('From ASSIGNED state', () => {
            it('allows transition from ASSIGNED to RESOLVED upon incident closure', () => {
                expect(isValidEmergencyTransition('ASSIGNED', 'RESOLVED')).toBe(true);
            });

            it('allows self-transition on ASSIGNED for updating assigned responder, crew, or ETA', () => {
                expect(isValidEmergencyTransition('ASSIGNED', 'ASSIGNED')).toBe(true);
            });

            it('rejects reverting back from ASSIGNED to PENDING', () => {
                expect(isValidEmergencyTransition('ASSIGNED', 'PENDING')).toBe(false);
            });

            it('rejects transitioning from ASSIGNED to arbitrary status', () => {
                expect(isValidEmergencyTransition('ASSIGNED', 'DRAFT' as any)).toBe(false);
            });
        });

        describe('From RESOLVED state (Terminal State)', () => {
            it('marks RESOLVED as a terminal state with empty allowed transitions array', () => {
                expect(EMERGENCY_ALLOWED_TRANSITIONS.RESOLVED).toEqual([]);
                expect(EMERGENCY_ALLOWED_TRANSITIONS.RESOLVED).toHaveLength(0);
            });

            it('rejects transitioning from RESOLVED back to PENDING', () => {
                expect(isValidEmergencyTransition('RESOLVED', 'PENDING')).toBe(false);
            });

            it('rejects transitioning from RESOLVED back to ASSIGNED', () => {
                expect(isValidEmergencyTransition('RESOLVED', 'ASSIGNED')).toBe(false);
            });

            it('rejects self-transition on RESOLVED', () => {
                expect(isValidEmergencyTransition('RESOLVED', 'RESOLVED')).toBe(false);
            });
        });

        describe('Complete State Transition Matrix Completeness', () => {
            const allStatuses: EmergencyStatus[] = ['PENDING', 'ASSIGNED', 'RESOLVED'];

            it('evaluates all 9 combinations in the transition matrix predictably', () => {
                const matrix: Record<EmergencyStatus, Record<EmergencyStatus, boolean>> = {
                    PENDING: {
                        PENDING: false,
                        ASSIGNED: true,
                        RESOLVED: false,
                    },
                    ASSIGNED: {
                        PENDING: false,
                        ASSIGNED: true,
                        RESOLVED: true,
                    },
                    RESOLVED: {
                        PENDING: false,
                        ASSIGNED: false,
                        RESOLVED: false,
                    },
                };

                for (const current of allStatuses) {
                    for (const target of allStatuses) {
                        const expected = matrix[current][target];
                        const actual = isValidEmergencyTransition(current, target);
                        expect(actual).toBe(expected);
                    }
                }
            });
        });
    });

    describe('3. Edge Cases & Boundary Handling in Transition Engine', () => {
        it('returns false when current status is unknown or invalid', () => {
            expect(isValidEmergencyTransition('UNKNOWN' as EmergencyStatus, 'ASSIGNED')).toBe(false);
            expect(isValidEmergencyTransition('' as EmergencyStatus, 'ASSIGNED')).toBe(false);
            expect(isValidEmergencyTransition(null as any, 'ASSIGNED')).toBe(false);
            expect(isValidEmergencyTransition(undefined as any, 'ASSIGNED')).toBe(false);
        });

        it('returns false when target status is unknown or invalid', () => {
            expect(isValidEmergencyTransition('PENDING', 'UNKNOWN' as EmergencyStatus)).toBe(false);
            expect(isValidEmergencyTransition('PENDING', '' as EmergencyStatus)).toBe(false);
            expect(isValidEmergencyTransition('PENDING', null as any)).toBe(false);
            expect(isValidEmergencyTransition('PENDING', undefined as any)).toBe(false);
        });

        it('returns false when both current and target statuses are invalid', () => {
            expect(isValidEmergencyTransition('FOO' as any, 'BAR' as any)).toBe(false);
        });

        it('maintains integrity of EMERGENCY_ALLOWED_TRANSITIONS constant', () => {
            expect(Object.keys(EMERGENCY_ALLOWED_TRANSITIONS).sort()).toEqual(
                ['ASSIGNED', 'PENDING', 'RESOLVED'].sort()
            );

            expect(EMERGENCY_ALLOWED_TRANSITIONS.PENDING).toContain('ASSIGNED');
            expect(EMERGENCY_ALLOWED_TRANSITIONS.ASSIGNED).toContain('RESOLVED');
            expect(EMERGENCY_ALLOWED_TRANSITIONS.ASSIGNED).toContain('ASSIGNED');
        });
    });

    describe('4. Emergency Data Model Contract & Type Shape Validation', () => {
        it('constructs a valid EmergencyRequest object conforming to contract', () => {
            const emergency: EmergencyRequest = {
                id: 'EMG-88771',
                bookingId: 'BKG-112233',
                passenger: {
                    id: 'PAS-009',
                    name: 'Kavindu Perera',
                    phone: '0712345678',
                    email: 'kavindu@test.lk',
                    specialAssistance: 'Low Vision Commuter',
                },
                vehicle: {
                    plateNumber: 'WP-ND-5544',
                    model: 'Ashok Leyland Viking',
                    routeNumber: '100',
                    driverId: 'DRV-441',
                    driverName: 'Rathnayake',
                },
                location: {
                    latitude: 6.9147,
                    longitude: 79.8732,
                    address: 'Galle Road, Colombo 03',
                    stopName: 'Bambalapitiya Junction',
                    landmark: 'Opposite Majestic City',
                },
                status: 'PENDING',
                priority: 'CRITICAL',
                alertRecipients: {
                    caregiver: '0778899001',
                    driver: 'DRV-441',
                    admin: 'ADMIN_TOPIC',
                },
                statusHistory: [
                    {
                        status: 'PENDING',
                        changedAt: '2026-09-28T10:00:00.000Z',
                        changedBy: 'Kavindu Perera (Commuter)',
                        notes: 'Distress signal received from passenger mobile device',
                    },
                ],
                createdAt: '2026-09-28T10:00:00.000Z',
                updatedAt: '2026-09-28T10:00:00.000Z',
            };

            expect(emergency.id).toMatch(/^EMG-\d+$/);
            expect(emergency.passenger.name).toBe('Kavindu Perera');
            expect(emergency.passenger.specialAssistance).toBe('Low Vision Commuter');
            expect(emergency.vehicle?.plateNumber).toBe('WP-ND-5544');
            expect(emergency.vehicle?.routeNumber).toBe('100');
            expect(emergency.location.latitude).toBeCloseTo(6.9147);
            expect(emergency.location.longitude).toBeCloseTo(79.8732);
            expect(emergency.status).toBe('PENDING');
            expect(emergency.priority).toBe('CRITICAL');
            expect(emergency.statusHistory).toHaveLength(1);
        });

        it('supports optional assignment block when status transitions to ASSIGNED', () => {
            const historyEntry: EmergencyStatusHistoryEntry = {
                status: 'ASSIGNED',
                changedAt: '2026-09-28T10:05:00.000Z',
                changedBy: 'Dispatcher Sahan',
                notes: 'Bus crew notified to make emergency halt and provide first aid',
                responderName: 'Driver Rathnayake',
                responderContact: '0772233445',
                etaMinutes: 4,
            };

            expect(historyEntry.responderName).toBe('Driver Rathnayake');
            expect(historyEntry.responderContact).toBe('0772233445');
            expect(historyEntry.etaMinutes).toBe(4);
            expect(historyEntry.status).toBe('ASSIGNED');
        });

        it('supports optional resolution block when status transitions to RESOLVED', () => {
            const historyEntry: EmergencyStatusHistoryEntry = {
                status: 'RESOLVED',
                changedAt: '2026-09-28T10:25:00.000Z',
                changedBy: 'Dispatcher Sahan',
                notes: 'Passenger examined and assisted safely off the vehicle',
                actionTaken: 'First aid kit administered. Commuter handed over to relative at station.',
            };

            expect(historyEntry.actionTaken).toContain('First aid kit administered');
            expect(historyEntry.status).toBe('RESOLVED');
        });

        it('validates minimal CreateEmergencyInput data requirements', () => {
            const minimalInput: CreateEmergencyInput = {
                passenger: {
                    name: 'Amara',
                    phone: '0770000000',
                },
                location: {
                    latitude: 6.9,
                    longitude: 79.8,
                },
            };

            expect(minimalInput.passenger.name).toBeTruthy();
            expect(minimalInput.passenger.phone).toBeTruthy();
            expect(typeof minimalInput.location.latitude).toBe('number');
            expect(typeof minimalInput.location.longitude).toBe('number');
        });

        it('validates full UpdateEmergencyStatusInput for Assignment', () => {
            const assignmentInput: UpdateEmergencyStatusInput = {
                status: 'ASSIGNED',
                responderName: 'Paramedic Team 1',
                responderContact: '0112223344',
                etaMinutes: 10,
                notes: 'Dispatched closest mobile support unit',
            };

            expect(assignmentInput.status).toBe('ASSIGNED');
            expect(assignmentInput.responderName).toBe('Paramedic Team 1');
            expect(assignmentInput.responderContact).toBe('0112223344');
            expect(assignmentInput.etaMinutes).toBe(10);
        });

        it('validates full UpdateEmergencyStatusInput for Resolution', () => {
            const resolutionInput: UpdateEmergencyStatusInput = {
                status: 'RESOLVED',
                actionTaken: 'Passenger received assistance. Normal operations resumed.',
                notes: 'All clear confirmed by vehicle driver.',
            };

            expect(resolutionInput.status).toBe('RESOLVED');
            expect(resolutionInput.actionTaken).toBeTruthy();
        });
    });

    describe('5. Audit Trail History Integrity Tests', () => {
        it('tracks sequential timeline of history entries across full lifecycle', () => {
            const history: EmergencyStatusHistoryEntry[] = [];

            // Step 1: Commuter triggers SOS
            history.push({
                status: 'PENDING',
                changedAt: '2026-09-28T10:00:00.000Z',
                changedBy: 'Commuter App',
                notes: 'SOS triggered near Colombo Fort',
            });

            // Step 2: Admin assigns bus conductor
            history.push({
                status: 'ASSIGNED',
                changedAt: '2026-09-28T10:04:00.000Z',
                changedBy: 'Dispatcher',
                notes: 'Assigned conductor Bandara',
                responderName: 'Conductor Bandara',
                responderContact: '0779900112',
                etaMinutes: 5,
            });

            // Step 3: Conductor updates ETA
            history.push({
                status: 'ASSIGNED',
                changedAt: '2026-09-28T10:08:00.000Z',
                changedBy: 'Dispatcher',
                notes: 'Updated ETA due to junction traffic',
                responderName: 'Conductor Bandara',
                responderContact: '0779900112',
                etaMinutes: 2,
            });

            // Step 4: Incident resolved
            history.push({
                status: 'RESOLVED',
                changedAt: '2026-09-28T10:20:00.000Z',
                changedBy: 'Dispatcher',
                notes: 'Passenger assisted safely',
                actionTaken: 'Passenger guided to wheelchair exit ramp',
            });

            expect(history).toHaveLength(4);
            expect(history[0].status).toBe('PENDING');
            expect(history[1].status).toBe('ASSIGNED');
            expect(history[2].status).toBe('ASSIGNED');
            expect(history[3].status).toBe('RESOLVED');

            // Verify chronological order
            for (let i = 1; i < history.length; i++) {
                const prevTime = new Date(history[i - 1].changedAt).getTime();
                const currTime = new Date(history[i].changedAt).getTime();
                expect(currTime).toBeGreaterThanOrEqual(prevTime);
            }
        });

        it('preserves immutable history entries without losing earlier attributes', () => {
            const initialEntry: EmergencyStatusHistoryEntry = {
                status: 'PENDING',
                changedAt: '2026-09-28T10:00:00.000Z',
                changedBy: 'Passenger SOS',
                notes: 'Initial beacon alert',
            };

            const secondEntry: EmergencyStatusHistoryEntry = {
                status: 'ASSIGNED',
                changedAt: '2026-09-28T10:03:00.000Z',
                changedBy: 'Operator 2',
                responderName: 'Driver',
                responderContact: '0771122334',
                etaMinutes: 3,
            };

            const statusHistory = [initialEntry, secondEntry];
            expect(statusHistory[0].changedBy).toBe('Passenger SOS');
            expect(statusHistory[1].responderName).toBe('Driver');
            expect(statusHistory[0].responderName).toBeUndefined();
        });
    });

    describe('6. JSON Serialization & Deserialization Safety', () => {
        it('serializes and deserializes an EmergencyRequest without data distortion', () => {
            const originalRecord: EmergencyRequest = {
                id: 'EMG-90210',
                bookingId: 'BKG-556677',
                passenger: {
                    id: 'PAS-100',
                    name: 'Malkanthi Fernando',
                    phone: '0778899112',
                    email: 'malkanthi@gmail.com',
                    specialAssistance: 'Wheelchair Commuter',
                },
                vehicle: {
                    plateNumber: 'WP-ND-9988',
                    model: 'Coaster AC Bus',
                    routeNumber: '177',
                    driverId: 'DRV-001',
                    driverName: 'Sirisena',
                },
                location: {
                    latitude: 6.9034,
                    longitude: 79.8553,
                    address: 'Kollupitiya Supermarket Stop',
                    stopName: 'Kollupitiya',
                },
                status: 'ASSIGNED',
                priority: 'CRITICAL',
                assignment: {
                    responderName: 'Driver Sirisena',
                    responderContact: '0771234567',
                    etaMinutes: 2,
                    assignedAt: '2026-09-28T11:00:00.000Z',
                    assignedBy: 'Head Dispatcher',
                    notes: 'Bus pulled to curb, assistance ramp lowering',
                },
                statusHistory: [
                    {
                        status: 'PENDING',
                        changedAt: '2026-09-28T10:58:00.000Z',
                        changedBy: 'Malkanthi Fernando',
                        notes: 'Ramp requested on exit',
                    },
                    {
                        status: 'ASSIGNED',
                        changedAt: '2026-09-28T11:00:00.000Z',
                        changedBy: 'Head Dispatcher',
                        notes: 'Bus pulled to curb, assistance ramp lowering',
                        responderName: 'Driver Sirisena',
                        responderContact: '0771234567',
                        etaMinutes: 2,
                    },
                ],
                createdAt: '2026-09-28T10:58:00.000Z',
                updatedAt: '2026-09-28T11:00:00.000Z',
            };

            const jsonString = JSON.stringify(originalRecord);
            const parsed = JSON.parse(jsonString) as EmergencyRequest;

            expect(parsed).toEqual(originalRecord);
            expect(parsed.id).toBe('EMG-90210');
            expect(parsed.passenger.name).toBe('Malkanthi Fernando');
            expect(parsed.assignment?.responderName).toBe('Driver Sirisena');
            expect(parsed.statusHistory).toHaveLength(2);
        });

        it('handles optional fields gracefully during serialization', () => {
            const sparseRecord: EmergencyRequest = {
                id: 'EMG-SPARSE',
                passenger: {
                    id: 'PAS-SPARSE',
                    name: 'Test Passenger',
                    phone: '0771234567',
                },
                vehicle: {
                    plateNumber: 'WP-UNKNOWN',
                    model: 'Transit Bus',
                },
                location: {
                    latitude: 6.9,
                    longitude: 79.8,
                },
                status: 'PENDING',
                priority: 'CRITICAL',
                statusHistory: [],
                createdAt: '2026-09-28T12:00:00.000Z',
                updatedAt: '2026-09-28T12:00:00.000Z',
            };

            const parsed = JSON.parse(JSON.stringify(sparseRecord));
            expect(parsed.bookingId).toBeUndefined();
            expect(parsed.vehicle.driverId).toBeUndefined();
            expect(parsed.assignment).toBeUndefined();
            expect(parsed.resolution).toBeUndefined();
            expect(parsed.alertRecipients).toBeUndefined();
        });
    });
});
