// Reading a passenger's journey completion off a booking (MOV-297).
//
// The record is written once by passengerJourneyCompletion and stored on the
// booking as `passengerJourney`. Kept in its own module so the ongoing-journey
// reader can skip completed bookings without depending on the code that
// completes them.

import {
    PassengerJourneyCompletion,
    PassengerJourneyCompletionReason,
} from '../../entities/booking/model/types';

/** The booking field the completion is stored under. */
export const PASSENGER_JOURNEY_FIELD = 'passengerJourney';

const REASONS: PassengerJourneyCompletionReason[] = ['PASSENGER', 'BUS_JOURNEY_ENDED'];

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isTime(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/**
 * The booking's completion record, or null when it has none.
 *
 * Rebuilt field by field, so nothing else stored under the field reaches a
 * response. A record that cannot be read as a completion — no time, no run —
 * is treated as absent; it is never repaired from other fields.
 */
export function readPassengerJourneyCompletion(booking: any): PassengerJourneyCompletion | null {
    const record = booking?.[PASSENGER_JOURNEY_FIELD];

    if (!record || record.status !== 'COMPLETED') return null;

    const tripId = text(record.tripId);
    const reason = REASONS.includes(record.completionReason) ? (record.completionReason as PassengerJourneyCompletionReason) : null;

    if (!tripId || !reason || !isTime(record.completedAt) || !isTime(record.journeyStartedAt)) {
        return null;
    }

    const distance = record.plannedDistanceKm;

    return {
        status: 'COMPLETED',
        tripId,
        busId: text(record.busId) ?? '',
        journeyStartedAt: record.journeyStartedAt,
        completedAt: record.completedAt,
        completionReason: reason,
        journeyStops: Array.isArray(record.journeyStops)
            ? record.journeyStops.filter((stop: unknown): stop is string => typeof stop === 'string' && !!stop.trim())
            : [],
        plannedDistanceKm: typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 ? distance : null,
    };
}
