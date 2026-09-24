// Favourite routes — persistence (MOV-100).
//
// A favourite is a REUSABLE JOURNEY PAIR: one passenger, one origin, one
// destination. It is not a saved booking and not a saved departure, so nothing
// here stores a routeId, tripId, busId, date, time, seat or fare. Which buses
// serve the pair is looked up fresh by the Journey Search every time the
// favourite is used, which is what stops a favourite going stale when a
// timetable shifts or a vehicle is reassigned.
//
// What may be written is decided by the caller's verified identity alone:
//
//     verified passenger session        (MOV-101, authenticateRequest)
//        -> passengerId                 (never a value taken from a request body)
//        -> favouriteRoutes/{id}        (id derived from that same passengerId)
//
// Every function takes `passengerId` as its own parameter. This module never
// reads a token, a header or a request, so there is no way for it to be handed
// an identity the API layer did not verify.
//
// Shaped like `busRating.ts`, the project's closest existing passenger-owned
// record: `adminDb` is injected rather than imported, results are a discriminated
// union the API layer maps to HTTP, and one document per logical unit is
// guaranteed by the document id rather than by a uniqueness query.
//
// SCOPE: this is the data layer only. The HTTP endpoints are MOV-101.

import {
    FavouriteRoute,
    sortFavouriteRoutes,
} from '../../features/journey/utils/favouriteRoutes';
import { normalizeLocation } from '../utils/location';

/**
 * Top-level, like every other collection in this project.
 *
 * Deliberately NOT a `passengers/{id}/favouriteRoutes` subcollection: there is
 * not one subcollection anywhere in this codebase, and ownership is carried by
 * a `passengerId` FIELD on a flat document everywhere it already exists
 * (`busRatings`, `reports`, `votes`, `caregiver_links`, `medical_profiles`).
 * Isolation comes from the query and the id, not from the path — see
 * `listFavouriteRoutes` and `removeFavouriteRoute`.
 *
 * camelCase to match the most recent passenger-owned collections (`busRatings`,
 * `vehicleLocations`).
 */
export const FAVOURITE_ROUTES_COLLECTION = 'favouriteRoutes';

/**
 * Firestore's hard ceiling for a document id, in UTF-8 bytes.
 *
 * Reachable in principle because percent-encoding a non-ASCII stop name — a
 * Sinhala one, say — costs nine characters per character. Guarded rather than
 * truncated: a truncated id would silently merge two different journeys into
 * one favourite.
 */
const MAX_DOCUMENT_ID_LENGTH = 1500;

/** The document as it is stored. A superset of the shape the app consumes. */
export interface StoredFavouriteRoute extends FavouriteRoute {
    /** The owner. Written from the verified session, never from a request body. */
    passengerId: string;
}

// ------------------------------------------------------------------
// Document id
// ------------------------------------------------------------------

/**
 * One part of a document id, encoded so it is safe and unambiguous.
 *
 * Stop names are free text and this project has never constrained them: a name
 * may hold '/', which is a Firestore path separator, as well as '?', '#', '%',
 * spaces and any Unicode at all. `encodeURIComponent` escapes every one of
 * those and is exactly reversible.
 *
 * The extra `_` escape is what makes the '__' separator trustworthy. Without
 * it, an origin of 'A__B' with a destination of 'C' and an origin of 'A' with a
 * destination of 'B__C' both produce '…__A__B__C' — two different journeys, one
 * document. Percent-encoding every underscore leaves no literal '_' inside a
 * segment, so '__' can only ever be a separator. `decodeURIComponent` turns
 * '%5F' back into '_' with no special handling, so the round trip still works.
 *
 * Normalised first, so identity is case- and whitespace-insensitive in exactly
 * the way the Journey Search itself matches stops (`normalizeLocation`). That
 * is what makes 'Colombo Fort' and 'colombo fort' ONE favourite. The canonical
 * name the passenger sees is not touched by this — it is stored separately, as
 * given, on the `origin` and `destination` fields.
 */
export function encodeFavouriteRouteSegment(value: unknown): string {
    return encodeURIComponent(normalizeLocation(value)).replace(/_/g, '%5F');
}

/** Reverses `encodeFavouriteRouteSegment`, to the normalised form it encoded. */
export function decodeFavouriteRouteSegment(value: string): string {
    return decodeURIComponent(value);
}

/**
 * The document id for one passenger's favourite of one journey pair.
 *
 * Deterministic, so saving the same pair twice addresses the same document and
 * a duplicate is impossible by construction rather than by a check that could
 * lose a race — the same reasoning `reportVoteDocumentId` and
 * `busRatingDocumentId` are built on.
 *
 * The passenger id is part of the key, so one passenger's favourite of a
 * journey can never collide with another's, and an id cannot be guessed into
 * from a different session.
 *
 * Cannot collide with Firestore's reserved `__.*__` form: that requires the id
 * to both begin and end with a double underscore, which would need an empty
 * passenger id and an empty destination, and both are rejected before this is
 * called.
 */
