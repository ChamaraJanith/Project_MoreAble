import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { findMatchingRoutes, normalizeLocation, selectNextTrip } from '../../../app/api/journeys/search+api';

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

describe('selectNextTrip', () => {
    it('selects the earliest trip departing at or after the requested time', () => {
        const trips = [
            buildTrip({ tripId: 'TRIP-00001', departureTime: '06:00' }),
            buildTrip({ tripId: 'TRIP-00003', departureTime: '09:00' }),
        ];

        expect(selectNextTrip(trips, '08:30')?.tripId).toBe('TRIP-00003');
    });

    it('excludes trips that have already departed', () => {
        const trips = [buildTrip({ tripId: 'TRIP-00001', departureTime: '06:00' })];

        expect(selectNextTrip(trips, '08:30')).toBeNull();
    });

    it('includes a trip departing at exactly the requested time', () => {
        const trips = [buildTrip({ tripId: 'TRIP-00001', departureTime: '08:30' })];

        expect(selectNextTrip(trips, '08:30')?.tripId).toBe('TRIP-00001');
    });

    it('excludes inactive trips', () => {
        const trips = [buildTrip({ tripId: 'TRIP-INACTIVE', departureTime: '08:45', status: 'INACTIVE' })];

        expect(selectNextTrip(trips, '08:30')).toBeNull();
    });

    it('returns null when there are no trips at all', () => {
        expect(selectNextTrip([], '08:30')).toBeNull();
    });

    it('picks the earliest among several qualifying trips', () => {
        const trips = [
            buildTrip({ tripId: 'TRIP-LATE', departureTime: '12:00' }),
            buildTrip({ tripId: 'TRIP-EARLIEST', departureTime: '09:00' }),
            buildTrip({ tripId: 'TRIP-MID', departureTime: '10:30' }),
        ];

        expect(selectNextTrip(trips, '08:30')?.tripId).toBe('TRIP-EARLIEST');
    });
});
