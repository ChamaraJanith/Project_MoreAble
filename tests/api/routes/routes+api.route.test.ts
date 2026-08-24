import { POST as createRoute, GET as getRoutes } from '../../../app/api/routes/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

// jest.mock is hoisted above imports by ts-jest, so the route module resolves
// getAdminDb to this mock before it runs. No real Firestore is ever touched.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function buildRequest(path: string, method: string, body?: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

/** A valid create payload matching the production route document structure. */
function validRoutePayload(overrides: Record<string, any> = {}) {
    return {
        routeId: '177_KADUWELA_KOLLUPITIYA',
        routeNumber: '177',
        routeName: 'Kaduwela - Kollupitiya',
        direction: 'OUTBOUND',
        startLocation: 'Kaduwela',
        endLocation: 'Kollupitiya',
        startStopId: 'kaduwela',
        endStopId: 'kollupitiya',
        stops: [
            'Kaduwela',
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
            'Kollupitiya',
        ],
        distanceKm: 20,
        estimatedDuration: '1 hr 9 min',
        status: 'ACTIVE',
        ...overrides,
    };
}

/** An existing stored route document, as the create endpoint would have written it. */
function storedRoute(overrides: Record<string, any> = {}) {
    const { routeId, ...rest } = validRoutePayload();
    return {
        id: routeId,
        routeId,
        ...rest,
        ...overrides,
    };
}

/** A Firestore double whose reads reject, for error-path coverage. */
function failingFirestore(message = 'Firestore unavailable') {
    return {
        collection: jest.fn(() => ({
            orderBy: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error(message)) })),
            doc: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error(message)) })),
        })),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// CREATE
