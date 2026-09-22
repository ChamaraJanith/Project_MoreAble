// GET /api/buses/:busId/ratings — how one bus stands with its passengers
// (MOV-80 / MOV-116).
//
// Drives the real endpoint over an in-memory Firestore. What it pins:
//
//   * the average is the PLAIN mean on the 1–5 scale, not the accessibility
//     score's rating component — those are different numbers and the whole
//     point of this endpoint is that the passenger sees the first one;
//   * only ratings the project already considers valid are counted, decided by
//     the same readBusRating / tallyPassengerRatings the score uses;
//   * one bus's ratings never reach another bus's answer;
//   * a bus nobody has rated has NO average, never zero stars;
//   * reading writes nothing — no score is recalculated and no MOV-113 history
//     entry is appended.

import { GET as getBusRatings } from '../../../app/api/buses/[busId]/ratings+api';
import {
    ACCESSIBILITY_SCORE_HISTORY_COLLECTION,
    ACCESSIBILITY_SCORE_LATEST_COLLECTION,
} from '../../../src/shared/server/accessibilityScoreHistory';
import { BUS_RATINGS_COLLECTION } from '../../../src/shared/server/busRating';
import { computeRatingScore } from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));

const TOKENS: Record<string, unknown> = {
    'token-a': { uid: 'uid-a', passengerId: 'PAS-2026-00001', role: 'PASSENGER', email: 'a@moreable.lk' },
    'token-admin': { uid: 'uid-admin', passengerId: 'ADM-2026-00001', role: 'ADMIN', email: 'admin@moreable.lk' },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation((token: string) => TOKENS[token] ?? null);
});

/** One stored rating document, in the shape submitBusRating writes. */
function rating(busId: string, stars: unknown, id: string) {
    return {
        ratingId: id,
        passengerId: `PAS-${id}`,
        bookingId: `BK-${id}`,
        busId,
        tripId: 'TRIP-001',
        journeyStartedAt: '2026-09-01T06:00:00.000Z',
        rating: stars,
        createdAt: '2026-09-01T09:00:00.000Z',
    };
}

function seed(ratings: Record<string, unknown>[] = []) {
    return createFakeFirestore({ [BUS_RATINGS_COLLECTION]: ratings as any });
}

async function read(db: any, busId: string, token: string | null = 'token-a') {
    mockGetAdminDb.mockReturnValue(db);

    const response = await getBusRatings(
        new Request(`http://localhost/api/buses/${encodeURIComponent(busId)}/ratings`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
        { params: { busId } }
    );

    return { status: response.status, body: await response.json() };
}

// ------------------------------------------------------------------
describe('the average of valid ratings', () => {
    it('averages several ratings of one bus', async () => {
        const db = seed([
            rating('BUS-A', 5, '1'),
            rating('BUS-A', 4, '2'),
            rating('BUS-A', 3, '3'),
            rating('BUS-A', 4, '4'),
        ]);

        const { status, body } = await read(db, 'BUS-A');

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.summary).toEqual({ busId: 'BUS-A', average: 4, count: 4 });
    });

    it('keeps a repeating average exact rather than pre-rounding it', async () => {
        const db = seed([rating('BUS-A', 5, '1'), rating('BUS-A', 4, '2'), rating('BUS-A', 4, '3')]);

        const { body } = await read(db, 'BUS-A');

        expect(body.summary.count).toBe(3);
        expect(body.summary.average).toBeCloseTo(4.3333333, 6);
        // 13/3 exactly: the screen rounds once, for display.
        expect(body.summary.average).toBe(13 / 3);
    });

    it('averages the worked example to 4.25', async () => {
        const db = seed([
            rating('BUS-A', 5, '1'),
            rating('BUS-A', 4, '2'),
            rating('BUS-A', 3, '3'),
            rating('BUS-A', 5, '4'),
        ]);

        expect((await read(db, 'BUS-A')).body.summary).toEqual({
            busId: 'BUS-A',
            average: 4.25,
            count: 4,
        });
    });

    it('answers a single rating with that rating', async () => {
        const db = seed([rating('BUS-A', 5, '1')]);

        expect((await read(db, 'BUS-A')).body.summary).toEqual({
            busId: 'BUS-A',
            average: 5,
            count: 1,
        });
    });

    it('names the bus that was asked about', async () => {
        const db = seed([rating('BUS-A', 5, '1')]);

        expect((await read(db, 'BUS-A')).body.summary.busId).toBe('BUS-A');
    });
});

