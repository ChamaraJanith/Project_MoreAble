import { Route } from '../../../src/entities/route/model/types';
import { POST } from '../../../app/api/journeys/search+api';

const mockGet = jest.fn();
const mockWhere = jest.fn(() => ({ get: mockGet }));
const mockCollection = jest.fn(() => ({ where: mockWhere }));
const mockGetAdminDb = jest.fn(() => ({ collection: mockCollection }));

// jest.mock calls are hoisted above imports by ts-jest, so search+api's
// getAdminDb import resolves to this mock before the module under test runs.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

function buildRequest(body: unknown): Request {
    return new Request('http://localhost/api/journeys/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function toDocs(routes: Route[]) {
    return routes.map((route) => ({ data: () => route }));
}

const validBody = {
    origin: 'Kaduwela',
    destination: 'Battaramulla',
    travelDate: '2026-08-13',
    travelTime: '08:30',
};

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

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /api/journeys/search', () => {
    it('returns 400 when origin is missing', async () => {
        mockGet.mockResolvedValue({ docs: [] });

        const response = await POST(buildRequest({ ...validBody, origin: '' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/origin/i);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('returns 400 when destination is missing', async () => {
        const response = await POST(buildRequest({ ...validBody, destination: '   ' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/destination/i);
    });

    it('returns 400 when travelDate is missing or invalid', async () => {
        const response = await POST(buildRequest({ ...validBody, travelDate: 'not-a-date' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/travel date/i);
    });

    it('returns 400 when travelTime is missing or invalid', async () => {
        const response = await POST(buildRequest({ ...validBody, travelTime: '25:99' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/travel time/i);
    });

    it('returns matching routes for a valid search', async () => {
        mockGet.mockResolvedValue({ docs: toDocs([forwardRoute]) });

        const response = await POST(buildRequest(validBody));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(1);
        expect(json.routes[0].routeId).toBe('177_KADUWELA_KOLLUPITIYA');
        expect(mockCollection).toHaveBeenCalledWith('routes');
        expect(mockWhere).toHaveBeenCalledWith('status', '==', 'ACTIVE');
    });

    it('returns an empty success result when no route matches', async () => {
        mockGet.mockResolvedValue({ docs: toDocs([forwardRoute]) });

        const response = await POST(buildRequest({ ...validBody, destination: 'Nowhere' }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        expect(json.routes).toEqual([]);
    });

    it('returns 500 when Firestore throws an error', async () => {
        mockGet.mockRejectedValue(new Error('Firestore unavailable'));

        const response = await POST(buildRequest(validBody));
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.error).toBe('Firestore unavailable');
    });
});
