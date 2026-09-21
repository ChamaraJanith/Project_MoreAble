// The live journey screen, as logic (MOV-297).
//
// Jest here runs in node without a renderer, so the screen's decisions live in
// ongoingJourneyTracking and are tested directly: which journey is shown, when
// the bus may be drawn, how the screen reacts as the journey runs and ends,
// that polling never doubles up, and what progress can honestly be claimed.

import * as fs from 'fs';
import * as path from 'path';
import { OngoingJourneyRoute, PassengerOngoingJourney } from '../../../src/entities/booking/model/types';
import { completedJourneyHref, ongoingJourneyHref } from '../../../src/features/activities/utils/activityRoutes';
import {
    buildOngoingMapData,
    computeJourneyProgress,
    createJourneyPoller,
    describeBusPosition,
    describeOngoingSchedule,
    findTrackedJourney,
    formatOngoingFare,
    INITIAL_TRACKING_STATE,
    liveVehicleFor,
    ONGOING_JOURNEY_POLL_INTERVAL_MS,
    reduceTracking,
    resolveTrackedVehicle,
    TrackingState,
    upcomingStops,
} from '../../../src/features/activities/utils/ongoingJourneyTracking';

const ROOT = path.resolve(__dirname, '../../..');
const AT = new Date('2026-09-21T01:00:00.000Z');

// Malabe -> Koswatta -> Battaramulla -> Rajagiriya, with a road through them.
const ROUTE: OngoingJourneyRoute = {
    stops: ['Kaduwela', 'Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya', 'Kollupitiya'],
    journeyStops: ['Malabe', 'Koswatta', 'Battaramulla', 'Rajagiriya'],
    stopPoints: [
        { name: 'Malabe', latitude: 6.9061, longitude: 79.9696 },
        { name: 'Koswatta', latitude: 6.9076, longitude: 79.9281 },
        { name: 'Battaramulla', latitude: 6.9022, longitude: 79.9181 },
        { name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8943 },
    ],
    segmentDurationsMinutes: [10, 12, 6, 9, 15],
    road: {
        distanceKm: 8.4,
        durationMinutes: 21,
        geometry: {
            type: 'LineString',
            coordinates: [
                [79.9696, 6.9061],
                [79.95, 6.907],
                [79.9281, 6.9076],
                [79.9181, 6.9022],
                [79.8943, 6.9094],
            ],
        },
    },
};

function journey(overrides: Partial<PassengerOngoingJourney> = {}, position?: { latitude: number; longitude: number; busId?: string }): PassengerOngoingJourney {
    return {
        booking: {
            bookingId: 'BK-A',
            userId: 'PAS-2026-00001',
            tripId: 'TRIP-001',
            routeId: 'ROUTE-177',
            busId: 'BUS-A',
            seatNumber: '05A',
            pairedSeatNumber: null,
            status: 'CONFIRMED',
            boardingStatus: 'BOARDED',
            journey: {
                routeNumber: '177',
                routeName: 'Kaduwela - Kollupitiya',
                startLocation: 'Malabe',
                endLocation: 'Rajagiriya',
                departureTime: '06:00',
                estimatedArrivalTime: '07:15',
            },
            vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
            fare: { totalFare: 56, currency: 'LKR', isEstimate: false },
        },
        activeJourney: { tripId: 'TRIP-001', startedAt: '2026-09-21T00:30:00.000Z', expiresAt: '2026-09-21T23:30:00.000Z' },
        busId: 'BUS-A',
        liveStatus: position
            ? {
                  available: true,
                  location: { busId: position.busId ?? 'BUS-A', latitude: position.latitude, longitude: position.longitude, recordedAt: AT.toISOString() },
                  locationAgeSeconds: 20,
              }
            : { available: false, message: 'Live location is not available for this vehicle yet.' },
        ...overrides,
    };
}

const AT_KOSWATTA = { latitude: 6.9076, longitude: 79.9281 };
const BETWEEN_MALABE_AND_KOSWATTA = { latitude: 6.907, longitude: 79.95 };

function loaded(state: TrackingState, journeys: PassengerOngoingJourney[]): TrackingState {
    return reduceTracking(state, { type: 'LOADED', journeys, bookingId: 'BK-A', at: AT });
}

