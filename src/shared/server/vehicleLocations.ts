// Reading the live vehicle position (MOV-120).
//
// MOV-121 owns the write side: it authenticates the reporter, validates the
// coordinates and stores one document per bus. This is the read side, and it
// deliberately derives nothing the stored record does not already contain.
//
// The association is always by bus:
//
//     trip -> trip.busId -> vehicleLocations/{busId}
//
// never by route, route number, number plate or position in a list. A trip can
// only ever be shown the position of the vehicle actually operating it.

import { VehicleLocation } from '../../entities/bus/model/types';
import { JourneyLiveStatus } from '../../entities/route/model/types';

/**
 * Written by `PUT /api/buses/:busId/location`, keyed by busId, latest state
 * only. The name is repeated here rather than imported because the constant on
 * the write side belongs to a route module; see the MOV-120 report.
 */
export const VEHICLE_LOCATIONS_COLLECTION = 'vehicleLocations';

const LOCATION_UNAVAILABLE_MESSAGE =
    'Live location is not available for this vehicle yet.';

/**
 * Whether a stored document is a position that can actually be used.
 *
 * The ingestion endpoint validates everything it writes, so this is about
 * records that reached the collection some other way — a manual console edit,
 * or a document left behind by an earlier shape. A half-written record is
 * treated as no position at all, so a NaN or an unparsable timestamp can never
 * reach a passenger screen.
 */
function isUsableLocation(data: any): boolean {
    return (
        !!data &&
        Number.isFinite(data.latitude) &&
        Number.isFinite(data.longitude) &&
        typeof data.recordedAt === 'string' &&
        !Number.isNaN(new Date(data.recordedAt).getTime())
    );
}

/**
 * The latest reported position for one bus, or null when it has never reported.
 *
 * Never falls back to a stop coordinate, a route geometry point or a previous
 * scheduled value: if the vehicle has not reported, the honest answer is that
 * its position is unknown.
 *
 * `cache` memoises the in-flight read rather than its result, so several trips
 * resolved concurrently on the same vehicle share one Firestore read instead of
 * each starting an identical one before the first returns.
 *
 * A read failure yields null rather than throwing. Live data is an addition to
 * journey search, and an outage in it must not take down a search that worked
 * before this data existed.
 */
export async function loadVehicleLocation(
    adminDb: any,
    busId: string,
    cache?: Map<string, Promise<VehicleLocation | null>>
): Promise<VehicleLocation | null> {
    // A trip naming no bus has no vehicle to locate, and asking Firestore for an
    // empty document path throws rather than returning nothing.
    if (typeof busId !== 'string' || !busId.trim()) {
        return null;
    }

    const key = busId.trim();
    const cached = cache?.get(key);

    if (cached) {
        return cached;
    }

    const pending: Promise<VehicleLocation | null> = adminDb
        .collection(VEHICLE_LOCATIONS_COLLECTION)
        .doc(key)
        .get()
        .then((doc: any) => {
            const data = doc?.exists ? doc.data() : null;

            if (!isUsableLocation(data)) {
                return null;
            }

            // Rebuilt field by field rather than spread, so anything else that
            // ends up in the document stays out of the passenger response.
            return {
                busId: key,
                latitude: data.latitude,
                longitude: data.longitude,
                recordedAt: data.recordedAt,
            };
        })
        .catch((error: any) => {
            console.error('Vehicle Location Read Error:', error);
            return null;
        });

    cache?.set(key, pending);

    return pending;
}

/**
 * How long ago the GPS fix was taken, in whole seconds.
 *
 * A fact, not a judgement — nothing here decides whether that age still counts
 * as live. Returns null when the timestamp cannot be read.
 */
export function locationAgeSeconds(recordedAt: string, now: Date = new Date()): number | null {
    const fixTime = new Date(recordedAt).getTime();

    if (Number.isNaN(fixTime) || Number.isNaN(now.getTime())) {
        return null;
    }

    return Math.round((now.getTime() - fixTime) / 1000);
}

/**
 * Turns a stored position into the live block carried by a journey option.
 *
 * Absence is reported explicitly rather than as an empty object, so a caller
 * can distinguish a vehicle that is not reporting from a field it forgot to
 * read.
 */
export function buildLiveStatus(
    location: VehicleLocation | null,
    now: Date = new Date()
): JourneyLiveStatus {
    if (!location) {
        return { available: false, message: LOCATION_UNAVAILABLE_MESSAGE };
    }

    const ageSeconds = locationAgeSeconds(location.recordedAt, now);

    return {
        available: true,
        location,
        ...(ageSeconds === null ? {} : { locationAgeSeconds: ageSeconds }),
    };
}
