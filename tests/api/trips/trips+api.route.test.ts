import { Bus } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { GET as getTrips, POST as createTrip } from '../../../app/api/trips/index+api';
import { DELETE as deactivateTrip, GET as getTrip, PUT as updateTrip } from '../../../app/api/trips/[tripId]+api';

const mockGetAdminDb = jest.fn();

// jest.mock calls are hoisted above imports by ts-jest, so the trip route
// modules' getAdminDb import resolves to this mock before they run.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

function buildRequest(pathname: string, method: string, body?: unknown): Request {
    return new Request(`http://localhost${pathname}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

const activeRoute: Route & { id: string } = {
    id: '177_KADUWELA_KOLLUPITIYA',
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

const inactiveRoute: Route & { id: string } = {
    ...activeRoute,
    id: '177_INACTIVE',
    routeId: '177_INACTIVE',
    status: 'INACTIVE',
};

const activeBus: Bus & { id: string } = {
    id: 'BUS-00001',
    busId: 'BUS-00001',
    numberPlate: 'NB-1234',
    chassisNumber: 'CHS-0001',
    busModel: 'Ashok Leyland Viking',
    manufacturer: 'Ashok Leyland',
    manufactureYear: 2025,
    seatCapacity: 54,
    accessibilityFacilities: {
        wheelchairRamp: true,
        audioAnnouncement: true,
        lowFloorVehicle: true,
        walkingAssistance: false,
        wheelchairSpace: { available: true, count: 2 },
        guardianSeats: { available: true, count: 2 },
        prioritySeats: { available: true, count: 4 },
        elderlySeats: { available: true, count: 4 },
    },
    status: 'ACTIVE',
};

const inactiveBus: Bus & { id: string } = {
    ...activeBus,
    id: 'BUS-INACTIVE',
    busId: 'BUS-INACTIVE',
    numberPlate: 'NB-9999',
    status: 'INACTIVE',
};

const validTripBody = {
    routeId: activeRoute.routeId,
    busId: activeBus.busId,
    departureTime: '06:00',
    estimatedArrivalTime: '07:10',
    turnNumber: 1,
    status: 'ACTIVE',
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /api/trips', () => {
    it('creates a valid trip', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [activeRoute], buses: [activeBus] })
        );

        const response = await createTrip(buildRequest('/api/trips', 'POST', validTripBody));
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.trip.tripId).toMatch(/^TRIP-\d{5}$/);
        expect(json.trip.routeId).toBe(activeRoute.routeId);
        expect(json.trip.busId).toBe(activeBus.busId);
        expect(json.trip.turnNumber).toBe(1);
    });

    it('rejects a trip missing routeId', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const { routeId, ...rest } = validTripBody;
        const response = await createTrip(buildRequest('/api/trips', 'POST', rest));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/routeId/);
    });

    it('rejects a trip missing busId', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const { busId, ...rest } = validTripBody;
        const response = await createTrip(buildRequest('/api/trips', 'POST', rest));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/busId/);
    });

    it('rejects a trip referencing a route that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ buses: [activeBus] }));

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, routeId: 'DOES_NOT_EXIST' })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/route does not exist/i);
    });

    it('rejects a trip referencing a bus that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [activeRoute] }));

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, busId: 'DOES_NOT_EXIST' })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/bus does not exist/i);
    });

    it('rejects a trip referencing an inactive route', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [inactiveRoute], buses: [activeBus] })
        );

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, routeId: inactiveRoute.routeId })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/route is not ACTIVE/i);
    });

    it('rejects a trip referencing an inactive bus', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [activeRoute], buses: [inactiveBus] })
        );

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, busId: inactiveBus.busId })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/bus is not ACTIVE/i);
    });

    it('rejects an invalid departureTime', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [activeRoute], buses: [activeBus] })
        );

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, departureTime: '6:00' })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/departureTime/);
    });

    it('rejects an invalid estimatedArrivalTime', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [activeRoute], buses: [activeBus] })
        );

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, estimatedArrivalTime: '25:00' })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/estimatedArrivalTime/);
    });

    it('rejects an invalid turnNumber', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [activeRoute], buses: [activeBus] })
        );

        const response = await createTrip(
            buildRequest('/api/trips', 'POST', { ...validTripBody, turnNumber: 0 })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/turnNumber/);
    });
});

describe('GET /api/trips', () => {
    it('returns all trips', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                trips: [
                    { id: 'TRIP-00001', tripId: 'TRIP-00001', routeId: activeRoute.routeId, busId: activeBus.busId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1, status: 'ACTIVE' },
                    { id: 'TRIP-00002', tripId: 'TRIP-00002', routeId: activeRoute.routeId, busId: activeBus.busId, departureTime: '09:00', estimatedArrivalTime: '10:10', turnNumber: 2, status: 'ACTIVE' },
                ],
            })
        );

        const response = await getTrips();
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(2);
        expect(json.trips.map((t: any) => t.tripId)).toEqual(
            expect.arrayContaining(['TRIP-00001', 'TRIP-00002'])
        );
    });
});

describe('GET /api/trips/:tripId', () => {
    it('returns a single trip', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                trips: [{ id: 'TRIP-00001', tripId: 'TRIP-00001', routeId: activeRoute.routeId, busId: activeBus.busId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1, status: 'ACTIVE' }],
            })
        );

        const response = await getTrip(buildRequest('/api/trips/TRIP-00001', 'GET'), { tripId: 'TRIP-00001' });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.trip.tripId).toBe('TRIP-00001');
    });

    it('returns 404 for a non-existing trip', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ trips: [] }));

        const response = await getTrip(buildRequest('/api/trips/TRIP-99999', 'GET'), { tripId: 'TRIP-99999' });
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
    });
});

describe('PUT /api/trips/:tripId', () => {
    it('applies a valid update', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [activeRoute],
                buses: [activeBus],
                trips: [{ id: 'TRIP-00001', tripId: 'TRIP-00001', routeId: activeRoute.routeId, busId: activeBus.busId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1, status: 'ACTIVE' }],
            })
        );

        const response = await updateTrip(
            buildRequest('/api/trips/TRIP-00001', 'PUT', { departureTime: '06:30', status: 'INACTIVE' })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.trip.departureTime).toBe('06:30');
        expect(json.trip.status).toBe('INACTIVE');
    });

    it('rejects an update referencing a bus that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [activeRoute],
                buses: [activeBus],
                trips: [{ id: 'TRIP-00001', tripId: 'TRIP-00001', routeId: activeRoute.routeId, busId: activeBus.busId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1, status: 'ACTIVE' }],
            })
        );

        const response = await updateTrip(
            buildRequest('/api/trips/TRIP-00001', 'PUT', { busId: 'DOES_NOT_EXIST' })
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/bus does not exist/i);
    });
});

describe('DELETE /api/trips/:tripId', () => {
    it('soft-deactivates the trip instead of deleting the document', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                trips: [{ id: 'TRIP-00001', tripId: 'TRIP-00001', routeId: activeRoute.routeId, busId: activeBus.busId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1, status: 'ACTIVE' }],
            })
        );

        const response = await deactivateTrip(buildRequest('/api/trips/TRIP-00001', 'DELETE'));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.trip.status).toBe('INACTIVE');
        expect(json.trip.tripId).toBe('TRIP-00001');
    });
});
