// A passenger's ongoing journey and where its bus is (MOV-295).
//
// "Ongoing" is not a booking status. A CONFIRMED booking only holds a seat; the
// journey is ongoing when the bus pressed Start Journey on THAT booking's exact
// trip and the journey is still running (MOV-294, journeyLifecycle):
//
//     passenger (from the session)
//        -> bookings where userId == passengerId, CONFIRMED
//        -> trips/{booking.tripId}.journey   running?
//        -> vehicleLocations/{journey.busId} reported for this tripId?
//
// Matched by tripId at every step — never by route, route number or plate — so
// a passenger booked on TRIP-B is never handed TRIP-A, even on the same route
// with the same bus.
//
// The position is the bus's latest stored fix, and only counts for this trip
// when it was reported under this trip's journey-sharing credential (the
// location endpoint stamps it). A fix left over from the bus's previous trip,
// or sent outside a journey, is not shown as this trip's position.
//
// Freshness is reported, not judged: like journey search, the live block
// carries the fix's age and leaves "too old" to the reader. An old or missing
// fix never ends the journey — only End Journey or the window does.
//
// Reads only, and only the passenger's own bookings. Who else may see a bus's
// position is MOV-296.

import { Booking, PassengerOngoingJourney } from '../../entities/booking/model/types';
import { createLiveSharingCaches, loadBookingActiveJourney, loadTrip } from './bookingLiveSharing';
import { buildLiveStatus, loadVehicleLocation } from './vehicleLocations';

function parseTime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Whether the booking was already used on an EARLIER run of its trip.
 *
 * A trip is a daily timetable slot and a booking names the slot, not a day, so
 * the persisted journey is the only thing dating a run. A conductor's boarding
 * scan (server time) from before this run started belongs to a previous run:
 * that booking is a completed journey, not this one.
 */
function boardedBeforeRun(booking: any, startedAt: string): boolean {
    const boarded = parseTime(booking?.boardedAt);
    const started = parseTime(startedAt);
    return boarded !== null && started !== null && boarded < started;
}

function nonEmpty(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The signed-in passenger's ongoing journeys, most recently started first.
 *
 * Usually zero or one; more only when the passenger holds several seats on a
 * running trip, or bookings on two trips that are running at once. Each is
 * reported for its own booking so none is silently dropped.
 *
 * Bookings with a missing or unreadable trip, no running journey, or a
 * cancelled status are left out. The bookings query itself is allowed to throw,
 * so a database outage is an error rather than "no journey".
 */
export async function loadPassengerOngoingJourneys(
    adminDb: any,
    passengerId: string,
    now: Date = new Date()
): Promise<PassengerOngoingJourney[]> {
    const snapshot = await adminDb.collection('bookings').where('userId', '==', passengerId).get();
    const caches = createLiveSharingCaches();

    const candidates = await Promise.all(
        snapshot.docs.map(async (doc: any): Promise<PassengerOngoingJourney | null> => {
            const data = doc.data() ?? {};
            const booking = { ...data, bookingId: nonEmpty(data.bookingId) ?? doc.id } as Booking;

            // Defence in depth: the query already filtered on this.
            if (booking.userId !== passengerId) return null;

            // CONFIRMED, on a readable trip, whose journey is running now.
            const activeJourney = await loadBookingActiveJourney(adminDb, booking, caches, now);

            if (!activeJourney || boardedBeforeRun(booking, activeJourney.startedAt)) {
                return null;
            }

            const trip = await loadTrip(adminDb, activeJourney.tripId, caches.trips);
            // The bus that started this run, which is the one sharing for it.
            const busId = nonEmpty(trip?.journey?.busId) ?? nonEmpty(trip?.busId);
            const location = busId ? await loadVehicleLocation(adminDb, busId, caches.locations) : null;
            const tripLocation = location && location.tripId === activeJourney.tripId ? location : null;

            return {
                booking,
                activeJourney,
                busId,
                liveStatus: buildLiveStatus(tripLocation, now),
            };
        })
    );

    return candidates
        .filter((journey): journey is PassengerOngoingJourney => journey !== null)
        .sort(
            (a, b) =>
                new Date(b.activeJourney.startedAt).getTime() - new Date(a.activeJourney.startedAt).getTime()
        );
}