// ------------------------------------------------------------------
describe('navigation', () => {
    it('opens a dedicated live journey screen from Activities > Ongoing', () => {
        expect(ongoingJourneyHref('BK-A')).toEqual({ pathname: '/activities/journey/[bookingId]', params: { bookingId: 'BK-A' } });
        expect(fs.existsSync(path.join(ROOT, 'app/(tabs)/activities/journey/[bookingId].tsx'))).toBe(true);
    });

    it('never sends an ongoing journey to the ticket screen', () => {
        expect(ongoingJourneyHref('BK-A').pathname).not.toBe('/booking/ticket/[bookingId]');
    });

    it('keeps Booking > View Ticket, and Completed, on the ticket screen', () => {
        expect(completedJourneyHref('BK-A').pathname).toBe('/booking/ticket/[bookingId]');
        const ticket = fs.readFileSync(path.join(ROOT, 'app/(tabs)/booking/ticket/[bookingId].tsx'), 'utf8');
        expect(ticket).toContain('export default function BookingTicketScreen');
        expect(ticket).not.toContain('OngoingJourneyScreen');
    });

    it('renders the live screen, not the ticket, at the new route', () => {
        const route = fs.readFileSync(path.join(ROOT, 'app/(tabs)/activities/journey/[bookingId].tsx'), 'utf8');
        expect(route).toContain('OngoingJourneyScreen');
        expect(route).not.toContain('BookingTicketScreen');
    });

    it('keeps the planning map free of the live bus (MOV-293)', () => {
        const planning = fs.readFileSync(path.join(ROOT, 'src/features/journey/ui/RouteDetailsScreen.tsx'), 'utf8');
        const mapUse = planning.slice(planning.indexOf('<RouteMapCard'), planning.indexOf('/>', planning.indexOf('<RouteMapCard')));
        expect(mapUse).not.toMatch(/vehicle/);
    });

    it('draws the live screen map with the authorised vehicle', () => {
        const screen = fs.readFileSync(path.join(ROOT, 'src/features/activities/ui/OngoingJourneyScreen.tsx'), 'utf8');
        expect(screen).toMatch(/<RouteMapCard[\s\S]*vehicle=\{vehicle\}/);
        expect(screen).toContain('liveVehicleFor(state)');
        expect(screen).not.toContain('getBooking(');
    });
});

