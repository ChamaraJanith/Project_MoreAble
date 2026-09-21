// The passenger's live journey screen, as logic (MOV-297).
//
// Activities > Ongoing > View Journey opens a tracking screen fed only by
// GET /api/journeys/ongoing — the authorised endpoint (MOV-295/MOV-296). This
// module holds everything that screen decides, so each rule can be tested
// without a renderer:
//
//   - which journey in the response is the one the passenger opened;
//   - whether its live position may be drawn as the bus;
//   - how the screen moves between loading, live, ended and failed;
//   - one polling timer at most, and none once the journey is over;
//   - where along the planned road the bus is, when that can be measured;
//   - which scheduled times to show, labelled for what they are.
//
// WHAT THIS DELIBERATELY DOES NOT DO.
// It never produces a live arrival time or delay: the backend reports where
// the bus is and how old that report is, and nothing more (MOV-120). Progress
// is measured from the bus's reported coordinates against the planned road,
// never from elapsed time; when the bus cannot be placed on that road the
// answer is "unknown", not an estimate.

import {
    OngoingJourneyBooking,
    OngoingJourneyRoute,
    PassengerOngoingJourney,
} from '../../../entities/booking/model/types';
import {
    JourneyGeoInformation,
    JourneyRoadRoute,
    JourneyStopPoint,
} from '../../../entities/route/model/types';
import { Coordinates, haversineDistanceKm } from '../../../shared/utils/geo';
import { normalizeLocation } from '../../../shared/utils/location';
import {
    apiTimeToMinutes,
    formatDurationMinutes,
    formatFriendlyTime,
    parseApiTimeString,
} from '../../journey/utils/dateTime';
import { resolveLegTiming } from '../../journey/utils/journeyTiming';
import { resolveVehiclePosition, VehiclePosition } from '../../journey/utils/liveStatus';
import { resolveIntermediateStops } from '../../journey/utils/routeMapStops';

/**
 * How often the screen asks for the bus's position while the journey runs.
 *
 * The bus publishes every 30 s by default (locationTracker), so half that keeps
 * the marker at most one publish behind without polling faster than there is
 * anything new to show.
 */
export const ONGOING_JOURNEY_POLL_INTERVAL_MS = 15_000;

/** Further than this from the planned road, the bus is not placed on it. */
export const OFF_ROUTE_THRESHOLD_KM = 0.5;

/** Within this of a stop, the bus is described as being at that stop. */
export const NEAR_STOP_THRESHOLD_KM = 0.25;

// ------------------------------------------------------------------
// Which journey, and which position
// ------------------------------------------------------------------

/**
 * The journey the passenger opened, from the server's authorised list.
 *
 * `bookingId` comes from navigation, so it only ever SELECTS among journeys the
 * server already returned for this session — it is never sent anywhere and
 * cannot widen what is shown. A journey whose running trip is not its own
 * booking's trip is refused outright.
 */
export function findTrackedJourney(
    journeys: PassengerOngoingJourney[] | null | undefined,
    bookingId: string | null | undefined
): PassengerOngoingJourney | null {
    if (!bookingId || !Array.isArray(journeys)) return null;

    return (
        journeys.find(
            (journey) =>
                journey?.booking?.bookingId === bookingId &&
                !!journey.booking.tripId &&
                journey.activeJourney?.tripId === journey.booking.tripId
        ) ?? null
    );
}

/**
 * Where to draw the bus for this journey, or null.
 *
 * The server only attaches a position reported for this exact trip AND this
 * exact run (MOV-296) and strips the matching keys before sending it, so the
 * run check itself cannot be repeated here and is not second-guessed. What the
 * client can still check, it does: the position must be plottable and must be
 * for the bus that started this journey. Anything else draws no bus at all.
 */
export function resolveTrackedVehicle(journey: PassengerOngoingJourney | null | undefined): VehiclePosition | null {
    if (!journey) return null;

    const position = resolveVehiclePosition(journey.liveStatus);
    const reportedBy = journey.liveStatus?.location?.busId;

    if (!position) return null;
    if (journey.busId && reportedBy && reportedBy !== journey.busId) return null;

    return position;
}

// ------------------------------------------------------------------
// Screen state
// ------------------------------------------------------------------

