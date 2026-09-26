import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NotificationPreferences } from '../src/entities/notification/model/types';
import { useNotificationPreferencesStore } from '../src/features/notifications/store/notificationPreferencesStore';
import { useAuthStore } from '../src/shared/store/authStore';
import { AppText as Text } from '../src/shared/ui/AppText';

export default function NotificationPreferencesScreen() {
    const { t } = useTranslation();
    const { user } = useAuthStore();
    const userId = user?.passengerId || user?.uid || 'GUEST';

    const {
        preferences,
        isLoading,
        isHydrated,
        isSyncing,
        hydrate,
        fetchPreferences,
        updatePreference,
        resetToDefaults,
    } = useNotificationPreferencesStore();

    const [savedBannerVisible, setSavedBannerVisible] = useState(false);

    useEffect(() => {
        if (!isHydrated) {
            hydrate();
        }
        if (userId && userId !== 'GUEST') {
            fetchPreferences(userId);
        }
    }, [userId]);

    const handleToggle = async <K extends keyof NotificationPreferences>(
        key: K,
        val: NotificationPreferences[K]
    ) => {
        if (key === 'emergencyAlerts') {
            Alert.alert(
                'Safety Critical',
                'Emergency SOS and transit safety alerts cannot be disabled to ensure commuter protection.'
            );
            return;
        }

        const success = await updatePreference(userId, key, val);
        if (success) {
            setSavedBannerVisible(true);
            setTimeout(() => setSavedBannerVisible(false), 2500);
        }
    };

    const handleReset = () => {
        Alert.alert(
            'Reset Notification Preferences',
            'Are you sure you want to reset all alert preferences back to enterprise defaults?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset to Defaults',
                    style: 'destructive',
                    onPress: async () => {
                        await resetToDefaults(userId);
                        setSavedBannerVisible(true);
                        setTimeout(() => setSavedBannerVisible(false), 2500);
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

            {/* Top Navigation Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="arrow-back" size={24} color="#0F172A" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Notification Preferences</Text>
                    <Text style={styles.headerSubtitle}>Manage your transit & safety alerts</Text>
                </View>
                <TouchableOpacity
                    style={styles.resetHeaderButton}
                    onPress={handleReset}
                    accessibilityRole="button"
                    accessibilityLabel="Reset all notification preferences"
                >
                    <Ionicons name="refresh-outline" size={20} color="#0284C7" />
                </TouchableOpacity>
            </View>

            {/* Sync Feedback Toast Banner */}
            {savedBannerVisible && (
                <View style={styles.syncBanner}>
                    <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                    <Text style={styles.syncBannerText}>Preferences saved & synced to cloud</Text>
                </View>
            )}

            {isLoading && !isHydrated ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#0284C7" />
                    <Text style={styles.loadingText}>Loading alert preferences...</Text>
                </View>
            ) : (
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Cloud Sync Status Card */}
                    <View style={styles.statusCard}>
                        <View style={styles.statusIconWrapper}>
                            <Ionicons
                                name={isSyncing ? 'sync-outline' : 'cloud-done-outline'}
                                size={22}
                                color={isSyncing ? '#0284C7' : '#16A34A'}
                            />
                        </View>
                        <View style={styles.statusTextContainer}>
                            <Text style={styles.statusTitle}>
                                {isSyncing ? 'Synchronizing with cloud...' : 'Preferences Active & Synced'}
                            </Text>
                            <Text style={styles.statusSubtitle}>
                                Passenger ID: <Text style={{ fontWeight: '700' }}>{userId}</Text>
                            </Text>
                        </View>
                    </View>

                    {/* Section 1: Journey & Transit Alerts */}
                    <View style={styles.sectionContainer}>
                        <View style={styles.sectionHeaderRow}>
                            <Ionicons name="bus-outline" size={20} color="#0284C7" />
                            <Text style={styles.sectionTitle}>Journey & Transit Alerts</Text>
                        </View>

                        {/* Booking Alerts */}
                        <View style={styles.preferenceRow}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="ticket-outline" size={22} color="#0284C7" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Booking & Ticket Alerts</Text>
                                <Text style={styles.prefDescription}>
                                    Receive reservation confirmations, digital receipts, and seat allocations.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.bookingAlerts}
                                onValueChange={(val) => handleToggle('bookingAlerts', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.bookingAlerts ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle booking alerts"
                                accessibilityRole="switch"
                            />
                        </View>

                        {/* Boarding Reminders */}
                        <View style={styles.preferenceRow}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="time-outline" size={22} color="#D97706" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Boarding Reminders</Text>
                                <Text style={styles.prefDescription}>
                                    Get departure countdowns and 15-minute platform calls prior to bus departure.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.boardingReminders}
                                onValueChange={(val) => handleToggle('boardingReminders', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.boardingReminders ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle boarding reminders"
                                accessibilityRole="switch"
                            />
                        </View>

                        {/* Vehicle Arrival Alerts */}
                        <View style={styles.preferenceRow}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="navigate-outline" size={22} color="#16A34A" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Vehicle Arrival Alerts</Text>
                                <Text style={styles.prefDescription}>
                                    Real-time ETA notifications when your bus approaches your pickup stop (~2 km).
                                </Text>
                            </View>
                            <Switch
                                value={preferences.arrivalAlerts}
                                onValueChange={(val) => handleToggle('arrivalAlerts', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.arrivalAlerts ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle vehicle arrival alerts"
                                accessibilityRole="switch"
                            />
                        </View>

                        {/* Destination Reminders */}
                        <View style={[styles.preferenceRow, { borderBottomWidth: 0 }]}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="location-outline" size={22} color="#DC2626" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Destination Reminders</Text>
                                <Text style={styles.prefDescription}>
                                    Upcoming drop-off halt reminders so you can prepare to safely alight.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.destinationReminders}
                                onValueChange={(val) => handleToggle('destinationReminders', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.destinationReminders ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle destination reminders"
                                accessibilityRole="switch"
                            />
                        </View>
                    </View>

                    {/* Section 2: Safety & Caregiver Protection */}
                    <View style={styles.sectionContainer}>
                        <View style={styles.sectionHeaderRow}>
                            <Ionicons name="shield-checkmark-outline" size={20} color="#7C3AED" />
                            <Text style={styles.sectionTitle}>Safety & Guardian Synchronization</Text>
                        </View>

                        {/* Caregiver Updates */}
                        <View style={styles.preferenceRow}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="people-outline" size={22} color="#7C3AED" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Caregiver Journey Sync</Text>
                                <Text style={styles.prefDescription}>
                                    Automatically notify paired family guardians when you board and reach your destination.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.caregiverUpdates}
                                onValueChange={(val) => handleToggle('caregiverUpdates', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.caregiverUpdates ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle caregiver updates"
                                accessibilityRole="switch"
                            />
                        </View>

                        {/* Emergency SOS Alerts (LOCKED) */}
                        <View style={[styles.preferenceRow, styles.lockedRow, { borderBottomWidth: 0 }]}>
                            <View style={[styles.prefIconBox, { backgroundColor: '#FEE2E2' }]}>
                                <Ionicons name="warning-outline" size={22} color="#DC2626" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <View style={styles.titleWithBadgeRow}>
                                    <Text style={styles.prefTitle}>Emergency SOS Broadcasts</Text>
                                    <View style={styles.mandatoryBadge}>
                                        <Text style={styles.mandatoryBadgeText}>LOCKED ON</Text>
                                    </View>
                                </View>
                                <Text style={styles.prefDescription}>
                                    Safety-critical SOS beacons and urgent security broadcasts cannot be disabled.
                                </Text>
                            </View>
                            <Switch
                                value={true}
                                disabled={true}
                                trackColor={{ false: '#CBD5E1', true: '#FCA5A5' }}
                                thumbColor="#DC2626"
                                accessibilityLabel="Emergency alerts are permanently active"
                                accessibilityRole="switch"
                            />
                        </View>
                    </View>

                    {/* Section 3: Delivery Channels */}
                    <View style={styles.sectionContainer}>
                        <View style={styles.sectionHeaderRow}>
                            <Ionicons name="notifications-outline" size={20} color="#0F172A" />
                            <Text style={styles.sectionTitle}>Notification Delivery Channels</Text>
                        </View>

                        {/* Push Notifications */}
                        <View style={styles.preferenceRow}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="phone-portrait-outline" size={22} color="#0F172A" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Mobile Push Notifications</Text>
                                <Text style={styles.prefDescription}>
                                    Deliver high-priority pop-up alerts directly to your phone lock screen.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.pushEnabled !== false}
                                onValueChange={(val) => handleToggle('pushEnabled', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.pushEnabled !== false ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle mobile push notifications"
                                accessibilityRole="switch"
                            />
                        </View>

                        {/* Email Receipts */}
                        <View style={styles.preferenceRow}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="mail-outline" size={22} color="#0F172A" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>Email Receipts & E-Tickets</Text>
                                <Text style={styles.prefDescription}>
                                    Send HTML receipts and journey vouchers to your registered email address.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.emailAlerts !== false}
                                onValueChange={(val) => handleToggle('emailAlerts', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.emailAlerts !== false ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle email receipts"
                                accessibilityRole="switch"
                            />
                        </View>

                        {/* SMS Text Messages */}
                        <View style={[styles.preferenceRow, { borderBottomWidth: 0 }]}>
                            <View style={styles.prefIconBox}>
                                <Ionicons name="chatbox-ellipses-outline" size={22} color="#0F172A" />
                            </View>
                            <View style={styles.prefTextBox}>
                                <Text style={styles.prefTitle}>SMS Text Alerts</Text>
                                <Text style={styles.prefDescription}>
                                    SMS dispatches for spot walk-in ticketing and critical boarding milestones.
                                </Text>
                            </View>
                            <Switch
                                value={preferences.smsAlerts !== false}
                                onValueChange={(val) => handleToggle('smsAlerts', val)}
                                trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                                thumbColor={preferences.smsAlerts !== false ? '#0284C7' : '#94A3B8'}
                                accessibilityLabel="Toggle SMS alerts"
                                accessibilityRole="switch"
                            />
                        </View>
                    </View>

                    {/* Reset Button */}
                    <TouchableOpacity
                        style={styles.resetFullButton}
                        onPress={handleReset}
                        accessibilityRole="button"
                        accessibilityLabel="Reset all notification preferences to defaults"
                    >
                        <Ionicons name="refresh-outline" size={20} color="#DC2626" />
                        <Text style={styles.resetFullButtonText}>Reset All Preferences to Defaults</Text>
                    </TouchableOpacity>

                    <View style={styles.footerSpacing} />
                </ScrollView>
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
        paddingHorizontal: 20,
        paddingVertical: 14,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    backButton: {
        padding: 6,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
    },
    headerTitleContainer: {
        flex: 1,
        marginLeft: 14,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0F172A',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    resetHeaderButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: '#F0F9FF',
    },
    syncBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#DCFCE7',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#BBF7D0',
    },
    syncBannerText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#166534',
        marginLeft: 8,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    loadingText: {
        fontSize: 14,
        color: '#64748B',
        marginTop: 12,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    statusCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        ...Platform.select({
            ios: {
                shadowColor: '#0F172A',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.04,
                shadowRadius: 6,
            },
            android: { elevation: 2 },
        }),
    },
    statusIconWrapper: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F0FDF4',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    statusTextContainer: {
        flex: 1,
    },
    statusTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },
    statusSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    sectionContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        ...Platform.select({
            ios: {
                shadowColor: '#0F172A',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.04,
                shadowRadius: 6,
            },
            android: { elevation: 2 },
        }),
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
        marginLeft: 8,
    },
    preferenceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    lockedRow: {
        backgroundColor: '#FFF5F5',
        marginHorizontal: -8,
        paddingHorizontal: 8,
        borderRadius: 12,
    },
    prefIconBox: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    prefTextBox: {
        flex: 1,
        marginRight: 10,
    },
    titleWithBadgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    prefTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1E293B',
    },
    mandatoryBadge: {
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 6,
    },
    mandatoryBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#DC2626',
    },
    prefDescription: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 3,
        lineHeight: 17,
    },
    resetFullButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FEF2F2',
        borderRadius: 14,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#FECACA',
        marginTop: 8,
    },
    resetFullButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#DC2626',
        marginLeft: 8,
    },
    footerSpacing: {
        height: 40,
    },
});
