import { createFakeFirestore } from '../../testUtils/fakeFirestore';

import { DELETE as deleteStop } from '../../../app/api/stops/[stopId]+api';

const mockGetAdminDb = jest.fn();

// jest.mock is hoisted above imports by ts-jest, so the route module resolves
// getAdminDb to this mock before it runs.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

function buildRequest(stopId: string): Request {
    return new Request(`http://localhost/api/stops/${stopId}`, { method: 'DELETE' });
}

const battaramulla = { id: 'battaramulla', name: 'Battaramulla', latitude: 6.90167, longitude: 79.91917 };
const nugegoda = { id: 'nugegoda', name: 'Nugegoda', latitude: 6.8724, longitude: 79.8887 };

const routeUsingNameOnly = {
    id: '177_KADUWELA_KOLLUPITIYA',
    routeId: '177_KADUWELA_KOLLUPITIYA',
    routeNumber: '177',
    startStopId: 'kaduwela',
    endStopId: 'kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Kollupitiya'],
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('DELETE /api/stops/:stopId — referential integrity', () => {
    it('deletes a stop that no route references', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ stops: [nugegoda], routes: [routeUsingNameOnly] })
        );

        const response = await deleteStop(buildRequest('nugegoda'));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
    });

    it('refuses to delete a stop referenced by name in a route stop list', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ stops: [battaramulla], routes: [routeUsingNameOnly] })
        );

        const response = await deleteStop(buildRequest('battaramulla'));
        const json = await response.json();

        expect(response.status).toBe(409);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/used by one or more routes/i);
        expect(json.routeNumbers).toContain('177');
    });

    it('refuses to delete a stop referenced as a route start or end stop', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                stops: [{ id: 'kaduwela', name: 'Kaduwela', latitude: 6.93, longitude: 79.98 }],
                routes: [{ ...routeUsingNameOnly, stops: ['Malabe', 'Kollupitiya'] }],
            })
        );

        const response = await deleteStop(buildRequest('kaduwela'));
        const json = await response.json();

        expect(response.status).toBe(409);
        expect(json.message).toMatch(/used by one or more routes/i);
    });

    it('matches referenced names case-insensitively', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                stops: [battaramulla],
                routes: [{ ...routeUsingNameOnly, stops: ['  battaramulla  '] }],
            })
        );

        const response = await deleteStop(buildRequest('battaramulla'));

        expect(response.status).toBe(409);
    });

    it('returns 404 for a stop that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ stops: [], routes: [] }));

        const response = await deleteStop(buildRequest('does-not-exist'));
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
    });
});