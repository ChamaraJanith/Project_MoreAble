// Signing out empties the favourite routes (MOV-102).
//
// The defect this covers: favourites are held in memory for the signed-in
// passenger, and `logout()` used to leave them there. On a shared device the
// next person could still read the previous passenger's saved journeys until
// something happened to refresh them.
//
// This is deliberately an integration test of the REAL seam. The actual
// `useAuthStore` and the actual favourites store are both loaded, and the real
// `logout()` is called — only the two modules that reach into Expo
// (`shared/api/config` for expo-constants, `shared/utils/tokenStorage` for
// expo-secure-store) and the favourites API client are stubbed, because none of
// them is what is being tested. So if the reset were removed from the store,
// this test would fail rather than quietly keep passing.
//
// No credential appears anywhere: the session is an opaque string handed to the
// auth store directly, and nothing signs, verifies or stores a real token.

import { fetchFavouriteRoutes } from '../../../src/features/journey/api/favouriteRoutesApi';
import {
    getFavouriteRoutesState,
    loadFavouriteRoutes,
    resetFavouriteRoutes,
} from '../../../src/features/journey/store/favouriteRoutesStore';
import { useAuthStore } from '../../../src/shared/store/authStore';
import { clearTokens } from '../../../src/shared/utils/tokenStorage';

// `jest.mock` is hoisted above the imports, so the real auth store and the real
// favourites store both load against these stubs.
//
// Only the two modules that reach into Expo are replaced — `shared/api/config`
// for expo-constants and `shared/utils/tokenStorage` for expo-secure-store —
// because neither is transformed in this node-only Jest setup and neither is
// what is under test. The `API_BASE_URL: ''` stand-in is the one the bus rating
// tests already use.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

jest.mock('../../../src/shared/utils/tokenStorage', () => ({
    saveTokens: jest.fn(async () => {}),
    getAccessToken: jest.fn(async () => null),
    getUserData: jest.fn(async () => null),
    clearTokens: jest.fn(async () => {}),
    isTokenExpired: jest.fn(() => false),
    saveSavedCredentials: jest.fn(async () => {}),
    getSavedCredentials: jest.fn(async () => null),
    clearSavedCredentials: jest.fn(async () => {}),
}));

jest.mock('../../../src/features/journey/api/favouriteRoutesApi', () => ({
    fetchFavouriteRoutes: jest.fn(),
    createFavouriteRoute: jest.fn(),
    deleteFavouriteRoute: jest.fn(),
}));

const mockFetch = fetchFavouriteRoutes as jest.Mock;

/** Opaque stand-ins for a signed-in session. Not credentials. */
const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

const A_FAVOURITE = {
    favouriteId: 'PAS-2026-00001__colombo%20fort__kaduwela',
    origin: 'Colombo Fort',
    destination: 'Kaduwela',
    createdAt: '2026-09-20T08:30:00.000Z',
};

const B_FAVOURITE = {
    favouriteId: 'PAS-2026-00002__borella__malabe',
    origin: 'Borella',
    destination: 'Malabe',
    createdAt: '2026-09-21T08:30:00.000Z',
};

/** Puts a session on the auth store the way a completed login leaves it. */
function signIn(token: string) {
    useAuthStore.setState({ token, isAuthenticated: true, user: null });
}

beforeAll(() => {
    // `logout()` fires a best-effort push-token de-registration. Stubbed so the
    // test does not depend on the network; the call itself is existing
    // behaviour and is deliberately left intact.
    (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
});

beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ token: null, isAuthenticated: false, user: null });
    resetFavouriteRoutes();
});

// ------------------------------------------------------------------
describe('signing out', () => {
    it('empties the favourites immediately, not on the next screen focus', async () => {
        signIn(SESSION_A);
        mockFetch.mockResolvedValue({ ok: true, value: [A_FAVOURITE] });
        await loadFavouriteRoutes();

        expect(getFavouriteRoutesState().favourites).toHaveLength(1);

        await useAuthStore.getState().logout();

        // Read straight after logout resolves — nothing has focused a screen,
        // and no further request has been made.
        expect(getFavouriteRoutesState().favourites).toEqual([]);
        expect(getFavouriteRoutesState().status).toBe('ready');
        expect(getFavouriteRoutesState().errorMessage).toBeNull();
    });

    it('leaves the rest of the logout behaviour exactly as it was', async () => {
        signIn(SESSION_A);

        await useAuthStore.getState().logout();

        const auth = useAuthStore.getState();
        expect(auth.token).toBeNull();
        expect(auth.user).toBeNull();
        expect(auth.isAuthenticated).toBe(false);
        // The stored session is still cleared, as it always was.
        expect(clearTokens).toHaveBeenCalled();
    });

    it('does not show the previous passenger favourites to the next one', async () => {
        signIn(SESSION_A);
        mockFetch.mockResolvedValue({ ok: true, value: [A_FAVOURITE] });
        await loadFavouriteRoutes();

        await useAuthStore.getState().logout();

        // Passenger B signs in and loads their own.
        signIn(SESSION_B);
        mockFetch.mockResolvedValue({ ok: true, value: [B_FAVOURITE] });
        await loadFavouriteRoutes();

        const { favourites } = getFavouriteRoutesState();
        expect(favourites).toHaveLength(1);
        expect(favourites[0].favouriteId).toBe(B_FAVOURITE.favouriteId);
        expect(favourites.some((favourite) => favourite.origin === A_FAVOURITE.origin)).toBe(false);
        // B's own list still loads normally.
        expect(mockFetch).toHaveBeenLastCalledWith(SESSION_B);
    });

    it('clears them when one passenger replaces another without a logout', async () => {
        signIn(SESSION_A);
        mockFetch.mockResolvedValue({ ok: true, value: [A_FAVOURITE] });
        await loadFavouriteRoutes();

        // A session swap, such as a re-login, is the same hazard as a sign-out.
        signIn(SESSION_B);

        expect(getFavouriteRoutesState().favourites).toEqual([]);
    });

    it('discards a read that was still in flight when the session ended', async () => {
        signIn(SESSION_A);

        let settle: (value: unknown) => void = () => {};
        mockFetch.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

        const loading = loadFavouriteRoutes();

        await useAuthStore.getState().logout();

        // A's favourites arrive after the session is over; they must not land.
        settle({ ok: true, value: [A_FAVOURITE] });
        await loading;

        expect(getFavouriteRoutesState().favourites).toEqual([]);
    });
});
