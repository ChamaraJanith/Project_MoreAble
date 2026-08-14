import { Bus } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { POST } from '../../../app/api/journeys/search+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

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

const validBody = {
    origin: 'Kaduwela',
    destination: 'Battaramulla',
    travelDate: '2026-08-13',
    travelTime: '08:30',
};

const forwardRoute: Route & { id: string } = {
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

const reverseRoute: Route & { id: string } = {
    id: '177_KOLLUPITIYA_KADUWELA',
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

const bus1: Bus & { id: string } = {
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

function trip(overrides: Partial<Trip> & { routeId: string }): Trip & { id: string } {
    return {
        id: overrides.tripId ?? 'TRIP-00000',
        tripId: overrides.tripId ?? 'TRIP-00000',
        busId: 'BUS-00001',
        departureTime: '06:00',
        estimatedArrivalTime: '07:10',
        turnNumber: 1,
        status: 'ACTIVE',
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /api/journeys/search', () => {
    it('returns 400 when origin is missing', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const response = await POST(buildRequest({ ...validBody, origin: '' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/origin/i);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('returns 400 when destination is missing', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const response = await POST(buildRequest({ ...validBody, destination: '   ' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/destination/i);
    });

    it('returns 400 when travelDate is missing or invalid', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const response = await POST(buildRequest({ ...validBody, travelDate: 'not-a-date' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/travel date/i);
    });

    it('returns 400 when travelTime is missing or invalid', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore());

        const response = await POST(buildRequest({ ...validBody, travelTime: '25:99' }));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/travel time/i);
    });

    it('returns matching routes for a valid search', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [forwardRoute],
                trips: [],
                buses: [bus1],
            })
        );

        const response = await POST(buildRequest(validBody));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(1);
        expect(json.routes[0].routeId).toBe('177_KADUWELA_KOLLUPITIYA');
    });

    it('returns an empty success result when both locations are valid but no route connects them', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [forwardRoute], trips: [], buses: [bus1] })
        );

        // Both are real stops on the route, but only in the opposite order, so
        // this is a legitimate "no results" rather than a validation failure.
        const response = await POST(
            buildRequest({ ...validBody, origin: 'Battaramulla', destination: 'Kaduwela' })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.count).toBe(0);
        expect(json.routes).toEqual([]);
    });

    // ---------------------------------------------------------------
    // MOV-84 — location validation
    // ---------------------------------------------------------------
    describe('location validation', () => {
        const seededDb = () =>
            createFakeFirestore({ routes: [forwardRoute], trips: [], buses: [bus1] });

        it('returns 400 for a whitespace-only origin', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(buildRequest({ ...validBody, origin: '   ' }));
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(/origin/i);
        });

        it('returns 400 for a whitespace-only destination', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(buildRequest({ ...validBody, destination: '   ' }));
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(/destination/i);
        });

        it('returns 400 for an origin the system does not know', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(
                buildRequest({ ...validBody, origin: 'InvalidLocationXYZ' })
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json).toMatchObject({
                success: false,
                message: 'Invalid origin location',
            });
        });

        it('returns 400 for a destination the system does not know', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(
                buildRequest({ ...validBody, destination: 'InvalidLocationXYZ' })
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json).toMatchObject({
                success: false,
                message: 'Invalid destination location',
            });
        });

        it('returns 400 when origin and destination are the same', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(
                buildRequest({ ...validBody, origin: 'Kaduwela', destination: 'Kaduwela' })
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json).toMatchObject({
                success: false,
                message: 'Origin and destination cannot be the same',
            });
        });

        it('treats the same location differing only by case and spacing as identical', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(
                buildRequest({ ...validBody, origin: 'Kaduwela', destination: '  kaduwela ' })
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toBe('Origin and destination cannot be the same');
        });

        it('accepts a location that exists only in the stops master collection', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [],
                    buses: [bus1],
                    stops: [{ id: 'STOP-NUGEGODA', stopId: 'STOP-NUGEGODA', name: 'Nugegoda' }],
                })
            );

            // Known location, but no route serves it — a 200 with no results,
            // never a validation error.
            const response = await POST(
                buildRequest({ ...validBody, destination: 'Nugegoda' })
            );
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.count).toBe(0);
        });

        it('does not reach the database when a required location is missing', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(buildRequest({ ...validBody, origin: '' }));

            expect(response.status).toBe(400);
            expect(mockGetAdminDb).not.toHaveBeenCalled();
        });
    });

    it('returns 500 when Firestore throws an error', async () => {
        const failingDb = {
            collection: jest.fn(() => ({
                where: jest.fn(() => ({
                    get: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
                })),
            })),
        };
        mockGetAdminDb.mockReturnValue(failingDb);

        const response = await POST(buildRequest(validBody));
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.error).toBe('Firestore unavailable');
    });

    describe('trip and bus enrichment', () => {
        it('attaches the earliest upcoming trip and its bus to a matched route', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [
                        trip({ tripId: 'TRIP-00001', routeId: forwardRoute.routeId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1 }),
                        trip({ tripId: 'TRIP-00003', routeId: forwardRoute.routeId, departureTime: '09:00', estimatedArrivalTime: '10:10', turnNumber: 3 }),
                    ],
                    buses: [bus1],
                })
            );

            // Mirrors the task's own worked example: searching at 08:30 must skip
            // the 06:00 trip (already departed) and return the 09:00 one.
            const response = await POST(buildRequest({ ...validBody, travelTime: '08:30' }));
            const json = await response.json();

            expect(response.status).toBe(200);
            const match = json.routes[0];

            expect(match.trips).toHaveLength(1);
            expect(match.trips[0].trip).toEqual({
                tripId: 'TRIP-00003',
                departureTime: '09:00',
                estimatedArrivalTime: '10:10',
                turnNumber: 3,
            });
            expect(match.trips[0].bus).toEqual({
                busId: 'BUS-00001',
                numberPlate: 'NB-1234',
                busModel: 'Ashok Leyland Viking',
                manufacturer: 'Ashok Leyland',
                seatCapacity: 54,
                accessibilityFacilities: bus1.accessibilityFacilities,
            });
        });

        it('excludes a trip that has already departed before the requested time', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [trip({ tripId: 'TRIP-00001', routeId: forwardRoute.routeId, departureTime: '06:00' })],
                    buses: [bus1],
                })
            );

            const response = await POST(buildRequest({ ...validBody, travelTime: '08:30' }));
            const json = await response.json();

            expect(json.routes[0].trips).toEqual([]);
        });

        it('excludes inactive trips even when their departure time would otherwise qualify', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [
                        trip({ tripId: 'TRIP-INACTIVE', routeId: forwardRoute.routeId, departureTime: '08:45', status: 'INACTIVE' }),
                        trip({ tripId: 'TRIP-00003', routeId: forwardRoute.routeId, departureTime: '09:00' }),
                    ],
                    buses: [bus1],
                })
            );

            const response = await POST(buildRequest({ ...validBody, travelTime: '08:30' }));
            const json = await response.json();

            expect(json.routes[0].trips).toHaveLength(1);
            expect(json.routes[0].trips[0].trip.tripId).toBe('TRIP-00003');
        });

        it('returns the correct bus for the selected trip via busId', async () => {
            const bus2: Bus & { id: string } = {
                ...bus1,
                id: 'BUS-00002',
                busId: 'BUS-00002',
                numberPlate: 'NB-5678',
            };

            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [trip({ tripId: 'TRIP-00003', routeId: forwardRoute.routeId, departureTime: '09:00', busId: 'BUS-00002' })],
                    buses: [bus1, bus2],
                })
            );

            const response = await POST(buildRequest({ ...validBody, travelTime: '08:30' }));
            const json = await response.json();

            expect(json.routes[0].trips[0].bus.busId).toBe('BUS-00002');
            expect(json.routes[0].trips[0].bus.numberPlate).toBe('NB-5678');
        });

        it('resolves trips for the reverse-direction route independently', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute, reverseRoute],
                    trips: [
                        trip({ tripId: 'TRIP-00001', routeId: forwardRoute.routeId, departureTime: '06:00', estimatedArrivalTime: '07:10', turnNumber: 1 }),
                        trip({ tripId: 'TRIP-00002', routeId: reverseRoute.routeId, departureTime: '07:30', estimatedArrivalTime: '08:40', turnNumber: 2 }),
                    ],
                    buses: [bus1],
                })
            );

            const response = await POST(buildRequest({
                origin: 'Battaramulla',
                destination: 'Kaduwela',
                travelDate: '2026-08-13',
                travelTime: '07:00',
            }));
            const json = await response.json();

            expect(json.routes).toHaveLength(1);
            expect(json.routes[0].routeId).toBe(reverseRoute.routeId);
            expect(json.routes[0].trips[0].trip.tripId).toBe('TRIP-00002');
        });

        it('still returns a matched route with an empty trips list when none is available', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [],
                    buses: [bus1],
                })
            );

            const response = await POST(buildRequest(validBody));
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.routes).toHaveLength(1);
            expect(json.routes[0].trips).toEqual([]);
        });

        it('returns every upcoming trip of a route as a separate option, earliest first', async () => {
            const bus2: Bus & { id: string } = {
                ...bus1,
                id: 'BUS-00002',
                busId: 'BUS-00002',
                numberPlate: 'NB-5678',
            };

            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [
                        trip({ tripId: 'TRIP-00005', routeId: forwardRoute.routeId, departureTime: '11:00', estimatedArrivalTime: '12:10', turnNumber: 5, busId: 'BUS-00002' }),
                        trip({ tripId: 'TRIP-00001', routeId: forwardRoute.routeId, departureTime: '06:00', turnNumber: 1 }),
                        trip({ tripId: 'TRIP-00003', routeId: forwardRoute.routeId, departureTime: '09:00', estimatedArrivalTime: '10:10', turnNumber: 3 }),
                    ],
                    buses: [bus1, bus2],
                })
            );

            const response = await POST(buildRequest({ ...validBody, travelTime: '08:30' }));
            const json = await response.json();

            const options = json.routes[0].trips;

            // The 06:00 trip already departed; the other two remain as distinct
            // options and are distinguishable by their times and bus.
            expect(options).toHaveLength(2);
            expect(options.map((option: any) => option.trip.tripId)).toEqual(['TRIP-00003', 'TRIP-00005']);
            expect(options[0].bus.numberPlate).toBe('NB-1234');
            expect(options[1].bus.numberPlate).toBe('NB-5678');
        });
    });
});
