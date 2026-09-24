// Favourite routes — the data layer (MOV-100).
//
// The rules these tests exist for are the ones the document id is carrying:
// one passenger saving one journey pair twice must land on ONE favourite, two
// different pairs must never land on the same one, and a stop name holding a
// '/' must not be able to reach outside its own document.
//
// The other rule worth pinning down is isolation: this layer is handed a
// passenger id by the API layer and every read, write and delete is scoped to
// it, so one passenger's favourites can neither be listed nor deleted by
// another.
//
// No authentication is involved at this level and none is mocked: the functions
// take a passenger id as an ordinary parameter, so nothing here needs a token,
// a session or a credential of any kind.

import {
    FAVOURITE_ROUTES_COLLECTION,
    decodeFavouriteRouteSegment,
    encodeFavouriteRouteSegment,
    favouriteRouteDocumentId,
    listFavouriteRoutes,
    readFavouriteRoute,
    removeFavouriteRoute,
    saveFavouriteRoute,
} from '../../../src/shared/server/favouriteRoutes';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

// ------------------------------------------------------------------
// Fixtures
//
// Passenger ids only — identifiers the app already prints on screen, not
// secrets. Nothing here authenticates.
// ------------------------------------------------------------------
const PASSENGER = 'PAS-2026-00001';
const OTHER_PASSENGER = 'PAS-2026-00002';

const SAVED_AT = new Date('2026-09-20T08:30:00.000Z');

/** An empty store. Documents are only ever created through the layer itself. */
function firestore() {
    return createFakeFirestore({ [FAVOURITE_ROUTES_COLLECTION]: [] });
}

/** Everything actually in the collection, read back through the fake itself. */
async function storedDocuments(db: any): Promise<any[]> {
    const snapshot = await db.collection(FAVOURITE_ROUTES_COLLECTION).get();

    return snapshot.docs.map((doc: any) => doc.data());
}

// ------------------------------------------------------------------
describe('document id', () => {
    it('is deterministic for the same passenger and journey pair', () => {
        expect(favouriteRouteDocumentId(PASSENGER, 'Colombo Fort', 'Kaduwela')).toBe(
            favouriteRouteDocumentId(PASSENGER, 'Colombo Fort', 'Kaduwela')
        );
    });

    it('ignores casing and surrounding whitespace, as the journey search does', () => {
        expect(favouriteRouteDocumentId(PASSENGER, '  colombo fort ', 'KADUWELA')).toBe(
            favouriteRouteDocumentId(PASSENGER, 'Colombo Fort', 'Kaduwela')
        );
    });

    it('distinguishes direction', () => {
        expect(favouriteRouteDocumentId(PASSENGER, 'Colombo Fort', 'Kaduwela')).not.toBe(
            favouriteRouteDocumentId(PASSENGER, 'Kaduwela', 'Colombo Fort')
        );
    });

    it('keeps one passenger off another passenger key', () => {
        expect(favouriteRouteDocumentId(PASSENGER, 'Colombo Fort', 'Kaduwela')).not.toBe(
            favouriteRouteDocumentId(OTHER_PASSENGER, 'Colombo Fort', 'Kaduwela')
        );
    });

    it('never emits a raw "/" — a stop name cannot escape its own document', () => {
        const id = favouriteRouteDocumentId(PASSENGER, 'Kadawatha / Ragama Junction', 'Kaduwela');

        expect(id).not.toContain('/');
        expect(id).toContain('%2F');
    });

    it('escapes every other character that would be unsafe or ambiguous', () => {
        const id = favouriteRouteDocumentId(PASSENGER, 'A?b#c%d e', 'Kaduwela');

        ['?', '#', ' '].forEach((character) => expect(id).not.toContain(character));
        // '%' survives only as the marker of an escape, never as the stop name's
        // own character, which encodes to '%25'.
        expect(id).toContain('%25');
    });

    it('does not collide when a stop name contains the separator itself', () => {
        // 'A__B' -> 'C' and 'A' -> 'B__C' would share an id if '_' were left
        // literal, which is why the encoder escapes it.
        expect(favouriteRouteDocumentId(PASSENGER, 'A__B', 'C')).not.toBe(
            favouriteRouteDocumentId(PASSENGER, 'A', 'B__C')
        );
    });

    it('splits back into exactly three parts', () => {
        const id = favouriteRouteDocumentId(PASSENGER, 'Kadawatha / Ragama', 'A__B');

        expect(id.split('__')).toHaveLength(3);
    });

    it('is reversible to the normalised pair it encoded', () => {
        const original = 'Kadawatha / Ragama Junction';
        const [, origin] = favouriteRouteDocumentId(PASSENGER, original, 'Kaduwela').split('__');

        expect(decodeFavouriteRouteSegment(origin)).toBe(original.toLowerCase());
    });

    it('handles unicode stop names', () => {
        const id = favouriteRouteDocumentId(PASSENGER, 'කඩුවෙල', 'කොළඹ');

        expect(id).not.toContain('/');
        expect(id.split('__')).toHaveLength(3);
        expect(decodeFavouriteRouteSegment(id.split('__')[1])).toBe('කඩුවෙල');
    });

    it('encodes a segment without leaving a literal underscore behind', () => {
        expect(encodeFavouriteRouteSegment('a_b')).not.toContain('_');
    });
});

