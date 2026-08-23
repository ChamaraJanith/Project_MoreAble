import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Booking } from '../../../src/entities/booking/model/types';
import { cancelBooking, getBookingHistory } from '../../../src/features/booking/api/bookingApi';
import { useAuthStore } from '../../../src/shared/store/authStore';

type FilterTab = 'UPCOMING' | 'HISTORY';

export default function MyBookingsScreen() {
    const { user } = useAuthStore();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<FilterTab>('UPCOMING');

    const load = useCallback(async () => {
        if (!user?.passengerId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError('');
        try {
            const data = await getBookingHistory(user.passengerId);
            setBookings(data);
        } catch (err: any) {
            setError(err.message || 'Unable to fetch bookings.');
        } finally {
            setLoading(false);
        }
    }, [user?.passengerId]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    function handleCancel(booking: Booking) {
        const doCancel = async () => {
            try {
                await cancelBooking(booking.bookingId);
                load();
            } catch (err: any) {
                if (Platform.OS === 'web') {
                    window.alert(err.message);
                } else {
                    Alert.alert('Cancel Error', err.message);
                }
            }
        };

        if (Platform.OS === 'web') {
            if (window.confirm('Are you sure you want to cancel this booking? This action cannot be undone.')) {
                doCancel();
            }
        } else {
            Alert.alert(
                'Cancel Reservation',
                'Are you sure you want to cancel this booking? This action cannot be undone.',
                [
                    { text: 'Keep Booking', style: 'cancel' },
                    { text: 'Cancel Booking', style: 'destructive', onPress: doCancel },
                ]
            );
        }
    }

    const filtered = bookings.filter((b) => {
        if (activeTab === 'UPCOMING') {
            return b.status === 'CONFIRMED';
        } else {
            return b.status === 'CANCELLED';
        }
    });

    if (!user) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.center}>
                    <View style={styles.lockIconBox}>
                        <Ionicons name="lock-closed" size={36} color="#0066CC" />
                    </View>
                    <Text style={styles.loginReqTitle}>Access Bookings</Text>
                    <Text style={styles.loginReqDesc}>
                        Please sign in with your passenger account to view tickets, travel assistance logs, and reservation details.
                    </Text>
                    <TouchableOpacity
                        style={styles.loginBtn}
                        onPress={() => router.replace('/(auth)')}
                    >
                        <Text style={styles.loginBtnText}>GO TO SIGN IN</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.container}>
                {/* Header Row */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>My Trips</Text>
                        <Text style={styles.subtitle}>Manage your reservations & travel support</Text>
                    </View>
                    <View style={styles.bookingCountBadge}>
                        <Text style={styles.bookingCountText}>
                            {bookings.filter((b) => b.status === 'CONFIRMED').length} active
                        </Text>
                    </View>
                </View>

                {/* Custom Tab Switcher - System Theme Colors */}
                <View style={styles.tabRow}>
                    <TouchableOpacity
                        style={[styles.tabButton, activeTab === 'UPCOMING' && styles.tabButtonActive]}
                        onPress={() => setActiveTab('UPCOMING')}
                    >
                        <Ionicons
                            name="calendar"
                            size={18}
                            color={activeTab === 'UPCOMING' ? '#FFFFFF' : '#0066CC'}
                        />
                        <Text style={[styles.tabButtonText, activeTab === 'UPCOMING' && styles.tabButtonTextActive]}>
                            Upcoming
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.tabButton, activeTab === 'HISTORY' && styles.tabButtonActive]}
                        onPress={() => setActiveTab('HISTORY')}
                    >
                        <Ionicons
                            name="archive"
                            size={18}
                            color={activeTab === 'HISTORY' ? '#FFFFFF' : '#0066CC'}
                        />
                        <Text style={[styles.tabButtonText, activeTab === 'HISTORY' && styles.tabButtonTextActive]}>
                            History
                        </Text>
                    </TouchableOpacity>
                </View>

                {loading ? (
                    <View style={styles.loadingWrapper}>
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.loadingText}>Fetching reservation list...</Text>
                    </View>
                ) : error ? (
                    <View style={styles.errorWrapper}>
                        <Ionicons name="warning" size={40} color="#EF4444" />
                        <Text style={styles.errorText}>{error}</Text>
                        <TouchableOpacity style={styles.retryBtn} onPress={load}>
                            <Text style={styles.retryBtnText}>RETRY</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <FlatList
                        data={filtered}
                        keyExtractor={(item) => item.bookingId}
                        contentContainerStyle={styles.list}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <View style={styles.emptyState}>
                                <View style={styles.emptyIconBox}>
                                    <Ionicons name="ticket-outline" size={48} color="#94A3B8" />
                                </View>
                                <Text style={styles.emptyTitle}>
                                    {activeTab === 'UPCOMING' ? 'No Upcoming Reservations' : 'No Past Journeys'}
                                </Text>
                                <Text style={styles.emptySub}>
                                    {activeTab === 'UPCOMING'
                                        ? 'Any bookings you confirm will show up here along with your companion details.'
                                        : "You don't have any past or cancelled journeys on record."}
                                </Text>
                                {activeTab === 'UPCOMING' && (
                                    <TouchableOpacity
                                        style={styles.planBtn}
                                        onPress={() => router.push('/journey')}
                                    >
                                        <Text style={styles.planBtnText}>BOOK A TICKET NOW</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        }
                        renderItem={({ item }) => {
                            const isUpcoming = item.status === 'CONFIRMED';
                            const hasAssistance =
                                item.assistanceRequested?.wheelchairAssistance ||
                                item.assistanceRequested?.boardingAssistance ||
                                item.assistanceRequested?.walkingAssistance ||
                                item.assistanceRequested?.prioritySeatAssistance;

                            const isWheelchair = item.seatNumber?.startsWith('W') || item.assistanceRequested?.wheelchairAssistance;

                            return (
                                <View style={styles.card}>
                                    {/* Card Header - System Blue Accents */}
                                    <View style={styles.cardHeader}>
                                        <View style={styles.busInfoRow}>
                                            <View style={styles.busIconContainer}>
                                                <Ionicons name="bus" size={16} color="#0066CC" />
                                            </View>
                                            <Text style={styles.plateText}>{item.vehicle.numberPlate}</Text>
                                        </View>

                                        <View
                                            style={[
                                                styles.statusBadge,
                                                item.status === 'CONFIRMED'
                                                    ? styles.statusBadgeActive
                                                    : styles.statusBadgeCancel,
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.statusText,
                                                    item.status === 'CONFIRMED'
                                                        ? styles.statusTextActive
                                                        : styles.statusTextCancel,
                                                ]}
                                            >
                                                {item.status}
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Route Info - High Contrast */}
                                    <View style={styles.routeSection}>
                                        <View style={styles.routeIndicatorRow}>
                                            <View style={styles.indicatorCircle} />
                                            <View style={styles.indicatorLine} />
                                            <View style={[styles.indicatorCircle, { backgroundColor: '#0066CC' }]} />
                                        </View>

                                        <View style={styles.routeNamesColumn}>
                                            <Text style={styles.routeStopName}>{item.journey.startLocation}</Text>
                                            <Text style={styles.routeStopName}>{item.journey.endLocation}</Text>
                                        </View>
                                    </View>

                                    {/* Meta details - Simple blue and gray theme */}
                                    <View style={styles.metaRow}>
                                        <View style={styles.metaBadge}>
                                            <Ionicons name="time-outline" size={14} color="#0066CC" />
                                            <Text style={styles.metaText}>{item.journey.departureTime}</Text>
                                        </View>

                                        <View style={styles.metaBadge}>
                                            <Ionicons
                                                name={isWheelchair ? 'body' : 'star-outline'}
                                                size={14}
                                                color="#0066CC"
                                            />
                                            <Text style={styles.metaText}>
                                                Seat {item.seatNumber}
                                                {item.pairedSeatNumber ? ` + Companion ${item.pairedSeatNumber}` : ''}
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Conductor status inline alert - High Visibility, Clean Theme */}
                                    {isUpcoming && hasAssistance && (
                                        <View
                                            style={[
                                                styles.conductorStatusBox,
                                                { backgroundColor: getStatusBg(item.assistanceStatus) },
                                            ]}
                                        >
                                            <Ionicons
                                                name="checkbox-outline"
                                                size={16}
                                                color={getStatusColor(item.assistanceStatus)}
                                            />
                                            <Text
                                                style={[
                                                    styles.conductorStatusText,
                                                    { color: getStatusColor(item.assistanceStatus) },
                                                ]}
                                            >
                                                Travel Support: {getStatusLabel(item.assistanceStatus)}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Bottom info & CTA buttons */}
                                    <View style={styles.cardDivider} />

                                    <View style={styles.footerRow}>
                                        <Text style={styles.bookingIdText}>ID: {item.bookingId}</Text>
                                        <View style={styles.actionBtnGroup}>
                                            {isUpcoming && (
                                                <TouchableOpacity
                                                    style={styles.cancelBtn}
                                                    onPress={() => handleCancel(item)}
                                                >
                                                    <Text style={styles.cancelBtnText}>Cancel</Text>
                                                </TouchableOpacity>
                                            )}
                                            <TouchableOpacity
                                                style={styles.viewBtn}
                                                onPress={() =>
                                                    router.push({
                                                        pathname: '/booking/ticket/[bookingId]',
                                                        params: { bookingId: item.bookingId },
                                                    })
                                                }
                                            >
                                                <Text style={styles.viewBtnText}>View Ticket</Text>
                                                <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </View>
                            );
                        }}
                    />
                )}
            </View>
        </SafeAreaView>
    );
}

