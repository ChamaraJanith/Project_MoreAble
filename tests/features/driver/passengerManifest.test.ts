import { Booking } from '../../../src/entities/booking/model/types';

describe('Passenger Manifest & Conductor Console (Vehicle Dashboard)', () => {
    const mockBookings: Partial<Booking>[] = [
        {
            bookingId: 'BK-101',
            userId: 'PAS-001',
            seatNumber: 'W1',
            pairedSeatNumber: 'G1',
            status: 'CONFIRMED',
            assistanceRequested: {
                wheelchairAssistance: true,
                boardingAssistance: true,
                walkingAssistance: false,
                prioritySeatAssistance: false,
            },
            assistanceStatus: 'PENDING',
            journey: {
                routeNumber: '138',
                routeName: 'Pettah - Maharagama',
                startLocation: 'Pettah',
                endLocation: 'Nugegoda',
                departureTime: '10:00',
                estimatedArrivalTime: '10:45',
            },
        },
        {
            bookingId: 'BK-102',
            userId: 'PAS-002',
            seatNumber: '04B',
            pairedSeatNumber: null,
            status: 'CONFIRMED',
            assistanceRequested: {
                wheelchairAssistance: false,
                boardingAssistance: false,
                walkingAssistance: true,
                prioritySeatAssistance: false,
            },
            assistanceStatus: 'CONFIRMED',
            journey: {
                routeNumber: '138',
                routeName: 'Pettah - Maharagama',
                startLocation: 'Kirulapone',
                endLocation: 'Maharagama',
                departureTime: '10:00',
                estimatedArrivalTime: '10:45',
            },
        },
        {
            bookingId: 'BK-103',
            userId: 'PAS-003',
            seatNumber: '12A',
            pairedSeatNumber: null,
            status: 'CONFIRMED',
            assistanceRequested: {
                wheelchairAssistance: false,
                boardingAssistance: false,
                walkingAssistance: false,
                prioritySeatAssistance: false,
            },
            assistanceStatus: 'NOT_REQUIRED',
            journey: {
                routeNumber: '138',
                routeName: 'Pettah - Maharagama',
                startLocation: 'Pettah',
                endLocation: 'Maharagama',
                departureTime: '10:00',
                estimatedArrivalTime: '10:45',
            },
        },
    ];

    it('should correctly count total, assistance, and wheelchair passengers', () => {
        const total = mockBookings.length;
        const assistanceCount = mockBookings.filter(
            (b) =>
                b.assistanceRequested?.wheelchairAssistance ||
                b.assistanceRequested?.boardingAssistance ||
                b.assistanceRequested?.walkingAssistance ||
                b.assistanceRequested?.prioritySeatAssistance
        ).length;

        const wheelchairCount = mockBookings.filter(
            (b) => b.seatNumber?.startsWith('W') || b.assistanceRequested?.wheelchairAssistance
        ).length;

        expect(total).toBe(3);
        expect(assistanceCount).toBe(2);
        expect(wheelchairCount).toBe(1);
    });

    it('should filter manifest by search query (seat number)', () => {
        const query = 'w1';
        const filtered = mockBookings.filter(
            (b) => b.seatNumber?.toLowerCase().includes(query) || b.userId?.toLowerCase().includes(query)
        );

        expect(filtered).toHaveLength(1);
        expect(filtered[0].bookingId).toBe('BK-101');
    });

    it('should filter manifest by assistance requests only', () => {
        const filtered = mockBookings.filter(
            (b) =>
                b.assistanceRequested?.wheelchairAssistance ||
                b.assistanceRequested?.boardingAssistance ||
                b.assistanceRequested?.walkingAssistance ||
                b.assistanceRequested?.prioritySeatAssistance
        );

        expect(filtered).toHaveLength(2);
        expect(filtered.map((b) => b.bookingId)).toEqual(['BK-101', 'BK-102']);
    });
});
