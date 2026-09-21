// Finishing a passenger's journey (MOV-297).
//
// Two different events, never confused:
//
//   PASSENGER END — the passenger presses End Journey. Completes THEIR booking
//                   on the running trip, and nothing else: the bus's journey on
//                   the trip keeps running, its location sharing carries on,
//                   and every other passenger stays ongoing.
//
//   BUS END       — the bus presses End Journey (MOV-294). The trip's journey
//                   ends; every passenger still ongoing on that run is then
//                   completed with the bus's end time. Anyone who had already
//                   finished keeps their own record, untouched.
//
// The record lives on the booking (`passengerJourney`, see
// PassengerJourneyCompletion) and names the exact run — tripId plus the trip
// journey's startedAt — because tripId alone is a daily timetable slot.
//
// Written inside a transaction that re-reads the booking and the trip, and only
// when the booking has no record yet. So a double tap, a retried request, or a
// passenger and bus ending at the same moment all leave exactly one record,
// with the time of whichever was processed first. Times are the server's.
//
// Every id comes from the verified session and the server's own records. The
// only thing a client may send is which of its OWN running bookings it means,
// and that only selects among journeys already authorised for the session.

import {
    PassengerCompletedJourney,
    PassengerJourneyCompletion,
    PassengerJourneyCompletionReason,
} from '../../entities/booking/model/types';
import { isJourneyActive, TripJourneyRecord } from '../utils/journeyLifecycle';
import { createOngoingRouteCaches, loadOngoingJourneyRoute, loadPlannedJourney, OngoingRouteCaches } from './ongoingJourneyRoute';
import { boardedBeforeRun, loadPassengerOngoingJourneys, ongoingBookingView } from './passengerOngoingJourney';
import { PASSENGER_JOURNEY_FIELD, readPassengerJourneyCompletion } from './passengerJourneyRecord';

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseTime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

interface PlannedSnapshot {
    journeyStops: string[];
    plannedDistanceKm: number | null;
}

/**
 * The planned journey to keep with the record: the passenger's stops and the
 * distance Journey Planning shows. Best-effort — a route that cannot be read
 * still lets the journey complete, with just its two endpoints and no distance.
 */
async function plannedSnapshot(adminDb: any, routeId: string | null, booking: any, caches: OngoingRouteCaches): Promise<PlannedSnapshot> {
    const board = text(booking?.journey?.startLocation);
    const alight = text(booking?.journey?.endLocation);
    const fallback = { journeyStops: [board, alight].filter((stop): stop is string => !!stop && stop !== '—'), plannedDistanceKm: null };

    try {
        const planned = await loadPlannedJourney(adminDb, routeId, board, alight, caches);
        return planned ? { journeyStops: planned.journeyStops, plannedDistanceKm: planned.plannedDistanceKm } : fallback;
    } catch (error) {
        console.error('Planned Journey Snapshot Error:', error);
        return fallback;
    }
}

function completionRecord(
    run: { tripId: string; busId: string; startedAt: string },
    completedAt: string,
    completionReason: PassengerJourneyCompletionReason,
    planned: PlannedSnapshot
): PassengerJourneyCompletion {
    return {
        status: 'COMPLETED',
        tripId: run.tripId,
        busId: run.busId,
        journeyStartedAt: run.startedAt,
        completedAt,
        completionReason,
        journeyStops: planned.journeyStops,
        plannedDistanceKm: planned.plannedDistanceKm,
    };
}

// ------------------------------------------------------------------
// Passenger End Journey
// ------------------------------------------------------------------

export type PassengerCompletionResult =
    /** Recorded now. */
    | { kind: 'COMPLETED'; bookingIds: string[]; completion: PassengerJourneyCompletion }
    /** It was already finished — by an earlier request, or by the bus. Nothing written. */
    | { kind: 'ALREADY_COMPLETED'; bookingIds: string[]; completion: PassengerJourneyCompletion }
    /** Nothing of this passenger's is running (or the named booking is not theirs). */
    | { kind: 'NO_ONGOING_JOURNEY' }
    /** Several journeys are running and none was named. */
    | { kind: 'AMBIGUOUS' };

/**
 * Completes the signed-in passenger's own running journey.
 *
 * `requestedBookingId`, when given, only picks among the passenger's own
 * ongoing journeys; one belonging to anybody else is simply not found. All of
 * the passenger's bookings on that same run (several seats) finish together —
 * it is one journey for them.
 *
 * Inside the transaction:
 *   - the run is still running        -> PASSENGER, at the server's now;
 *   - the bus ended that run first    -> BUS_JOURNEY_ENDED, at the bus's time;
 *   - a record is already there       -> left as it is, reported back.
 */
