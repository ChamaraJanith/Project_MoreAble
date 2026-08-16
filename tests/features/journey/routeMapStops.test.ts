// Which stops the Route Details map marks, and in what order (MOV-95).
//
// The endpoints get their own pins, so only the stops between them become map
// markers. These tests pin down that selection, the travel order it inherits
// from the route, and what happens when a stop has no saved coordinates.

import { JourneyGeoInformation } from '../../../src/entities/route/model/types';
import { resolveIntermediateStops } from '../../../src/features/journey/utils/routeMapStops';

const OUTBOUND_STOPS = [
    'Kaduwela',
    'Malabe',
    'Battaramulla',
    'Rajagiriya',
    'Borella',
    'Kollupitiya',
];

const COORDINATES: Record<string, { latitude: number; longitude: number }> = {
    Kaduwela: { latitude: 6.9333, longitude: 79.9833 },
    Malabe: { latitude: 6.9061, longitude: 79.9558 },
    Battaramulla: { latitude: 6.8994, longitude: 79.9186 },
    Rajagiriya: { latitude: 6.9094, longitude: 79.8944 },
    Borella: { latitude: 6.9147, longitude: 79.8778 },
    Kollupitiya: { latitude: 6.9167, longitude: 79.85 },
};

/** A geo block carrying coordinates for the named stops. */
function geoWith(names: string[]): JourneyGeoInformation {
    return {
        available: true,
        stops: names.map((name) => ({ name, ...COORDINATES[name] })),
    };
}

const ALL_KNOWN = geoWith(OUTBOUND_STOPS);

const names = (journeyStops: string[], geo: JourneyGeoInformation | null) =>
    resolveIntermediateStops(journeyStops, geo).stops.map((stop) => stop.name);

// ==================================================================
// SELECTION AND ORDER
// ==================================================================
describe('resolveIntermediateStops - full journey', () => {
    it('marks only the stops between the endpoints', () => {
        expect(names(OUTBOUND_STOPS, ALL_KNOWN)).toEqual([
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
        ]);
    });

    it('never repeats the origin or the destination', () => {
        const marked = names(OUTBOUND_STOPS, ALL_KNOWN);

        expect(marked).not.toContain('Kaduwela');
        expect(marked).not.toContain('Kollupitiya');
    });

    it('keeps the route order rather than sorting', () => {
        // Alphabetical order would be Battaramulla, Borella, Malabe, Rajagiriya.
        expect(names(OUTBOUND_STOPS, ALL_KNOWN)).not.toEqual(
            [...names(OUTBOUND_STOPS, ALL_KNOWN)].sort()
        );
    });

    it('reverses with the return direction', () => {
        const returnStops = [...OUTBOUND_STOPS].reverse();

        expect(names(returnStops, ALL_KNOWN)).toEqual([
            'Borella',
            'Rajagiriya',
            'Battaramulla',
            'Malabe',
        ]);
    });

    it('carries each stop through with its coordinates', () => {
        const [first] = resolveIntermediateStops(OUTBOUND_STOPS, ALL_KNOWN).stops;

        expect(first).toEqual({ name: 'Malabe', latitude: 6.9061, longitude: 79.9558 });
    });

    it('matches stop names case-insensitively and ignoring padding', () => {
        const geo: JourneyGeoInformation = {
            available: true,
            stops: [{ name: '  malabe ', latitude: 6.9061, longitude: 79.9558 }],
        };

        expect(names(['Kaduwela', 'Malabe', 'Battaramulla'], geo)).toEqual(['  malabe ']);
    });
});

// ==================================================================
// PARTIAL JOURNEYS
// ==================================================================
describe('resolveIntermediateStops - partial journeys', () => {
    it('marks nothing for a single-hop journey', () => {
        const result = resolveIntermediateStops(['Kaduwela', 'Malabe'], ALL_KNOWN);

        expect(result.stops).toEqual([]);
        expect(result.unmappedCount).toBe(0);
    });

    it('marks only the stops inside the travelled segment', () => {
        // Kaduwela -> Battaramulla must not reach Rajagiriya, Borella or Kollupitiya.
        expect(names(['Kaduwela', 'Malabe', 'Battaramulla'], ALL_KNOWN)).toEqual(['Malabe']);
    });

    it('handles a segment that starts partway along the route', () => {
        expect(names(['Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'], ALL_KNOWN)).toEqual([
            'Battaramulla',
            'Rajagiriya',
        ]);
    });

    it('marks nothing for an empty stop list', () => {
        expect(resolveIntermediateStops([], ALL_KNOWN).stops).toEqual([]);
    });
});

// ==================================================================
// MISSING COORDINATES
// ==================================================================
describe('resolveIntermediateStops - stops without coordinates', () => {
    it('reports how many stops could not be placed', () => {
        const result = resolveIntermediateStops(OUTBOUND_STOPS, geoWith(['Malabe', 'Borella']));

        expect(result.stops.map((stop) => stop.name)).toEqual(['Malabe', 'Borella']);
        expect(result.unmappedCount).toBe(2);
    });

    it('counts every intermediate stop when geo carries none', () => {
        const result = resolveIntermediateStops(OUTBOUND_STOPS, { available: true, stops: [] });

        expect(result.stops).toEqual([]);
        expect(result.unmappedCount).toBe(4);
    });

    it('does not fall over when geo is missing entirely', () => {
        expect(resolveIntermediateStops(OUTBOUND_STOPS, null)).toEqual({
            stops: [],
            unmappedCount: 4,
        });
        expect(resolveIntermediateStops(OUTBOUND_STOPS, undefined).unmappedCount).toBe(4);
    });

    it('keeps the surviving stops in route order', () => {
        // Deliberately supplied out of order; the journey sequence still wins.
        const geo = geoWith(['Borella', 'Malabe', 'Rajagiriya']);

        expect(names(OUTBOUND_STOPS, geo)).toEqual(['Malabe', 'Rajagiriya', 'Borella']);
    });
});