export function favouriteRouteDocumentId(
    passengerId: string,
    origin: string,
    destination: string
): string {
    return [
        encodeURIComponent(passengerId.trim()).replace(/_/g, '%5F'),
        encodeFavouriteRouteSegment(origin),
        encodeFavouriteRouteSegment(destination),
    ].join('__');
}

// ------------------------------------------------------------------
// Validation
//
// Only what persistence itself requires. Stop names are stored exactly as the
// caller canonicalised them — never lowercased, trimmed of punctuation,
// truncated or transliterated. Whether a name is a stop the network actually
// serves is the Journey Search's question, and MOV-101's to ask.
// ------------------------------------------------------------------

export type FavouriteRouteRejection =
    | 'ORIGIN_REQUIRED'
    | 'DESTINATION_REQUIRED'
    | 'SAME_LOCATION'
    | 'JOURNEY_TOO_LONG';

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

interface ValidatedJourney {
    origin: string;
    destination: string;
    favouriteId: string;
}

type JourneyValidation =
    | { ok: true; journey: ValidatedJourney }
    | { ok: false; reason: FavouriteRouteRejection };

function validateJourney(
    passengerId: string,
    origin: unknown,
    destination: unknown
): JourneyValidation {
    const trimmedOrigin = text(origin);
    if (!trimmedOrigin) return { ok: false, reason: 'ORIGIN_REQUIRED' };

    const trimmedDestination = text(destination);
    if (!trimmedDestination) return { ok: false, reason: 'DESTINATION_REQUIRED' };

    // A journey to where it starts is not a journey, and the Journey Search
    // already refuses one (`isSameLocation`). Compared normalised, so it is
    // refused for the same reason the search refuses it rather than on casing.
    if (normalizeLocation(trimmedOrigin) === normalizeLocation(trimmedDestination)) {
        return { ok: false, reason: 'SAME_LOCATION' };
    }

    const favouriteId = favouriteRouteDocumentId(passengerId, trimmedOrigin, trimmedDestination);

    // Percent-encoding leaves pure ASCII, so characters and bytes agree here.
    if (favouriteId.length > MAX_DOCUMENT_ID_LENGTH) {
        return { ok: false, reason: 'JOURNEY_TOO_LONG' };
    }

    return {
        ok: true,
        journey: { origin: trimmedOrigin, destination: trimmedDestination, favouriteId },
    };
}

// ------------------------------------------------------------------
// Reading a stored document
// ------------------------------------------------------------------

/**
 * A stored favourite rebuilt field by field, or null when it cannot be read as
 * one.
 *
 * Firestore is schema-less, so a document can hold anything a past write or a
 * hand edit left there. A record missing any part of its identity is skipped
 * rather than surfaced half-formed — the same tactic `readBusRating` uses.
 *
 * Returns the shape the app consumes: `passengerId` is deliberately dropped,
 * because a passenger reading their own list learns nothing from being told
 * whose it is, and no screen has a use for it.
 */
export function readFavouriteRoute(data: any): FavouriteRoute | null {
    const favouriteId = text(data?.favouriteId);
    const origin = text(data?.origin);
    const destination = text(data?.destination);
    const createdAt = readCreatedAt(data?.createdAt);

    if (!favouriteId || !origin || !destination || !createdAt) return null;

    return { favouriteId, origin, destination, createdAt };
}

/**
 * `createdAt` as the ISO 8601 string the app's `FavouriteRoute` declares.
 *
 * Written as an ISO string by `saveFavouriteRoute`, which is this project's
 * prevailing convention for passenger-owned records (bus ratings, report votes
 * and comments, caregiver links, medical and accessibility profiles all store
 * one, and `serverTimestamp()` is used nowhere in the codebase). A Firestore
 * Timestamp is still accepted on the way out, so a document written by any
 * other path is read rather than discarded — the same tolerance `toIsoString`
 * gives the reports collection.
 */
function readCreatedAt(value: unknown): string | null {
    if (!value) return null;

    const date = (value as any)?.toDate ? (value as any).toDate() : new Date(value as any);
    const time = date instanceof Date ? date.getTime() : NaN;

    return Number.isNaN(time) ? null : date.toISOString();
}

// ------------------------------------------------------------------
// Operations
//
// Every expected outcome is a `kind` the API layer maps to a status code. An
// UNEXPECTED Firestore failure is deliberately not caught here: it propagates
// so MOV-101 can answer 500 and log it, rather than being flattened into a
// result that would read like the passenger did something wrong.
// ------------------------------------------------------------------

export type SaveFavouriteRouteResult =
    | { kind: 'SAVED'; favourite: FavouriteRoute }
    /** The pair was already saved; the original is returned untouched. */
    | { kind: 'ALREADY_SAVED'; favourite: FavouriteRoute }
    | { kind: 'MISSING_PASSENGER' }
    | { kind: 'INVALID_JOURNEY'; reason: FavouriteRouteRejection };