export async function completePassengerJourney(
    adminDb: any,
    passengerId: string,
    requestedBookingId: string | null,
    now: Date = new Date()
): Promise<PassengerCompletionResult> {
    const ongoing = await loadPassengerOngoingJourneys(adminDb, passengerId, now);
    const target = requestedBookingId
        ? ongoing.find((journey) => journey.booking.bookingId === requestedBookingId)
        : ongoing.length === 1
          ? ongoing[0]
          : undefined;

    if (!target) {
        if (!requestedBookingId && ongoing.length > 1) return { kind: 'AMBIGUOUS' };
        if (!requestedBookingId) return { kind: 'NO_ONGOING_JOURNEY' };

        // Not running any more: finished already (a repeated tap, or the bus
        // ended first), or never this passenger's. Read from their own
        // bookings only, so another passenger's booking id reveals nothing.
        const own = await adminDb.collection('bookings').where('userId', '==', passengerId).get();
        const doc = own.docs.find((candidate: any) => (text(candidate.data()?.bookingId) ?? candidate.id) === requestedBookingId);
        const completion = doc ? readPassengerJourneyCompletion(doc.data()) : null;

        return completion
            ? { kind: 'ALREADY_COMPLETED', bookingIds: [requestedBookingId], completion }
            : { kind: 'NO_ONGOING_JOURNEY' };
    }

    const run = target.activeJourney;
    const sameRun = ongoing.filter(
        (journey) => journey.activeJourney.tripId === run.tripId && journey.activeJourney.startedAt === run.startedAt
    );
    const bookingIds = sameRun.map((journey) => journey.booking.bookingId);

    const tripRef = adminDb.collection('trips').doc(run.tripId);
    const trip = (await tripRef.get())?.data?.() ?? null;
    const caches = createOngoingRouteCaches();
    const planned = await plannedSnapshot(adminDb, text(trip?.routeId) ?? text(target.booking.routeId), target.booking, caches);

    return adminDb.runTransaction(async (transaction: any) => {
        const tripSnap = await transaction.get(tripRef);
        const bookingRefs = bookingIds.map((id) => adminDb.collection('bookings').doc(id));
        const bookingSnaps = await Promise.all(bookingRefs.map((ref: any) => transaction.get(ref)));

        const journey: TripJourneyRecord | undefined = tripSnap?.exists ? tripSnap.data()?.journey : undefined;
        const existing = bookingSnaps.map((snap: any) => (snap?.exists ? readPassengerJourneyCompletion(snap.data()) : null));
        const firstExisting = existing.find((record): record is PassengerJourneyCompletion => record !== null) ?? null;

        // The run the passenger was on is no longer the trip's latest: nothing
        // can be said about it now beyond any record it already has.
        if (!journey || journey.startedAt !== run.startedAt) {
            return firstExisting
                ? { kind: 'ALREADY_COMPLETED', bookingIds, completion: firstExisting }
                : { kind: 'NO_ONGOING_JOURNEY' };
        }

        const stored: Partial<TripJourneyRecord> = journey;
        const busEndedAt = !isJourneyActive(stored, now) && stored.status === 'ENDED' ? text(stored.endedAt) : null;
        const busEndedFirst = busEndedAt !== null;
        const record = completionRecord(
            { tripId: run.tripId, busId: text(journey.busId) ?? target.busId ?? '', startedAt: run.startedAt },
            busEndedAt ?? now.toISOString(),
            busEndedFirst ? 'BUS_JOURNEY_ENDED' : 'PASSENGER',
            planned
        );

        let wrote = false;
        bookingSnaps.forEach((snap: any, index: number) => {
            const data = snap?.exists ? snap.data() : null;
            // Re-checked inside the transaction: still theirs, still confirmed,
            // and not finished in the meantime.
            if (!data || data.userId !== passengerId || data.status !== 'CONFIRMED' || existing[index]) return;
            transaction.update(bookingRefs[index], { [PASSENGER_JOURNEY_FIELD]: record });
            wrote = true;
        });

        if (!wrote) {
            return firstExisting
                ? { kind: 'ALREADY_COMPLETED', bookingIds, completion: firstExisting }
                : { kind: 'NO_ONGOING_JOURNEY' };
        }

        return busEndedFirst
            ? { kind: 'ALREADY_COMPLETED', bookingIds, completion: record }
            : { kind: 'COMPLETED', bookingIds, completion: record };
    });
}

