// The estimated travel time a PASSENGER actually experiences (MOV-88).
//
// WHY THIS EXISTS.
// Everything the project stored before this describes a whole route. A trip's
// `departureTime` is when the bus leaves the route's FIRST stop and its
// `estimatedArrivalTime` is when it reaches the LAST one; `Route.estimatedDuration`
// is free text saying the same thing. So a passenger boarding halfway along was
// shown the whole route's duration — for
//
//     A -(8m)- B -(6m)- C -(12m)- D -(15m)- E
//
// a B -> E search reported 41 minutes when the journey is 33.
//
// The fix is not a different label. It is measuring the journey from the stop the
// passenger boards to the stop they alight at, by summing the configured
// stop-to-stop timings in `Route.segmentDurationsMinutes` over exactly that span
// — the field added for this story, and the only stop-level timing the project
// holds.
//
// WHAT THIS DELIBERATELY DOES NOT DO.
// It never invents a timing. Nothing here divides a route total between stops,
// derives minutes from coordinates, distance, an assumed speed, or a stop count,
// or reads the OSRM road duration — that is a car's driving time along the road
// and the project keeps it firmly separate from scheduled bus times. When the
// configured timings do not cover the journey, the answer is `UNKNOWN` and the
// screen shows no duration at all. An honest gap is better for a passenger than
// a confident wrong number.
//
// It also owns no route-level meaning. `Route.estimatedDuration` and a trip's
// stored times keep describing the whole route everywhere else in the app
// (admin route list, admin route details, admin trip details) — this module adds
// a passenger-journey duration alongside them rather than redefining either.
//
// Pure and dependency-free apart from the project's own formatting and
// normalising helpers, so it is fully testable without a renderer.

import { normalizeLocation } from '../../../shared/utils/location';
import {
    addMinutesToApiTime,
    formatDurationMinutes,
    minutesBetweenApiTimes,
} from './dateTime';

/**
 * One continuous ride on one vehicle.
 *
 * Modelled as a leg rather than as "the journey" because a journey with a
 * transfer is two rides, and the parent story requires transfers to be shown
 * when they exist. The journey search matches only routes carrying the passenger
 * from origin to destination without a change, so today every journey has
 * exactly one leg — but the arithmetic below is written over the legs it is
 * given, so a multi-leg journey is measured from its real legs rather than from
 * the first bus's route total.
 */
export interface JourneyLegInput {
    /**
     * The FULL ordered stop list of this leg's route.
     *
     * Array order is the authoritative sequence: a route document stores its
     * stops in travel order and the project has no separate sequence field.
     */
    stops: string[];
    /**
     * The route's configured stop-to-stop minutes, aligned to `stops` — entry
     * `i` covers `stops[i]` to `stops[i + 1]`.
     */
    segmentDurationsMinutes?: (number | null)[] | null;
    /** Where the passenger boards this leg. */
    boardStop: string;
    /** Where the passenger leaves it. */
    alightStop: string;
    /** Scheduled departure from `stops[0]`, as 'HH:MM'. */
    scheduledDepartureTime?: string | null;
    /** Scheduled arrival at the last entry of `stops`, as 'HH:MM'. */
    scheduledArrivalTime?: string | null;
}

/**
 * Where a duration came from, so a screen can say what it is showing and a test
 * can prove which rule fired.
 */
export type JourneyTimingSource =
    /** Summed from the route's configured stop-to-stop timings. Always preferred. */
    | 'CONFIGURED_SEGMENTS'
    /**
     * The trip's own scheduled departure-to-arrival gap, used ONLY when the
     * passenger travels the entire route. Then the whole route IS their journey,
     * so this is their duration and not an approximation of it.
     */
    | 'WHOLE_ROUTE_SCHEDULE'
    /** Not derivable from stored data. No duration is reported. */
    | 'UNKNOWN';

/** Why a leg could not be measured. Null when it could. */
export type JourneyTimingProblem =
    /** The boarded or alighted stop is not on the route. */
    | 'STOP_NOT_ON_ROUTE'
    /** The alighting stop comes at or before the boarding stop in route order. */
    | 'REVERSED_STOPS'
    /** A gap the journey crosses has no configured timing. */
    | 'SEGMENTS_INCOMPLETE';

export interface JourneyLegTiming {
    /** Minutes on board this leg, or null when unknown. */
    durationMinutes: number | null;
    source: JourneyTimingSource;
    problem: JourneyTimingProblem | null;
    /**
     * 'HH:MM' the bus reaches the passenger's OWN boarding stop, when derivable.
     *
     * Never the route's departure time standing in for it: that is only
     * reported here when the passenger genuinely boards at the route's first
     * stop. Null means unknown, and a screen must render nothing rather than
     * reach for the trip's own value.
     */
    boardingTime: string | null;
    /**
     * 'HH:MM' it reaches their OWN alighting stop, when derivable.
     *
     * Reported from the trip's stored arrival only when they alight at the
     * route's last stop. Null otherwise — the route's arrival belongs to a stop
     * this passenger never reaches.
     */
    alightingTime: string | null;
    /** Stops travelled on this leg, in route order, boarding and alighting included. */
    travelledStops: string[];
}

