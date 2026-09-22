// Passenger bus ratings (Community Feedback; data source for MOV-79/MOV-80).
//
// A passenger rates the bus they travelled on, 1 to 5 stars, after their own
// journey has completed. Rating is a step AFTER completion and never part of
// it: nothing here reads or writes the booking's completion record except to
// check it exists, and no journey waits for a rating.
//
// What may be rated is decided by the server alone:
//
//     verified passenger session                 (authoriseOngoingJourneyAccess)
//        -> a booking owned by that passenger    (bookings/{bookingId}.userId)
//        -> its completion record                (bookings/{bookingId}.passengerJourney)
//        -> the bus and the run recorded there   (busId, tripId + journeyStartedAt)
//
// The request only names which of the passenger's own bookings, and the stars.
// A busId it sends is checked against the record, never used in its place.
//
// Stored one document per passenger per run, keyed by both, so the key itself
// refuses a second rating for the same journey — including from a second seat
// booked on the same run — while a later run of the same bus is a new key.

import {
    BusRating,
    BusRatingContext,
    BusRatingSummary,
    BusRatingValue,
    isBusRatingValue,
} from '../../entities/rating/model/types';
import { PassengerRatingTally, tallyPassengerRatings } from '../utils/accessibility';
import { readPassengerJourneyCompletion } from './passengerJourneyRecord';

export const BUS_RATINGS_COLLECTION = 'busRatings';

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The rating document's id: one passenger, one run.
 *
 * The same `a__b` shape as a report vote's id. ISO times hold no '/', so the
 * run's startedAt is safe inside a document id as it is.
 */
export function busRatingDocumentId(passengerId: string, tripId: string, journeyStartedAt: string): string {
    return `${passengerId}__${tripId}__${journeyStartedAt}`;
}

/** A stored rating, rebuilt field by field; null when it cannot be read as one. */
export function readBusRating(data: any): BusRating | null {
    if (!data || !isBusRatingValue(data.rating)) return null;

    const ratingId = text(data.ratingId);
    const passengerId = text(data.passengerId);
    const bookingId = text(data.bookingId);
    const busId = text(data.busId);
    const tripId = text(data.tripId);
    const journeyStartedAt = text(data.journeyStartedAt);
    const createdAt = text(data.createdAt);

    if (!ratingId || !passengerId || !bookingId || !busId || !tripId || !journeyStartedAt || !createdAt) return null;

    return { ratingId, passengerId, bookingId, busId, tripId, journeyStartedAt, rating: data.rating, createdAt };
}

// ------------------------------------------------------------------
// The completed journey being rated
// ------------------------------------------------------------------

export type RatableJourneyResult =
    | {
          kind: 'OK';
          bookingId: string;
          booking: Record<string, any>;
          busId: string;
          tripId: string;
          journeyStartedAt: string;
          completedAt: string;
      }
    /** Not one of this passenger's bookings — or no such booking. Indistinguishable on purpose. */
    | { kind: 'NOT_FOUND' }
    /** Theirs, but the journey has not completed. */
    | { kind: 'NOT_COMPLETED' }
    /** Completed, but the record names no bus to rate. */
    | { kind: 'NO_BUS' };

/**
 * The passenger's own completed journey on `bookingId`, and the bus and run
 * its completion record names.
 *
 * Read by key and then checked for ownership, so another passenger's booking
 * id answers exactly like one that does not exist.
 */
export async function loadRatableJourney(adminDb: any, passengerId: string, bookingId: string): Promise<RatableJourneyResult> {
    const snap = await adminDb.collection('bookings').doc(bookingId).get();
    const data = snap?.exists ? snap.data() : null;

    if (!data || data.userId !== passengerId) return { kind: 'NOT_FOUND' };

    const completion = readPassengerJourneyCompletion(data);
    if (!completion) return { kind: 'NOT_COMPLETED' };

    const busId = text(completion.busId);
    if (!busId) return { kind: 'NO_BUS' };

    return {
        kind: 'OK',
        bookingId: text(data.bookingId) ?? bookingId,
        booking: data,
        busId,
        tripId: completion.tripId,
        journeyStartedAt: completion.journeyStartedAt,
        completedAt: completion.completedAt,
    };
}

