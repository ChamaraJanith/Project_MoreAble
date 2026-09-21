import { AppText as Text } from '../../../src/shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    RefreshControl,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { Booking } from '../../../src/entities/booking/model/types';
import { ActivityJourneyCard } from '../../../src/features/activities/ui/ActivityJourneyCard';
import { completedJourneyHref, ongoingJourneyHref } from '../../../src/features/activities/utils/activityRoutes';
import { groupActivities } from '../../../src/features/activities/utils/activityStatus';
import { getBookingHistory } from '../../../src/features/booking/api/bookingApi';
import { useAuthStore } from '../../../src/shared/store/authStore';

type ActivityTab = 'ONGOING' | 'COMPLETED';

/**
 * How often the list re-checks while it is on screen, so a journey appears
 * under Ongoing soon after its bus starts sharing from the Bus Dashboard
 * without the passenger having to pull to refresh.
 */
const ACTIVITY_REFRESH_INTERVAL_MS = 60_000;

// Activities (MOV-294): the passenger's journeys as they happen, separate from
// the Booking tab, which keeps managing reservations and tickets unchanged.
export default function ActivitiesScreen() {
    const { t } = useTranslation();
    const { user } = useAuthStore();
    const passengerId = user?.passengerId;

    const [bookings, setBookings] = useState<Booking[]>([]);
    const [checkedAt, setCheckedAt] = useState(() => new Date());
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<ActivityTab>('ONGOING');

    // Only the newest request may update the screen, so a slow earlier
    // response can never overwrite a fresher one.
    const latestRequest = useRef(0);

    const load = useCallback(
        async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
            if (!passengerId) {
                setLoading(false);
                return;
            }

            const requestId = ++latestRequest.current;

            if (mode === 'initial') setLoading(true);
            if (mode === 'refresh') setRefreshing(true);
            if (mode !== 'silent') setError('');

            try {
                const data = await getBookingHistory(passengerId, { includeLiveSharing: true });
                if (requestId !== latestRequest.current) return;
                setBookings(data);
                setCheckedAt(new Date());
                setError('');
            } catch (err: any) {
                if (requestId !== latestRequest.current) return;
                // A failed background check keeps the list already on screen.
                if (mode !== 'silent') {
                    setError(err?.message || t('activities.loadError', 'Unable to load your activities.'));
                }
            } finally {
                if (requestId === latestRequest.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [passengerId, t]
    );

    useFocusEffect(
        useCallback(() => {
            load('initial');
            const timer = setInterval(() => load('silent'), ACTIVITY_REFRESH_INTERVAL_MS);
            return () => clearInterval(timer);
        }, [load])
    );

    const groups = useMemo(
        () => groupActivities(bookings, passengerId ?? '', checkedAt),
        [bookings, passengerId, checkedAt]
    );

    const openActivity = useCallback((booking: Booking, tab: ActivityTab) => {
        router.push(tab === 'ONGOING' ? ongoingJourneyHref(booking.bookingId) : completedJourneyHref(booking.bookingId));
    }, []);

    if (!user) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.center}>
                    <View style={styles.lockIconBox}>
                        <Ionicons name="lock-closed" size={36} color="#0066CC" />
                    </View>
                    <Text style={styles.loginReqTitle}>{t('activities.loginTitle', 'Access Activities')}</Text>
                    <Text style={styles.loginReqDesc}>
                        {t('activities.loginDesc', 'Please sign in with your passenger account to see your ongoing and completed journeys.')}
                    </Text>
                    <TouchableOpacity
                        style={styles.loginBtn}
                        onPress={() => router.replace('/(auth)')}
                        accessibilityRole="button"
                    >
                        <Text style={styles.loginBtnText}>{t('activities.goToSignIn', 'GO TO SIGN IN')}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const isOngoingTab = activeTab === 'ONGOING';
    const visible = isOngoingTab ? groups.ongoing : groups.completed;

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title} accessibilityRole="header">
                        {t('activities.title', 'Activities')}
                    </Text>
                    <Text style={styles.subtitle}>{t('activities.subtitle', 'Your journeys in progress and finished trips')}</Text>
                </View>

                <View style={styles.tabRow} accessibilityRole="tablist">
                    <TabButton
                        label={t('activities.ongoingTab', 'Ongoing')}
                        count={groups.ongoing.length}
                        icon="navigate"
                        active={isOngoingTab}
                        onPress={() => setActiveTab('ONGOING')}
                    />
                    <TabButton
                        label={t('activities.completedTab', 'Completed')}
                        count={groups.completed.length}
                        icon="checkmark-done"
                        active={!isOngoingTab}
                        onPress={() => setActiveTab('COMPLETED')}
                    />
                </View>

                {loading ? (
                    <View style={styles.loadingWrapper}>
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.loadingText}>{t('activities.loading', 'Checking your journeys...')}</Text>
                    </View>
                ) : error ? (
                    <View style={styles.errorWrapper}>
                        <Ionicons name="warning" size={40} color="#EF4444" />
                        <Text style={styles.errorText}>{error}</Text>
                        <TouchableOpacity style={styles.retryBtn} onPress={() => load('initial')} accessibilityRole="button">
                            <Text style={styles.retryBtnText}>{t('activities.retryBtn', 'RETRY')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <FlatList
                        data={visible}
                        keyExtractor={(item) => item.bookingId}
                        contentContainerStyle={styles.list}
                        showsVerticalScrollIndicator={false}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={() => load('refresh')}
                                colors={['#0066CC']}
                                tintColor="#0066CC"
                            />
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <View style={styles.emptyIconBox}>
                                    <Ionicons
                                        name={isOngoingTab ? 'bus-outline' : 'checkmark-done-outline'}
                                        size={48}
                                        color="#94A3B8"
                                    />
                                </View>
                                <Text style={styles.emptyTitle}>
                                    {isOngoingTab
                                        ? t('activities.noOngoingTitle', 'No ongoing journeys')
                                        : t('activities.noCompletedTitle', 'No completed journeys')}
                                </Text>
                                <Text style={styles.emptySub}>
                                    {isOngoingTab
                                        ? t(
                                              'activities.noOngoingDesc',
                                              'A booked journey appears here once its bus starts the journey.'
                                          )
                                        : t(
                                              'activities.noCompletedDesc',
                                              'Journeys you have boarded will appear here after they finish.'
                                          )}
                                </Text>
                                {isOngoingTab && (
                                    <TouchableOpacity
                                        style={styles.secondaryBtn}
                                        onPress={() => router.push('/booking')}
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.secondaryBtnText}>
                                            {t('activities.viewBookings', 'VIEW MY BOOKINGS')}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        }
                        renderItem={({ item }) => (
                            <ActivityJourneyCard
                                booking={item}
                                variant={isOngoingTab ? 'ongoing' : 'completed'}
                                onPress={(booking) => openActivity(booking, activeTab)}
                            />
                        )}
                    />
                )}
            </View>
        </SafeAreaView>
    );
}