export interface JourneyTiming {
    /** Total minutes of the whole journey: every leg plus any wait between them. */
    durationMinutes: number | null;
    /** The project's duration format ("33m", "1h 10m"), or null when unknown. */
    durationLabel: string | null;
    source: JourneyTimingSource;
    problem: JourneyTimingProblem | null;
    /** When the passenger boards their first leg. */
    boardingTime: string | null;
    /** When they arrive at their final destination. */
    alightingTime: string | null;
    /**
     * Vehicle changes: one fewer than the number of legs.
     *
     * Counted from the legs the search actually returned, never guessed. Zero is
     * a real answer — a direct journey — not a missing one.
     */
    transferCount: number;
    /** Minutes spent waiting at each transfer, in order. Empty for a direct journey. */
    transferWaitMinutes: number[];
    perLeg: JourneyLegTiming[];
}

/** A configured timing that can actually be added up. */
function usableMinutes(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Position of a stop in a route's ordered stop list, matched the way the search matches it. */
function indexOfStop(stops: string[], stopName: unknown): number {
    const target = normalizeLocation(stopName);
    if (!target) return -1;

    return stops.findIndex((stop) => normalizeLocation(stop) === target);
}

/**
 * Sums the configured timings for the gaps between two positions.
 *
 * Returns null if ANY gap crossed is untimed — a partial sum would understate
 * the journey, which is exactly the kind of plausible-looking wrong number this
 * module exists to avoid.
 */
function sumSegments(
    segments: (number | null)[] | null | undefined,
    fromIndex: number,
    toIndex: number
): number | null {
    if (!Array.isArray(segments)) return null;
    if (toIndex <= fromIndex) return 0;

    let total = 0;

    for (let i = fromIndex; i < toIndex; i++) {
        const minutes = usableMinutes(segments[i]);
        if (minutes === null) return null;
        total += minutes;
    }

    return total;
}

const UNMEASURABLE_LEG: JourneyLegTiming = {
    durationMinutes: null,
    source: 'UNKNOWN',
    problem: 'STOP_NOT_ON_ROUTE',
    boardingTime: null,
    alightingTime: null,
    travelledStops: [],
};

/**
 * Measures one leg: how long the passenger is on board, and when they board and
 * alight.
 *
 * Rules, in order:
 *
 *   1. Sum the configured stop-to-stop timings between the boarded and alighted
 *      stops. This is the passenger's own journey and nothing else.
 *   2. Only if the passenger travels the WHOLE route, fall back to the trip's
 *      scheduled departure-to-arrival gap. That is not an estimate of their
 *      journey — for a first-stop-to-last-stop passenger it is their journey.
 *   3. Otherwise report UNKNOWN. A partial journey on a route nobody has timed
 *      gets no duration rather than the route's total.
 *
 * Boarding and alighting times need the timings BEFORE the boarding stop too,
 * since the stored departure time belongs to the route's first stop. When those
 * are missing the duration can still be known while the clock times are not, so
 * they are reported independently.
 */
export function resolveLegTiming(leg: JourneyLegInput): JourneyLegTiming {
    const stops = Array.isArray(leg?.stops) ? leg.stops : [];
    const boardIndex = indexOfStop(stops, leg?.boardStop);
    const alightIndex = indexOfStop(stops, leg?.alightStop);

    if (boardIndex === -1 || alightIndex === -1) {
        return UNMEASURABLE_LEG;
    }

    // The search itself refuses a route whose origin comes after its destination,
    // so this is a malformed input rather than a journey. Reported instead of
    // being turned into a negative duration.
    if (alightIndex <= boardIndex) {
        return { ...UNMEASURABLE_LEG, problem: 'REVERSED_STOPS' };
    }

    const travelledStops = stops.slice(boardIndex, alightIndex + 1);
    const segments = Array.isArray(leg.segmentDurationsMinutes)
        ? leg.segmentDurationsMinutes
        : null;

    const scheduledDeparture = leg.scheduledDepartureTime ?? null;
    const scheduledArrival = leg.scheduledArrivalTime ?? null;

    // Which end of the route, if either, the passenger shares with the trip.
    //
    // The stored departure time is the moment the bus leaves `stops[0]` and the
    // stored arrival is when it reaches the last stop. So those two clock times
    // are this passenger's own if and only if they board first or alight last —
    // for any other stop they belong to somebody else's part of the journey and
    // must never be shown as this passenger's.
    const boardsAtRouteStart = boardIndex === 0;
    const alightsAtRouteEnd = alightIndex === stops.length - 1;

    // 1. The passenger's own span.
    const segmentMinutes = sumSegments(segments, boardIndex, alightIndex);

    if (segmentMinutes !== null) {
        // Time from the route's first stop to where they get on. Zero when they
        // board first, which is why this is not folded into the check above.
        const minutesToBoarding = sumSegments(segments, 0, boardIndex);

        const boardingTime =
            scheduledDeparture && minutesToBoarding !== null
                ? addMinutesToApiTime(scheduledDeparture, minutesToBoarding)
                : null;

        return {
            durationMinutes: segmentMinutes,
            source: 'CONFIGURED_SEGMENTS',
            problem: null,
            boardingTime,
            alightingTime: boardingTime ? addMinutesToApiTime(boardingTime, segmentMinutes) : null,
            travelledStops,
        };
    }

    // 2. Whole-route journeys, on a route with no configured timings.
    if (boardsAtRouteStart && alightsAtRouteEnd && scheduledDeparture && scheduledArrival) {
        const scheduledMinutes = minutesBetweenApiTimes(scheduledDeparture, scheduledArrival);

        if (scheduledMinutes !== null) {
            return {
                durationMinutes: scheduledMinutes,
                source: 'WHOLE_ROUTE_SCHEDULE',
                problem: null,
                boardingTime: scheduledDeparture,
                alightingTime: scheduledArrival,
                travelledStops,
            };
        }
    }

    // 3. No duration can be established. Each clock time is still reported when
    //    the passenger shares that end of the route with the trip, because that
    //    one is a fact about their journey rather than a stand-in for it. The
    //    other stays null so a screen shows nothing there instead of a time
    //    belonging to a stop the passenger never reaches.
    return {
        durationMinutes: null,
        source: 'UNKNOWN',
        problem: 'SEGMENTS_INCOMPLETE',
        boardingTime: boardsAtRouteStart ? scheduledDeparture : null,
        alightingTime: alightsAtRouteEnd ? scheduledArrival : null,
        travelledStops,
    };
}

/**
 * Measures a whole journey from its legs.
 *
 * The total is every leg's on-board time plus every wait at a transfer, taken
 * from the real legs — never one bus's route total. A wait is only counted when
 * both surrounding clock times are known; if a leg's duration cannot be
 * established the journey total is unknown too, because a total missing one leg
 * would read as a shorter journey than it is.
 */
export function resolveJourneyTiming(legs: JourneyLegInput[]): JourneyTiming {
    const legList = Array.isArray(legs) ? legs : [];
    const perLeg = legList.map(resolveLegTiming);

    const transferWaitMinutes: number[] = [];

    for (let i = 1; i < perLeg.length; i++) {
        const arrival = perLeg[i - 1].alightingTime;
        const departure = perLeg[i].boardingTime;

        const wait = arrival && departure ? minutesBetweenApiTimes(arrival, departure) : null;
        if (wait !== null) transferWaitMinutes.push(wait);
    }

    const firstProblem = perLeg.find((leg) => leg.problem !== null)?.problem ?? null;

    const everyLegMeasured =
        perLeg.length > 0 && perLeg.every((leg) => leg.durationMinutes !== null);

    // Every wait must be known as well, or the total would silently omit time the
    // passenger really spends travelling.
    const everyWaitKnown = transferWaitMinutes.length === Math.max(perLeg.length - 1, 0);

    const durationMinutes =
        everyLegMeasured && everyWaitKnown
            ? perLeg.reduce((total, leg) => total + (leg.durationMinutes ?? 0), 0) +
              transferWaitMinutes.reduce((total, wait) => total + wait, 0)
            : null;

    // The weakest link: a journey is only as well-evidenced as its least-known
    // leg, so one scheduled fallback makes the whole figure a fallback.
    const source: JourneyTimingSource =
        durationMinutes === null
            ? 'UNKNOWN'
            : perLeg.some((leg) => leg.source === 'WHOLE_ROUTE_SCHEDULE')
              ? 'WHOLE_ROUTE_SCHEDULE'
              : 'CONFIGURED_SEGMENTS';

    return {
        durationMinutes,
        durationLabel: formatDurationMinutes(durationMinutes),
        source,
        problem: firstProblem,
        boardingTime: perLeg[0]?.boardingTime ?? null,
        alightingTime: perLeg[perLeg.length - 1]?.alightingTime ?? null,
        transferCount: Math.max(perLeg.length - 1, 0),
        transferWaitMinutes,
        perLeg,
    };
}
