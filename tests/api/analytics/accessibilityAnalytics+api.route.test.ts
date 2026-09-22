// The accessibility analytics endpoint (MOV-169, for MOV-133).
//
// Three rules are what these tests exist for.
//
// 1. AUTHORISATION. The endpoint reports how accessible every vehicle in the
//    fleet is and which ones passengers complain about most. That is the
//    reviewer's view of the platform, and what keeps it one is the route
//    reading the role off the verified token — not which screen calls it.
//
// 2. THE SCORE IS MOV-79's. The regression block at the bottom is the reason
//    this file matters most: the same bus, the same facilities, the same
//    verified reports and the same passenger ratings are put through BOTH the
//    analytics endpoint and the existing booking API, and the two figures have
//    to be the same number. A facilities-only shortcut would pass every other
//    test in this file and fail that one, which is precisely what it is for.
//
// 3. NOTHING IS WRITTEN AND NOTHING IS CREATED. The analytics are derived per
//    request from collections other features own. No new collection, no stored
//    aggregate, and no write to any document.

import { GET as getAnalytics } from '../../../app/api/analytics/accessibility+api';
import { GET as getSeatAvailability } from '../../../app/api/booking/seats/[tripId]+api';
import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the signature check is stubbed, so the Authorization header parsing in
// authenticateRequest runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const ADMIN_SESSION = 'session-admin';
const PASSENGER_SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: {
        uid: 'UID-ADMIN',
        passengerId: 'ADM-2026-00001',
        role: 'ADMIN',
        email: 'admin@moreable.lk',
    },
    [PASSENGER_SESSION]: {
        uid: 'UID-P1',
        passengerId: 'PAS-2026-00001',
        role: 'PASSENGER',
        email: 'passenger@moreable.lk',
    },
};

/** Six of the eight facilities, so the facility factor is a distinctive 75. */
function facilities(overrides: Partial<BusAccessibilityFacilities> = {}): BusAccessibilityFacilities {
    return {
        wheelchairRamp: true,
        audioAnnouncement: true,
        lowFloorVehicle: true,
        walkingAssistance: false,
        wheelchairSpace: { available: true, count: 2 },
        guardianSeats: { available: false, count: 0 },
        prioritySeats: { available: true, count: 4 },
        elderlySeats: { available: true, count: 2 },
        ...overrides,
    };
}

function storedBus(busId: string, overrides: Record<string, any> = {}) {
    return {
        id: busId,
        busId,
        numberPlate: `NB-${busId.slice(-4)}`,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 32,
        accessibilityFacilities: facilities(),
        status: 'ACTIVE',
        ...overrides,
    };
}

function storedTrip(tripId: string, routeId: string, busId: string, overrides: Record<string, any> = {}) {
    return {
        id: tripId,
        tripId,
        routeId,
        busId,
        departureTime: '07:30',
        estimatedArrivalTime: '10:15',
        turnNumber: 1,
        status: 'ACTIVE',
        ...overrides,
    };
}

function storedRoute(routeId: string, routeNumber: string, overrides: Record<string, any> = {}) {
    return {
        id: routeId,
        routeId,
        routeNumber,
        routeName: `Colombo - Kandy (${routeNumber})`,
        startLocation: 'Colombo',
        endLocation: 'Kandy',
        stops: [],
        distanceKm: 115,
        estimatedDuration: '2h 45m',
        status: 'ACTIVE',
        ...overrides,
    };
}

/**
 * One stored report.
 *
 * The fake derives a document id from `id` before it reaches `busId`, so a
 * report has to be given one explicitly or every report about a bus would share
 * the bus's id — the same note the admin review tests carry.
 *
 * An ISSUE report is stored WITHOUT a `type` field, exactly as POST /api/reports
 * writes it, so nothing here can pass by reading a field the real records do
 * not have.
 */
function storedReport(
    reportId: string,
    busId: string | null,
    status: string,
    overrides: Record<string, any> = {}
) {
    return {
        id: reportId,
        reportId,
        passengerId: 'PAS-2026-00002',
        issueCategory: 'BROKEN_RAMP',
        description: 'The ramp would not fold down at Pettah.',
        status,
        ...(busId ? { busId, vehicle: { numberPlate: `NB-${busId.slice(-4)}` } } : {}),
        createdAt: new Date('2026-09-10T08:00:00.000Z'),
        updatedAt: new Date('2026-09-10T08:00:00.000Z'),
        ...overrides,
    };
}

