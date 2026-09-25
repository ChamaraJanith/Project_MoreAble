// The favourite routes store against the API (MOV-101).
//
// What matters here is that MOV-99's experience survived being put behind a
// network: the star flips the moment it is pressed rather than when the server
// answers, and a request that fails puts the list back the way it was instead
// of leaving the screen claiming something that never happened.
//
// The API client is stubbed, so these are the store's own rules — optimistic
// write, reconcile, roll back — and not a second test of the route.
//
// No credential is involved: the auth store is given an opaque session key, the
// same kind of test double the route tests use.

import {
    getFavouriteRoutesState,
    loadFavouriteRoutes,
    removeFavouriteRoute,
    resetFavouriteRoutes,
    saveFavouriteRoute,
} from '../../../src/features/journey/store/favouriteRoutesStore';
import {
    createFavouriteRoute,
    deleteFavouriteRoute,
    fetchFavouriteRoutes,
} from '../../../src/features/journey/api/favouriteRoutesApi';

jest.mock('../../../src/features/journey/api/favouriteRoutesApi', () => ({
    fetchFavouriteRoutes: jest.fn(),
    createFavouriteRoute: jest.fn(),
    deleteFavouriteRoute: jest.fn(),
}));

/**
 * The session the store reads, stubbed at the module.
 *
 * The real auth store reaches expo-constants and expo-secure-store through
 * `shared/api/config`, neither of which this node-only Jest setup transforms —
 * and none of that is what these tests are about. Only the token the store
 * asks for matters here.
 */
let mockSessionToken: string | null = null;

jest.mock('../../../src/shared/store/authStore', () => ({
    useAuthStore: { getState: () => ({ token: mockSessionToken }) },
}));

const mockFetch = fetchFavouriteRoutes as jest.Mock;
const mockCreate = createFavouriteRoute as jest.Mock;
const mockDelete = deleteFavouriteRoute as jest.Mock;

/** An opaque stand-in for a signed-in session. Not a credential. */
const SESSION = 'session-a';

const JOURNEY = { origin: 'Colombo Fort', destination: 'Kaduwela' };

const SAVED = {
    favouriteId: 'PAS-2026-00001__colombo%20fort__kaduwela',
    origin: 'Colombo Fort',
    destination: 'Kaduwela',
    createdAt: '2026-09-20T08:30:00.000Z',
};

const OLDER = {
    favouriteId: 'PAS-2026-00001__borella__malabe',
    origin: 'Borella',
    destination: 'Malabe',
    createdAt: '2026-09-18T08:30:00.000Z',
};

function signIn() {
    mockSessionToken = SESSION;
}

function signOut() {
    mockSessionToken = null;
}

beforeEach(() => {
    jest.clearAllMocks();
    resetFavouriteRoutes();
    signIn();
});

// ------------------------------------------------------------------
describe('loading', () => {
    it('puts what the API returns into the store, newest first', async () => {
        mockFetch.mockResolvedValue({ ok: true, value: [OLDER, SAVED] });

        await loadFavouriteRoutes();

        const state = getFavouriteRoutesState();
        expect(mockFetch).toHaveBeenCalledWith(SESSION);
        expect(state.status).toBe('ready');
        expect(state.favourites.map((favourite) => favourite.favouriteId)).toEqual([
            SAVED.favouriteId,
            OLDER.favouriteId,
        ]);
    });

    it('reports a failure without losing what is already on screen', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, value: [SAVED] });
        await loadFavouriteRoutes();

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: null,
            code: null,
            message: 'Network error. Please check your connection and try again.',
        });
        await loadFavouriteRoutes();

        const state = getFavouriteRoutesState();
        expect(state.status).toBe('error');
        expect(state.errorMessage).toBe('Network error. Please check your connection and try again.');
        expect(state.favourites).toHaveLength(1);
    });

    it('holds nothing, and asks for nothing, when nobody is signed in', async () => {
        signOut();

        await loadFavouriteRoutes();

        expect(mockFetch).not.toHaveBeenCalled();
        expect(getFavouriteRoutesState().favourites).toEqual([]);
    });
});