export type TrackingPhase =
    /** First answer not in yet. */
    | 'LOADING'
    /** The journey is running; live updates continue. */
    | 'ACTIVE'
    /** It was running on this screen and the server no longer reports it. */
    | 'ENDED'
    /** Opened, but nothing is running for this booking. */
    | 'NOT_FOUND'
    /** The session is not (or no longer) allowed to read it. */
    | 'UNAUTHORIZED'
    /** The first load failed; there is nothing safe to show. */
    | 'ERROR';

export interface TrackingState {
    phase: TrackingPhase;
    /** The latest authorised journey. Kept after it ends, for its static details. */
    journey: PassengerOngoingJourney | null;
    /** The planned path. Loaded once; later refreshes do not carry it. */
    route: OngoingJourneyRoute | null;
    /** True after a refresh failed on a journey already on screen. */
    connectionLost: boolean;
    /** When the server last answered. */
    checkedAt: Date | null;
}

export const INITIAL_TRACKING_STATE: TrackingState = {
    phase: 'LOADING',
    journey: null,
    route: null,
    connectionLost: false,
    checkedAt: null,
};

export type TrackingEvent =
    | { type: 'LOADED'; journeys: PassengerOngoingJourney[]; bookingId: string; at: Date }
    | { type: 'FAILED'; status: number | null }
    /** The passenger ended their own journey on this screen (MOV-297). */
    | { type: 'PASSENGER_ENDED' };

function withoutLivePosition(journey: PassengerOngoingJourney): PassengerOngoingJourney {
    return { ...journey, liveStatus: { available: false } };
}

/**
 * The next screen state.
 *
 * - An ended journey stays ended: its bus is never shown as live again on this
 *   screen, and nothing restarts tracking.
 * - A refresh that no longer lists a journey that WAS running means it ended
 *   (End Journey, or its window ran out). Its details stay readable; its live
 *   position is dropped.
 * - 401/403 clears everything: data read under a session that is no longer
 *   valid is not left on screen.
 * - Any other failure keeps the journey's details but hides the bus, because
 *   a position that can no longer be refreshed is not a live one.
 */
export function reduceTracking(state: TrackingState, event: TrackingEvent): TrackingState {
    if (state.phase === 'ENDED' || state.phase === 'UNAUTHORIZED') {
        return state;
    }

    if (event.type === 'PASSENGER_ENDED') {
        // Their journey is over; the bus's is not, but it is no longer theirs
        // to follow, so its position is dropped like any ended journey's.
        return state.journey
            ? { ...state, phase: 'ENDED', journey: withoutLivePosition(state.journey), connectionLost: false }
            : state;
    }

    if (event.type === 'FAILED') {
        if (event.status === 401 || event.status === 403) {
            return { ...INITIAL_TRACKING_STATE, phase: 'UNAUTHORIZED' };
        }

        return state.journey ? { ...state, connectionLost: true } : { ...state, phase: 'ERROR' };
    }

    const found = findTrackedJourney(event.journeys, event.bookingId);

    if (!found) {
        if (state.phase === 'ACTIVE' && state.journey) {
            return {
                ...state,
                phase: 'ENDED',
                journey: withoutLivePosition(state.journey),
                connectionLost: false,
                checkedAt: event.at,
            };
        }

        return { ...INITIAL_TRACKING_STATE, phase: 'NOT_FOUND', checkedAt: event.at };
    }

    const { route, ...live } = found;

    return {
        phase: 'ACTIVE',
        journey: live,
        // Only replaced when this answer carried one: the live refreshes leave
        // it out, and the path does not change while the journey runs.
        route: route !== undefined ? route : state.route,
        connectionLost: false,
        checkedAt: event.at,
    };
}

/** The bus to draw right now, or null. Never after the journey ends or updates stop. */
export function liveVehicleFor(state: TrackingState): VehiclePosition | null {
    if (state.phase !== 'ACTIVE' || state.connectionLost) return null;
    return resolveTrackedVehicle(state.journey);
}

// ------------------------------------------------------------------
// Polling
// ------------------------------------------------------------------

export interface PollerTimers {
    setInterval: (callback: () => void, ms: number) => unknown;
    clearInterval: (handle: any) => void;
}

export interface JourneyPoller {
    /** Starts polling. A second call while running does nothing. */
    start: () => void;
    /** Stops polling. Safe to call at any time, any number of times. */
    stop: () => void;
    isRunning: () => boolean;
}