// ==================================================================
describe('POST /api/routes - create route', () => {
    it('creates a valid route and returns 201', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

        const response = await createRoute(
            buildRequest('/api/routes', 'POST', validRoutePayload())
        );
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.message).toMatch(/created successfully/i);
    });

    it('stores the supplied route data', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

        const response = await createRoute(
            buildRequest('/api/routes', 'POST', validRoutePayload())
        );
        const json = await response.json();

        expect(json.route).toMatchObject({
            routeId: '177_KADUWELA_KOLLUPITIYA',
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            direction: 'OUTBOUND',
            startLocation: 'Kaduwela',
            endLocation: 'Kollupitiya',
            startStopId: 'kaduwela',
            endStopId: 'kollupitiya',
            status: 'ACTIVE',
        });
        expect(json.route.stops).toHaveLength(6);
        expect(json.route.stops[0]).toBe('Kaduwela');
        expect(json.route.stops[5]).toBe('Kollupitiya');
    });

    it('uses routeId as the Firestore document id', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

        await createRoute(buildRequest('/api/routes', 'POST', validRoutePayload()));

        // The created route is retrievable through the list endpoint under the
        // same id it was given.
        const listResponse = await getRoutes();
        const listJson = await listResponse.json();

        expect(listJson.routes).toHaveLength(1);
        expect(listJson.routes[0].documentId).toBe('177_KADUWELA_KOLLUPITIYA');
        expect(listJson.routes[0].routeId).toBe('177_KADUWELA_KOLLUPITIYA');
    });

    describe('required field validation', () => {
        const requiredFields = [
            'routeId',
            'routeNumber',
            'routeName',
            'direction',
            'startLocation',
            'endLocation',
            'startStopId',
            'endStopId',
            'stops',
            'status',
        ];

        it.each(requiredFields)('rejects a create request missing %s', async (field) => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const payload = validRoutePayload();
            delete (payload as any)[field];

            const response = await createRoute(buildRequest('/api/routes', 'POST', payload));
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(/required route fields are missing/i);
        });
    });

    describe('direction validation', () => {
        it('rejects an unsupported direction', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ direction: 'SIDEWAYS' }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/direction must be OUTBOUND or RETURN/i);
        });

        it.each(['OUTBOUND', 'RETURN'])('accepts direction %s', async (direction) => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ direction }))
            );
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.direction).toBe(direction);
        });
    });

    describe('stops validation', () => {
        it('rejects stops that are not an array', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ stops: 'Kaduwela' }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/at least two stops/i);
        });

        it('rejects a route with fewer than two stops', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ stops: ['Kaduwela'] }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/at least two stops/i);
        });

        it('rejects a stops array containing a non-string entry', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({
                        stops: ['Kaduwela', 42, 'Kollupitiya'],
                        startLocation: 'Kaduwela',
                        endLocation: 'Kollupitiya',
                    })
                )
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/every stop in the stops array must be a string/i);
        });

        it('accepts the minimum of two stops', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({
                        stops: ['Kaduwela', 'Kollupitiya'],
                    })
                )
            );

            expect(response.status).toBe(201);
        });
    });

    describe('endpoint / stop consistency', () => {
        it('rejects a start location that is not one of the stops', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ startLocation: 'Nugegoda' })
                )
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/start location must exist in the stops array/i);
        });

        it('rejects an end location that is not one of the stops', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ endLocation: 'Nugegoda' }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/end location must exist in the stops array/i);
        });
    });

    describe('distance validation', () => {
        it('rejects a non-numeric distance', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ distanceKm: 'twenty' }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/distance must be a valid positive number/i);
        });

        it('rejects a negative distance', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ distanceKm: -5 }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/distance must be a valid positive number/i);
        });

        it('stores an optional distance when supplied', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ distanceKm: 20 }))
            );
            const json = await response.json();

            expect(json.route.distanceKm).toBe(20);
        });

        it('stores null when no distance is supplied', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const payload = validRoutePayload();
            delete (payload as any).distanceKm;

            const response = await createRoute(buildRequest('/api/routes', 'POST', payload));
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.distanceKm).toBeNull();
        });
    });

    describe('estimated duration', () => {
        it('stores an optional estimated duration when supplied', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ estimatedDuration: '1 hr 9 min' })
                )
            );
            const json = await response.json();

            expect(json.route.estimatedDuration).toBe('1 hr 9 min');
        });

        it('stores null when no estimated duration is supplied', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const payload = validRoutePayload();
            delete (payload as any).estimatedDuration;

            const response = await createRoute(buildRequest('/api/routes', 'POST', payload));
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.estimatedDuration).toBeNull();
        });
    });

    // ------------------------------------------------------------------
    // Stop-to-stop timings (MOV-88)
    //
    // The route's `estimatedDuration` above describes the whole route, so it
    // cannot say how long a passenger boarding partway along travels for. These
    // timings can: one entry per gap between consecutive stops, entered against
    // real timings. What they must never do is admit a value that could be
    // mistaken for a measurement.
    // ------------------------------------------------------------------
    describe('stop-to-stop timings', () => {
        it('stores one timing per gap between the stops', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            // Six stops, so five gaps.
            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ segmentDurationsMinutes: [8, 6, 12, 15, 9] })
                )
            );
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.segmentDurationsMinutes).toEqual([8, 6, 12, 15, 9]);
        });

        it('accepts a partly timed route, with the untimed gaps left null', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ segmentDurationsMinutes: [8, null, 12, null, 9] })
                )
            );
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.segmentDurationsMinutes).toEqual([8, null, 12, null, 9]);
        });

        it('stores null when the route has not been timed', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const payload = validRoutePayload();
            delete (payload as any).segmentDurationsMinutes;

            const response = await createRoute(buildRequest('/api/routes', 'POST', payload));
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.segmentDurationsMinutes).toBeNull();
        });

        it('rejects a value that is not an array', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ segmentDurationsMinutes: '8,6,12' })
                )
            );

            expect(response.status).toBe(400);
        });

        it('rejects more timings than there are gaps between stops', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            // Six stops allow five timings; a sixth could only be read against a
            // pair of stops that does not exist.
            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ segmentDurationsMinutes: [8, 6, 12, 15, 9, 4] })
                )
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.success).toBe(false);
        });

        it('rejects a negative or non-numeric timing', async () => {
            // NaN is deliberately absent: JSON has no NaN, so it arrives as
            // null and is a legitimate "untimed" entry by the time the endpoint
            // sees it. A NaN already sitting in Firestore is caught on the way
            // out instead — see `normalizeSegmentDurations`.
            for (const bad of [[-5, 6], ['8', 6], [{}, 6], [true, 6]]) {
                mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

                const response = await createRoute(
                    buildRequest(
                        '/api/routes',
                        'POST',
                        validRoutePayload({ segmentDurationsMinutes: bad })
                    )
                );

                expect(response.status).toBe(400);
            }
        });

        it('accepts a zero, which is a measurement rather than a missing value', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({ segmentDurationsMinutes: [0, 6] })
                )
            );

            expect(response.status).toBe(201);
        });
    });

    describe('status validation', () => {
        it('rejects an unsupported status', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ status: 'ARCHIVED' }))
            );
            const json = await response.json();

            expect(response.status).toBe(400);
            expect(json.message).toMatch(/status must be ACTIVE or INACTIVE/i);
        });

        it.each(['ACTIVE', 'INACTIVE'])('accepts status %s', async (status) => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload({ status }))
            );
            const json = await response.json();

            expect(response.status).toBe(201);
            expect(json.route.status).toBe(status);
        });
    });

    describe('duplicate routeId', () => {
        it('rejects a routeId that already exists with 409', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [storedRoute()] }));

            const response = await createRoute(
                buildRequest('/api/routes', 'POST', validRoutePayload())
            );
            const json = await response.json();

            expect(response.status).toBe(409);
            expect(json.success).toBe(false);
            expect(json.message).toMatch(/already exists/i);
        });

        it('allows a different routeId, so both directions can coexist', async () => {
            mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [storedRoute()] }));

            const response = await createRoute(
                buildRequest(
                    '/api/routes',
                    'POST',
                    validRoutePayload({
                        routeId: '177_KOLLUPITIYA_KADUWELA',
                        routeName: 'Kollupitiya - Kaduwela',
                        direction: 'RETURN',
                        startLocation: 'Kollupitiya',
                        endLocation: 'Kaduwela',
                        startStopId: 'kollupitiya',
                        endStopId: 'kaduwela',
                        stops: [
                            'Kollupitiya',
                            'Borella',
                            'Rajagiriya',
                            'Battaramulla',
                            'Malabe',
                            'Kaduwela',
                        ],
                    })
                )
            );

            expect(response.status).toBe(201);
        });
    });

    it('returns 500 when Firestore fails during creation', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const response = await createRoute(
            buildRequest('/api/routes', 'POST', validRoutePayload())
        );
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/internal server error while creating route/i);
    });

    it('does not crash on a malformed request body', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

        const malformed = new Request('http://localhost/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"routeId":',
        });

        const response = await createRoute(malformed);
        const json = await response.json();

        // Handled by the catch-all, consistent with the other create endpoints.
        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
    });
});