// ------------------------------------------------------------------
describe('saving', () => {
    it('stores the pair against the passenger, and nothing about a departure', async () => {
        const db = firestore();

        const result = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'Colombo Fort', destination: 'Kaduwela' },
            SAVED_AT
        );

        expect(result.kind).toBe('SAVED');

        const [stored] = await storedDocuments(db);
        expect(stored).toMatchObject({
            passengerId: PASSENGER,
            origin: 'Colombo Fort',
            destination: 'Kaduwela',
            createdAt: SAVED_AT.toISOString(),
        });

        // A favourite is a route pair, never a saved journey.
        ['tripId', 'busId', 'routeId', 'travelDate', 'travelTime'].forEach((field) =>
            expect(stored).not.toHaveProperty(field)
        );
    });

    it('keeps the canonical stop names exactly as given', async () => {
        const db = firestore();

        await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: '  Colombo Fort  ', destination: 'Kadawatha / Ragama Junction' },
            SAVED_AT
        );

        const [stored] = await storedDocuments(db);
        // Trimmed, but never lowercased, stripped of punctuation or truncated.
        expect(stored.origin).toBe('Colombo Fort');
        expect(stored.destination).toBe('Kadawatha / Ragama Junction');
    });

    it('stores createdAt as an ISO string, not a display string', async () => {
        const db = firestore();

        await saveFavouriteRoute(db, PASSENGER, { origin: 'A', destination: 'B' }, SAVED_AT);

        const [stored] = await storedDocuments(db);
        expect(stored.createdAt).toBe('2026-09-20T08:30:00.000Z');
        expect(new Date(stored.createdAt).getTime()).toBe(SAVED_AT.getTime());
    });

    it('saving the same pair twice leaves one favourite, with the first timestamp', async () => {
        const db = firestore();
        const later = new Date('2026-09-21T09:00:00.000Z');

        const first = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'Colombo Fort', destination: 'Kaduwela' },
            SAVED_AT
        );
        const second = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'colombo fort', destination: 'KADUWELA' },
            later
        );

        expect(first.kind).toBe('SAVED');
        expect(second.kind).toBe('ALREADY_SAVED');
        expect(await storedDocuments(db)).toHaveLength(1);
        expect((await storedDocuments(db))[0].createdAt).toBe(SAVED_AT.toISOString());
    });

    it('keeps different pairs, and both directions, as separate favourites', async () => {
        const db = firestore();

        await saveFavouriteRoute(db, PASSENGER, { origin: 'A', destination: 'B' }, SAVED_AT);
        await saveFavouriteRoute(db, PASSENGER, { origin: 'B', destination: 'A' }, SAVED_AT);
        await saveFavouriteRoute(db, PASSENGER, { origin: 'A', destination: 'C' }, SAVED_AT);

        expect(await storedDocuments(db)).toHaveLength(3);
    });

    it('lets two passengers each save the same pair', async () => {
        const db = firestore();

        await saveFavouriteRoute(db, PASSENGER, { origin: 'A', destination: 'B' }, SAVED_AT);
        await saveFavouriteRoute(db, OTHER_PASSENGER, { origin: 'A', destination: 'B' }, SAVED_AT);

        expect(await storedDocuments(db)).toHaveLength(2);
    });

    it('refuses a journey it cannot store, and writes nothing', async () => {
        const db = firestore();

        const cases: [any, any, string][] = [
            ['', 'Kaduwela', 'ORIGIN_REQUIRED'],
            ['   ', 'Kaduwela', 'ORIGIN_REQUIRED'],
            [null, 'Kaduwela', 'ORIGIN_REQUIRED'],
            ['Colombo Fort', '', 'DESTINATION_REQUIRED'],
            ['Colombo Fort', undefined, 'DESTINATION_REQUIRED'],
            ['Colombo Fort', 'colombo fort', 'SAME_LOCATION'],
            ['A'.repeat(800), 'B'.repeat(800), 'JOURNEY_TOO_LONG'],
        ];

        for (const [origin, destination, reason] of cases) {
            const result = await saveFavouriteRoute(db, PASSENGER, { origin, destination });

            expect(result).toEqual({ kind: 'INVALID_JOURNEY', reason });
        }

        expect(await storedDocuments(db)).toHaveLength(0);
    });

    it('refuses to write without a passenger', async () => {
        const db = firestore();

        const result = await saveFavouriteRoute(db, '  ', { origin: 'A', destination: 'B' });

        expect(result).toEqual({ kind: 'MISSING_PASSENGER' });
        expect(await storedDocuments(db)).toHaveLength(0);
    });
});

