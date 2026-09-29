import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import {
    buildRouteWaypoints,
    classifyBoardingTime,
    collectJourneyStopPoints,
    collectKnownLocations,
    findMatchingRoutes,
    isKnownLocation,
    isSameLocation,
    normalizeLocation,
    resolvePassengerBoardingTime,
    selectUpcomingTrips,
    toMoreAbleClock,
} from '../../../app/api/journeys/search+api';

const forwardRoute: Route = {
    routeId: '177_KADUWELA_KOLLUPITIYA',
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

const reverseRoute: Route = {
    routeId: '177_KOLLUPITIYA_KADUWELA',
    routeNumber: '177',
    routeName: 'Kollupitiya - Kaduwela',
    startLocation: 'Kollupitiya',
    endLocation: 'Kaduwela',
    stops: ['Kollupitiya', 'Borella', 'Rajagiriya', 'Battaramulla', 'Malabe', 'Kaduwela'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

const unrelatedRoute: Route = {
    routeId: '138_COLOMBO_GALLE',
    routeNumber: '138',
    routeName: 'Colombo - Galle',
    startLocation: 'Colombo Fort',
    endLocation: 'Galle',
    stops: ['Colombo Fort', 'Panadura', 'Kalutara', 'Galle'],
    distanceKm: 120,
    estimatedDuration: '2h 30m',
    status: 'ACTIVE',
};

describe('normalizeLocation', () => {
    it('trims and lowercases string values', () => {
        expect(normalizeLocation('  Kaduwela  ')).toBe('kaduwela');
    });

    it('returns an empty string for non-string values', () => {
        expect(normalizeLocation(undefined)).toBe('');
        expect(normalizeLocation(null)).toBe('');
        expect(normalizeLocation(42)).toBe('');
    });
});

describe('findMatchingRoutes', () => {
    it('matches a route when origin comes before destination', () => {
        const results = findMatchingRoutes([forwardRoute], 'Kaduwela', 'Battaramulla');

        expect(results).toHaveLength(1);
        expect(results[0].routeId).toBe('177_KADUWELA_KOLLUPITIYA');
        expect(results[0].origin).toBe('Kaduwela');
        expect(results[0].destination).toBe('Battaramulla');
        expect(results[0].journeyStops).toEqual(['Kaduwela', 'Malabe', 'Battaramulla']);
    });

    it('does not match the same route when origin and destination are in the wrong order', () => {
        const results = findMatchingRoutes([forwardRoute], 'Battaramulla', 'Kaduwela');
        expect(results).toHaveLength(0);
    });

    it('matches the reverse-direction route document for a reversed search', () => {
        const results = findMatchingRoutes([forwardRoute, reverseRoute], 'Battaramulla', 'Kaduwela');

        expect(results).toHaveLength(1);
        expect(results[0].routeId).toBe('177_KOLLUPITIYA_KADUWELA');
    });

    it('matches locations case-insensitively and ignoring surrounding whitespace', () => {
        const results = findMatchingRoutes([forwardRoute], '  kaduwela ', 'BATTARAMULLA');
        expect(results).toHaveLength(1);
    });

    it('returns no matches when the origin is not on any route', () => {
        const results = findMatchingRoutes([forwardRoute], 'Nowhere', 'Battaramulla');
        expect(results).toHaveLength(0);
    });

    it('returns no matches when the destination is not on any route', () => {
        const results = findMatchingRoutes([forwardRoute], 'Kaduwela', 'Nowhere');
        expect(results).toHaveLength(0);
    });

    it('returns no matches when no route serves the requested journey', () => {
        const results = findMatchingRoutes([unrelatedRoute], 'Kaduwela', 'Battaramulla');
        expect(results).toHaveLength(0);
    });

    it('returns every matching route when more than one route serves the journey', () => {
        const secondForwardRoute: Route = {
            ...forwardRoute,
            routeId: '178_KADUWELA_KOLLUPITIYA_EXPRESS',
            routeNumber: '178',
        };

        const results = findMatchingRoutes(
            [forwardRoute, secondForwardRoute, unrelatedRoute],
            'Kaduwela',
            'Battaramulla'
        );

        expect(results).toHaveLength(2);
        expect(results.map((match) => match.routeId)).toEqual(
            expect.arrayContaining(['177_KADUWELA_KOLLUPITIYA', '178_KADUWELA_KOLLUPITIYA_EXPRESS'])
        );
    });
});

function buildTrip(overrides: Partial<Trip>): Trip {
    return {
        tripId: 'TRIP-00000',
        routeId: '177_KADUWELA_KOLLUPITIYA',
        busId: 'BUS-00001',
        departureTime: '06:00',
        estimatedArrivalTime: '07:10',
        turnNumber: 1,
        status: 'ACTIVE',
        ...overrides,
    };
}

// ------------------------------------------------------------------
// MOV-308 — time selection around the passenger's own boarding time
// ------------------------------------------------------------------

// Kaduwela -(10)- Malabe -(8)- Battaramulla -(7)- Rajagiriya -(12)- Borella -(15)- Kollupitiya
const timedRoute: Route = { ...forwardRoute, segmentDurationsMinutes: [10, 8, 7, 12, 15] };

// A Malabe -> Borella passenger boards 10 minutes after the bus leaves Kaduwela.
const [malabeMatch] = findMatchingRoutes([timedRoute], 'Malabe', 'Borella');
const [kaduwelaMatch] = findMatchingRoutes([timedRoute], 'Kaduwela', 'Borella');

// Search "now": 29 Sep 2026, 08:15 in Colombo (UTC+05:30) — an explicit instant,
// so nothing depends on the timezone of the machine running the tests.
const NOW = new Date('2026-09-29T02:45:00.000Z');
const TODAY = '2026-09-29';
const FUTURE_DATE = '2026-10-05';

function selectedIds(trips: Trip[], travelTime: string, travelDate = FUTURE_DATE, match = malabeMatch) {
    return selectUpcomingTrips(trips, match, travelTime, travelDate, NOW).map((trip) => trip.tripId);
}

describe('resolvePassengerBoardingTime', () => {
    it('is the time the bus reaches the passenger origin, not its first-stop departure', () => {
        const trip = buildTrip({ departureTime: '08:00' });

        expect(resolvePassengerBoardingTime(malabeMatch, trip)).toBe('08:10');
        expect(resolvePassengerBoardingTime(kaduwelaMatch, trip)).toBe('08:00');
    });

    it('is null when the timings before a mid-route origin are not configured', () => {
        const [untimed] = findMatchingRoutes([forwardRoute], 'Malabe', 'Borella');

        expect(resolvePassengerBoardingTime(untimed, buildTrip({ departureTime: '08:00' }))).toBeNull();
    });
});

describe('classifyBoardingTime', () => {
    it('is EXACT only for a zero-minute difference', () => {
        expect(classifyBoardingTime('08:10', '08:10')).toBe('EXACT');
        expect(classifyBoardingTime('08:11', '08:10')).toBe('NEARBY');
        expect(classifyBoardingTime('08:09', '08:10')).toBe('NEARBY');
    });

    it('treats both 60-minute boundaries as NEARBY and anything beyond as OUTSIDE', () => {
        expect(classifyBoardingTime('07:10', '08:10')).toBe('NEARBY');
        expect(classifyBoardingTime('09:10', '08:10')).toBe('NEARBY');
        expect(classifyBoardingTime('07:09', '08:10')).toBe('OUTSIDE');
        expect(classifyBoardingTime('09:11', '08:10')).toBe('OUTSIDE');
    });

    it('never wraps across midnight', () => {
        expect(classifyBoardingTime('23:50', '00:10')).toBe('OUTSIDE');
        expect(classifyBoardingTime('00:10', '23:50')).toBe('OUTSIDE');
    });

    it('is null when a boarding time is not known', () => {
        expect(classifyBoardingTime(null, '08:10')).toBeNull();
    });
});

describe('selectUpcomingTrips', () => {
    describe('R1 — the passenger-origin boarding time decides', () => {
        it('makes a mid-route boarding an EXACT match even though the bus left its first stop earlier', () => {
            const trip = buildTrip({ tripId: 'TRIP-EXACT', departureTime: '08:00' });
            const boardingTime = resolvePassengerBoardingTime(malabeMatch, trip);

            expect(classifyBoardingTime(boardingTime, '08:10')).toBe('EXACT');
            // The first-stop departure alone would only have been NEARBY.
            expect(classifyBoardingTime(trip.departureTime, '08:10')).toBe('NEARBY');
            expect(selectedIds([trip], '08:10')).toEqual(['TRIP-EXACT']);
        });

        it('includes a trip whose first-stop departure is outside the window but whose boarding is inside', () => {
            // Leaves Kaduwela 07:05 (65 min before 08:10); reaches Malabe 07:15 (55 min before).
            const trip = buildTrip({ tripId: 'TRIP-IN', departureTime: '07:05' });

            expect(selectedIds([trip], '08:10')).toEqual(['TRIP-IN']);
        });

        it('excludes a trip whose first-stop departure is inside the window but whose boarding is outside', () => {
            // Leaves Kaduwela 09:05 (55 min after 08:10); reaches Malabe 09:15 (65 min after).
            const trip = buildTrip({ tripId: 'TRIP-OUT', departureTime: '09:05' });

            expect(selectedIds([trip], '08:10')).toEqual([]);
        });
    });

    describe('R2 — symmetric ±60-minute window around the requested boarding time', () => {
        // Requested boarding at Malabe 08:10; departures are 10 minutes earlier.
        const windowTrips = [
            buildTrip({ tripId: 'TOO-EARLY', departureTime: '06:59' }), // boards 07:09 (-61)
            buildTrip({ tripId: 'EDGE-EARLY', departureTime: '07:00' }), // boards 07:10 (-60)
            buildTrip({ tripId: 'EARLIER', departureTime: '07:30' }), // boards 07:40 (-30)
            buildTrip({ tripId: 'LATER', departureTime: '08:30' }), // boards 08:40 (+30)
            buildTrip({ tripId: 'EDGE-LATE', departureTime: '09:00' }), // boards 09:10 (+60)
            buildTrip({ tripId: 'TOO-LATE', departureTime: '09:01' }), // boards 09:11 (+61)
        ];

        it('includes an earlier journey inside the window', () => {
            expect(selectedIds(windowTrips, '08:10')).toContain('EARLIER');
        });

        it('includes a later journey inside the window', () => {
            expect(selectedIds(windowTrips, '08:10')).toContain('LATER');
        });

        it('includes a journey boarding exactly 60 minutes earlier', () => {
            expect(selectedIds(windowTrips, '08:10')).toContain('EDGE-EARLY');
        });

        it('includes a journey boarding exactly 60 minutes later', () => {
            expect(selectedIds(windowTrips, '08:10')).toContain('EDGE-LATE');
        });

        it('excludes a journey boarding more than 60 minutes earlier', () => {
            expect(selectedIds(windowTrips, '08:10')).not.toContain('TOO-EARLY');
        });

        it('excludes a journey boarding more than 60 minutes later', () => {
            expect(selectedIds(windowTrips, '08:10')).not.toContain('TOO-LATE');
        });

        it('returns exactly the in-window journeys, earliest first', () => {
            expect(selectedIds([...windowTrips].reverse(), '08:10')).toEqual([
                'EDGE-EARLY',
                'EARLIER',
                'LATER',
                'EDGE-LATE',
            ]);
        });

        it('does not pair clock times across midnight', () => {
            const lateTrip = buildTrip({ tripId: 'LATE-NIGHT', departureTime: '23:40' }); // boards 23:50

            expect(selectedIds([lateTrip], '00:10')).toEqual([]);
        });
    });

    describe('R4 — today versus a future date', () => {
        // Now is 08:15; requested boarding at Malabe 08:10.
        const todayTrips = [
            buildTrip({ tripId: 'DEPARTED', departureTime: '07:55' }), // boards 08:05 — gone
            buildTrip({ tripId: 'BOARDING-NOW', departureTime: '08:05' }), // boards 08:15 — catchable
            // Left Kaduwela at 08:10, before now, but reaches Malabe at 08:20.
            buildTrip({ tripId: 'LEFT-FIRST-STOP', departureTime: '08:10' }),
        ];

        it('excludes a journey that has already left the passenger origin today', () => {
            expect(selectedIds(todayTrips, '08:10', TODAY)).not.toContain('DEPARTED');
        });

        it('keeps a journey boarding at the current minute today', () => {
            expect(selectedIds(todayTrips, '08:10', TODAY)).toContain('BOARDING-NOW');
        });

        it('judges already-departed at the passenger origin, not the first stop', () => {
            expect(selectedIds(todayTrips, '08:10', TODAY)).toContain('LEFT-FIRST-STOP');
        });

        it('never uses the current clock to exclude a future-date journey', () => {
            expect(selectedIds(todayTrips, '08:10', FUTURE_DATE)).toEqual([
                'DEPARTED',
                'BOARDING-NOW',
                'LEFT-FIRST-STOP',
            ]);
        });

        it('keeps only still-catchable journeys when the requested time today is already past', () => {
            const trips = [
                buildTrip({ tripId: 'GONE', departureTime: '07:20' }), // boards 07:30
                buildTrip({ tripId: 'STILL-AHEAD', departureTime: '08:20' }), // boards 08:30
            ];

            expect(selectedIds(trips, '07:45', TODAY)).toEqual(['STILL-AHEAD']);
        });
    });

    describe('R4 — "today" and "now" are Asia/Colombo, whatever the server timezone', () => {
        // Simulates a server running in UTC, deterministically on any machine:
        // every local-time reading of a Date reports the UTC value instead. An
        // explicit Asia/Colombo reading is unaffected, which is the point.
        const localGetters = {
            getFullYear: 'getUTCFullYear',
            getMonth: 'getUTCMonth',
            getDate: 'getUTCDate',
            getDay: 'getUTCDay',
            getHours: 'getUTCHours',
            getMinutes: 'getUTCMinutes',
        } as const;

        beforeAll(() => {
            for (const [local, utc] of Object.entries(localGetters)) {
                jest.spyOn(Date.prototype, local as keyof typeof localGetters).mockImplementation(
                    function (this: Date) {
                        return this[utc]();
                    }
                );
            }
        });

        afterAll(() => {
            jest.restoreAllMocks();
        });

        // 18:40 UTC on 29 Sep is 00:10 on 30 Sep in Colombo.
        const JUST_AFTER_COLOMBO_MIDNIGHT = new Date('2026-09-29T18:40:00.000Z');

        const selectAt = (instant: Date, trips: Trip[], travelTime: string, travelDate: string) =>
            selectUpcomingTrips(trips, kaduwelaMatch, travelTime, travelDate, instant).map(
                (trip) => trip.tripId
            );

        it('really is running on a clock that is not Colombo', () => {
            expect(NOW.getHours()).toBe(2);
            expect(JUST_AFTER_COLOMBO_MIDNIGHT.getDate()).toBe(29);
        });

        it('reads the Colombo date and minute, not the runtime ones', () => {
            expect(toMoreAbleClock(NOW)).toEqual({ date: '2026-09-29', minutes: 8 * 60 + 15 });
            expect(toMoreAbleClock(JUST_AFTER_COLOMBO_MIDNIGHT)).toEqual({
                date: '2026-09-30',
                minutes: 10,
            });
        });

        it('excludes a journey already departed in Colombo time on a Colombo-today search', () => {
            // Boards Kaduwela 08:05 Colombo; the UTC clock reads 02:45, which would keep it.
            const trips = [buildTrip({ tripId: 'GONE', departureTime: '08:05' })];

            expect(selectAt(NOW, trips, '08:10', '2026-09-29')).toEqual([]);
        });

        it('keeps a journey not yet departed in Colombo time', () => {
            const trips = [
                buildTrip({ tripId: 'NOW', departureTime: '08:15' }),
                buildTrip({ tripId: 'SOON', departureTime: '08:40' }),
            ];

            expect(selectAt(NOW, trips, '08:10', '2026-09-29')).toEqual(['NOW', 'SOON']);
        });

        it('treats the new Colombo date as today just after midnight, while UTC is still on the previous date', () => {
            const trips = [
                buildTrip({ tripId: 'GONE', departureTime: '00:05' }),
                buildTrip({ tripId: 'NOW', departureTime: '00:10' }),
                buildTrip({ tripId: 'SOON', departureTime: '00:40' }),
            ];

            expect(selectAt(JUST_AFTER_COLOMBO_MIDNIGHT, trips, '00:10', '2026-09-30')).toEqual([
                'NOW',
                'SOON',
            ]);
        });

        it('does not treat the UTC date as today once Colombo has moved past it', () => {
            // 29 Sep is already the past in Colombo, so the clock filters nothing.
            const trips = [buildTrip({ tripId: 'LATE', departureTime: '00:05' })];

            expect(selectAt(JUST_AFTER_COLOMBO_MIDNIGHT, trips, '00:10', '2026-09-29')).toEqual([
                'LATE',
            ]);
        });

        it('never filters a future Colombo date by the current clock', () => {
            const trips = [
                buildTrip({ tripId: 'EARLY', departureTime: '00:05' }),
                buildTrip({ tripId: 'LATER', departureTime: '08:05' }),
            ];

            expect(selectAt(JUST_AFTER_COLOMBO_MIDNIGHT, trips, '00:10', '2026-10-01')).toEqual([
                'EARLY',
            ]);
            expect(selectAt(NOW, trips, '08:10', '2026-09-30')).toEqual(['LATER']);
        });
    });

    describe('journeys whose passenger boarding time cannot be derived', () => {
        it('excludes a mid-route boarding on a route with no configured timings', () => {
            const [untimed] = findMatchingRoutes([forwardRoute], 'Malabe', 'Borella');
            // The first-stop departure is an exact hit, and must not be used as a stand-in.
            const trip = buildTrip({ tripId: 'UNTIMED', departureTime: '08:10' });

            expect(selectedIds([trip], '08:10', FUTURE_DATE, untimed)).toEqual([]);
        });

        it('excludes a mid-route boarding when a segment before the origin is untimed', () => {
            const partlyTimed: Route = { ...forwardRoute, segmentDurationsMinutes: [null, 8, 7, 12, 15] };
            const [match] = findMatchingRoutes([partlyTimed], 'Malabe', 'Borella');
            const trip = buildTrip({ tripId: 'GAP', departureTime: '08:00' });

            expect(selectedIds([trip], '08:10', FUTURE_DATE, match)).toEqual([]);
        });

        it('keeps a first-stop boarding on an untimed route, where the departure IS the boarding time', () => {
            const [untimed] = findMatchingRoutes([forwardRoute], 'Kaduwela', 'Borella');
            const trip = buildTrip({ tripId: 'FIRST-STOP', departureTime: '08:10' });

            expect(selectedIds([trip], '08:10', FUTURE_DATE, untimed)).toEqual(['FIRST-STOP']);
        });

        it('excludes a trip whose stored departure time is unreadable', () => {
            const trip = buildTrip({ tripId: 'BROKEN', departureTime: '' });

            expect(selectedIds([trip], '08:10')).toEqual([]);
        });
    });

    describe('behaviour outside the time window is unchanged', () => {
        it('excludes inactive trips', () => {
            const trips = [buildTrip({ tripId: 'TRIP-INACTIVE', departureTime: '08:00', status: 'INACTIVE' })];

            expect(selectedIds(trips, '08:10')).toEqual([]);
        });

        it('excludes a trip with no usable id', () => {
            const trips = [buildTrip({ tripId: '  ', departureTime: '08:00' })];

            expect(selectedIds(trips, '08:10')).toEqual([]);
        });

        it('returns an empty list when there are no trips at all', () => {
            expect(selectedIds([], '08:10')).toEqual([]);
        });

        it('keeps several trips of the same route as separate options', () => {
            const trips = [
                buildTrip({ tripId: 'TRIP-00001', departureTime: '07:45' }),
                buildTrip({ tripId: 'TRIP-00002', departureTime: '08:00' }),
                buildTrip({ tripId: 'TRIP-00003', departureTime: '08:30' }),
            ];

            expect(selectedIds(trips, '08:10')).toHaveLength(3);
        });
    });
});

// ------------------------------------------------------------------
// MOV-84 — location validation helpers
// ------------------------------------------------------------------
describe('collectKnownLocations', () => {
    it('collects every stop name across the given routes', () => {
        const known = collectKnownLocations([forwardRoute, unrelatedRoute]);

        expect(known.has('kaduwela')).toBe(true);
        expect(known.has('kollupitiya')).toBe(true);
        expect(known.has('galle')).toBe(true);
        expect(known.has('invalidlocationxyz')).toBe(false);
    });

    it('also accepts names supplied by the stops master collection', () => {
        const known = collectKnownLocations([forwardRoute], ['Nugegoda', 'Maharagama']);

        expect(known.has('nugegoda')).toBe(true);
        expect(known.has('maharagama')).toBe(true);
    });

    it('ignores routes without a usable stops array', () => {
        const brokenRoute = { ...forwardRoute, stops: undefined as unknown as string[] };

        expect(() => collectKnownLocations([brokenRoute])).not.toThrow();
        expect(collectKnownLocations([brokenRoute]).size).toBe(0);
    });

    it('skips blank stop names', () => {
        const known = collectKnownLocations([{ ...forwardRoute, stops: ['Kaduwela', '  ', ''] }]);

        expect(known.size).toBe(1);
        expect(known.has('kaduwela')).toBe(true);
    });
});

describe('isKnownLocation', () => {
    const known = collectKnownLocations([forwardRoute]);

    it('accepts a known location regardless of case or padding', () => {
        expect(isKnownLocation('  kADUwela ', known)).toBe(true);
    });

    it('rejects a location the system does not know', () => {
        expect(isKnownLocation('InvalidLocationXYZ', known)).toBe(false);
    });

    it('rejects blank and non-string values', () => {
        expect(isKnownLocation('   ', known)).toBe(false);
        expect(isKnownLocation(undefined, known)).toBe(false);
        expect(isKnownLocation(42, known)).toBe(false);
    });
});

describe('isSameLocation', () => {
    it('detects identical locations ignoring case and padding', () => {
        expect(isSameLocation('Kaduwela', '  kaduwela ')).toBe(true);
    });

    it('treats genuinely different locations as different', () => {
        expect(isSameLocation('Kaduwela', 'Kollupitiya')).toBe(false);
    });

    it('does not treat two blank values as the same location', () => {
        expect(isSameLocation('   ', '')).toBe(false);
    });
});

// ==================================================================
// STOP COORDINATES FOR THE ROUTE MAP
// ==================================================================
describe('collectJourneyStopPoints', () => {
    const coordinates = new Map<string, { latitude: number; longitude: number }>([
        ['kaduwela', { latitude: 6.9333, longitude: 79.9833 }],
        ['malabe', { latitude: 6.9061, longitude: 79.9558 }],
        ['battaramulla', { latitude: 6.8994, longitude: 79.9186 }],
        ['rajagiriya', { latitude: 6.9094, longitude: 79.8944 }],
        ['borella', { latitude: 6.9147, longitude: 79.8778 }],
        ['kollupitiya', { latitude: 6.9167, longitude: 79.8500 }],
    ]);

    const matchFor = (route: Route, origin: string, destination: string) =>
        findMatchingRoutes([route], origin, destination);

    it('keeps the outbound travel order of the route', () => {
        const matches = matchFor(forwardRoute, 'Kaduwela', 'Kollupitiya');

        expect(collectJourneyStopPoints(matches, coordinates).map((stop) => stop.name)).toEqual([
            'Kaduwela',
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
            'Kollupitiya',
        ]);
    });

    it('reverses with the return direction rather than sorting', () => {
        const matches = matchFor(reverseRoute, 'Kollupitiya', 'Kaduwela');

        expect(collectJourneyStopPoints(matches, coordinates).map((stop) => stop.name)).toEqual([
            'Kollupitiya',
            'Borella',
            'Rajagiriya',
            'Battaramulla',
            'Malabe',
            'Kaduwela',
        ]);
    });

    it('covers only the travelled segment', () => {
        const matches = matchFor(forwardRoute, 'Malabe', 'Rajagiriya');

        expect(collectJourneyStopPoints(matches, coordinates).map((stop) => stop.name)).toEqual([
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
        ]);
    });

    it('attaches the matching coordinates to each stop', () => {
        const matches = matchFor(forwardRoute, 'Kaduwela', 'Malabe');

        expect(collectJourneyStopPoints(matches, coordinates)).toEqual([
            { name: 'Kaduwela', latitude: 6.9333, longitude: 79.9833 },
            { name: 'Malabe', latitude: 6.9061, longitude: 79.9558 },
        ]);
    });

    it('skips stops that have no stored coordinates', () => {
        const partial = new Map(coordinates);
        partial.delete('battaramulla');

        const matches = matchFor(forwardRoute, 'Kaduwela', 'Kollupitiya');
        const names = collectJourneyStopPoints(matches, partial).map((stop) => stop.name);

        expect(names).not.toContain('Battaramulla');
        // The surrounding stops keep their order, so the map still tracks the route.
        expect(names).toEqual(['Kaduwela', 'Malabe', 'Rajagiriya', 'Borella', 'Kollupitiya']);
    });

    it('skips stops whose coordinates are not finite numbers', () => {
        const broken = new Map(coordinates);
        broken.set('malabe', { latitude: Number.NaN, longitude: 79.9558 });
        broken.set('borella', { latitude: 6.9147, longitude: Number.POSITIVE_INFINITY });

        const matches = matchFor(forwardRoute, 'Kaduwela', 'Kollupitiya');
        const names = collectJourneyStopPoints(matches, broken).map((stop) => stop.name);

        expect(names).toEqual(['Kaduwela', 'Battaramulla', 'Rajagiriya', 'Kollupitiya']);
    });

    it('emits a stop shared by two matched routes only once', () => {
        const matches = [
            ...matchFor(forwardRoute, 'Kaduwela', 'Kollupitiya'),
            ...matchFor(forwardRoute, 'Malabe', 'Borella'),
        ];

        const names = collectJourneyStopPoints(matches, coordinates).map((stop) => stop.name);

        expect(names).toEqual([...new Set(names)]);
        expect(names).toHaveLength(6);
    });

    it('returns nothing when no route matched', () => {
        expect(collectJourneyStopPoints([], coordinates)).toEqual([]);
    });

    it('returns nothing when no coordinates are known', () => {
        const matches = matchFor(forwardRoute, 'Kaduwela', 'Kollupitiya');

        expect(collectJourneyStopPoints(matches, new Map())).toEqual([]);
    });
});

// ==================================================================
// OSRM WAYPOINTS
//
// A bus route is not the fastest road between its endpoints, so the route's own
// stops constrain the road path. These cover the ordering that produces.
// ==================================================================
describe('buildRouteWaypoints', () => {
    const coordinates = new Map<string, { latitude: number; longitude: number }>([
        ['kaduwela', { latitude: 6.9333, longitude: 79.9833 }],
        ['malabe', { latitude: 6.9061, longitude: 79.9558 }],
        ['battaramulla', { latitude: 6.8994, longitude: 79.9186 }],
        ['rajagiriya', { latitude: 6.9094, longitude: 79.8944 }],
        ['borella', { latitude: 6.9147, longitude: 79.8778 }],
        ['kollupitiya', { latitude: 6.9167, longitude: 79.85 }],
    ]);

    const journeyOf = (route: Route, origin: string, destination: string) =>
        findMatchingRoutes([route], origin, destination)[0].journeyStops;

    /** Identifies a waypoint by looking its coordinates back up by name. */
    const asNames = (points: { latitude: number; longitude: number }[]) =>
        points.map((point) => {
            for (const [name, candidate] of coordinates) {
                if (
                    candidate.latitude === point.latitude &&
                    candidate.longitude === point.longitude
                ) {
                    return name;
                }
            }
            return 'unknown';
        });

    it('routes through every stop of the outbound journey in order', () => {
        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Kaduwela', 'Kollupitiya'),
            coordinates
        );

        // The whole point of the fix: not just the two endpoints.
        expect(waypoints).toHaveLength(6);
        expect(asNames(waypoints)).toEqual([
            'kaduwela',
            'malabe',
            'battaramulla',
            'rajagiriya',
            'borella',
            'kollupitiya',
        ]);
    });

    it('reverses for the return journey', () => {
        const waypoints = buildRouteWaypoints(
            journeyOf(reverseRoute, 'Kollupitiya', 'Kaduwela'),
            coordinates
        );

        expect(asNames(waypoints)).toEqual([
            'kollupitiya',
            'borella',
            'rajagiriya',
            'battaramulla',
            'malabe',
            'kaduwela',
        ]);
    });

    it('includes the stops inside a partial journey and none outside it', () => {
        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Kaduwela', 'Battaramulla'),
            coordinates
        );

        expect(asNames(waypoints)).toEqual(['kaduwela', 'malabe', 'battaramulla']);
    });

    it('routes a mid-route segment through its own stops only', () => {
        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Malabe', 'Kollupitiya'),
            coordinates
        );

        expect(asNames(waypoints)).toEqual([
            'malabe',
            'battaramulla',
            'rajagiriya',
            'borella',
            'kollupitiya',
        ]);
    });

    it('produces just the two endpoints for a single hop', () => {
        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Kaduwela', 'Malabe'),
            coordinates
        );

        expect(asNames(waypoints)).toEqual(['kaduwela', 'malabe']);
    });

    it('falls back to the resolved endpoints when a stop is not in the collection', () => {
        const partial = new Map(coordinates);
        partial.delete('kaduwela');
        partial.delete('kollupitiya');

        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Kaduwela', 'Kollupitiya'),
            partial,
            { latitude: 6.9333, longitude: 79.9833 },
            { latitude: 6.9167, longitude: 79.85 }
        );

        expect(asNames(waypoints)).toEqual([
            'kaduwela',
            'malabe',
            'battaramulla',
            'rajagiriya',
            'borella',
            'kollupitiya',
        ]);
    });

    it('skips an intermediate stop that has no coordinates', () => {
        const partial = new Map(coordinates);
        partial.delete('rajagiriya');

        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Kaduwela', 'Kollupitiya'),
            partial
        );

        expect(asNames(waypoints)).toEqual([
            'kaduwela',
            'malabe',
            'battaramulla',
            'borella',
            'kollupitiya',
        ]);
    });

    it('returns nothing routable when no coordinates are known at all', () => {
        const waypoints = buildRouteWaypoints(
            journeyOf(forwardRoute, 'Kaduwela', 'Kollupitiya'),
            new Map()
        );

        expect(waypoints).toEqual([]);
    });
});
