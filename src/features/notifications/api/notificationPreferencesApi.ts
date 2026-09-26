import { API_BASE_URL } from '../../../shared/api/config';
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    NotificationPreferences,
    normalizeNotificationPreferences,
} from '../../../entities/notification/model/types';

export interface NotificationPreferencesApiResponse {
    success: boolean;
    userId?: string;
    message?: string;
    preferences: NotificationPreferences;
    isDefault?: boolean;
}

/**
 * Fetches the user's notification preferences from the backend API.
 */
export async function getNotificationPreferencesApi(
    userId: string
): Promise<NotificationPreferencesApiResponse> {
    if (!userId || !userId.trim()) {
        return {
            success: true,
            preferences: DEFAULT_NOTIFICATION_PREFERENCES,
            isDefault: true,
        };
    }

    try {
        const url = `${API_BASE_URL}/api/notifications/preferences?userId=${encodeURIComponent(userId.trim())}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || `Failed to fetch preferences (HTTP ${res.status})`);
        }

        const data = await res.json();
        return {
            success: true,
            userId: data.userId || userId,
            preferences: normalizeNotificationPreferences(data.preferences),
            isDefault: Boolean(data.isDefault),
        };
    } catch (err: any) {
        console.warn('[NotificationPreferencesApi] getNotificationPreferences failed, returning defaults:', err?.message);
        return {
            success: false,
            message: err?.message,
            preferences: DEFAULT_NOTIFICATION_PREFERENCES,
            isDefault: true,
        };
    }
}

/**
 * Saves/updates user notification preferences in the backend API.
 */
export async function saveNotificationPreferencesApi(
    userId: string,
    preferences: Partial<NotificationPreferences>
): Promise<NotificationPreferencesApiResponse> {
    if (!userId || !userId.trim()) {
        throw new Error('User ID is required to save notification preferences.');
    }

    const payload = {
        userId: userId.trim(),
        preferences: normalizeNotificationPreferences(preferences),
    };

    const url = `${API_BASE_URL}/api/notifications/preferences`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to save preferences (HTTP ${res.status})`);
    }

    const data = await res.json();
    return {
        success: true,
        userId: data.userId || userId,
        message: data.message,
        preferences: normalizeNotificationPreferences(data.preferences),
        isDefault: false,
    };
}
