import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Booking } from '../../../src/entities/booking/model/types';
import { cancelBooking, getBookingHistory } from '../../../src/features/booking/api/bookingApi';
import { useAuthStore } from '../../../src/shared/store/authStore';

type FilterTab = 'UPCOMING' | 'CANCELLED';

export default function MyBookingsScreen() {
    const { user } = useAuthStore();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<FilterTab>('UPCOMING');

    const load = useCallback(async () => {
        if (!user?.passengerId) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            setBookings(await getBookingHistory(user.passengerId));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [user?.passengerId]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    function handleCancel(booking: Booking) {
        const doCancel = async () => {
            try {
                await cancelBooking(booking.bookingId);
                load();
            } catch (err: any) {
                Platform.OS === 'web' ? window.alert(err.message) : Alert.alert('Error', err.message);
            }
        };

        if (Platform.OS === 'web') {
            if (window.confirm('Cancel this booking? This cannot be undone.')) doCancel();
        } else {
            Alert.alert('Cancel Booking', 'Cancel this booking? This cannot be undone.', [
                { text: 'Keep Booking', style: 'cancel' },
                { text: 'Cancel Booking', style: 'destructive', onPress: doCancel },
            ]);
        }
    }

    const filtered = bookings.filter((b) => (activeTab === 'UPCOMING' ? b.status === 'CONFIRMED' : b.status === 'CANCELLED'));

    if (!user) {
        return (
            <View style={styles.center}>
                <Ionicons name="log-in-outline" size={32} color="#94A3B8" />
                <Text style={styles.emptyText}>Please log in to view your bookings.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <Text style={styles.title}>My Bookings</Text>
                <Ionicons name="filter-outline" size={20} color="#64748B" />
            </View>

            <View style={styles.tabRow}>
                <TabButton label="Upcoming" active={activeTab === 'UPCOMING'} onPress={() => setActiveTab('UPCOMING')} />
                <TabButton label="Cancelled" active={activeTab === 'CANCELLED'} onPress={() => setActiveTab('CANCELLED')} />
            </View>

            {loading && <ActivityIndicator size="large" color="#0066CC" style={{ marginTop: 30 }} />}
            {!loading && !!error && <Text style={styles.error}>{error}</Text>}

            {!loading && !error && (
                <FlatList
                    data={filtered}
                    keyExtractor={(item) => item.bookingId}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Ionicons name="ticket-outline" size={32} color="#94A3B8" />
                            <Text style={styles.emptyText}>
                                {activeTab === 'UPCOMING' ? "You haven't made any bookings yet." : 'No cancelled bookings.'}
                            </Text>
                            {activeTab === 'UPCOMING' && (
                                <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/journey')} accessibilityRole="button" accessibilityLabel="Plan a journey">
                                    <Text style={styles.emptyButtonText}>PLAN A JOURNEY</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.card}>
                            <View style={styles.cardTop}>
                                <Text style={styles.plateText}>{item.vehicle.numberPlate}</Text>
                                <View style={[styles.statusBadge, item.status !== 'CONFIRMED' && styles.statusBadgeCancelled]}>
                                    <Text style={[styles.statusText, item.status !== 'CONFIRMED' && styles.statusTextCancelled]}>{item.status}</Text>
                                </View>
                            </View>

                            <Text style={styles.routeText}>{item.journey.startLocation} → {item.journey.endLocation}</Text>

                            <View style={styles.metaRow}>
                                <Ionicons name="time-outline" size={13} color="#64748B" />
                                <Text style={styles.metaText}>{item.journey.departureTime}</Text>
                                <Ionicons name="accessibility-outline" size={13} color="#64748B" style={{ marginLeft: 10 }} />
                                <Text style={styles.metaText}>Seat {item.seatNumber}{item.isPrioritySeat ? ' · Priority' : ''}</Text>
                            </View>

                            <Text style={styles.bookingIdText}>Booking ID: {item.bookingId}</Text>

                            <View style={styles.actionRow}>
                                <TouchableOpacity
                                    style={styles.viewButton}
                                    onPress={() => router.push({ pathname: '/booking/ticket/[bookingId]', params: { bookingId: item.bookingId } })}
                                    accessibilityRole="button"
                                    accessibilityLabel={`View details for booking ${item.bookingId}`}
                                >
                                    <Text style={styles.viewButtonText}>View Details</Text>
                                </TouchableOpacity>
                                {item.status === 'CONFIRMED' && (
                                    <TouchableOpacity
                                        style={styles.cancelButton}
                                        onPress={() => handleCancel(item)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Cancel booking ${item.bookingId}`}
                                    >
                                        <Text style={styles.cancelButtonText}>Cancel</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
        <TouchableOpacity
            style={[styles.tabButton, active && styles.tabButtonActive]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
        >
            <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC', padding: 16 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
    tabRow: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 4, marginTop: 16, marginBottom: 14 },
    tabButton: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
    tabButtonActive: { backgroundColor: '#0F172A' },
    tabButtonText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
    tabButtonTextActive: { color: '#fff' },
    list: { paddingBottom: 30 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    error: { color: '#D32F2F', textAlign: 'center', marginTop: 30 },
    emptyState: { alignItems: 'center', marginTop: 60 },
    emptyText: { color: '#64748B', marginTop: 10, marginBottom: 16, textAlign: 'center' },
    emptyButton: { backgroundColor: '#0066CC', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10 },
    emptyButtonText: { color: '#fff', fontWeight: '700' },
    card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    plateText: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
    statusBadge: { backgroundColor: '#EEF8EF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    statusBadgeCancelled: { backgroundColor: '#FEF4F4' },
    statusText: { fontSize: 11, fontWeight: '700', color: '#388E3C' },
    statusTextCancelled: { color: '#D32F2F' },
    routeText: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginTop: 8 },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    metaText: { fontSize: 12, color: '#64748B', marginLeft: 4 },
    bookingIdText: { fontSize: 11, color: '#94A3B8', marginTop: 8 },
    actionRow: { flexDirection: 'row', marginTop: 12, gap: 10 },
    viewButton: { flex: 1, backgroundColor: '#0F172A', minHeight: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    viewButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    cancelButton: { flex: 1, backgroundColor: '#fff', minHeight: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
    cancelButtonText: { color: '#334155', fontWeight: '700', fontSize: 13 },
});