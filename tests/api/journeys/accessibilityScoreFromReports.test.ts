// Verified reports update the accessibility score (MOV-129).
//
// The story MOV-79 and MOV-113 leave to be proven: that a report filed by a
// passenger and VERIFIED by an admin actually changes the number the next
// passenger is shown. The two existing suites each prove half of it —
// accessibilityScore.test.ts that the arithmetic is right, and
// accessibilityScoreHistory.test.ts that a verification records a snapshot —
// and neither follows a report all the way to a passenger.
//
// So everything here goes through the real routes, in the order a person would
// reach them:
//
//     POST /api/reports              a passenger files it            (PENDING)
//     POST /api/reports/:id/review   an admin decides it   VERIFY / REJECT
//     POST /api/journeys/search      the next passenger reads the score
//
// Nothing below calls computeAccessibilityScore or recordAccessibilityScore to
// obtain a score under test. The expected values are written out as the
// literals the formula produces, worked out in the comments, so that a change
// to the formula fails these tests instead of being echoed by them.
//
// Every bus here has 6 of the 8 facilities, so the facility factor is a
// constant 75 and the arithmetic stays legible:
//
//     no evidence          75*0.5 + 50.000*0.3 + 50*0.2 = 62.5    -> 63
//     1 verified ISSUE     75*0.5 + 41.667*0.3 + 50*0.2 = 60.0    -> 60
//     1 verified POSITIVE  75*0.5 + 58.333*0.3 + 50*0.2 = 65.0    -> 65
//     2 ISSUE + 1 POSITIVE 75*0.5 + 43.750*0.3 + 50*0.2 = 60.625  -> 61
//
// No credential appears here: sessions are plain test strings and no bus record
// carries a password.

import { DELETE as deleteBus } from '../../../app/api/buses/[busId]+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { POST as createReport } from '../../../app/api/reports/index+api';
import { POST as reviewReport } from '../../../app/api/reports/[reportId]/review+api';
import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import {
    ACCESSIBILITY_SCORE_HISTORY_COLLECTION,
    ACCESSIBILITY_SCORE_LATEST_COLLECTION,
} from '../../../src/shared/server/accessibilityScoreHistory';
import { computeCommunityScore } from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const ADMIN_SESSION = 'session-admin';
const PASSENGER_SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: { uid: 'UID-ADMIN', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' },
    [PASSENGER_SESSION]: { uid: 'UID-P1', passengerId: 'PAS-2026-00001', role: 'PASSENGER', email: 'p1@moreable.lk' },
};

const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';

const route = {
    id: ROUTE_ID,
    routeId: ROUTE_ID,
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

/** Six of the eight facilities: no walking assistance, no guardian seats. */
const SIX_OF_EIGHT: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: true,
    walkingAssistance: false,
    wheelchairSpace: { available: true, count: 2 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: true, count: 4 },
};

/** The score of a 6/8 bus nobody has reported on or rated: 37.5 + 15 + 10. */
const NO_EVIDENCE_SCORE = 63;

function bus(busId: string) {
    return {
        id: busId,
        busId,
        numberPlate: `NB-${busId}`,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: SIX_OF_EIGHT,
        status: 'ACTIVE',
    };
}

function trip(tripId: string, busId: string, departureTime: string) {
    return {
        id: tripId,
        tripId,
        routeId: ROUTE_ID,
        busId,
        departureTime,
        estimatedArrivalTime: '10:10',
        turnNumber: 1,
        status: 'ACTIVE',
    };
}

/** One bus on one route, with nothing said about it yet. */
function seed(extra: Record<string, any[]> = {}) {
    return createFakeFirestore({
        routes: [route],
        buses: [bus('BUS-ONE')],
        trips: [trip('TRIP-ONE', 'BUS-ONE', '09:00')],
        ...extra,
    });
}

type FakeDb = ReturnType<typeof createFakeFirestore>;

