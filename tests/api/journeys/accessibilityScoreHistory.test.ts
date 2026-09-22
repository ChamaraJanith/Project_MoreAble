// Accessibility score history (MOV-113).
//
// Drives recordAccessibilityScore over the shared in-memory Firestore, then the
// real routes whose writes can change a bus's score — bus create/update, report
// verification and deletion, and passenger ratings — and the read-only routes
// that must never write history just because they showed a score.
//
// The fake's runTransaction runs its callback once and never collides, so two
// transactions racing for the same sequence cannot be simulated here: that
// guarantee is Firestore's own retry. What is tested is the sequential case —
// a repeated call stores nothing new — and that every read of the recording
// goes through the transaction.
//
// No credential appears here: sessions are plain test strings, and the one bus
// password POST /api/buses requires is built at run time.

import * as fs from 'fs';
import * as path from 'path';
import { GET as getBookingOptions } from '../../../app/api/booking/options+api';
import { GET as getBookingSeats } from '../../../app/api/booking/seats/[tripId]+api';
import { PUT as updateBus } from '../../../app/api/buses/[busId]+api';
import { POST as createBus } from '../../../app/api/buses/index+api';
import { POST as submitRating } from '../../../app/api/journeys/completed/rating+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { DELETE as deleteReport, PUT as editReport } from '../../../app/api/reports/[reportId]+api';
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
    accessibilityScoreHistoryId,
    recordAccessibilityScore,
} from '../../../src/shared/server/accessibilityScoreHistory';
import { busRatingDocumentId } from '../../../src/shared/server/busRating';
import {
    computeAccessibilityScore,
    computeCommunityScore,
    computeRatingScore,
} from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { buildTestPassword } from '../../testUtils/testPassword';

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
const PASSENGER = 'PAS-2026-00001';
const ADMIN_SESSION = 'session-admin';
const PASSENGER_SESSION = 'session-passenger';

const SESSIONS: Record<string, Record<string, string>> = {
    [ADMIN_SESSION]: { uid: 'UID-ADMIN', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' },
    [PASSENGER_SESSION]: { uid: 'UID-P1', passengerId: PASSENGER, role: 'PASSENGER', email: 'p1@moreable.lk' },
};

const NOW = new Date('2026-09-22T10:30:00.000Z');
const LATER = new Date('2026-09-23T07:15:00.000Z');
const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';

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

/** SIX_OF_EIGHT with the ramp taken away: five of eight. */
const FIVE_OF_EIGHT: BusAccessibilityFacilities = { ...SIX_OF_EIGHT, wheelchairRamp: false };

function bus(busId: string, facilities: BusAccessibilityFacilities = SIX_OF_EIGHT) {
    return {
        id: busId,
        busId,
        numberPlate: `NB-${busId}`,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: facilities,
        status: 'ACTIVE',
    };
}

let reportSeq = 0;
/** A report as POST /api/reports stores it: POSITIVE carries `type`, an ISSUE does not. */
function report(busId: string | undefined, status: string, positive: boolean, extra: Record<string, unknown> = {}) {
    reportSeq += 1;
    const reportId = `REP-H${reportSeq}`;
    return {
        id: reportId,
        reportId,
        passengerId: PASSENGER,
        ...(positive ? { type: 'POSITIVE', category: 'HELPFUL_DRIVER' } : { issueCategory: 'BROKEN_RAMP' }),
        description: 'The ramp at the rear door could not be lowered.',
        status,
        ...(busId ? { busId, vehicle: { numberPlate: `NB-${busId}` } } : {}),
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        ...extra,
    };
}

let ratingSeq = 0;
/** A rating as submitBusRating stores it. */
function rating(busId: string, stars: number) {
    ratingSeq += 1;
    const passengerId = `PAS-R${ratingSeq}`;
    const tripId = `TRIP-RUN-${ratingSeq}`;
    const journeyStartedAt = '2026-09-01T08:00:00.000Z';
    const ratingId = busRatingDocumentId(passengerId, tripId, journeyStartedAt);
    return { id: ratingId, ratingId, passengerId, bookingId: `BK-R${ratingSeq}`, busId, tripId, journeyStartedAt, rating: stars, createdAt: '2026-09-01T09:00:00.000Z' };
}

const repeat = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);

