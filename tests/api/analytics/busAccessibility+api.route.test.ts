// One bus's accessibility, for the Analytics bus detail view
// (GET /api/analytics/buses/:busId).
//
// What these tests hold the route to:
//
// 1. ADMIN ONLY, exactly as the analytics list is.
// 2. THE SCORE IS MOV-79's. The same bus and evidence are put through this
//    route and through GET /api/booking/seats/:tripId, which scores the
//    canonical way, and the two must agree — as must the three factors, checked
//    against MOV-79's own factor functions.
// 3. ONLY VERIFIED REPORTS ARE EVIDENCE. Pending and rejected reports about the
//    bus are neither counted nor listed.
// 4. ONE BUS, THREE READS, NOTHING WRITTEN.

import { GET as getBusAccessibility, OPTIONS } from '../../../app/api/analytics/buses/[busId]+api';
import { GET as getSeatAvailability } from '../../../app/api/booking/seats/[tripId]+api';
import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import {
    COMMUNITY_WEIGHT,
    FACILITY_WEIGHT,
    RATING_WEIGHT,
    computeCommunityScore,
    computeFacilityScore,
    computeRatingScore,
} from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

const ADMIN_SESSION = 'session-admin';
const PASSENGER_SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: { uid: 'UID-ADMIN', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' },
    [PASSENGER_SESSION]: { uid: 'UID-P1', passengerId: 'PAS-2026-00001', role: 'PASSENGER', email: 'p@moreable.lk' },
};

/** Six of eight facilities: guardianSeats and walkingAssistance are off. */
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
        numberPlate: 'NC-6789',
        chassisNumber: 'CHS-1',
        busModel: 'Kinglong',
        manufacturer: 'Kinglong Motors',
        manufactureYear: 2024,
        seatCapacity: 40,
        accessibilityFacilities: facilities(),
        status: 'MAINTENANCE',
        password: 'Secret#123',
        ...overrides,
    };
}

function issueReport(reportId: string, busId: string, status: string, createdAt: string) {
    return {
        id: reportId,
        reportId,
        passengerId: 'PAS-2026-00002',
        issueCategory: 'BROKEN_RAMP',
        description: `Ramp broken (${reportId}).`,
        status,
        busId,
        vehicle: { numberPlate: 'NC-6789' },
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
        ...(status === 'VERIFIED'
            ? { reviewedAt: '2026-09-20T09:00:00.000Z', adminRemark: 'Confirmed on inspection.' }
            : {}),
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
        createdAt: new Date('2026-09-11T08:00:00.000Z'),
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
    };
}

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

function platform() {
    return {
        buses: [storedBus('BUS-00001'), storedBus('BUS-00002', { numberPlate: 'NB-0002' })],
        trips: [
            {
                id: 'TRIP-0001',
                tripId: 'TRIP-0001',
                routeId: 'R-138-OUT',
                busId: 'BUS-00001',
                departureTime: '07:30',
                estimatedArrivalTime: '10:15',
                turnNumber: 1,
                status: 'ACTIVE',
            },
        ],
        routes: [
            {
                id: 'R-138-OUT',
                routeId: 'R-138-OUT',
                routeNumber: '138',
                routeName: 'Colombo - Kandy',
                startLocation: 'Colombo',
                endLocation: 'Kandy',
                stops: [],
                status: 'ACTIVE',
            },
        ],
        bookings: [],
        reports: [
            issueReport('REP-00001', 'BUS-00001', 'VERIFIED', '2026-09-10T08:00:00.000Z'),
            issueReport('REP-00002', 'BUS-00001', 'VERIFIED', '2026-09-15T08:00:00.000Z'),
            issueReport('REP-00003', 'BUS-00001', 'PENDING', '2026-09-16T08:00:00.000Z'),
            issueReport('REP-00004', 'BUS-00001', 'REJECTED', '2026-09-17T08:00:00.000Z'),
            positiveReport('REP-00005', 'BUS-00001'),
            positiveReport('REP-00006', 'BUS-00001'),
            positiveReport('REP-00007', 'BUS-00001'),
            positiveReport('REP-00008', 'BUS-00001', 'PENDING'),
            // Another bus's evidence never reaches this one.
            issueReport('REP-00009', 'BUS-00002', 'VERIFIED', '2026-09-18T08:00:00.000Z'),
        ],
        busRatings: [
            storedRating('RAT-1', 'BUS-00001', 5),
            storedRating('RAT-2', 'BUS-00001', 4),
            storedRating('RAT-3', 'BUS-00001', 4),
            storedRating('RAT-4', 'BUS-00002', 1),
            // Not a usable rating.
            { id: 'RAT-5', ratingId: 'RAT-5', busId: 'BUS-00001', rating: 9 },
        ],
    };
}