// ==================================================================
// READ
// ==================================================================
describe('GET /api/routes - list routes', () => {
    it('returns all routes', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [
                    storedRoute(),
                    storedRoute({
                        id: '177_KOLLUPITIYA_KADUWELA',
                        routeId: '177_KOLLUPITIYA_KADUWELA',
                        direction: 'RETURN',
                    }),
                ],
            })
        );

        const response = await getRoutes();
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.message).toMatch(/retrieved successfully/i);
        expect(json.routes).toHaveLength(2);
    });

    it('returns the expected route fields', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [storedRoute()] }));

        const response = await getRoutes();
        const json = await response.json();
        const [route] = json.routes;

        expect(route).toMatchObject({
            routeId: '177_KADUWELA_KOLLUPITIYA',
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            direction: 'OUTBOUND',
            startLocation: 'Kaduwela',
            endLocation: 'Kollupitiya',
            status: 'ACTIVE',
        });
        expect(Array.isArray(route.stops)).toBe(true);
    });

    it('includes the documentId on each route', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [storedRoute()] }));

        const response = await getRoutes();
        const json = await response.json();

        expect(json.routes[0].documentId).toBe('177_KADUWELA_KOLLUPITIYA');
    });

    it('handles an empty routes collection', async () => {
        mockGetAdminDb.mockReturnValue(createFakeFirestore({ routes: [] }));

        const response = await getRoutes();
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.routes).toEqual([]);
    });

    it('returns 500 when Firestore fails', async () => {
        mockGetAdminDb.mockReturnValue(failingFirestore());

        const response = await getRoutes();
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/internal server error while retrieving routes/i);
    });
});