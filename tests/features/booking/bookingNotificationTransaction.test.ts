import { POST as confirmBooking } from '../../../app/api/booking/confirm+api';
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

describe('Booking Confirmation Atomic Notification Generation', () => {
    let fakeDb: any;

    beforeEach(() => {
        jest.clearAllMocks();
        fakeDb = createFakeFirestore({
            trips: [
                {
                    id: 'trip_101',
                    busId: 'bus_55',
                    routeId: 'route_138',
                    status: 'ACTIVE',
                    departureTime: '2026-08-25T08:30:00.000Z',
                    estimatedArrivalTime: '2026-08-25T09:30:00.000Z',
                },
            ],
            buses: [
                {
                    id: 'bus_55',
                    status: 'ACTIVE',
                    numberPlate: 'NC-4589',
                    busModel: 'Ashok Leyland',
                    manufacturer: 'Ashok Leyland',
                    seatCapacity: 40,
                },
            ],
            routes: [
                {
                    id: 'route_138',
                    routeNumber: '138',
                    routeName: 'Maharagama - Pettah',
                    startLocation: 'Maharagama',
                    endLocation: 'Pettah',
                    stops: ['Maharagama', 'Nugegoda', 'Pettah'],
                    distanceKm: 15,
                },
            ],
            bookings: [],
            notifications: [],
        });

        mockGetAdminDb.mockReturnValue(fakeDb);
    });

    it('creates both booking and notification documents atomically in Firestore during booking confirmation', async () => {
        const req = buildRequest('/api/booking/confirm', 'POST', {
            tripId: 'trip_101',
            seatNumber: 'S05',
            passengerId: 'PA-2026-1024',
            origin: 'Maharagama',
            destination: 'Pettah',
        });

        const res = await confirmBooking(req);
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.booking.bookingId).toBeDefined();

        const bookingId = body.booking.bookingId;
        const notificationId = `notif_${bookingId}`;

        // Verify notification collection received the document atomically
        const notificationDoc = await fakeDb.collection('notifications').doc(notificationId).get();
        expect(notificationDoc.exists).toBe(true);

        const notifData = notificationDoc.data();
        expect(notifData.userId).toBe('PA-2026-1024');
        expect(notifData.bookingId).toBe(bookingId);
        expect(notifData.status).toBe('UNREAD');
        expect(notifData.type).toBe('BOOKING_CONFIRMATION');

        // Verify snapshot details match required acceptance criteria
        expect(notifData.details.bookingId).toBe(bookingId);
        expect(notifData.details.vehicleNumber).toBe('NC-4589');
        expect(notifData.details.routeNumber).toBe('138');
        expect(notifData.details.seatNumber).toBe('S05');
        expect(notifData.details.journeyTime).toBe('2026-08-25T08:30:00.000Z');
    });
});
