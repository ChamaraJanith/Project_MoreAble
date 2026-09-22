// The evidence the accessibility score weighs beyond the bus record (MOV-79).
//
// Reads, for one bus, the community reports and passenger ratings that name it,
// and hands them to the pure tallies in shared/utils/accessibility. All the
// arithmetic lives there; this only decides what is read.
//
//     reports     where busId == <bus document id>   -> VERIFIED only, POSITIVE vs ISSUE
//     busRatings  where busId == <bus document id>   -> each passenger's rating of a run
//
// Each is a single-field equality query, so neither needs a composite index;
// status is filtered after the read, the same approach GET /api/reports takes.
//
// No `unavailableFacilities` is produced: Community Reporting does not yet record
// which facility an issue concerns or when it is resolved. Nothing is guessed
// from a report's category or description in the meantime.

import {
    AccessibilityScoreEvidence,
    tallyPassengerRatings,
    tallyVerifiedCommunityReports,
} from '../utils/accessibility';
import { BUS_RATINGS_COLLECTION, readBusRating } from './busRating';

// The collection the report routes write to. Declared here rather than imported
// from reportFeedback, which would pull the auth middleware into every route
// that shows a score.
const REPORTS_COLLECTION = 'reports';

/** A document id Firestore can be asked about. */
function usableBusId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The community and rating evidence for the bus stored at `buses/{busId}`.
 *
 * `busId` is the bus DOCUMENT id: the value a report's `busId` and a rating's
 * `busId` both hold. The optional cache is per request — the same bus commonly
 * runs several trips — and holds the in-flight read, like `loadVehicleLocation`.
 */
export async function loadAccessibilityScoreEvidence(
    adminDb: any,
    busId: string,
    cache?: Map<string, Promise<AccessibilityScoreEvidence>>
): Promise<AccessibilityScoreEvidence> {
    if (!usableBusId(busId)) return {};

    const key = busId.trim();
    const cached = cache?.get(key);
    if (cached) return cached;

    const pending = Promise.all([
        adminDb.collection(REPORTS_COLLECTION).where('busId', '==', key).get(),
        adminDb.collection(BUS_RATINGS_COLLECTION).where('busId', '==', key).get(),
    ]).then(([reportsSnap, ratingsSnap]: any[]) => ({
        community: tallyVerifiedCommunityReports(
            (reportsSnap?.docs ?? []).map((doc: any) => doc.data()),
            key
        ),
        ratings: tallyPassengerRatings(
            (ratingsSnap?.docs ?? []).map((doc: any) => readBusRating(doc.data())),
            key
        ),
    }));

    cache?.set(key, pending);
    return pending;
}
