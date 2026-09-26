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
import { ActiveJourney } from '../utils/journeyControl';
import { ConductorBoardingCard } from './ConductorBoardingCard';
import { QRManifestScannerModal } from './QRManifestScannerModal';
import { IssueWalkinTicketModal } from './IssueWalkinTicketModal';

interface PassengerManifestTabProps {
    busId?: string;
    numberPlate?: string;
    activeJourney?: ActiveJourney | null;
    onNavigateToTripControl?: () => void;
}

interface TripTurn {
    tripId: string;
    turnNumber: number;
    departureTime: string;
    estimatedArrivalTime?: string;
    status?: string;
}

type FilterMode = 'ALL' | 'PENDING_ONLY' | 'BOARDED_ONLY' | 'ASSISTANCE_ONLY' | 'RECEIVERS_ONLY';

export function PassengerManifestTab({
    busId,
    numberPlate,
    activeJourney,
    onNavigateToTripControl,
}: PassengerManifestTabProps) {
    const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
    const tomorrowStr = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    }, []);

    const [bookings, setBookings] = useState<Booking[]>([]);
    const [trips, setTrips] = useState<TripTurn[]>([]);
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>(todayStr);
    const [selectedStop, setSelectedStop] = useState<string>('ALL');

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

    // On-board Walk-in Ticketing state
    const [isWalkinModalOpen, setIsWalkinModalOpen] = useState(false);

    const isTripLive = !!activeJourney && !!activeJourney.trip?.tripId;

    function handleWalkinTicketIssued(newBooking: Booking) {
        setBookings((prev) => [newBooking, ...prev]);
        const alertTitle = 'Walk-in Ticket Issued';
        const alertMsg = `Seat ${newBooking.seatNumber} issued to ${newBooking.passengerName || 'Walk-in Passenger'} (LKR ${newBooking.fare?.totalFare ?? '—'}). Marked as BOARDED.`;
        setRecentAlert({ title: alertTitle, message: alertMsg });
        setTimeout(() => setRecentAlert(null), 5000);
    }

    // Auto-synchronize manifest to the active running journey if one is live
    useEffect(() => {
        if (activeJourney?.trip?.tripId) {
            setSelectedTripId(activeJourney.trip.tripId);
            setSelectedDate(todayStr);
        }
    }, [activeJourney?.trip?.tripId, todayStr]);

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
                    const defaultTrip = activeJourney?.trip?.tripId || tripsData.trips[0].tripId;
                    setSelectedTripId(defaultTrip);
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

    // --- Card Click Handler (Enforces Live Trip state) ---
    function handleCardPress(booking: Booking) {
        if (!isTripLive) {
            const msg = 'Please start this journey from the "Trip Control" tab before boarding passengers.';
            if (Platform.OS === 'web') {
                window.alert(`Trip Not Active\n${msg}`);
            } else {
                Alert.alert(
                    'Trip Not Active',
                    msg,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        {
                            text: 'Go to Trip Control',
                            onPress: onNavigateToTripControl,
                        },
                    ]
                );
            }
            return;
        }

        handleScanTicket(booking.qrPayload || booking.bookingId);
    }

    // --- QR Scanner & Verification Handlers (MOV-278, MOV-279, MOV-280, MOV-281) ---
    async function handleScanTicket(scannedPayload: string) {
        try {
            setIsVerifyingQr(true);
            const result = await verifyTicketQr({
                qrPayload: scannedPayload,
                busId,
                tripId: selectedTripId && selectedTripId !== 'ALL' ? selectedTripId : undefined,
                date: selectedDate && selectedDate !== 'ALL' ? selectedDate : todayStr,
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
                date: selectedDate && selectedDate !== 'ALL' ? selectedDate : todayStr,
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
                            paymentMethod: options.cashCollected ? 'CASH' : b.paymentMethod,
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

    // Filter bookings by selected operational date
    const dateFilteredBookings = useMemo(() => {
        // If a live journey is running, strictly isolate to today's active date
        if (activeJourney) {
            return bookings.filter((b) => {
                const bDate =
                    b.travelDate ||
                    b.journeyDate ||
                    b.departureDate ||
                    b.journey?.departureDate ||
                    b.journey?.journeyDate;
                return bDate ? bDate === todayStr : true;
            });
        }

        if (!selectedDate || selectedDate === 'ALL') return bookings;
        return bookings.filter((b) => {
            const bDate =
                b.travelDate ||
                b.journeyDate ||
                b.departureDate ||
                b.journey?.departureDate ||
                b.journey?.journeyDate;
            return bDate ? bDate === selectedDate : true;
        });
    }, [bookings, selectedDate, activeJourney, todayStr]);

    // Filter bookings by selected trip turn (if any selected or active)
    const tripBookings = useMemo(() => {
        const targetTripId = activeJourney?.trip?.tripId || selectedTripId;
        if (!targetTripId || targetTripId === 'ALL') return dateFilteredBookings;
        return dateFilteredBookings.filter((b) => b.tripId === targetTripId);
    }, [dateFilteredBookings, selectedTripId, activeJourney]);

    // Extract unique boarding stops along this trip's route for quick stop-by-stop filtering
    const availableStops = useMemo(() => {
        const stops = new Set<string>();
        tripBookings.forEach((b) => {
            if (b.journey?.startLocation) {
                stops.add(b.journey.startLocation);
            }
        });
        return Array.from(stops);
    }, [tripBookings]);

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

    const totalCashToCollect = useMemo(() => {
        return tripBookings
            .filter((b) => b.paymentStatus !== 'PAID')
            .reduce((sum, b) => sum + (b.fare?.totalFare || 0), 0);
    }, [tripBookings]);

    // Intelligent Real-World Boarding Order & Filtering:
    // 1. Awaiting passengers first (at upcoming pickup halts), then Boarded passengers
    // 2. Grouped/Sorted by Stop Sequence (startLocation)
    // 3. Wheelchair / Accessibility needs prioritized at each stop
    const filteredBookings = useMemo(() => {
        const list = tripBookings.filter((b) => {
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

            if (selectedStop !== 'ALL') {
                if (b.journey?.startLocation !== selectedStop) return false;
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

        // Sort: Awaiting passengers first, ordered by stop name, then boarded
        return list.sort((a, b) => {
            const aBoarded = a.boardingStatus === 'BOARDED' ? 1 : 0;
            const bBoarded = b.boardingStatus === 'BOARDED' ? 1 : 0;
            if (aBoarded !== bBoarded) return aBoarded - bBoarded;

            const stopCompare = (a.journey?.startLocation || '').localeCompare(b.journey?.startLocation || '');
            if (stopCompare !== 0) return stopCompare;

            // Prioritize wheelchair / assistance at same stop
            const aAst = a.seatNumber?.startsWith('W') || a.assistanceRequested?.wheelchairAssistance ? 0 : 1;
            const bAst = b.seatNumber?.startsWith('W') || b.assistanceRequested?.wheelchairAssistance ? 0 : 1;
            if (aAst !== bAst) return aAst - bAst;

            return (a.seatNumber || '').localeCompare(b.seatNumber || '');
        });
    }, [tripBookings, filterMode, searchQuery, selectedStop]);

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
                contentContainerStyle={[
                    styles.scrollContentContainer,
                    !isTripLive && { paddingBottom: 40 }, // Normal padding when scan bar is not floating
                ]}
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
                        <TouchableOpacity onPress={() => setRecentAlert(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Ionicons name="close" size={16} color="#065F46" />
                        </TouchableOpacity>
                    </View>
                )}

                {/* --- 1. UNIFIED ENTERPRISE TRIP HEADER CARD --- */}
                {isTripLive ? (
                    /* When trip is ACTIVE: Clean, elegant executive transit card with brand blue styling */
                    <View style={styles.activeJourneyCard}>
                        <View style={styles.activeLiveTop}>
                            <View style={styles.livePulseGroup}>
                                <View style={styles.livePulseDot} />
                                <Text style={styles.livePulseText}>LIVE RUNNING JOURNEY</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.tripControlJumpBtn}
                                onPress={onNavigateToTripControl}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.tripControlJumpText}>Trip Control</Text>
                                <Ionicons name="chevron-forward" size={12} color="#0066CC" />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.activeRouteDetails}>
                            <View style={styles.activeRouteBadge}>
                                <Ionicons name="bus" size={16} color="#0066CC" />
                                <Text style={styles.activeRouteBadgeText}>
                                    Route {activeJourney?.trip?.routeNumber ?? '—'}
                                </Text>
                            </View>
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.activeRouteName} numberOfLines={1}>
                                    {activeJourney?.trip?.routeName || 'Active Transit Service'}
                                </Text>
                                <Text style={styles.activeRouteStops} numberOfLines={1}>
                                    {activeJourney?.trip?.origin && activeJourney?.trip?.destination
                                        ? `${activeJourney.trip.origin} ➔ ${activeJourney.trip.destination}`
                                        : 'Active Road Route'}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.activeTurnMetaRow}>
                            <View style={styles.turnMetaChip}>
                                <Ionicons name="time-outline" size={13} color="#0066CC" />
                                <Text style={styles.turnMetaText}>
                                    Turn {activeJourney?.trip?.turnNumber ?? 1} ({activeJourney?.trip?.departureTime || 'Trip'})
                                </Text>
                            </View>
                            <View style={styles.turnMetaChip}>
                                <Ionicons name="calendar-outline" size={13} color="#0066CC" />
                                <Text style={styles.turnMetaText}>Today ({todayStr})</Text>
                            </View>
                        </View>
                    </View>
                ) : (
                    /* When NO trip is active: Standby Depot card + Schedule Preview Selector */
                    <View style={styles.standbySection}>
                        {/* Standby Notice Banner with Quick Action to Trip Control */}
                        <View style={styles.standbyNoticeCard}>
                            <View style={styles.standbyNoticeIconBox}>
                                <Ionicons name="pause-circle" size={22} color="#0066CC" />
                            </View>
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.standbyNoticeTitle}>Bus on Standby (Depot Mode)</Text>
                                <Text style={styles.standbyNoticeDesc}>
                                    Start a journey in Trip Control to activate ticket QR scanning & live passenger boarding.
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.standbyActionBtn}
                                onPress={onNavigateToTripControl}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.standbyActionBtnText}>Start Trip</Text>
                                <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
                            </TouchableOpacity>
                        </View>

                        {/* Operational Schedule Selector */}
                        <View style={styles.shiftCard}>
                            <View style={styles.dateSelectorContainer}>
                                <View style={styles.dateHeaderRow}>
                                    <Ionicons name="calendar" size={14} color="#0066CC" />
                                    <Text style={styles.dateHeaderLabel}>Operational Schedule</Text>
                                </View>
                                <View style={styles.dateSegmentBar}>
                                    <TouchableOpacity
                                        style={[styles.dateSegmentItem, selectedDate === todayStr && styles.dateSegmentActive]}
                                        onPress={() => setSelectedDate(todayStr)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.dateSegmentText, selectedDate === todayStr && styles.dateSegmentTextActive]}>
                                            Today
                                        </Text>
                                        <Text style={[styles.dateSegmentSubText, selectedDate === todayStr && styles.dateSegmentSubTextActive]}>
                                            {todayStr.slice(5)}
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.dateSegmentItem, selectedDate === tomorrowStr && styles.dateSegmentActive]}
                                        onPress={() => setSelectedDate(tomorrowStr)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.dateSegmentText, selectedDate === tomorrowStr && styles.dateSegmentTextActive]}>
                                            Tomorrow
                                        </Text>
                                        <Text style={[styles.dateSegmentSubText, selectedDate === tomorrowStr && styles.dateSegmentSubTextActive]}>
                                            {tomorrowStr.slice(5)}
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.dateSegmentItem, selectedDate === 'ALL' && styles.dateSegmentActive]}
                                        onPress={() => setSelectedDate('ALL')}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.dateSegmentText, selectedDate === 'ALL' && styles.dateSegmentTextActive]}>
                                            All Dates
                                        </Text>
                                        <Text style={[styles.dateSegmentSubText, selectedDate === 'ALL' && styles.dateSegmentSubTextActive]}>
                                            ({bookings.length})
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Trip Turn Carousel Strip */}
                            {trips.length > 0 && (
                                <View style={styles.turnSection}>
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
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons
                                                name="layers-outline"
                                                size={14}
                                                color={selectedTripId === 'ALL' ? '#FFFFFF' : '#475569'}
                                            />
                                            <Text
                                                style={[
                                                    styles.turnPillText,
                                                    selectedTripId === 'ALL' && styles.turnPillTextActive,
                                                ]}
                                            >
                                                All Turns ({dateFilteredBookings.length})
                                            </Text>
                                        </TouchableOpacity>

                                        {trips.map((t) => {
                                            const isSel = selectedTripId === t.tripId;
                                            const count = dateFilteredBookings.filter((b) => b.tripId === t.tripId).length;
                                            return (
                                                <TouchableOpacity
                                                    key={t.tripId}
                                                    style={[
                                                        styles.turnPill,
                                                        isSel && styles.turnPillActive,
                                                    ]}
                                                    onPress={() => setSelectedTripId(t.tripId)}
                                                    activeOpacity={0.8}
                                                >
                                                    <Ionicons
                                                        name="time-outline"
                                                        size={14}
                                                        color={isSel ? '#FFFFFF' : '#0066CC'}
                                                    />
                                                    <Text
                                                        style={[
                                                            styles.turnPillText,
                                                            isSel && styles.turnPillTextActive,
                                                        ]}
                                                    >
                                                        Turn {t.turnNumber} ({t.departureTime || 'Trip'})
                                                    </Text>
                                                    <View style={[styles.turnCountBadge, isSel && styles.turnCountBadgeActive]}>
                                                        <Text style={[styles.turnCountText, isSel && styles.turnCountTextActive]}>
                                                            {count}
                                                        </Text>
                                                    </View>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* --- 2. HIGH-IMPACT OPERATIONS SUMMARY COCKPIT --- */}
                <View style={styles.cockpitCard}>
                    {/* Progress Bar & Header */}
                    <View style={styles.cockpitTopRow}>
                        <View>
                            <Text style={styles.cockpitTitle}>Boarding Overview</Text>
                            <Text style={styles.cockpitSubtitle}>
                                {totalPassengers > 0
                                    ? `${boardedCount} of ${totalPassengers} passengers boarded`
                                    : 'No passengers scheduled'}
                            </Text>
                        </View>
                        <View style={styles.progressPercentPill}>
                            <Text style={styles.progressPercentText}>{progressPercent}%</Text>
                        </View>
                    </View>

                    {/* Visual Progress Bar Track */}
                    <View style={styles.progressBarTrack}>
                        <View
                            style={[
                                styles.progressBarFill,
                                { width: `${progressPercent}%` },
                            ]}
                        />
                    </View>

                    {/* Operational KPI Tiles (Real-world action centers) */}
                    <View style={styles.kpiGrid}>
                        <View style={styles.kpiTile}>
                            <View style={[styles.kpiIconBox, { backgroundColor: '#EFF6FF' }]}>
                                <Ionicons name="people" size={15} color="#0066CC" />
                            </View>
                            <Text style={styles.kpiValue}>{totalPassengers}</Text>
                            <Text style={styles.kpiLabel}>Booked</Text>
                        </View>

                        <View style={styles.kpiTile}>
                            <View style={[styles.kpiIconBox, { backgroundColor: '#FFFBEB' }]}>
                                <Ionicons name="hourglass" size={15} color="#D97706" />
                            </View>
                            <Text style={[styles.kpiValue, { color: '#B45309' }]}>{pendingBoardingCount}</Text>
                            <Text style={styles.kpiLabel}>Awaiting</Text>
                        </View>

                        <View style={styles.kpiTile}>
                            <View style={[styles.kpiIconBox, { backgroundColor: '#F5F3FF' }]}>
                                <Ionicons name="accessibility" size={15} color="#7C3AED" />
                            </View>
                            <Text style={[styles.kpiValue, { color: '#6D28D9' }]}>{assistanceCount}</Text>
                            <Text style={styles.kpiLabel}>Special Needs</Text>
                        </View>

                        <View style={styles.kpiTile}>
                            <View style={[styles.kpiIconBox, { backgroundColor: '#ECFDF5' }]}>
                                <Ionicons name="cash-outline" size={15} color="#059669" />
                            </View>
                            <Text style={[styles.kpiValue, { color: '#047857' }]}>
                                {totalCashToCollect > 0 ? `LKR ${totalCashToCollect}` : 'LKR 0'}
                            </Text>
                            <Text style={styles.kpiLabel}>To Collect</Text>
                        </View>
                    </View>
                </View>

                {/* --- 3. STOP-BY-STOP ROUTE HALT SELECTOR (Sequential Boarding) --- */}
                {availableStops.length > 1 && (
                    <View style={styles.stopFilterSection}>
                        <View style={styles.stopFilterHeader}>
                            <Ionicons name="location-outline" size={14} color="#0066CC" />
                            <Text style={styles.stopFilterLabel}>Route Halts (Boarding Sequence):</Text>
                        </View>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.stopFilterScroll}
                        >
                            <TouchableOpacity
                                style={[styles.stopChip, selectedStop === 'ALL' && styles.stopChipActive]}
                                onPress={() => setSelectedStop('ALL')}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.stopChipText, selectedStop === 'ALL' && styles.stopChipTextActive]}>
                                    All Halts ({tripBookings.length})
                                </Text>
                            </TouchableOpacity>

                            {availableStops.map((stop) => {
                                const countAtStop = tripBookings.filter((b) => b.journey?.startLocation === stop).length;
                                const isSel = selectedStop === stop;
                                return (
                                    <TouchableOpacity
                                        key={stop}
                                        style={[styles.stopChip, isSel && styles.stopChipActive]}
                                        onPress={() => setSelectedStop(stop)}
                                        activeOpacity={0.8}
                                    >
                                        <Ionicons
                                            name="pin"
                                            size={12}
                                            color={isSel ? '#FFFFFF' : '#0066CC'}
                                        />
                                        <Text style={[styles.stopChipText, isSel && styles.stopChipTextActive]}>
                                            {stop} ({countAtStop})
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>
                )}

                {/* --- 4. SEARCH & SMART FILTER BAR --- */}
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={18} color="#64748B" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search seat, passenger name, or halt..."
                        placeholderTextColor="#94A3B8"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        returnKeyType="search"
                    />
                    {!!searchQuery && (
                        <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close-circle" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Filter Chips Strip (Scrollable to prevent awkward text wrapping) */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterChipContent}
                    style={styles.filterChipScroll}
                >
                    <TouchableOpacity
                        style={[styles.filterChip, filterMode === 'ALL' && styles.filterChipActive]}
                        onPress={() => setFilterMode('ALL')}
                        activeOpacity={0.8}
                    >
                        <Ionicons
                            name="list"
                            size={14}
                            color={filterMode === 'ALL' ? '#FFFFFF' : '#0066CC'}
                        />
                        <Text style={[styles.filterChipText, filterMode === 'ALL' && styles.filterChipTextActive]}>
                            All ({totalPassengers})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterChip, filterMode === 'PENDING_ONLY' && styles.filterChipActive]}
                        onPress={() => setFilterMode('PENDING_ONLY')}
                        activeOpacity={0.8}
                    >
                        <Ionicons
                            name="time-outline"
                            size={14}
                            color={filterMode === 'PENDING_ONLY' ? '#FFFFFF' : '#D97706'}
                        />
                        <Text style={[styles.filterChipText, filterMode === 'PENDING_ONLY' && styles.filterChipTextActive]}>
                            Awaiting ({pendingBoardingCount})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterChip, filterMode === 'BOARDED_ONLY' && styles.filterChipActive]}
                        onPress={() => setFilterMode('BOARDED_ONLY')}
                        activeOpacity={0.8}
                    >
                        <Ionicons
                            name="checkmark-circle-outline"
                            size={14}
                            color={filterMode === 'BOARDED_ONLY' ? '#FFFFFF' : '#059669'}
                        />
                        <Text style={[styles.filterChipText, filterMode === 'BOARDED_ONLY' && styles.filterChipTextActive]}>
                            Boarded ({boardedCount})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterChip, filterMode === 'ASSISTANCE_ONLY' && styles.filterChipActive]}
                        onPress={() => setFilterMode('ASSISTANCE_ONLY')}
                        activeOpacity={0.8}
                    >
                        <Ionicons
                            name="accessibility-outline"
                            size={14}
                            color={filterMode === 'ASSISTANCE_ONLY' ? '#FFFFFF' : '#7C3AED'}
                        />
                        <Text style={[styles.filterChipText, filterMode === 'ASSISTANCE_ONLY' && styles.filterChipTextActive]}>
                            Special Needs ({assistanceCount})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.filterChip, filterMode === 'RECEIVERS_ONLY' && styles.filterChipActive]}
                        onPress={() => setFilterMode('RECEIVERS_ONLY')}
                        activeOpacity={0.8}
                    >
                        <Ionicons
                            name="person-outline"
                            size={14}
                            color={filterMode === 'RECEIVERS_ONLY' ? '#FFFFFF' : '#0284C7'}
                        />
                        <Text style={[styles.filterChipText, filterMode === 'RECEIVERS_ONLY' && styles.filterChipTextActive]}>
                            Receivers ({receiverCount})
                        </Text>
                    </TouchableOpacity>
                </ScrollView>

                {/* --- 5. PASSENGER MANIFEST CARDS (Sorted by Stop & Boarding Priority) --- */}
                {filteredBookings.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <View style={styles.emptyIconCircle}>
                            <Ionicons name="people-outline" size={36} color="#94A3B8" />
                        </View>
                        <Text style={styles.emptyTitle}>No Passengers Found</Text>
                        <Text style={styles.emptySub}>
                            {searchQuery
                                ? `No passenger matches "${searchQuery}".`
                                : 'There are no passenger records in this category.'}
                        </Text>
                    </View>
                ) : (
                    filteredBookings.map((booking) => {
                        // Only actual designated wheelchair space identifiers (W1, W2) or explicit wheelchair category
                        const isActualWheelchairBay = booking.seatNumber?.toUpperCase().startsWith('W') || booking.seatCategory === 'WHEELCHAIR';
                        const isPrioritySeat = booking.isPrioritySeat || booking.seatCategory === 'PRIORITY';
                        const isBoarded = booking.boardingStatus === 'BOARDED';
                        const isPaid = booking.paymentStatus === 'PAID';
                        const travelDate =
                            booking.travelDate ||
                            booking.journeyDate ||
                            booking.departureDate ||
                            booking.journey?.departureDate ||
                            booking.journey?.journeyDate;

                        return (
                            <TouchableOpacity
                                key={booking.bookingId}
                                style={[
                                    styles.passengerCard,
                                    isBoarded && styles.passengerCardBoarded,
                                ]}
                                activeOpacity={0.9}
                                onPress={() => handleCardPress(booking)}
                            >
                                {/* Card Top Row: Seat Badge, Name & Boarding Status */}
                                <View style={styles.cardHeaderRow}>
                                    <View style={styles.seatAndNameGroup}>
                                        {/* Enterprise Seat Badge: Standard clean Ice Blue, Purple for Wheelchair bays, Amber for Priority */}
                                        <View
                                            style={[
                                                styles.seatBadge,
                                                isActualWheelchairBay && styles.seatBadgeWheelchair,
                                                isPrioritySeat && !isActualWheelchairBay && styles.seatBadgePriority,
                                                isBoarded && styles.seatBadgeBoarded,
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.seatBadgeLabel,
                                                    isActualWheelchairBay && styles.seatBadgeLabelWheelchair,
                                                    isPrioritySeat && !isActualWheelchairBay && styles.seatBadgeLabelPriority,
                                                    isBoarded && styles.seatBadgeLabelBoarded,
                                                ]}
                                            >
                                                {isActualWheelchairBay ? 'BAY' : 'SEAT'}
                                            </Text>
                                            <Text
                                                style={[
                                                    styles.seatBadgeValue,
                                                    isActualWheelchairBay && styles.seatBadgeValueWheelchair,
                                                    isPrioritySeat && !isActualWheelchairBay && styles.seatBadgeValuePriority,
                                                    isBoarded && styles.seatBadgeValueBoarded,
                                                ]}
                                            >
                                                {booking.seatNumber || '—'}
                                            </Text>
                                        </View>

                                        <View style={styles.nameMetaContainer}>
                                            <Text style={styles.passengerNameText} numberOfLines={1}>
                                                {booking.passengerName || booking.userId || 'Guest Passenger'}
                                            </Text>
                                            <View style={styles.metaRow}>
                                                <Text style={styles.refText} numberOfLines={1}>
                                                    Ref: {booking.bookingId}
                                                </Text>
                                                {selectedDate === 'ALL' && !!travelDate && (
                                                    <View style={styles.dateTag}>
                                                        <Ionicons name="calendar-outline" size={10} color="#0066CC" />
                                                        <Text style={styles.dateTagText}>
                                                            {travelDate.length > 5 ? travelDate.slice(5) : travelDate}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                    </View>

                                    {/* Boarding Status Pill */}
                                    <View
                                        style={[
                                            styles.statusPill,
                                            isBoarded ? styles.statusPillBoarded : styles.statusPillAwaiting,
                                        ]}
                                    >
                                        <Ionicons
                                            name={isBoarded ? 'checkmark-circle' : 'time-outline'}
                                            size={12}
                                            color={isBoarded ? '#059669' : '#D97706'}
                                        />
                                        <Text
                                            style={[
                                                styles.statusPillText,
                                                { color: isBoarded ? '#065F46' : '#92400E' },
                                            ]}
                                        >
                                            {isBoarded ? 'BOARDED' : 'AWAITING'}
                                        </Text>
                                    </View>
                                </View>

                                {/* Boarding Stop Highlight & Route Box */}
                                <View style={styles.routeBox}>
                                    <View style={styles.boardingHaltBadge}>
                                        <Ionicons name="pin" size={11} color="#0066CC" />
                                        <Text style={styles.boardingHaltLabel}>Boarding at:</Text>
                                    </View>
                                    <Text style={styles.routeBoxText}>
                                        <Text style={styles.pickupLocationText}>
                                            {booking.journey?.startLocation || 'Origin'}
                                        </Text>
                                        {'  ➔  '}
                                        <Text style={styles.dropLocationText}>
                                            {booking.journey?.endLocation || 'Destination'}
                                        </Text>
                                    </Text>
                                </View>

                                {/* Payment Status & Assistance Badges */}
                                <View style={styles.tagsContainer}>
                                    <View style={[styles.fareBadge, isPaid ? styles.fareBadgePaid : styles.fareBadgePending]}>
                                        <Ionicons
                                            name={isPaid ? 'checkmark-circle' : 'cash-outline'}
                                            size={12}
                                            color={isPaid ? '#047857' : '#B45309'}
                                        />
                                        <Text style={[styles.fareBadgeText, { color: isPaid ? '#065F46' : '#92400E' }]}>
                                            {isPaid
                                                ? (booking.paymentMethod === 'CASH' || booking.isWalkIn
                                                    ? `LKR ${booking.fare?.totalFare ?? '—'} · Paid Cash`
                                                    : `LKR ${booking.fare?.totalFare ?? '—'} · Paid Online`)
                                                : `LKR ${booking.fare?.totalFare ?? '—'} · Cash to Collect`}
                                        </Text>
                                    </View>

                                    <View style={styles.assistancePillsRow}>
                                        {booking.assistanceRequested?.wheelchairAssistance && (
                                            <View style={styles.assistPill}>
                                                <Ionicons name="accessibility" size={11} color="#7C3AED" />
                                                <Text style={styles.assistPillText}>Wheelchair Assist</Text>
                                            </View>
                                        )}
                                        {booking.pairedSeatNumber && (
                                            <View style={styles.assistPill}>
                                                <Ionicons name="people" size={11} color="#0066CC" />
                                                <Text style={[styles.assistPillText, { color: '#0066CC' }]}>
                                                    + Companion {booking.pairedSeatNumber}
                                                </Text>
                                            </View>
                                        )}
                                        {isPrioritySeat && (
                                            <View style={[styles.assistPill, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                                                <Ionicons name="star" size={11} color="#D97706" />
                                                <Text style={[styles.assistPillText, { color: '#92400E' }]}>Priority Seat</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>

                                {/* Receiver Handover Verification (if assigned) */}
                                {booking.receiverDetails && (
                                    <View style={styles.receiverCard}>
                                        <View style={styles.receiverInfoRow}>
                                            <Ionicons name="person-circle-outline" size={16} color="#0284C7" />
                                            <View style={{ flex: 1, marginLeft: 6 }}>
                                                <Text style={styles.receiverTitle}>Assigned Receiver at Destination:</Text>
                                                <Text style={styles.receiverName}>
                                                    {booking.receiverDetails.name} ({booking.receiverDetails.phone})
                                                </Text>
                                            </View>
                                        </View>

                                        <TouchableOpacity
                                            style={[
                                                styles.receiverBtn,
                                                booking.receiverDetails.confirmed && styles.receiverBtnConfirmed,
                                            ]}
                                            onPress={() => !booking.receiverDetails?.confirmed && handleConfirmReceiverDetails(booking.bookingId)}
                                            disabled={booking.receiverDetails.confirmed || updatingId === booking.bookingId}
                                            activeOpacity={0.8}
                                        >
                                            {updatingId === booking.bookingId ? (
                                                <ActivityIndicator size="small" color={booking.receiverDetails.confirmed ? "#059669" : "#FFFFFF"} />
                                            ) : booking.receiverDetails.confirmed ? (
                                                <View style={styles.receiverBtnContent}>
                                                    <Ionicons name="checkmark-circle" size={14} color="#059669" />
                                                    <Text style={styles.receiverBtnTextConfirmed}>Receiver Handover Verified</Text>
                                                </View>
                                            ) : (
                                                <View style={styles.receiverBtnContent}>
                                                    <Ionicons name="shield-checkmark-outline" size={14} color="#FFFFFF" />
                                                    <Text style={styles.receiverBtnText}>Confirm Handover</Text>
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })
                )}
            </ScrollView>

            {/* --- 6. FLOATING DUAL ACTION BAR (Only visible during active journey) --- */}
            {isTripLive && (
                <View style={styles.floatingActionBar}>
                    <View style={styles.floatingActionRow}>
                        <TouchableOpacity
                            style={styles.floatingWalkinButton}
                            onPress={() => setIsWalkinModalOpen(true)}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="person-add" size={17} color="#0066CC" />
                            <Text style={styles.floatingWalkinButtonText}>+ Walk-in Ticket</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.floatingScanButton}
                            onPress={() => setIsScannerOpen(true)}
                            activeOpacity={0.9}
                        >
                            <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.floatingScanButtonText}>Scan Ticket QR</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

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

            {/* On-board Walk-in Ticket Issuance Modal */}
            <IssueWalkinTicketModal
                visible={isWalkinModalOpen}
                onClose={() => setIsWalkinModalOpen(false)}
                tripId={isTripLive ? (activeJourney?.trip?.tripId || selectedTripId) : selectedTripId}
                busId={busId}
                numberPlate={numberPlate}
                availableStops={availableStops}
                journeyDate={isTripLive ? todayStr : (selectedDate && selectedDate !== 'ALL' ? selectedDate : todayStr)}
                currentBookings={tripBookings}
                onTicketIssued={handleWalkinTicketIssued}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screenWrapper: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    container: {
        flex: 1,
    },
    scrollContentContainer: {
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 130, // Generous padding when floating scan bar is active
    },
    centerContainer: {
        flex: 1,
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

    /* Alert Banner */
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
        fontSize: 13,
        fontWeight: '800',
        color: '#065F46',
    },
    recentAlertMessage: {
        fontSize: 11,
        color: '#047857',
        marginTop: 2,
    },

    /* Standby Section (When no journey is running) */
    standbySection: {
        marginBottom: 12,
    },
    standbyNoticeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    standbyNoticeIconBox: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
    },
    standbyNoticeTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0066CC',
    },
    standbyNoticeDesc: {
        fontSize: 11,
        color: '#475569',
        marginTop: 2,
        lineHeight: 15,
    },
    standbyActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
        gap: 4,
        marginLeft: 6,
    },
    standbyActionBtnText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '800',
    },

    /* Enterprise Active Journey Card (Light Royal Accent Theme) */
    activeJourneyCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
        borderWidth: 1.5,
        borderColor: '#BFDBFE',
    },
    activeLiveTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    livePulseGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#ECFDF5',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    livePulseDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: '#10B981',
    },
    livePulseText: {
        color: '#047857',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    tripControlJumpBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 2,
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    tripControlJumpText: {
        color: '#0066CC',
        fontSize: 11,
        fontWeight: '800',
    },
    activeRouteDetails: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    activeRouteBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        gap: 5,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    activeRouteBadgeText: {
        color: '#0066CC',
        fontSize: 13,
        fontWeight: '900',
    },
    activeRouteName: {
        color: '#0F172A',
        fontSize: 15,
        fontWeight: '900',
    },
    activeRouteStops: {
        color: '#475569',
        fontSize: 12,
        fontWeight: '700',
        marginTop: 2,
    },
    activeTurnMetaRow: {
        flexDirection: 'row',
        gap: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    turnMetaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 5,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    turnMetaText: {
        color: '#334155',
        fontSize: 11,
        fontWeight: '700',
    },

    /* 1. Shift Card (When Standby / No Trip Active) */
    shiftCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 2,
    },
    dateSelectorContainer: {
        marginBottom: 8,
    },
    dateHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
    },
    dateHeaderLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#334155',
        letterSpacing: 0.2,
    },
    dateSegmentBar: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        padding: 3,
        gap: 4,
    },
    dateSegmentItem: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderRadius: 9,
    },
    dateSegmentActive: {
        backgroundColor: '#0066CC',
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3,
        elevation: 2,
    },
    dateSegmentText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#475569',
    },
    dateSegmentTextActive: {
        color: '#FFFFFF',
    },
    dateSegmentSubText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 1,
    },
    dateSegmentSubTextActive: {
        color: '#DBEAFE',
    },
    turnSection: {
        marginTop: 6,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    turnScrollContent: {
        flexDirection: 'row',
        gap: 8,
        paddingRight: 6,
    },
    turnPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        gap: 6,
    },
    turnPillActive: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    turnPillText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
    },
    turnPillTextActive: {
        color: '#FFFFFF',
    },
    turnCountBadge: {
        backgroundColor: '#E2E8F0',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
    },
    turnCountBadgeActive: {
        backgroundColor: '#1E40AF',
    },
    turnCountText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#475569',
    },
    turnCountTextActive: {
        color: '#FFFFFF',
    },

    /* 2. Cockpit Card */
    cockpitCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 2,
    },
    cockpitTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    cockpitTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0F172A',
    },
    cockpitSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
        fontWeight: '600',
    },
    progressPercentPill: {
        backgroundColor: '#ECFDF5',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    progressPercentText: {
        fontSize: 13,
        fontWeight: '900',
        color: '#059669',
    },
    progressBarTrack: {
        height: 8,
        backgroundColor: '#F1F5F9',
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 14,
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#10B981',
        borderRadius: 4,
    },
    kpiGrid: {
        flexDirection: 'row',
        gap: 8,
    },
    kpiTile: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    kpiIconBox: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    kpiValue: {
        fontSize: 13,
        fontWeight: '900',
        color: '#0F172A',
    },
    kpiLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#64748B',
        marginTop: 1,
    },

    /* 3. Stop-by-Stop Route Halt Filter */
    stopFilterSection: {
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 10,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    stopFilterHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginBottom: 6,
    },
    stopFilterLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: '#334155',
    },
    stopFilterScroll: {
        flexDirection: 'row',
        gap: 6,
    },
    stopChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 4,
    },
    stopChipActive: {
        backgroundColor: '#0066CC',
    },
    stopChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#475569',
    },
    stopChipTextActive: {
        color: '#FFFFFF',
    },

    /* 4. Search & Filter */
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        paddingHorizontal: 12,
        height: 44,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 13,
        color: '#0F172A',
        marginLeft: 8,
        fontWeight: '500',
    },
    filterChipScroll: {
        marginBottom: 12,
    },
    filterChipContent: {
        flexDirection: 'row',
        gap: 8,
        paddingRight: 10,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        gap: 6,
    },
    filterChipActive: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    filterChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
    },
    filterChipTextActive: {
        color: '#FFFFFF',
    },

    /* 5. Passenger Manifest Cards */
    emptyContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 30,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginTop: 10,
    },
    emptyIconCircle: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
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
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        gap: 10,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 3,
        elevation: 1,
    },
    passengerCardBoarded: {
        backgroundColor: '#F8FAFC',
        borderColor: '#E2E8F0',
    },
    cardHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
    },
    seatAndNameGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
        marginRight: 4,
        overflow: 'hidden',
    },

    /* Standard Seat Badges */
    seatBadge: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 50,
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    seatBadgeWheelchair: {
        backgroundColor: '#F5F3FF',
        borderColor: '#DDD6FE',
    },
    seatBadgePriority: {
        backgroundColor: '#FEF3C7',
        borderColor: '#FDE68A',
    },
    seatBadgeBoarded: {
        backgroundColor: '#ECFDF5',
        borderColor: '#A7F3D0',
    },
    seatBadgeLabel: {
        color: '#0066CC',
        fontSize: 8,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    seatBadgeLabelWheelchair: {
        color: '#7C3AED',
    },
    seatBadgeLabelPriority: {
        color: '#D97706',
    },
    seatBadgeLabelBoarded: {
        color: '#059669',
    },
    seatBadgeValue: {
        color: '#0066CC',
        fontWeight: '900',
        fontSize: 14,
    },
    seatBadgeValueWheelchair: {
        color: '#6D28D9',
    },
    seatBadgeValuePriority: {
        color: '#B45309',
    },
    seatBadgeValueBoarded: {
        color: '#047857',
    },

    nameMetaContainer: {
        flex: 1,
        justifyContent: 'center',
        overflow: 'hidden',
    },
    passengerNameText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 2,
        flexWrap: 'nowrap',
    },
    refText: {
        fontSize: 11,
        color: '#64748B',
        fontWeight: '600',
        flexShrink: 1,
    },
    dateTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: '#DBEAFE',
        flexShrink: 0,
    },
    dateTagText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#0066CC',
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 4,
        flexShrink: 0,
        alignSelf: 'flex-start',
    },
    statusPillBoarded: {
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    statusPillAwaiting: {
        backgroundColor: '#FFFBEB',
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    statusPillText: {
        fontSize: 11,
        fontWeight: '800',
    },
    routeBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
        gap: 6,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    boardingHaltBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        gap: 3,
    },
    boardingHaltLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#0066CC',
    },
    routeBoxText: {
        fontSize: 12,
        color: '#475569',
        flex: 1,
    },
    pickupLocationText: {
        fontWeight: '800',
        color: '#0F172A',
    },
    dropLocationText: {
        fontWeight: '700',
        color: '#64748B',
    },
    tagsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },
    fareBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 4,
    },
    fareBadgePaid: {
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    fareBadgePending: {
        backgroundColor: '#FFFBEB',
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    fareBadgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    assistancePillsRow: {
        flexDirection: 'row',
        gap: 5,
    },
    assistPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F5F3FF',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
        borderWidth: 1,
        borderColor: '#E9D5FF',
    },
    assistPillText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#6D28D9',
    },
    receiverCard: {
        marginTop: 4,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
        gap: 8,
    },
    receiverInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    receiverTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    receiverName: {
        fontSize: 12,
        fontWeight: '800',
        color: '#0F172A',
        marginTop: 1,
    },
    receiverBtn: {
        backgroundColor: '#0284C7',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    receiverBtnConfirmed: {
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    receiverBtnContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    receiverBtnText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
    receiverBtnTextConfirmed: {
        color: '#059669',
        fontSize: 12,
        fontWeight: '800',
    },

    /* 6. Floating Bottom Bar (Only rendered when isTripLive === true) */
    floatingActionBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: Platform.OS === 'ios' ? 28 : 14,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 10,
    },
    floatingActionRow: {
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
    },
    floatingWalkinButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EFF6FF',
        borderWidth: 1.5,
        borderColor: '#0066CC',
        paddingVertical: 13,
        borderRadius: 14,
        gap: 6,
    },
    floatingWalkinButtonText: {
        color: '#0066CC',
        fontWeight: '800',
        fontSize: 14,
        letterSpacing: 0.2,
    },
    floatingScanButton: {
        flex: 1.2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0066CC',
        paddingVertical: 13,
        borderRadius: 14,
        gap: 7,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 4,
    },
    floatingScanButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
        letterSpacing: 0.2,
    },
});
