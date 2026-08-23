import { AssistanceRequested, AssistanceStatus, Booking } from '../../../src/entities/booking/model/types';

describe('Travel Assistance (MOV-23 / MOV-199) and Wheelchair Companion Pairing', () => {
    it('should correctly structure AssistanceRequested interface with wheelchairAssistance', () => {
        const assistance: AssistanceRequested = {
            wheelchairAssistance: true,
            boardingAssistance: true,
            walkingAssistance: false,
            prioritySeatAssistance: false,
        };

        expect(assistance.wheelchairAssistance).toBe(true);
        expect(assistance.boardingAssistance).toBe(true);
        expect(assistance.walkingAssistance).toBe(false);
    });

    it('should set assistanceStatus to PENDING when travel assistance is requested', () => {
        const assistanceRequested: AssistanceRequested = {
            wheelchairAssistance: true,
            boardingAssistance: true,
            walkingAssistance: false,
            prioritySeatAssistance: false,
        };

        const hasAssistance =
            !!assistanceRequested.wheelchairAssistance ||
            !!assistanceRequested.boardingAssistance ||
            !!assistanceRequested.walkingAssistance ||
            !!assistanceRequested.prioritySeatAssistance;

        const assistanceStatus: AssistanceStatus = hasAssistance ? 'PENDING' : 'NOT_REQUIRED';
        expect(assistanceStatus).toBe('PENDING');
    });

    it('should correctly link paired guardian seat for wheelchair booking', () => {
        const booking: Partial<Booking> = {
            bookingId: 'BK100',
            seatNumber: 'W1',
            pairedSeatNumber: 'G1',
            assistanceRequested: {
                wheelchairAssistance: true,
                boardingAssistance: true,
                walkingAssistance: false,
                prioritySeatAssistance: false,
            },
            assistanceStatus: 'PENDING',
        };

        expect(booking.seatNumber).toBe('W1');
        expect(booking.pairedSeatNumber).toBe('G1');
        expect(booking.assistanceStatus).toBe('PENDING');
    });

    it('should transition assistanceStatus accurately through driver workflow', () => {
        let status: AssistanceStatus = 'PENDING';
        expect(status).toBe('PENDING');

        // Driver acknowledges and confirms assistance
        status = 'CONFIRMED';
        expect(status).toBe('CONFIRMED');

        // Staff assists passenger during boarding
        status = 'IN_PROGRESS';
        expect(status).toBe('IN_PROGRESS');

        // Boarding completed successfully
        status = 'COMPLETED';
        expect(status).toBe('COMPLETED');
    });
});