function request(busId: string, token?: string): Request {
    return new Request(`http://localhost/api/analytics/buses/${encodeURIComponent(busId)}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
}

function seed(collections: Record<string, Record<string, any>[]> = {}) {
    const db = createFakeFirestore(collections);

    mockGetAdminDb.mockReturnValue(db);

    return db;
}

async function detail(busId = 'BUS-00001') {
    const response = await getBusAccessibility(request(busId, ADMIN_SESSION), { params: { busId } });

    return { response, body: await response.json() };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation((token: string) => SESSIONS[token] ?? null);
});

describe('authorisation', () => {
    it('refuses an anonymous request with 401 and reads nothing', async () => {
        const db = seed(platform());

        const response = await getBusAccessibility(request('BUS-00001'), { params: { busId: 'BUS-00001' } });

        expect(response.status).toBe(401);
        expect(db.collection).not.toHaveBeenCalled();
    });

    it('refuses a passenger with 403 and reads nothing', async () => {
        const db = seed(platform());

        const response = await getBusAccessibility(request('BUS-00001', PASSENGER_SESSION), {
            params: { busId: 'BUS-00001' },
        });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.bus).toBeUndefined();
        expect(db.collection).not.toHaveBeenCalled();
    });

    it('answers a preflight without a session', async () => {
        const response = await OPTIONS();

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    });
});

describe('the bus that is asked about', () => {
    it('answers 404 for a bus that is not in the fleet', async () => {
        seed(platform());

        const { response, body } = await detail('BUS-99999');

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
    });

    it('answers 400 for an id that cannot name a document', async () => {
        seed(platform());

        const { response } = await detail('BUS/00001');

        expect(response.status).toBe(400);
    });

    it('reads the id from the URL when the router passes no params', async () => {
        seed(platform());

        const response = await getBusAccessibility(request('BUS-00001', ADMIN_SESSION));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.bus.busId).toBe('BUS-00001');
    });
});

describe('the detail', () => {
    it('describes the bus, whatever its status, without its credential', async () => {
        seed(platform());

        const { response, body } = await detail();

        expect(response.status).toBe(200);
        expect(body.bus).toEqual(
            expect.objectContaining({
                busId: 'BUS-00001',
                numberPlate: 'NC-6789',
                busModel: 'Kinglong',
                manufacturer: 'Kinglong Motors',
                status: 'MAINTENANCE',
                manufactureYear: 2024,
                seatCapacity: 40,
            })
        );
        expect(JSON.stringify(body)).not.toContain('Secret#123');
    });

    it('breaks the score into MOV-79\'s three factors with their weights', async () => {
        seed(platform());

        const { body } = await detail();
        const community = { positiveCount: 3, issueCount: 2 };
        const ratings = { count: 3, total: 13 };

        expect(body.bus.factors).toEqual([
            {
                key: 'FACILITIES',
                score: computeFacilityScore(facilities()),
                weight: FACILITY_WEIGHT,
                contribution: computeFacilityScore(facilities()) * FACILITY_WEIGHT,
            },
            {
                key: 'COMMUNITY',
                score: computeCommunityScore(community),
                weight: COMMUNITY_WEIGHT,
                contribution: computeCommunityScore(community) * COMMUNITY_WEIGHT,
            },
            {
                key: 'RATINGS',
                score: computeRatingScore(ratings),
                weight: RATING_WEIGHT,
                contribution: computeRatingScore(ratings) * RATING_WEIGHT,
            },
        ]);
        expect(body.bus.factors.map((factor: any) => factor.weight)).toEqual([0.5, 0.3, 0.2]);
    });

    it('lists all eight facilities, available only when exactly true', async () => {
        seed({
            ...platform(),
            buses: [
                storedBus('BUS-00001', {
                    accessibilityFacilities: {
                        ...facilities(),
                        // Truthy, but not `true`: not available.
                        audioAnnouncement: 'true',
                        lowFloorVehicle: 1,
                    },
                }),
            ],
        });

        const { body } = await detail();

        expect(body.bus.facilities).toEqual([
            { key: 'wheelchairRamp', available: true, count: null },
            { key: 'audioAnnouncement', available: false, count: null },
            { key: 'lowFloorVehicle', available: false, count: null },
            { key: 'walkingAssistance', available: false, count: null },
            { key: 'wheelchairSpace', available: true, count: 2 },
            { key: 'guardianSeats', available: false, count: 0 },
            { key: 'prioritySeats', available: true, count: 4 },
            { key: 'elderlySeats', available: true, count: 2 },
        ]);
        expect(body.bus.availableFacilityCount).toBe(4);
    });

    it('counts and lists only VERIFIED reports about this bus, newest first', async () => {
        seed(platform());

        const { body } = await detail();

        expect(body.bus.community).toEqual({ issueCount: 2, positiveCount: 3 });
        expect(body.bus.verifiedIssues.map((report: any) => report.reportId)).toEqual(['REP-00002', 'REP-00001']);
        expect(body.bus.verifiedPositiveFeedback.map((report: any) => report.reportId)).toEqual([
            'REP-00005',
            'REP-00006',
            'REP-00007',
        ]);
        expect(body.bus.verifiedIssues[0]).toEqual({
            reportId: 'REP-00002',
            type: 'ISSUE',
            category: 'BROKEN_RAMP',
            description: 'Ramp broken (REP-00002).',
            createdAt: '2026-09-15T08:00:00.000Z',
            reviewedAt: '2026-09-20T09:00:00.000Z',
            adminRemark: 'Confirmed on inspection.',
        });
        expect(body.bus.verifiedPositiveFeedback[0]).toEqual(
            expect.objectContaining({ type: 'POSITIVE', category: 'HELPFUL_DRIVER' })
        );
    });

    it('states the plain average rating apart from the rating factor, with a distribution', async () => {
        seed(platform());

        const { body } = await detail();

        expect(body.bus.ratings).toEqual({ count: 3, average: 13 / 3 });
        expect(body.bus.ratingDistribution).toEqual([
            { stars: 5, count: 1 },
            { stars: 4, count: 2 },
            { stars: 3, count: 0 },
            { stars: 2, count: 0 },
            { stars: 1, count: 0 },
        ]);
    });

    it('answers a bus with no evidence at the neutral priors', async () => {
        seed({ buses: [storedBus('BUS-00001')] });

        const { body } = await detail();

        expect(body.bus.community).toEqual({ issueCount: 0, positiveCount: 0 });
        expect(body.bus.ratings).toEqual({ count: 0, average: null });
        expect(body.bus.factors[1].score).toBe(50);
        expect(body.bus.factors[2].score).toBe(50);
        expect(body.bus.verifiedIssues).toEqual([]);
        // 75 * 0.5 + 50 * 0.3 + 50 * 0.2
        expect(body.bus.accessibilityScore).toBe(63);
    });
});

describe('the score matches the existing accessibility score', () => {
    it('is the number the booking API reports for the same bus', async () => {
        // The booking API only scores a bus in service, so this one is ACTIVE.
        const records = platform();

        records.buses[0] = storedBus('BUS-00001', { status: 'ACTIVE' });
        seed(records);

        const seats = await getSeatAvailability(
            new Request('http://localhost/api/booking/seats/TRIP-0001', { method: 'GET' }),
            { tripId: 'TRIP-0001' }
        );
        const canonical = (await seats.json()).accessibilityScore;
        const { body } = await detail();

        expect(typeof canonical).toBe('number');
        expect(body.bus.accessibilityScore).toBe(canonical);
        // The evidence really moved it off the facilities-only 63.
        expect(canonical).not.toBe(63);
    });

    it('is the number the analytics list reports for the same bus', async () => {
        seed(platform());

        const { GET: getAnalytics } = await import('../../../app/api/analytics/accessibility+api');
        const list = await (
            await getAnalytics(
                new Request('http://localhost/api/analytics/accessibility', {
                    headers: { Authorization: `Bearer ${ADMIN_SESSION}` },
                })
            )
        ).json();
        const { body } = await detail();

        const listed = list.buses.find((bus: any) => bus.busId === 'BUS-00001');

        expect(listed.accessibilityScore).toBe(body.bus.accessibilityScore);
        expect(listed.factors).toEqual(body.bus.factors);
        expect(listed.community).toEqual(body.bus.community);
        expect(listed.ratings).toEqual(body.bus.ratings);
    });
});

describe('what the route touches', () => {
    it('makes three reads for one bus: the bus, its reports and its ratings', async () => {
        const db = seed(platform());

        await detail();

        const read = db.collection.mock.calls.map((call: unknown[]) => call[0]);

        expect([...read].sort()).toEqual(['busRatings', 'buses', 'reports']);
    });

    it('writes nothing', async () => {
        const db = seed(platform());

        await detail();

        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(db.batch).not.toHaveBeenCalled();
    });

    it('answers 500 rather than throwing when a read fails', async () => {
        mockGetAdminDb.mockReturnValue({
            collection: () => {
                throw new Error('Firestore unavailable');
            },
        });

        const { response, body } = await detail();

        expect(response.status).toBe(500);
        expect(body.success).toBe(false);
    });
});