function getStatusLabel(status?: string) {
    switch (status) {
        case 'CONFIRMED':
            return 'ACKNOWLEDGED BY CREW 👨‍✈️';
        case 'IN_PROGRESS':
            return 'BOARDING ASSISTANCE ♿';
        case 'COMPLETED':
            return 'ASSISTANCE COMPLETED ✅';
        case 'DECLINED':
            return 'UNAVAILABLE ❌';
        default:
            return 'CONDUCTOR NOTIFIED 🚌';
    }
}

function getStatusBg(status?: string) {
    switch (status) {
        case 'CONFIRMED':
            return '#EBF3FA';
        case 'IN_PROGRESS':
            return '#EBF3FA';
        case 'COMPLETED':
            return '#EBF3FA';
        case 'DECLINED':
            return '#FEE2E2';
        default:
            return '#F8FAFC';
    }
}

function getStatusColor(status?: string) {
    switch (status) {
        case 'CONFIRMED':
            return '#0066CC';
        case 'IN_PROGRESS':
            return '#0066CC';
        case 'COMPLETED':
            return '#0066CC';
        case 'DECLINED':
            return '#B91C1C';
        default:
            return '#475569';
    }
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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
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
    bookingCountBadge: {
        backgroundColor: '#EBF3FA',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
    },
    bookingCountText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#0066CC',
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
    list: {
        paddingBottom: 30,
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
    planBtn: {
        backgroundColor: '#0066CC',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
    },
    planBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 12,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
    },
    busInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    busIconContainer: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: '#EBF3FA',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    plateText: {
        fontSize: 15,
        fontWeight: '900',
        color: '#0F172A',
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    statusBadgeActive: {
        backgroundColor: '#D1FAE5',
    },
    statusBadgeCancel: {
        backgroundColor: '#FEE2E2',
    },
    statusText: {
        fontSize: 11,
        fontWeight: '900',
    },
    statusTextActive: {
        color: '#065F46',
    },
    statusTextCancel: {
        color: '#B91C1C',
    },
    routeSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    routeIndicatorRow: {
        alignItems: 'center',
        width: 16,
        marginRight: 12,
    },
    indicatorCircle: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#94A3B8',
    },
    indicatorLine: {
        width: 2,
        height: 20,
        backgroundColor: '#CBD5E1',
        marginVertical: 2,
    },
    routeNamesColumn: {
        flex: 1,
        gap: 10,
    },
    routeStopName: {
        fontSize: 16,
        fontWeight: '800',
        color: '#1E293B',
    },
    metaRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 14,
    },
    metaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        gap: 6,
    },
    metaText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#1E293B',
    },
    conductorStatusBox: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        gap: 8,
        marginBottom: 14,
    },
    conductorStatusText: {
        fontSize: 11,
        fontWeight: '900',
    },
    cardDivider: {
        height: 1.5,
        backgroundColor: '#F1F5F9',
        marginVertical: 10,
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    bookingIdText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    actionBtnGroup: {
        flexDirection: 'row',
        gap: 10,
    },
    cancelBtn: {
        height: 44,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: '#CBD5E1',
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cancelBtnText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#475569',
    },
    viewBtn: {
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 14,
        borderRadius: 10,
        gap: 6,
        justifyContent: 'center',
    },
    viewBtnText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#FFFFFF',
    },
});