interface TabButtonProps {
    label: string;
    count: number;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    active: boolean;
    onPress: () => void;
}

function TabButton({ label, count, icon, active, onPress }: TabButtonProps) {
    return (
        <TouchableOpacity
            style={[styles.tabButton, active && styles.tabButtonActive]}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}, ${count}`}
        >
            <Ionicons name={icon} size={18} color={active ? '#FFFFFF' : '#0066CC'} />
            <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
            {count > 0 && (
                <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                    <Text style={[styles.countText, active && styles.countTextActive]}>{count}</Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    },
    container: {
        flex: 1,
        paddingHorizontal: 16,
    },
    header: {
        marginTop: 10,
        marginBottom: 16,
    },
    title: {
        fontSize: 26,
        fontWeight: '900',
        color: '#0F172A',
    },
    subtitle: {
        fontSize: 13,
        color: '#475569',
        marginTop: 2,
    },
    tabRow: {
        flexDirection: 'row',
        backgroundColor: '#E2E8F0',
        borderRadius: 14,
        padding: 5,
        marginBottom: 16,
    },
    tabButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 10,
        gap: 8,
    },
    tabButtonActive: {
        backgroundColor: '#0066CC',
    },
    tabButtonText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0066CC',
    },
    tabButtonTextActive: {
        color: '#FFFFFF',
    },
    countBadge: {
        minWidth: 20,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
    },
    countBadgeActive: {
        backgroundColor: '#EBF3FA',
    },
    countText: {
        fontSize: 11,
        fontWeight: '900',
        color: '#0066CC',
    },
    countTextActive: {
        color: '#0066CC',
    },
    list: {
        paddingBottom: 30,
        flexGrow: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 30,
    },
    lockIconBox: {
        width: 70,
        height: 70,
        borderRadius: 24,
        backgroundColor: '#EBF3FA',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    loginReqTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0F172A',
    },
    loginReqDesc: {
        fontSize: 14,
        color: '#475569',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
        paddingHorizontal: 15,
        marginBottom: 24,
    },
    loginBtn: {
        backgroundColor: '#0066CC',
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 12,
    },
    loginBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 13,
    },
    loadingWrapper: {
        padding: 40,
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 14,
        color: '#64748B',
        marginTop: 10,
    },
    errorWrapper: {
        padding: 30,
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 14,
        fontWeight: '700',
        marginTop: 10,
        textAlign: 'center',
    },
    retryBtn: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
        marginTop: 12,
    },
    retryBtnText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#475569',
    },
    emptyState: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 30,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginTop: 10,
    },
    emptyIconBox: {
        width: 60,
        height: 60,
        borderRadius: 18,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    emptySub: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 18,
        paddingHorizontal: 15,
        marginBottom: 20,
    },
    secondaryBtn: {
        backgroundColor: '#EBF3FA',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
    },
    secondaryBtnText: {
        color: '#0066CC',
        fontWeight: '800',
        fontSize: 12,
    },
});
