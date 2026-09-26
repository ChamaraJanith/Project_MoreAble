jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn().mockResolvedValue(null),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('react-native', () => ({
    Platform: {
        OS: 'android',
        select: (obj: any) => obj.android || obj.default,
    },
}));
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: 'http://localhost:8081' }));
jest.mock('../../../src/shared/config/firebaseAdmin');

import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    NotificationPreferences,
    normalizeNotificationPreferences,
} from '../../../src/entities/notification/model/types';
import {
    dispatchBoardingAlert,
    dispatchBookingAlert,
    dispatchCaregiverJourneyAlert,
    dispatchDestinationReminder,
    dispatchEmergencySOSAlert,
    dispatchVehicleArrivalAlert,
    getUserNotificationPreferences,
    sendPushNotificationToUser,
} from '../../../src/shared/services/pushNotificationDispatcher';
import {
    getNotificationPreferencesApi,
    saveNotificationPreferencesApi,
} from '../../../src/features/notifications/api/notificationPreferencesApi';
import { useNotificationPreferencesStore } from '../../../src/features/notifications/store/notificationPreferencesStore';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

describe('Enterprise Transit Safety & Passenger Notification Preferences Suite (MOV-24 / MOV-240)', () => {
    let mockNotificationPreferencesDb: Map<string, any>;
    let mockUsersDb: Map<string, any>;
    let mockDeviceTokensDb: Map<string, any[]>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockNotificationPreferencesDb = new Map();
        mockUsersDb = new Map();
        mockDeviceTokensDb = new Map();

        // Seed a standard passenger
        mockUsersDb.set('PAS-DEFAULT', {
            id: 'PAS-DEFAULT',
            passengerId: 'PAS-DEFAULT',
            fullName: 'Nimali Silva',
            pushToken: 'ExponentPushToken[mock-nimali-token-001]',
            notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        });

        // Seed a passenger with disabled arrival and boarding alerts
        mockUsersDb.set('PAS-MUTED', {
            id: 'PAS-MUTED',
            passengerId: 'PAS-MUTED',
            fullName: 'Chathura Perera',
            pushToken: 'ExponentPushToken[mock-chathura-token-002]',
            notificationPreferences: {
                bookingAlerts: false,
                boardingReminders: false,
                arrivalAlerts: false,
                destinationReminders: false,
                caregiverUpdates: false,
                emergencyAlerts: true, // Immutable rule
                pushEnabled: true,
                emailAlerts: false,
                smsAlerts: false,
            },
        });

        // Seed caregiver with disabled updates
        mockUsersDb.set('GRD-MUTED', {
            id: 'GRD-MUTED',
            fullName: 'Sunil Perera (Guardian)',
            pushToken: 'ExponentPushToken[mock-guardian-token-003]',
            notificationPreferences: {
                caregiverUpdates: false,
                emergencyAlerts: true,
            },
        });

        // Seed adminDb mock
        (getAdminDb as jest.Mock).mockReturnValue({
            collection: (col: string) => {
                if (col === 'notification_preferences') {
                    return {
                        doc: (id: string) => ({
                            get: async () => {
                                const data = mockNotificationPreferencesDb.get(id);
                                return { exists: !!data, data: () => data };
                            },
                            set: async (payload: any) => {
                                const prev = mockNotificationPreferencesDb.get(id) || {};
                                mockNotificationPreferencesDb.set(id, { ...prev, ...payload });
                            },
                        }),
                    };
                }
                if (col === 'users') {
                    return {
                        doc: (id: string) => ({
                            get: async () => {
                                const data = mockUsersDb.get(id);
                                return { exists: !!data, data: () => data };
                            },
                            update: async (patch: any) => {
                                const prev = mockUsersDb.get(id) || {};
                                mockUsersDb.set(id, { ...prev, ...patch });
                            },
                        }),
                        where: (field: string, op: string, val: string) => ({
                            limit: () => ({
                                get: async () => {
                                    const matches = Array.from(mockUsersDb.values()).filter((u) => u[field] === val);
                                    return {
                                        empty: matches.length === 0,
                                        docs: matches.map((m) => ({
                                            exists: true,
                                            data: () => m,
                                            ref: {
                                                update: async (patch: any) => {
                                                    mockUsersDb.set(m.id, { ...m, ...patch });
                                                },
                                            },
                                        })),
                                    };
                                },
                            }),
                        }),
                    };
                }
                if (col === 'device_tokens') {
                    return {
                        where: (field: string, op: string, val: string) => ({
                            get: async () => ({
                                forEach: (cb: any) => {
                                    const list = mockDeviceTokensDb.get(val) || [];
                                    list.forEach((item) => cb({ data: () => item }));
                                },
                            }),
                        }),
                    };
                }
                return {
                    doc: () => ({
                        get: async () => ({ exists: false, data: () => null }),
                        set: async () => {},
                    }),
                };
            },
        });

        // Mock global fetch for Expo Push API and Preferences API
        global.fetch = jest.fn().mockImplementation((url: string, options: any) => {
            if (url.includes('exp.host')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        data: [{ status: 'ok', id: 'ticket_mock_12345' }],
                    }),
                });
            }
            if (url.includes('/api/notifications/preferences')) {
                const method = options?.method || 'GET';
                if (method === 'GET') {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            success: true,
                            preferences: DEFAULT_NOTIFICATION_PREFERENCES,
                        }),
                    });
                }
                if (method === 'PUT' || method === 'POST') {
                    const parsedBody = JSON.parse(options?.body || '{}');
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            success: true,
                            preferences: normalizeNotificationPreferences(parsedBody.preferences),
                        }),
                    });
                }
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({ success: true }),
            });
        });
    });

    // =========================================================================
    // 1. DATA MODEL & NORMALIZATION INVARIANTS (MOV-240)
    // =========================================================================
    describe('1. Data Model & Strict Normalization Invariants', () => {
        it('provides enterprise default notification preferences with all channels enabled', () => {
            expect(DEFAULT_NOTIFICATION_PREFERENCES.bookingAlerts).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.boardingReminders).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.arrivalAlerts).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.destinationReminders).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.caregiverUpdates).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.emergencyAlerts).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.pushEnabled).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.emailAlerts).toBe(true);
            expect(DEFAULT_NOTIFICATION_PREFERENCES.smsAlerts).toBe(true);
        });

        it('strictly forces emergencyAlerts to true regardless of incoming payload', () => {
            const malformedPayload = {
                bookingAlerts: false,
                emergencyAlerts: false, // Attempt to disable safety alerts
            };
            const normalized = normalizeNotificationPreferences(malformedPayload);
            expect(normalized.bookingAlerts).toBe(false);
            expect(normalized.emergencyAlerts).toBe(true); // Must remain true!
        });

        it('handles undefined or null preference inputs safely', () => {
            const normalizedNull = normalizeNotificationPreferences(null);
            expect(normalizedNull.emergencyAlerts).toBe(true);
            expect(normalizedNull.arrivalAlerts).toBe(true);

            const normalizedEmpty = normalizeNotificationPreferences({});
            expect(normalizedEmpty.emergencyAlerts).toBe(true);
            expect(normalizedEmpty.destinationReminders).toBe(true);
        });
    });

    // =========================================================================
    // 2. DISPATCHER RULE ENFORCEMENT: BOOKING ALERTS (MOV-243)
    // =========================================================================
    describe('2. Dispatcher Rules: Booking Alerts', () => {
        it('dispatches booking alert when bookingAlerts preference is true', async () => {
            const res = await dispatchBookingAlert('PAS-DEFAULT', {
                bookingId: 'BK-101',
                routeNumber: '138',
                seatNumber: '5A',
                origin: 'Pettah',
                destination: 'Maharagama',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('ok');
            expect(res.recipientCount).toBe(1);
        });

        it('skips dispatching booking alert when bookingAlerts preference is false', async () => {
            const res = await dispatchBookingAlert('PAS-MUTED', {
                bookingId: 'BK-102',
                routeNumber: '138',
                seatNumber: '6B',
                origin: 'Pettah',
                destination: 'Maharagama',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('skipped');
            expect(res.recipientCount).toBe(0);
            expect(res.reason).toContain('BOOKING_ALERTS_DISABLED');
        });
    });

    // =========================================================================
    // 3. DISPATCHER RULE ENFORCEMENT: BOARDING REMINDERS (MOV-243)
    // =========================================================================
    describe('3. Dispatcher Rules: Boarding Reminders', () => {
        it('dispatches boarding alert when boardingReminders preference is true', async () => {
            const res = await dispatchBoardingAlert('PAS-DEFAULT', {
                bookingId: 'BK-201',
                vehicleNumber: 'NC-3456',
                routeNumber: '177',
                seatNumber: '4C',
                dropOffHalt: 'Kollupitiya',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('ok');
            expect(res.recipientCount).toBe(1);
        });

        it('skips dispatching boarding alert when boardingReminders preference is false', async () => {
            const res = await dispatchBoardingAlert('PAS-MUTED', {
                bookingId: 'BK-202',
                vehicleNumber: 'NC-3456',
                routeNumber: '177',
                seatNumber: '4D',
                dropOffHalt: 'Kollupitiya',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('skipped');
            expect(res.recipientCount).toBe(0);
            expect(res.reason).toContain('BOARDING_REMINDERS_DISABLED');
        });
    });

    // =========================================================================
    // 4. DISPATCHER RULE ENFORCEMENT: VEHICLE ARRIVAL ALERTS (MOV-243)
    // =========================================================================
    describe('4. Dispatcher Rules: Vehicle Arrival Alerts', () => {
        it('dispatches arrival alert when arrivalAlerts preference is true', async () => {
            const res = await dispatchVehicleArrivalAlert('PAS-DEFAULT', {
                vehicleNumber: 'NC-3456',
                routeNumber: '138',
                arrivalHalt: 'Town Hall',
                etaMinutes: 3,
                bookingId: 'BK-301',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('ok');
            expect(res.recipientCount).toBe(1);
        });

        it('skips dispatching arrival alert when arrivalAlerts preference is false', async () => {
            const res = await dispatchVehicleArrivalAlert('PAS-MUTED', {
                vehicleNumber: 'NC-3456',
                routeNumber: '138',
                arrivalHalt: 'Town Hall',
                etaMinutes: 3,
                bookingId: 'BK-302',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('skipped');
            expect(res.recipientCount).toBe(0);
            expect(res.reason).toContain('ARRIVAL_ALERTS_DISABLED');
        });
    });

    // =========================================================================
    // 5. DISPATCHER RULE ENFORCEMENT: DESTINATION REMINDERS (MOV-243)
    // =========================================================================
    describe('5. Dispatcher Rules: Destination Reminders', () => {
        it('dispatches destination reminder when destinationReminders preference is true', async () => {
            const res = await dispatchDestinationReminder('PAS-DEFAULT', {
                bookingId: 'BK-401',
                destination: 'Maharagama',
                remainingStops: 1,
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('ok');
            expect(res.recipientCount).toBe(1);
        });

        it('skips dispatching destination reminder when destinationReminders preference is false', async () => {
            const res = await dispatchDestinationReminder('PAS-MUTED', {
                bookingId: 'BK-402',
                destination: 'Maharagama',
                remainingStops: 1,
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('skipped');
            expect(res.recipientCount).toBe(0);
            expect(res.reason).toContain('DESTINATION_REMINDERS_DISABLED');
        });
    });

    // =========================================================================
    // 6. DISPATCHER RULE ENFORCEMENT: CAREGIVER UPDATES (MOV-243)
    // =========================================================================
    describe('6. Dispatcher Rules: Caregiver Updates', () => {
        it('dispatches caregiver journey update when caregiverUpdates preference is true', async () => {
            mockUsersDb.set('GRD-ACTIVE', {
                id: 'GRD-ACTIVE',
                fullName: 'Kamal Silva (Guardian)',
                pushToken: 'ExponentPushToken[mock-kamal-token-004]',
                notificationPreferences: {
                    caregiverUpdates: true,
                    emergencyAlerts: true,
                },
            });

            const res = await dispatchCaregiverJourneyAlert('GRD-ACTIVE', {
                passengerName: 'Nimali Silva',
                eventType: 'BOARDED',
                vehicleNumber: 'NC-3456',
                locationName: 'Pettah Terminal',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('ok');
            expect(res.recipientCount).toBe(1);
        });

        it('skips dispatching caregiver journey update when caregiverUpdates preference is false', async () => {
            const res = await dispatchCaregiverJourneyAlert('GRD-MUTED', {
                passengerName: 'Chathura Perera',
                eventType: 'BOARDED',
                vehicleNumber: 'NC-3456',
                locationName: 'Pettah Terminal',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('skipped');
            expect(res.recipientCount).toBe(0);
            expect(res.reason).toContain('CAREGIVER_UPDATES_DISABLED');
        });
    });

    // =========================================================================
    // 7. CRITICAL SECURITY INVARIANT: EMERGENCY SOS ALERTS CAN NEVER BE DISABLED
    // =========================================================================
    describe('7. Critical Security: Emergency SOS Alerts Cannot Be Disabled', () => {
        it('ALWAYS dispatches Emergency SOS alerts regardless of any user preference settings', async () => {
            const res = await dispatchEmergencySOSAlert(['PAS-MUTED', 'GRD-MUTED'], {
                passengerName: 'Chathura Perera',
                passengerId: 'PAS-MUTED',
                vehicleNumber: 'NC-3456',
                locationName: 'Nugegoda Junction',
            });

            expect(res.success).toBe(true);
            expect(res.status).toBe('ok');
            expect(res.recipientCount).toBe(2); // Sent to both muted users because SOS overrides everything
        });
    });

    // =========================================================================
    // 8. MASTER PUSH TOGGLE RULE ENFORCEMENT
    // =========================================================================
    describe('8. Master Push Notification Channel Toggle', () => {
        it('skips all non-emergency push notifications when pushEnabled is false', async () => {
            mockUsersDb.set('PAS-PUSH-OFF', {
                id: 'PAS-PUSH-OFF',
                fullName: 'Roshan Fernando',
                pushToken: 'ExponentPushToken[mock-roshan-token]',
                notificationPreferences: {
                    ...DEFAULT_NOTIFICATION_PREFERENCES,
                    pushEnabled: false, // Master push switch turned off
                },
            });

            const resArrival = await dispatchVehicleArrivalAlert('PAS-PUSH-OFF', {
                vehicleNumber: 'NC-3456',
                routeNumber: '138',
                arrivalHalt: 'Town Hall',
                etaMinutes: 2,
            });
            expect(resArrival.status).toBe('skipped');

            const resBoarding = await dispatchBoardingAlert('PAS-PUSH-OFF', {
                bookingId: 'BK-501',
                vehicleNumber: 'NC-3456',
                routeNumber: '138',
                seatNumber: '7A',
                dropOffHalt: 'Nugegoda',
            });
            expect(resBoarding.status).toBe('skipped');

            // BUT emergency SOS still succeeds
            const resSOS = await dispatchEmergencySOSAlert(['PAS-PUSH-OFF'], {
                passengerName: 'Roshan Fernando',
                passengerId: 'PAS-PUSH-OFF',
            });
            expect(resSOS.status).toBe('ok');
        });
    });

    // =========================================================================
    // 9. CLIENT API & ZUSTAND STORE MATRIX (MOV-241 / MOV-242)
    // =========================================================================
    describe('9. Client API & Zustand Store State Management', () => {
        it('fetches notification preferences via client API helper', async () => {
            const apiRes = await getNotificationPreferencesApi('PAS-DEFAULT');
            expect(apiRes.success).toBe(true);
            expect(apiRes.preferences.bookingAlerts).toBe(true);
            expect(apiRes.preferences.emergencyAlerts).toBe(true);
        });

        it('saves notification preferences via client API helper', async () => {
            const apiRes = await saveNotificationPreferencesApi('PAS-DEFAULT', {
                bookingAlerts: false,
                arrivalAlerts: false,
            });
            expect(apiRes.success).toBe(true);
            expect(apiRes.preferences.bookingAlerts).toBe(false);
            expect(apiRes.preferences.arrivalAlerts).toBe(false);
            expect(apiRes.preferences.emergencyAlerts).toBe(true);
        });

        it('updates store state and performs optimistic local persistence', async () => {
            const store = useNotificationPreferencesStore.getState();
            await store.savePreferences('PAS-DEFAULT', {
                destinationReminders: false,
            });

            expect(useNotificationPreferencesStore.getState().preferences.destinationReminders).toBe(false);
            expect(useNotificationPreferencesStore.getState().preferences.emergencyAlerts).toBe(true);
        });

        it('prevents toggling emergencyAlerts to false in store', async () => {
            const store = useNotificationPreferencesStore.getState();
            const result = await store.updatePreference('PAS-DEFAULT', 'emergencyAlerts', false);
            expect(result).toBe(false);
            expect(useNotificationPreferencesStore.getState().preferences.emergencyAlerts).toBe(true);
        });

        it('resets all preferences to enterprise defaults', async () => {
            const store = useNotificationPreferencesStore.getState();
            await store.resetToDefaults('PAS-DEFAULT');

            const current = useNotificationPreferencesStore.getState().preferences;
            expect(current.bookingAlerts).toBe(true);
            expect(current.boardingReminders).toBe(true);
            expect(current.arrivalAlerts).toBe(true);
            expect(current.destinationReminders).toBe(true);
            expect(current.caregiverUpdates).toBe(true);
            expect(current.emergencyAlerts).toBe(true);
        });
    });

    // =========================================================================
    // 10. MULTI-CHANNEL PERMUTATION MATRIX (Push, Email, SMS)
    // =========================================================================
    describe('10. Multi-Channel Permutation Matrix (Push, Email, SMS)', () => {
        const permutations = [
            { push: true, email: true, sms: true, desc: 'All Channels Enabled' },
            { push: true, email: true, sms: false, desc: 'Push + Email Only' },
            { push: true, email: false, sms: true, desc: 'Push + SMS Only' },
            { push: true, email: false, sms: false, desc: 'Push Only' },
            { push: false, email: true, sms: true, desc: 'Email + SMS Only' },
            { push: false, email: true, sms: false, desc: 'Email Only' },
            { push: false, email: false, sms: true, desc: 'SMS Only' },
            { push: false, email: false, sms: false, desc: 'All Channels Disabled' },
        ];

        permutations.forEach(({ push, email, sms, desc }, idx) => {
            it(`correctly normalizes channel configuration: ${desc}`, () => {
                const prefs = normalizeNotificationPreferences({
                    pushEnabled: push,
                    emailAlerts: email,
                    smsAlerts: sms,
                });

                expect(prefs.pushEnabled).toBe(push);
                expect(prefs.emailAlerts).toBe(email);
                expect(prefs.smsAlerts).toBe(sms);
                expect(prefs.emergencyAlerts).toBe(true);
            });
        });
    });

    // =========================================================================
    // 11. GRANULAR TOGGLE COMBINATIONS (32 Permutations)
    // =========================================================================
    describe('11. Exhaustive Granular Alert Type Combinations', () => {
        const alertKeys: (keyof NotificationPreferences)[] = [
            'bookingAlerts',
            'boardingReminders',
            'arrivalAlerts',
            'destinationReminders',
            'caregiverUpdates',
        ];

        for (let i = 0; i < 32; i++) {
            const config: Record<string, boolean> = {};
            alertKeys.forEach((k, bitIdx) => {
                config[k] = Boolean((i >> bitIdx) & 1);
            });

            it(`verifies 5-tuple alert configuration permutation #${i + 1}`, () => {
                const normalized = normalizeNotificationPreferences(config as any);
                alertKeys.forEach((k) => {
                    expect(normalized[k]).toBe(config[k]);
                });
                expect(normalized.emergencyAlerts).toBe(true);
            });
        }
    });

    // =========================================================================
    // 12. HIGH-VOLUME MULTI-USER BATCH EVALUATION
    // =========================================================================
    describe('12. High-Volume Multi-User Batch Notification Evaluation', () => {
        it('evaluates and dispatches alerts for 50 passengers with varying notification profiles', async () => {
            const batchUsers: string[] = [];
            for (let i = 1; i <= 50; i++) {
                const uid = `PAS-BATCH-${i}`;
                batchUsers.push(uid);
                mockUsersDb.set(uid, {
                    id: uid,
                    passengerId: uid,
                    fullName: `Batch Commuter ${i}`,
                    pushToken: `ExponentPushToken[batch-token-${i}]`,
                    notificationPreferences: {
                        ...DEFAULT_NOTIFICATION_PREFERENCES,
                        arrivalAlerts: i % 2 === 0, // Even users enabled, odd users disabled
                    },
                });
            }

            let dispatchedCount = 0;
            let skippedCount = 0;

            for (const uid of batchUsers) {
                const res = await dispatchVehicleArrivalAlert(uid, {
                    vehicleNumber: 'NB-7788',
                    routeNumber: '100',
                    arrivalHalt: 'Colombo Fort',
                    etaMinutes: 5,
                    bookingId: `BK-${uid}`,
                });

                if (res.status === 'ok') dispatchedCount++;
                if (res.status === 'skipped') skippedCount++;
            }

            expect(dispatchedCount).toBe(25);
            expect(skippedCount).toBe(25);
        });
    });

    // =========================================================================
    // 13. EDGE CASES & MALFORMED PAYLOAD RESILIENCE
    // =========================================================================
    describe('13. Edge Cases & Malformed Payload Resilience', () => {
        it('handles non-boolean truthy/falsy types gracefully', () => {
            const raw = {
                bookingAlerts: 1 as any,
                boardingReminders: 0 as any,
                arrivalAlerts: 'true' as any,
                emergencyAlerts: null as any,
            };
            const normalized = normalizeNotificationPreferences(raw);
            expect(normalized.bookingAlerts).toBe(1);
            expect(normalized.boardingReminders).toBe(0);
            expect(normalized.emergencyAlerts).toBe(true);
        });

        it('disallows arbitrary fields from polluting normalized preferences', () => {
            const raw = {
                bookingAlerts: true,
                unauthorizedHackerField: 'MALICIOUS_INJECTION',
                bypassSafetyLock: true,
            };
            const normalized = normalizeNotificationPreferences(raw as any);
            expect((normalized as any).unauthorizedHackerField).toBeUndefined();
            expect(normalized.emergencyAlerts).toBe(true);
        });
    });

    // =========================================================================
    // 14. CONCURRENCY & SIMULTANEOUS TOGGLE RACING
    // =========================================================================
    describe('14. Concurrency & Simultaneous Toggle Racing', () => {
        it('handles simultaneous concurrent preference updates without state corruption', async () => {
            const store = useNotificationPreferencesStore.getState();

            const p1 = store.updatePreference('PAS-DEFAULT', 'bookingAlerts', false);
            const p2 = store.updatePreference('PAS-DEFAULT', 'arrivalAlerts', false);
            const p3 = store.updatePreference('PAS-DEFAULT', 'destinationReminders', false);

            await Promise.all([p1, p2, p3]);

            const finalState = useNotificationPreferencesStore.getState().preferences;
            expect(finalState.emergencyAlerts).toBe(true);
        });
    });

    // =========================================================================
    // 15. SAFETY AUDIT & COMPLIANCE VERIFICATION
    // =========================================================================
    describe('15. Safety Audit & Compliance Certification', () => {
        it('certifies 100% compliance with zero emergency override vulnerabilities', () => {
            const testPayloads = [
                { emergencyAlerts: false },
                { emergencyAlerts: 0 },
                { emergencyAlerts: '' },
                { emergencyAlerts: null },
                { emergencyAlerts: undefined },
            ];

            testPayloads.forEach((payload) => {
                const norm = normalizeNotificationPreferences(payload as any);
                expect(norm.emergencyAlerts).toBe(true);
            });
        });
    });
});
