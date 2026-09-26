import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Booking, Seat } from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { AppText as Text } from '../../../shared/ui/AppText';
import { issueWalkinTicket } from '../api/manifestApi';

interface IssueWalkinTicketModalProps {
    visible: boolean;
    onClose: () => void;
    tripId: string | null;
    busId?: string;
    numberPlate?: string;
    availableStops: string[];
    journeyDate: string;
    currentBookings: Booking[];
    onTicketIssued: (booking: Booking) => void;
}

export function IssueWalkinTicketModal({
    visible,
    onClose,
    tripId,
    busId,
    numberPlate,
    availableStops,
    journeyDate,
    currentBookings,
    onTicketIssued,
}: IssueWalkinTicketModalProps) {
    const [routeStops, setRouteStops] = useState<string[]>([]);
    const [routeId, setRouteId] = useState<string>('138');
    const [originHalt, setOriginHalt] = useState<string>('');
    const [destinationHalt, setDestinationHalt] = useState<string>('');
    const [passengerName, setPassengerName] = useState<string>('');
    const [passengerPhone, setPassengerPhone] = useState<string>('');
    const [passengerEmail, setPassengerEmail] = useState<string>('');
    const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
    const [showContactDetails, setShowContactDetails] = useState<boolean>(false);

    const [loadingSeats, setLoadingSeats] = useState<boolean>(false);
    const [seatData, setSeatData] = useState<Seat[]>([]);
    const [fareAmount, setFareAmount] = useState<number | null>(null);
    const [fareDistanceKm, setFareDistanceKm] = useState<number | null>(null);
    const [isCalculatingFare, setIsCalculatingFare] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Fetch live seat availability & authoritative route stops for the trip
    useEffect(() => {
        if (!visible || !tripId) return;

        let isMounted = true;
        setLoadingSeats(true);
        setErrorMsg(null);

        fetch(`${API_BASE_URL}/api/booking/seats/${tripId}?date=${journeyDate}`)
            .then((res) => res.json())
            .then((data) => {
                if (isMounted) {
                    if (data?.success) {
                        if (Array.isArray(data.seats)) {
                            setSeatData(data.seats);
                        }
                        if (data.routeId) {
                            setRouteId(data.routeId);
                        }
                        if (Array.isArray(data.stops) && data.stops.length >= 2) {
                            setRouteStops(data.stops);
                            setOriginHalt(data.stops[0]);
                            setDestinationHalt(data.stops[data.stops.length - 1]);
                        } else if (availableStops && availableStops.length >= 2) {
                            setRouteStops(availableStops);
                            setOriginHalt(availableStops[0]);
                            setDestinationHalt(availableStops[availableStops.length - 1]);
                        } else {
                            const defaultStops = ['Colombo Fort', 'Town Hall', 'Bambalapitiya', 'Nugegoda', 'Maharagama', 'Homagama'];
                            setRouteStops(defaultStops);
                            setOriginHalt(defaultStops[0]);
                            setDestinationHalt(defaultStops[defaultStops.length - 1]);
                        }
                    } else {
                        const fallbackStops = availableStops.length >= 2
                            ? availableStops
                            : ['Colombo Fort', 'Town Hall', 'Bambalapitiya', 'Nugegoda', 'Maharagama'];
                        setRouteStops(fallbackStops);
                        setOriginHalt(fallbackStops[0]);
                        setDestinationHalt(fallbackStops[fallbackStops.length - 1]);
                    }
                }
            })
            .catch(() => {
                if (isMounted) {
                    const fallbackStops = availableStops.length >= 2
                        ? availableStops
                        : ['Colombo Fort', 'Town Hall', 'Bambalapitiya', 'Nugegoda', 'Maharagama'];
                    setRouteStops(fallbackStops);
                    setOriginHalt(fallbackStops[0]);
                    setDestinationHalt(fallbackStops[fallbackStops.length - 1]);
                }
            })
            .finally(() => {
                if (isMounted) setLoadingSeats(false);
            });

        return () => {
            isMounted = false;
        };
    }, [visible, tripId, journeyDate, availableStops]);

    // Destination halts eligible strictly after selected origin halt
    const validDestinations = useMemo(() => {
        if (!routeStops || routeStops.length === 0) return [];
        const originIdx = routeStops.indexOf(originHalt);
        if (originIdx === -1) return routeStops.slice(1);
        return routeStops.slice(originIdx + 1);
    }, [routeStops, originHalt]);

    // If current destination becomes invalid when origin changes, auto-select first valid one
    useEffect(() => {
        if (validDestinations.length > 0 && !validDestinations.includes(destinationHalt)) {
            setDestinationHalt(validDestinations[0]);
        }
    }, [validDestinations, destinationHalt]);

    // Calculate fare when origin or destination changes
    useEffect(() => {
        if (!visible || !originHalt || !destinationHalt || originHalt === destinationHalt) {
            setFareAmount(null);
            setFareDistanceKm(null);
            return;
        }

        let isMounted = true;
        setIsCalculatingFare(true);

        const params = new URLSearchParams({
            routeId: routeId || '138',
            origin: originHalt,
            destination: destinationHalt,
        });

        fetch(`${API_BASE_URL}/api/booking/fare?${params.toString()}`)
            .then((res) => res.json())
            .then((data) => {
                if (isMounted) {
                    if (data?.success && data?.fare?.totalFare != null) {
                        setFareAmount(data.fare.totalFare);
                        setFareDistanceKm(data.fare.distanceKm ?? null);
                    } else {
                        setFareAmount(100);
                        setFareDistanceKm(5);
                    }
                }
            })
            .catch(() => {
                if (isMounted) {
                    setFareAmount(100);
                    setFareDistanceKm(5);
                }
            })
            .finally(() => {
                if (isMounted) setIsCalculatingFare(false);
            });

        return () => {
            isMounted = false;
        };
    }, [visible, originHalt, destinationHalt, routeId]);

    // Set of booked seat numbers for today's trip
    const bookedSeatNumbers = useMemo(() => {
        const set = new Set<string>();
        currentBookings.forEach((b) => {
            if (b.status === 'CONFIRMED' && b.seatNumber) {
                set.add(b.seatNumber.toUpperCase().trim());
            }
            if (b.status === 'CONFIRMED' && b.pairedSeatNumber) {
                set.add(b.pairedSeatNumber.toUpperCase().trim());
            }
        });
        return set;
    }, [currentBookings]);

    // Filter available standard seats
    const standardSeats = useMemo(() => {
        if (seatData.length > 0) {
            return seatData.map((s) => {
                const num = s.seatNumber.toUpperCase().trim();
                const isBooked = s.status === 'OCCUPIED' || bookedSeatNumbers.has(num);
                const isAccessibility =
                    s.category !== 'STANDARD' ||
                    s.isPrioritySeat ||
                    num.startsWith('W') ||
                    num.startsWith('G') ||
                    num.startsWith('P') ||
                    num.startsWith('E');

                return {
                    seatNumber: s.seatNumber,
                    category: s.category,
                    isBooked,
                    isAccessibility,
                    isSelectable: !isBooked && !isAccessibility,
                };
            });
        }

        // Fallback default bus seat generation (4A to 8D)
        const fallback: Array<{
            seatNumber: string;
            category: string;
            isBooked: boolean;
            isAccessibility: boolean;
            isSelectable: boolean;
        }> = [];

        fallback.push({ seatNumber: 'W1', category: 'WHEELCHAIR', isBooked: bookedSeatNumbers.has('W1'), isAccessibility: true, isSelectable: false });
        fallback.push({ seatNumber: 'G1', category: 'GUARDIAN', isBooked: bookedSeatNumbers.has('G1'), isAccessibility: true, isSelectable: false });
        fallback.push({ seatNumber: 'P1', category: 'PRIORITY', isBooked: bookedSeatNumbers.has('P1'), isAccessibility: true, isSelectable: false });
        fallback.push({ seatNumber: 'P2', category: 'PRIORITY', isBooked: bookedSeatNumbers.has('P2'), isAccessibility: true, isSelectable: false });
        fallback.push({ seatNumber: 'E1', category: 'ELDERLY', isBooked: bookedSeatNumbers.has('E1'), isAccessibility: true, isSelectable: false });
        fallback.push({ seatNumber: 'E2', category: 'ELDERLY', isBooked: bookedSeatNumbers.has('E2'), isAccessibility: true, isSelectable: false });

        const cols = ['A', 'B', 'C', 'D'];
        for (let row = 4; row <= 8; row++) {
            for (const col of cols) {
                const sNum = `${row}${col}`;
                const isBooked = bookedSeatNumbers.has(sNum);
                fallback.push({
                    seatNumber: sNum,
                    category: 'STANDARD',
                    isBooked,
                    isAccessibility: false,
                    isSelectable: !isBooked,
                });
            }
        }
        return fallback;
    }, [seatData, bookedSeatNumbers]);

    // Auto-select first available standard seat if none is selected yet
    useEffect(() => {
        if (!selectedSeat && standardSeats.length > 0) {
            const firstAvail = standardSeats.find((s) => s.isSelectable);
            if (firstAvail) {
                setSelectedSeat(firstAvail.seatNumber);
            }
        }
    }, [standardSeats, selectedSeat]);

    // Calculate stop hops between origin and destination
    const hopCount = useMemo(() => {
        if (!routeStops.length) return 1;
        const oIdx = routeStops.indexOf(originHalt);
        const dIdx = routeStops.indexOf(destinationHalt);
        if (oIdx !== -1 && dIdx !== -1 && dIdx > oIdx) {
            return dIdx - oIdx;
        }
        return 1;
    }, [routeStops, originHalt, destinationHalt]);

    async function handleIssueTicket() {
        if (!tripId) {
            setErrorMsg('No active trip selected.');
            return;
        }
        if (!originHalt || !destinationHalt) {
            setErrorMsg('Please select valid boarding and drop-off halts.');
            return;
        }
        if (!selectedSeat) {
            setErrorMsg('Please select an available standard seat for the passenger.');
            return;
        }

        const target = standardSeats.find((s) => s.seatNumber === selectedSeat);
        if (!target || !target.isSelectable) {
            setErrorMsg('Walk-in passengers can ONLY be issued unreserved STANDARD seats.');
            return;
        }

        try {
            setIsSubmitting(true);
            setErrorMsg(null);

            const result = await issueWalkinTicket({
                tripId,
                busId,
                seatNumber: selectedSeat,
                origin: originHalt,
                destination: destinationHalt,
                passengerName: passengerName.trim() || undefined,
                passengerPhone: passengerPhone.trim() || undefined,
                passengerEmail: passengerEmail.trim() || undefined,
                date: journeyDate,
            });

            onTicketIssued(result.booking);
            onClose();

            const alertTitle = 'Ticket Confirmed & Boarded';
            const emailNote = passengerEmail.trim() ? `\n✉️ E-Receipt dispatched to ${passengerEmail.trim()}` : '';
            const smsNote = passengerPhone.trim() ? `\n📱 SMS dispatched to ${passengerPhone.trim()}` : '';
            const alertMsg = `Ticket #${result.booking.bookingId} issued for Seat ${selectedSeat}. Fare LKR ${result.booking.fare?.totalFare ?? fareAmount ?? '—'} collected in Cash.${emailNote}${smsNote}`;

            if (Platform.OS === 'web') {
                window.alert(`${alertTitle}\n\n${alertMsg}`);
            } else {
                Alert.alert(alertTitle, alertMsg);
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Failed to issue ticket on board.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={styles.modalContainer}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerTitleGroup}>
                            <View style={styles.iconCircle}>
                                <Ionicons name="receipt" size={20} color="#0066CC" />
                            </View>
                            <View>
                                <Text style={styles.headerTitle}>Spot Passenger Ticketing</Text>
                                <Text style={styles.headerSubtitle}>
                                    One-Tap POS · {numberPlate || 'Transit Bus'}
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Ionicons name="close" size={20} color="#64748B" />
                        </TouchableOpacity>
                    </View>

                    {/* Strict Standard Seat Rule Notice */}
                    <View style={styles.policyAlert}>
                        <Ionicons name="shield-checkmark" size={15} color="#0284C7" />
                        <Text style={styles.policyAlertText}>
                            <Text style={styles.policyAlertBold}>Standard Seats Only: </Text>
                            Wheelchair bays and priority seats are locked for special needs passengers.
                        </Text>
                    </View>

                    {errorMsg && (
                        <View style={styles.errorBanner}>
                            <Ionicons name="alert-circle" size={16} color="#DC2626" />
                            <Text style={styles.errorText}>{errorMsg}</Text>
                        </View>
                    )}

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.scrollContent}
                    >
                        {/* 1. ROUTE HALTS PICKER (Large, Ergonomic Touch Targets) */}
                        <View style={styles.cardSection}>
                            <View style={styles.cardSectionHeader}>
                                <View style={styles.stepBadge}>
                                    <Text style={styles.stepBadgeText}>1</Text>
                                </View>
                                <Text style={styles.sectionTitle}>Select Route Halts</Text>
                                <View style={styles.hopPill}>
                                    <Text style={styles.hopPillText}>{hopCount} Stop{hopCount > 1 ? 's' : ''}</Text>
                                </View>
                            </View>
                            
                            {/* Boarding Halt */}
                            <View style={styles.haltGroup}>
                                <View style={styles.haltLabelRow}>
                                    <View style={[styles.haltDot, { backgroundColor: '#0066CC' }]} />
                                    <Text style={styles.inputLabel}>Boarding At (Pickup):</Text>
                                    <Text style={styles.activeHaltName}>{originHalt || '—'}</Text>
                                </View>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.chipRow}
                                >
                                    {routeStops.slice(0, Math.max(1, routeStops.length - 1)).map((stop) => {
                                        const isSel = originHalt === stop;
                                        return (
                                            <TouchableOpacity
                                                key={`origin-${stop}`}
                                                style={[styles.haltChip, isSel && styles.haltChipActiveOrigin]}
                                                onPress={() => setOriginHalt(stop)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons
                                                    name="pin"
                                                    size={13}
                                                    color={isSel ? '#FFFFFF' : '#0066CC'}
                                                />
                                                <Text style={[styles.haltChipText, isSel && styles.haltChipTextActive]}>
                                                    {stop}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            </View>

                            {/* Drop-off Halt */}
                            <View style={[styles.haltGroup, { marginTop: 12 }]}>
                                <View style={styles.haltLabelRow}>
                                    <View style={[styles.haltDot, { backgroundColor: '#059669' }]} />
                                    <Text style={styles.inputLabel}>Alighting At (Drop-off):</Text>
                                    <Text style={[styles.activeHaltName, { color: '#059669' }]}>{destinationHalt || '—'}</Text>
                                </View>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.chipRow}
                                >
                                    {validDestinations.map((stop) => {
                                        const isSel = destinationHalt === stop;
                                        return (
                                            <TouchableOpacity
                                                key={`dest-${stop}`}
                                                style={[styles.haltChip, isSel && styles.haltChipActiveDest]}
                                                onPress={() => setDestinationHalt(stop)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons
                                                    name="flag"
                                                    size={13}
                                                    color={isSel ? '#FFFFFF' : '#059669'}
                                                />
                                                <Text style={[styles.haltChipText, isSel && styles.haltChipTextActive]}>
                                                    {stop}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            </View>
                        </View>

                        {/* 2. FARE & CASH SUMMARY CARD (Prominent POS Layout) */}
                        <View style={styles.fareHeroCard}>
                            <View style={styles.fareHeroTop}>
                                <View>
                                    <Text style={styles.fareHeroSub}>Calculated Bus Fare</Text>
                                    <Text style={styles.fareHeroRoute}>
                                        {originHalt} ➔ {destinationHalt}
                                    </Text>
                                </View>
                                <View style={styles.fareHeroAmountBox}>
                                    {isCalculatingFare ? (
                                        <ActivityIndicator size="small" color="#059669" />
                                    ) : (
                                        <Text style={styles.fareHeroAmountText}>
                                            LKR {fareAmount != null ? fareAmount.toFixed(0) : '100'}
                                        </Text>
                                    )}
                                </View>
                            </View>

                            <View style={styles.fareHeroDivider} />

                            <View style={styles.fareHeroBottom}>
                                <View style={styles.cashPill}>
                                    <Ionicons name="cash" size={15} color="#059669" />
                                    <Text style={styles.cashPillText}>Cash Payment</Text>
                                </View>
                                {fareDistanceKm != null && (
                                    <Text style={styles.fareDistText}>{fareDistanceKm.toFixed(1)} km road segment</Text>
                                )}
                            </View>
                        </View>

                        {/* 3. ASSIGN STANDARD SEAT */}
                        <View style={styles.cardSection}>
                            <View style={styles.cardSectionHeader}>
                                <View style={styles.stepBadge}>
                                    <Text style={styles.stepBadgeText}>2</Text>
                                </View>
                                <Text style={styles.sectionTitle}>Assign Standard Seat</Text>
                                {selectedSeat && (
                                    <View style={styles.selectedSeatPill}>
                                        <Ionicons name="checkmark-circle" size={13} color="#0066CC" />
                                        <Text style={styles.selectedSeatPillText}>Seat {selectedSeat}</Text>
                                    </View>
                                )}
                            </View>

                            {/* Legend Strip */}
                            <View style={styles.legendStrip}>
                                <View style={styles.legendUnit}>
                                    <View style={[styles.legendBox, styles.legendBoxAvailable]} />
                                    <Text style={styles.legendLabel}>Available</Text>
                                </View>
                                <View style={styles.legendUnit}>
                                    <View style={[styles.legendBox, styles.legendBoxBooked]} />
                                    <Text style={styles.legendLabel}>Booked</Text>
                                </View>
                                <View style={styles.legendUnit}>
                                    <View style={[styles.legendBox, styles.legendBoxLocked]} />
                                    <Text style={styles.legendLabel}>Locked</Text>
                                </View>
                            </View>

                            {loadingSeats ? (
                                <View style={styles.loadingBox}>
                                    <ActivityIndicator size="small" color="#0066CC" />
                                    <Text style={styles.loadingBoxText}>Loading bus layout...</Text>
                                </View>
                            ) : (
                                <View style={styles.seatGrid}>
                                    {standardSeats.map((s) => {
                                        const isSelected = selectedSeat === s.seatNumber;

                                        if (s.isAccessibility) {
                                            return (
                                                <View
                                                    key={s.seatNumber}
                                                    style={[styles.seatTile, styles.seatTileLocked]}
                                                >
                                                    <Ionicons
                                                        name={s.category === 'WHEELCHAIR' ? 'accessibility' : 'lock-closed'}
                                                        size={11}
                                                        color="#A16207"
                                                    />
                                                    <Text style={styles.seatTileTextLocked}>
                                                        {s.seatNumber}
                                                    </Text>
                                                </View>
                                            );
                                        }

                                        if (s.isBooked) {
                                            return (
                                                <View
                                                    key={s.seatNumber}
                                                    style={[styles.seatTile, styles.seatTileBooked]}
                                                >
                                                    <Text style={styles.seatTileTextBooked}>
                                                        {s.seatNumber}
                                                    </Text>
                                                </View>
                                            );
                                        }

                                        return (
                                            <TouchableOpacity
                                                key={s.seatNumber}
                                                style={[
                                                    styles.seatTile,
                                                    styles.seatTileAvailable,
                                                    isSelected && styles.seatTileSelected,
                                                ]}
                                                onPress={() => setSelectedSeat(s.seatNumber)}
                                                activeOpacity={0.7}
                                            >
                                                <Text
                                                    style={[
                                                        styles.seatTileTextAvailable,
                                                        isSelected && styles.seatTileTextSelected,
                                                    ]}
                                                >
                                                    {s.seatNumber}
                                                </Text>
                                                {isSelected && (
                                                    <Ionicons name="checkmark" size={11} color="#FFFFFF" />
                                                )}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            )}
                        </View>

                        {/* 4. OPTIONAL PASSENGER & E-RECEIPT (Clean Collapsible Accordion) */}
                        <View style={styles.cardSection}>
                            <TouchableOpacity
                                style={styles.accordionHeader}
                                onPress={() => setShowContactDetails(!showContactDetails)}
                                activeOpacity={0.8}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <Ionicons name="mail-unread-outline" size={17} color="#0066CC" />
                                    <Text style={styles.accordionTitle}>E-Receipt / SMS Delivery (Optional)</Text>
                                </View>
                                <Ionicons
                                    name={showContactDetails ? 'chevron-up' : 'chevron-down'}
                                    size={18}
                                    color="#64748B"
                                />
                            </TouchableOpacity>

                            {showContactDetails && (
                                <View style={styles.accordionContent}>
                                    <View style={styles.fieldGroup}>
                                        <Text style={styles.fieldLabel}>Passenger Name:</Text>
                                        <View style={styles.fieldInputBox}>
                                            <Ionicons name="person-outline" size={15} color="#64748B" />
                                            <TextInput
                                                style={styles.fieldInput}
                                                placeholder="e.g. Kasun Perera"
                                                placeholderTextColor="#94A3B8"
                                                value={passengerName}
                                                onChangeText={setPassengerName}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.fieldGroup}>
                                        <Text style={styles.fieldLabel}>Mobile Number (for SMS Ticket):</Text>
                                        <View style={styles.fieldInputBox}>
                                            <Ionicons name="call-outline" size={15} color="#059669" />
                                            <TextInput
                                                style={styles.fieldInput}
                                                placeholder="0771234567"
                                                placeholderTextColor="#94A3B8"
                                                value={passengerPhone}
                                                onChangeText={setPassengerPhone}
                                                keyboardType="phone-pad"
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.fieldGroup}>
                                        <Text style={styles.fieldLabel}>Email Address (for Official E-Ticket):</Text>
                                        <View style={styles.fieldInputBox}>
                                            <Ionicons name="mail-outline" size={15} color="#0066CC" />
                                            <TextInput
                                                style={styles.fieldInput}
                                                placeholder="passenger@example.com"
                                                placeholderTextColor="#94A3B8"
                                                value={passengerEmail}
                                                onChangeText={setPassengerEmail}
                                                keyboardType="email-address"
                                                autoCapitalize="none"
                                            />
                                        </View>
                                    </View>
                                </View>
                            )}
                        </View>
                    </ScrollView>

                    {/* STICKY BOTTOM ACTION BAR (Ultra Ergonomic Conductor Button) */}
                    <View style={styles.bottomBar}>
                        <TouchableOpacity
                            style={styles.cancelBtn}
                            onPress={onClose}
                            disabled={isSubmitting}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.primaryIssueBtn,
                                (!selectedSeat || isSubmitting) && styles.primaryIssueBtnDisabled,
                            ]}
                            onPress={handleIssueTicket}
                            disabled={!selectedSeat || isSubmitting}
                            activeOpacity={0.88}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                                    <Text style={styles.primaryIssueBtnText}>
                                        {fareAmount != null
                                            ? `Collect LKR ${fareAmount.toFixed(0)} & Issue`
                                            : 'Collect Cash & Issue'}
                                    </Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        justifyContent: 'flex-end',
    },
    modalContainer: {
        backgroundColor: '#F8FAFC',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        maxHeight: '94%',
        paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    headerTitleGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 1,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
    },

    policyAlert: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0F9FF',
        borderBottomWidth: 1,
        borderBottomColor: '#BAE6FD',
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
    },
    policyAlertText: {
        flex: 1,
        fontSize: 11,
        color: '#0369A1',
        lineHeight: 15,
    },
    policyAlertBold: {
        fontWeight: '700',
        color: '#0284C7',
    },

    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#FECACA',
    },
    errorText: {
        fontSize: 12,
        color: '#B91C1C',
        fontWeight: '600',
        flex: 1,
    },

    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 24,
        gap: 14,
    },

    /* Card Section Container */
    cardSection: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 3,
        elevation: 1,
    },
    cardSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 8,
    },
    stepBadge: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepBadgeText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '800',
    },
    sectionTitle: {
        fontSize: 13.5,
        fontWeight: '800',
        color: '#1E293B',
        flex: 1,
    },
    hopPill: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    hopPillText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#475569',
    },

    /* Halts */
    haltGroup: {
        gap: 6,
    },
    haltLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    haltDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    inputLabel: {
        fontSize: 11.5,
        fontWeight: '700',
        color: '#64748B',
    },
    activeHaltName: {
        fontSize: 12,
        fontWeight: '800',
        color: '#0066CC',
    },
    chipRow: {
        flexDirection: 'row',
        gap: 8,
        paddingVertical: 2,
    },
    haltChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#F8FAFC',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        gap: 5,
    },
    haltChipActiveOrigin: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    haltChipActiveDest: {
        backgroundColor: '#059669',
        borderColor: '#059669',
    },
    haltChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
    },
    haltChipTextActive: {
        color: '#FFFFFF',
    },

    /* Fare Hero Card */
    fareHeroCard: {
        backgroundColor: '#ECFDF5',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1.5,
        borderColor: '#A7F3D0',
    },
    fareHeroTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    fareHeroSub: {
        fontSize: 11.5,
        fontWeight: '700',
        color: '#047857',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    fareHeroRoute: {
        fontSize: 13,
        fontWeight: '800',
        color: '#065F46',
        marginTop: 2,
    },
    fareHeroAmountBox: {
        alignItems: 'flex-end',
    },
    fareHeroAmountText: {
        fontSize: 22,
        fontWeight: '900',
        color: '#065F46',
    },
    fareHeroDivider: {
        height: 1,
        backgroundColor: '#A7F3D0',
        marginVertical: 8,
    },
    fareHeroBottom: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cashPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
        borderWidth: 1,
        borderColor: '#6EE7B7',
    },
    cashPillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#047857',
    },
    fareDistText: {
        fontSize: 11,
        color: '#059669',
        fontWeight: '600',
    },

    /* Seat Grid */
    selectedSeatPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#BFDBFE',
        gap: 4,
    },
    selectedSeatPillText: {
        fontSize: 11.5,
        fontWeight: '800',
        color: '#0066CC',
    },
    legendStrip: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 10,
    },
    legendUnit: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    legendBox: {
        width: 10,
        height: 10,
        borderRadius: 3,
    },
    legendBoxAvailable: {
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#0066CC',
    },
    legendBoxBooked: {
        backgroundColor: '#F1F5F9',
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    legendBoxLocked: {
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    legendLabel: {
        fontSize: 10.5,
        color: '#64748B',
        fontWeight: '600',
    },
    loadingBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        gap: 8,
    },
    loadingBoxText: {
        fontSize: 12,
        color: '#64748B',
    },
    seatGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    seatTile: {
        width: 44,
        height: 38,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
    },
    seatTileAvailable: {
        backgroundColor: '#F0F7FF',
        borderColor: '#93C5FD',
    },
    seatTileSelected: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    seatTileBooked: {
        backgroundColor: '#F1F5F9',
        borderColor: '#E2E8F0',
    },
    seatTileLocked: {
        backgroundColor: '#FEF9C3',
        borderColor: '#FEF08A',
    },
    seatTileTextAvailable: {
        fontSize: 11.5,
        fontWeight: '800',
        color: '#0066CC',
    },
    seatTileTextSelected: {
        color: '#FFFFFF',
    },
    seatTileTextBooked: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#94A3B8',
    },
    seatTileTextLocked: {
        fontSize: 9.5,
        fontWeight: '800',
        color: '#A16207',
    },

    /* Accordion */
    accordionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
    accordionTitle: {
        fontSize: 12.5,
        fontWeight: '700',
        color: '#334155',
    },
    accordionContent: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
        gap: 10,
    },
    fieldGroup: {
        gap: 4,
    },
    fieldLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    fieldInputBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        paddingHorizontal: 10,
        paddingVertical: 7,
        gap: 6,
    },
    fieldInput: {
        flex: 1,
        fontSize: 12.5,
        color: '#0F172A',
        padding: 0,
    },

    /* Sticky Bottom Actions */
    bottomBar: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 10,
        gap: 10,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelBtnText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
    },
    primaryIssueBtn: {
        flex: 2.4,
        flexDirection: 'row',
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    primaryIssueBtnDisabled: {
        backgroundColor: '#94A3B8',
        shadowOpacity: 0,
        elevation: 0,
    },
    primaryIssueBtnText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#FFFFFF',
        letterSpacing: 0.2,
    },
});