function positiveReport(reportId: string, busId: string, status = 'VERIFIED') {
    return {
        id: reportId,
        reportId,
        passengerId: 'PAS-2026-00003',
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        description: 'The driver waited while I boarded.',
        status,
        busId,
        vehicle: { numberPlate: `NB-${busId.slice(-4)}` },
        createdAt: new Date('2026-09-11T08:00:00.000Z'),
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
    };
}

/** A rating complete enough for `readBusRating` to accept it. */
function storedRating(ratingId: string, busId: string, rating: number) {
    return {
        id: ratingId,
        ratingId,
        passengerId: `PAS-${ratingId}`,
        bookingId: `BKG-${ratingId}`,
        busId,
        tripId: 'TRIP-0001',
        journeyStartedAt: '2026-09-12T07:30:00.000Z',
        rating,
        createdAt: '2026-09-12T11:00:00.000Z',
    };
}

function storedHistory(busId: string, sequence: number, accessibilityScore: number, calculatedAt: string) {
    const historyId = `${busId}__${String(sequence).padStart(6, '0')}`;

    return {
        id: historyId,
        historyId,
        busId,
        sequence,
        accessibilityScore,
        facilityScore: accessibilityScore,
        communityScore: 50,
        ratingScore: 50,
        calculatedAt,
    };
}

function analyticsRequest(options: { token?: string; query?: string } = {}): Request {
    const headers: Record<string, string> = {};

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(`http://localhost/api/analytics/accessibility${options.query ?? ''}`, {
        method: 'GET',
        headers,
    });
}

function seatsRequest(tripId: string): Request {
    return new Request(`http://localhost/api/booking/seats/${tripId}`, { method: 'GET' });
}

/** The database the analytics read, wired up and handed to the routes. */
function seed(collections: Record<string, Record<string, any>[]> = {}) {
    const db = createFakeFirestore(collections);

    mockGetAdminDb.mockReturnValue(db);

    return db;
}

