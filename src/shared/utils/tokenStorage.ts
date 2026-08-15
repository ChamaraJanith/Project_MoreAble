// Secure Token Storage — Platform-aware
// Native (iOS/Android): expo-secure-store (encrypted keychain/keystore)
// Web: localStorage (fallback)

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEYS = {
    ACCESS_TOKEN: 'moreable_access_token',
    USER_DATA: 'moreable_user_data',
} as const;

/**
 * Save the JWT access token and user data to secure storage.
 */
export async function saveTokens(
    accessToken: string,
    userData: Record<string, any>
): Promise<void> {
    const userDataStr = JSON.stringify(userData);

    if (Platform.OS === 'web') {
        localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
        localStorage.setItem(KEYS.USER_DATA, userDataStr);
    } else {
        await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken);
        await SecureStore.setItemAsync(KEYS.USER_DATA, userDataStr);
    }
}

/**
 * Retrieve the stored JWT access token.
 * Returns null if no token is stored.
 */
export async function getAccessToken(): Promise<string | null> {
    if (Platform.OS === 'web') {
        return localStorage.getItem(KEYS.ACCESS_TOKEN);
    }
    return SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
}

/**
 * Retrieve the stored user data.
 * Returns null if no user data is stored.
 */
export async function getUserData(): Promise<Record<string, any> | null> {
    let raw: string | null = null;

    if (Platform.OS === 'web') {
        raw = localStorage.getItem(KEYS.USER_DATA);
    } else {
        raw = await SecureStore.getItemAsync(KEYS.USER_DATA);
    }

    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Clear all stored auth tokens and user data (logout).
 */
export async function clearTokens(): Promise<void> {
    if (Platform.OS === 'web') {
        localStorage.removeItem(KEYS.ACCESS_TOKEN);
        localStorage.removeItem(KEYS.USER_DATA);
    } else {
        await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN);
        await SecureStore.deleteItemAsync(KEYS.USER_DATA);
    }
}

/**
 * Check if a JWT token is expired by decoding its payload (without verification).
 * This is a client-side convenience check — actual verification happens server-side.
 */
export function isTokenExpired(token: string): boolean {
    try {
        const payloadBase64 = token.split('.')[1];
        if (!payloadBase64) return true;

        const payloadJson = atob(payloadBase64);
        const payload = JSON.parse(payloadJson);

        if (!payload.exp) return true;

        // exp is in seconds, Date.now() is in milliseconds
        const expiryMs = payload.exp * 1000;
        return Date.now() >= expiryMs;
    } catch {
        return true;
    }
}
