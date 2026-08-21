import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthStore } from '../../../shared/store/authStore';
import { useNotificationStore } from '../../../shared/store/notificationStore';

interface NotificationHeaderIconProps {
    color?: string;
    size?: number;
}

export const NotificationHeaderIcon: React.FC<NotificationHeaderIconProps> = ({
    color = '#0F172A',
    size = 24,
}) => {
    const router = useRouter();
    const { user } = useAuthStore();
    const userId = user?.passengerId || user?.uid || 'GUEST';

    const { unreadCount, fetchNotifications } = useNotificationStore();

    useEffect(() => {
        let isMounted = true;

        const load = async () => {
            if (isMounted) {
                await fetchNotifications(userId);
            }
        };

        load();

        const interval = setInterval(load, 15000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [userId, fetchNotifications]);

    const handlePress = () => {
        router.push('/(tabs)/notifications' as any);
    };

    return (
        <TouchableOpacity
            style={styles.container}
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={`Notifications. ${unreadCount} unread`}
        >
            <Ionicons name="notifications-outline" size={size} color={color} />
            {unreadCount > 0 && (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </Text>
                </View>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: 6,
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
    },
    badge: {
        position: 'absolute',
        top: 2,
        right: 2,
        backgroundColor: '#EF4444',
        borderRadius: 10,
        minWidth: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 1.5,
        borderColor: '#FFFFFF',
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '800',
    },
});