/**
 * BUS-RATED: the MOV-111 worked example — 6/8 facilities, 8 verified positive +
 * 2 verified issue, 20 ratings averaging 4.2 — plus evidence that must not count.
 * BUS-PLAIN: the same facilities and no evidence at all.
 */
function workedExampleEvidence() {
    return {
        reports: [
            ...repeat(8, () => report('BUS-RATED', 'VERIFIED', true)),
            ...repeat(2, () => report('BUS-RATED', 'VERIFIED', false)),
            ...repeat(3, () => report('BUS-RATED', 'PENDING', false)),
            ...repeat(3, () => report('BUS-RATED', 'REJECTED', false)),
            ...repeat(4, () => report('BUS-ELSEWHERE', 'VERIFIED', false)),
        ],
        busRatings: [
            // 4 * 5 + 16 * 4 = 84 over 20 ratings: an average of 4.2.
            ...repeat(4, () => rating('BUS-RATED', 5)),
            ...repeat(16, () => rating('BUS-RATED', 4)),
            ...repeat(6, () => rating('BUS-ELSEWHERE', 1)),
        ],
    };
}

function seed(extra: Record<string, any[]> = {}) {
    return createFakeFirestore({
        buses: [bus('BUS-RATED'), bus('BUS-PLAIN'), bus('BUS-ELSEWHERE', FIVE_OF_EIGHT)],
        ...workedExampleEvidence(),
        ...extra,
    });
}

type FakeDb = ReturnType<typeof createFakeFirestore>;

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

async function allLatest(db: FakeDb) {
    return (await db.collection(ACCESSIBILITY_SCORE_LATEST_COLLECTION).get()).docs;
}

/** The four stored score values, without the fake's own `id` key. */
function scoreValues(entry: any) {
    return {
        accessibilityScore: entry.accessibilityScore,
        facilityScore: entry.facilityScore,
        communityScore: entry.communityScore,
        ratingScore: entry.ratingScore,
    };
}

function jsonRequest(url: string, method: string, body?: unknown, session?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = `Bearer ${session}`;
    return new Request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

let consoleErrorSpy: jest.SpyInstance;
/** Set only by the tests that break the history on purpose. */
let historyFailureExpected = false;

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    historyFailureExpected = false;
});

afterEach(() => {
    // A best-effort failure is logged, not thrown, so "nothing was recorded"
    // would also pass if the recording had failed. Every other test proves it
    // did not.
    if (!historyFailureExpected) {
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('Accessibility Score History Error:', expect.anything());
    }
    consoleErrorSpy.mockRestore();
});

