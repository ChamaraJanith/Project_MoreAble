import { geocodeLocation } from '../../../src/shared/api/locationService';

// Every external call is mocked — no real Nominatim request is ever made.
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, ok = true) {
    return {
        ok,
        json: async () => body,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('geocodeLocation', () => {
    it('resolves a known location to coordinates', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse([
                { lat: '6.9333', lon: '79.9833', display_name: 'Kaduwela, Colombo, Sri Lanka' },
            ])
        );

        const result = await geocodeLocation('Kaduwela');

        expect(result).toEqual({
            latitude: 6.9333,
            longitude: 79.9833,
            displayName: 'Kaduwela, Colombo, Sri Lanka',
        });
    });

    it('calls Nominatim with an identifying User-Agent', async () => {
        mockFetch.mockResolvedValue(jsonResponse([{ lat: '6.9', lon: '79.9' }]));

        await geocodeLocation('Kaduwela');

        const [url, init] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('/search');
        expect(String(url)).toContain('q=Kaduwela');
        expect(init.headers['User-Agent']).toMatch(/MoreAble/);
    });

    it('returns null when Nominatim finds no results', async () => {
        mockFetch.mockResolvedValue(jsonResponse([]));

        expect(await geocodeLocation('InvalidLocationXYZ')).toBeNull();
    });

    it('returns null when the request fails', async () => {
        mockFetch.mockRejectedValue(new Error('network down'));

        expect(await geocodeLocation('Kaduwela')).toBeNull();
    });

    it('returns null on a non-2xx response', async () => {
        mockFetch.mockResolvedValue(jsonResponse([], false));

        expect(await geocodeLocation('Kaduwela')).toBeNull();
    });

    it('returns null on a malformed response body', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ unexpected: 'shape' }));

        expect(await geocodeLocation('Kaduwela')).toBeNull();
    });

    it('returns null when coordinates are not numeric', async () => {
        mockFetch.mockResolvedValue(jsonResponse([{ lat: 'not-a-number', lon: '79.9' }]));

        expect(await geocodeLocation('Kaduwela')).toBeNull();
    });

    it('does not call the service for a blank location', async () => {
        expect(await geocodeLocation('   ')).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
