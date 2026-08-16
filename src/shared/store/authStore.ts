// Auth Store — Zustand state management for authentication
// Handles login, logout, session persistence, and hydration

import { create } from 'zustand';
import { API_BASE_URL } from '../api/config';
import {
    clearTokens,
    getAccessToken,
    getUserData,
    isTokenExpired,
    saveTokens,
} from '../utils/tokenStorage';

export interface GuardianDetails {
    fullName: string;
    email?: string;
    mobileNo: string;
    nicNo: string;
    relationship?: string;
}

export interface AuthUser {
    uid: string;
    passengerId: string;
    userName: string;
    email: string;
    nicNo: string;
    calculatedAge: number;
    isElderPerson: boolean;
    role: string;
    phoneNumber?: string;
    secondaryPhoneNumber?: string | null;
    isVerified: boolean;
    guardianId?: string | null;
    guardianDetails?: GuardianDetails | null;
    accessibilityProfileId?: string | null;
    createdAt: string;
    updatedAt: string;
}

interface AuthState {
    // State
    user: AuthUser | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    isHydrated: boolean;

    // Actions
    login: (identifier: string, password: string) => Promise<{ success: boolean; message: string; isAdmin: boolean }>;
    logout: () => Promise<void>;
    hydrate: () => Promise<void>;
    updateGuardianDetails: (details: GuardianDetails) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
    // Initial state
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    isHydrated: false,

    /**
     * Login — calls the login API, stores JWT + user data on success.
     */
    login: async (identifier: string, password: string) => {
        set({ isLoading: true });

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password }),
            });

            let result: any = {};
            try {
                result = await response.json();
            } catch (parseError) {
                console.error('Failed to parse login response:', parseError);
            }

            if (response.ok && result.success && result.token) {
                const user = result.user as AuthUser;
                const token = result.token as string;

                // Persist to secure storage
                await saveTokens(token, user);

                set({
                    user,
                    token,
                    isAuthenticated: true,
                    isLoading: false,
                });

                return {
                    success: true,
                    message: result.message || 'Login successful!',
                    isAdmin: user.role === 'ADMIN',
                };
            } else {
                set({ isLoading: false });
                return {
                    success: false,
                    message: result.message || 'Invalid credentials.',
                    isAdmin: false,
                };
            }
        } catch (error) {
            console.error('Login Error:', error);
            set({ isLoading: false });
            return {
                success: false,
                message: 'Network error. Please try again later.',
                isAdmin: false,
            };
        }
    },

    /**
     * Logout — clears stored tokens and resets auth state.
     */
    logout: async () => {
        await clearTokens();
        set({
            user: null,
            token: null,
            isAuthenticated: false,
        });
    },

    /**
     * Hydrate — called on app startup to restore session from secure storage.
     * Checks token expiry before restoring.
     */
    hydrate: async () => {
        try {
            const token = await getAccessToken();
            const userData = await getUserData();

            if (token && userData && !isTokenExpired(token)) {
                set({
                    user: userData as AuthUser,
                    token,
                    isAuthenticated: true,
                    isHydrated: true,
                });
            } else {
                // Token expired or missing — clear stale data
                if (token) {
                    await clearTokens();
                }
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                    isHydrated: true,
                });
            }
        } catch (error) {
            console.error('Auth Hydration Error:', error);
            set({
                user: null,
                token: null,
                isAuthenticated: false,
                isHydrated: true,
            });
        }
    },

    /**
     * Update Guardian Details for current user
     */
    updateGuardianDetails: (details: GuardianDetails) => {
        const currentUser = get().user;
        if (currentUser) {
            const updatedUser: AuthUser = {
                ...currentUser,
                guardianId: currentUser.guardianId || 'G-' + Date.now(),
                guardianDetails: details,
            };
            set({ user: updatedUser });
            saveTokens(get().token || '', updatedUser).catch(err => console.error('Failed saving guardian update', err));
        }
    },
}));