// ------------------------------------------------------------------
describe('listing', () => {
    it('returns the passenger own favourites, newest first', async () => {
        const db = firestore();

        await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'A', destination: 'B' },
            new Date('2026-09-18T08:00:00.000Z')
        );
        await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'C', destination: 'D' },
            new Date('2026-09-22T08:00:00.000Z')
        );
        await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'E', destination: 'F' },
            new Date('2026-09-20T08:00:00.000Z')
        );

        const favourites = await listFavouriteRoutes(db, PASSENGER);

        expect(favourites.map((favourite) => favourite.origin)).toEqual(['C', 'E', 'A']);
    });

    it('never returns another passenger favourites', async () => {
        const db = firestore();

        await saveFavouriteRoute(db, PASSENGER, { origin: 'A', destination: 'B' }, SAVED_AT);
        await saveFavouriteRoute(db, OTHER_PASSENGER, { origin: 'X', destination: 'Y' }, SAVED_AT);

        const mine = await listFavouriteRoutes(db, PASSENGER);
        const theirs = await listFavouriteRoutes(db, OTHER_PASSENGER);

        expect(mine).toHaveLength(1);
        expect(mine[0].origin).toBe('A');
        expect(theirs).toHaveLength(1);
        expect(theirs[0].origin).toBe('X');
    });

    it('hands back the shape the app consumes, without the owner', async () => {
        const db = firestore();

        await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'Colombo Fort', destination: 'Kaduwela' },
            SAVED_AT
        );

        const [favourite] = await listFavouriteRoutes(db, PASSENGER);

        expect(Object.keys(favourite).sort()).toEqual([
            'createdAt',
            'destination',
            'favouriteId',
            'origin',
        ]);
    });

    it('is empty for a passenger with none, and without a passenger', async () => {
        const db = firestore();

        expect(await listFavouriteRoutes(db, PASSENGER)).toEqual([]);
        expect(await listFavouriteRoutes(db, '')).toEqual([]);
    });
});