// ==================================================================
// recordAccessibilityScore
// ==================================================================
describe('recording a score', () => {
    it('stores the first entry as {busId}__000001 and the latest document beside it', async () => {
        const db = seed();

        const result = await recordAccessibilityScore(db, 'BUS-RATED', NOW);

        expect(result.kind).toBe('RECORDED');
        expect(accessibilityScoreHistoryId('BUS-RATED', 1)).toBe('BUS-RATED__000001');

        const [entry] = await historyOf(db, 'BUS-RATED');
        expect(entry.id).toBe('BUS-RATED__000001');
        expect(entry).toMatchObject({
            historyId: 'BUS-RATED__000001',
            busId: 'BUS-RATED',
            sequence: 1,
            calculatedAt: '2026-09-22T10:30:00.000Z',
        });

        expect(await latestOf(db, 'BUS-RATED')).toMatchObject({
            busId: 'BUS-RATED',
            lastSequence: 1,
            historyId: 'BUS-RATED__000001',
            ...scoreValues(entry),
            calculatedAt: '2026-09-22T10:30:00.000Z',
        });
    });

    it('stores the worked example exactly as MOV-111 calculates it', async () => {
        const db = seed();
        await recordAccessibilityScore(db, 'BUS-RATED', NOW);

        const [entry] = await historyOf(db, 'BUS-RATED');
        const evidence = { community: { positiveCount: 8, issueCount: 2 }, ratings: { count: 20, total: 84 } };

        expect(entry.facilityScore).toBe(75);
        expect(entry.communityScore).toBe(computeCommunityScore(evidence.community));
        expect(entry.communityScore).toBeCloseTo(70, 10);
        expect(entry.ratingScore).toBe(computeRatingScore(evidence.ratings));
        expect(entry.ratingScore).toBeCloseTo(74, 10);
        expect(entry.accessibilityScore).toBe(73);
        expect(entry.accessibilityScore).toBe(computeAccessibilityScore(SIX_OF_EIGHT, evidence));
    });

    it('stores exactly the eight agreed fields and nothing else', async () => {
        const db = seed();
        await recordAccessibilityScore(db, 'BUS-RATED', NOW);

        const [{ id, ...entry }] = await historyOf(db, 'BUS-RATED');
        expect(id).toBe('BUS-RATED__000001');
        expect(Object.keys(entry).sort()).toEqual(
            ['accessibilityScore', 'busId', 'calculatedAt', 'communityScore', 'facilityScore', 'historyId', 'ratingScore', 'sequence'].sort()
        );
    });

    it('scores each bus from its own evidence only', async () => {
        const db = seed();

        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        // BUS-PLAIN has no evidence of its own; BUS-RATED's and BUS-ELSEWHERE's
        // reports and ratings must not reach it.
        const [entry] = await historyOf(db, 'BUS-PLAIN');
        expect(entry.busId).toBe('BUS-PLAIN');
        expect(scoreValues(entry)).toEqual({
            accessibilityScore: computeAccessibilityScore(SIX_OF_EIGHT),
            facilityScore: 75,
            communityScore: 50,
            ratingScore: 50,
        });
        expect(await historyOf(db, 'BUS-RATED')).toHaveLength(0);
    });

    it('uses the injected time, not the clock', async () => {
        const db = seed();
        await recordAccessibilityScore(db, 'BUS-PLAIN', LATER);

        const [entry] = await historyOf(db, 'BUS-PLAIN');
        expect(entry.calculatedAt).toBe('2026-09-23T07:15:00.000Z');
    });

    it('reads the latest entry, the bus and its evidence inside the one transaction', async () => {
        const db = seed();
        const runOnce = db.runTransaction.getMockImplementation()!;
        const reads: any[] = [];

        db.runTransaction.mockImplementation((callback: (transaction: any) => Promise<unknown>) =>
            runOnce(async (transaction: any) => {
                const get = transaction.get;
                transaction.get = jest.fn((ref: any) => {
                    reads.push(ref);
                    return get(ref);
                });
                return callback(transaction);
            })
        );

        await recordAccessibilityScore(db, 'BUS-RATED', NOW);

        expect(db.runTransaction).toHaveBeenCalledTimes(1);
        // latest, next entry, bus, reports query, ratings query.
        expect(reads).toHaveLength(5);
    });
});

