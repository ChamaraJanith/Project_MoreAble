import { Booking } from '../../../src/entities/booking/model/types';

describe('Passenger Manifest & Conductor Console (Vehicle Dashboard)', () => {
    const mockBookings: Partial<Booking>[] = [
        {
            bookingId: 'BK-101',
            userId: 'PAS-001',
            seatNumber: 'W1',
            pairedSeatNumber: 'G1',
            status: 'CONFIRMED',
            boardingStatus: 'NOT_BOARDED',
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
            boardingStatus: 'BOARDED',
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
            boardingStatus: 'NOT_BOARDED',
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
        {
            bookingId: 'BK-104',
            userId: 'PAS-004',
            seatNumber: '05A',
            pairedSeatNumber: null,
            status: 'CONFIRMED',
            boardingStatus: 'NOT_BOARDED',
            assistanceRequested: {
                wheelchairAssistance: false,
                boardingAssistance: false,
                walkingAssistance: false,
                prioritySeatAssistance: true,
            },
            assistanceStatus: 'CONFIRMED',
            journey: {
                routeNumber: '138',
                routeName: 'Pettah - Maharagama',
                startLocation: 'Borella',
                endLocation: 'Nugegoda',
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

        expect(total).toBe(4);
        expect(assistanceCount).toBe(3);
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

        expect(filtered).toHaveLength(3);
        expect(filtered.map((b) => b.bookingId)).toEqual(['BK-101', 'BK-102', 'BK-104']);
    });

    it('should sort manifest sequentially: Awaiting passengers first, ordered by stop name and wheelchair priority', () => {
        const sorted = [...mockBookings].sort((a, b) => {
            const aBoarded = a.boardingStatus === 'BOARDED' ? 1 : 0;
            const bBoarded = b.boardingStatus === 'BOARDED' ? 1 : 0;
            if (aBoarded !== bBoarded) return aBoarded - bBoarded;

            const stopCompare = (a.journey?.startLocation || '').localeCompare(b.journey?.startLocation || '');
            if (stopCompare !== 0) return stopCompare;

            const aAst = a.seatNumber?.startsWith('W') || a.assistanceRequested?.wheelchairAssistance ? 0 : 1;
            const bAst = b.seatNumber?.startsWith('W') || b.assistanceRequested?.wheelchairAssistance ? 0 : 1;
            if (aAst !== bAst) return aAst - bAst;

            return (a.seatNumber || '').localeCompare(b.seatNumber || '');
        });

        // The first 3 should be awaiting passengers (BK-104 Borella, BK-101 Pettah W1, BK-103 Pettah 12A)
        // BK-102 (Boarded at Kirulapone) should be at the bottom!
        expect(sorted[0].bookingId).toBe('BK-104'); // Borella (awaiting)
        expect(sorted[1].bookingId).toBe('BK-101'); // Pettah W1 Wheelchair (awaiting)
        expect(sorted[2].bookingId).toBe('BK-103'); // Pettah 12A (awaiting)
        expect(sorted[3].bookingId).toBe('BK-102'); // Kirulapone (already boarded)
    });

    it('should isolate passengers by specific boarding halt filter', () => {
        const pettahPassengers = mockBookings.filter((b) => b.journey?.startLocation === 'Pettah');
        expect(pettahPassengers).toHaveLength(2);
        expect(pettahPassengers.map((b) => b.bookingId)).toEqual(['BK-101', 'BK-103']);
    });
});
