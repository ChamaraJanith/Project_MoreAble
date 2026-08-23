import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Booking } from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { updateAssistanceStatus } from '../../booking/api/bookingApi';

interface PassengerManifestTabProps {
    busId?: string;
    numberPlate?: string;
}

interface TripTurn {
    tripId: string;
    turnNumber: number;
    departureTime: string;
    estimatedArrivalTime?: string;
    status?: string;
}

type FilterMode = 'ALL' | 'ASSISTANCE_ONLY' | 'WHEELCHAIR_ONLY';

export function PassengerManifestTab({ busId, numberPlate }: PassengerManifestTabProps) {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [trips, setTrips] = useState<TripTurn[]>([]);
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, [busId]);

    async function loadData() {
        if (!busId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError('');

            // Fetch trips & bookings concurrently
            const [historyRes, tripsRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/booking/history?busId=${encodeURIComponent(busId)}`),
                fetch(`${API_BASE_URL}/api/trips?busId=${encodeURIComponent(busId)}`),
            ]);

            const historyData = await historyRes.json().catch(() => null);
            const tripsData = await tripsRes.json().catch(() => null);

            if (historyData?.success && Array.isArray(historyData.bookings)) {
                const active = historyData.bookings.filter((b: Booking) => b.status === 'CONFIRMED');
                setBookings(active);
            } else {
                setBookings([]);
            }

            if (tripsData?.success && Array.isArray(tripsData.trips)) {
                setTrips(tripsData.trips);
                if (tripsData.trips.length > 0 && !selectedTripId) {
                    setSelectedTripId(tripsData.trips[0].tripId);
                }
            }
        } catch (err: any) {
            setError(err.message || 'Unable to load passenger manifest.');
        } finally {
            setLoading(false);
        }
    }

    async function handleStatusChange(bookingId: string, newStatus: any) {
        setUpdatingId(bookingId);
        try {
            await updateAssistanceStatus(bookingId, newStatus);
            setBookings((prev) =>
                prev.map((b) => (b.bookingId === bookingId ? { ...b, assistanceStatus: newStatus } : b))
            );
        } catch (err: any) {
            console.error('Failed to update assistance status:', err);
        } finally {
            setUpdatingId(null);
        }
    }

    function handleShowScannerPlaceholder() {
        const msg =
            'Passenger QR Ticket Scanner slot is reserved for upcoming update. Currently, conductor verifies passenger tickets and seat numbers manually below.';
        if (Platform.OS === 'web') {
            window.alert(msg);
        } else {
            Alert.alert('Ticket QR Scanner (Coming Soon)', msg);
        }
    }

    // Filter bookings by selected trip turn (if any selected)
    const tripBookings = useMemo(() => {
        if (!selectedTripId || selectedTripId === 'ALL') return bookings;
        return bookings.filter((b) => b.tripId === selectedTripId);
    }, [bookings, selectedTripId]);

    // Stats calculation for current trip selection
    const totalPassengers = tripBookings.length;
    const assistanceCount = tripBookings.filter(
        (b) =>
            b.assistanceRequested?.wheelchairAssistance ||
            b.assistanceRequested?.boardingAssistance ||
            b.assistanceRequested?.walkingAssistance ||
            b.assistanceRequested?.prioritySeatAssistance
    ).length;

    const wheelchairCount = tripBookings.filter(
        (b) => b.seatNumber?.startsWith('W') || b.assistanceRequested?.wheelchairAssistance
    ).length;

    // Filtered bookings by search and chip filter
    const filteredBookings = useMemo(() => {
        return tripBookings.filter((b) => {
            if (filterMode === 'ASSISTANCE_ONLY') {
                const hasAst =
                    b.assistanceRequested?.wheelchairAssistance ||
                    b.assistanceRequested?.boardingAssistance ||
                    b.assistanceRequested?.walkingAssistance ||
                    b.assistanceRequested?.prioritySeatAssistance;
                if (!hasAst) return false;
            } else if (filterMode === 'WHEELCHAIR_ONLY') {
                const isW = b.seatNumber?.startsWith('W') || b.assistanceRequested?.wheelchairAssistance;
                if (!isW) return false;
            }

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const matchSeat = b.seatNumber?.toLowerCase().includes(q);
                const matchUser = b.userId?.toLowerCase().includes(q);
                const matchStart = b.journey?.startLocation?.toLowerCase().includes(q);
                const matchEnd = b.journey?.endLocation?.toLowerCase().includes(q);
                const matchCompanion = b.pairedSeatNumber?.toLowerCase().includes(q);
                return matchSeat || matchUser || matchStart || matchEnd || matchCompanion;
            }

            return true;
        });
    }, [tripBookings, filterMode, searchQuery]);

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.loadingText}>Loading passenger manifest for {numberPlate ?? 'bus'}...</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 35 }}>
            {/* Header Title */}
            <View style={styles.headerTitleRow}>
                <Ionicons name="clipboard" size={22} color="#0066CC" />
                <Text style={styles.headerTitle}>Trip Passenger Manifest 👨‍✈️</Text>
            </View>

            {/* Trip Turn Selector Bar */}
            {trips.length > 0 && (
                <View style={styles.tripSelectorSection}>
                    <Text style={styles.tripSelectorLabel}>Select Bus Trip Turn:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tripChipsRow}>
                        <TouchableOpacity
                            style={[styles.tripChip, selectedTripId === 'ALL' && styles.tripChipActive]}
                            onPress={() => setSelectedTripId('ALL')}
                        >
                            <Text style={[styles.tripChipText, selectedTripId === 'ALL' && styles.tripChipTextActive]}>
                                All Trips ({bookings.length})
                            </Text>
                        </TouchableOpacity>

                        {trips.map((t) => {
                            const isSel = selectedTripId === t.tripId;
                            const count = bookings.filter((b) => b.tripId === t.tripId).length;
                            return (
                                <TouchableOpacity
                                    key={t.tripId}
                                    style={[styles.tripChip, isSel && styles.tripChipActive]}
                                    onPress={() => setSelectedTripId(t.tripId)}
                                >
                                    <Ionicons name="time-outline" size={12} color={isSel ? '#FFF' : '#0066CC'} />
                                    <Text style={[styles.tripChipText, isSel && styles.tripChipTextActive]}>
                                        Turn {t.turnNumber} ({t.departureTime || 'Trip'}) · {count} booked
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>
            )}

            {/* Future QR Ticket Verification Scanner Card */}
            <TouchableOpacity style={styles.qrScannerPlaceholderCard} onPress={handleShowScannerPlaceholder}>
                <View style={styles.qrScannerIconBox}>
                    <Ionicons name="qr-code-outline" size={22} color="#0066CC" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.qrScannerTitle}>Scan Passenger Ticket QR 📷</Text>
                        <View style={styles.comingSoonBadge}>
                            <Text style={styles.comingSoonBadgeText}>COMING SOON</Text>
                        </View>
                    </View>
                    <Text style={styles.qrScannerSub}>
                        Tap to preview ticket scanner slot. Conductor manual check active below.
                    </Text>
                </View>
            </TouchableOpacity>

            {/* Quick Stats Banner */}
            <View style={styles.statsRow}>
                <View style={styles.statCard}>
                    <Text style={styles.statValue}>{totalPassengers}</Text>
                    <Text style={styles.statLabel}>Booked Passengers</Text>
                </View>

                <View style={[styles.statCard, { borderTopColor: '#7C3AED' }]}>
                    <Text style={[styles.statValue, { color: '#7C3AED' }]}>{assistanceCount}</Text>
                    <Text style={styles.statLabel}>Assistance Requests</Text>
                </View>

                <View style={[styles.statCard, { borderTopColor: '#0066CC' }]}>
                    <Text style={[styles.statValue, { color: '#0066CC' }]}>{wheelchairCount}</Text>
                    <Text style={styles.statLabel}>Wheelchair Bays</Text>
                </View>
            </View>

            {/* Search Input */}
            <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color="#94A3B8" />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search by seat (e.g. W1, 12), passenger ID, or stop..."
                    placeholderTextColor="#94A3B8"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
                {!!searchQuery && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                )}
            </View>

            {/* Filter Chips */}
            <View style={styles.filterChipsRow}>
                <TouchableOpacity
                    style={[styles.chip, filterMode === 'ALL' && styles.chipActive]}
                    onPress={() => setFilterMode('ALL')}
                >
                    <Text style={[styles.chipText, filterMode === 'ALL' && styles.chipTextActive]}>
                        All Passengers ({totalPassengers})
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.chip, filterMode === 'ASSISTANCE_ONLY' && styles.chipActive]}
                    onPress={() => setFilterMode('ASSISTANCE_ONLY')}
                >
                    <Text style={[styles.chipText, filterMode === 'ASSISTANCE_ONLY' && styles.chipTextActive]}>
                        Assistance ♿ ({assistanceCount})
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.chip, filterMode === 'WHEELCHAIR_ONLY' && styles.chipActive]}
                    onPress={() => setFilterMode('WHEELCHAIR_ONLY')}
                >
                    <Text style={[styles.chipText, filterMode === 'WHEELCHAIR_ONLY' && styles.chipTextActive]}>
                        Wheelchair ♿ ({wheelchairCount})
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Passenger List */}
            {filteredBookings.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <Ionicons name="people-outline" size={40} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>No matching passengers</Text>
                    <Text style={styles.emptySub}>
                        {searchQuery
                            ? `No bookings match "${searchQuery}".`
                            : 'There are no passenger bookings recorded for this trip turn yet.'}
                    </Text>
                </View>
            ) : (
                filteredBookings.map((booking) => {
                    const isWheelchair = booking.seatNumber?.startsWith('W') || booking.assistanceRequested?.wheelchairAssistance;
                    const hasAssistance =
                        booking.assistanceRequested?.wheelchairAssistance ||
                        booking.assistanceRequested?.boardingAssistance ||
                        booking.assistanceRequested?.walkingAssistance ||
                        booking.assistanceRequested?.prioritySeatAssistance;

                    const status = booking.assistanceStatus ?? 'PENDING';
                    const isUpdating = updatingId === booking.bookingId;

                    return (
                        <View
                            key={booking.bookingId}
                            style={[
                                styles.passengerCard,
                                isWheelchair && styles.passengerCardWheelchair,
                            ]}
                        >
                            {/* Card Top Row */}
                            <View style={styles.cardHeader}>
                                <View style={styles.seatBadgeGroup}>
                                    <View style={[styles.seatBadge, isWheelchair && styles.seatBadgeWheelchair]}>
                                        <Text style={styles.seatBadgeText}>Seat {booking.seatNumber}</Text>
                                    </View>
                                    {booking.pairedSeatNumber && (
                                        <View style={styles.companionBadge}>
                                            <Ionicons name="people" size={12} color="#7C3AED" />
                                            <Text style={styles.companionBadgeText}>+ Companion {booking.pairedSeatNumber}</Text>
                                        </View>
                                    )}
                                </View>

                                {hasAssistance && (
                                    <View style={[styles.statusBadge, { backgroundColor: getStatusBg(status) }]}>
                                        <Text style={[styles.statusBadgeText, { color: getStatusColor(status) }]}>
                                            {getStatusLabel(status)}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {/* Passenger info */}
                            <View style={styles.passengerDetails}>
                                <Text style={styles.passengerIdText}>Passenger: {booking.userId || 'Guest Commuter'}</Text>
                                <Text style={styles.routeStopsText}>
                                    📍 Pickup: <Text style={styles.boldText}>{booking.journey?.startLocation}</Text> ➔ Drop-off: <Text style={styles.boldText}>{booking.journey?.endLocation}</Text>
                                </Text>
                            </View>

                            {/* Assistance Requested Box */}
                            {hasAssistance && (
                                <View style={styles.assistanceSection}>
                                    <Text style={styles.assistanceSectionTitle}>Requested Assistance:</Text>

                                    <View style={styles.assistanceTagsRow}>
                                        {booking.assistanceRequested?.wheelchairAssistance && (
                                            <View style={[styles.tag, { backgroundColor: '#F3E8FF' }]}>
                                                <Ionicons name="body" size={12} color="#7C3AED" />
                                                <Text style={[styles.tagText, { color: '#7C3AED' }]}>Wheelchair Ramp & Space</Text>
                                            </View>
                                        )}
                                        {booking.assistanceRequested?.boardingAssistance && (
                                            <View style={[styles.tag, { backgroundColor: '#DBEAFE' }]}>
                                                <Ionicons name="footsteps" size={12} color="#1D4ED8" />
                                                <Text style={[styles.tagText, { color: '#1D4ED8' }]}>Boarding Support</Text>
                                            </View>
                                        )}
                                        {booking.assistanceRequested?.walkingAssistance && (
                                            <View style={[styles.tag, { backgroundColor: '#E0E7FF' }]}>
                                                <Ionicons name="walk" size={12} color="#4338CA" />
                                                <Text style={[styles.tagText, { color: '#4338CA' }]}>Walking Escort</Text>
                                            </View>
                                        )}
                                        {booking.assistanceRequested?.prioritySeatAssistance && (
                                            <View style={[styles.tag, { backgroundColor: '#FEF3C7' }]}>
                                                <Ionicons name="star" size={12} color="#D97706" />
                                                <Text style={[styles.tagText, { color: '#D97706' }]}>Priority Seat</Text>
                                            </View>
                                        )}
                                    </View>

                                    {!!booking.specialRequests && (
                                        <Text style={styles.specialNoteText}>Note: {booking.specialRequests}</Text>
                                    )}

                                    {/* Conductor Action Buttons */}
                                    <View style={styles.conductorActionRow}>
                                        {isUpdating ? (
                                            <ActivityIndicator size="small" color="#0066CC" />
                                        ) : (
                                            <>
                                                {status !== 'CONFIRMED' && status !== 'COMPLETED' && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#D1FAE5' }]}
                                                        onPress={() => handleStatusChange(booking.bookingId, 'CONFIRMED')}
                                                    >
                                                        <Text style={[styles.actionBtnText, { color: '#065F46' }]}>
                                                            Acknowledge Request
                                                        </Text>
                                                    </TouchableOpacity>
                                                )}
                                                {status !== 'IN_PROGRESS' && status !== 'COMPLETED' && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#DBEAFE' }]}
                                                        onPress={() => handleStatusChange(booking.bookingId, 'IN_PROGRESS')}
                                                    >
                                                        <Text style={[styles.actionBtnText, { color: '#1E40AF' }]}>
                                                            Assisting Boarding
                                                        </Text>
                                                    </TouchableOpacity>
                                                )}
                                                {status !== 'COMPLETED' && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#F3E8FF' }]}
                                                        onPress={() => handleStatusChange(booking.bookingId, 'COMPLETED')}
                                                    >
                                                        <Text style={[styles.actionBtnText, { color: '#6B21A8' }]}>
                                                            Complete Assistance
                                                        </Text>
                                                    </TouchableOpacity>
                                                )}
                                            </>
                                        )}
                                    </View>
                                </View>
                            )}
                        </View>
                    );
                })
            )}
        </ScrollView>
    );
}

function getStatusLabel(status: string) {
    switch (status) {
        case 'CONFIRMED':
            return 'ACKNOWLEDGED BY CREW';
        case 'IN_PROGRESS':
            return 'ASSISTING BOARDING';
        case 'COMPLETED':
            return 'ASSISTANCE COMPLETED';
        case 'DECLINED':
            return 'UNAVAILABLE';
        default:
            return 'NOTIFIED CONDUCTOR';
    }
}

function getStatusBg(status: string) {
    switch (status) {
        case 'CONFIRMED':
            return '#D1FAE5';
        case 'IN_PROGRESS':
            return '#DBEAFE';
        case 'COMPLETED':
            return '#E0E7FF';
        case 'DECLINED':
            return '#FEE2E2';
        default:
            return '#FEF3C7';
    }
}

function getStatusColor(status: string) {
    switch (status) {
        case 'CONFIRMED':
            return '#065F46';
        case 'IN_PROGRESS':
            return '#1E40AF';
        case 'COMPLETED':
            return '#3730A3';
        case 'DECLINED':
            return '#991B1B';
        default:
            return '#92400E';
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
    },
    centerContainer: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 10,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 8,
    },
    tripSelectorSection: {
        marginBottom: 12,
    },
    tripSelectorLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
        marginBottom: 6,
    },
    tripChipsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    tripChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#BAE6FD',
    },
    tripChipActive: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    tripChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#0066CC',
        marginLeft: 4,
    },
    tripChipTextActive: {
        color: '#FFFFFF',
    },
    qrScannerPlaceholderCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        padding: 12,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderStyle: 'dashed',
    },
    qrScannerIconBox: {
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: '#EBF3FA',
        alignItems: 'center',
        justifyContent: 'center',
    },
    qrScannerTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0F172A',
    },
    comingSoonBadge: {
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    comingSoonBadgeText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#92400E',
    },
    qrScannerSub: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 14,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderTopWidth: 4,
        borderTopColor: '#0F172A',
    },
    statValue: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0F172A',
    },
    statLabel: {
        fontSize: 10,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 2,
        textAlign: 'center',
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 44,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        marginBottom: 12,
    },
    searchInput: {
        flex: 1,
        fontSize: 13,
        color: '#0F172A',
        marginLeft: 8,
    },
    filterChipsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: '#E2E8F0',
    },
    chipActive: {
        backgroundColor: '#0F172A',
    },
    chipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#475569',
    },
    chipTextActive: {
        color: '#FFFFFF',
    },
    emptyContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 30,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
        marginTop: 8,
    },
    emptySub: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 4,
        textAlign: 'center',
    },
    passengerCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    passengerCardWheelchair: {
        borderColor: '#DDD6FE',
        borderLeftWidth: 4,
        borderLeftColor: '#7C3AED',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    seatBadgeGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    seatBadge: {
        backgroundColor: '#0F172A',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    seatBadgeWheelchair: {
        backgroundColor: '#7C3AED',
    },
    seatBadgeText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 12,
    },
    companionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3E8FF',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    companionBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#7C3AED',
        marginLeft: 4,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    statusBadgeText: {
        fontSize: 10,
        fontWeight: '800',
    },
    passengerDetails: {
        gap: 4,
    },
    passengerIdText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1E293B',
    },
    routeStopsText: {
        fontSize: 12,
        color: '#64748B',
    },
    boldText: {
        fontWeight: '700',
        color: '#0F172A',
    },
    assistanceSection: {
        marginTop: 12,
        backgroundColor: '#F8FAFC',
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    assistanceSectionTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        marginBottom: 6,
    },
    assistanceTagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    tagText: {
        fontSize: 11,
        fontWeight: '600',
        marginLeft: 4,
    },
    specialNoteText: {
        fontSize: 11,
        color: '#475569',
        fontStyle: 'italic',
        marginTop: 6,
    },
    conductorActionRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
        justifyContent: 'flex-end',
    },
    actionBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    actionBtnText: {
        fontSize: 11,
        fontWeight: '700',
    },
});