/**
 * One repeating refresh, and never two.
 *
 * `poll` answers whether to keep going: false (the journey ended, or access was
 * lost) stops the timer from inside. A tick that arrives while the previous
 * request is still out is skipped, so a slow network cannot stack requests.
 */
export function createJourneyPoller(
    poll: () => Promise<boolean>,
    intervalMs: number = ONGOING_JOURNEY_POLL_INTERVAL_MS,
    timers: PollerTimers = { setInterval, clearInterval }
): JourneyPoller {
    let handle: unknown = null;
    let inFlight = false;

    const stop = () => {
        if (handle !== null) {
            timers.clearInterval(handle);
            handle = null;
        }
    };

    const start = () => {
        if (handle !== null) return;

        handle = timers.setInterval(async () => {
            if (inFlight) return;
            inFlight = true;

            try {
                if (!(await poll())) stop();
            } catch {
                // A thrown poll is a failed refresh, not a reason to stop.
            } finally {
                inFlight = false;
            }
        }, intervalMs);
    };

    return { start, stop, isRunning: () => handle !== null };
}

// ------------------------------------------------------------------
// The map
// ------------------------------------------------------------------

export interface OngoingMapData {
    /** In the shape the planning map already takes (RouteMapCard). */
    geo: JourneyGeoInformation;
    /** Intermediate stops with coordinates, in travel order. */
    stops: JourneyStopPoint[];
    unmappedStopCount: number;
    road: JourneyRoadRoute | null;
}

/**
 * The planned path in the form RouteMapCard draws, so the tracking map and the
 * planning map are the same component fed the same kind of data.
 *
 * The boarding and alighting stops need stored coordinates to be drawn; without
 * them the card says the map is unavailable rather than guessing where they
 * are. The intermediate stops come from the planning map's own helper.
 */
export function buildOngoingMapData(route: OngoingJourneyRoute | null | undefined): OngoingMapData | null {
    if (!route || route.journeyStops.length < 2) return null;

    const byName = new Map(route.stopPoints.map((point) => [normalizeLocation(point.name), point]));
    const origin = byName.get(normalizeLocation(route.journeyStops[0]));
    const destination = byName.get(normalizeLocation(route.journeyStops[route.journeyStops.length - 1]));

    const geo: JourneyGeoInformation = {
        available: !!origin && !!destination,
        origin,
        destination,
        stops: route.stopPoints,
        ...(origin && destination ? {} : { message: 'Map information is currently unavailable for this journey.' }),
    };
    const intermediate = resolveIntermediateStops(route.journeyStops, geo);

    return {
        geo,
        stops: intermediate.stops,
        unmappedStopCount: intermediate.unmappedCount,
        road: route.road,
    };
}

// ------------------------------------------------------------------
// Progress along the planned road
// ------------------------------------------------------------------

export type StopProgressState = 'PASSED' | 'CURRENT' | 'NEXT' | 'UPCOMING';

export interface JourneyProgress {
    /** 0..1 along the planned road, boarding stop to alighting stop. */
    fraction: number;
    /** The stop the bus is at, when it is within NEAR_STOP_THRESHOLD_KM of one. */
    currentStop: string | null;
    /** The first stop still ahead of the bus. Null once it is at or past the last. */
    nextStop: string | null;
    /** One state per journey stop, in order; null when a stop has no coordinates. */
    stopStates: StopProgressState[] | null;
}

interface Projection {
    alongKm: number;
    offsetKm: number;
}

type LngLat = [number, number];

/**
 * The closest point of a road path to `point`: how far along the path it is,
 * and how far `point` is from it.
 *
 * Each segment is projected in a local flat frame — accurate to metres over the
 * few hundred metres of one road segment — and the distances reported are
 * great-circle distances, the project's one distance measure.
 */
