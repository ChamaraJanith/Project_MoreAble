// Seeded bookings and trips for GET /api/journeys/ongoing, as the SOS tests
// need them: whose booking is on which trip, and whether that trip's bus has
// started it. The route itself decides what is ongoing — nothing here does.
//
// Shapes follow the ongoing route's own tests (ongoingJourney+api.route.test).

import { createFakeFirestore } from './fakeFirestore';

export type SeedTripState = 'running' | 'not-started' | 'ended';

export interface SeedBooking {
    bookingId: string;
    userId: string;
    tripId: string;
    busId: string;
    trip: SeedTripState;
    /** Newer bookings sort first in any "most recent booking" lookup. */
    createdAt?: string;
    /** CONFIRMED unless a test needs a cancelled booking. */
    status?: 'CONFIRMED' | 'CANCELLED';
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** The plate a seeded bus carries: BUS-8899 -> NB-8899. */
export const plateOf = (busId: string) => busId.replace('BUS-', 'NB-');

function startedJourney(busId: string) {
    return {
        status: 'STARTED',
        startedAt: minutesAgo(30),
        endedAt: null,
        busId,
        scheduledDepartureAt: minutesAgo(25),
        scheduledArrivalAt: minutesAgo(-90),
        expiresAt: minutesAgo(-120),
    };
}

/**
 * A fake Firestore holding these bookings, their trips and their buses, plus
 * any `extra` collections a test needs alongside them (e.g. `users`).
 */
export function seedOngoingJourneys(bookings: SeedBooking[], extra: Record<string, Record<string, unknown>[]> = {}) {
    const trips = new Map<string, Record<string, unknown>>();

    for (const booking of bookings) {
        const journey =
            booking.trip === 'running'
                ? startedJourney(booking.busId)
                : booking.trip === 'ended'
                  ? { ...startedJourney(booking.busId), status: 'ENDED', endedAt: minutesAgo(5) }
                  : undefined;

        trips.set(booking.tripId, {
            tripId: booking.tripId,
            routeId: '177_KADUWELA_KOLLUPITIYA',
            busId: booking.busId,
            departureTime: '06:00',
            status: 'ACTIVE',
            ...(journey ? { journey } : {}),
        });
    }

    return createFakeFirestore({
        trips: [...trips.values()],
        bookings: bookings.map((booking) => ({
            bookingId: booking.bookingId,
            userId: booking.userId,
            tripId: booking.tripId,
            routeId: '177_KADUWELA_KOLLUPITIYA',
            busId: booking.busId,
            seatNumber: '05A',
            status: booking.status ?? 'CONFIRMED',
            journey: {
                routeNumber: '177',
                routeName: 'Kaduwela - Kollupitiya',
                startLocation: 'Kaduwela',
                endLocation: 'Kollupitiya',
                departureTime: '06:00',
                estimatedArrivalTime: '07:15',
            },
            vehicle: { numberPlate: plateOf(booking.busId), busModel: 'Viking', manufacturer: 'Ashok Leyland' },
            createdAt: booking.createdAt ?? '2026-09-20T12:00:00.000Z',
        })),
        vehicleLocations: [],
        buses: [...new Set(bookings.map((booking) => booking.busId))].map((busId) => ({ busId })),
        ...extra,
    });
}