// ------------------------------------------------------------------
describe('saving', () => {
    it('shows the journey as saved before the request answers', async () => {
        let settle: (value: unknown) => void = () => {};
        mockCreate.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

        const saving = saveFavouriteRoute(JOURNEY);

        // Optimistic: on screen already, with a provisional id.
        expect(getFavouriteRoutesState().favourites).toHaveLength(1);

        settle({ ok: true, value: { favourite: SAVED, alreadySaved: false } });
        await saving;

        // Reconciled: one entry, now carrying the server's own id.
        const { favourites } = getFavouriteRoutesState();
        expect(favourites).toHaveLength(1);
        expect(favourites[0].favouriteId).toBe(SAVED.favouriteId);
        expect(favourites[0].createdAt).toBe(SAVED.createdAt);
    });

    it('sends only the journey pair', async () => {
        mockCreate.mockResolvedValue({ ok: true, value: { favourite: SAVED, alreadySaved: false } });

        await saveFavouriteRoute(JOURNEY);

        expect(mockCreate).toHaveBeenCalledWith(
            SESSION,
            expect.objectContaining({ origin: 'Colombo Fort', destination: 'Kaduwela' })
        );
    });

    it('takes the journey back off the list when the save fails', async () => {
        mockCreate.mockResolvedValue({
            ok: false,
            status: 500,
            code: null,
            message: 'Failed to save this journey to your favourite routes.',
        });

        await saveFavouriteRoute(JOURNEY);

        const state = getFavouriteRoutesState();
        expect(state.favourites).toEqual([]);
        expect(state.status).toBe('error');
        expect(state.errorMessage).toBe('Failed to save this journey to your favourite routes.');
    });

    it('does not ask again for a journey it already holds', async () => {
        mockCreate.mockResolvedValue({ ok: true, value: { favourite: SAVED, alreadySaved: false } });
        await saveFavouriteRoute(JOURNEY);
        mockCreate.mockClear();

        // The same pair, typed differently.
        await saveFavouriteRoute({ origin: 'colombo fort', destination: 'KADUWELA' });

        expect(mockCreate).not.toHaveBeenCalled();
        expect(getFavouriteRoutesState().favourites).toHaveLength(1);
    });

    it('refuses without a session rather than pretending to save', async () => {
        signOut();

        await saveFavouriteRoute(JOURNEY);

        expect(mockCreate).not.toHaveBeenCalled();
        expect(getFavouriteRoutesState().favourites).toEqual([]);
        expect(getFavouriteRoutesState().status).toBe('error');
    });
});

// ------------------------------------------------------------------
describe('removing', () => {
    async function withOneSaved() {
        mockCreate.mockResolvedValue({ ok: true, value: { favourite: SAVED, alreadySaved: false } });
        await saveFavouriteRoute(JOURNEY);
    }

    it('takes it off the list and tells the API', async () => {
        await withOneSaved();
        mockDelete.mockResolvedValue({ ok: true, value: true });

        await removeFavouriteRoute(SAVED.favouriteId);

        expect(mockDelete).toHaveBeenCalledWith(SESSION, SAVED.favouriteId);
        expect(getFavouriteRoutesState().favourites).toEqual([]);
    });

    it('puts it back when the removal fails', async () => {
        await withOneSaved();
        mockDelete.mockResolvedValue({
            ok: false,
            status: 500,
            code: null,
            message: 'Failed to remove this favourite route.',
        });

        await removeFavouriteRoute(SAVED.favouriteId);

        const state = getFavouriteRoutesState();
        expect(state.favourites).toHaveLength(1);
        expect(state.status).toBe('error');
        expect(state.errorMessage).toBe('Failed to remove this favourite route.');
    });

    it('treats a favourite the server no longer has as removed', async () => {
        await withOneSaved();
        mockDelete.mockResolvedValue({ ok: false, status: 404, code: null, message: 'Favourite route not found.' });

        await removeFavouriteRoute(SAVED.favouriteId);

        const state = getFavouriteRoutesState();
        expect(state.favourites).toEqual([]);
        expect(state.status).toBe('ready');
    });

    it('ignores an id it is not holding', async () => {
        await removeFavouriteRoute('never-held');

        expect(mockDelete).not.toHaveBeenCalled();
    });
});