// ------------------------------------------------------------------
// Reading: what the Rate this bus screen shows
// ------------------------------------------------------------------

export type BusRatingContextResult =
    | { kind: 'OK'; context: BusRatingContext }
    | Exclude<RatableJourneyResult, { kind: 'OK' }>;

/**
 * The bus the passenger travelled on, from the fleet record, plus their own
 * rating for that run if they already gave one.
 *
 * Only an allow-listed part of the bus is returned — never the document, which
 * holds the bus login credential. When the bus record cannot be read, the
 * booking's own vehicle snapshot names it and facilities are left unknown
 * rather than guessed.
 */
export async function loadBusRatingContext(adminDb: any, passengerId: string, bookingId: string): Promise<BusRatingContextResult> {
    const journey = await loadRatableJourney(adminDb, passengerId, bookingId);
    if (journey.kind !== 'OK') return journey;

    const [busSnap, ratingSnap] = await Promise.all([
        adminDb.collection('buses').doc(journey.busId).get(),
        adminDb
            .collection(BUS_RATINGS_COLLECTION)
            .doc(busRatingDocumentId(passengerId, journey.tripId, journey.journeyStartedAt))
            .get(),
    ]);

    const bus = busSnap?.exists ? busSnap.data() ?? null : null;
    const snapshot = journey.booking.vehicle ?? {};
    const trip = journey.booking.journey ?? {};
    const facilities = bus?.accessibilityFacilities;
    const existing = ratingSnap?.exists ? readBusRating(ratingSnap.data()) : null;

    return {
        kind: 'OK',
        context: {
            journey: {
                bookingId: journey.bookingId,
                tripId: journey.tripId,
                journeyStartedAt: journey.journeyStartedAt,
                completedAt: journey.completedAt,
                routeNumber: text(trip.routeNumber),
                routeName: text(trip.routeName),
                origin: text(trip.startLocation),
                destination: text(trip.endLocation),
            },
            bus: {
                busId: journey.busId,
                numberPlate: text(bus?.numberPlate) ?? text(snapshot.numberPlate),
                busModel: text(bus?.busModel) ?? text(snapshot.busModel),
                manufacturer: text(bus?.manufacturer) ?? text(snapshot.manufacturer),
                accessibilityFacilities: facilities && typeof facilities === 'object' ? facilities : null,
            },
            myRating: existing ? { rating: existing.rating, createdAt: existing.createdAt } : null,
        },
    };
}

// ------------------------------------------------------------------
// Submitting
// ------------------------------------------------------------------

export interface BusRatingSubmission {
    bookingId: string;
    /** Optional: the bus the screen showed. Checked against the record, never stored from here. */
    busId?: string | null;
    rating: unknown;
}

export type BusRatingSubmitResult =
    | { kind: 'RATED'; rating: BusRating }
    | { kind: 'INVALID_RATING' }
    /** A rating for this passenger's journey on this run already exists; it is kept as it was. */
    | { kind: 'ALREADY_RATED'; rating: BusRating | null }
    /** The busId sent is not the bus that ran this journey. */
    | { kind: 'BUS_MISMATCH' }
    | Exclude<RatableJourneyResult, { kind: 'OK' }>;

/**
 * Stores the signed-in passenger's rating for the bus on one of their own
 * completed journeys.
 *
 * Written in a transaction that reads the rating's key first, so two taps or a
 * retried request leave exactly one rating, never an overwritten one.
 */
