import { Bus } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { POST } from '../../../app/api/journeys/search+api';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
// Each matched route's own road path is requested through its ordered stops.
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

const mockGetAdminDb = jest.fn();

// jest.mock calls are hoisted above imports by ts-jest, so search+api's
// getAdminDb import resolves to this mock before the module under test runs.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// MOV-85: the external map/routing providers are always mocked — Jest never
// performs a real Nominatim or OSRM request.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
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

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
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

    it('exposes the route identity the transport display reads', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [forwardRoute], trips: [], buses: [bus1] })
        );

        const response = await POST(buildRequest(validBody));
        const json = await response.json();
        const match = json.routes[0];

        // Route Details renders the number badge, the route name and the
        // origin -> destination pair from these fields; dropping one would leave
        // the header blank without failing anything else.
        expect(match).toMatchObject({
            routeId: '177_KADUWELA_KOLLUPITIYA',
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            origin: 'Kaduwela',
            destination: 'Battaramulla',
        });

        // origin/destination are the passenger's own boarding and alighting
        // stops, not the route's endpoints — the searched journey stops short of
        // Kollupitiya, and the display must say so.
        expect(match.destination).not.toBe(match.endLocation);
        expect(match.endLocation).toBe('Kollupitiya');
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

    // ---------------------------------------------------------------
    // MOV-85 — map / location service enrichment
    // ---------------------------------------------------------------
    describe('map and routing enrichment', () => {
        const seededDb = () =>
            createFakeFirestore({ routes: [forwardRoute], trips: [], buses: [bus1] });

        it('attaches geocoded endpoints and road routing to a successful search', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());
            mockGeocodeLocation
                .mockResolvedValueOnce({ latitude: 6.9333, longitude: 79.9833, displayName: 'Kaduwela' })
                .mockResolvedValueOnce({ latitude: 6.9021, longitude: 79.9186, displayName: 'Battaramulla' });
            mockGetRoute.mockResolvedValue({
                distanceKm: 22.5,
                durationMinutes: 69,
                geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.91, 6.9]] },
            });

            const response = await POST(buildRequest(validBody));
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.geo).toMatchObject({
                available: true,
                origin: { latitude: 6.9333, longitude: 79.9833 },
                destination: { latitude: 6.9021, longitude: 79.9186 },
                road: { distanceKm: 22.5, durationMinutes: 69 },
            });
            // The existing route/trip/bus contract is untouched.
            expect(json.routes[0].routeId).toBe('177_KADUWELA_KOLLUPITIYA');
        });

        it('still returns the journey result when geocoding fails', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());
            mockGeocodeLocation.mockResolvedValue(null);

            const response = await POST(buildRequest(validBody));
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.count).toBe(1);
            expect(json.geo.available).toBe(false);
            expect(json.geo.message).toBeTruthy();
        });

        it('still returns the journey result when road routing fails', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());
            mockGetRoute.mockResolvedValue(null);

            const response = await POST(buildRequest(validBody));
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.count).toBe(1);
            expect(json.geo.available).toBe(false);
            expect(json.geo.origin).toBeDefined();
        });

        it('never fails the search when a provider throws', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());
            mockGeocodeLocation.mockRejectedValue(new Error('provider exploded'));

            const response = await POST(buildRequest(validBody));
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.geo.available).toBe(false);
        });

        it('prefers stored stop coordinates over calling the geocoder', async () => {
            mockGetAdminDb.mockReturnValue(
                createFakeFirestore({
                    routes: [forwardRoute],
                    trips: [],
                    buses: [bus1],
                    stops: [
                        { id: 'S1', name: 'Kaduwela', latitude: 6.93, longitude: 79.98 },
                        { id: 'S2', name: 'Battaramulla', latitude: 6.9, longitude: 79.91 },
                    ],
                })
            );

            const response = await POST(buildRequest(validBody));
            const json = await response.json();

            expect(json.geo.origin).toMatchObject({ latitude: 6.93, longitude: 79.98 });
            expect(json.geo.destination).toMatchObject({ latitude: 6.9, longitude: 79.91 });
            // Firestore already had both, so Nominatim was never contacted.
            expect(mockGeocodeLocation).not.toHaveBeenCalled();
        });

        it('geocodes each distinct location at most once per request', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            await POST(buildRequest(validBody));

            expect(mockGeocodeLocation).toHaveBeenCalledTimes(2);
        });

        it('includes geo information even when no route matches', async () => {
            mockGetAdminDb.mockReturnValue(seededDb());

            const response = await POST(
                buildRequest({ ...validBody, origin: 'Battaramulla', destination: 'Kaduwela' })
            );
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.count).toBe(0);
            expect(json.geo).toBeDefined();
        });
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
                // Carried so a recommendation can be ranked by it (MOV-89).
                // Read from the shared function rather than written down, so
                // this stays a check of the contract, not of the arithmetic.
                accessibilityScore: computeAccessibilityScore(bus1.accessibilityFacilities),
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

        it('gives both turns of one vehicle the same bus, reading it once', async () => {
            // One bus commonly runs several turns in a day, so this is the
            // ordinary case for the per-request bus memoisation: the second turn
            // must still carry the full vehicle, not a null or a stale entry.
            const busReads: string[] = [];

            const db = createFakeFirestore({
                routes: [forwardRoute],
                trips: [
                    trip({ tripId: 'TRIP-00003', routeId: forwardRoute.routeId, departureTime: '09:00', estimatedArrivalTime: '10:10', turnNumber: 3, busId: 'BUS-00001' }),
                    trip({ tripId: 'TRIP-00007', routeId: forwardRoute.routeId, departureTime: '13:00', estimatedArrivalTime: '14:10', turnNumber: 7, busId: 'BUS-00001' }),
                ],
                buses: [bus1],
            });

            const openCollection = db.collection;

            mockGetAdminDb.mockReturnValue({
                ...db,
                collection: jest.fn((name: string) => {
                    const target = openCollection(name);
                    if (name !== 'buses') return target;

                    return {
                        ...target,
                        doc: jest.fn((id: string) => {
                            busReads.push(id);
                            return target.doc(id);
                        }),
                    };
                }),
            });

            const response = await POST(buildRequest({ ...validBody, travelTime: '08:30' }));
            const json = await response.json();

            const options = json.routes[0].trips;

            expect(options.map((option: any) => option.trip.tripId)).toEqual([
                'TRIP-00003',
                'TRIP-00007',
            ]);
            expect(options[0].bus).toEqual(options[1].bus);
            expect(options[1].bus.numberPlate).toBe('NB-1234');
            expect(options[1].bus.accessibilityFacilities).toEqual(bus1.accessibilityFacilities);
            // Memoised: the shared vehicle is fetched a single time per request.
            expect(busReads).toEqual(['BUS-00001']);
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

// ==================================================================
// ROAD PATH ALONG THE ROUTE'S OWN STOPS
//
// A bus route is not the fastest road between its endpoints. Routing on the
// endpoints alone let OSRM pick its own shortcut, so each matched route's road
// path is now requested through that route's ordered stops.
// ==================================================================
describe('POST /api/journeys/search - waypoint-constrained road path', () => {
    const STOP_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
        Kaduwela: { latitude: 6.9333, longitude: 79.9833 },
        Malabe: { latitude: 6.9061, longitude: 79.9558 },
        Battaramulla: { latitude: 6.8994, longitude: 79.9186 },
        Rajagiriya: { latitude: 6.9094, longitude: 79.8944 },
        Borella: { latitude: 6.9147, longitude: 79.8778 },
        Kollupitiya: { latitude: 6.9167, longitude: 79.85 },
    };

    const mappedStops = Object.entries(STOP_COORDINATES).map(([name, point]) => ({
        id: `STOP-${name.toUpperCase()}`,
        stopId: `STOP-${name.toUpperCase()}`,
        name,
        ...point,
    }));

    const dbWithMappedStops = (routes: (Route & { id: string })[] = [forwardRoute]) =>
        createFakeFirestore({ routes, trips: [], buses: [bus1], stops: mappedStops });

    /** The waypoints handed to OSRM, named by looking their coordinates up. */
    const requestedWaypointNames = () =>
        (mockGetRouteThrough.mock.calls[0][0] as { latitude: number; longitude: number }[]).map(
            (point) =>
                Object.keys(STOP_COORDINATES).find(
                    (name) =>
                        STOP_COORDINATES[name].latitude === point.latitude &&
                        STOP_COORDINATES[name].longitude === point.longitude
                ) ?? 'unknown'
        );

    it('routes through every stop of the journey, not just the endpoints', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops());

        await POST(buildRequest({ ...validBody, destination: 'Kollupitiya' }));

        expect(requestedWaypointNames()).toEqual([
            'Kaduwela',
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
            'Kollupitiya',
        ]);
    });

    it('constrains a partial journey to its own stops only', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops());

        // Kaduwela -> Battaramulla must pass through Malabe and stop there.
        await POST(buildRequest(validBody));

        expect(requestedWaypointNames()).toEqual(['Kaduwela', 'Malabe', 'Battaramulla']);
    });

    it('routes a single hop between its two stops', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops());

        await POST(buildRequest({ ...validBody, destination: 'Malabe' }));

        expect(requestedWaypointNames()).toEqual(['Kaduwela', 'Malabe']);
    });

    it('follows the return direction for the reverse route', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops([reverseRoute]));

        await POST(
            buildRequest({ ...validBody, origin: 'Kollupitiya', destination: 'Kaduwela' })
        );

        expect(requestedWaypointNames()).toEqual([
            'Kollupitiya',
            'Borella',
            'Rajagiriya',
            'Battaramulla',
            'Malabe',
            'Kaduwela',
        ]);
    });

    it('attaches the resulting road path to the matched route', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops());
        mockGetRouteThrough.mockResolvedValue({
            distanceKm: 18.4,
            durationMinutes: 41,
            geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.92, 6.9]] },
        });

        const response = await POST(buildRequest({ ...validBody, destination: 'Kollupitiya' }));
        const json = await response.json();

        expect(json.routes[0].road).toEqual({
            distanceKm: 18.4,
            durationMinutes: 41,
            geometry: { type: 'LineString', coordinates: [[79.98, 6.93], [79.92, 6.9]] },
        });
    });

    it('asks for one road path per matched route', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops([forwardRoute, reverseRoute]));

        // Only the forward route runs Kaduwela -> Kollupitiya in that order.
        await POST(buildRequest({ ...validBody, destination: 'Kollupitiya' }));

        expect(mockGetRouteThrough).toHaveBeenCalledTimes(1);
    });

    it('still returns the route when the road path cannot be resolved', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops());
        mockGetRouteThrough.mockResolvedValue(null);

        const response = await POST(buildRequest({ ...validBody, destination: 'Kollupitiya' }));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.routes).toHaveLength(1);
        expect(json.routes[0].road).toBeUndefined();
        // The scheduled figures are untouched by any of this.
        expect(json.routes[0].estimatedDuration).toBe('1h 15m');
    });

    it('leaves the scheduled duration alone when a road duration is available', async () => {
        mockGetAdminDb.mockReturnValue(dbWithMappedStops());
        mockGetRouteThrough.mockResolvedValue({ distanceKm: 18.4, durationMinutes: 41 });

        const response = await POST(buildRequest({ ...validBody, destination: 'Kollupitiya' }));
        const json = await response.json();

        expect(json.routes[0].estimatedDuration).toBe('1h 15m');
        expect(json.routes[0].road.durationMinutes).toBe(41);
    });
});