function projectOntoPath(path: LngLat[], point: Coordinates): Projection | null {
    let best: Projection | null = null;
    let travelled = 0;

    for (let i = 0; i < path.length - 1; i++) {
        const [aLng, aLat] = path[i];
        const [bLng, bLat] = path[i + 1];
        const a = { latitude: aLat, longitude: aLng };
        const b = { latitude: bLat, longitude: bLng };
        const segmentKm = haversineDistanceKm(a, b);

        const scale = Math.cos((aLat * Math.PI) / 180);
        const dx = (bLng - aLng) * scale;
        const dy = bLat - aLat;
        const px = (point.longitude - aLng) * scale;
        const py = point.latitude - aLat;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared));

        const closest = { latitude: aLat + t * (bLat - aLat), longitude: aLng + t * (bLng - aLng) };
        const offsetKm = haversineDistanceKm(point, closest);

        if (!best || offsetKm < best.offsetKm) {
            best = { alongKm: travelled + t * segmentKm, offsetKm };
        }

        travelled += segmentKm;
    }

    return best;
}

function usablePath(route: OngoingJourneyRoute | null | undefined): LngLat[] {
    const coordinates = route?.road?.geometry?.coordinates;
    if (!Array.isArray(coordinates)) return [];

    return coordinates.filter(
        (position): position is LngLat =>
            Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1])
    );
}

function pathLengthKm(path: LngLat[]): number {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        total += haversineDistanceKm(
            { latitude: path[i][1], longitude: path[i][0] },
            { latitude: path[i + 1][1], longitude: path[i + 1][0] }
        );
    }
    return total;
}

/**
 * Where the bus is along the passenger's planned road, or null when that cannot
 * be measured honestly.
 *
 * Null when there is no bus position, no real road geometry (a straight line
 * between stops is not the road, so it is never used for this), or when the bus
 * is further than OFF_ROUTE_THRESHOLD_KM from the road — for example before it
 * reaches the passenger's boarding stop, or on a diversion.
 *
 * Stop states are reported only when every journey stop has coordinates: with a
 * gap, which side of the bus the unmapped stop lies on is unknown.
 */
export function computeJourneyProgress(
    route: OngoingJourneyRoute | null | undefined,
    vehicle: VehiclePosition | null | undefined
): JourneyProgress | null {
    const path = usablePath(route);
    if (!vehicle || path.length < 2 || !route) return null;

    const totalKm = pathLengthKm(path);
    const bus = projectOntoPath(path, vehicle);
    if (!bus || totalKm <= 0 || bus.offsetKm > OFF_ROUTE_THRESHOLD_KM) return null;

    const fraction = Math.min(1, Math.max(0, bus.alongKm / totalKm));

    const byName = new Map<string, JourneyStopPoint>(
        route.stopPoints.map((point) => [normalizeLocation(point.name), point])
    );
    const stopPoints = route.journeyStops.map((name) => byName.get(normalizeLocation(name)) ?? null);

    // The stop the bus is at: the nearest one within the threshold.
    let currentIndex = -1;
    let currentDistance = Infinity;
    stopPoints.forEach((point, index) => {
        if (!point) return;
        const distance = haversineDistanceKm(vehicle, point);
        if (distance <= NEAR_STOP_THRESHOLD_KM && distance < currentDistance) {
            currentIndex = index;
            currentDistance = distance;
        }
    });

    if (stopPoints.some((point) => point === null)) {
        return {
            fraction,
            currentStop: currentIndex === -1 ? null : route.journeyStops[currentIndex],
            nextStop: null,
            stopStates: null,
        };
    }

    const stopAlong = (stopPoints as JourneyStopPoint[]).map((point) => projectOntoPath(path, point)?.alongKm ?? 0);

    const states: StopProgressState[] = stopAlong.map((along, index) => {
        if (index === currentIndex) return 'CURRENT';
        // A stop behind the bus (and not the one it is at) has been passed.
        return along < bus.alongKm - NEAR_STOP_THRESHOLD_KM || (currentIndex !== -1 && index < currentIndex)
            ? 'PASSED'
            : 'UPCOMING';
    });

    const nextIndex = states.findIndex((state, index) => state === 'UPCOMING' && index > currentIndex);
    if (nextIndex !== -1) states[nextIndex] = 'NEXT';

    return {
        fraction,
        currentStop: currentIndex === -1 ? null : route.journeyStops[currentIndex],
        nextStop: nextIndex === -1 ? null : route.journeyStops[nextIndex],
        stopStates: states,
    };
}

/** The stops still ahead of the bus, nearest first; empty when that is not known. */
export function upcomingStops(route: OngoingJourneyRoute | null, progress: JourneyProgress | null): string[] {
    const stops = route?.journeyStops ?? [];
    if (!progress?.stopStates) return [];

    return stops.filter((_, index) => {
        const state = progress.stopStates![index];
        return state === 'NEXT' || state === 'UPCOMING';
    });
}

