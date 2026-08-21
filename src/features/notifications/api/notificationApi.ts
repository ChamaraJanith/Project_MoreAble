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
