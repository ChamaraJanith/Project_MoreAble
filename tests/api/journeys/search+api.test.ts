import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import {
    collectKnownLocations,
    findMatchingRoutes,
    isKnownLocation,
    isSameLocation,
    normalizeLocation,
    selectUpcomingTrips,
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

describe('selectUpcomingTrips', () => {
    it('selects the earliest trip departing at or after the requested time', () => {
        const trips = [
            buildTrip({ tripId: 'TRIP-00001', departureTime: '06:00' }),
            buildTrip({ tripId: 'TRIP-00003', departureTime: '09:00' }),
        ];

        expect(selectUpcomingTrips(trips, '08:30')[0]?.tripId).toBe('TRIP-00003');
    });

    it('excludes trips that have already departed', () => {
        const trips = [buildTrip({ tripId: 'TRIP-00001', departureTime: '06:00' })];

        expect(selectUpcomingTrips(trips, '08:30')).toEqual([]);
    });

    it('includes a trip departing at exactly the requested time', () => {
        const trips = [buildTrip({ tripId: 'TRIP-00001', departureTime: '08:30' })];

        expect(selectUpcomingTrips(trips, '08:30')[0]?.tripId).toBe('TRIP-00001');
    });

    it('excludes inactive trips', () => {
        const trips = [buildTrip({ tripId: 'TRIP-INACTIVE', departureTime: '08:45', status: 'INACTIVE' })];

        expect(selectUpcomingTrips(trips, '08:30')).toEqual([]);
    });

    it('returns an empty list when there are no trips at all', () => {
        expect(selectUpcomingTrips([], '08:30')).toEqual([]);
    });

    it('returns every qualifying trip ordered earliest first', () => {
        const trips = [
            buildTrip({ tripId: 'TRIP-LATE', departureTime: '12:00' }),
            buildTrip({ tripId: 'TRIP-EARLIEST', departureTime: '09:00' }),
            buildTrip({ tripId: 'TRIP-MID', departureTime: '10:30' }),
        ];

        expect(selectUpcomingTrips(trips, '08:30').map((trip) => trip.tripId)).toEqual([
            'TRIP-EARLIEST',
            'TRIP-MID',
            'TRIP-LATE',
        ]);
    });

    it('keeps several trips of the same route as separate options', () => {
        const trips = [
            buildTrip({ tripId: 'TRIP-00001', departureTime: '06:00' }),
            buildTrip({ tripId: 'TRIP-00003', departureTime: '09:00' }),
            buildTrip({ tripId: 'TRIP-00005', departureTime: '11:00' }),
        ];

        expect(selectUpcomingTrips(trips, '08:30')).toHaveLength(2);
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