/**
 * One sentence saying where the bus is, for passengers who cannot use the map
 * and for screen readers. Only states what the data supports.
 */
export function describeBusPosition(
    phase: TrackingPhase,
    vehicle: VehiclePosition | null,
    progress: JourneyProgress | null,
    connectionLost: boolean
): string {
    if (phase === 'ENDED') return 'This journey has ended. Live tracking has stopped.';
    if (connectionLost) return 'Live bus location is temporarily unavailable. Trying again shortly.';
    if (!vehicle) return 'Live bus location is temporarily unavailable.';
    if (progress?.currentStop) return `Your bus is at or near ${progress.currentStop}.`;
    if (progress?.nextStop) return `Your bus is on the way to ${progress.nextStop}.`;
    if (progress) return 'Your bus is on your route. Its live position is shown on the map.';
    return 'Your bus is sharing its live location, shown on the map. It is not on your part of the route right now.';
}

// ------------------------------------------------------------------
// Times and fare
// ------------------------------------------------------------------

/** '06:30' -> '6:30 AM'; null when unreadable. */
export function formatScheduleTime(value: string | null | undefined): string | null {
    if (apiTimeToMinutes(value) === null) return null;
    return formatFriendlyTime(parseApiTimeString(value as string));
}

/** An ISO time as the passenger's local clock time, e.g. '8:35 PM'; null when unreadable. */
export function formatClockTime(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const hour24 = date.getHours();
    return formatFriendlyTime({
        hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
        minute: date.getMinutes(),
        period: hour24 >= 12 ? 'PM' : 'AM',
    });
}

export interface ScheduleTime {
    /** Friendly clock time, or null when unknown. */
    time: string | null;
    /**
     * True when this is the passenger's own stop time. False when only the
     * trip's whole-route time is known, which the screen must label as such.
     */
    isPassengerStop: boolean;
}

export interface OngoingSchedule {
    departure: ScheduleTime;
    arrival: ScheduleTime;
    /** Scheduled time on board, e.g. '45m'; null when not derivable. */
    durationLabel: string | null;
}

/**
 * The scheduled times to show, from the same MOV-88 timing the planning screens
 * use: the passenger's own boarding and alighting times when the route's
 * configured stop timings can place them, otherwise the trip's route-start and
 * route-end times, flagged so the screen can say which it is.
 *
 * These are timetable times. Nothing here revises them from the live position.
 */
export function describeOngoingSchedule(
    journey: { booking: OngoingJourneyBooking } | null,
    route: OngoingJourneyRoute | null
): OngoingSchedule {
    const trip = journey?.booking.journey;
    const tripDeparture = formatScheduleTime(trip?.departureTime);
    const tripArrival = formatScheduleTime(trip?.estimatedArrivalTime);

    if (!trip || !route) {
        return {
            departure: { time: tripDeparture, isPassengerStop: false },
            arrival: { time: tripArrival, isPassengerStop: false },
            durationLabel: null,
        };
    }

    const timing = resolveLegTiming({
        stops: route.stops,
        segmentDurationsMinutes: route.segmentDurationsMinutes,
        boardStop: trip.startLocation,
        alightStop: trip.endLocation,
        scheduledDepartureTime: trip.departureTime,
        scheduledArrivalTime: trip.estimatedArrivalTime,
    });

    const boarding = formatScheduleTime(timing.boardingTime);
    const alighting = formatScheduleTime(timing.alightingTime);
    const durationLabel = formatDurationMinutes(timing.durationMinutes);

    return {
        departure: boarding ? { time: boarding, isPassengerStop: true } : { time: tripDeparture, isPassengerStop: false },
        arrival: alighting ? { time: alighting, isPassengerStop: true } : { time: tripArrival, isPassengerStop: false },
        durationLabel,
    };
}

/** 'LKR 90.00', or null when the booking carries no fare. */
export function formatOngoingFare(journey: { booking: OngoingJourneyBooking } | null): string | null {
    const fare = journey?.booking.fare;
    if (!fare || !Number.isFinite(fare.totalFare)) return null;
    return `${fare.currency} ${fare.totalFare.toFixed(2)}`;
}
