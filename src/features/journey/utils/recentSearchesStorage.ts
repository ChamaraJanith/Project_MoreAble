// Recent Journey Searches — local persistence, platform-aware.
// Follows the same storage pattern as src/shared/utils/tokenStorage.ts:
// Native (iOS/Android): expo-secure-store
// Web: localStorage (fallback)

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 'moreable_recent_journey_searches';
const MAX_RECENT_SEARCHES = 5;

export interface RecentSearch {
    id: string;
    origin: string;
    destination: string;
    travelDate: string; // 'YYYY-MM-DD', same format the Journey Search API expects
    travelTime: string; // 'HH:MM' (24-hour), same format the Journey Search API expects
    savedAt: number; // epoch ms — used to keep the list ordered most-recent-first
}

export type RecentSearchInput = Pick<RecentSearch, 'origin' | 'destination' | 'travelDate' | 'travelTime'>;

async function readRaw(): Promise<string | null> {
    if (Platform.OS === 'web') {
        return localStorage.getItem(STORAGE_KEY);
    }
    return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeRaw(value: string): Promise<void> {
    if (Platform.OS === 'web') {
        localStorage.setItem(STORAGE_KEY, value);
    } else {
        await SecureStore.setItemAsync(STORAGE_KEY, value);
    }
}

function isSameJourney(a: RecentSearchInput, b: RecentSearchInput): boolean {
    return (
        a.origin.trim().toLowerCase() === b.origin.trim().toLowerCase() &&
        a.destination.trim().toLowerCase() === b.destination.trim().toLowerCase() &&
        a.travelDate === b.travelDate &&
        a.travelTime === b.travelTime
    );
}

/** Returns the stored recent searches, most-recent-first. Never throws. */
export async function getRecentSearches(): Promise<RecentSearch[]> {
    try {
        const raw = await readRaw();
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return (parsed as RecentSearch[]).sort((a, b) => b.savedAt - a.savedAt);
    } catch {
        return [];
    }
}

/**
 * Saves a journey search, moving it to the top of the list. If the exact same
 * origin/destination/date/time was already saved, it is replaced rather than
 * duplicated. The list is capped at MAX_RECENT_SEARCHES. Returns the updated list.
 */
export async function saveRecentSearch(search: RecentSearchInput): Promise<RecentSearch[]> {
    const existing = await getRecentSearches();
    const withoutDuplicate = existing.filter((item) => !isSameJourney(item, search));

    const entry: RecentSearch = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...search,
        savedAt: Date.now(),
    };

    const updated = [entry, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES);

    try {
        await writeRaw(JSON.stringify(updated));
    } catch {
        // Non-critical: recent searches are a convenience feature, so a failed
        // write should not interrupt the user's journey search.
    }

    return updated;
}
