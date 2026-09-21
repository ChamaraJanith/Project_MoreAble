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
// Nothing here writes, and no coordinate leaves this module. Where the bus is
// belongs to the live tracking work (MOV-295 / MOV-297) and its authorisation
// (MOV-296); the Activities list only needs to know that it is reporting.

import { BookingLiveSharing } from '../../entities/booking/model/types';
import { VehicleLocation } from '../../entities/bus/model/types';
import { loadVehicleLocation, locationAgeSeconds } from './vehicleLocations';

export interface LiveSharingCaches {
    trips: Map<string, Promise<string | null>>;
    locations: Map<string, Promise<VehicleLocation | null>>;
}

export function createLiveSharingCaches(): LiveSharingCaches {
    return { trips: new Map(), locations: new Map() };
}

/**
 * The bus currently assigned to a trip, or null when the trip cannot be read.
 *
 * Read from the trip rather than taken from the booking's own busId snapshot:
 * if an admin reassigns the trip to another vehicle after the booking was made,
 * the bus now running it is the one whose location matters.
 */
function loadTripBusId(
    adminDb: any,
    tripId: string,
    cache: Map<string, Promise<string | null>>
): Promise<string | null> {
    const cached = cache.get(tripId);

    if (cached) {
        return cached;
    }

    const pending: Promise<string | null> = adminDb
        .collection('trips')
        .doc(tripId)
        .get()
        .then((doc: any) => {
            const busId = doc?.exists ? doc.data()?.busId : null;
            return typeof busId === 'string' && busId.trim() ? busId.trim() : null;
        })
        .catch((error: any) => {
            console.error('Trip Read Error:', error);
            return null;
        });

    cache.set(tripId, pending);

    return pending;
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
    if (!booking || booking.status !== 'CONFIRMED') {
        return null;
    }

    const tripId = typeof booking.tripId === 'string' ? booking.tripId.trim() : '';

    if (!tripId) {
        return null;
    }

    const busId = await loadTripBusId(adminDb, tripId, caches.trips);

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
