// Sorting a passenger's bookings into Activities (MOV-294).
//
// A booking is not a journey. CONFIRMED only says a seat is held; it says
// nothing about whether the bus has set off. So neither tab is decided by the
// booking status alone:
//
//   ONGOING   — the bus pressed Start Journey on THIS booking's exact trip, and
//               that journey is still running: not ended with End Journey, and
//               before its scheduled service's arrival + grace (journeyLifecycle).
//   COMPLETED — the journey's completion was recorded (MOV-297): the
//               passenger pressed End Journey, or the bus ended the run while
//               theirs was still going. Failing that (journeys finished before
//               completions were recorded), the passenger was boarded by the
//               conductor (a real, dated event) and that trip's scheduled
//               arrival has since passed.
//
// Everything else — an unstarted or future trip, a cancelled booking, a booking
// that was never boarded — belongs to neither tab. It stays in the Booking tab,
// which is unchanged.
//
// Ongoing does not wait for the scheduled departure, and does not depend on the
// bus's device being signed in or on how recently it sent a position: a 06:00
// trip started at 02:52 is ongoing from 02:52, and stays so while the driver is
// logged out, until the 06:00 service's arrival + grace.
//
// The trip match itself is made on the server: `activeJourney` is read from
// trips/{booking.tripId}, so it can only describe the booking's own trip. This
// module re-checks that, and re-checks the window against the current time so a
// list left open drops a journey the moment it expires.

import { Booking, PassengerCompletedJourney, PassengerOngoingJourney } from '../../../entities/booking/model/types';
import { isJourneyActive } from '../../../shared/utils/journeyLifecycle';
import { apiTimeToMinutes } from '../../journey/utils/dateTime';

/** How long after the scheduled arrival a boarded journey still counts as unfinished. */
export const POST_ARRIVAL_GRACE_MINUTES = 60;

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60 * 1000;

export type ActivityState = 'ONGOING' | 'COMPLETED' | 'CANCELLED' | 'NOT_ACTIVE';

export interface ScheduledWindow {
    departure: Date;
    arrival: Date;
}

/**
 * The trip's scheduled departure and arrival on a given local calendar day.
 *
 * Arrival earlier in the day than departure means the trip runs past midnight,
 * so it lands on the next day. Returns null when either time is unreadable.
 */
export function scheduledTimesOn(booking: Booking, day: Date): ScheduledWindow | null {
    const departureMinutes = apiTimeToMinutes(booking.journey?.departureTime);
    const arrivalMinutes = apiTimeToMinutes(booking.journey?.estimatedArrivalTime);

    if (departureMinutes === null || arrivalMinutes === null) {
        return null;
    }

    const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const departure = new Date(midnight.getTime() + departureMinutes * MS_PER_MINUTE);
    const arrivalOffset = arrivalMinutes < departureMinutes ? arrivalMinutes + MINUTES_PER_DAY : arrivalMinutes;
    const arrival = new Date(midnight.getTime() + arrivalOffset * MS_PER_MINUTE);

    return { departure, arrival };
}

/**
 * Whether the exact trip this booking is for has a running journey.
 *
 * The journey block must name this booking's own trip: one resolved for any
 * other trip — even one on the same route, or the same bus's other turn — is
 * ignored, never borrowed.
 */
export function isBookedTripRunning(booking: Booking, now: Date): boolean {
    const journey = booking.activeJourney;

    if (!journey || !booking.tripId || journey.tripId !== booking.tripId) {
        return false;
    }

    return isJourneyActive(
        { status: 'STARTED', startedAt: journey.startedAt, endedAt: null, expiresAt: journey.expiresAt },
        now
    );
}

/**
 * Whether the passenger actually made this journey and it has finished.
 *
 * Boarding is the only dated journey event the system records (the conductor's
 * QR scan sets `boardedAt`), so it anchors the trip to a real day. The journey
 * counts as finished once that day's scheduled arrival, plus grace, has passed.
 * A booking that was never boarded is not a completed journey — it may have
 * been missed, or may still be in the future; nothing stored tells them apart.
 * Ending or expiring the bus's journey does not complete anyone's trip.
 */