async function readJson(response: Response): Promise<any> {
    return response.json();
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation((token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// 1. Authorisation
// ==================================================================
describe('authorisation', () => {
    it('refuses an anonymous request with 401', async () => {
        seed();

        const response = await getAnalytics(analyticsRequest());
        const body = await readJson(response);

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
        // No analytics leak through the refusal.
        expect(body.averageScore).toBeUndefined();
    });

    it('refuses a request carrying a token it cannot verify with 401', async () => {
        seed();

        const response = await getAnalytics(analyticsRequest({ token: 'not-a-session' }));

        expect(response.status).toBe(401);
    });

    it('refuses a passenger session with 403 rather than 401', async () => {
        seed({ buses: [storedBus('BUS-00001')] });

        const response = await getAnalytics(analyticsRequest({ token: PASSENGER_SESSION }));
        const body = await readJson(response);

        // A real session that simply may not do this — not a logged-out one.
        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.averageScore).toBeUndefined();
    });

    it('answers an admin session with 200', async () => {
        seed({ buses: [storedBus('BUS-00001')] });

        const response = await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.message).toBe('Accessibility analytics generated successfully.');
    });

    it('never reads a collection for a caller it refused', async () => {
        const db = seed({ buses: [storedBus('BUS-00001')] });

        await getAnalytics(analyticsRequest({ token: PASSENGER_SESSION }));

        expect(db.collection).not.toHaveBeenCalled();
    });

    it('answers a preflight without a session', async () => {
        const { OPTIONS } = await import('../../../app/api/analytics/accessibility+api');

        const response = await OPTIONS();

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    });
});

// ==================================================================
// 2. The response
// ==================================================================
describe('the analytics response', () => {
    function platform() {
        return {
            buses: [
                storedBus('BUS-00001'),
                storedBus('BUS-00002', { accessibilityFacilities: facilities({ wheelchairRamp: false }) }),
                storedBus('BUS-00003', { status: 'MAINTENANCE' }),
            ],
            trips: [
                storedTrip('TRIP-0001', 'R-138-OUT', 'BUS-00001'),
                storedTrip('TRIP-0002', 'R-138-OUT', 'BUS-00001'),
                storedTrip('TRIP-0003', 'R-138-OUT', 'BUS-00002'),
                storedTrip('TRIP-0004', 'R-255-OUT', 'BUS-00001'),
                storedTrip('TRIP-0005', 'R-999-OUT', 'BUS-00003'),
            ],
            routes: [
                storedRoute('R-138-OUT', '138'),
                storedRoute('R-255-OUT', '255'),
                storedRoute('R-999-OUT', '999'),
            ],
            reports: [
                storedReport('REP-00001', 'BUS-00002', 'VERIFIED'),
                storedReport('REP-00002', 'BUS-00002', 'PENDING'),
                storedReport('REP-00003', 'BUS-00002', 'REJECTED'),
                storedReport('REP-00004', 'BUS-00001', 'PENDING'),
                storedReport('REP-00005', null, 'PENDING'),
                positiveReport('REP-00006', 'BUS-00001'),
            ],
            busRatings: [storedRating('RAT-1', 'BUS-00001', 5)],
            accessibilityScoreHistory: [
                storedHistory('BUS-00001', 1, 80, '2026-09-01T09:00:00.000Z'),
            ],
        };
    }

    it('answers with all four figures', async () => {
        seed(platform());

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        // Only the two ACTIVE buses are averaged; the one in maintenance is not.
        expect(body.success).toBe(true);
        expect(body.averageScore).toEqual({ value: 61, busesIncluded: 2 });
        expect(Array.isArray(body.mostAccessibleRoutes)).toBe(true);
        expect(Array.isArray(body.mostReportedVehicles)).toBe(true);
        expect(Array.isArray(body.trend)).toBe(true);
        expect(body.trendWeeks).toBe(12);
        // Derived now, never cached, so it is stamped with the moment it ran.
        expect(Number.isNaN(new Date(body.generatedAt).getTime())).toBe(false);
    });

    it('ranks the routes by the distinct ACTIVE buses that run them', async () => {
        seed(platform());

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        // R-255 is BUS-00001 alone; R-138 averages BUS-00001 and BUS-00002 —
        // and BUS-00001's two turns on it count once. R-999 is run only by a
        // bus in maintenance, so it cannot be ranked at all.
        expect(body.mostAccessibleRoutes.map((route: any) => route.routeId)).toEqual([
            'R-255-OUT',
            'R-138-OUT',
        ]);
        expect(body.mostAccessibleRoutes[1]).toEqual(
            expect.objectContaining({ routeNumber: '138', busCount: 2 })
        );
    });

    it('ranks the vehicles by issue reports, counting no positive feedback', async () => {
        seed(platform());

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        expect(body.mostReportedVehicles).toEqual([
            expect.objectContaining({
                busId: 'BUS-00002',
                numberPlate: 'NB-0002',
                reportCount: 3,
                verifiedReportCount: 1,
            }),
            expect.objectContaining({
                busId: 'BUS-00001',
                // Its positive feedback is not counted; only the one issue is.
                reportCount: 1,
                verifiedReportCount: 0,
            }),
        ]);
    });

    it('answers with twelve weekly buckets, oldest first', async () => {
        seed(platform());

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        expect(body.trend).toHaveLength(12);
        expect(body.trend[0]).toEqual(
            expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
        );
        // The last bucket is the current week, by which BUS-00001's recorded
        // score has been carried forward.
        expect(body.trend[11].averageScore).toBe(80);
    });

    it('narrows the trend when asked for fewer weeks', async () => {
        seed(platform());

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION, query: '?weeks=4' }))
        );

        expect(body.trend).toHaveLength(4);
        expect(body.trendWeeks).toBe(4);
    });

    it('refuses a trend window that is not a whole number of weeks in range', async () => {
        seed(platform());

        for (const query of ['?weeks=0', '?weeks=-1', '?weeks=1.5', '?weeks=99', '?weeks=many']) {
            const response = await getAnalytics(analyticsRequest({ token: ADMIN_SESSION, query }));

            expect(response.status).toBe(400);
        }
    });
});

// ==================================================================
// 3. An empty or half-written platform
// ==================================================================
describe('missing and malformed records', () => {
    it('answers an empty database with nulls rather than zeros', async () => {
        seed();

        const response = await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.averageScore).toEqual({ value: null, busesIncluded: 0 });
        expect(body.mostAccessibleRoutes).toEqual([]);
        expect(body.mostReportedVehicles).toEqual([]);
        expect(body.trend).toHaveLength(12);
        expect(body.trend.every((point: any) => point.averageScore === null)).toBe(true);
    });

    it('scores a bus with no facilities recorded rather than failing on it', async () => {
        seed({ buses: [storedBus('BUS-00001', { accessibilityFacilities: undefined })] });

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        // No facilities is 0 on that factor, and the two neutral priors carry
        // the rest: 0*0.5 + 50*0.3 + 50*0.2 = 25.
        expect(body.averageScore).toEqual({ value: 25, busesIncluded: 1 });
    });

    it('survives trips, reports and history naming records that are not there', async () => {
        seed({
            buses: [storedBus('BUS-00001')],
            trips: [storedTrip('TRIP-0001', 'R-GONE', 'BUS-GONE')],
            routes: [storedRoute('R-138-OUT', '138')],
            reports: [storedReport('REP-00001', 'BUS-GONE', 'VERIFIED')],
            busRatings: [{ id: 'RAT-BROKEN', busId: 'BUS-00001', rating: 'five' }],
            accessibilityScoreHistory: [
                { id: 'H1', busId: 'BUS-GONE', accessibilityScore: 90, calculatedAt: 'not-a-date' },
            ],
        });

        const response = await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.mostAccessibleRoutes).toEqual([]);
        // A report about a retired bus is still a report about that bus.
        expect(body.mostReportedVehicles).toEqual([
            expect.objectContaining({ busId: 'BUS-GONE', numberPlate: 'NB-GONE', reportCount: 1 }),
        ]);
        expect(body.trend.every((point: any) => point.averageScore === null)).toBe(true);
    });

    it('answers 500 rather than throwing when a read fails', async () => {
        mockGetAdminDb.mockReturnValue({
            collection: () => {
                throw new Error('Firestore unavailable');
            },
        });

        const response = await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));
        const body = await readJson(response);

        expect(response.status).toBe(500);
        expect(body.success).toBe(false);
    });
});

