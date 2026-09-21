// Ending a journey and reading it back as history (MOV-297).
//
// Kept apart from the screens, like ongoingJourneyTracking, so each rule is
// testable without a renderer: End Journey asks first and runs once, and a
// completed journey is described only from what was actually recorded.

import {
    OngoingJourneyBooking,
    PassengerCompletedJourney,
    PassengerJourneyCompletion,
    PassengerJourneyCompletionReason,
} from '../../../entities/booking/model/types';
import { formatDurationMinutes, formatFriendlyDate } from '../../journey/utils/dateTime';

// ------------------------------------------------------------------
// End Journey
// ------------------------------------------------------------------

export type EndJourneyOutcome<T> =
    | { status: 'CANCELLED' }
    | { status: 'COMPLETED'; result: T }
    | { status: 'FAILED'; error: unknown };

export interface EndJourneyAction<T, A> {
    /** Asks, then ends with `args`. A second call while one is in progress joins it. */
    run: (args: A) => Promise<EndJourneyOutcome<T>>;
    isRunning: () => boolean;
}

/**
 * The End Journey button's behaviour.
 *
 * Nothing is sent until the passenger confirms; Cancel changes nothing. Taps
 * while the dialog is open or the request is out join the one in progress, so
 * an eager double tap sends one request. (The server is idempotent as well —
 * this just avoids asking it twice.)
 */
export function createEndJourneyAction<T, A = void>(
    confirm: () => Promise<boolean>,
    end: (args: A) => Promise<T>
): EndJourneyAction<T, A> {
    let pending: Promise<EndJourneyOutcome<T>> | null = null;

    const run = (args: A) => {
        if (pending) return pending;

        pending = (async (): Promise<EndJourneyOutcome<T>> => {
            try {
                if (!(await confirm())) return { status: 'CANCELLED' };
                return { status: 'COMPLETED', result: await end(args) };
            } catch (error) {
                return { status: 'FAILED', error };
            } finally {
                pending = null;
            }
        })();

        return pending;
    };

    return { run, isRunning: () => pending !== null };
}

export const END_JOURNEY_DIALOG = {
    title: 'End Journey?',
    message: 'Are you sure you have reached your destination? Your journey will move from Ongoing to Completed.',
    cancel: 'Cancel',
    confirm: 'End Journey',
} as const;

// ------------------------------------------------------------------
// Completed journeys
// ------------------------------------------------------------------

/** The completed journey the passenger opened, from their own authorised list. */
export function findCompletedJourney(
    journeys: PassengerCompletedJourney[] | null | undefined,
    bookingId: string | null | undefined
): PassengerCompletedJourney | null {
    if (!bookingId || !Array.isArray(journeys)) return null;
    return journeys.find((journey) => journey?.booking?.bookingId === bookingId) ?? null;
}

/** How it finished, in the passenger's words. */
export function completionReasonLabel(reason: PassengerJourneyCompletionReason | null | undefined): string {
    return reason === 'PASSENGER' ? 'Completed by you' : 'Completed when the bus journey ended';
}

/** The caption for the completion time, matching how it finished. */
export function completionTimeCaption(reason: PassengerJourneyCompletionReason | null | undefined): string {
    return reason === 'PASSENGER' ? 'You completed it at' : 'Journey completed at';
}

/** An ISO time's calendar day, e.g. 'Mon, 21 Sep 2026'; null when unreadable. */
export function formatJourneyDay(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : formatFriendlyDate(date);
}

/** '8.4 km', or null when the planned distance was not measurable. */
export function formatDistanceKm(distanceKm: number | null | undefined): string | null {
    return typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0 ? `${distanceKm} km` : null;
}

/**
 * How long the passenger was on board, e.g. '38m', or null.
 *
 * Only from two recorded server times on the same run: the conductor's boarding
 * scan and the completion. Without a boarding scan on this run there is no
 * reliable start for THIS passenger — the bus's own start is when it left the
 * first stop, which may be long before they got on — so nothing is shown.
 */
export function timeOnBoardLabel(
    booking: Pick<OngoingJourneyBooking, 'boardedAt'>,
    completion: Pick<PassengerJourneyCompletion, 'journeyStartedAt' | 'completedAt'>
): string | null {
    const boarded = booking.boardedAt ? new Date(booking.boardedAt).getTime() : NaN;
    const runStarted = new Date(completion.journeyStartedAt).getTime();
    const completed = new Date(completion.completedAt).getTime();

    if (![boarded, runStarted, completed].every(Number.isFinite)) return null;
    if (boarded < runStarted || boarded > completed) return null;

    return formatDurationMinutes(Math.round((completed - boarded) / 60_000));
}
