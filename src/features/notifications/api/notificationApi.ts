import { Notification } from '../../../entities/notification/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

export async function fetchUserNotifications(userId: string): Promise<{
    notifications: Notification[];
    unreadCount: number;
}> {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/notifications?userId=${encodeURIComponent(userId)}`
        );
        const data = await response.json();
        if (data.success && Array.isArray(data.notifications)) {
            return {
                notifications: data.notifications,
                unreadCount: typeof data.unreadCount === 'number' ? data.unreadCount : 0,
            };
        }
        return { notifications: [], unreadCount: 0 };
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return { notifications: [], unreadCount: 0 };
    }
}

export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/notifications/${encodeURIComponent(notificationId)}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'READ' }),
            }
        );
        const data = await response.json();
        return !!data.success;
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return false;
    }
}

/**
 * Registers an Expo Push Token with the backend.
 */
export async function registerDevicePushToken(params: {
    userId: string;
    pushToken: string;
    devicePlatform?: string;
    deviceModel?: string;
    appVersion?: string;
    notificationsEnabled?: boolean;
}): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications/register-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await response.json();
        return !!data.success;
    } catch (error) {
        console.error('Error registering device push token:', error);
        return false;
    }
}

/**
 * Unregisters a push token on user logout.
 */
export async function unregisterDevicePushToken(params: {
    userId?: string;
    pushToken?: string;
}): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications/register-token`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        const data = await response.json();
        return !!data.success;
    } catch (error) {
        console.error('Error unregistering device push token:', error);
        return false;
    }
}

/**
 * Retrieves push token registration status.
 */
export async function getRegisteredPushTokenStatus(userId: string): Promise<{
    isRegistered: boolean;
    tokens?: any[];
}> {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/notifications/register-token?userId=${encodeURIComponent(userId)}`
        );
        const data = await response.json();
        return {
            isRegistered: !!data.isRegistered,
            tokens: data.tokens || [],
        };
    } catch (error) {
        console.error('Error checking push token status:', error);
        return { isRegistered: false };
    }
}