function jsonRequest(url: string, method: string, body?: unknown, session?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = `Bearer ${session}`;
    return new Request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

// ------------------------------------------------------------------
// The real flow, one step per helper
// ------------------------------------------------------------------

/**
 * What POST /api/journeys/search tells a passenger about one departure.
 *
 * The whole point of the suite is that this number is never stored and never
 * cached: it is recalculated from the evidence on every request, which is why
 * verifying a report is enough to change it.
 */
async function searchScore(db: FakeDb, tripId: string): Promise<number> {
    mockGetAdminDb.mockReturnValue(db);

    const response = await searchJourneys(
        jsonRequest('http://localhost/api/journeys/search', 'POST', {
            origin: 'Kaduwela',
            destination: 'Borella',
            travelDate: '2026-09-22',
            travelTime: '08:00',
        })
    );

    expect(response.status).toBe(200);

    const json = await response.json();
    const option = json.routes[0].trips.find((entry: any) => entry.trip.tripId === tripId);

    return option.bus.accessibilityScore;
}

/** A passenger files a report. It is stored PENDING, whatever the body says. */
async function fileReport(db: FakeDb, body: Record<string, unknown>): Promise<string> {
    mockGetAdminDb.mockReturnValue(db);

    const response = await createReport(
        jsonRequest('http://localhost/api/reports', 'POST', body, PASSENGER_SESSION)
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.report.status).toBe('PENDING');

    return json.report.reportId;
}

/** The issue report the story is about: a ramp that could not be lowered. */
const issueReport = (busId?: string) => ({
    issueCategory: 'BROKEN_RAMP',
    description: 'The ramp at the rear door could not be lowered.',
    ...(busId ? { busId } : {}),
});

/** Its counterpart: a passenger saying what went right. */
const positiveReport = (busId?: string) => ({
    type: 'POSITIVE',
    category: 'HELPFUL_DRIVER',
    description: 'The driver waited and helped me board.',
    ...(busId ? { busId } : {}),
});

/** An admin decides a report through the real review route. */
async function review(db: FakeDb, reportId: string, action: string): Promise<Response> {
    mockGetAdminDb.mockReturnValue(db);

    return reviewReport(
        jsonRequest(`http://localhost/api/reports/${reportId}/review`, 'POST', { action }, ADMIN_SESSION),
        { reportId }
    );
}

async function verify(db: FakeDb, reportId: string): Promise<Response> {
    const response = await review(db, reportId, 'VERIFY');
    expect(response.status).toBe(200);
    return response;
}

async function storedReport(db: FakeDb, reportId: string) {
    return (await db.collection('reports').doc(reportId).get()).data();
}

async function historyOf(db: FakeDb, busId?: string) {
    const snap = await db.collection(ACCESSIBILITY_SCORE_HISTORY_COLLECTION).get();
    return snap.docs
        .map((doc) => doc.data())
        .filter((entry) => busId === undefined || entry.busId === busId)
        .sort((a, b) => a.sequence - b.sequence);
}

async function latestOf(db: FakeDb, busId: string) {
    const snap = await db.collection(ACCESSIBILITY_SCORE_LATEST_COLLECTION).doc(busId).get();
    return snap.exists ? snap.data() : null;
}

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (geocodeLocation as jest.Mock).mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    (getRouteBetweenCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    (getRouteThroughCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
});

afterEach(() => {
    // The score history is written best-effort: a failure is logged rather than
    // thrown, so "no entry was recorded" would also pass if the recording had
    // broken. No test here expects that, so a logged failure is a failure.
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Accessibility Score History Error:', expect.anything());
    consoleErrorSpy.mockRestore();
});

// ==================================================================
// The story: a verified report changes what the next passenger sees
// ==================================================================
describe('a report a passenger files and an admin verifies', () => {
    it('lowers the score the journey search reports for that bus', async () => {
        const db = seed();

        // 1. Before anybody has said anything: facilities and the neutral prior.
        expect(await searchScore(db, 'TRIP-ONE')).toBe(NO_EVIDENCE_SCORE);

        // 2. A passenger files an issue report. It is PENDING, and PENDING is
        //    not evidence — the score a passenger is shown must not move
        //    because somebody made an allegation.
        const reportId = await fileReport(db, issueReport('BUS-ONE'));

        expect(await searchScore(db, 'TRIP-ONE')).toBe(NO_EVIDENCE_SCORE);

        // 3. An admin verifies it through the real review route.
        await verify(db, reportId);

        expect((await storedReport(db, reportId))?.status).toBe('VERIFIED');

        // 4. The same search, asked again, now reports the lower score:
        //    75*0.5 + ((1/6)*0 + (5/6)*50)*0.3 + 50*0.2 = 37.5 + 12.5 + 10.
        expect(await searchScore(db, 'TRIP-ONE')).toBe(60);
    });

    it('raises it for verified positive feedback, filed the same way', async () => {
        const db = seed();

        expect(await searchScore(db, 'TRIP-ONE')).toBe(NO_EVIDENCE_SCORE);

        // The same collection and the same review route — positive feedback is
        // a kind of report, not a separate system (MOV-301).
        const reportId = await fileReport(db, positiveReport('BUS-ONE'));

        await verify(db, reportId);

        expect((await storedReport(db, reportId))?.type).toBe('POSITIVE');

        // 75*0.5 + ((1/6)*100 + (5/6)*50)*0.3 + 50*0.2 = 37.5 + 17.5 + 10.
        expect(await searchScore(db, 'TRIP-ONE')).toBe(65);
    });

    it('weighs several verified reports together, not one at a time', async () => {
        const db = seed();

        const first = await fileReport(db, issueReport('BUS-ONE'));
        const second = await fileReport(db, issueReport('BUS-ONE'));
        const third = await fileReport(db, positiveReport('BUS-ONE'));

        await verify(db, first);
        await verify(db, second);
        await verify(db, third);

        // n = 3, one of them positive:
        // 75*0.5 + ((3/8)*33.333 + (5/8)*50)*0.3 + 50*0.2 = 37.5 + 13.125 + 10.
        expect(await searchScore(db, 'TRIP-ONE')).toBe(61);

        // Each verification changed the community component, so each was
        // recorded — three entries, in order, none skipped and none repeated.
        const history = await historyOf(db, 'BUS-ONE');

        expect(history.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
        expect(history.map((entry) => entry.communityScore)).toEqual([
            computeCommunityScore({ positiveCount: 0, issueCount: 1 }),
            computeCommunityScore({ positiveCount: 0, issueCount: 2 }),
            computeCommunityScore({ positiveCount: 1, issueCount: 2 }),
        ]);
    });
});

// ==================================================================
// Invalid reports are ignored
// ==================================================================
describe('a report that is not verified evidence', () => {
    it('leaves the score alone while it is still PENDING', async () => {
        const db = seed();

        await fileReport(db, issueReport('BUS-ONE'));
        await fileReport(db, issueReport('BUS-ONE'));

        expect(await searchScore(db, 'TRIP-ONE')).toBe(NO_EVIDENCE_SCORE);
        expect(await historyOf(db)).toHaveLength(0);
    });

    it('leaves the score alone once it is REJECTED', async () => {
        const db = seed();

        const reportId = await fileReport(db, issueReport('BUS-ONE'));
        const response = await review(db, reportId, 'REJECT');

        expect(response.status).toBe(200);
        expect((await storedReport(db, reportId))?.status).toBe('REJECTED');

        expect(await searchScore(db, 'TRIP-ONE')).toBe(NO_EVIDENCE_SCORE);

        // A rejection cannot change a score, so it must not cost a snapshot.
        expect(await historyOf(db)).toHaveLength(0);
    });

    it('changes no bus at all when the report names none', async () => {
        const db = seed();

        // A passenger may report an inaccessible bus stop without naming a bus.
        const reportId = await fileReport(db, issueReport());

        expect((await storedReport(db, reportId))?.busId).toBeUndefined();

        await verify(db, reportId);

        expect(await searchScore(db, 'TRIP-ONE')).toBe(NO_EVIDENCE_SCORE);
        expect(await historyOf(db)).toHaveLength(0);
    });

    it('is verified safely when the bus it named has since been deleted', async () => {
        const db = seed();

        const reportId = await fileReport(db, issueReport('BUS-ONE'));

        mockGetAdminDb.mockReturnValue(db);
        const removal = await deleteBus(
            jsonRequest('http://localhost/api/buses/BUS-ONE', 'DELETE', undefined, ADMIN_SESSION),
            { params: { busId: 'BUS-ONE' } }
        );

        expect(removal.status).toBe(200);

        // The decision is still recorded — the report is a record of what a
        // passenger experienced, and the bus going away does not unmake it.
        await verify(db, reportId);

        expect((await storedReport(db, reportId))?.status).toBe('VERIFIED');

        // There is no bus to score, so nothing is stored and nothing throws.
        // The afterEach guard is what proves the second half of that.
        expect(await historyOf(db)).toHaveLength(0);
        expect(await latestOf(db, 'BUS-ONE')).toBeNull();
    });
});

// ==================================================================
// One bus's evidence is its own
// ==================================================================
describe('two buses on the same route', () => {
    const twoBuses = () =>
        seed({
            buses: [bus('BUS-A'), bus('BUS-B')],
            trips: [trip('TRIP-A', 'BUS-A', '09:00'), trip('TRIP-B', 'BUS-B', '09:30')],
        });

    it('scores each from its own reports only', async () => {
        const db = twoBuses();

        expect(await searchScore(db, 'TRIP-A')).toBe(NO_EVIDENCE_SCORE);
        expect(await searchScore(db, 'TRIP-B')).toBe(NO_EVIDENCE_SCORE);

        const reportId = await fileReport(db, issueReport('BUS-A'));
        await verify(db, reportId);

        expect(await searchScore(db, 'TRIP-A')).toBe(60);
        // The report was about the other vehicle. This one is untouched.
        expect(await searchScore(db, 'TRIP-B')).toBe(NO_EVIDENCE_SCORE);
    });

    it('records a snapshot for the bus that was reported on and no other', async () => {
        const db = twoBuses();

        const reportId = await fileReport(db, issueReport('BUS-A'));
        await verify(db, reportId);

        expect(await historyOf(db, 'BUS-A')).toHaveLength(1);
        expect(await historyOf(db, 'BUS-B')).toHaveLength(0);
        expect(await latestOf(db, 'BUS-B')).toBeNull();
    });
});

// ==================================================================
// A decision is made once
// ==================================================================
describe('verifying a report that has already been verified', () => {
    it('is refused, and changes neither the score nor the history', async () => {
        const db = seed();

        const reportId = await fileReport(db, issueReport('BUS-ONE'));
        await verify(db, reportId);

        expect(await searchScore(db, 'TRIP-ONE')).toBe(60);
        expect(await historyOf(db, 'BUS-ONE')).toHaveLength(1);

        const again = await review(db, reportId, 'VERIFY');

        expect(again.status).toBe(409);
        expect((await again.json()).message).toContain('already been reviewed');

        // The second attempt counted the report a second time nowhere: the
        // score is what one verified issue report produces, not two.
        expect(await searchScore(db, 'TRIP-ONE')).toBe(60);
        expect(await historyOf(db, 'BUS-ONE')).toHaveLength(1);
    });

    it('stores one entry per verification when two reports are decided in turn', async () => {
        // Sequencing, which is what a concurrent pair would contend for. True
        // contention cannot be reproduced on the shared fake: its runTransaction
        // runs its callback once and never collides, so a race would prove the
        // fake's behaviour rather than Firestore's, whose retry is the actual
        // guarantee. What is proven here is the part this project owns — that
        // each verification takes the next sequence and never reuses one.
        const db = seed();

        const first = await fileReport(db, issueReport('BUS-ONE'));
        const second = await fileReport(db, issueReport('BUS-ONE'));

        await verify(db, first);
        await verify(db, second);

        const history = await historyOf(db, 'BUS-ONE');
        const sequences = history.map((entry) => entry.sequence);

        expect(sequences).toEqual([1, 2]);
        expect(new Set(history.map((entry) => entry.historyId)).size).toBe(2);
        expect(await latestOf(db, 'BUS-ONE')).toMatchObject({ lastSequence: 2, busId: 'BUS-ONE' });
    });
});
