import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    BoardingVerificationResult,
    Booking,
} from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { AppText as Text } from '../../../shared/ui/AppText';
import { updateAssistanceStatus } from '../../booking/api/bookingApi';
import {
    confirmPassengerBoarding,
    verifyTicketQr,
    confirmReceiverDetails,
} from '../api/manifestApi';
import { ConductorBoardingCard } from './ConductorBoardingCard';
import { QRManifestScannerModal } from './QRManifestScannerModal';

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

type FilterMode = 'ALL' | 'PENDING_ONLY' | 'BOARDED_ONLY' | 'ASSISTANCE_ONLY' | 'RECEIVERS_ONLY';

export function PassengerManifestTab({ busId, numberPlate }: PassengerManifestTabProps) {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [trips, setTrips] = useState<TripTurn[]>([]);
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    // QR Scanner & Boarding Sheet states (MOV-278, MOV-280)
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isVerifyingQr, setIsVerifyingQr] = useState(false);
    const [verificationResult, setVerificationResult] = useState<BoardingVerificationResult | null>(null);
    const [isBoardingSheetOpen, setIsBoardingSheetOpen] = useState(false);
    const [isConfirmingBoarding, setIsConfirmingBoarding] = useState(false);
    const [recentAlert, setRecentAlert] = useState<{ title: string; message: string } | null>(null);

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
                const active = historyData.bookings.filter(
                    (b: Booking) => b.status === 'CONFIRMED'
                );
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

    // --- QR Scanner & Verification Handlers (MOV-278, MOV-279, MOV-280, MOV-281) ---
    async function handleScanTicket(scannedPayload: string) {
        try {
            setIsVerifyingQr(true);
            const result = await verifyTicketQr({
                qrPayload: scannedPayload,
                busId,
                tripId: selectedTripId && selectedTripId !== 'ALL' ? selectedTripId : undefined,
            });

            setVerificationResult(result);
            setIsScannerOpen(false);
            setIsBoardingSheetOpen(true);
        } catch (err: any) {
            const msg = err.message || 'Could not verify ticket QR code.';
            if (Platform.OS === 'web') {
                window.alert(`Ticket Verification Error:\n${msg}`);
            } else {
                Alert.alert('Verification Error', msg);
            }
        } finally {
            setIsVerifyingQr(false);
        }
    }

    async function handleConfirmBoarding(options: {
        bookingId: string;
        cashCollected?: boolean;
        assistanceProgress?: 'IN_PROGRESS' | 'COMPLETED';
    }) {
        try {
            setIsConfirmingBoarding(true);
            const result = await confirmPassengerBoarding({
                bookingId: options.bookingId,
                busId,
                cashCollected: options.cashCollected,
                assistanceProgress: options.assistanceProgress,
            });

            // Update local booking in list
            setBookings((prev) =>
                prev.map((b) => {
                    if (b.bookingId === options.bookingId) {
                        return {
                            ...b,
                            boardingStatus: 'BOARDED',
                            boardedAt: result.boardedAt,
                            paymentStatus: options.cashCollected ? 'PAID' : (b.paymentStatus || 'COLLECT_CASH'),
                            assistanceStatus: options.assistanceProgress || b.assistanceStatus,
                        };
                    }
                    return b;
                })
            );

            setIsBoardingSheetOpen(false);
            setVerificationResult(null);

            const alertTitle = 'Passenger Boarded';
            const alertMsg = result.caregiverNotified
                ? `Seat verified. Passenger and caregiver (${result.caregiverName || 'Guardian'}) notified.`
                : 'Seat verified. Passenger marked as boarded.';

            setRecentAlert({ title: alertTitle, message: alertMsg });
            setTimeout(() => setRecentAlert(null), 5000);

            if (Platform.OS !== 'web') {
                Alert.alert(alertTitle, alertMsg);
            }
        } catch (err: any) {
            const msg = err.message || 'Failed to confirm boarding.';
            if (Platform.OS === 'web') {
                window.alert(msg);
            } else {
                Alert.alert('Confirmation Error', msg);
            }
        } finally {
            setIsConfirmingBoarding(false);
        }
    }

    async function handleConfirmReceiverDetails(bookingId: string) {
        try {
            setUpdatingId(bookingId);
            const result = await confirmReceiverDetails(bookingId);
            
            setBookings((prev) =>
                prev.map((b) => {
                    if (b.bookingId === bookingId && b.receiverDetails) {
                        return {
                            ...b,
                            receiverDetails: {
                                ...b.receiverDetails,
                                confirmed: true,
                                confirmedAt: result.confirmedAt,
                            },
                        };
                    }
                    return b;
                })
            );

            const alertTitle = 'Receiver Confirmed';
            const alertMsg = 'Receiver details have been successfully confirmed.';
            setRecentAlert({ title: alertTitle, message: alertMsg });
            setTimeout(() => setRecentAlert(null), 5000);

            if (Platform.OS !== 'web') {
                Alert.alert(alertTitle, alertMsg);
            }
        } catch (err: any) {
            const msg = err.message || 'Failed to confirm receiver details.';
            if (Platform.OS === 'web') {
                window.alert(msg);
            } else {
                Alert.alert('Error', msg);
            }
        } finally {
            setUpdatingId(null);
        }
    }

    // Filter bookings by selected trip turn (if any selected)
    const tripBookings = useMemo(() => {
        if (!selectedTripId || selectedTripId === 'ALL') return bookings;
        return bookings.filter((b) => b.tripId === selectedTripId);
    }, [bookings, selectedTripId]);

    // Stats calculation for current trip selection
    const totalPassengers = tripBookings.length;
    const boardedCount = tripBookings.filter((b) => b.boardingStatus === 'BOARDED').length;
    const pendingBoardingCount = totalPassengers - boardedCount;
    const progressPercent = totalPassengers > 0 ? Math.round((boardedCount / totalPassengers) * 100) : 0;

    const assistanceCount = tripBookings.filter(
        (b) =>
            b.assistanceRequested?.wheelchairAssistance ||
            b.assistanceRequested?.boardingAssistance ||
            b.assistanceRequested?.walkingAssistance ||
            b.assistanceRequested?.prioritySeatAssistance
    ).length;

    const receiverCount = tripBookings.filter((b) => !!b.receiverDetails).length;

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
            } else if (filterMode === 'BOARDED_ONLY') {
                if (b.boardingStatus !== 'BOARDED') return false;
            } else if (filterMode === 'PENDING_ONLY') {
                if (b.boardingStatus === 'BOARDED') return false;
            } else if (filterMode === 'RECEIVERS_ONLY') {
                if (!b.receiverDetails) return false;
            }

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const matchSeat = b.seatNumber?.toLowerCase().includes(q);
                const matchName = b.passengerName?.toLowerCase().includes(q);
                const matchUser = b.userId?.toLowerCase().includes(q);
                const matchBookingId = b.bookingId?.toLowerCase().includes(q);
                const matchStart = b.journey?.startLocation?.toLowerCase().includes(q);
                const matchEnd = b.journey?.endLocation?.toLowerCase().includes(q);
                const matchCompanion = b.pairedSeatNumber?.toLowerCase().includes(q);
                return matchSeat || matchName || matchUser || matchBookingId || matchStart || matchEnd || matchCompanion;
            }

            return true;
        });
    }, [tripBookings, filterMode, searchQuery]);

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.loadingText}>Loading passenger manifest...</Text>
            </View>
        );
    }

    return (
        <View style={styles.screenWrapper}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={{ paddingBottom: 110 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Recent Action Success Banner */}
                {recentAlert && (
                    <View style={styles.recentAlertBanner}>
                        <Ionicons name="checkmark-circle" size={18} color="#059669" />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={styles.recentAlertTitle}>{recentAlert.title}</Text>
                            <Text style={styles.recentAlertMessage}>{recentAlert.message}</Text>
                        </View>
                        <TouchableOpacity onPress={() => setRecentAlert(null)}>
                            <Ionicons name="close" size={16} color="#065F46" />
                        </TouchableOpacity>
                    </View>
                )}

                {/* Unified Trip & Boarding Overview Card */}
                <View style={styles.overviewCard}>
                    {/* Trip Turns Selector Strip */}
                    {trips.length > 0 && (
                        <View style={styles.turnSelectorRow}>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.turnScrollContent}
                            >
                                <TouchableOpacity
                                    style={[
                                        styles.turnPill,
                                        selectedTripId === 'ALL' && styles.turnPillActive,
                                    ]}
                                    onPress={() => setSelectedTripId('ALL')}
                                >
                                    <Text
                                        style={[
                                            styles.turnPillText,
                                            selectedTripId === 'ALL' && styles.turnPillTextActive,
                                        ]}
                                    >
                                        All Turns ({bookings.length})
                                    </Text>
                                </TouchableOpacity>

                                {trips.map((t) => {
                                    const isSel = selectedTripId === t.tripId;
                                    const count = bookings.filter((b) => b.tripId === t.tripId).length;
                                    return (
                                        <TouchableOpacity
                                            key={t.tripId}
                                            style={[
                                                styles.turnPill,
                                                isSel && styles.turnPillActive,
                                            ]}
                                            onPress={() => setSelectedTripId(t.tripId)}
                                        >
                                            <Ionicons
                                                name="time-outline"
                                                size={13}
                                                color={isSel ? '#FFFFFF' : '#64748B'}
                                            />
                                            <Text
                                                style={[
                                                    styles.turnPillText,
                                                    isSel && styles.turnPillTextActive,
                                                ]}
                                            >
                                                Turn {t.turnNumber} ({t.departureTime || 'Trip'}) · {count}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    )}

                    {/* Boarding Progress Meter */}
                    <View style={styles.progressSection}>
                        <View style={styles.progressHeader}>
                            <Text style={styles.progressLabel}>Boarding Status</Text>
                            <Text style={styles.progressCounter}>
                                <Text style={styles.progressBold}>{boardedCount}</Text> of {totalPassengers} Boarded ({progressPercent}%)
                            </Text>
                        </View>

                        {/* Progress Line */}
                        <View style={styles.progressBarTrack}>
                            <View
                                style={[
                                    styles.progressBarFill,
                                    { width: `${progressPercent}%` },
                                ]}
                            />
                        </View>
                    </View>

                    {/* Clean Compact Metrics Grid */}
                    <View style={styles.metricsRow}>
                        <View style={styles.metricItem}>
                            <Text style={styles.metricValue}>{totalPassengers}</Text>
                            <Text style={styles.metricLabel}>Booked</Text>
                        </View>
                        <View style={styles.metricDivider} />
                        <View style={styles.metricItem}>
                            <Text style={[styles.metricValue, { color: '#059669' }]}>{boardedCount}</Text>
                            <Text style={styles.metricLabel}>Boarded</Text>
                        </View>
                        <View style={styles.metricDivider} />
                        <View style={styles.metricItem}>
                            <Text style={[styles.metricValue, { color: '#D97706' }]}>{pendingBoardingCount}</Text>
                            <Text style={styles.metricLabel}>Awaiting</Text>
                        </View>
                        <View style={styles.metricDivider} />
                        <View style={styles.metricItem}>
                            <Text style={[styles.metricValue, { color: '#6D28D9' }]}>{assistanceCount}</Text>
                            <Text style={styles.metricLabel}>Assistance</Text>
                        </View>
                        <View style={styles.metricDivider} />
                        <View style={styles.metricItem}>
                            <Text style={[styles.metricValue, { color: '#0284C7' }]}>{receiverCount}</Text>
                            <Text style={styles.metricLabel}>Receivers</Text>
                        </View>
                    </View>
                </View>

                {/* Search Bar */}
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={16} color="#64748B" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search seat, passenger ID, or halt..."
                        placeholderTextColor="#94A3B8"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {!!searchQuery && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={16} color="#94A3B8" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Segmented Filter Bar */}
                <View style={styles.filterBar}>
                    <TouchableOpacity
                        style={[styles.filterTab, filterMode === 'ALL' && styles.filterTabActive]}
                        onPress={() => setFilterMode('ALL')}
                    >
                        <Text style={[styles.filterTabText, filterMode === 'ALL' && styles.filterTabTextActive]}>
                            All ({totalPassengers})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterTab, filterMode === 'PENDING_ONLY' && styles.filterTabActive]}
                        onPress={() => setFilterMode('PENDING_ONLY')}
                    >
                        <Text style={[styles.filterTabText, filterMode === 'PENDING_ONLY' && styles.filterTabTextActive]}>
                            Awaiting ({pendingBoardingCount})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterTab, filterMode === 'BOARDED_ONLY' && styles.filterTabActive]}
                        onPress={() => setFilterMode('BOARDED_ONLY')}
                    >
                        <Text style={[styles.filterTabText, filterMode === 'BOARDED_ONLY' && styles.filterTabTextActive]}>
                            Boarded ({boardedCount})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterTab, filterMode === 'ASSISTANCE_ONLY' && styles.filterTabActive]}
                        onPress={() => setFilterMode('ASSISTANCE_ONLY')}
                    >
                        <Text style={[styles.filterTabText, filterMode === 'ASSISTANCE_ONLY' && styles.filterTabTextActive]}>
                            Assist ({assistanceCount})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterTab, filterMode === 'RECEIVERS_ONLY' && styles.filterTabActive]}
                        onPress={() => setFilterMode('RECEIVERS_ONLY')}
                    >
                        <Text style={[styles.filterTabText, filterMode === 'RECEIVERS_ONLY' && styles.filterTabTextActive]}>
                            Receivers ({receiverCount})
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Passenger Manifest List */}
                {filteredBookings.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="people-outline" size={36} color="#94A3B8" />
                        <Text style={styles.emptyTitle}>No passengers found</Text>
                        <Text style={styles.emptySub}>
                            {searchQuery
                                ? `No results matching "${searchQuery}".`
                                : 'No passenger records for this filter.'}
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

                        const isBoarded = booking.boardingStatus === 'BOARDED';
                        const isPaid = booking.paymentStatus === 'PAID';

                        return (
                            <TouchableOpacity
                                key={booking.bookingId}
                                style={[
                                    styles.passengerCard,
                                    isBoarded && styles.passengerCardBoarded,
                                ]}
                                activeOpacity={0.85}
                                onPress={() => handleScanTicket(booking.qrPayload || booking.bookingId)}
                            >
                                {/* Card Header Row: Seat, Passenger Name & Boarding Status */}
                                <View style={styles.passengerCardTop}>
                                    <View style={styles.seatAndIdGroup}>
                                        <View
                                            style={[
                                                styles.seatBadge,
                                                isWheelchair && styles.seatBadgeWheelchair,
                                                isBoarded && styles.seatBadgeBoarded,
                                            ]}
                                        >
                                            <Text style={styles.seatBadgeLabel}>SEAT</Text>
                                            <Text style={styles.seatBadgeText}>{booking.seatNumber}</Text>
                                        </View>

                                        <View style={styles.idWrapper}>
                                            <Text style={styles.passengerNameText} numberOfLines={1}>
                                                {booking.passengerName || booking.userId || 'Guest Passenger'}
                                            </Text>
                                            <Text style={styles.passengerSubIdText} numberOfLines={1}>
                                                Ref: {booking.bookingId} {booking.userId && booking.userId !== booking.passengerName ? `· ${booking.userId}` : ''}
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Boarding Status Pill (Awaiting vs Boarded) */}
                                    <View
                                        style={[
                                            styles.boardingStatusPill,
                                            isBoarded ? styles.boardingPillBoarded : styles.boardingPillAwaiting,
                                        ]}
                                    >
                                        <Ionicons
                                            name={isBoarded ? 'checkmark-circle' : 'time-outline'}
                                            size={12}
                                            color={isBoarded ? '#059669' : '#D97706'}
                                        />
                                        <Text
                                            style={[
                                                styles.boardingStatusPillText,
                                                { color: isBoarded ? '#065F46' : '#92400E' },
                                            ]}
                                        >
                                            {isBoarded ? 'BOARDED' : 'AWAITING'}
                                        </Text>
                                    </View>
                                </View>

                                {/* Route Details (Pickup -> Drop-off Destination) */}
                                <View style={styles.routeSection}>
                                    <Text style={styles.routeText}>
                                        <Text style={styles.pickupText}>{booking.journey?.startLocation || 'Pickup'}</Text>
                                        <Ionicons name="arrow-forward" size={12} color="#0066CC" />{' '}
                                        <Text style={styles.dropOffText}>{booking.journey?.endLocation || 'Destination'}</Text>
                                    </Text>
                                </View>

                                {/* Card Bottom Row: Cash Payment Status & Assistance Badges */}
                                <View style={styles.cardBottomRow}>
                                    <View style={[styles.cashBadge, isPaid ? styles.cashBadgePaid : styles.cashBadgePending]}>
                                        <Ionicons
                                            name={isPaid ? 'checkmark-circle' : 'cash-outline'}
                                            size={12}
                                            color={isPaid ? '#047857' : '#B45309'}
                                        />
                                        <Text style={[styles.cashBadgeText, { color: isPaid ? '#065F46' : '#92400E' }]}>
                                            {isPaid
                                                ? `LKR ${booking.fare?.totalFare ?? '—'} · Cash Collected`
                                                : `LKR ${booking.fare?.totalFare ?? '—'} · Cash to Collect`}
                                        </Text>
                                    </View>

                                    <View style={styles.assistanceTagsRow}>
                                        {isWheelchair && (
                                            <View style={styles.miniAssistTag}>
                                                <Ionicons name="accessibility" size={10} color="#7C3AED" />
                                                <Text style={styles.miniAssistTagText}>Wheelchair</Text>
                                            </View>
                                        )}
                                        {booking.pairedSeatNumber && (
                                            <View style={styles.miniAssistTag}>
                                                <Ionicons name="people" size={10} color="#7C3AED" />
                                                <Text style={styles.miniAssistTagText}>+ Companion {booking.pairedSeatNumber}</Text>
                                            </View>
                                        )}
                                        {booking.isPrioritySeat && !isWheelchair && (
                                            <View style={[styles.miniAssistTag, { backgroundColor: '#FEF3C7' }]}>
                                                <Ionicons name="star" size={10} color="#D97706" />
                                                <Text style={[styles.miniAssistTagText, { color: '#92400E' }]}>Priority</Text>
                                            </View>
                                        )}
                                    </View>

                                    {booking.receiverDetails && (
                                        <View style={styles.receiverSection}>
                                            <View style={styles.receiverInfo}>
                                                <Ionicons name="person-outline" size={14} color="#64748B" />
                                                <Text style={styles.receiverNameText}>{booking.receiverDetails.name}</Text>
                                                <Text style={styles.receiverPhoneText}>({booking.receiverDetails.phone})</Text>
                                            </View>
                                            <TouchableOpacity
                                                style={[
                                                    styles.confirmReceiverBtn,
                                                    booking.receiverDetails.confirmed && styles.confirmReceiverBtnDone
                                                ]}
                                                onPress={() => !booking.receiverDetails?.confirmed && handleConfirmReceiverDetails(booking.bookingId)}
                                                disabled={booking.receiverDetails.confirmed || updatingId === booking.bookingId}
                                            >
                                                {updatingId === booking.bookingId ? (
                                                    <ActivityIndicator size="small" color={booking.receiverDetails.confirmed ? "#059669" : "#FFFFFF"} />
                                                ) : booking.receiverDetails.confirmed ? (
                                                    <>
                                                        <Ionicons name="checkmark-circle" size={14} color="#059669" />
                                                        <Text style={styles.confirmReceiverBtnTextDone}>Confirmed</Text>
                                                    </>
                                                ) : (
                                                    <Text style={styles.confirmReceiverBtnText}>Confirm Receiver</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            </TouchableOpacity>
                        );
                    })
                )}
            </ScrollView>

            {/* Sticky Floating Action Bar for Scanner (One-Tap Access) */}
            <View style={styles.stickyBottomBar}>
                <TouchableOpacity
                    style={styles.floatingScanBtn}
                    onPress={() => setIsScannerOpen(true)}
                    activeOpacity={0.9}
                >
                    <Ionicons name="qr-code-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.floatingScanBtnText}>Scan Passenger Ticket QR</Text>
                </TouchableOpacity>
            </View>

            {/* QR Scanner Modal (MOV-278) */}
            <QRManifestScannerModal
                visible={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onScanTicket={handleScanTicket}
                currentBookings={tripBookings}
                isProcessing={isVerifyingQr}
            />

            {/* Conductor Boarding Sheet (MOV-280) */}
            <ConductorBoardingCard
                visible={isBoardingSheetOpen}
                verificationResult={verificationResult}
                onClose={() => {
                    setIsBoardingSheetOpen(false);
                    setVerificationResult(null);
                }}
                onConfirmBoarding={handleConfirmBoarding}
                isConfirming={isConfirmingBoarding}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screenWrapper: {
        flex: 1,
        position: 'relative',
    },
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
        fontWeight: '600',
    },
    recentAlertBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ECFDF5',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    recentAlertTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#065F46',
    },
    recentAlertMessage: {
        fontSize: 11,
        color: '#047857',
        marginTop: 2,
    },
    overviewCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    turnSelectorRow: {
        marginBottom: 12,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    turnScrollContent: {
        flexDirection: 'row',
        gap: 6,
    },
    turnPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 4,
    },
    turnPillActive: {
        backgroundColor: '#0066CC',
    },
    turnPillText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#475569',
    },
    turnPillTextActive: {
        color: '#FFFFFF',
    },
    progressSection: {
        marginBottom: 12,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    progressLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#0F172A',
    },
    progressCounter: {
        fontSize: 11,
        color: '#64748B',
    },
    progressBold: {
        fontWeight: '800',
        color: '#059669',
    },
    progressBarTrack: {
        height: 6,
        backgroundColor: '#F1F5F9',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#059669',
        borderRadius: 3,
    },
    metricsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#F8FAFC',
    },
    metricItem: {
        alignItems: 'center',
    },
    receiverSection: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    receiverInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    receiverNameText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#334155',
        marginLeft: 6,
        marginRight: 4,
    },
    receiverPhoneText: {
        fontSize: 12,
        color: '#64748B',
    },
    confirmReceiverBtn: {
        backgroundColor: '#0066CC',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
    },
    confirmReceiverBtnDone: {
        backgroundColor: '#D1FAE5',
    },
    confirmReceiverBtnText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    confirmReceiverBtnTextDone: {
        color: '#059669',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    metricValue: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    metricLabel: {
        fontSize: 10,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 1,
    },
    metricDivider: {
        width: 1,
        height: 20,
        backgroundColor: '#E2E8F0',
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 40,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 13,
        color: '#0F172A',
        marginLeft: 8,
    },
    filterBar: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderRadius: 10,
        padding: 3,
        marginBottom: 12,
    },
    filterTab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 6,
        borderRadius: 8,
    },
    filterTabActive: {
        backgroundColor: '#FFFFFF',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
    },
    filterTabText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    filterTabTextActive: {
        color: '#0F172A',
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
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
        marginTop: 8,
    },
    emptySub: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
        textAlign: 'center',
    },
    passengerCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        gap: 8,
    },
    passengerCardBoarded: {
        backgroundColor: '#F8FAFC',
        borderColor: '#CBD5E1',
    },
    passengerCardTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    seatAndIdGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
    },
    seatBadge: {
        backgroundColor: '#0F172A',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 46,
    },
    seatBadgeWheelchair: {
        backgroundColor: '#6D28D9',
    },
    seatBadgeBoarded: {
        backgroundColor: '#059669',
    },
    seatBadgeLabel: {
        color: '#94A3B8',
        fontSize: 8,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    seatBadgeText: {
        color: '#FFFFFF',
        fontWeight: '900',
        fontSize: 13,
    },
    idWrapper: {
        flex: 1,
        justifyContent: 'center',
    },
    passengerNameText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 1,
    },
    passengerSubIdText: {
        fontSize: 11,
        color: '#64748B',
        fontWeight: '600',
    },
    boardingStatusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    boardingPillBoarded: {
        backgroundColor: '#ECFDF5',
    },
    boardingPillAwaiting: {
        backgroundColor: '#FFFBEB',
    },
    boardingStatusPillText: {
        fontSize: 10,
        fontWeight: '800',
    },
    routeSection: {
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    routeText: {
        fontSize: 12,
        color: '#475569',
    },
    pickupText: {
        color: '#64748B',
        fontWeight: '600',
    },
    dropOffText: {
        color: '#0066CC',
        fontWeight: '800',
    },
    cardBottomRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 2,
    },
    cashBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
    },
    cashBadgePaid: {
        backgroundColor: '#ECFDF5',
    },
    cashBadgePending: {
        backgroundColor: '#FFFBEB',
    },
    cashBadgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    assistanceTagsRow: {
        flexDirection: 'row',
        gap: 4,
    },
    miniAssistTag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F5F3FF',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        gap: 3,
    },
    miniAssistTagText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#6D28D9',
    },
    stickyBottomBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: Platform.OS === 'ios' ? 28 : 12,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
    },
    floatingScanBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0066CC',
        paddingVertical: 13,
        borderRadius: 12,
        gap: 8,
    },
    floatingScanBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
    },
});
