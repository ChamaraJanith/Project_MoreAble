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
// when it was reported under this trip's journey-sharing credential during THIS
// run (the location endpoint stamps tripId and the run's startedAt). A fix left
// over from the bus's previous trip, from an earlier run of the same trip, or
// sent outside a journey, is not shown as this trip's position (MOV-296).
//
// Freshness is reported, not judged: like journey search, the live block
// carries the fix's age and leaves "too old" to the reader. An old or missing
// fix never ends the journey — only End Journey or the window does.
//
// Reads only, and only the passenger's own bookings. The caller has already
// established, from the verified session, whose bookings these are
// (ongoingJourneyAuthorization); nothing here takes an id from a request.

import {
    Booking,
    OngoingJourneyBooking,
    OngoingJourneyFare,
    PassengerOngoingJourney,
} from '../../entities/booking/model/types';
import { createLiveSharingCaches, loadBookingActiveJourney, loadTrip } from './bookingLiveSharing';
import { createOngoingRouteCaches, loadOngoingJourneyRoute } from './ongoingJourneyRoute';
import { readPassengerJourneyCompletion } from './passengerJourneyRecord';
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
export function boardedBeforeRun(booking: any, startedAt: string): boolean {
    const boarded = parseTime(booking?.boardedAt);
    const started = parseTime(startedAt);
    return boarded !== null && started !== null && boarded < started;
}

/**
 * The ticket price only (MOV-297): the total, its currency and whether it was
 * an estimate. The rest of the breakdown — distance, concession type and
 * percentage, assistance fee, guardian pricing — stays out, since it can
 * reveal why a passenger was discounted. Null when no usable total is stored.
 */
function ongoingFareView(fare: any): OngoingJourneyFare | null {
    const totalFare = fare?.totalFare;

    if (typeof totalFare !== 'number' || !Number.isFinite(totalFare) || totalFare < 0) {
        return null;
    }

    return {
        totalFare,
        // Every fare the project calculates is in rupees (FareBreakdown).
        currency: 'LKR',
        isEstimate: fare.isEstimate === true,
    };
}

/**
 * The allow-listed booking fields (MOV-296). Built field by field rather than
 * spread, so nothing else stored on the document reaches the response.
 */
export function ongoingBookingView(booking: Booking): OngoingJourneyBooking {
    return {
        bookingId: booking.bookingId,
        userId: booking.userId,
        tripId: booking.tripId,
        routeId: booking.routeId,
        busId: booking.busId,
        seatNumber: booking.seatNumber,
        pairedSeatNumber: booking.pairedSeatNumber ?? null,
        status: booking.status,
        boardingStatus: booking.boardingStatus,
        boardedAt: booking.boardedAt,
        journey: booking.journey,
        vehicle: booking.vehicle,
        fare: ongoingFareView(booking.fare),
    };
}

function nonEmpty(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface OngoingJourneyLoadOptions {
    /**
     * Also send each journey's planned path (MOV-297). Off by default: the path
     * never changes while a journey runs, so the tracking screen asks for it
     * once and its live refreshes, like the Activities list, leave it out.
     */
    includeRoute?: boolean;
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
    now: Date = new Date(),
    { includeRoute = false }: OngoingJourneyLoadOptions = {}
): Promise<PassengerOngoingJourney[]> {
    const snapshot = await adminDb.collection('bookings').where('userId', '==', passengerId).get();
    const caches = createLiveSharingCaches();
    const routeCaches = createOngoingRouteCaches();

    const candidates = await Promise.all(
        snapshot.docs.map(async (doc: any): Promise<PassengerOngoingJourney | null> => {
            const data = doc.data() ?? {};
            const booking = { ...data, bookingId: nonEmpty(data.bookingId) ?? doc.id } as Booking;

            // Defence in depth: the query already filtered on this.
            if (booking.userId !== passengerId) return null;

            // Finished for this passenger (MOV-297) — by them, or when the bus
            // ended the run. A booking holds one journey: like a booking already
            // boarded on an earlier run, it is spent, so a later run of the
            // same timetable slot never brings it back to Ongoing.
            if (readPassengerJourneyCompletion(data)) return null;

            // CONFIRMED, on a readable trip, whose journey is running now.
            const activeJourney = await loadBookingActiveJourney(adminDb, booking, caches, now);

            if (!activeJourney || boardedBeforeRun(booking, activeJourney.startedAt)) {
                return null;
            }

            const trip = await loadTrip(adminDb, activeJourney.tripId, caches.trips);
            // The bus that started this run, which is the one sharing for it.
            const busId = nonEmpty(trip?.journey?.busId) ?? nonEmpty(trip?.busId);
            const location = busId ? await loadVehicleLocation(adminDb, busId, caches.locations) : null;
            // Exact trip AND exact run; never by bus or route alone.
            const tripLocation =
                location &&
                location.tripId === activeJourney.tripId &&
                location.journeyStartedAt === activeJourney.startedAt
                    ? location
                    : null;

            const journey: PassengerOngoingJourney = {
                booking: ongoingBookingView(booking),
                activeJourney,
                busId,
                liveStatus: buildLiveStatus(tripLocation, now),
            };

            if (includeRoute) {
                // The running trip's own route; the booking's copy only if the
                // trip names none.
                journey.route = await loadOngoingJourneyRoute(
                    adminDb,
                    nonEmpty(trip?.routeId) ?? nonEmpty(booking.routeId),
                    booking.journey?.startLocation,
                    booking.journey?.endLocation,
                    routeCaches
                );
            }

            return journey;
        })
    );

    return candidates
        .filter((journey): journey is PassengerOngoingJourney => journey !== null)
        .sort(
            (a, b) =>
                new Date(b.activeJourney.startedAt).getTime() - new Date(a.activeJourney.startedAt).getTime()
        );
}
