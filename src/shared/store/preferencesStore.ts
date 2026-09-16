// Preferences Store — Zustand state management for App Accessibility & UI Preferences
// Persists locally using expo-secure-store (native) or localStorage (web).
// Fully independent of auth state — preferences survive logout/login.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { AppPreferences } from '../../entities/user/model/types';
import i18n from '../i18n';

const PREFS_STORAGE_KEY = 'moreable_app_preferences';

export const DEFAULT_PREFERENCES: AppPreferences = {
    textSize: 'default',
    highContrast: false,
    voiceGuidance: false,
    voiceDestinationReminders: false,
    notificationVibration: true,
    notificationSound: true,
    simpleMode: false,
    language: 'english',
};

interface PreferencesState {
    preferences: AppPreferences;
    isHydrated: boolean;

    /** Load persisted preferences from storage (call on app startup). */
    hydrate: () => Promise<void>;

    /** Persist a full preferences object to storage and update state. */
    savePreferences: (prefs: AppPreferences) => Promise<void>;

    /** Merge a single key-value preference update into storage and state. */
    updatePreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => Promise<void>;

    /** Reset all preferences to defaults. */
    resetPreferences: () => Promise<void>;
}

async function readFromStorage(): Promise<AppPreferences | null> {
    try {
        let raw: string | null = null;
        if (Platform.OS === 'web') {
            raw = localStorage.getItem(PREFS_STORAGE_KEY);
        } else {
            raw = await SecureStore.getItemAsync(PREFS_STORAGE_KEY);
        }
        if (!raw) return null;
        return JSON.parse(raw) as AppPreferences;
    } catch {
        return null;
    }
}

async function writeToStorage(prefs: AppPreferences): Promise<void> {
    const raw = JSON.stringify(prefs);
    if (Platform.OS === 'web') {
        localStorage.setItem(PREFS_STORAGE_KEY, raw);
    } else {
        await SecureStore.setItemAsync(PREFS_STORAGE_KEY, raw);
    }
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
    preferences: { ...DEFAULT_PREFERENCES },
    isHydrated: false,

    hydrate: async () => {
        const stored = await readFromStorage();
        const finalPrefs = stored ? { ...DEFAULT_PREFERENCES, ...stored } : { ...DEFAULT_PREFERENCES };
        
        // Sync language with i18n on startup
        if (finalPrefs.language) {
            i18n.changeLanguage(finalPrefs.language === 'sinhala' ? 'si' : 'en');
        }

        set({
            preferences: finalPrefs,
            isHydrated: true,
        });
    },

    savePreferences: async (prefs: AppPreferences) => {
        const merged = { ...DEFAULT_PREFERENCES, ...prefs };
        await writeToStorage(merged);
        
        if (merged.language) {
            i18n.changeLanguage(merged.language === 'sinhala' ? 'si' : 'en');
        }
        
        set({ preferences: merged });
    },

    updatePreference: async <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
        const updated: AppPreferences = { ...get().preferences, [key]: value };
        await writeToStorage(updated);
        
        if (key === 'language') {
            i18n.changeLanguage(value === 'sinhala' ? 'si' : 'en');
        }

        set({ preferences: updated });
    },

    resetPreferences: async () => {
        await writeToStorage({ ...DEFAULT_PREFERENCES });
        i18n.changeLanguage(DEFAULT_PREFERENCES.language === 'sinhala' ? 'si' : 'en');
        set({ preferences: { ...DEFAULT_PREFERENCES } });
    },
}));
