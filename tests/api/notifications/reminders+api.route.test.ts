import { POST as processReminders, parseDepartureDateTime } from '../../../app/api/notifications/reminders/process+api';
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

describe('Boarding Reminder Processing API Endpoint', () => {
    let fakeDb: any;
    const nowIso = '2026-08-22T07:15:00.000Z'; // Current time: 07:15 AM

    beforeEach(() => {
        jest.clearAllMocks();
        fakeDb = createFakeFirestore({
            bookings: [
                // 1. Confirmed booking departing in 10 minutes (07:25 AM) -> Should trigger reminder
                {
                    bookingId: 'BK-5001',
                    userId: 'PA-2026-1024',
                    status: 'CONFIRMED',
                    seatNumber: 'S08',
                    journeyDate: '2026-08-22',
                    departureTime: '07:25 AM',
                    reminderSent: false,
                    journey: {
                        routeNumber: '138',
                        routeName: 'Maharagama - Pettah',
                        startLocation: 'Maharagama',
                        endLocation: 'Pettah',
                        departureTime: '07:25 AM',
                    },
                    vehicle: {
                        numberPlate: 'ND-5421',
                        busModel: 'Lanka Ashok Leyland',
                    },
                },
                // 2. Confirmed booking departing in 60 minutes (08:15 AM) -> Should NOT trigger (outside 15 min window)
                {
                    bookingId: 'BK-5002',
                    userId: 'PA-2026-1025',
                    status: 'CONFIRMED',
                    seatNumber: 'S02',
                    journeyDate: '2026-08-22',
                    departureTime: '08:15 AM',
                    reminderSent: false,
                    journey: {
                        routeNumber: '177',
                        routeName: 'Kaduwela - Kollupitiya',
                        startLocation: 'Kaduwela',
                        endLocation: 'Kollupitiya',
                        departureTime: '08:15 AM',
                    },
                    vehicle: {
                        numberPlate: 'NA-1234',
                    },
                },
                // 3. Cancelled booking departing in 10 minutes (07:25 AM) -> Should NOT trigger
                {
                    bookingId: 'BK-5003',
                    userId: 'PA-2026-1026',
                    status: 'CANCELLED',
                    seatNumber: 'S05',
                    journeyDate: '2026-08-22',
                    departureTime: '07:25 AM',
                    reminderSent: false,
                    journey: {
                        routeNumber: '138',
                        startLocation: 'Highlevel Road',
                        departureTime: '07:25 AM',
                    },
                    vehicle: {
                        numberPlate: 'ND-5421',
                    },
                },
                // 4. Confirmed booking departing in 5 minutes (07:20 AM), but ALREADY sent reminder -> Should NOT trigger (idempotency)
                {
                    bookingId: 'BK-5004',
                    userId: 'PA-2026-1024',
                    status: 'CONFIRMED',
                    seatNumber: 'S10',
                    journeyDate: '2026-08-22',
                    departureTime: '07:20 AM',
                    reminderSent: true,
                    reminderSentAt: '2026-08-22T07:05:00.000Z',
                    journey: {
                        routeNumber: '138',
                        startLocation: 'Maharagama',
                        departureTime: '07:20 AM',
                    },
                    vehicle: {
                        numberPlate: 'ND-5421',
                    },
                },
            ],
            notifications: [],
        });
        mockGetAdminDb.mockReturnValue(fakeDb);
    });

    describe('parseDepartureDateTime utility', () => {
        it('parses 12-hour AM/PM formats correctly', () => {
            const dt1 = parseDepartureDateTime('2026-08-22', '07:30 AM');
            expect(dt1?.getHours()).toBe(7);
            expect(dt1?.getMinutes()).toBe(30);

            const dt2 = parseDepartureDateTime('2026-08-22', '02:45 PM');
            expect(dt2?.getHours()).toBe(14);
            expect(dt2?.getMinutes()).toBe(45);
        });

        it('parses 24-hour HH:MM formats correctly', () => {
            const dt = parseDepartureDateTime('2026-08-22', '14:30');
            expect(dt?.getHours()).toBe(14);
            expect(dt?.getMinutes()).toBe(30);
        });
    });

    describe('POST /api/notifications/reminders/process', () => {
        it('dispatches reminder for confirmed booking within 15-minute window', async () => {
            const req = buildRequest('/api/notifications/reminders/process', 'POST', { nowIso });
            const res = await processReminders(req);
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.sentCount).toBe(1);
            expect(body.reminders[0].bookingId).toBe('BK-5001');
            expect(body.reminders[0].vehicleNumber).toBe('ND-5421');
            expect(body.reminders[0].startLocation).toBe('Maharagama');
            expect(body.reminders[0].seatNumber).toBe('S08');

            // Verify notification created in fake Firestore
            const notifSnap = await fakeDb.collection('notifications').get();
            const notifDocs = notifSnap.docs.map((d: any) => d.data());
            const notif = notifDocs.find((n: any) => n.bookingId === 'BK-5001');
            expect(notif).toBeDefined();
            expect(notif.type).toBe('BOARDING_REMINDER');
            expect(notif.title).toContain('Boarding Reminder');
            expect(notif.message).toContain('Bus ND-5421 for Route 138 will depart in 10 minutes');
            expect(notif.details.vehicleNumber).toBe('ND-5421');
            expect(notif.details.startLocation).toBe('Maharagama');

            // Verify booking reminderSent flag updated
            const bookingDoc = await fakeDb.collection('bookings').doc('BK-5001').get();
            const updatedBooking = bookingDoc.data();
            expect(updatedBooking.reminderSent).toBe(true);
            expect(updatedBooking.reminderSentAt).toBe(nowIso);
        });

        it('ensures idempotency on subsequent process calls', async () => {
            // First run
            const req1 = buildRequest('/api/notifications/reminders/process', 'POST', { nowIso });
            await processReminders(req1);

            // Second run immediately after
            const req2 = buildRequest('/api/notifications/reminders/process', 'POST', { nowIso });
            const res2 = await processReminders(req2);
            const body2 = await res2.json();

            expect(res2.status).toBe(200);
            expect(body2.sentCount).toBe(0); // 0 sent on second run
        });
    });
});
