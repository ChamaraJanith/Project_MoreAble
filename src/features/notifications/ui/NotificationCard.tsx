import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Notification } from '../../../entities/notification/model/types';
import { markNotificationAsRead } from '../api/notificationApi';

interface NotificationCardProps {
    notification: Notification;
    onStatusChange?: (updatedId: string) => void;
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
    notification,
    onStatusChange,
}) => {
    const router = useRouter();
    const isUnread = notification.status === 'UNREAD';
    const isBoardingReminder = notification.type === 'BOARDING_REMINDER';
    const { details } = notification;

    const handlePress = async () => {
        if (isUnread) {
            try {
                if (onStatusChange) {
                    await onStatusChange(notification.id);
                } else {
                    await markNotificationAsRead(notification.id);
                }
            } catch (err) {
                console.error('Failed to mark notification as read:', err);
            }
        }

        // Navigate to booking ticket screen if bookingId is available
        if (notification.bookingId) {
            router.push(`/(tabs)/booking/ticket/${notification.bookingId}` as any);
        }
    };

    const formatDate = (isoString?: string) => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return isoString;
        }
    };

    return (
        <TouchableOpacity
            style={[
                styles.card,
                isUnread
                    ? isBoardingReminder
                        ? styles.cardReminderUnread
                        : styles.cardUnread
                    : styles.cardRead,
            ]}
            onPress={handlePress}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Notification: ${notification.title}`}
        >
            <View style={styles.headerRow}>
                <View style={styles.titleContainer}>
                    <View
                        style={[
                            styles.iconBadge,
                            isUnread
                                ? isBoardingReminder
                                    ? styles.iconBadgeReminderUnread
                                    : styles.iconBadgeUnread
                                : styles.iconBadgeRead,
                        ]}
                    >
                        <Ionicons
                            name={isBoardingReminder ? 'alarm-outline' : 'checkmark-circle-outline'}
                            size={20}
                            color={
                                isBoardingReminder
                                    ? isUnread
                                        ? '#D97706'
                                        : '#92400E'
                                    : isUnread
                                    ? '#0066CC'
                                    : '#64748B'
                            }
                        />
                    </View>
                    <View style={styles.titleTextContainer}>
                        <Text
                            style={[
                                styles.title,
                                isUnread && (isBoardingReminder ? styles.textReminderBold : styles.textBold),
                            ]}
                        >
                            {notification.title}
                        </Text>
                        <Text style={styles.timestamp}>{formatDate(notification.createdAt)}</Text>
                    </View>
                </View>

                {isUnread && (
                    <View
                        style={[
                            styles.unreadIndicatorContainer,
                            isBoardingReminder && styles.unreadIndicatorReminder,
                        ]}
                    >
                        <View style={styles.unreadDot} />
                        <Text style={styles.unreadTag}>NEW</Text>
                    </View>
                )}
            </View>

            <Text style={styles.message}>{notification.message}</Text>

            {/* Core Snapshot Details Chips */}
            {details && (
                <View style={styles.snapshotContainer}>
                    <View style={styles.chipRow}>
                        <View style={styles.chip}>
                            <Ionicons name="ticket-outline" size={13} color={isBoardingReminder ? '#D97706' : '#0066CC'} />
                            <Text style={styles.chipLabel}>ID:</Text>
                            <Text style={styles.chipValue}>{details.bookingId || notification.bookingId}</Text>
                        </View>

                        <View style={styles.chip}>
                            <Ionicons name="bus-outline" size={13} color={isBoardingReminder ? '#D97706' : '#0066CC'} />
                            <Text style={styles.chipLabel}>Vehicle:</Text>
                            <Text style={styles.chipValue}>{details.vehicleNumber}</Text>
                        </View>
                    </View>

                    <View style={styles.chipRow}>
                        <View style={styles.chip}>
                            <Ionicons name="navigate-outline" size={13} color={isBoardingReminder ? '#D97706' : '#0066CC'} />
                            <Text style={styles.chipLabel}>Route:</Text>
                            <Text style={styles.chipValue}>
                                {details.routeNumber} ({details.routeName})
                            </Text>
                        </View>
                    </View>

                    <View style={styles.chipRow}>
                        <View style={styles.chip}>
                            <Ionicons name="location-outline" size={13} color={isBoardingReminder ? '#D97706' : '#0066CC'} />
                            <Text style={styles.chipLabel}>Boarding:</Text>
                            <Text style={styles.chipValue}>{details.startLocation}</Text>
                        </View>

                        <View style={styles.chip}>
                            <Ionicons name="accessibility-outline" size={13} color={isBoardingReminder ? '#D97706' : '#0066CC'} />
                            <Text style={styles.chipLabel}>Seat:</Text>
                            <Text style={styles.chipValue}>{details.seatNumber}</Text>
                        </View>
                    </View>

                    <View style={styles.chipRow}>
                        <View style={styles.chip}>
                            <Ionicons name="time-outline" size={13} color={isBoardingReminder ? '#D97706' : '#0066CC'} />
                            <Text style={styles.chipLabel}>Departure Time:</Text>
                            <Text style={styles.chipValue}>
                                {details.journeyDate} ({details.journeyTime})
                            </Text>
                        </View>
                    </View>
                </View>
            )}

            <View style={styles.footerRow}>
                <Text style={[styles.tapPrompt, isBoardingReminder && styles.tapPromptReminder]}>
                    Tap to view reservation ticket
                </Text>
                <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={isBoardingReminder ? '#D97706' : '#0066CC'}
                />
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 14,
        padding: 16,
        marginVertical: 6,
        marginHorizontal: 16,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },
    cardUnread: {
        backgroundColor: '#F0F7FF',
        borderColor: '#BAE6FD',
    },
    cardReminderUnread: {
        backgroundColor: '#FFFBEB',
        borderColor: '#FDE68A',
    },
    cardRead: {
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    iconBadgeUnread: {
        backgroundColor: '#E0F2FE',
    },
    iconBadgeReminderUnread: {
        backgroundColor: '#FEF3C7',
    },
    iconBadgeRead: {
        backgroundColor: '#F1F5F9',
    },
    titleTextContainer: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        color: '#0F172A',
        fontWeight: '600',
    },
    textBold: {
        fontWeight: '700',
        color: '#0369A1',
    },
    textReminderBold: {
        fontWeight: '700',
        color: '#B45309',
    },
    timestamp: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    unreadIndicatorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0284C7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
    },
    unreadIndicatorReminder: {
        backgroundColor: '#D97706',
    },
    unreadDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#FFFFFF',
        marginRight: 4,
    },
    unreadTag: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '700',
    },
    message: {
        fontSize: 14,
        color: '#334155',
        lineHeight: 20,
        marginBottom: 12,
    },
    snapshotContainer: {
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        padding: 10,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 6,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        marginRight: 4,
    },
    chipLabel: {
        fontSize: 11,
        color: '#64748B',
        marginLeft: 4,
        marginRight: 2,
    },
    chipValue: {
        fontSize: 11,
        color: '#0F172A',
        fontWeight: '600',
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 4,
    },
    tapPrompt: {
        fontSize: 12,
        color: '#0066CC',
        fontWeight: '600',
    },
    tapPromptReminder: {
        color: '#D97706',
    },
});
