import {
    getRouteBetweenCoordinates,
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
