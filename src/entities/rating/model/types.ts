/**
 * Passenger bus ratings (Community Feedback).
 *
 * A passenger's 1–5 star rating of the bus they actually travelled on, given
 * once their own journey has completed (MOV-297). It is the "User Ratings"
 * data source that MOV-79 (accessibility score) and MOV-80 (community ratings)
 * read later; nothing here scores, averages or ranks anything.
 *
 * One rating per passenger per run. A run is `tripId` + `journeyStartedAt`
 * (MOV-294/MOV-296): tripId alone is a daily timetable slot, so the same
 * passenger can rate the same bus again on a later run, but never twice for
 * the same one — even when they held several seats (bookings) on it, since
 * those complete together as one journey.
 */

import { BusAccessibilityFacilities } from '../../bus/model/types';

export const BUS_RATING_MIN = 1;
export const BUS_RATING_MAX = 5;

/** A whole number of stars, 1 to 5. */
export type BusRatingValue = 1 | 2 | 3 | 4 | 5;

/**
 * Whether an arbitrary value is a rating the API will store.
 *
 * Strictly a number: '5' is refused rather than coerced, and so are 0,
 * fractions, negatives and anything above 5. Skipping is not a rating at all —
 * nothing is sent and nothing stored — so there is no 0.
 */
export function isBusRatingValue(value: unknown): value is BusRatingValue {
    return typeof value === 'number' && Number.isInteger(value) && value >= BUS_RATING_MIN && value <= BUS_RATING_MAX;
}

/**
 * A stored rating: `busRatings/{ratingId}`.
 *
 * Every id is the server's: the passenger from the verified session, and the
 * bus and run from the booking's completion record (`passengerJourney`),
 * never from the request body.
 */
export interface BusRating {
    /** `${passengerId}__${tripId}__${journeyStartedAt}` — see busRatingDocumentId. */
    ratingId: string;
    passengerId: string;
    /** The completed booking the rating was given from. */
    bookingId: string;
    /** The bus that ran the journey, as recorded when it completed. */
    busId: string;
    tripId: string;
    /** The run: the trip journey's startedAt. */
    journeyStartedAt: string;
    rating: BusRatingValue;
    /** ISO 8601, server time. */
    createdAt: string;
}

/**
 * What the Rate this bus screen shows, from GET /api/journeys/completed/rating.
 *
 * The bus is resolved on the server from the completed journey — the screen
 * never chooses which bus is rated.
 */
export interface BusRatingContext {
    journey: {
        bookingId: string;
        tripId: string;
        journeyStartedAt: string;
        completedAt: string;
        routeNumber: string | null;
        routeName: string | null;
        origin: string | null;
        destination: string | null;
    };
    bus: {
        busId: string;
        numberPlate: string | null;
        busModel: string | null;
        manufacturer: string | null;
        /** The fleet record's own facilities; null when the bus record could not be read. */
        accessibilityFacilities: BusAccessibilityFacilities | null;
    };
    /** This passenger's rating for this run, when they already gave one. */
    myRating: Pick<BusRating, 'rating' | 'createdAt'> | null;
}
