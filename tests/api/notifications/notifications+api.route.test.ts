import { GET as getNotifications } from '../../../app/api/notifications+api';
import { PATCH as updateNotificationStatus } from '../../../app/api/notifications/[notificationId]+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

function buildRequest(path: string, method: string, body?: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

describe('Notification API Endpoints', () => {
    let fakeDb: any;

    beforeEach(() => {
        jest.clearAllMocks();
        fakeDb = createFakeFirestore({
            notifications: [
                {
                    id: 'notif_BK-1001',
                    notificationId: 'notif_BK-1001',
                    userId: 'PA-2026-1024',
                    bookingId: 'BK-1001',
                    type: 'BOOKING_CONFIRMATION',
                    title: 'Booking Confirmed!',
                    message: 'Your reservation BK-1001 for Route 138 (Seat S05) has been confirmed.',
                    status: 'UNREAD',
                    createdAt: '2026-08-21T10:00:00.000Z',
                    readAt: null,
                    details: {
                        bookingId: 'BK-1001',
                        vehicleNumber: 'NC-4589',
                        routeNumber: '138',
                        routeName: 'Maharagama - Pettah',
                        seatNumber: 'S05',
                        journeyDate: '2026-08-22',
                        journeyTime: '08:30 AM',
                        startLocation: 'Maharagama',
                        endLocation: 'Pettah',
                    },
                },
                {
                    id: 'notif_BK-1000',
                    notificationId: 'notif_BK-1000',
                    userId: 'PA-2026-1024',
                    bookingId: 'BK-1000',
                    type: 'BOOKING_CONFIRMATION',
                    title: 'Booking Confirmed!',
                    message: 'Your reservation BK-1000 for Route 177 (Seat S01) has been confirmed.',
                    status: 'READ',
                    createdAt: '2026-08-20T10:00:00.000Z',
                    readAt: '2026-08-20T10:05:00.000Z',
                    details: {
                        bookingId: 'BK-1000',
                        vehicleNumber: 'NA-1234',
                        routeNumber: '177',
                        routeName: 'Kaduwela - Kollupitiya',
                        seatNumber: 'S01',
                        journeyDate: '2026-08-21',
                        journeyTime: '09:00 AM',
                        startLocation: 'Kaduwela',
                        endLocation: 'Kollupitiya',
                    },
                },
            ],
        });
        mockGetAdminDb.mockReturnValue(fakeDb);
    });

    describe('GET /api/notifications', () => {
        it('returns user notifications and unread count correctly', async () => {
            const req = buildRequest('/api/notifications?userId=PA-2026-1024', 'GET');
            const res = await getNotifications(req);
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.notifications).toHaveLength(2);
            expect(body.unreadCount).toBe(1);
            expect(body.notifications[0].id).toBe('notif_BK-1001');
        });

        it('returns empty array and 0 unreadCount when user has no notifications', async () => {
            const req = buildRequest('/api/notifications?userId=NON_EXISTENT_USER', 'GET');
            const res = await getNotifications(req);
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.notifications).toHaveLength(0);
            expect(body.unreadCount).toBe(0);
        });
    });

    describe('PATCH /api/notifications/[notificationId]', () => {
        it('updates notification status from UNREAD to READ', async () => {
            const req = buildRequest('/api/notifications/notif_BK-1001', 'PATCH', { status: 'READ' });
            const res = await updateNotificationStatus(req, { params: { notificationId: 'notif_BK-1001' } });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.notification.status).toBe('READ');
            expect(body.notification.readAt).toBeDefined();
        });

        it('returns 404 if notification is not found', async () => {
            const req = buildRequest('/api/notifications/notif_NON_EXISTENT', 'PATCH', { status: 'READ' });
            const res = await updateNotificationStatus(req, { params: { notificationId: 'notif_NON_EXISTENT' } });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
            expect(body.message).toContain('not found');
        });
    });
});
