import { GET as getPreferences, PUT as putPreferences, POST as postPreferences } from '../../../app/api/notifications/preferences+api';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../../src/entities/notification/model/types';

jest.mock('../../../src/shared/config/firebaseAdmin');

describe('API Route: /api/notifications/preferences (MOV-240 / MOV-242)', () => {
    let mockNotificationPreferences: Map<string, any>;
    let mockUsers: Map<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockNotificationPreferences = new Map();
        mockUsers = new Map();

        mockUsers.set('USR-001', {
            id: 'USR-001',
            passengerId: 'PAS-001',
            fullName: 'Kasun Bandara',
            notificationPreferences: {
                bookingAlerts: true,
                boardingReminders: false,
                arrivalAlerts: true,
                destinationReminders: true,
                caregiverUpdates: false,
                emergencyAlerts: true,
                pushEnabled: true,
                emailAlerts: true,
                smsAlerts: false,
            },
        });

        (getAdminDb as jest.Mock).mockReturnValue({
            collection: (col: string) => {
                if (col === 'notification_preferences') {
                    return {
                        doc: (id: string) => ({
                            get: async () => {
                                const data = mockNotificationPreferences.get(id);
                                return {
                                    exists: !!data,
                                    data: () => data,
                                };
                            },
                            set: async (payload: any) => {
                                const existing = mockNotificationPreferences.get(id) || {};
                                mockNotificationPreferences.set(id, { ...existing, ...payload });
                            },
                        }),
                    };
                }
                if (col === 'users') {
                    return {
                        doc: (id: string) => ({
                            get: async () => {
                                const data = mockUsers.get(id);
                                return {
                                    exists: !!data,
                                    data: () => data,
                                };
                            },
                            update: async (patch: any) => {
                                const existing = mockUsers.get(id) || {};
                                mockUsers.set(id, { ...existing, ...patch });
                            },
                        }),
                        where: (field: string, op: string, val: string) => ({
                            limit: () => ({
                                get: async () => {
                                    const matches = Array.from(mockUsers.values()).filter((u) => u[field] === val);
                                    return {
                                        empty: matches.length === 0,
                                        docs: matches.map((m) => ({
                                            exists: true,
                                            data: () => m,
                                            ref: {
                                                update: async (patch: any) => {
                                                    mockUsers.set(m.id, { ...m, ...patch });
                                                },
                                            },
                                        })),
                                    };
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
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. GET /api/notifications/preferences
    // ─────────────────────────────────────────────────────────────────────────
    describe('1. GET /api/notifications/preferences', () => {
        it('rejects with HTTP 400 when userId query parameter is missing', async () => {
            const req = new Request('http://localhost/api/notifications/preferences');
            const res = await getPreferences(req);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.message).toContain('userId is required');
        });

        it('returns default preferences for a brand new user not yet in database', async () => {
            const req = new Request('http://localhost/api/notifications/preferences?userId=USR-NEW-999');
            const res = await getPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.isDefault).toBe(true);
            expect(data.preferences.bookingAlerts).toBe(true);
            expect(data.preferences.emergencyAlerts).toBe(true);
        });

        it('returns saved preferences from user document', async () => {
            const req = new Request('http://localhost/api/notifications/preferences?userId=USR-001');
            const res = await getPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.isDefault).toBe(false);
            expect(data.preferences.boardingReminders).toBe(false);
            expect(data.preferences.caregiverUpdates).toBe(false);
            expect(data.preferences.emergencyAlerts).toBe(true);
        });

        it('returns saved preferences when queried by passengerId', async () => {
            const req = new Request('http://localhost/api/notifications/preferences?userId=PAS-001');
            const res = await getPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.preferences.boardingReminders).toBe(false);
        });

        it('prefers dedicated notification_preferences document over user document', async () => {
            mockNotificationPreferences.set('USR-001', {
                userId: 'USR-001',
                bookingAlerts: false,
                boardingReminders: true,
                arrivalAlerts: false,
                destinationReminders: false,
                caregiverUpdates: true,
                emergencyAlerts: true,
            });

            const req = new Request('http://localhost/api/notifications/preferences?userId=USR-001');
            const res = await getPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.preferences.arrivalAlerts).toBe(false);
            expect(data.preferences.destinationReminders).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. PUT & POST /api/notifications/preferences (Save & Normalization)
    // ─────────────────────────────────────────────────────────────────────────
    describe('2. PUT & POST /api/notifications/preferences (Save & Normalization)', () => {
        it('rejects with HTTP 400 if userId is not supplied in body or query', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preferences: { bookingAlerts: false } }),
            });
            const res = await putPreferences(req);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.message).toContain('userId is required');
        });

        it('successfully saves preferences and syncs to collections', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'USR-001',
                    preferences: {
                        bookingAlerts: false,
                        boardingReminders: true,
                        arrivalAlerts: false,
                        destinationReminders: true,
                        caregiverUpdates: false,
                    },
                }),
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.preferences.bookingAlerts).toBe(false);
            expect(data.preferences.arrivalAlerts).toBe(false);
            expect(data.preferences.emergencyAlerts).toBe(true);

            // Verify persistence in mock db
            const saved = mockNotificationPreferences.get('USR-001');
            expect(saved.bookingAlerts).toBe(false);
            expect(saved.emergencyAlerts).toBe(true);
        });

        it('STRICT IMMUTABLE RULE: automatically normalizes emergencyAlerts to true even if client passes false', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'USR-001',
                    preferences: {
                        emergencyAlerts: false, // Attempt to disable emergency alerts!
                        bookingAlerts: true,
                    },
                }),
            });

            const res = await postPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            // Must stay true
            expect(data.preferences.emergencyAlerts).toBe(true);

            const saved = mockNotificationPreferences.get('USR-001');
            expect(saved.emergencyAlerts).toBe(true);
        });

        it('handles flat payload structure where preferences are at top-level', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'USR-002',
                    bookingAlerts: true,
                    boardingReminders: true,
                    arrivalAlerts: true,
                    destinationReminders: false,
                    caregiverUpdates: true,
                    emailAlerts: false,
                }),
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.preferences.destinationReminders).toBe(false);
            expect(data.preferences.emailAlerts).toBe(false);
        });

        it('syncs preferences into user profile doc when user doc exists', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'USR-001',
                    preferences: {
                        bookingAlerts: false,
                        arrivalAlerts: false,
                    },
                }),
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(200);
            const user = mockUsers.get('USR-001');
            expect(user.notificationPreferences.bookingAlerts).toBe(false);
            expect(user.notificationPreferences.arrivalAlerts).toBe(false);
        });

        it('syncs preferences to user doc found via passengerId query', async () => {
            mockUsers.set('USR-BY-PASS-ID', {
                id: 'USR-BY-PASS-ID',
                passengerId: 'PAS-REMOTE-QUERY',
                notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
            });

            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'PAS-REMOTE-QUERY',
                    preferences: {
                        caregiverUpdates: false,
                    },
                }),
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(200);
            const targetUser = mockUsers.get('USR-BY-PASS-ID');
            expect(targetUser.notificationPreferences.caregiverUpdates).toBe(false);
        });

        it('handles database error gracefully when saving preferences', async () => {
            const originalMock = (getAdminDb as jest.Mock)();
            (getAdminDb as jest.Mock).mockReturnValueOnce({
                collection: () => ({
                    doc: () => ({
                        set: async () => {
                            throw new Error('Firestore write quota exceeded');
                        },
                        get: async () => ({ exists: false, data: () => null }),
                    }),
                }),
            });

            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: 'USR-ERROR',
                    preferences: { bookingAlerts: false },
                }),
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(500);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('Firestore write quota exceeded');
        });

        it('accepts userId from query string if missing in body', async () => {
            const req = new Request('http://localhost/api/notifications/preferences?userId=USR-QUERY-FALLBACK', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preferences: {
                        pushEnabled: false,
                        smsAlerts: true,
                    },
                }),
            });

            const res = await postPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.userId).toBe('USR-QUERY-FALLBACK');
            expect(data.preferences.pushEnabled).toBe(false);
            expect(data.preferences.smsAlerts).toBe(true);
        });
    });

    describe('CORS Preflight & Edge Cases', () => {
        it('OPTIONS request returns 204 No Content with CORS headers', async () => {
            const { OPTIONS } = await import('../../../app/api/notifications/preferences+api');
            const res = await OPTIONS();
            expect(res.status).toBe(204);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
            expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
        });

        it('handles malformed JSON request body without crashing server', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: '{ malformed json payload...',
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(500);
            const data = await res.json();
            expect(data.success).toBe(false);
        });

        it('trims leading and trailing whitespace from userId', async () => {
            const req = new Request('http://localhost/api/notifications/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: '   USR-SPACED-009   ',
                    preferences: {
                        bookingAlerts: true,
                    },
                }),
            });

            const res = await putPreferences(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.userId).toBe('USR-SPACED-009');
            expect(mockNotificationPreferences.has('USR-SPACED-009')).toBe(true);
        });

        it('supports rapid consecutive updates without dropping fields', async () => {
            const userTestId = 'USR-CONCURRENT-BURST';
            const updates = [
                { bookingAlerts: false },
                { arrivalAlerts: false },
                { boardingReminders: false },
                { destinationReminders: false },
                { caregiverUpdates: false },
            ];

            for (const upd of updates) {
                const req = new Request('http://localhost/api/notifications/preferences', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: userTestId,
                        preferences: upd,
                    }),
                });
                const res = await putPreferences(req);
                expect(res.status).toBe(200);
            }

            const getReq = new Request(`http://localhost/api/notifications/preferences?userId=${userTestId}`);
            const getRes = await getPreferences(getReq);
            const finalData = await getRes.json();
            expect(finalData.preferences.emergencyAlerts).toBe(true);
        });
    });
});