export function isJourneyCompleted(booking: Booking, now: Date): boolean {
    if (booking.status !== 'CONFIRMED' || booking.boardingStatus !== 'BOARDED' || !booking.boardedAt) {
        return false;
    }

    const boardedAt = new Date(booking.boardedAt);

    if (Number.isNaN(boardedAt.getTime())) {
        return false;
    }

    const times = scheduledTimesOn(booking, boardedAt);

    if (!times) {
        return false;
    }

    return now.getTime() > times.arrival.getTime() + POST_ARRIVAL_GRACE_MINUTES * MS_PER_MINUTE;
}

/** Which Activities tab, if any, a booking belongs to at `now`. */
export function deriveActivityState(booking: Booking, now: Date): ActivityState {
    if (booking.status === 'CANCELLED') {
        return 'CANCELLED';
    }

    if (booking.status !== 'CONFIRMED') {
        return 'NOT_ACTIVE';
    }

    // A recorded completion (MOV-297) is final: the passenger ended it, or it
    // finished when the bus ended the run. Checked before Ongoing, since the
    // bus may still be running for everyone else.
    if (booking.passengerJourney?.status === 'COMPLETED') {
        return 'COMPLETED';
    }

    // Checked before Completed: while the bus is still running this trip, a
    // passenger who has boarded is on it, whatever the timetable says.
    if (isBookedTripRunning(booking, now)) {
        return 'ONGOING';
    }

    if (isJourneyCompleted(booking, now)) {
        return 'COMPLETED';
    }

    return 'NOT_ACTIVE';
}

export interface ActivityGroups {
    ongoing: Booking[];
    completed: Booking[];
}

/**
 * Splits a passenger's bookings into the two Activities tabs.
 *
 * Bookings belonging to anyone other than `passengerId` are dropped outright.
 * The history endpoint already filters by passenger; this keeps the screen
 * correct even if it were handed a wider list.
 *
 * Ongoing is most recently started first. Completed is most recent first, by
 * boarding time.
 */
export function groupActivities(bookings: Booking[], passengerId: string, now: Date): ActivityGroups {
    const ongoing: Booking[] = [];
    const completed: Booking[] = [];

    if (!passengerId) {
        return { ongoing, completed };
    }

    for (const booking of bookings) {
        if (booking.userId !== passengerId) continue;

        const state = deriveActivityState(booking, now);

        if (state === 'ONGOING') ongoing.push(booking);
        else if (state === 'COMPLETED') completed.push(booking);
    }

    ongoing.sort(
        (a, b) =>
            new Date(b.activeJourney?.startedAt ?? 0).getTime() - new Date(a.activeJourney?.startedAt ?? 0).getTime()
    );
    completed.sort((a, b) => finishedAt(b) - finishedAt(a));

    return { ongoing, completed };
}

/** When a completed journey finished: its recorded completion, else its boarding. */
function finishedAt(booking: Booking): number {
    return new Date(booking.passengerJourney?.completedAt ?? booking.boardedAt ?? 0).getTime();
}

/**
 * The two tabs, with Ongoing decided by GET /api/journeys/ongoing (MOV-295).
 *
 * The server has already matched each booking to its own running trip; each
 * one is still re-checked here, so a list left open drops a journey the moment
 * its window runs out. The history then only decides Completed — a booking the
 * server did not report as ongoing has its history `activeJourney` ignored, so
 * the two tabs are never decided by two different answers.
 *
 * The ongoing response carries only a trimmed booking (MOV-296), so each card
 * shows the passenger's full booking from the history, joined by bookingId,
 * with the server's activeJourney on it.
 *
 * Completions come from GET /api/journeys/completed (MOV-297) the same way:
 * a booking the server reports as completed is Completed, with the server's
 * record on it, whatever the history's own copy of the field says.
 */
export function groupActivitiesWithOngoing(
    history: Booking[],
    ongoingJourneys: PassengerOngoingJourney[],
    passengerId: string,
    now: Date,
    completedJourneys: PassengerCompletedJourney[] = []
): ActivityGroups {
    const activeById = new Map(ongoingJourneys.map((journey) => [journey.booking?.bookingId, journey.activeJourney]));
    const completedById = new Map(completedJourneys.map((journey) => [journey.booking?.bookingId, journey.completion]));
    const withServerJourney = history.map((booking) => ({
        ...booking,
        activeJourney: activeById.get(booking.bookingId),
        passengerJourney: completedById.get(booking.bookingId),
    }));
    const { ongoing, completed } = groupActivities(withServerJourney, passengerId, now);

    return { ongoing, completed };
}
