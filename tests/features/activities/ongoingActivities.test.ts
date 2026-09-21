// Activities > Ongoing fed by GET /api/journeys/ongoing (MOV-295).
//
// The server decides which bookings are ongoing; the screen re-checks the
// window and keeps Completed coming from the history, with no booking in both.

import { Booking, PassengerOngoingJourney } from '../../../src/entities/booking/model/types';
import { groupActivitiesWithOngoing } from '../../../src/features/activities/utils/activityStatus';

const PASSENGER = 'PAS-2026-00001';
const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 8, 21, 9, 0);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function makeBooking(bookingId: string, overrides: Partial<Booking> = {}): Booking {
    return {
        bookingId,
        userId: PASSENGER,
        tripId: `TRIP-${bookingId}`,
        routeId: 'ROUTE-177',
        busId: 'BUS-A',
        seatNumber: '05A',
        isPrioritySeat: false,
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Kollupitiya',
            departureTime: '06:00',
            estimatedArrivalTime: '06:40',
        },
        vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
        qrPayload: '',
        fare: { distanceKm: 10, baseFare: 30, distanceFare: 50, totalFare: 80, currency: 'LKR', isEstimate: false },
        assistanceRequested: { boardingAssistance: false, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: '',
        createdAt: hoursAgo(48),
        ...overrides,
    };
}

function ongoingFor(booking: Booking, startedAt: string): PassengerOngoingJourney {
    return {
        booking,
        activeJourney: {
            tripId: booking.tripId,
            startedAt,
            expiresAt: new Date(new Date(startedAt).getTime() + 23 * HOUR).toISOString(),
        },
        busId: 'BUS-A',
        liveStatus: { available: false },
    };
}

describe('groupActivitiesWithOngoing', () => {
    it('lists exactly the journeys the server reported as ongoing', () => {
        const running = makeBooking('RUN');
        const history = [running, makeBooking('FUTURE')];

        const groups = groupActivitiesWithOngoing(history, [ongoingFor(running, hoursAgo(1))], PASSENGER, NOW);

        expect(groups.ongoing.map((b) => b.bookingId)).toEqual(['RUN']);
        expect(groups.ongoing[0].activeJourney?.tripId).toBe('TRIP-RUN');
        expect(groups.completed).toEqual([]);
    });

    it('ignores a history activeJourney the server did not confirm', () => {
        const boardedYesterday = makeBooking('USED', {
            boardingStatus: 'BOARDED',
            boardedAt: hoursAgo(26),
            activeJourney: { tripId: 'TRIP-USED', startedAt: hoursAgo(1), expiresAt: hoursAgo(-22) },
        });

        const groups = groupActivitiesWithOngoing([boardedYesterday], [], PASSENGER, NOW);

        expect(groups.ongoing).toEqual([]);
        expect(groups.completed.map((b) => b.bookingId)).toEqual(['USED']);
    });

    it('drops a reported journey once its window has run out on screen', () => {
        const running = makeBooking('RUN');

        const groups = groupActivitiesWithOngoing([running], [ongoingFor(running, hoursAgo(24))], PASSENGER, NOW);

        expect(groups.ongoing).toEqual([]);
    });

    it("never lists another passenger's booking", () => {
        const other = makeBooking('OTHER', { userId: 'PAS-2026-00002' });

        const groups = groupActivitiesWithOngoing([], [ongoingFor(other, hoursAgo(1))], PASSENGER, NOW);

        expect(groups.ongoing).toEqual([]);
    });
});