describe('deduplication', () => {
    it('stores nothing new when nothing changed', async () => {
        const db = seed();

        await recordAccessibilityScore(db, 'BUS-RATED', NOW);
        const second = await recordAccessibilityScore(db, 'BUS-RATED', LATER);

        expect(second.kind).toBe('UNCHANGED');
        const history = await historyOf(db, 'BUS-RATED');
        expect(history).toHaveLength(1);
        expect(await latestOf(db, 'BUS-RATED')).toMatchObject({ lastSequence: 1, calculatedAt: '2026-09-22T10:30:00.000Z' });
    });

    it('appends the next sequence when the score changes', async () => {
        const db = seed();
        await recordAccessibilityScore(db, 'BUS-RATED', NOW);
        const [first] = await historyOf(db, 'BUS-RATED');

        await db.collection('reports').doc('REP-NEW-ISSUE').set(report('BUS-RATED', 'VERIFIED', false, { id: 'REP-NEW-ISSUE' }));
        const result = await recordAccessibilityScore(db, 'BUS-RATED', LATER);

        expect(result.kind).toBe('RECORDED');
        const history = await historyOf(db, 'BUS-RATED');
        expect(history.map((entry) => entry.historyId)).toEqual(['BUS-RATED__000001', 'BUS-RATED__000002']);
        expect(history[1]).toMatchObject({ sequence: 2, calculatedAt: '2026-09-23T07:15:00.000Z' });
        expect(history[1].communityScore).toBe(computeCommunityScore({ positiveCount: 8, issueCount: 3 }));
        // The first entry is history: it is never rewritten.
        expect(history[0]).toEqual(first);
        expect(await latestOf(db, 'BUS-RATED')).toMatchObject({ lastSequence: 2, historyId: 'BUS-RATED__000002' });
    });

    it('compares the four stored values, not the raw evidence', async () => {
        const db = seed();
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        // Five 3-star ratings sit exactly on the neutral prior: the rating
        // component stays 50, so nothing stored changes.
        for (let i = 0; i < 5; i += 1) {
            const entry = rating('BUS-PLAIN', 3);
            await db.collection('busRatings').doc(entry.id).set(entry);
        }
        expect(computeRatingScore({ count: 5, total: 15 })).toBe(50);

        const result = await recordAccessibilityScore(db, 'BUS-PLAIN', LATER);

        expect(result.kind).toBe('UNCHANGED');
        expect(await historyOf(db, 'BUS-PLAIN')).toHaveLength(1);
    });

    it('ignores pending and rejected reports, which never count', async () => {
        const db = seed();
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        await db.collection('reports').doc('REP-P').set(report('BUS-PLAIN', 'PENDING', false, { id: 'REP-P' }));
        await db.collection('reports').doc('REP-R').set(report('BUS-PLAIN', 'REJECTED', false, { id: 'REP-R' }));

        expect((await recordAccessibilityScore(db, 'BUS-PLAIN', LATER)).kind).toBe('UNCHANGED');
        expect(await historyOf(db, 'BUS-PLAIN')).toHaveLength(1);
    });

    it('records both buses when a verified report moves from one to the other', async () => {
        const db = seed({
            buses: [bus('BUS-A'), bus('BUS-B')],
            reports: [report('BUS-A', 'VERIFIED', false, { id: 'REP-MOVED' })],
            busRatings: [],
        });
        await recordAccessibilityScore(db, 'BUS-A', NOW);
        await recordAccessibilityScore(db, 'BUS-B', NOW);

        await db.collection('reports').doc('REP-MOVED').update({ busId: 'BUS-B' });
        await recordAccessibilityScore(db, 'BUS-A', LATER);
        await recordAccessibilityScore(db, 'BUS-B', LATER);

        const historyA = await historyOf(db, 'BUS-A');
        const historyB = await historyOf(db, 'BUS-B');
        expect(historyA.map((entry) => entry.communityScore)).toEqual([computeCommunityScore({ positiveCount: 0, issueCount: 1 }), 50]);
        expect(historyB.map((entry) => entry.communityScore)).toEqual([50, computeCommunityScore({ positiveCount: 0, issueCount: 1 })]);

        // Asked again with nothing further changed, neither bus gains an entry.
        await recordAccessibilityScore(db, 'BUS-A', LATER);
        await recordAccessibilityScore(db, 'BUS-B', LATER);
        expect(await historyOf(db, 'BUS-A')).toHaveLength(2);
        expect(await historyOf(db, 'BUS-B')).toHaveLength(2);
    });
});

