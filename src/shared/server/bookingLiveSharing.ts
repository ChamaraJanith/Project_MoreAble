// Whether a passenger's booked bus is sharing its location (MOV-294).
//
// The Activities screen needs one fact per booking: is the vehicle operating
// THIS booking's trip reporting its position? It is answered with the same
// association journey search uses (MOV-120):
//
//     booking.tripId -> trips/{tripId}.busId -> vehicleLocations/{busId}
//
// never by route, route number, number plate or stop names, so two buses on the
// same route can never be confused, and a passenger only ever learns about the
// bus running a trip they booked.
//
// The same trip read also answers the second question Activities asks: has
// THIS trip's journey been started, and is it still running? That comes from
// the persisted Start Journey record (trips/{tripId}.journey), not from the bus
// session and not from the location feed — see loadBookingActiveJourney.
//
// Nothing here writes, and no coordinate leaves this module. Where the bus is
// belongs to the live tracking work (MOV-295 / MOV-297) and its authorisation
// (MOV-296); the Activities list only needs to know that it is reporting.

import { BookingActiveJourney, BookingLiveSharing } from '../../entities/booking/model/types';
import { VehicleLocation } from '../../entities/bus/model/types';
import { isJourneyActive, journeyExpiresAt } from '../utils/journeyLifecycle';
import { loadVehicleLocation, locationAgeSeconds } from './vehicleLocations';

export interface LiveSharingCaches {
    /** Trip documents by tripId; null when unreadable. */
    trips: Map<string, Promise<any | null>>;
    locations: Map<string, Promise<VehicleLocation | null>>;
}

export function createLiveSharingCaches(): LiveSharingCaches {
    return { trips: new Map(), locations: new Map() };
}

/**
 * A trip document, read once per trip however many bookings share it, or null
 * when it cannot be read.
 */
function loadTrip(adminDb: any, tripId: string, cache: Map<string, Promise<any | null>>): Promise<any | null> {
    const cached = cache.get(tripId);

    if (cached) {
        return cached;
    }

    const pending: Promise<any | null> = adminDb
        .collection('trips')
        .doc(tripId)
        .get()
        .then((doc: any) => (doc?.exists ? doc.data() ?? null : null))
        .catch((error: any) => {
            console.error('Trip Read Error:', error);
            return null;
        });

    cache.set(tripId, pending);

    return pending;
}

/** The booking's tripId when it is a CONFIRMED booking on a named trip, else null. */
function confirmedTripId(booking: any): string | null {
    if (!booking || booking.status !== 'CONFIRMED') return null;
    const tripId = typeof booking.tripId === 'string' ? booking.tripId.trim() : '';
    return tripId || null;
}

/**
 * The bus currently assigned to a trip, or null.
 *
 * Read from the trip rather than taken from the booking's own busId snapshot:
 * if an admin reassigns the trip to another vehicle after the booking was made,
 * the bus now running it is the one whose location matters.
 */
function tripBusId(trip: any): string | null {
    const busId = trip?.busId;
    return typeof busId === 'string' && busId.trim() ? busId.trim() : null;
}

/**
 * The live-sharing block for one booking, or null when it does not apply.
 *
 * Only a CONFIRMED booking on a readable trip gets one: a cancelled booking is
 * no longer travelling, and a trip that cannot be found has no bus to ask
 * about. A read failure also yields null, so live data can never break the
 * booking history it is attached to.
 */
export async function loadBookingLiveSharing(
    adminDb: any,
    booking: any,
    caches: LiveSharingCaches,
    now: Date = new Date()
): Promise<BookingLiveSharing | null> {
    const tripId = confirmedTripId(booking);

    if (!tripId) {
        return null;
    }

    const busId = tripBusId(await loadTrip(adminDb, tripId, caches.trips));

    if (!busId) {
        return null;
    }

    const location = await loadVehicleLocation(adminDb, busId, caches.locations);

    if (!location) {
        return { tripId, busId, available: false };
    }

    const ageSeconds = locationAgeSeconds(location.recordedAt, now);

    return {
        tripId,
        busId,
        available: true,
        recordedAt: location.recordedAt,
        ...(ageSeconds === null ? {} : { locationAgeSeconds: ageSeconds }),
    };
}

/**
 * The running journey of this booking's own trip, or null.
 *
 * Read from trips/{booking.tripId}.journey — the record Start Journey persists —
 * so a journey is only ever reported against the exact trip that was started.
 * A booking on another trip of the same route, or on the same bus's other turn,
 * reads a different trip document and gets nothing. Sent only while running:
 * not ended, and within its window from the actual start.
 */
export async function loadBookingActiveJourney(
    adminDb: any,
    booking: any,
    caches: LiveSharingCaches,
    now: Date = new Date()
): Promise<BookingActiveJourney | null> {
    const tripId = confirmedTripId(booking);

    if (!tripId) {
        return null;
    }

    const journey = (await loadTrip(adminDb, tripId, caches.trips))?.journey;

    if (!isJourneyActive(journey, now)) {
        return null;
    }

    const expiresAt = journeyExpiresAt(journey);

    return expiresAt ? { tripId, startedAt: journey.startedAt, expiresAt: expiresAt.toISOString() } : null;
}
