import { create } from 'zustand';
import { Notification } from '../../entities/notification/model/types';
import { fetchUserNotifications, markNotificationAsRead } from '../../features/notifications/api/notificationApi';

interface NotificationState {
    notifications: Notification[];
    unreadCount: number;
    isLoading: boolean;
    fetchNotifications: (userId: string) => Promise<void>;
    markAsRead: (notificationId: string) => Promise<void>;
    markAllAsRead: (userId: string) => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
    notifications: [],
    unreadCount: 0,
    isLoading: false,

    fetchNotifications: async (userId: string) => {
        set({ isLoading: true });
        try {
            const { notifications, unreadCount } = await fetchUserNotifications(userId);
            set({ notifications, unreadCount, isLoading: false });
        } catch (error) {
            console.error('Error fetching notifications in store:', error);
            set({ isLoading: false });
        }
    },

    markAsRead: async (notificationId: string) => {
        const current = get().notifications;
        const updated = current.map((n) =>
            n.id === notificationId || n.notificationId === notificationId
                ? { ...n, status: 'READ' as const, readAt: new Date().toISOString() }
                : n
        );
        const newUnreadCount = updated.filter((n) => n.status === 'UNREAD').length;

        // Update state optimistically immediately
        set({ notifications: updated, unreadCount: newUnreadCount });

        // Perform server write
        await markNotificationAsRead(notificationId);
    },

    markAllAsRead: async (userId: string) => {
        const current = get().notifications;
        const unreadItems = current.filter((n) => n.status === 'UNREAD');
        if (unreadItems.length === 0) return;

        const updated = current.map((n) => ({
            ...n,
            status: 'READ' as const,
            readAt: new Date().toISOString(),
        }));
        set({ notifications: updated, unreadCount: 0 });

        await Promise.all(
            unreadItems.map((n) => markNotificationAsRead(n.id || n.notificationId))
        );
    },
}));