// ==================================================================
// MOV-96 — RESILIENT ROUTE DETAIL RETRIEVAL
//
// Every field the Route Details screen needs already comes from this endpoint.
// What these cover is the retrieval surviving malformed records, so one bad
// document cannot take the whole search down.
// ==================================================================
describe('POST /api/journeys/search - malformed records', () => {
    /**
     * The shared double resolves any document path, including an empty one.
     * Firestore itself throws, so these guards would look unnecessary against
     * the permissive double — this wrapper reproduces the real behaviour.
     */
    function strictFirestore(seed: Record<string, Record<string, any>[]>) {
        const db = createFakeFirestore(seed);
        const openCollection = db.collection;

        return {
            ...db,
            collection: jest.fn((name: string) => {
                const target = openCollection(name);

                return {
                    ...target,
                    doc: jest.fn((id: string) => {
                        if (typeof id !== 'string' || !id.trim()) {
                            throw new Error(
                                'Value for argument "documentPath" is not a valid resource path.'
                            );
                        }
                        return target.doc(id);
                    }),
                    where: jest.fn((field: string, op: string, value: unknown) => {
                        if (value === undefined) {
                            throw new Error(
                                'Value for argument "value" is not a valid query constraint.'
                            );
                        }
                        return target.where(field, op, value);
                    }),
                };
            }),
        };
    }

    const kollupitiyaBody = { ...validBody, destination: 'Kollupitiya' };

    it('returns the departure with no bus when the trip names none', async () => {
        mockGetAdminDb.mockReturnValue(
            strictFirestore({
                routes: [forwardRoute],
                trips: [
                    trip({
                        routeId: forwardRoute.routeId,
                        tripId: 'TRIP-00001',
                        busId: '',
                        departureTime: '09:00',
                    }),
                ],
                buses: [bus1],
            })
        );

        const response = await POST(buildRequest(kollupitiyaBody));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.routes[0].trips).toHaveLength(1);
        expect(json.routes[0].trips[0].trip.tripId).toBe('TRIP-00001');
        expect(json.routes[0].trips[0].bus).toBeNull();
    });

    it('returns the departure with no bus when the bus document is missing', async () => {
        mockGetAdminDb.mockReturnValue(
            strictFirestore({
                routes: [forwardRoute],
                trips: [
                    trip({
                        routeId: forwardRoute.routeId,
                        tripId: 'TRIP-00001',
                        busId: 'BUS-DELETED',
                        departureTime: '09:00',
                    }),
                ],
                buses: [bus1],
            })
        );

        const response = await POST(buildRequest(kollupitiyaBody));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.routes[0].trips[0].bus).toBeNull();
    });

    it('still returns a matched route whose document has no route id', async () => {
        const { routeId: _omitted, ...withoutRouteId } = forwardRoute;

        mockGetAdminDb.mockReturnValue(
            strictFirestore({
                routes: [withoutRouteId as typeof forwardRoute],
                trips: [trip({ routeId: forwardRoute.routeId, tripId: 'TRIP-00001' })],
                buses: [bus1],
            })
        );

        const response = await POST(buildRequest(kollupitiyaBody));
        const json = await response.json();

        // The stop sequence is still usable for the map and the timeline, so the
        // route is reported with no departures rather than failing the search.
        expect(response.status).toBe(200);
        expect(json.routes).toHaveLength(1);
        expect(json.routes[0].journeyStops).toEqual(forwardRoute.stops);
        expect(json.routes[0].trips).toEqual([]);
    });

    it('omits a trip that has no trip id', async () => {
        mockGetAdminDb.mockReturnValue(
            strictFirestore({
                routes: [forwardRoute],
                trips: [
                    trip({ routeId: forwardRoute.routeId, tripId: '', departureTime: '09:00' }),
                    trip({
                        routeId: forwardRoute.routeId,
                        tripId: 'TRIP-00002',
                        departureTime: '09:30',
                    }),
                ],
                buses: [bus1],
            })
        );

        const response = await POST(buildRequest(kollupitiyaBody));
        const json = await response.json();

        // An id-less trip cannot be matched back from the Route Details screen.
        expect(json.routes[0].trips).toHaveLength(1);
        expect(json.routes[0].trips[0].trip.tripId).toBe('TRIP-00002');
    });

    it('gives each departure the accessibility facilities of its own bus', async () => {
        // Two buses on one route with different facilities: the Route Details
        // screen reads `option.bus.accessibilityFacilities`, so one departure
        // must never carry the other bus's facilities.
        const plainBus: Bus & { id: string } = {
            ...bus1,
            id: 'BUS-00002',
            busId: 'BUS-00002',
            numberPlate: 'NB-8899',
            accessibilityFacilities: {
                wheelchairRamp: false,
                audioAnnouncement: false,
                lowFloorVehicle: false,
                walkingAssistance: false,
                wheelchairSpace: { available: false, count: 0 },
                guardianSeats: { available: false, count: 0 },
                prioritySeats: { available: false, count: 0 },
                elderlySeats: { available: false, count: 0 },
            },
        };

        mockGetAdminDb.mockReturnValue(
            strictFirestore({
                routes: [forwardRoute],
                trips: [
                    trip({
                        routeId: forwardRoute.routeId,
                        tripId: 'TRIP-ACCESSIBLE',
                        busId: 'BUS-00001',
                        departureTime: '09:00',
                    }),
                    trip({
                        routeId: forwardRoute.routeId,
                        tripId: 'TRIP-PLAIN',
                        busId: 'BUS-00002',
                        departureTime: '09:30',
                    }),
                ],
                buses: [bus1, plainBus],
            })
        );

        const response = await POST(buildRequest(kollupitiyaBody));
        const json = await response.json();

        const [accessible, plain] = json.routes[0].trips;

        expect(accessible.trip.tripId).toBe('TRIP-ACCESSIBLE');
        expect(accessible.bus.numberPlate).toBe('NB-1234');
        expect(accessible.bus.accessibilityFacilities.wheelchairRamp).toBe(true);
        expect(accessible.bus.accessibilityFacilities.prioritySeats).toEqual({
            available: true,
            count: 4,
        });

        expect(plain.trip.tripId).toBe('TRIP-PLAIN');
        expect(plain.bus.numberPlate).toBe('NB-8899');
        // The equipped bus's facilities must not bleed into this departure.
        expect(plain.bus.accessibilityFacilities.wheelchairRamp).toBe(false);
        expect(plain.bus.accessibilityFacilities.prioritySeats).toEqual({
            available: false,
            count: 0,
        });
    });

    it('keeps the selected trip tied to its own route and bus', async () => {
        mockGetAdminDb.mockReturnValue(
            strictFirestore({
                routes: [forwardRoute, reverseRoute],
                trips: [
                    trip({
                        routeId: forwardRoute.routeId,
                        tripId: 'TRIP-FORWARD',
                        departureTime: '09:00',
                    }),
                    trip({
                        routeId: reverseRoute.routeId,
                        tripId: 'TRIP-REVERSE',
                        departureTime: '09:05',
                    }),
                ],
                buses: [bus1],
            })
        );

        const response = await POST(buildRequest(kollupitiyaBody));
        const json = await response.json();

        // Only the forward route runs Kaduwela -> Kollupitiya in that order, so
        // the reverse route's trip must not leak into this result.
        expect(json.routes).toHaveLength(1);
        expect(json.routes[0].routeId).toBe(forwardRoute.routeId);
        expect(json.routes[0].trips.map((option: any) => option.trip.tripId)).toEqual([
            'TRIP-FORWARD',
        ]);
        expect(json.routes[0].trips[0].bus.busId).toBe('BUS-00001');
    });
});
