// The trips a signed-in bus can start (MOV-294).
//
// A bus is never tied to a route; it relates to routes only through its trips
// ("turns"), each of which is one scheduled run at one time. The Trip Control
// tab lists exactly those trips, joined with the route each one runs, so the
// driver starts a SPECIFIC trip rather than "sharing location" for no trip in
// particular.
//
// Built only from stored data — GET /api/trips?busId= and each trip's route.
// Nothing here invents a trip, a time or a stop name.
//
// No React, like the rest of `driver/utils`, so the rules are testable.

import { Route } from '../../../entities/route/model/types';
import { Trip } from '../../../entities/trip/model/types';
import { TripJourneyRecord } from '../../../shared/utils/journeyLifecycle';
import { apiTimeToMinutes } from '../../journey/utils/dateTime';

/** The route fields a trip card needs. */
export type AssignedTripRoute = Pick<Route, 'routeId' | 'routeNumber' | 'routeName' | 'startLocation' | 'endLocation'>;

/** One startable trip, as the Trip Control tab shows it. */
export interface AssignedTrip {
    /** The trip's own id — the identity a started journey carries. */
    tripId: string;
    busId: string;
    routeId: string;
    turnNumber: number | null;
    /** 'HH:MM', exactly as scheduled. */
    departureTime: string;
    /** 'HH:MM', or '' when the trip has none. */
    estimatedArrivalTime: string;
    /** Route details; null when the route could not be read. */
    routeNumber: string | null;
    routeName: string | null;
    origin: string | null;
    destination: string | null;
    /**
     * The trip's persisted Start/End Journey record, exactly as stored, or null
     * if it was never started. This is how a device that signs in again finds
     * the journey it left running. Whether it is still running is decided by
     * journeyLifecycle, never by this device's session.
     */
    journey: TripJourneyRecord | null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The trips assigned to `busId`, soonest departure first.
 *
 * Kept to this bus even if the list handed in is wider, and to trips an admin
 * has left ACTIVE: an INACTIVE trip is withdrawn from service and must not be
 * startable. A trip whose route cannot be found is still listed — its time
 * alone identifies it — with the route fields left empty rather than guessed.
 */
export function buildAssignedTrips(
    busId: string,
    trips: Trip[],
    routes: Record<string, AssignedTripRoute | undefined>
): AssignedTrip[] {
    if (!text(busId)) {
        return [];
    }

    const seen = new Set<string>();
    const assigned: AssignedTrip[] = [];

    for (const trip of trips) {
        const tripId = text(trip?.tripId);

        if (!tripId || seen.has(tripId)) continue;
        if (trip.busId !== busId) continue;
        if (trip.status && trip.status !== 'ACTIVE') continue;
        if (apiTimeToMinutes(trip.departureTime) === null) continue;

        seen.add(tripId);

        const route = routes[trip.routeId];

        assigned.push({
            tripId,
            busId,
            routeId: trip.routeId,
            turnNumber: typeof trip.turnNumber === 'number' ? trip.turnNumber : null,
            departureTime: trip.departureTime,
            estimatedArrivalTime: text(trip.estimatedArrivalTime) ?? '',
            routeNumber: text(route?.routeNumber),
            routeName: text(route?.routeName),
            origin: text(route?.startLocation),
            destination: text(route?.endLocation),
            journey: trip.journey ?? null,
        });
    }

    return assigned.sort(
        (a, b) => (apiTimeToMinutes(a.departureTime) ?? 0) - (apiTimeToMinutes(b.departureTime) ?? 0)
    );
}
