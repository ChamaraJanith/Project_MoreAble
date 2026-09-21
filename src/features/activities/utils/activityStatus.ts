// Sorting a passenger's bookings into Activities (MOV-294).
//
// A booking is not a journey. CONFIRMED only says a seat is held; it says
// nothing about whether the bus has set off. So neither tab is decided by the
// booking status alone:
//
//   ONGOING   — the bus operating THIS booking's trip is sharing its location
//               right now (Bus Dashboard, MOV-267), and it is within that
//               trip's scheduled window.
//   COMPLETED — the passenger was boarded by the conductor (a real, dated
//               event) and that trip's scheduled arrival has since passed.
//
// Everything else — a future or unstarted booking, a cancelled one, a booking
// that was never boarded — belongs to neither tab. It stays in the Booking tab,
// which is unchanged.
//
// The trip-to-bus match itself is made on the server (bookingLiveSharing): the
// live block on a booking can only describe the bus running that booking's own
// trip. This module re-checks that the block was resolved for this booking's
// trip, and adds the two things the server leaves to the reader: whether the
// report is recent enough to mean "sharing now", and whether now is this
// trip's time.

import { Booking } from '../../../entities/booking/model/types';
import { apiTimeToMinutes } from '../../journey/utils/dateTime';

/**
 * How old the latest report may be and still count as "sharing now".
 *
 * The Bus Dashboard publishes every 30 s (DEFAULT_TRACKING_INTERVAL_MS), and
 * stopping tracking does not delete the stored position — it just stops being
 * refreshed. Five minutes tolerates several missed publishes on a weak signal
 * while still letting a bus that stopped sharing drop out of Ongoing.
 */
export const LIVE_SHARING_FRESH_SECONDS = 5 * 60;

/**
 * How early before the scheduled departure a sharing bus counts as this trip.
 *
 * A driver typically starts sharing at the depot shortly before setting off.
 * Kept short on purpose: the same bus runs several trips ("turns") a day, and a
 * wide window would let its earlier turn light up a later booking.
 */
export const PRE_DEPARTURE_WINDOW_MINUTES = 30;

/** How long after the scheduled arrival a late-running trip still counts. */
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
 * Whether `now` falls inside the trip's scheduled window, padded by the lead
 * and grace periods above.
 *
 * Bookings carry a time of day but no travel date (see MOV-295), so this
 * follows the convention the boarding reminder already uses for them: the
 * journey is the one running today. Yesterday is checked too, so a trip that
 * departed before midnight is still recognised after it.
 */
export function isWithinScheduledWindow(booking: Booking, now: Date): boolean {
    for (const dayOffset of [0, -1]) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
        const times = scheduledTimesOn(booking, day);

        if (!times) {
            return false;
        }

        const opens = times.departure.getTime() - PRE_DEPARTURE_WINDOW_MINUTES * MS_PER_MINUTE;
        const closes = times.arrival.getTime() + POST_ARRIVAL_GRACE_MINUTES * MS_PER_MINUTE;

        if (now.getTime() >= opens && now.getTime() <= closes) {
            return true;
        }
    }

    return false;
}

/**
 * Seconds since the bus's latest GPS fix, or null when it cannot be told.
 *
 * Measured from `recordedAt` against `now`, so a list left open keeps ageing
 * correctly; the server's own figure is the fallback when the fix time is
 * missing. A negative age means the bus phone's clock is ahead, and reads as
 * "just now" — the same reading liveStatus gives it.
 */
function reportAgeSeconds(booking: Booking, now: Date): number | null {
    const sharing = booking.liveSharing;
    const fixTime = sharing?.recordedAt ? new Date(sharing.recordedAt).getTime() : NaN;

    if (!Number.isNaN(fixTime)) {
        return Math.max(0, Math.round((now.getTime() - fixTime) / 1000));
    }

    const serverAge = sharing?.locationAgeSeconds;
    return typeof serverAge === 'number' && Number.isFinite(serverAge) ? Math.max(0, serverAge) : null;
}

/**
 * Whether the bus operating this booking's own trip is sharing its location now.
 *
 * The live block must have been resolved for this booking's trip: a block for
 * any other trip — even one on the same route — is ignored, never borrowed.
 */
export function isBookedBusSharingLive(booking: Booking, now: Date): boolean {
    const sharing = booking.liveSharing;

    if (!sharing || !sharing.available || sharing.tripId !== booking.tripId) {
        return false;
    }

    const age = reportAgeSeconds(booking, now);
    return age !== null && age <= LIVE_SHARING_FRESH_SECONDS;
}

/**
 * Whether the passenger actually made this journey and it has finished.
 *
 * Boarding is the only dated journey event the system records (the conductor's
 * QR scan sets `boardedAt`), so it anchors the trip to a real day. The journey
 * counts as finished once that day's scheduled arrival, plus grace, has passed.
 * A booking that was never boarded is not a completed journey — it may have
 * been missed, or may still be in the future; nothing stored tells them apart.
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

    if (isJourneyCompleted(booking, now)) {
        return 'COMPLETED';
    }

    if (isBookedBusSharingLive(booking, now) && isWithinScheduledWindow(booking, now)) {
        return 'ONGOING';
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
 * Ongoing is ordered by scheduled departure, soonest first. Completed is most
 * recent first, by boarding time.
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
            (apiTimeToMinutes(a.journey?.departureTime) ?? 0) - (apiTimeToMinutes(b.journey?.departureTime) ?? 0)
    );
    completed.sort((a, b) => new Date(b.boardedAt ?? 0).getTime() - new Date(a.boardedAt ?? 0).getTime());

    return { ongoing, completed };
}
