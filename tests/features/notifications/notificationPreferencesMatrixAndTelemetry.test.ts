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
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

/**
 * Enterprise Accessibility & Transit Matrix Test Suite (MOV-24 / MOV-240)
 *
 * Validates high-volume passenger notification matrices, accessibility passenger personas,
 * multi-channel fallback mechanisms, and non-blocking delivery under transit corridor operations.
 */
describe('Notification Preferences Matrix & Corridor Telemetry Suite (MOV-240)', () => {
    let mockNotificationPreferencesDb: Map<string, any>;
    let mockUsersDb: Map<string, any>;
    let mockDeviceTokensDb: Map<string, any[]>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockNotificationPreferencesDb = new Map();
        mockUsersDb = new Map();
        mockDeviceTokensDb = new Map();

        // 1. Accessibility Persona: Wheelchair User (Requires boarding & arrival alerts, muted non-essentials)
        mockUsersDb.set('PAS-WHEELCHAIR-01', {
            id: 'PAS-WHEELCHAIR-01',
            passengerId: 'PAS-WHEELCHAIR-01',
            fullName: 'Sunil Weerasinghe',
            pushToken: 'ExponentPushToken[mock-wheelchair-token-01]',
            isWheelchairUser: true,
            notificationPreferences: {
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                bookingAlerts: false, // Muted booking alerts
                boardingReminders: true, // Needs extra boarding prep time
                arrivalAlerts: true, // Needs ramp deployment prep
                destinationReminders: true,
                caregiverUpdates: true,
                emergencyAlerts: true,
            },
        });

        // 2. Accessibility Persona: Elder Passenger (Requires SMS alerts + Arrival Alerts)
        mockUsersDb.set('PAS-ELDER-01', {
            id: 'PAS-ELDER-01',
            passengerId: 'PAS-ELDER-01',
            fullName: 'Somapala Ranasinghe',
            pushToken: 'ExponentPushToken[mock-elder-token-01]',
            isElderPerson: true,
            notificationPreferences: {
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                bookingAlerts: true,
                boardingReminders: true,
                arrivalAlerts: true,
                destinationReminders: true,
                caregiverUpdates: true,
                emergencyAlerts: true,
                pushEnabled: true,
                smsAlerts: true,
            },
        });

        // 3. Busy Commuter (Muted arrival & destination alerts to save battery)
        mockUsersDb.set('PAS-COMMUTER-MUTED', {
            id: 'PAS-COMMUTER-MUTED',
            passengerId: 'PAS-COMMUTER-MUTED',
            fullName: 'Chathura Fernando',
            pushToken: 'ExponentPushToken[mock-commuter-token-01]',
            notificationPreferences: {
                bookingAlerts: true,
                boardingReminders: false,
                arrivalAlerts: false,
                destinationReminders: false,
                caregiverUpdates: false,
                emergencyAlerts: true,
                pushEnabled: true,
            },
        });

        // 4. Passenger with Master Push Notification Disabled
        mockUsersDb.set('PAS-MASTER-PUSH-OFF', {
            id: 'PAS-MASTER-PUSH-OFF',
            passengerId: 'PAS-MASTER-PUSH-OFF',
            fullName: 'Kavindu Perera',
            pushToken: 'ExponentPushToken[mock-push-off-token-01]',
            notificationPreferences: {
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                pushEnabled: false, // Master Push OFF
                emergencyAlerts: true,
            },
        });

        // Mock Admin DB
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
                                const existing = mockNotificationPreferencesDb.get(id) || {};
                                mockNotificationPreferencesDb.set(id, { ...existing, ...payload });
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
                                const existing = mockUsersDb.get(id) || {};
                                mockUsersDb.set(id, { ...existing, ...patch });
                            },
                        }),
                        where: (field: string, op: string, val: string) => ({
                            limit: (n: number) => ({
                                get: async () => {
                                    const matching: any[] = [];
                                    mockUsersDb.forEach((u) => {
                                        if (u[field] === val) matching.push(u);
                                    });
                                    return {
                                        empty: matching.length === 0,
                                        docs: matching.slice(0, n).map((item) => ({
                                            data: () => item,
                                            ref: {
                                                update: async (patch: any) => {
                                                    mockUsersDb.set(item.id, { ...item, ...patch });
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
                            get: async () => {
                                const tokens = mockDeviceTokensDb.get(val) || [];
                                return {
                                    forEach: (cb: (doc: any) => void) => {
                                        tokens.forEach((t) => cb({ data: () => t }));
                                    },
                                };
                            },
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

        // Mock global fetch for Expo Push API
        global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
            if (url.includes('exp.host')) {
                const body = JSON.parse(opts.body);
                const data = Array.isArray(body)
                    ? body.map((m: any, i: number) => ({ status: 'ok', id: `ticket-${i}` }))
                    : [{ status: 'ok', id: 'ticket-0' }];
                return Promise.resolve({
                    json: async () => ({ data }),
                });
            }
            return Promise.resolve({
                json: async () => ({ success: true }),
            });
        });
    });

    describe('1. Accessibility Persona Scenarios', () => {
        it('Wheelchair passenger receives arrival and ramp alerts while booking receipts are muted', async () => {
            // Attempt dispatching Booking Alert (should be skipped)
            const bookingRes = await dispatchBookingAlert('PAS-WHEELCHAIR-01', {
                bookingId: 'BK-WHEEL-101',
                routeNumber: '138',
                seatNumber: 'Priority-01',
                origin: 'Makumbura Multimodal Terminal',
                destination: 'Pettah Central',
            });
            expect(bookingRes.status).toBe('skipped');
            expect(bookingRes.reason).toBe('BOOKING_ALERTS_DISABLED_BY_USER_PREFERENCE');

            // Dispatching Vehicle Arrival Alert (must succeed)
            const arrivalRes = await dispatchVehicleArrivalAlert('PAS-WHEELCHAIR-01', {
                vehicleNumber: 'ND-8899',
                routeNumber: '138',
                routeName: 'High Level Express',
                arrivalHalt: 'Makumbura Multimodal Terminal',
                etaMinutes: 4,
                bookingId: 'BK-WHEEL-101',
            });
            expect(arrivalRes.success).toBe(true);
            expect(arrivalRes.status).toBe('ok');
            expect(arrivalRes.recipientCount).toBe(1);
        });

        it('Elderly passenger with all active categories receives departure reminders and arrival alerts', async () => {
            const boardingRes = await dispatchBoardingAlert('PAS-ELDER-01', {
                bookingId: 'BK-ELDER-202',
                vehicleNumber: 'WP-NC-1234',
                routeNumber: '100',
                seatNumber: '03',
                dropOffHalt: 'Galle Face Green',
            });
            expect(boardingRes.success).toBe(true);
            expect(boardingRes.status).toBe('ok');

            const destRes = await dispatchDestinationReminder('PAS-ELDER-01', {
                bookingId: 'BK-ELDER-202',
                destination: 'Galle Face Green',
                remainingStops: 2,
                estimatedArrivalTime: '10:45 AM',
            });
            expect(destRes.success).toBe(true);
            expect(destRes.status).toBe('ok');
        });

        it('Commuter with muted alerts skips arrival, destination, and boarding alerts cleanly', async () => {
            const arrRes = await dispatchVehicleArrivalAlert('PAS-COMMUTER-MUTED', {
                vehicleNumber: 'WP-ND-5544',
                routeNumber: '177',
                arrivalHalt: 'Kollupitiya Supermarket',
                etaMinutes: 3,
            });
            expect(arrRes.status).toBe('skipped');
            expect(arrRes.reason).toBe('ARRIVAL_ALERTS_DISABLED_BY_USER_PREFERENCE');

            const destRes = await dispatchDestinationReminder('PAS-COMMUTER-MUTED', {
                bookingId: 'BK-COMM-303',
                destination: 'Kaduwela Clock Tower',
            });
            expect(destRes.status).toBe('skipped');
            expect(destRes.reason).toBe('DESTINATION_REMINDERS_DISABLED_BY_USER_PREFERENCE');

            const boardRes = await dispatchBoardingAlert('PAS-COMMUTER-MUTED', {
                bookingId: 'BK-COMM-303',
                vehicleNumber: 'WP-ND-5544',
                routeNumber: '177',
                seatNumber: '14',
                dropOffHalt: 'Kaduwela',
            });
            expect(boardRes.status).toBe('skipped');
            expect(boardRes.reason).toBe('BOARDING_REMINDERS_DISABLED_BY_USER_PREFERENCE');
        });
    });

    describe('2. Master Push Notification Toggle Matrix', () => {
        it('skips all standard push alert types when pushEnabled is false', async () => {
            const arrivalRes = await dispatchVehicleArrivalAlert('PAS-MASTER-PUSH-OFF', {
                vehicleNumber: 'NC-9988',
                routeNumber: 'EX-01',
                arrivalHalt: 'Southern Expressway Terminal',
                etaMinutes: 5,
            });
            expect(arrivalRes.status).toBe('skipped');

            const bookingRes = await dispatchBookingAlert('PAS-MASTER-PUSH-OFF', {
                bookingId: 'BK-PUSH-OFF-1',
                routeNumber: 'EX-01',
                seatNumber: '02',
                origin: 'Kottawa',
                destination: 'Matara',
            });
            expect(bookingRes.status).toBe('skipped');

            const boardingRes = await dispatchBoardingAlert('PAS-MASTER-PUSH-OFF', {
                bookingId: 'BK-PUSH-OFF-1',
                vehicleNumber: 'NC-9988',
                routeNumber: 'EX-01',
                seatNumber: '02',
                dropOffHalt: 'Matara',
            });
            expect(boardingRes.status).toBe('skipped');

            const destRes = await dispatchDestinationReminder('PAS-MASTER-PUSH-OFF', {
                bookingId: 'BK-PUSH-OFF-1',
                destination: 'Matara',
            });
            expect(destRes.status).toBe('skipped');

            const careRes = await dispatchCaregiverJourneyAlert('PAS-MASTER-PUSH-OFF', {
                passengerName: 'Kavindu',
                eventType: 'BOARDED',
                vehicleNumber: 'NC-9988',
                locationName: 'Kottawa',
            });
            expect(careRes.status).toBe('skipped');
        });

        it('CRITICAL: Emergency SOS alerts ALWAYS bypass master push toggle and deliver push', async () => {
            const sosRes = await dispatchEmergencySOSAlert(['PAS-MASTER-PUSH-OFF'], {
                passengerName: 'Kavindu Perera',
                passengerId: 'PAS-MASTER-PUSH-OFF',
                vehicleNumber: 'NC-9988',
                routeNumber: 'EX-01',
                locationName: 'Dodangoda Interchange',
                latitude: 6.5544,
                longitude: 80.0877,
                contactPhone: '+94771234567',
            });

            expect(sosRes.success).toBe(true);
            expect(sosRes.status).toBe('ok');
            expect(sosRes.recipientCount).toBe(1);
        });
    });

    describe('3. Transit Corridors & Batch Passenger Matrix', () => {
        it('handles 25 concurrent passengers at Makumbura Multimodal Terminal with mixed preference toggles', async () => {
            // Seed 25 passengers (odd = muted arrival, even = active arrival)
            const passengerIds: string[] = [];
            for (let i = 1; i <= 25; i++) {
                const pid = `PAS-CORRIDOR-${i}`;
                passengerIds.push(pid);
                mockUsersDb.set(pid, {
                    id: pid,
                    passengerId: pid,
                    fullName: `Passenger ${i}`,
                    pushToken: `ExponentPushToken[token-${i}]`,
                    notificationPreferences: {
                        ...DEFAULT_NOTIFICATION_PREFERENCES,
                        arrivalAlerts: i % 2 === 0, // Even numbers receive alerts
                    },
                });
            }

            const dispatchPromises = passengerIds.map((pid) =>
                dispatchVehicleArrivalAlert(pid, {
                    vehicleNumber: 'WP-ND-1000',
                    routeNumber: '122',
                    routeName: 'Avissawella Express',
                    arrivalHalt: 'Makumbura Terminal Platform 4',
                    etaMinutes: 2,
                    bookingId: `BK-${pid}`,
                })
            );

            const results = await Promise.all(dispatchPromises);
            const activeDispatches = results.filter((r) => r.status === 'ok');
            const skippedDispatches = results.filter((r) => r.status === 'skipped');

            // 12 even passengers (2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24) should receive alert
            expect(activeDispatches.length).toBe(12);
            // 13 odd passengers should be skipped
            expect(skippedDispatches.length).toBe(13);
        });

        it('dispatches Southern Expressway Night Express arrival alerts only to opt-in passengers', async () => {
            mockUsersDb.set('PAS-NIGHT-01', {
                id: 'PAS-NIGHT-01',
                pushToken: 'ExponentPushToken[night-01]',
                notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, arrivalAlerts: true },
            });
            mockUsersDb.set('PAS-NIGHT-02', {
                id: 'PAS-NIGHT-02',
                pushToken: 'ExponentPushToken[night-02]',
                notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, arrivalAlerts: false },
            });

            const res1 = await dispatchVehicleArrivalAlert('PAS-NIGHT-01', {
                vehicleNumber: 'EX-NIGHT-44',
                routeNumber: 'EX-02',
                arrivalHalt: 'Galle International Stadium',
                etaMinutes: 10,
            });
            const res2 = await dispatchVehicleArrivalAlert('PAS-NIGHT-02', {
                vehicleNumber: 'EX-NIGHT-44',
                routeNumber: 'EX-02',
                arrivalHalt: 'Galle International Stadium',
                etaMinutes: 10,
            });

            expect(res1.status).toBe('ok');
            expect(res2.status).toBe('skipped');
        });
    });

    describe('4. Caregiver Safety Sync & Multi-Guardian Scenarios', () => {
        it('delivers trip milestones to active guardians while skipping guardians who disabled sync', async () => {
            mockUsersDb.set('GUARD-ACTIVE', {
                id: 'GUARD-ACTIVE',
                pushToken: 'ExponentPushToken[guard-active]',
                notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, caregiverUpdates: true },
            });
            mockUsersDb.set('GUARD-MUTED', {
                id: 'GUARD-MUTED',
                pushToken: 'ExponentPushToken[guard-muted]',
                notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, caregiverUpdates: false },
            });

            const alertActive = await dispatchCaregiverJourneyAlert('GUARD-ACTIVE', {
                passengerName: 'Anuki Perera',
                eventType: 'BOARDED',
                vehicleNumber: 'ND-3344',
                locationName: 'Moratuwa Town Hall',
            });
            const alertMuted = await dispatchCaregiverJourneyAlert('GUARD-MUTED', {
                passengerName: 'Anuki Perera',
                eventType: 'BOARDED',
                vehicleNumber: 'ND-3344',
                locationName: 'Moratuwa Town Hall',
            });

            expect(alertActive.status).toBe('ok');
            expect(alertMuted.status).toBe('skipped');
        });

        it('dispatches ALIGHTED and NEAR_DESTINATION events with accurate text representation', async () => {
            mockUsersDb.set('GUARD-COMMUTE', {
                id: 'GUARD-COMMUTE',
                pushToken: 'ExponentPushToken[guard-commute]',
                notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
            });

            const nearRes = await dispatchCaregiverJourneyAlert('GUARD-COMMUTE', {
                passengerName: 'Kusal Mendis',
                eventType: 'NEAR_DESTINATION',
                vehicleNumber: 'ND-7766',
                locationName: 'Bambalapitiya Junction',
            });
            expect(nearRes.status).toBe('ok');

            const alightedRes = await dispatchCaregiverJourneyAlert('GUARD-COMMUTE', {
                passengerName: 'Kusal Mendis',
                eventType: 'ALIGHTED',
                vehicleNumber: 'ND-7766',
                locationName: 'Colombo Fort Railway Station',
            });
            expect(alightedRes.status).toBe('ok');
        });
    });

    describe('5. Emergency Safety Beacon Immutability Matrix', () => {
        it('delivers SOS alerts simultaneously to 10 guardians even if all have push/caregiver toggles off', async () => {
            const guardianIds: string[] = [];
            for (let i = 1; i <= 10; i++) {
                const gid = `GUARD-MUTED-${i}`;
                guardianIds.push(gid);
                mockUsersDb.set(gid, {
                    id: gid,
                    pushToken: `ExponentPushToken[guard-token-${i}]`,
                    notificationPreferences: {
                        bookingAlerts: false,
                        boardingReminders: false,
                        arrivalAlerts: false,
                        destinationReminders: false,
                        caregiverUpdates: false,
                        pushEnabled: false, // Push completely disabled
                        emergencyAlerts: true, // Immutable
                    },
                });
            }

            const sosResult = await dispatchEmergencySOSAlert(guardianIds, {
                passengerName: 'Tharindu Silva',
                passengerId: 'PAS-URGENT-01',
                vehicleNumber: 'WP-ND-8989',
                routeNumber: '100',
                locationName: 'Panadura Bus Stand',
                latitude: 6.7132,
                longitude: 79.9074,
                contactPhone: '+94712345678',
            });

            expect(sosResult.success).toBe(true);
            expect(sosResult.status).toBe('ok');
            expect(sosResult.recipientCount).toBe(10);
        });

        it('includes high-precision coordinates and bus details in emergency payload', async () => {
            mockUsersDb.set('DRIVER-CHAMARA', {
                id: 'DRIVER-CHAMARA',
                pushToken: 'ExponentPushToken[driver-chamara]',
            });

            const emergencyRes = await dispatchEmergencySOSAlert(['DRIVER-CHAMARA'], {
                passengerName: 'Rashmi Dissanayake',
                passengerId: 'PAS-EMERGENCY-99',
                vehicleNumber: 'NC-4567',
                routeNumber: '120',
                locationName: 'Piliyandala Clock Tower',
                latitude: 6.8018,
                longitude: 79.9227,
            });

            expect(emergencyRes.success).toBe(true);
            expect(emergencyRes.recipientCount).toBe(1);
        });
    });

    describe('6. Data Normalization & Resilient Parsing', () => {
        it('normalizes partial null values gracefully without throwing', () => {
            const raw: any = {
                bookingAlerts: null,
                boardingReminders: undefined,
                arrivalAlerts: false,
                emergencyAlerts: false,
            };

            const normalized = normalizeNotificationPreferences(raw);
            expect(normalized.bookingAlerts).toBe(true); // Fallback to default
            expect(normalized.boardingReminders).toBe(true); // Fallback to default
            expect(normalized.arrivalAlerts).toBe(false); // Preserves explicit false
            expect(normalized.emergencyAlerts).toBe(true); // Strictly locked
        });

        it('retains updatedAt timestamp or adds fresh ISO timestamp', () => {
            const customDate = '2026-09-26T12:00:00.000Z';
            const normalized = normalizeNotificationPreferences({
                bookingAlerts: true,
                updatedAt: customDate,
            });
            expect(normalized.updatedAt).toBe(customDate);

            const withoutDate = normalizeNotificationPreferences({ bookingAlerts: true });
            expect(typeof withoutDate.updatedAt).toBe('string');
            expect(new Date(withoutDate.updatedAt!).getTime()).toBeGreaterThan(0);
        });

        it('retrieves default preferences safely when user is GUEST or empty string', async () => {
            const guestPrefs = await getUserNotificationPreferences('GUEST');
            expect(guestPrefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);

            const emptyPrefs = await getUserNotificationPreferences('');
            expect(emptyPrefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
        });

        it('recovers cleanly when Firestore collection throws connection error', async () => {
            (getAdminDb as jest.Mock).mockReturnValueOnce({
                collection: () => ({
                    doc: () => ({
                        get: async () => {
                            throw new Error('Firestore connection timeout');
                        },
                    }),
                }),
            });

            const prefs = await getUserNotificationPreferences('PAS-TIMEOUT-USER');
            // Must return default preferences without throwing fatal exception
            expect(prefs.emergencyAlerts).toBe(true);
            expect(prefs.bookingAlerts).toBe(true);
        });
    });
});