// ------------------------------------------------------------------
describe('reading a stored document', () => {
    it('rebuilds a well-formed record', () => {
        expect(
            readFavouriteRoute({
                favouriteId: 'id-1',
                passengerId: PASSENGER,
                origin: 'Colombo Fort',
                destination: 'Kaduwela',
                createdAt: SAVED_AT.toISOString(),
            })
        ).toEqual({
            favouriteId: 'id-1',
            origin: 'Colombo Fort',
            destination: 'Kaduwela',
            createdAt: SAVED_AT.toISOString(),
        });
    });

    it('accepts a Firestore Timestamp for createdAt', () => {
        const favourite = readFavouriteRoute({
            favouriteId: 'id-1',
            origin: 'A',
            destination: 'B',
            createdAt: { toDate: () => SAVED_AT },
        });

        expect(favourite?.createdAt).toBe(SAVED_AT.toISOString());
    });

    it('returns null for anything it cannot read as a favourite', () => {
        const base = {
            favouriteId: 'id-1',
            origin: 'A',
            destination: 'B',
            createdAt: SAVED_AT.toISOString(),
        };

        expect(readFavouriteRoute(null)).toBeNull();
        expect(readFavouriteRoute({})).toBeNull();
        expect(readFavouriteRoute({ ...base, favouriteId: '' })).toBeNull();
        expect(readFavouriteRoute({ ...base, origin: '   ' })).toBeNull();
        expect(readFavouriteRoute({ ...base, destination: 42 })).toBeNull();
        expect(readFavouriteRoute({ ...base, createdAt: 'not a date' })).toBeNull();
        expect(readFavouriteRoute({ ...base, createdAt: undefined })).toBeNull();
    });

    it('skips an unreadable document instead of failing the whole list', async () => {
        const db = createFakeFirestore({
            [FAVOURITE_ROUTES_COLLECTION]: [
                {
                    id: 'broken',
                    favouriteId: 'broken',
                    passengerId: PASSENGER,
                    origin: 'A',
                    // destination and createdAt never written
                },
            ],
        });

        await saveFavouriteRoute(db, PASSENGER, { origin: 'C', destination: 'D' }, SAVED_AT);

        const favourites = await listFavouriteRoutes(db, PASSENGER);

        expect(favourites).toHaveLength(1);
        expect(favourites[0].origin).toBe('C');
    });
});

// ------------------------------------------------------------------
describe('removing', () => {
    it('removes the passenger own favourite, and it stays removed', async () => {
        const db = firestore();

        const saved = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'A', destination: 'B' },
            SAVED_AT
        );
        const favouriteId = saved.kind === 'SAVED' ? saved.favourite.favouriteId : '';

        expect(await removeFavouriteRoute(db, PASSENGER, favouriteId)).toEqual({ kind: 'REMOVED' });
        expect(await listFavouriteRoutes(db, PASSENGER)).toEqual([]);
        expect(await storedDocuments(db)).toHaveLength(0);
    });

    it('will not let one passenger delete another favourite', async () => {
        const db = firestore();

        const saved = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'A', destination: 'B' },
            SAVED_AT
        );
        const favouriteId = saved.kind === 'SAVED' ? saved.favourite.favouriteId : '';

        const result = await removeFavouriteRoute(db, OTHER_PASSENGER, favouriteId);

        // The same answer a missing favourite gives, so trying ids reveals
        // nothing about anybody else's.
        expect(result).toEqual({ kind: 'NOT_FOUND' });
        expect(await listFavouriteRoutes(db, PASSENGER)).toHaveLength(1);
    });

    it('reports a favourite that is not there', async () => {
        const db = firestore();

        expect(await removeFavouriteRoute(db, PASSENGER, 'no-such-favourite')).toEqual({
            kind: 'NOT_FOUND',
        });
        // An empty id would make Firestore throw on the path, so it is caught first.
        expect(await removeFavouriteRoute(db, PASSENGER, '')).toEqual({ kind: 'NOT_FOUND' });
    });

    it('refuses to delete without a passenger', async () => {
        const db = firestore();

        await saveFavouriteRoute(db, PASSENGER, { origin: 'A', destination: 'B' }, SAVED_AT);

        expect(await removeFavouriteRoute(db, '', 'anything')).toEqual({
            kind: 'MISSING_PASSENGER',
        });
        expect(await storedDocuments(db)).toHaveLength(1);
    });

    it('saving again after a removal is a fresh save on the same key', async () => {
        const db = firestore();
        const later = new Date('2026-09-25T10:00:00.000Z');

        const saved = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'A', destination: 'B' },
            SAVED_AT
        );
        const favouriteId = saved.kind === 'SAVED' ? saved.favourite.favouriteId : '';

        await removeFavouriteRoute(db, PASSENGER, favouriteId);
        const again = await saveFavouriteRoute(
            db,
            PASSENGER,
            { origin: 'A', destination: 'B' },
            later
        );

        expect(again.kind).toBe('SAVED');
        expect(again.kind === 'SAVED' && again.favourite.favouriteId).toBe(favouriteId);
        expect((await storedDocuments(db))[0].createdAt).toBe(later.toISOString());
    });
});
