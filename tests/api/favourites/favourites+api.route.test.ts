// GET, POST and DELETE /api/favourites — the HTTP contract (MOV-101).
//
// The rule these tests exist for is that ownership is the session's and nothing
// else: a passengerId in a body is never believed, one passenger's list never
// contains another's, and one passenger can never delete another's favourite —
// nor learn that it exists by trying.
//
// The other rule worth pinning down is that this layer stayed thin. Duplicate
// prevention, ordering and the ownership check itself belong to MOV-100 and are
// exercised through the route here only to prove the route actually delegates
// to them.
//
// No credential is used anywhere. `verifyToken` is stubbed to map an opaque
// test key to a session payload, so the Authorization header parsing in
// `authenticateRequest` still runs for real — the same arrangement the report
// vote and bus rating route tests already use.

import { DELETE as removeFavourite } from '../../../app/api/favourites/[favouriteId]+api';
import { GET as listFavourites, POST as saveFavourite } from '../../../app/api/favourites/index+api';
import { FAVOURITE_ROUTES_COLLECTION } from '../../../src/shared/server/favouriteRoutes';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (value: string) => mockVerifyToken(value),
}));

// ------------------------------------------------------------------
// Fixtures
//
// Passenger ids and opaque session keys — identifiers, not secrets. Nothing
// here is a password, a signing secret or a real token.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';
const SESSION_VEHICLE = 'session-vehicle';

const SESSIONS: Record<string, Record<string, string>> = {
    [SESSION_A]: { uid: 'uid-a', passengerId: PASSENGER_A, role: 'PASSENGER', email: 'a@moreable.lk' },
    [SESSION_B]: { uid: 'uid-b', passengerId: PASSENGER_B, role: 'PASSENGER', email: 'b@moreable.lk' },
    // A vehicle session carries a busId, which the passenger gate refuses.
    [SESSION_VEHICLE]: { uid: 'BUS-1', passengerId: 'BUS-1', role: 'BUS', email: '', busId: 'BUS-1' },
};

const ROUTE = {
    routeId: 'ROUTE-177',
    routeNumber: '177',
    routeName: 'Kaduwela - Colombo Fort',
    status: 'ACTIVE',
    stops: ['Colombo Fort', 'Borella', 'Malabe', 'Kaduwela'],
};

const STOPS = [
    { stopId: 'STOP-1', name: 'Colombo Fort' },
    { stopId: 'STOP-2', name: 'Borella' },
    { stopId: 'STOP-3', name: 'Malabe' },
    { stopId: 'STOP-4', name: 'Kaduwela' },
];

function firestore() {
    return createFakeFirestore({
        routes: [{ id: ROUTE.routeId, ...ROUTE }],
        stops: STOPS.map((stop) => ({ id: stop.stopId, ...stop })),
        [FAVOURITE_ROUTES_COLLECTION]: [],
    });
}

let db: any;

beforeEach(() => {
    jest.clearAllMocks();
    db = firestore();
    mockGetAdminDb.mockImplementation(() => db);
    mockVerifyToken.mockImplementation(async (value: string) => SESSIONS[value] ?? null);
});