export async function submitBusRating(
    adminDb: any,
    passengerId: string,
    submission: BusRatingSubmission,
    now: Date = new Date()
): Promise<BusRatingSubmitResult> {
    if (!isBusRatingValue(submission.rating)) return { kind: 'INVALID_RATING' };
    const stars: BusRatingValue = submission.rating;

    const journey = await loadRatableJourney(adminDb, passengerId, submission.bookingId);
    if (journey.kind !== 'OK') return journey;

    const claimedBus = text(submission.busId);
    if (claimedBus && claimedBus !== journey.busId) return { kind: 'BUS_MISMATCH' };

    const ratingId = busRatingDocumentId(passengerId, journey.tripId, journey.journeyStartedAt);
    const ratingRef = adminDb.collection(BUS_RATINGS_COLLECTION).doc(ratingId);

    return adminDb.runTransaction(async (transaction: any): Promise<BusRatingSubmitResult> => {
        const existing = await transaction.get(ratingRef);

        if (existing?.exists) {
            return { kind: 'ALREADY_RATED', rating: readBusRating(existing.data()) };
        }

        const rating: BusRating = {
            ratingId,
            passengerId,
            bookingId: journey.bookingId,
            busId: journey.busId,
            tripId: journey.tripId,
            journeyStartedAt: journey.journeyStartedAt,
            rating: stars,
            createdAt: now.toISOString(),
        };

        transaction.set(ratingRef, rating);
        return { kind: 'RATED', rating };
    });
}

// ------------------------------------------------------------------
// Reading: how one bus stands with its passengers (MOV-80 / MOV-116)
// ------------------------------------------------------------------

/**
 * A tally as a passenger-facing summary: the plain mean on the 1–5 scale.
 *
 * NOT `computeRatingScore`. That one exists to feed the accessibility score
 * (MOV-79): it pulls the mean toward a neutral 3 in proportion to how few
 * ratings there are, then remaps 1–5 onto 0–100, and it is weighted at 20%
 * alongside facilities and community reports. Useful for ranking buses against
 * each other; wrong as an answer to "what did passengers give this bus". A
 * single 5-star rating is 5.0 here and nowhere near 100 there.
 *
 * Left unrounded. The mean of 5, 4 and 4 is 4.333…, and the screen decides how
 * many decimals to show (one, today) — rounding here as well would round twice
 * and could move the displayed figure by a tenth.
 *
 * `average` is null exactly when `count` is 0. Never 0: the scale starts at 1,
 * so a zero is not a rating any passenger could have given, and showing one for
 * a bus nobody has rated would be the worst possible verdict rather than the
 * absence of evidence it really is.
 */
export function busRatingSummaryFromTally(
    tally: PassengerRatingTally | null | undefined,
    busId: string
): BusRatingSummary {
    const count = tally?.count ?? 0;

    return {
        busId,
        average: count > 0 ? (tally as PassengerRatingTally).total / count : null,
        count,
    };
}

/**
 * The average rating and rating count for the bus stored at `buses/{busId}`.
 *
 * One single-field equality query, exactly as `loadAccessibilityScoreEvidence`
 * reads the same collection — Firestore indexes that automatically, so no
 * composite index is needed and no other bus's ratings are ever fetched.
 *
 * Which ratings count is not decided here. `readBusRating` rebuilds each stored
 * document and returns null for anything malformed, and `tallyPassengerRatings`
 * then counts only whole 1–5 ratings naming this bus. Both are the functions the
 * accessibility score already uses, so a rating that counts toward the average a
 * passenger reads is exactly one that counts toward the score.
 *
 * Reading never writes: no score is recalculated and no history entry is
 * recorded (MOV-113 is written by the routes that CHANGE the evidence).
 */
export async function loadBusRatingSummary(adminDb: any, busId: string): Promise<BusRatingSummary> {
    const key = text(busId);

    // Nothing to query on. Answered as an unrated bus rather than refused: the
    // id is echoed back trimmed, exactly as the success path below returns it.
    if (!key) return { busId: typeof busId === 'string' ? busId.trim() : '', average: null, count: 0 };

    const snapshot = await adminDb
        .collection(BUS_RATINGS_COLLECTION)
        .where('busId', '==', key)
        .get();

    const tally = tallyPassengerRatings(
        (snapshot?.docs ?? []).map((doc: any) => readBusRating(doc.data())),
        key
    );

    return busRatingSummaryFromTally(tally, key);
}