// ------------------------------------------------------------------
describe('this is not the accessibility score', () => {
    it('reports the plain mean, not the score component the mean feeds', async () => {
        // One 5-star rating. The passenger-facing average is 5.0; MOV-79's
        // rating component pulls it toward a neutral 3 and remaps onto 0–100,
        // which is a completely different figure. Confusing the two is the
        // mistake this endpoint exists to prevent.
        const db = seed([rating('BUS-A', 5, '1')]);

        const { body } = await read(db, 'BUS-A');

        expect(body.summary.average).toBe(5);
        expect(body.summary.average).not.toBe(computeRatingScore({ count: 1, total: 5 }));
    });

    it('does not put a 0-100 score anywhere in the response', async () => {
        const db = seed([rating('BUS-A', 4, '1')]);

        const { body } = await read(db, 'BUS-A');

        expect(body.accessibilityScore).toBeUndefined();
        expect(body.summary.ratingScore).toBeUndefined();
        expect(body.summary.average).toBeLessThanOrEqual(5);
    });
});

// ------------------------------------------------------------------
describe('a bus nobody has rated', () => {
    it('has no average, rather than zero stars', async () => {
        const { body } = await read(seed([]), 'BUS-A');

        expect(body.success).toBe(true);
        expect(body.summary).toEqual({ busId: 'BUS-A', average: null, count: 0 });
        expect(body.summary.average).not.toBe(0);
    });

    it('answers the same way when other buses have been rated', async () => {
        const db = seed([rating('BUS-B', 5, '1'), rating('BUS-B', 4, '2')]);

        expect((await read(db, 'BUS-A')).body.summary).toEqual({
            busId: 'BUS-A',
            average: null,
            count: 0,
        });
    });

    it('answers for a bus that is not in the fleet rather than inventing a 404', async () => {
        // A retired vehicle keeps the ratings it earned, and an unknown id has
        // none — both are honestly "no ratings", not "no such thing".
        const { status, body } = await read(seed([]), 'BUS-NEVER-EXISTED');

        expect(status).toBe(200);
        expect(body.summary).toEqual({ busId: 'BUS-NEVER-EXISTED', average: null, count: 0 });
    });
});

// ------------------------------------------------------------------
describe('invalid stored ratings change neither the average nor the count', () => {
    it('ignores anything that is not a whole 1 to 5', async () => {
        const db = seed([
            rating('BUS-A', 5, '1'),
            rating('BUS-A', 4, '2'),
            rating('BUS-A', 0, 'zero'),
            rating('BUS-A', 6, 'six'),
            rating('BUS-A', '5', 'string'),
            rating('BUS-A', null, 'null'),
            rating('BUS-A', 4.5, 'fraction'),
            rating('BUS-A', -3, 'negative'),
        ]);

        const { body } = await read(db, 'BUS-A');

        // 5 and 4 only.
        expect(body.summary).toEqual({ busId: 'BUS-A', average: 4.5, count: 2 });
    });

    it('ignores a document missing the fields a rating must have', async () => {
        const db = seed([
            rating('BUS-A', 4, '1'),
            { ...rating('BUS-A', 5, 'no-passenger'), passengerId: '' },
            { ...rating('BUS-A', 5, 'no-created'), createdAt: '' },
            { ...rating('BUS-A', 5, 'no-trip'), tripId: '' },
        ]);

        expect((await read(db, 'BUS-A')).body.summary).toEqual({
            busId: 'BUS-A',
            average: 4,
            count: 1,
        });
    });

    it('has no average when every stored rating is unusable', async () => {
        const db = seed([rating('BUS-A', 0, 'zero'), rating('BUS-A', '4', 'string')]);

        expect((await read(db, 'BUS-A')).body.summary).toEqual({
            busId: 'BUS-A',
            average: null,
            count: 0,
        });
    });
});