/**
 * Saves one journey pair for one passenger.
 *
 * Written in a transaction that reads the document's own key first, so two taps
 * or a retried request leave exactly one favourite and the first one's
 * `createdAt` survives — a passenger who presses the star twice does not see
 * their list reorder.
 *
 * `now` is injectable so a test can pin the stored timestamp.
 */
export async function saveFavouriteRoute(
    adminDb: any,
    passengerId: string,
    input: { origin: unknown; destination: unknown },
    now: Date = new Date()
): Promise<SaveFavouriteRouteResult> {
    const owner = text(passengerId);
    if (!owner) return { kind: 'MISSING_PASSENGER' };

    const validation = validateJourney(owner, input?.origin, input?.destination);
    if (!validation.ok) return { kind: 'INVALID_JOURNEY', reason: validation.reason };

    const { origin, destination, favouriteId } = validation.journey;
    const favouriteRef = adminDb.collection(FAVOURITE_ROUTES_COLLECTION).doc(favouriteId);

    return adminDb.runTransaction(async (transaction: any): Promise<SaveFavouriteRouteResult> => {
        const existing = await transaction.get(favouriteRef);

        if (existing?.exists) {
            const stored = readFavouriteRoute(existing.data());

            // A document that exists but cannot be read is replaced rather than
            // returned: it is this passenger's own key, and leaving it would
            // strand the pair as permanently unsaveable.
            if (stored) return { kind: 'ALREADY_SAVED', favourite: stored };
        }

        const record: StoredFavouriteRoute = {
            favouriteId,
            passengerId: owner,
            origin,
            destination,
            createdAt: now.toISOString(),
        };

        transaction.set(favouriteRef, record);

        const { passengerId: _owner, ...favourite } = record;
        return { kind: 'SAVED', favourite };
    });
}

/**
 * One passenger's favourites, newest first.
 *
 * A single equality filter, which Firestore indexes automatically — so this
 * needs no composite index and this project, which has no index configuration
 * at all, needs none added. Ordering is applied in memory afterwards, because
 * `.where('passengerId','==',…).orderBy('createdAt','desc')` filters and orders
 * on DIFFERENT fields and Firestore requires a composite index for that. The
 * list is a handful of documents per passenger, so the sort is free, and it
 * reuses the app's own `sortFavouriteRoutes` rather than restating what
 * newest-first means — the same arrangement `loadBusRatingSummary` and the
 * reports list already use.
 *
 * Only this passenger's documents are ever fetched: the filter is the
 * isolation, and it is applied to an id the API layer verified.
 */
export async function listFavouriteRoutes(
    adminDb: any,
    passengerId: string
): Promise<FavouriteRoute[]> {
    const owner = text(passengerId);
    if (!owner) return [];

    const snapshot = await adminDb
        .collection(FAVOURITE_ROUTES_COLLECTION)
        .where('passengerId', '==', owner)
        .get();

    const favourites = (snapshot?.docs ?? [])
        .map((doc: any) => readFavouriteRoute(doc.data()))
        .filter((favourite: FavouriteRoute | null): favourite is FavouriteRoute => favourite !== null);

    return sortFavouriteRoutes(favourites);
}

export type RemoveFavouriteRouteResult =
    | { kind: 'REMOVED' }
    /** No such favourite for this passenger — missing, or somebody else's. */
    | { kind: 'NOT_FOUND' }
    | { kind: 'MISSING_PASSENGER' };

/**
 * Removes one of this passenger's favourites.
 *
 * Ownership is checked against the STORED `passengerId` rather than inferred
 * from the id's shape, so the rule still holds if the id scheme ever changes.
 *
 * A favourite belonging to somebody else answers NOT_FOUND, exactly as a
 * missing one does. The two are deliberately indistinguishable: a passenger
 * learns nothing about anybody else's favourites by trying ids, which is the
 * same reasoning DELETE /api/reports/[reportId] applies to reports.
 *
 * Deleted outside a transaction, matching how the reports route deletes: there
 * is nothing to read-modify-write, and the id is already the passenger's own.
 */
export async function removeFavouriteRoute(
    adminDb: any,
    passengerId: string,
    favouriteId: string
): Promise<RemoveFavouriteRouteResult> {
    const owner = text(passengerId);
    if (!owner) return { kind: 'MISSING_PASSENGER' };

    const id = text(favouriteId);
    // Firestore throws on an empty document path rather than reporting a miss,
    // so this has to be caught before the read, not after.
    if (!id) return { kind: 'NOT_FOUND' };

    const favouriteRef = adminDb.collection(FAVOURITE_ROUTES_COLLECTION).doc(id);
    const existing = await favouriteRef.get();

    if (!existing?.exists) return { kind: 'NOT_FOUND' };
    if (text(existing.data()?.passengerId) !== owner) return { kind: 'NOT_FOUND' };

    await favouriteRef.delete();

    return { kind: 'REMOVED' };
}