describe('what is never recorded', () => {
    it('writes nothing for an unusable bus id', async () => {
        const db = seed();

        for (const busId of ['', '   ', 'BUS/RATED', undefined as unknown as string]) {
            expect((await recordAccessibilityScore(db, busId, NOW)).kind).toBe('INVALID_BUS_ID');
        }
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(await historyOf(db)).toHaveLength(0);
    });

    it('writes nothing for a bus that is not stored', async () => {
        const db = seed();

        expect((await recordAccessibilityScore(db, 'BUS-GONE', NOW)).kind).toBe('NO_BUS');
        expect(await historyOf(db)).toHaveLength(0);
        expect(await allLatest(db)).toHaveLength(0);
    });

    it('never overwrites an existing entry, even when the latest document is behind', async () => {
        const stale = { id: 'BUS-RATED', busId: 'BUS-RATED', lastSequence: 1, historyId: 'BUS-RATED__000001', accessibilityScore: 1, facilityScore: 1, communityScore: 1, ratingScore: 1, calculatedAt: '2026-09-01T00:00:00.000Z' };
        const existing = { id: 'BUS-RATED__000002', historyId: 'BUS-RATED__000002', busId: 'BUS-RATED', sequence: 2, accessibilityScore: 2, facilityScore: 2, communityScore: 2, ratingScore: 2, calculatedAt: '2026-09-02T00:00:00.000Z' };
        const db = seed({ accessibilityScoreLatest: [stale], accessibilityScoreHistory: [existing] });

        await expect(recordAccessibilityScore(db, 'BUS-RATED', NOW)).rejects.toThrow('already exists');

        expect(await historyOf(db, 'BUS-RATED')).toEqual([existing]);
        expect(await latestOf(db, 'BUS-RATED')).toEqual(stale);
    });

    it('refuses a latest document with no usable sequence rather than guessing one', async () => {
        const db = seed({ accessibilityScoreLatest: [{ id: 'BUS-RATED', busId: 'BUS-RATED', lastSequence: 'broken' }] });

        await expect(recordAccessibilityScore(db, 'BUS-RATED', NOW)).rejects.toThrow('lastSequence');
        expect(await historyOf(db)).toHaveLength(0);
    });

    it('leaves the MOV-111 calculation free of persistence', () => {
        // The pure module must not import any server or database code.
        const source = fs.readFileSync(path.resolve(__dirname, '../../../src/shared/utils/accessibility.ts'), 'utf8');
        const imports = source.split('\n').filter((line) => line.startsWith('import '));

        expect(imports.join('\n')).not.toMatch(/server|firebase|config/i);
        expect(source).not.toMatch(/\.collection\(|runTransaction/);
    });
});

// ==================================================================
// The routes that change a score
// ==================================================================
describe('bus creation', () => {
    it('records a new bus with the neutral community and rating components', async () => {
        const db = createFakeFirestore({ buses: [] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await createBus(
            jsonRequest('http://localhost/api/buses', 'POST', {
                numberPlate: 'nb-7001',
                chassisNumber: 'CHS-7001',
                busModel: 'Rosa',
                manufacturer: 'Toyota',
                manufactureYear: 2022,
                seatCapacity: 30,
                accessibilityFacilities: SIX_OF_EIGHT,
                password: buildTestPassword(),
            })
        );

        expect(response.status).toBe(201);
        const [entry] = await historyOf(db, 'BUS-00001');
        expect(entry).toMatchObject({
            historyId: 'BUS-00001__000001',
            sequence: 1,
            accessibilityScore: computeAccessibilityScore(SIX_OF_EIGHT),
            facilityScore: 75,
            communityScore: 50,
            ratingScore: 50,
        });
    });
});

describe('bus update', () => {
    const put = (body: unknown) =>
        updateBus(jsonRequest('http://localhost/api/buses/BUS-PLAIN', 'PUT', body), { params: { busId: 'BUS-PLAIN' } });

    it('records a facility change that changes the score', async () => {
        const db = seed();
        mockGetAdminDb.mockReturnValue(db);
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        const response = await put({ accessibilityFacilities: FIVE_OF_EIGHT });

        expect(response.status).toBe(200);
        const history = await historyOf(db, 'BUS-PLAIN');
        expect(history).toHaveLength(2);
        expect(history[1]).toMatchObject({ sequence: 2, facilityScore: 62.5, accessibilityScore: computeAccessibilityScore(FIVE_OF_EIGHT) });
    });

    it('records nothing when the facilities are resent unchanged', async () => {
        const db = seed();
        mockGetAdminDb.mockReturnValue(db);
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        expect((await put({ accessibilityFacilities: SIX_OF_EIGHT })).status).toBe(200);
        expect(await historyOf(db, 'BUS-PLAIN')).toHaveLength(1);
    });

    it('does not consider history for a field the score does not read', async () => {
        const db = seed();
        mockGetAdminDb.mockReturnValue(db);

        expect((await put({ status: 'MAINTENANCE', seatCapacity: 50 })).status).toBe(200);
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(await historyOf(db)).toHaveLength(0);
    });
});

describe('report review', () => {
    const review = (reportId: string, action: string) =>
        reviewReport(
            jsonRequest(`http://localhost/api/reports/${reportId}/review`, 'POST', { action }, ADMIN_SESSION),
            { reportId }
        );

    it('records the bus when a report is verified', async () => {
        const db = seed({ reports: [report('BUS-PLAIN', 'PENDING', false, { id: 'REP-V' })] });
        mockGetAdminDb.mockReturnValue(db);
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        const response = await review('REP-V', 'VERIFY');

        expect(response.status).toBe(200);
        const history = await historyOf(db, 'BUS-PLAIN');
        expect(history).toHaveLength(2);
        expect(history[1].communityScore).toBe(computeCommunityScore({ positiveCount: 0, issueCount: 1 }));
    });

    it('records nothing when a pending report is rejected or only remarked on', async () => {
        const db = seed({
            reports: [report('BUS-PLAIN', 'PENDING', false, { id: 'REP-X' }), report('BUS-PLAIN', 'PENDING', false, { id: 'REP-Y' })],
        });
        mockGetAdminDb.mockReturnValue(db);

        const rejected = await review('REP-X', 'REJECT');
        const remarked = await reviewReport(
            jsonRequest('http://localhost/api/reports/REP-Y/review', 'POST', { action: 'REMARK', adminRemark: 'Checked the depot log.' }, ADMIN_SESSION),
            { reportId: 'REP-Y' }
        );

        expect(rejected.status).toBe(200);
        expect(remarked.status).toBe(200);
        // One transaction each: the decisions' own. None for history.
        expect(db.runTransaction).toHaveBeenCalledTimes(2);
        expect(await historyOf(db)).toHaveLength(0);
    });
});

describe('report edit', () => {
    it('cannot move a verified report, so it records nothing', async () => {
        // A decided report is closed to edits (409), so a VERIFIED report's bus
        // can never change through this route.
        const db = seed({ reports: [report('BUS-RATED', 'VERIFIED', false, { id: 'REP-E' })] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await editReport(
            jsonRequest('http://localhost/api/reports/REP-E', 'PUT', { issueCategory: 'BROKEN_RAMP', description: 'Moved to another bus by its author.', busId: 'BUS-PLAIN' }, PASSENGER_SESSION),
            { params: { reportId: 'REP-E' } }
        );

        expect(response.status).toBe(409);
        expect((await db.collection('reports').doc('REP-E').get()).data()?.busId).toBe('BUS-RATED');
        expect(await historyOf(db)).toHaveLength(0);
    });

    it('records nothing when a pending report moves, since pending never counts', async () => {
        const db = seed({ reports: [report('BUS-RATED', 'PENDING', false, { id: 'REP-P' })] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await editReport(
            jsonRequest('http://localhost/api/reports/REP-P', 'PUT', { issueCategory: 'BROKEN_RAMP', description: 'It was the other bus on this route.', busId: 'BUS-PLAIN' }, PASSENGER_SESSION),
            { params: { reportId: 'REP-P' } }
        );

        expect(response.status).toBe(200);
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(await historyOf(db)).toHaveLength(0);
    });
});

describe('report deletion', () => {
    const remove = (reportId: string) =>
        deleteReport(jsonRequest(`http://localhost/api/reports/${reportId}`, 'DELETE', undefined, PASSENGER_SESSION), { params: { reportId } });

    it('records the bus when a verified report is withdrawn', async () => {
        const db = seed({ reports: [report('BUS-PLAIN', 'VERIFIED', false, { id: 'REP-D' })] });
        mockGetAdminDb.mockReturnValue(db);
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        const response = await remove('REP-D');

        expect(response.status).toBe(200);
        const history = await historyOf(db, 'BUS-PLAIN');
        expect(history.map((entry) => entry.communityScore)).toEqual([computeCommunityScore({ positiveCount: 0, issueCount: 1 }), 50]);
    });

    it('records nothing when a report that never counted is deleted', async () => {
        const db = seed({
            reports: [report('BUS-PLAIN', 'PENDING', false, { id: 'REP-P' }), report('BUS-PLAIN', 'REJECTED', false, { id: 'REP-R' })],
        });
        mockGetAdminDb.mockReturnValue(db);

        expect((await remove('REP-P')).status).toBe(200);
        expect((await remove('REP-R')).status).toBe(200);
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(await historyOf(db)).toHaveLength(0);
    });
});

describe('passenger rating', () => {
    const completedBooking = {
        bookingId: 'BK-100',
        userId: PASSENGER,
        tripId: 'TRIP-100',
        busId: 'BUS-PLAIN',
        passengerJourney: {
            status: 'COMPLETED',
            tripId: 'TRIP-100',
            busId: 'BUS-PLAIN',
            journeyStartedAt: '2026-09-20T08:00:00.000Z',
            completedAt: '2026-09-20T09:00:00.000Z',
            completionReason: 'PASSENGER',
        },
    };

    const rate = (body: unknown) => submitRating(jsonRequest('http://localhost/api/journeys/completed/rating', 'POST', body, PASSENGER_SESSION));

    it('records the bus when a rating is stored', async () => {
        const db = seed({ bookings: [completedBooking] });
        mockGetAdminDb.mockReturnValue(db);
        await recordAccessibilityScore(db, 'BUS-PLAIN', NOW);

        const response = await rate({ bookingId: 'BK-100', rating: 5 });

        expect(response.status).toBe(201);
        const history = await historyOf(db, 'BUS-PLAIN');
        expect(history).toHaveLength(2);
        expect(history[1].ratingScore).toBe(computeRatingScore({ count: 1, total: 5 }));
    });

    it('records nothing for a refused or repeated rating', async () => {
        const db = seed({ bookings: [completedBooking] });
        mockGetAdminDb.mockReturnValue(db);

        expect((await rate({ bookingId: 'BK-100', rating: 7 })).status).toBe(400);
        expect(await historyOf(db)).toHaveLength(0);

        expect((await rate({ bookingId: 'BK-100', rating: 4 })).status).toBe(201);
        expect(await historyOf(db, 'BUS-PLAIN')).toHaveLength(1);

        // ALREADY_RATED: the stored rating is kept, and nothing new is recorded.
        expect((await rate({ bookingId: 'BK-100', rating: 1 })).status).toBe(409);
        expect(await historyOf(db, 'BUS-PLAIN')).toHaveLength(1);
    });

    // Skipping a rating sends no request at all (see the route's own notes),
    // so there is no skipped submission for the history to ignore.
});

// ==================================================================
// Best effort
// ==================================================================
describe('when the history cannot be written', () => {
    /** A latest document the history refuses to build on, so every recording throws. */
    const broken = (busId: string) => ({ id: busId, busId, lastSequence: 'broken' });

    beforeEach(() => {
        historyFailureExpected = true;
    });

    function expectLoggedHistoryFailure() {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Accessibility Score History Error:', expect.any(Error));
    }

    it('still stores the rating and answers exactly as before', async () => {
        const booking = {
            bookingId: 'BK-200',
            userId: PASSENGER,
            tripId: 'TRIP-200',
            busId: 'BUS-PLAIN',
            passengerJourney: {
                status: 'COMPLETED',
                tripId: 'TRIP-200',
                busId: 'BUS-PLAIN',
                journeyStartedAt: '2026-09-20T08:00:00.000Z',
                completedAt: '2026-09-20T09:00:00.000Z',
                completionReason: 'PASSENGER',
            },
        };
        const db = seed({ bookings: [booking], accessibilityScoreLatest: [broken('BUS-PLAIN')] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await submitRating(
            jsonRequest('http://localhost/api/journeys/completed/rating', 'POST', { bookingId: 'BK-200', rating: 5 }, PASSENGER_SESSION)
        );
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json).toMatchObject({ success: true, message: 'Thank you for rating this bus.', rating: { busId: 'BUS-PLAIN', rating: 5 } });
        const stored = (await db.collection('busRatings').where('busId', '==', 'BUS-PLAIN').get()).docs;
        expect(stored).toHaveLength(1);
        expect(await historyOf(db)).toHaveLength(0);
        expectLoggedHistoryFailure();
    });

    it('still records the review decision', async () => {
        const db = seed({
            reports: [report('BUS-PLAIN', 'PENDING', false, { id: 'REP-F' })],
            accessibilityScoreLatest: [broken('BUS-PLAIN')],
        });
        mockGetAdminDb.mockReturnValue(db);

        const response = await reviewReport(
            jsonRequest('http://localhost/api/reports/REP-F/review', 'POST', { action: 'VERIFY' }, ADMIN_SESSION),
            { reportId: 'REP-F' }
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toMatchObject({ success: true, message: 'Report marked VERIFIED.' });
        expect((await db.collection('reports').doc('REP-F').get()).data()?.status).toBe('VERIFIED');
        expectLoggedHistoryFailure();
    });

    it('still deletes the report', async () => {
        const db = seed({
            reports: [report('BUS-PLAIN', 'VERIFIED', false, { id: 'REP-G' })],
            accessibilityScoreLatest: [broken('BUS-PLAIN')],
        });
        mockGetAdminDb.mockReturnValue(db);

        const response = await deleteReport(
            jsonRequest('http://localhost/api/reports/REP-G', 'DELETE', undefined, PASSENGER_SESSION),
            { params: { reportId: 'REP-G' } }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, message: 'Accessibility report deleted successfully.' });
        expect((await db.collection('reports').doc('REP-G').get()).exists).toBe(false);
        expectLoggedHistoryFailure();
    });

    it('still updates the bus', async () => {
        const db = seed({ accessibilityScoreLatest: [broken('BUS-PLAIN')] });
        mockGetAdminDb.mockReturnValue(db);

        const response = await updateBus(
            jsonRequest('http://localhost/api/buses/BUS-PLAIN', 'PUT', { accessibilityFacilities: FIVE_OF_EIGHT }),
            { params: { busId: 'BUS-PLAIN' } }
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toMatchObject({ success: true, message: 'Bus updated successfully.' });
        expect(json.bus.accessibilityFacilities.wheelchairRamp).toBe(false);
        expectLoggedHistoryFailure();
    });
});

// ==================================================================
// Read paths stay read-only
// ==================================================================
describe('showing a score', () => {
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
    const trip = { id: 'TRIP-RATED', tripId: 'TRIP-RATED', routeId: ROUTE_ID, busId: 'BUS-RATED', departureTime: '09:00', estimatedArrivalTime: '10:10', turnNumber: 1, status: 'ACTIVE' };

    beforeEach(() => {
        (geocodeLocation as jest.Mock).mockResolvedValue({ latitude: 6.9333, longitude: 79.9833, displayName: 'Mocked Location, Sri Lanka' });
        (getRouteBetweenCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
        (getRouteThroughCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    });

    it('never writes history from search, booking options or seat selection', async () => {
        const db = seed({ routes: [route], trips: [trip] });
        mockGetAdminDb.mockReturnValue(db);

        const search = await searchJourneys(
            jsonRequest('http://localhost/api/journeys/search', 'POST', {
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-09-22',
                travelTime: '08:00',
            })
        );
        const options = await getBookingOptions(new Request(`http://localhost/api/booking/options?routeId=${ROUTE_ID}`));
        const seats = await getBookingSeats(new Request('http://localhost/api/booking/seats/TRIP-RATED'), { tripId: 'TRIP-RATED' });

        expect(search.status).toBe(200);
        expect(options.status).toBe(200);
        expect(seats.status).toBe(200);
        expect((await seats.json()).accessibilityScore).toBe(73);

        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(await historyOf(db)).toHaveLength(0);
        expect(await allLatest(db)).toHaveLength(0);
    });
});