// ------------------------------------------------------------------
// Bus End Journey
// ------------------------------------------------------------------

/**
 * Completes every passenger still ongoing on a run the bus has just ended.
 *
 * Exactly the bookings that were ongoing on it (MOV-295): CONFIRMED, on this
 * trip, not boarded on an earlier run, and not already completed. A booking
 * made after the run ended belongs to a later run and is left alone. Each is
 * written in its own transaction that re-reads it, so one completed by the
 * passenger a moment earlier keeps its own time and reason.
 *
 * Returns how many were completed. Never throws: ending the bus's journey has
 * already happened and must not be reported as failed because of this.
 */
export async function completePassengersForEndedRun(adminDb: any, tripId: string, journey: TripJourneyRecord): Promise<number> {
    if (!journey || journey.status !== 'ENDED' || !journey.endedAt || !journey.startedAt) return 0;

    try {
        const endedAt = parseTime(journey.endedAt);
        const snapshot = await adminDb.collection('bookings').where('tripId', '==', tripId).get();
        const trip = (await adminDb.collection('trips').doc(tripId).get())?.data?.() ?? null;
        const caches = createOngoingRouteCaches();
        const run = { tripId, busId: text(journey.busId) ?? '', startedAt: journey.startedAt };

        const results = await Promise.all(
            snapshot.docs.map(async (doc: any) => {
                const data = doc.data() ?? {};
                const created = parseTime(data.createdAt);

                if (
                    data.status !== 'CONFIRMED' ||
                    readPassengerJourneyCompletion(data) ||
                    boardedBeforeRun(data, journey.startedAt) ||
                    (created !== null && endedAt !== null && created > endedAt)
                ) {
                    return false;
                }

                const planned = await plannedSnapshot(adminDb, text(trip?.routeId) ?? text(data.routeId), data, caches);
                const record = completionRecord(run, journey.endedAt as string, 'BUS_JOURNEY_ENDED', planned);
                const ref = adminDb.collection('bookings').doc(doc.id);

                return adminDb.runTransaction(async (transaction: any) => {
                    const fresh = await transaction.get(ref);
                    const current = fresh?.exists ? fresh.data() : null;
                    if (!current || current.status !== 'CONFIRMED' || readPassengerJourneyCompletion(current)) return false;
                    transaction.update(ref, { [PASSENGER_JOURNEY_FIELD]: record });
                    return true;
                });
            })
        );

        return results.filter(Boolean).length;
    } catch (error) {
        console.error('Passenger Journey Completion Error:', error);
        return 0;
    }
}

// ------------------------------------------------------------------
// Completed journeys
// ------------------------------------------------------------------

/**
 * The signed-in passenger's completed journeys, most recently finished first.
 *
 * Only bookings carrying a completion record, and only through the same
 * allow-listed booking view as an ongoing journey (MOV-296) — never the raw
 * document. `includeRoute` adds the planned path for the detail screen, drawn
 * from the stops saved when the journey finished.
 */
export async function loadPassengerCompletedJourneys(
    adminDb: any,
    passengerId: string,
    { includeRoute = false }: { includeRoute?: boolean } = {}
): Promise<PassengerCompletedJourney[]> {
    const snapshot = await adminDb.collection('bookings').where('userId', '==', passengerId).get();
    const caches = createOngoingRouteCaches();

    const journeys = await Promise.all(
        snapshot.docs.map(async (doc: any): Promise<PassengerCompletedJourney | null> => {
            const data = doc.data() ?? {};
            if (data.userId !== passengerId) return null;

            const completion = readPassengerJourneyCompletion(data);
            if (!completion) return null;

            const booking = { ...data, bookingId: text(data.bookingId) ?? doc.id };
            const journey: PassengerCompletedJourney = { booking: ongoingBookingView(booking), completion };

            if (includeRoute) {
                journey.route = await loadOngoingJourneyRoute(
                    adminDb,
                    text(booking.routeId),
                    booking.journey?.startLocation,
                    booking.journey?.endLocation,
                    caches,
                    completion.journeyStops
                );
            }

            return journey;
        })
    );

    return journeys
        .filter((journey): journey is PassengerCompletedJourney => journey !== null)
        .sort((a, b) => new Date(b.completion.completedAt).getTime() - new Date(a.completion.completedAt).getTime());
}
