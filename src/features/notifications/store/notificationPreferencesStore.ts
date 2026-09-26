import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    NotificationPreferences,
    normalizeNotificationPreferences,
} from '../../../entities/notification/model/types';
import {
    getNotificationPreferencesApi,
    saveNotificationPreferencesApi,
} from '../api/notificationPreferencesApi';

const NOTIF_PREFS_STORAGE_KEY = 'moreable_notification_preferences_v1';

interface NotificationPreferencesState {
    preferences: NotificationPreferences;
    isLoading: boolean;
    isHydrated: boolean;
    isSyncing: boolean;
    lastSyncedAt: string | null;
    error: string | null;

    /** Load persisted preferences from local device storage */
    hydrate: () => Promise<void>;

    /** Fetch preferences from backend for a specific user and sync local state */
    fetchPreferences: (userId: string) => Promise<void>;

    /** Save complete preferences payload to cloud and local storage */
    savePreferences: (userId: string, prefs: Partial<NotificationPreferences>) => Promise<boolean>;

    /** Optimistically update a single preference toggle with cloud sync */
    updatePreference: <K extends keyof NotificationPreferences>(
        userId: string,
        key: K,
        value: NotificationPreferences[K]
    ) => Promise<boolean>;

    /** Reset preferences to default values */
    resetToDefaults: (userId: string) => Promise<boolean>;
}

async function readFromStorage(): Promise<NotificationPreferences | null> {
    try {
        let raw: string | null = null;
        if (Platform.OS === 'web') {
            raw = typeof localStorage !== 'undefined' ? localStorage.getItem(NOTIF_PREFS_STORAGE_KEY) : null;
        } else {
            raw = await SecureStore.getItemAsync(NOTIF_PREFS_STORAGE_KEY);
        }
        if (!raw) return null;
        return normalizeNotificationPreferences(JSON.parse(raw));
    } catch {
        return null;
    }
}

async function writeToStorage(prefs: NotificationPreferences): Promise<void> {
    try {
        const raw = JSON.stringify(prefs);
        if (Platform.OS === 'web') {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(NOTIF_PREFS_STORAGE_KEY, raw);
            }
        } else {
            await SecureStore.setItemAsync(NOTIF_PREFS_STORAGE_KEY, raw);
        }
    } catch (err) {
        console.warn('[NotificationPreferencesStore] Failed to write to local storage:', err);
    }
}

export const useNotificationPreferencesStore = create<NotificationPreferencesState>((set, get) => ({
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    isLoading: false,
    isHydrated: false,
    isSyncing: false,
    lastSyncedAt: null,
    error: null,

    hydrate: async () => {
        const stored = await readFromStorage();
        const finalPrefs = normalizeNotificationPreferences(stored);
        set({
            preferences: finalPrefs,
            isHydrated: true,
        });
    },

    fetchPreferences: async (userId: string) => {
        if (!userId || userId === 'GUEST') {
            const local = await readFromStorage();
            set({
                preferences: normalizeNotificationPreferences(local),
                isLoading: false,
                isHydrated: true,
            });
            return;
        }

        set({ isLoading: true, error: null });
        try {
            const res = await getNotificationPreferencesApi(userId);
            const normalized = normalizeNotificationPreferences(res.preferences);
            await writeToStorage(normalized);
            set({
                preferences: normalized,
                isLoading: false,
                isHydrated: true,
                lastSyncedAt: new Date().toISOString(),
                error: null,
            });
        } catch (err: any) {
            console.warn('[NotificationPreferencesStore] fetchPreferences error:', err?.message);
            set({
                isLoading: false,
                error: err?.message || 'Failed to fetch preferences from server',
            });
        }
    },

    savePreferences: async (userId: string, prefs: Partial<NotificationPreferences>) => {
        const normalized = normalizeNotificationPreferences({
            ...get().preferences,
            ...prefs,
        });

        // Optimistic local update
        set({ preferences: normalized, isSyncing: true, error: null });
        await writeToStorage(normalized);

        if (!userId || userId === 'GUEST') {
            set({ isSyncing: false, lastSyncedAt: new Date().toISOString() });
            return true;
        }

        try {
            const res = await saveNotificationPreferencesApi(userId, normalized);
            const serverNormalized = normalizeNotificationPreferences(res.preferences);
            await writeToStorage(serverNormalized);
            set({
                preferences: serverNormalized,
                isSyncing: false,
                lastSyncedAt: new Date().toISOString(),
                error: null,
            });
            return true;
        } catch (err: any) {
            console.error('[NotificationPreferencesStore] savePreferences sync failed:', err?.message);
            set({
                isSyncing: false,
                error: err?.message || 'Failed to sync preferences to cloud',
            });
            return false;
        }
    },

    updatePreference: async <K extends keyof NotificationPreferences>(
        userId: string,
        key: K,
        value: NotificationPreferences[K]
    ) => {
        // STRICT RULE: emergencyAlerts cannot be toggled to false
        if (key === 'emergencyAlerts' && value === false) {
            return false;
        }

        const updated = {
            ...get().preferences,
            [key]: value,
        };
        return get().savePreferences(userId, updated);
    },

    resetToDefaults: async (userId: string) => {
        return get().savePreferences(userId, DEFAULT_NOTIFICATION_PREFERENCES);
    },
}));
