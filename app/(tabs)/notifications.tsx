import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Notification } from '../../src/entities/notification/model/types';
import { NotificationCard } from '../../src/features/notifications/ui/NotificationCard';
import { useAuthStore } from '../../src/shared/store/authStore';
import { useNotificationStore } from '../../src/shared/store/notificationStore';

type FilterTab = 'ALL' | 'UNREAD' | 'READ';

export default function NotificationsTabScreen() {
    const router = useRouter();
    const { user } = useAuthStore();
    const userId = user?.passengerId || user?.uid || 'GUEST';

    const { notifications, unreadCount, fetchNotifications, markAsRead, markAllAsRead } =
        useNotificationStore();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

    const loadNotifications = useCallback(async () => {
        try {
            await fetchNotifications(userId);
        } catch (err) {
            console.error('Error loading notifications:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [userId, fetchNotifications]);

    useFocusEffect(
        useCallback(() => {
            loadNotifications();
        }, [loadNotifications])
    );

    const handleRefresh = () => {
        setRefreshing(true);
        loadNotifications();
    };

    const handleStatusChange = (updatedId: string) => {
        markAsRead(updatedId);
    };

    const handleMarkAllAsRead = async () => {
        await markAllAsRead(userId);
    };

    const filteredNotifications = notifications.filter((n) => {
        if (activeTab === 'UNREAD') return n.status === 'UNREAD';
        if (activeTab === 'READ') return n.status === 'READ';
        return true;
    });

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

            {/* Header Bar */}
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Text style={styles.headerTitle}>Notifications</Text>
                    {unreadCount > 0 && (
                        <View style={styles.unreadCounterBadge}>
                            <Text style={styles.unreadCounterText}>{unreadCount} new</Text>
                        </View>
                    )}
                </View>

                {unreadCount > 0 && (
                    <TouchableOpacity
                        style={styles.markAllButton}
                        onPress={handleMarkAllAsRead}
                        accessibilityRole="button"
                        accessibilityLabel="Mark all notifications as read"
                    >
                        <Text style={styles.markAllText}>Mark read</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Filter Tabs */}
            <View style={styles.tabsContainer}>
                {(['ALL', 'UNREAD', 'READ'] as FilterTab[]).map((tab) => (
                    <TouchableOpacity
                        key={tab}
                        style={[styles.tab, activeTab === tab && styles.tabActive]}
                        onPress={() => setActiveTab(tab)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: activeTab === tab }}
                    >
                        <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                            {tab === 'ALL' ? 'All' : tab === 'UNREAD' ? `Unread (${unreadCount})` : 'Read'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Main Content */}
            {loading && !refreshing ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color="#0066CC" />
                    <Text style={styles.loadingText}>Loading notifications...</Text>
                </View>
            ) : (
                <FlatList
                    data={filteredNotifications}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <NotificationCard
                            notification={item}
                            onStatusChange={handleStatusChange}
                        />
                    )}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            colors={['#0066CC']}
                        />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIconContainer}>
                                <Ionicons name="notifications-off-outline" size={48} color="#94A3B8" />
                            </View>
                            <Text style={styles.emptyTitle}>No notifications found</Text>
                            <Text style={styles.emptySubtitle}>
                                {activeTab === 'UNREAD'
                                    ? 'You have no unread notifications.'
                                    : activeTab === 'READ'
                                    ? 'No read notifications to show.'
                                    : 'Your booking confirmations and alerts will appear here.'}
                            </Text>
                        </View>
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
    },
    unreadCounterBadge: {
        backgroundColor: '#0284C7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
    },
    unreadCounterText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
    },
    markAllButton: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: '#F1F5F9',
        borderRadius: 8,
    },
    markAllText: {
        fontSize: 13,
        color: '#0066CC',
        fontWeight: '600',
    },
    tabsContainer: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
        gap: 10,
    },
    tab: {
        paddingVertical: 6,
        paddingHorizontal: 16,
        borderRadius: 20,
        backgroundColor: '#F1F5F9',
    },
    tabActive: {
        backgroundColor: '#0066CC',
    },
    tabText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
    },
    tabTextActive: {
        color: '#FFFFFF',
    },
    listContent: {
        paddingVertical: 8,
        flexGrow: 1,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        fontSize: 14,
        color: '#64748B',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingTop: 80,
    },
    emptyIconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1E293B',
        marginBottom: 6,
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 20,
    },
});