// ------------------------------------------------------------------
// Requests
// ------------------------------------------------------------------
function request(method: string, options: { session?: string; body?: unknown; path?: string } = {}): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.session) headers.Authorization = `Bearer ${options.session}`;

    return new Request(`http://localhost${options.path ?? '/api/favourites'}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
}

async function list(session?: string) {
    const response = await listFavourites(request('GET', { session }));

    return { response, body: await response.json() };
}

async function save(session: string | undefined, body: unknown) {
    const response = await saveFavourite(request('POST', { session, body }));

    return { response, body: await response.json() };
}

async function remove(session: string | undefined, favouriteId: string) {
    const response = await removeFavourite(
        request('DELETE', { session, path: `/api/favourites/${encodeURIComponent(favouriteId)}` }),
        { params: { favouriteId } }
    );

    return { response, body: await response.json() };
}

/** Every favourite document stored, whoever owns it. */
async function storedFavourites() {
    const snapshot = await db.collection(FAVOURITE_ROUTES_COLLECTION).get();

    return snapshot.docs.map((doc: any) => doc.data());
}

const JOURNEY = { origin: 'Colombo Fort', destination: 'Kaduwela' };

// ------------------------------------------------------------------
describe('authentication', () => {
    it('refuses every endpoint without a session', async () => {
        expect((await list()).response.status).toBe(401);
        expect((await save(undefined, JOURNEY)).response.status).toBe(401);
        expect((await remove(undefined, 'anything')).response.status).toBe(401);
    });

    it('refuses a session whose token does not verify', async () => {
        const { response } = await list('not-a-known-session');

        expect(response.status).toBe(401);
    });

    it('refuses a vehicle session — favourites belong to passengers', async () => {
        expect((await list(SESSION_VEHICLE)).response.status).toBe(403);
        expect((await save(SESSION_VEHICLE, JOURNEY)).response.status).toBe(403);
        expect((await remove(SESSION_VEHICLE, 'anything')).response.status).toBe(403);
    });

    it('writes nothing when it refuses', async () => {
        await save(undefined, JOURNEY);
        await save(SESSION_VEHICLE, JOURNEY);

        expect(await storedFavourites()).toHaveLength(0);
    });
});

// ------------------------------------------------------------------
describe('GET /api/favourites', () => {
    it('answers an empty list with success, not an error', async () => {
        const { response, body } = await list(SESSION_A);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.favourites).toEqual([]);
        expect(body.count).toBe(0);
    });

    it('returns the passenger own favourites, newest first', async () => {
        await save(SESSION_A, { origin: 'Colombo Fort', destination: 'Borella' });
        await save(SESSION_A, { origin: 'Malabe', destination: 'Kaduwela' });

        const { body } = await list(SESSION_A);

        expect(body.count).toBe(2);
        // Newest first — the second save leads.
        expect(body.favourites[0].origin).toBe('Malabe');
        expect(body.favourites[1].origin).toBe('Colombo Fort');
    });

    it('never returns another passenger favourites', async () => {
        await save(SESSION_A, JOURNEY);
        await save(SESSION_B, { origin: 'Borella', destination: 'Malabe' });

        const mine = await list(SESSION_A);
        const theirs = await list(SESSION_B);

        expect(mine.body.favourites).toHaveLength(1);
        expect(mine.body.favourites[0].origin).toBe('Colombo Fort');
        expect(theirs.body.favourites).toHaveLength(1);
        expect(theirs.body.favourites[0].origin).toBe('Borella');
    });

    it('does not leak the owner to the client', async () => {
        await save(SESSION_A, JOURNEY);

        const { body } = await list(SESSION_A);

        expect(Object.keys(body.favourites[0]).sort()).toEqual([
            'createdAt',
            'destination',
            'favouriteId',
            'origin',
        ]);
    });
});

// ------------------------------------------------------------------
describe('POST /api/favourites', () => {
    it('saves the journey pair for the signed-in passenger', async () => {
        const { response, body } = await save(SESSION_A, JOURNEY);

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.alreadySaved).toBe(false);
        expect(body.favourite).toMatchObject({ origin: 'Colombo Fort', destination: 'Kaduwela' });

        const [stored] = await storedFavourites();
        expect(stored.passengerId).toBe(PASSENGER_A);
    });

    it('stores nothing about a departure', async () => {
        await save(SESSION_A, {
            ...JOURNEY,
            // All ignored: a favourite is a route pair, not a saved journey.
            tripId: 'TRIP-1',
            busId: 'BUS-1',
            routeId: 'ROUTE-177',
            travelDate: '2026-09-25',
            travelTime: '08:30',
            bookingId: 'BK-1',
        });

        const [stored] = await storedFavourites();

        ['tripId', 'busId', 'routeId', 'travelDate', 'travelTime', 'bookingId'].forEach((field) =>
            expect(stored).not.toHaveProperty(field)
        );
    });

    it('ignores a passengerId in the body — ownership is the session', async () => {
        await save(SESSION_A, { ...JOURNEY, passengerId: PASSENGER_B });

        const [stored] = await storedFavourites();
        expect(stored.passengerId).toBe(PASSENGER_A);

        // And it really is not on the other passenger's list.
        expect((await list(SESSION_B)).body.favourites).toHaveLength(0);
    });

    it('ignores a favouriteId and createdAt in the body', async () => {
        const { body } = await save(SESSION_A, {
            ...JOURNEY,
            favouriteId: 'chosen-by-the-client',
            createdAt: '1999-01-01T00:00:00.000Z',
        });

        expect(body.favourite.favouriteId).not.toBe('chosen-by-the-client');
        expect(body.favourite.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    });

    it('is idempotent — a repeat save keeps one favourite and its first timestamp', async () => {
        const first = await save(SESSION_A, JOURNEY);
        const second = await save(SESSION_A, { origin: 'colombo fort', destination: 'KADUWELA' });

        expect(first.response.status).toBe(201);
        expect(second.response.status).toBe(200);
        expect(second.body.success).toBe(true);
        expect(second.body.alreadySaved).toBe(true);
        expect(second.body.favourite.createdAt).toBe(first.body.favourite.createdAt);
        expect(second.body.favourite.favouriteId).toBe(first.body.favourite.favouriteId);
        expect(await storedFavourites()).toHaveLength(1);
    });

    it('lets two passengers each save the same pair', async () => {
        await save(SESSION_A, JOURNEY);
        await save(SESSION_B, JOURNEY);

        expect(await storedFavourites()).toHaveLength(2);
    });

    it('rejects a malformed body', async () => {
        for (const body of [undefined, 'not an object', ['an array'], 42]) {
            const { response } = await save(SESSION_A, body);

            expect(response.status).toBe(400);
        }

        expect(await storedFavourites()).toHaveLength(0);
    });

    it('rejects a missing, empty or non-string origin or destination', async () => {
        const cases: unknown[] = [
            { destination: 'Kaduwela' },
            { origin: 'Colombo Fort' },
            { origin: '', destination: 'Kaduwela' },
            { origin: '   ', destination: 'Kaduwela' },
            { origin: 'Colombo Fort', destination: '' },
            { origin: 42, destination: 'Kaduwela' },
            { origin: 'Colombo Fort', destination: null },
        ];

        for (const body of cases) {
            const { response } = await save(SESSION_A, body);

            expect(response.status).toBe(400);
        }

        expect(await storedFavourites()).toHaveLength(0);
    });

    it('rejects a stop this network does not serve', async () => {
        const unknownOrigin = await save(SESSION_A, { origin: 'Atlantis', destination: 'Kaduwela' });
        const unknownDestination = await save(SESSION_A, { origin: 'Colombo Fort', destination: 'Atlantis' });

        expect(unknownOrigin.response.status).toBe(400);
        expect(unknownOrigin.body.message).toBe('Invalid origin location');
        expect(unknownDestination.response.status).toBe(400);
        expect(unknownDestination.body.message).toBe('Invalid destination location');
        expect(await storedFavourites()).toHaveLength(0);
    });

    it('rejects a journey that starts where it ends', async () => {
        const { response, body } = await save(SESSION_A, {
            origin: 'Colombo Fort',
            destination: 'colombo fort',
        });

        expect(response.status).toBe(400);
        expect(body.code).toBe('SAME_LOCATION');
        expect(await storedFavourites()).toHaveLength(0);
    });

    it('keeps the stop names the passenger gave, trimmed and not rewritten', async () => {
        await save(SESSION_A, { origin: '  Colombo Fort  ', destination: 'Kaduwela' });

        const [stored] = await storedFavourites();
        expect(stored.origin).toBe('Colombo Fort');
    });
});

// ------------------------------------------------------------------
describe('DELETE /api/favourites/[favouriteId]', () => {
    async function savedFavouriteId(session: string, journey = JOURNEY) {
        const { body } = await save(session, journey);

        return body.favourite.favouriteId as string;
    }

    it('removes the passenger own favourite', async () => {
        const favouriteId = await savedFavouriteId(SESSION_A);

        const { response, body } = await remove(SESSION_A, favouriteId);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect((await list(SESSION_A)).body.favourites).toEqual([]);
        expect(await storedFavourites()).toHaveLength(0);
    });

    it('will not let one passenger delete another favourite, and says nothing about it', async () => {
        const favouriteId = await savedFavouriteId(SESSION_A);

        const { response, body } = await remove(SESSION_B, favouriteId);

        // The same 404 a favourite that does not exist gives.
        expect(response.status).toBe(404);
        expect(body.message).toBe('Favourite route not found.');
        expect((await list(SESSION_A)).body.favourites).toHaveLength(1);
    });

    it('answers 404 for a favourite that is not there', async () => {
        const { response } = await remove(SESSION_A, 'no-such-favourite');

        expect(response.status).toBe(404);
    });

    it('survives an id carrying characters that need encoding', async () => {
        // The id MOV-100 builds is itself percent-encoded, so it has to travel
        // through the path and come back out unchanged.
        const favouriteId = await savedFavouriteId(SESSION_A, {
            origin: 'Colombo Fort',
            destination: 'Kaduwela',
        });

        expect(favouriteId).toContain('%20');
        expect((await remove(SESSION_A, favouriteId)).response.status).toBe(200);
    });
});
