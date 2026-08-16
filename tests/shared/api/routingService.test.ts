import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
    metresToKilometres,
    secondsToMinutes,
} from '../../../src/shared/api/routingService';

// Every external call is mocked — no real OSRM request is ever made.
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, ok = true) {
    return { ok, json: async () => body };
}

const KADUWELA = { latitude: 6.9333, longitude: 79.9833 };
const KOLLUPITIYA = { latitude: 6.9111, longitude: 79.8489 };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('unit conversion', () => {
    it('converts metres to kilometres to one decimal place', () => {
        expect(metresToKilometres(20000)).toBe(20);
        expect(metresToKilometres(22450)).toBe(22.5);
        expect(metresToKilometres(0)).toBe(0);
    });

    it('converts seconds to whole minutes', () => {
        expect(secondsToMinutes(4140)).toBe(69);
        expect(secondsToMinutes(30)).toBe(1);
        expect(secondsToMinutes(0)).toBe(0);
    });
});

describe('getRouteBetweenCoordinates', () => {
    it('returns converted distance, duration and geometry', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({
                code: 'Ok',
                routes: [
                    {
                        distance: 22450,
                        duration: 4140,
                        geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.84, 6.91]] },
                    },
                ],
            })
        );

        const result = await getRouteBetweenCoordinates(KADUWELA, KOLLUPITIYA);

        expect(result).toEqual({
            distanceKm: 22.5,
            durationMinutes: 69,
            geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.84, 6.91]] },
        });
    });

    it('requests coordinates in OSRM longitude,latitude order', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ code: 'Ok', routes: [{ distance: 100, duration: 60 }] })
        );

        await getRouteBetweenCoordinates(KADUWELA, KOLLUPITIYA);

        const [url] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('79.9833,6.9333;79.8489,6.9111');
    });

    it('returns null when OSRM cannot route the pair', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ code: 'NoRoute', routes: [] }));

        expect(await getRouteBetweenCoordinates(KADUWELA, KOLLUPITIYA)).toBeNull();
    });

    it('returns null when the request fails', async () => {
        mockFetch.mockRejectedValue(new Error('network down'));

        expect(await getRouteBetweenCoordinates(KADUWELA, KOLLUPITIYA)).toBeNull();
    });

    it('returns null on a malformed response body', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ code: 'Ok', routes: [{ distance: 'x' }] }));

        expect(await getRouteBetweenCoordinates(KADUWELA, KOLLUPITIYA)).toBeNull();
    });

    it('omits geometry when OSRM does not return one', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ code: 'Ok', routes: [{ distance: 1000, duration: 120 }] })
        );

        const result = await getRouteBetweenCoordinates(KADUWELA, KOLLUPITIYA);

        expect(result).toMatchObject({ distanceKm: 1, durationMinutes: 2 });
        expect(result?.geometry).toBeUndefined();
    });

    it('does not call the service for invalid coordinates', async () => {
        expect(
            await getRouteBetweenCoordinates({ latitude: NaN, longitude: 1 }, KOLLUPITIYA)
        ).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ==================================================================
// WAYPOINT ROUTING
//
// A bus route is not the fastest road between its endpoints, so the route's own
// stops are passed to OSRM as ordered waypoints to constrain the path.
// ==================================================================
describe('getRouteThroughCoordinates', () => {
    const MALABE = { latitude: 6.9061, longitude: 79.9558 };
    const BATTARAMULLA = { latitude: 6.8994, longitude: 79.9186 };
    const RAJAGIRIYA = { latitude: 6.9094, longitude: 79.8944 };
    const BORELLA = { latitude: 6.9147, longitude: 79.8778 };

    const okResponse = () =>
        jsonResponse({
            code: 'Ok',
            routes: [
                {
                    distance: 22450,
                    duration: 4140,
                    geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.84, 6.91]] },
                },
            ],
        });

    const requestedPath = () => {
        const [url] = mockFetch.mock.calls[0];
        // Everything between the profile and the query string.
        return String(url).split('/driving/')[1].split('?')[0];
    };

    it('sends every waypoint in the order supplied', async () => {
        mockFetch.mockResolvedValue(okResponse());

        await getRouteThroughCoordinates([
            KADUWELA,
            MALABE,
            BATTARAMULLA,
            RAJAGIRIYA,
            BORELLA,
            KOLLUPITIYA,
        ]);

        expect(requestedPath()).toBe(
            '79.9833,6.9333;79.9558,6.9061;79.9186,6.8994;79.8944,6.9094;79.8778,6.9147;79.8489,6.9111'
        );
    });

    it('encodes each waypoint as longitude,latitude', async () => {
        mockFetch.mockResolvedValue(okResponse());

        await getRouteThroughCoordinates([KADUWELA, MALABE]);

        // Longitude first: a swapped pair would put this route in the ocean.
        expect(requestedPath().split(';')).toEqual(['79.9833,6.9333', '79.9558,6.9061']);
    });

    it('preserves the reverse order for a return journey', async () => {
        mockFetch.mockResolvedValue(okResponse());

        await getRouteThroughCoordinates([KOLLUPITIYA, BORELLA, RAJAGIRIYA, MALABE, KADUWELA]);

        expect(requestedPath()).toBe(
            '79.8489,6.9111;79.8778,6.9147;79.8944,6.9094;79.9558,6.9061;79.9833,6.9333'
        );
    });

    it('requests the full geometry rather than a simplified one', async () => {
        mockFetch.mockResolvedValue(okResponse());

        await getRouteThroughCoordinates([KADUWELA, MALABE, KOLLUPITIYA]);

        const [url] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('overview=full');
        expect(String(url)).toContain('geometries=geojson');
    });

    it('skips waypoints with unusable coordinates', async () => {
        mockFetch.mockResolvedValue(okResponse());

        await getRouteThroughCoordinates([
            KADUWELA,
            { latitude: Number.NaN, longitude: 79.9558 },
            KOLLUPITIYA,
        ]);

        expect(requestedPath()).toBe('79.9833,6.9333;79.8489,6.9111');
    });

    it('returns the converted road figures for the constrained path', async () => {
        mockFetch.mockResolvedValue(okResponse());

        expect(await getRouteThroughCoordinates([KADUWELA, MALABE, KOLLUPITIYA])).toEqual({
            distanceKm: 22.5,
            durationMinutes: 69,
            geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.84, 6.91]] },
        });
    });

    it('does not call the service with fewer than two usable waypoints', async () => {
        expect(await getRouteThroughCoordinates([KADUWELA])).toBeNull();
        expect(await getRouteThroughCoordinates([])).toBeNull();
        expect(
            await getRouteThroughCoordinates([KADUWELA, { latitude: NaN, longitude: NaN }])
        ).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