// ------------------------------------------------------------------
describe('which journey is shown', () => {
    it("selects the opened booking from the server's authorised list", () => {
        const other = journey({ booking: { ...journey().booking, bookingId: 'BK-OTHER' } });
        expect(findTrackedJourney([other, journey()], 'BK-A')?.booking.bookingId).toBe('BK-A');
    });

    it('shows nothing for a booking the server did not return', () => {
        expect(findTrackedJourney([journey()], 'BK-SOMEONE-ELSE')).toBeNull();
        expect(findTrackedJourney([journey()], undefined)).toBeNull();
    });

    it("refuses a journey whose running trip is not the booking's own", () => {
        const mismatched = journey({ activeJourney: { ...journey().activeJourney, tripId: 'TRIP-002' } });
        expect(findTrackedJourney([mismatched], 'BK-A')).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('which position is drawn as the bus', () => {
    it('uses the authorised live coordinates exactly', () => {
        expect(resolveTrackedVehicle(journey({}, AT_KOSWATTA))).toEqual(AT_KOSWATTA);
    });

    it('draws no bus when live location is unavailable', () => {
        expect(resolveTrackedVehicle(journey())).toBeNull();
    });

    it('draws no bus for a position that is not a real point', () => {
        expect(resolveTrackedVehicle(journey({}, { latitude: 200, longitude: 79.9 }))).toBeNull();
    });

    it('draws no bus for a position reported by a different bus', () => {
        expect(resolveTrackedVehicle(journey({}, { ...AT_KOSWATTA, busId: 'BUS-B' }))).toBeNull();
    });

    it('draws no bus for a stale run the server withheld (available: false)', () => {
        const stale = journey({ liveStatus: { available: false, message: 'Live location is not available for this vehicle yet.' } });
        expect(resolveTrackedVehicle(stale)).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('screen state', () => {
    it('starts loading, then shows the running journey', () => {
        expect(INITIAL_TRACKING_STATE.phase).toBe('LOADING');
        const state = loaded(INITIAL_TRACKING_STATE, [{ ...journey({}, AT_KOSWATTA), route: ROUTE }]);

        expect(state.phase).toBe('ACTIVE');
        expect(state.route).toBe(ROUTE);
        expect(liveVehicleFor(state)).toEqual(AT_KOSWATTA);
    });

    it('shows a clear empty state when nothing is running', () => {
        const state = loaded(INITIAL_TRACKING_STATE, []);
        expect(state.phase).toBe('NOT_FOUND');
        expect(state.journey).toBeNull();
    });

    it('moves the marker when a refresh brings a new position', () => {
        const first = loaded(INITIAL_TRACKING_STATE, [{ ...journey({}, BETWEEN_MALABE_AND_KOSWATTA), route: ROUTE }]);
        const next = loaded(first, [journey({}, AT_KOSWATTA)]);

        expect(liveVehicleFor(first)).toEqual(BETWEEN_MALABE_AND_KOSWATTA);
        expect(liveVehicleFor(next)).toEqual(AT_KOSWATTA);
    });

    it('keeps the planned path across refreshes that do not carry it', () => {
        const first = loaded(INITIAL_TRACKING_STATE, [{ ...journey(), route: ROUTE }]);
        const next = loaded(first, [journey({}, AT_KOSWATTA)]);

        expect(next.route).toBe(ROUTE);
        expect(next.journey).not.toHaveProperty('route');
    });

    it('keeps the route and details when live location becomes unavailable', () => {
        const live = loaded(INITIAL_TRACKING_STATE, [{ ...journey({}, AT_KOSWATTA), route: ROUTE }]);
        const unavailable = loaded(live, [journey()]);

        expect(unavailable.phase).toBe('ACTIVE');
        expect(unavailable.route).toBe(ROUTE);
        expect(unavailable.journey?.booking.bookingId).toBe('BK-A');
        expect(liveVehicleFor(unavailable)).toBeNull();
    });

    it('ends the journey, and stops showing the bus, once the server stops reporting it', () => {
        const live = loaded(INITIAL_TRACKING_STATE, [{ ...journey({}, AT_KOSWATTA), route: ROUTE }]);
        const ended = loaded(live, []);

        expect(ended.phase).toBe('ENDED');
        expect(liveVehicleFor(ended)).toBeNull();
        expect(ended.journey?.liveStatus.available).toBe(false);
        // Its details stay readable.
        expect(ended.journey?.booking.journey.endLocation).toBe('Rajagiriya');
        expect(ended.route).toBe(ROUTE);
    });

    it('never shows an ended journey as live again', () => {
        const ended = loaded(loaded(INITIAL_TRACKING_STATE, [journey({}, AT_KOSWATTA)]), []);
        const after = loaded(ended, [journey({}, AT_KOSWATTA)]);

        expect(after.phase).toBe('ENDED');
        expect(liveVehicleFor(after)).toBeNull();
    });

    it('hides the bus but keeps the journey when a refresh fails', () => {
        const live = loaded(INITIAL_TRACKING_STATE, [{ ...journey({}, AT_KOSWATTA), route: ROUTE }]);
        const offline = reduceTracking(live, { type: 'FAILED', status: null });

        expect(offline.phase).toBe('ACTIVE');
        expect(offline.connectionLost).toBe(true);
        expect(offline.journey?.booking.bookingId).toBe('BK-A');
        expect(liveVehicleFor(offline)).toBeNull();

        const back = loaded(offline, [journey({}, AT_KOSWATTA)]);
        expect(back.connectionLost).toBe(false);
        expect(liveVehicleFor(back)).toEqual(AT_KOSWATTA);
    });

    it('shows an error, not a journey, when the first load fails', () => {
        const state = reduceTracking(INITIAL_TRACKING_STATE, { type: 'FAILED', status: 500 });
        expect(state.phase).toBe('ERROR');
        expect(state.journey).toBeNull();
    });

    it.each([401, 403])('clears everything on %i', (status) => {
        const live = loaded(INITIAL_TRACKING_STATE, [{ ...journey({}, AT_KOSWATTA), route: ROUTE }]);
        const refused = reduceTracking(live, { type: 'FAILED', status });

        expect(refused.phase).toBe('UNAUTHORIZED');
        expect(refused.journey).toBeNull();
        expect(refused.route).toBeNull();
        expect(liveVehicleFor(refused)).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('polling', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const flush = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    /** One interval at a time, letting each request settle, like real time. */
    const tick = async (count: number) => {
        for (let i = 0; i < count; i++) {
            jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS);
            await flush();
        }
    };

    it('polls at the configured interval', async () => {
        const poll = jest.fn(async () => true);
        const poller = createJourneyPoller(poll);
        poller.start();

        await tick(3);

        expect(poll).toHaveBeenCalledTimes(3);
        poller.stop();
    });

    it('never runs two intervals, however often it is started', async () => {
        const poll = jest.fn(async () => true);
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        const poller = createJourneyPoller(poll);

        poller.start();
        poller.start();
        poller.start();
        jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS);
        await flush();

        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(poll).toHaveBeenCalledTimes(1);
        poller.stop();
        setIntervalSpy.mockRestore();
    });

    it('stops completely when cleaned up', async () => {
        const poll = jest.fn(async () => true);
        const poller = createJourneyPoller(poll);
        poller.start();
        poller.stop();
        poller.stop();

        jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS * 5);
        await flush();

        expect(poll).not.toHaveBeenCalled();
        expect(poller.isRunning()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('stops by itself once the journey has ended', async () => {
        const poll = jest.fn(async () => false);
        const poller = createJourneyPoller(poll);
        poller.start();

        jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS);
        await flush();
        jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS * 5);
        await flush();

        expect(poll).toHaveBeenCalledTimes(1);
        expect(poller.isRunning()).toBe(false);
    });

    it('skips a tick while the previous request is still out', async () => {
        let resolve: (value: boolean) => void = () => {};
        const poll = jest.fn(() => new Promise<boolean>((done) => (resolve = done)));
        const poller = createJourneyPoller(poll);
        poller.start();

        jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS * 3);
        await flush();
        expect(poll).toHaveBeenCalledTimes(1);

        resolve(true);
        await flush();
        jest.advanceTimersByTime(ONGOING_JOURNEY_POLL_INTERVAL_MS);
        await flush();
        expect(poll).toHaveBeenCalledTimes(2);
        poller.stop();
    });

    it('keeps polling after a failed request', async () => {
        const poll = jest.fn(async () => {
            throw new Error('offline');
        });
        const poller = createJourneyPoller(poll);
        poller.start();

        await tick(2);

        expect(poll).toHaveBeenCalledTimes(2);
        expect(poller.isRunning()).toBe(true);
        poller.stop();
    });
});

// ------------------------------------------------------------------
describe('progress along the planned road', () => {
    it('places a bus at a stop, with the stops behind it passed', () => {
        const progress = computeJourneyProgress(ROUTE, AT_KOSWATTA)!;

        expect(progress.currentStop).toBe('Koswatta');
        expect(progress.nextStop).toBe('Battaramulla');
        expect(progress.stopStates).toEqual(['PASSED', 'CURRENT', 'NEXT', 'UPCOMING']);
        expect(progress.fraction).toBeGreaterThan(0.3);
        expect(progress.fraction).toBeLessThan(0.7);
    });

    it('names the next stop for a bus between stops', () => {
        const progress = computeJourneyProgress(ROUTE, BETWEEN_MALABE_AND_KOSWATTA)!;

        expect(progress.currentStop).toBeNull();
        expect(progress.nextStop).toBe('Koswatta');
        expect(progress.stopStates).toEqual(['PASSED', 'NEXT', 'UPCOMING', 'UPCOMING']);
        expect(upcomingStops(ROUTE, progress)).toEqual(['Koswatta', 'Battaramulla', 'Rajagiriya']);
    });

    it('grows as the bus moves along the road', () => {
        const earlier = computeJourneyProgress(ROUTE, BETWEEN_MALABE_AND_KOSWATTA)!.fraction;
        const later = computeJourneyProgress(ROUTE, AT_KOSWATTA)!.fraction;
        expect(later).toBeGreaterThan(earlier);
    });

    it('claims no progress for a bus far from the road', () => {
        expect(computeJourneyProgress(ROUTE, { latitude: 7.2906, longitude: 80.6337 })).toBeNull();
    });

    it('claims no progress without real road geometry', () => {
        expect(computeJourneyProgress({ ...ROUTE, road: null }, AT_KOSWATTA)).toBeNull();
    });

    it('claims no progress without a live position', () => {
        expect(computeJourneyProgress(ROUTE, null)).toBeNull();
    });

    it('gives no stop states when a stop has no coordinates', () => {
        const partial = { ...ROUTE, stopPoints: ROUTE.stopPoints.filter((point) => point.name !== 'Battaramulla') };
        const progress = computeJourneyProgress(partial, BETWEEN_MALABE_AND_KOSWATTA)!;

        expect(progress.stopStates).toBeNull();
        expect(upcomingStops(partial, progress)).toEqual([]);
    });
});

// ------------------------------------------------------------------
describe('what the passenger is told', () => {
    it('says where the bus is, in words', () => {
        const at = computeJourneyProgress(ROUTE, AT_KOSWATTA);
        const between = computeJourneyProgress(ROUTE, BETWEEN_MALABE_AND_KOSWATTA);

        expect(describeBusPosition('ACTIVE', AT_KOSWATTA, at, false)).toBe('Your bus is at or near Koswatta.');
        expect(describeBusPosition('ACTIVE', BETWEEN_MALABE_AND_KOSWATTA, between, false)).toBe('Your bus is on the way to Koswatta.');
    });

    it('says plainly when the location is unavailable', () => {
        expect(describeBusPosition('ACTIVE', null, null, false)).toBe('Live bus location is temporarily unavailable.');
        expect(describeBusPosition('ACTIVE', null, null, true)).toContain('temporarily unavailable');
    });

    it('says the journey has ended', () => {
        expect(describeBusPosition('ENDED', null, null, false)).toContain('ended');
    });
});

// ------------------------------------------------------------------
describe('journey details', () => {
    it("shows the passenger's own scheduled stop times when the route is timed", () => {
        const schedule = describeOngoingSchedule(journey(), ROUTE);

        // 06:00 + 10 min to Malabe; + 12 + 6 + 9 to Rajagiriya.
        expect(schedule.departure).toEqual({ time: '6:10 AM', isPassengerStop: true });
        expect(schedule.arrival).toEqual({ time: '6:37 AM', isPassengerStop: true });
        expect(schedule.durationLabel).toBe('27m');
    });

    it("falls back to the trip's route times, flagged as such, without a route", () => {
        const schedule = describeOngoingSchedule(journey(), null);

        expect(schedule.departure).toEqual({ time: '6:00 AM', isPassengerStop: false });
        expect(schedule.arrival).toEqual({ time: '7:15 AM', isPassengerStop: false });
        expect(schedule.durationLabel).toBeNull();
    });

    it('invents no stop times for an untimed route', () => {
        const schedule = describeOngoingSchedule(journey(), { ...ROUTE, segmentDurationsMinutes: null });

        expect(schedule.departure.isPassengerStop).toBe(false);
        expect(schedule.durationLabel).toBeNull();
    });

    it('shows the ticket price when there is one', () => {
        expect(formatOngoingFare(journey())).toBe('LKR 56.00');
        expect(formatOngoingFare(journey({ booking: { ...journey().booking, fare: null } }))).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('map data', () => {
    it('marks the start, the end and every stop between them, in order', () => {
        const map = buildOngoingMapData(ROUTE)!;

        expect(map.geo.available).toBe(true);
        expect(map.geo.origin).toMatchObject({ latitude: 6.9061, longitude: 79.9696 });
        expect(map.geo.destination).toMatchObject({ latitude: 6.9094, longitude: 79.8943 });
        expect(map.stops.map((stop) => stop.name)).toEqual(['Koswatta', 'Battaramulla']);
        expect(map.unmappedStopCount).toBe(0);
        expect(map.road).toBe(ROUTE.road);
    });

    it('counts a stop it cannot place rather than guessing', () => {
        const map = buildOngoingMapData({
            ...ROUTE,
            stopPoints: ROUTE.stopPoints.filter((point) => point.name !== 'Koswatta'),
        })!;

        expect(map.stops.map((stop) => stop.name)).toEqual(['Battaramulla']);
        expect(map.unmappedStopCount).toBe(1);
    });

    it('reports the map unavailable when an endpoint has no coordinates', () => {
        const map = buildOngoingMapData({ ...ROUTE, stopPoints: ROUTE.stopPoints.slice(1) })!;

        expect(map.geo.available).toBe(false);
        expect(map.geo.origin).toBeUndefined();
    });

    it('has nothing to draw without a route', () => {
        expect(buildOngoingMapData(null)).toBeNull();
    });
});