// ==================================================================
// 4. Read-only, and no new collection
// ==================================================================
describe('what the endpoint touches', () => {
    const EXPECTED_COLLECTIONS = [
        'buses',
        'trips',
        'routes',
        'reports',
        'busRatings',
        'accessibilityScoreHistory',
    ];

    it('reads exactly the six collections other features already own', async () => {
        const db = seed({ buses: [storedBus('BUS-00001')] });

        await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));

        const read = db.collection.mock.calls.map((call: unknown[]) => call[0]);

        expect([...read].sort()).toEqual([...EXPECTED_COLLECTIONS].sort());
        // One read per collection: no per-bus query, and no new collection.
        expect(read).toHaveLength(EXPECTED_COLLECTIONS.length);
    });

    it('writes nothing', async () => {
        const db = seed({
            buses: [storedBus('BUS-00001')],
            reports: [storedReport('REP-00001', 'BUS-00001', 'VERIFIED')],
        });

        await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));

        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(db.batch).not.toHaveBeenCalled();

        // The report is exactly as it was seeded.
        const stored = await db.collection('reports').doc('REP-00001').get();

        expect(stored.data()).toEqual(
            expect.objectContaining({ status: 'VERIFIED', reportId: 'REP-00001' })
        );
    });

    it('needs no composite index: every read is unfiltered and unordered', async () => {
        const db = seed({ buses: [storedBus('BUS-00001')] });

        await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }));

        // `collection(name)` returns a fresh query object per call, so the
        // where/orderBy spies live on the returned value. None is used: the
        // joins and the ordering are done in memory.
        for (const call of db.collection.mock.results) {
            expect(call.value.where).not.toHaveBeenCalled();
            expect(call.value.orderBy).not.toHaveBeenCalled();
        }
    });
});