// ------------------------------------------------------------------
describe('one bus at a time', () => {
    const fleet = [
        rating('BUS-A', 5, 'a1'),
        rating('BUS-A', 4, 'a2'),
        rating('BUS-A', 4, 'a3'),
        rating('BUS-B', 2, 'b1'),
        rating('BUS-B', 1, 'b2'),
    ];

    it('answers for bus A without bus B affecting it', async () => {
        const { body } = await read(seed(fleet), 'BUS-A');

        expect(body.summary.count).toBe(3);
        expect(body.summary.average).toBeCloseTo(4.3333333, 6);
    });

    it('answers for bus B without bus A affecting it', async () => {
        expect((await read(seed(fleet), 'BUS-B')).body.summary).toEqual({
            busId: 'BUS-B',
            average: 1.5,
            count: 2,
        });
    });

    it('never answers with a fleet-wide average', async () => {
        const { body } = await read(seed(fleet), 'BUS-A');

        // 16/5 = 3.2 is every rating in the database. It must not appear.
        expect(body.summary.average).not.toBeCloseTo(3.2, 6);
        expect(body.summary.count).not.toBe(fleet.length);
    });

    it('asks the database for this bus rather than reading every rating', async () => {
        const db = seed(fleet);
        await read(db, 'BUS-A');

        // A single-field equality query, the same shape the score evidence uses
        // — so no composite index, and no other bus's documents are fetched.
        expect(db.collection).toHaveBeenCalledWith(BUS_RATINGS_COLLECTION);
        const query = db.collection.mock.results[0].value;
        expect(query.where).toHaveBeenCalledWith('busId', '==', 'BUS-A');
    });
});

// ------------------------------------------------------------------
describe('access', () => {
    it('refuses a request with no token', async () => {
        const { status, body } = await read(seed([]), 'BUS-A', null);

        expect(status).toBe(401);
        expect(body.success).toBe(false);
    });

    it('refuses an invalid or expired token', async () => {
        const { status } = await read(seed([]), 'BUS-A', 'token-expired');

        expect(status).toBe(401);
    });

    it('answers a signed-in passenger', async () => {
        expect((await read(seed([rating('BUS-A', 4, '1')]), 'BUS-A', 'token-a')).status).toBe(200);
    });

    it('answers any signed-in account, since the summary names nobody', async () => {
        expect((await read(seed([rating('BUS-A', 4, '1')]), 'BUS-A', 'token-admin')).status).toBe(200);
    });

    it('requires a bus id', async () => {
        mockGetAdminDb.mockReturnValue(seed([]));

        const response = await getBusRatings(
            new Request('http://localhost/api/buses//ratings', {
                headers: { Authorization: 'Bearer token-a' },
            }),
            { params: {} }
        );

        expect(response.status).toBe(400);
    });
});

// ------------------------------------------------------------------
describe('nothing private, and nothing written', () => {
    it('names no passenger and carries no rating document', async () => {
        const db = seed([rating('BUS-A', 5, '1'), rating('BUS-A', 3, '2')]);

        const { body } = await read(db, 'BUS-A');
        const serialised = JSON.stringify(body);

        expect(Object.keys(body.summary).sort()).toEqual(['average', 'busId', 'count']);
        expect(serialised).not.toContain('PAS-');
        expect(serialised).not.toContain('BK-');
        expect(serialised).not.toContain('passengerId');
        expect(serialised).not.toContain('bookingId');
        expect(serialised).not.toContain('ratingId');
        expect(serialised).not.toContain('journeyStartedAt');
    });

    it('records no accessibility score history for a read (MOV-113 is untouched)', async () => {
        const db = seed([rating('BUS-A', 5, '1')]);

        await read(db, 'BUS-A');

        const history = await db.collection(ACCESSIBILITY_SCORE_HISTORY_COLLECTION).get();
        const latest = await db.collection(ACCESSIBILITY_SCORE_LATEST_COLLECTION).get();

        expect(history.docs).toHaveLength(0);
        expect(latest.docs).toHaveLength(0);
    });

    it('leaves the stored ratings exactly as they were', async () => {
        const db = seed([rating('BUS-A', 5, '1'), rating('BUS-A', 3, '2')]);

        await read(db, 'BUS-A');

        const stored = (await db.collection(BUS_RATINGS_COLLECTION).get()).docs;
        expect(stored).toHaveLength(2);
        expect(stored.map((doc: any) => doc.data().rating).sort()).toEqual([3, 5]);
    });
});