// ==================================================================
// 5. REGRESSION — the analytics score IS the canonical score
//
// The point of the whole story. The analytics must not hold a second, simpler
// formula, and in particular must not score a bus from its facilities alone:
// that would leave community and ratings pinned at their neutral 50 and give
// the admin a different number from the one every passenger sees.
//
// So the same records are put through the analytics endpoint and through
// GET /api/booking/seats/:tripId — which computes the score the canonical way,
// through `loadAccessibilityScoreEvidence` and `computeAccessibilityScore` —
// and the two are compared. With one ACTIVE bus in the fleet, the analytics
// average IS that bus's score, so the two figures have to be identical.
// ==================================================================
describe('the analytics score matches the existing accessibility score', () => {
    /** One bus, evidence that moves every factor away from its neutral. */
    function scoredPlatform(extra: Record<string, Record<string, any>[]> = {}) {
        return {
            buses: [storedBus('BUS-00001')],
            trips: [storedTrip('TRIP-0001', 'R-138-OUT', 'BUS-00001')],
            routes: [storedRoute('R-138-OUT', '138')],
            bookings: [],
            ...extra,
        };
    }

    async function canonicalScore(): Promise<number> {
        const body = await readJson(await getSeatAvailability(seatsRequest('TRIP-0001'), {
            tripId: 'TRIP-0001',
        }));

        expect(body.success).toBe(true);

        return body.accessibilityScore;
    }

    async function analyticsAverage(): Promise<number | null> {
        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        expect(body.success).toBe(true);

        return body.averageScore.value;
    }

    it('agrees on a bus with facilities alone', async () => {
        seed(scoredPlatform());

        const canonical = await canonicalScore();

        expect(await analyticsAverage()).toBe(canonical);
    });

    it('agrees on a bus with verified community reports', async () => {
        seed(
            scoredPlatform({
                reports: [
                    positiveReport('REP-00001', 'BUS-00001'),
                    positiveReport('REP-00002', 'BUS-00001'),
                    positiveReport('REP-00003', 'BUS-00001'),
                    storedReport('REP-00004', 'BUS-00001', 'VERIFIED'),
                    // Neither of these counts towards the score — and the
                    // analytics must not count them either.
                    storedReport('REP-00005', 'BUS-00001', 'PENDING'),
                    storedReport('REP-00006', 'BUS-00001', 'REJECTED'),
                ],
            })
        );

        const canonical = await canonicalScore();
        const analytics = await analyticsAverage();

        expect(analytics).toBe(canonical);
        // The evidence really did move the score off the facilities-only value,
        // so the assertion above is not comparing two identical defaults.
        expect(analytics).not.toBe(63);
    });

    it('agrees on a bus with passenger ratings', async () => {
        seed(
            scoredPlatform({
                busRatings: [
                    storedRating('RAT-1', 'BUS-00001', 5),
                    storedRating('RAT-2', 'BUS-00001', 5),
                    storedRating('RAT-3', 'BUS-00001', 4),
                    // Not a rating of this bus, and not a usable rating.
                    storedRating('RAT-4', 'BUS-00002', 1),
                    { id: 'RAT-5', ratingId: 'RAT-5', busId: 'BUS-00001', rating: 9 },
                ],
            })
        );

        expect(await analyticsAverage()).toBe(await canonicalScore());
    });

    it('agrees on a bus with reports and ratings together', async () => {
        seed(
            scoredPlatform({
                reports: [
                    positiveReport('REP-00001', 'BUS-00001'),
                    positiveReport('REP-00002', 'BUS-00001'),
                    storedReport('REP-00003', 'BUS-00001', 'VERIFIED'),
                    storedReport('REP-00004', 'BUS-00001', 'PENDING'),
                ],
                busRatings: [
                    storedRating('RAT-1', 'BUS-00001', 4),
                    storedRating('RAT-2', 'BUS-00001', 5),
                ],
            })
        );

        const canonical = await canonicalScore();
        const analytics = await analyticsAverage();

        expect(analytics).toBe(canonical);
        expect(typeof analytics).toBe('number');
    });

    it('is not the facilities-only approximation', async () => {
        // 6 of 8 facilities with no evidence scores 75*0.5 + 50*0.3 + 50*0.2 = 63.
        // Strong verified evidence has to move it above that, and the analytics
        // has to move with it.
        seed(
            scoredPlatform({
                reports: Array.from({ length: 20 }, (_, index) =>
                    positiveReport(`REP-${index}`, 'BUS-00001')
                ),
                busRatings: Array.from({ length: 20 }, (_, index) =>
                    storedRating(`RAT-${index}`, 'BUS-00001', 5)
                ),
            })
        );

        const canonical = await canonicalScore();
        const analytics = await analyticsAverage();

        expect(canonical).toBeGreaterThan(63);
        expect(analytics).toBe(canonical);
    });

    it('averages two buses to the mean of their canonical scores', async () => {
        seed({
            buses: [
                storedBus('BUS-00001'),
                storedBus('BUS-00002', {
                    accessibilityFacilities: facilities({
                        wheelchairRamp: false,
                        audioAnnouncement: false,
                    }),
                }),
            ],
            trips: [
                storedTrip('TRIP-0001', 'R-138-OUT', 'BUS-00001'),
                storedTrip('TRIP-0002', 'R-138-OUT', 'BUS-00002'),
            ],
            routes: [storedRoute('R-138-OUT', '138')],
            bookings: [],
            reports: [
                positiveReport('REP-00001', 'BUS-00001'),
                storedReport('REP-00002', 'BUS-00002', 'VERIFIED'),
            ],
            busRatings: [storedRating('RAT-1', 'BUS-00001', 5)],
        });

        const first = await canonicalScore();
        const second = await readJson(
            await getSeatAvailability(seatsRequest('TRIP-0002'), { tripId: 'TRIP-0002' })
        ).then((body: any) => body.accessibilityScore);

        const body = await readJson(
            await getAnalytics(analyticsRequest({ token: ADMIN_SESSION }))
        );

        expect(first).not.toBe(second);
        expect(body.averageScore).toEqual({
            value: Math.round((first + second) / 2),
            busesIncluded: 2,
        });
        // The route those two buses share reports the same average.
        expect(body.mostAccessibleRoutes[0].averageScore).toBe(Math.round((first + second) / 2));
    });
});
