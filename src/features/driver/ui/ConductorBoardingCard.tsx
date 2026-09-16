import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Modal,
    PanResponder,
    Platform,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    BoardingVerificationResult,
} from '../../../entities/booking/model/types';
import { AppText as Text } from '../../../shared/ui/AppText';

interface ConductorBoardingCardProps {
    visible: boolean;
    verificationResult: BoardingVerificationResult | null;
    onClose: () => void;
    onConfirmBoarding: (options: {
        bookingId: string;
        cashCollected?: boolean;
        assistanceProgress?: 'IN_PROGRESS' | 'COMPLETED';
    }) => Promise<void>;
    isConfirming?: boolean;
}

interface SlideToConfirmProps {
    onConfirm: () => void;
    isConfirming?: boolean;
    title?: string;
    disabled?: boolean;
    themeColor?: string;
}

function SlideToConfirm({
    onConfirm,
    isConfirming = false,
    title = 'Slide to Confirm Boarding ➔',
    disabled = false,
    themeColor = '#059669',
}: SlideToConfirmProps) {
    const [containerWidth, setContainerWidth] = useState(0);
    const slideAnim = useRef(new Animated.Value(0)).current;
    const isCompletedRef = useRef(false);

    const KNOB_SIZE = 48;
    const PADDING = 4;
    const maxSlide = Math.max(0, containerWidth - KNOB_SIZE - PADDING * 2);

    useEffect(() => {
        isCompletedRef.current = false;
        slideAnim.setValue(0);
    }, [isConfirming]);

    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => !disabled && !isConfirming && !isCompletedRef.current,
                onMoveShouldSetPanResponder: () => !disabled && !isConfirming && !isCompletedRef.current,
                onPanResponderMove: (_, gestureState) => {
                    if (isCompletedRef.current) return;
                    const newX = Math.max(0, Math.min(gestureState.dx, maxSlide));
                    slideAnim.setValue(newX);
                },
                onPanResponderRelease: (_, gestureState) => {
                    if (isCompletedRef.current) return;
                    if (maxSlide > 0 && gestureState.dx >= maxSlide * 0.65) {
                        // Complete swipe
                        isCompletedRef.current = true;
                        Animated.spring(slideAnim, {
                            toValue: maxSlide,
                            useNativeDriver: false,
                            bounciness: 0,
                        }).start();
                        try {
                            if (Platform.OS !== 'web') {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            }
                        } catch {}
                        onConfirm();
                    } else {
                        // Reset swipe back
                        Animated.spring(slideAnim, {
                            toValue: 0,
                            useNativeDriver: false,
                            bounciness: 4,
                        }).start();
                    }
                },
            }),
        [maxSlide, disabled, isConfirming, onConfirm]
    );

    const textOpacity = slideAnim.interpolate({
        inputRange: [0, maxSlide > 0 ? maxSlide * 0.5 : 1, Math.max(1, maxSlide)],
        outputRange: [1, 0.35, 0],
        extrapolate: 'clamp',
    });

    const fillWidth = containerWidth > 0
        ? slideAnim.interpolate({
              inputRange: [0, maxSlide],
              outputRange: [KNOB_SIZE + PADDING * 2, containerWidth],
              extrapolate: 'clamp',
          })
        : KNOB_SIZE + PADDING * 2;

    return (
        <View
            style={[styles.sliderTrack, { backgroundColor: '#064E3B' }]}
            onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
            {/* Animated Fill Behind Knob */}
            <Animated.View
                style={[
                    styles.sliderFill,
                    { width: fillWidth, backgroundColor: themeColor },
                ]}
            />

            {/* Slider Centered Title Text */}
            <Animated.View style={[styles.sliderTextWrapper, { opacity: textOpacity }]} pointerEvents="none">
                <Text style={styles.sliderText}>{title}</Text>
            </Animated.View>

            {/* Sliding Thumb Knob */}
            <Animated.View
                {...panResponder.panHandlers}
                style={[
                    styles.sliderKnob,
                    {
                        transform: [{ translateX: slideAnim }],
                    },
                ]}
            >
                {isConfirming ? (
                    <ActivityIndicator size="small" color="#059669" />
                ) : (
                    <Ionicons name="bus" size={22} color={themeColor} />
                )}
            </Animated.View>
        </View>
    );
}

function formatBoardedTime(isoString?: string) {
    if (!isoString) return 'earlier stop';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
        return isoString;
    }
}

export function ConductorBoardingCard({
    visible,
    verificationResult,
    onClose,
    onConfirmBoarding,
    isConfirming = false,
}: ConductorBoardingCardProps) {
    // In real-world cash transit, conductor collects cash on board by default
    const [cashCollected, setCashCollected] = useState(true);
    const [markAssistanceDone, setMarkAssistanceDone] = useState(false);

    if (!verificationResult) return null;

    const {
        booking,
        passengerName,
        dropOffHalt,
        boardingHalt,
        seatNumber,
        pairedSeatNumber,
        isPrioritySeat,
        isWheelchair,
        fareAmount,
        fareCurrency,
        paymentStatus,
        assistanceRequested,
        specialRequests,
        alreadyBoarded,
        boardedAt,
        guardianInfo,
    } = verificationResult;

    const isAlreadyPaid = paymentStatus === 'PAID';
    const hasAssistance =
        isWheelchair ||
        assistanceRequested?.boardingAssistance ||
        assistanceRequested?.walkingAssistance ||
        assistanceRequested?.prioritySeatAssistance;

    const handleConfirm = async () => {
        if (alreadyBoarded) {
            // Already boarded: close inspection card
            onClose();
            return;
        }

        try {
            if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch {}

        await onConfirmBoarding({
            bookingId: booking.bookingId,
            cashCollected: isAlreadyPaid ? true : cashCollected,
            assistanceProgress: markAssistanceDone ? 'COMPLETED' : 'IN_PROGRESS',
        });
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalBackdrop}>
                <View style={styles.sheetContainer}>
                    {/* Sheet Header */}
                    <View style={styles.sheetHeader}>
                        <View style={styles.headerLeftGroup}>
                            <View
                                style={[
                                    styles.validityBadge,
                                    alreadyBoarded
                                        ? styles.validityBadgeWarning
                                        : styles.validityBadgeSuccess,
                                ]}
                            >
                                <Ionicons
                                    name={alreadyBoarded ? 'checkmark-circle-outline' : 'checkmark-circle'}
                                    size={16}
                                    color={alreadyBoarded ? '#D97706' : '#059669'}
                                />
                                <Text
                                    style={[
                                        styles.validityBadgeText,
                                        { color: alreadyBoarded ? '#92400E' : '#065F46' },
                                    ]}
                                >
                                    {alreadyBoarded ? 'ALREADY ONBOARD' : 'TICKET VALID • CONFIRM BOARDING'}
                                </Text>
                            </View>
                            <Text style={styles.bookingIdText}>Ref: {booking.bookingId}</Text>
                        </View>

                        <TouchableOpacity
                            style={styles.closeBtn}
                            onPress={onClose}
                            accessibilityLabel="Close boarding card"
                        >
                            <Ionicons name="close" size={20} color="#64748B" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.scrollBody}
                    >
                        {/* Drop-off Destination Highlight (Primary Conductor Info) */}
                        <View style={styles.destinationHeroCard}>
                            <View style={styles.destHeaderRow}>
                                <Ionicons name="location" size={18} color="#0066CC" />
                                <Text style={styles.destHeaderLabel}>DROP-OFF DESTINATION HALT</Text>
                            </View>
                            <Text style={styles.destinationTitle}>{dropOffHalt}</Text>

                            <View style={styles.routePathRow}>
                                <View style={styles.routeDotStart} />
                                <Text style={styles.routeStopText}>From: {boardingHalt}</Text>
                                <Ionicons name="arrow-forward" size={14} color="#0066CC" style={{ marginHorizontal: 6 }} />
                                <View style={styles.routeDotEnd} />
                                <Text style={[styles.routeStopText, styles.routeStopBold]}>{dropOffHalt}</Text>
                            </View>
                        </View>

                        {/* Seat & Passenger Info Card */}
                        <View style={styles.infoCard}>
                            <View style={styles.seatRow}>
                                <View style={[styles.seatBadge, isWheelchair && styles.seatBadgeWheelchair]}>
                                    <Text style={styles.seatBadgeLabel}>SEAT</Text>
                                    <Text style={styles.seatBadgeNumber}>{seatNumber}</Text>
                                </View>

                                <View style={styles.passengerMetaCol}>
                                    <Text style={styles.passengerNameText} numberOfLines={1}>
                                        {passengerName || 'Commuter'}
                                    </Text>
                                    <Text style={styles.passengerSubText} numberOfLines={1}>
                                        Route {booking.journey?.routeNumber || '—'} · Bus {booking.vehicle?.numberPlate || '—'}
                                    </Text>

                                    {/* Badges */}
                                    <View style={styles.badgesRow}>
                                        {isWheelchair && (
                                            <View style={styles.wheelchairBadge}>
                                                <Ionicons name="accessibility" size={12} color="#7C3AED" />
                                                <Text style={styles.wheelchairBadgeText}>Wheelchair Bay</Text>
                                            </View>
                                        )}
                                        {pairedSeatNumber && (
                                            <View style={styles.companionBadge}>
                                                <Ionicons name="people" size={12} color="#7C3AED" />
                                                <Text style={styles.companionBadgeText}>+ Companion {pairedSeatNumber}</Text>
                                            </View>
                                        )}
                                        {isPrioritySeat && !isWheelchair && (
                                            <View style={styles.priorityBadge}>
                                                <Ionicons name="star" size={12} color="#D97706" />
                                                <Text style={styles.priorityBadgeText}>Priority Seating</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            </View>
                        </View>

                        {/* Cash Fare & Payment Status Card */}
                        <View style={styles.fareCard}>
                            <View style={styles.fareHeaderRow}>
                                <View>
                                    <Text style={styles.fareLabel}>Ticket Fare (Cash)</Text>
                                    <Text style={styles.fareAmount}>
                                        {fareCurrency} {fareAmount.toFixed(2)}
                                    </Text>
                                </View>

                                <View
                                    style={[
                                        styles.paymentBadge,
                                        isAlreadyPaid
                                            ? styles.paymentBadgePaid
                                            : styles.paymentBadgeCash,
                                    ]}
                                >
                                    <Ionicons
                                        name={isAlreadyPaid ? 'checkmark-circle' : 'cash-outline'}
                                        size={14}
                                        color={isAlreadyPaid ? '#047857' : '#B45309'}
                                    />
                                    <Text
                                        style={[
                                            styles.paymentBadgeText,
                                            { color: isAlreadyPaid ? '#065F46' : '#92400E' },
                                        ]}
                                    >
                                        {isAlreadyPaid ? 'PAID · CASH' : 'CASH TO COLLECT'}
                                    </Text>
                                </View>
                            </View>

                            {!isAlreadyPaid && !alreadyBoarded && (
                                <TouchableOpacity
                                    style={[
                                        styles.cashCollectCheckRow,
                                        cashCollected && styles.cashCollectCheckRowActive,
                                    ]}
                                    onPress={() => setCashCollected(!cashCollected)}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons
                                        name={cashCollected ? 'checkbox' : 'square-outline'}
                                        size={22}
                                        color={cashCollected ? '#059669' : '#64748B'}
                                    />
                                    <View style={{ flex: 1, marginLeft: 8 }}>
                                        <Text style={styles.cashCollectCheckText}>
                                            Cash Received ({fareCurrency} {fareAmount.toFixed(2)}) from passenger
                                        </Text>
                                        <Text style={styles.cashCollectSubText}>
                                            {cashCollected ? 'Payment marked complete upon confirmation' : 'Payment remains pending cash collection'}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Already Boarded Notice */}
                        {alreadyBoarded && (
                            <View style={styles.alreadyBoardedNotice}>
                                <Ionicons name="information-circle" size={22} color="#D97706" />
                                <View style={{ flex: 1, marginLeft: 8 }}>
                                    <Text style={styles.alreadyBoardedTitle}>Passenger Already Onboard</Text>
                                    <Text style={styles.alreadyBoardedText}>
                                        Verified and boarded at {formatBoardedTime(boardedAt)}. Fare {isAlreadyPaid ? 'paid in cash' : 'pending'}.
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* Accessibility Assistance Section */}
                        {hasAssistance && (
                            <View style={styles.assistanceCard}>
                                <View style={styles.assistanceHeaderRow}>
                                    <Ionicons name="hand-left" size={18} color="#7C3AED" />
                                    <Text style={styles.assistanceHeaderTitle}>
                                        Conductor Assistance Required ♿
                                    </Text>
                                </View>

                                <View style={styles.assistanceList}>
                                    {isWheelchair && (
                                        <View style={styles.assistItem}>
                                            <Ionicons name="checkmark-circle" size={16} color="#7C3AED" />
                                            <Text style={styles.assistItemText}>
                                                Deploy Wheelchair Ramp & Secure Wheelchair Lock
                                            </Text>
                                        </View>
                                    )}
                                    {assistanceRequested?.boardingAssistance && (
                                        <View style={styles.assistItem}>
                                            <Ionicons name="checkmark-circle" size={16} color="#0284C7" />
                                            <Text style={styles.assistItemText}>
                                                Provide Physical Boarding / Step Support
                                            </Text>
                                        </View>
                                    )}
                                    {assistanceRequested?.walkingAssistance && (
                                        <View style={styles.assistItem}>
                                            <Ionicons name="checkmark-circle" size={16} color="#4338CA" />
                                            <Text style={styles.assistItemText}>
                                                Walking Escort to Assigned Seat {seatNumber}
                                            </Text>
                                        </View>
                                    )}
                                    {assistanceRequested?.prioritySeatAssistance && (
                                        <View style={styles.assistItem}>
                                            <Ionicons name="checkmark-circle" size={16} color="#D97706" />
                                            <Text style={styles.assistItemText}>
                                                Ensure Priority Seating Space is clear
                                            </Text>
                                        </View>
                                    )}
                                    {!!specialRequests && (
                                        <View style={styles.specialNoteBox}>
                                            <Text style={styles.specialNoteLabel}>Passenger Note:</Text>
                                            <Text style={styles.specialNoteText}>"{specialRequests}"</Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                        {/* Guardian / Caregiver Live Alert Notice */}
                        {guardianInfo && (
                            <View style={styles.guardianNoticeCard}>
                                <Ionicons name="shield-checkmark" size={18} color="#059669" />
                                <View style={{ flex: 1, marginLeft: 8 }}>
                                    <Text style={styles.guardianNoticeTitle}>
                                        Linked Caregiver: {guardianInfo.fullName} ({guardianInfo.relationship})
                                    </Text>
                                    <Text style={styles.guardianNoticeSub}>
                                        Caregiver is notified automatically upon passenger boarding.
                                    </Text>
                                </View>
                            </View>
                        )}
                    </ScrollView>

                    {/* Bottom Action Bar */}
                    <View style={styles.footerBar}>
                        {alreadyBoarded ? (
                            /* Already Boarded State: Inspection dismissal */
                            <TouchableOpacity
                                style={styles.alreadyBoardedBtn}
                                onPress={onClose}
                                activeOpacity={0.9}
                            >
                                <Ionicons
                                    name="checkmark-circle"
                                    size={20}
                                    color="#FFFFFF"
                                />
                                <Text style={styles.confirmBtnText}>
                                    Passenger Onboard (Done)
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            /* New Boarding State: Slide to Confirm & Collect Cash */
                            <SlideToConfirm
                                onConfirm={handleConfirm}
                                isConfirming={isConfirming}
                                title={
                                    cashCollected || isAlreadyPaid
                                        ? 'Slide to Confirm Boarding & Cash ➔'
                                        : 'Slide to Confirm Boarding (Cash Pending) ➔'
                                }
                                themeColor={cashCollected || isAlreadyPaid ? '#059669' : '#D97706'}
                            />
                        )}

                        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                            <Text style={styles.cancelBtnText}>Back to Scanner</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        justifyContent: 'flex-end',
    },
    sheetContainer: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '92%',
        paddingBottom: Platform.OS === 'ios' ? 30 : 16,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    headerLeftGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    validityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        gap: 5,
    },
    validityBadgeSuccess: {
        backgroundColor: '#D1FAE5',
    },
    validityBadgeWarning: {
        backgroundColor: '#FEF3C7',
    },
    validityBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    bookingIdText: {
        fontSize: 12,
        color: '#64748B',
        fontWeight: '700',
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    scrollBody: {
        padding: 20,
        gap: 14,
    },
    destinationHeroCard: {
        backgroundColor: '#F0F7FF',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1.5,
        borderColor: '#BAE6FD',
    },
    destHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    destHeaderLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: '#0284C7',
        letterSpacing: 0.5,
    },
    destinationTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: '#0F172A',
        marginBottom: 8,
    },
    routePathRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E0F2FE',
    },
    routeDotStart: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#64748B',
        marginRight: 6,
    },
    routeDotEnd: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#0066CC',
        marginRight: 6,
    },
    routeStopText: {
        fontSize: 12,
        color: '#334155',
    },
    routeStopBold: {
        fontWeight: '800',
        color: '#0066CC',
    },
    infoCard: {
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    seatRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    seatBadge: {
        width: 68,
        height: 68,
        borderRadius: 14,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    seatBadgeWheelchair: {
        backgroundColor: '#6D28D9',
    },
    seatBadgeLabel: {
        fontSize: 9,
        fontWeight: '800',
        color: '#BAE6FD',
        marginBottom: 2,
    },
    seatBadgeNumber: {
        fontSize: 20,
        fontWeight: '900',
        color: '#FFFFFF',
    },
    passengerMetaCol: {
        flex: 1,
    },
    passengerNameText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 2,
    },
    passengerSubText: {
        fontSize: 12,
        color: '#64748B',
        marginBottom: 6,
    },
    badgesRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    wheelchairBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3E8FF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        gap: 4,
    },
    wheelchairBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7C3AED',
    },
    companionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F5F3FF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        gap: 4,
    },
    companionBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6D28D9',
    },
    priorityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        gap: 4,
    },
    priorityBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#D97706',
    },
    fareCard: {
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    fareHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    fareLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
        textTransform: 'uppercase',
    },
    fareAmount: {
        fontSize: 18,
        fontWeight: '900',
        color: '#0F172A',
        marginTop: 2,
    },
    paymentBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 5,
    },
    paymentBadgePaid: {
        backgroundColor: '#D1FAE5',
    },
    paymentBadgeCash: {
        backgroundColor: '#FEF3C7',
    },
    paymentBadgeText: {
        fontSize: 11,
        fontWeight: '800',
    },
    cashCollectCheckRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    cashCollectCheckRowActive: {
        backgroundColor: '#ECFDF5',
        marginHorizontal: -8,
        paddingHorizontal: 8,
        borderRadius: 8,
    },
    cashCollectCheckText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
    },
    cashCollectSubText: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    assistanceCard: {
        backgroundColor: '#FAF5FF',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E9D5FF',
    },
    assistanceHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    assistanceHeaderTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#7C3AED',
    },
    assistanceList: {
        gap: 8,
    },
    assistItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    assistItemText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
        flex: 1,
    },
    specialNoteBox: {
        marginTop: 6,
        padding: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E9D5FF',
    },
    specialNoteLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#7C3AED',
    },
    specialNoteText: {
        fontSize: 12,
        fontStyle: 'italic',
        color: '#475569',
        marginTop: 2,
    },
    guardianNoticeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ECFDF5',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#A7F3D0',
    },
    guardianNoticeTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#065F46',
    },
    guardianNoticeSub: {
        fontSize: 11,
        color: '#047857',
        marginTop: 2,
    },
    alreadyBoardedNotice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: '#FFFBEB',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    alreadyBoardedTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#92400E',
        marginBottom: 2,
    },
    alreadyBoardedText: {
        fontSize: 12,
        color: '#78350F',
        lineHeight: 17,
    },
    footerBar: {
        paddingHorizontal: 20,
        paddingTop: 10,
        gap: 10,
    },
    sliderTrack: {
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
        elevation: 2,
        shadowColor: '#059669',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
    sliderFill: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        borderRadius: 28,
    },
    sliderTextWrapper: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 54,
    },
    sliderText: {
        color: '#FFFFFF',
        fontWeight: '900',
        fontSize: 13,
        letterSpacing: 0.3,
        textAlign: 'center',
    },
    sliderKnob: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'absolute',
        left: 4,
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
    },
    alreadyBoardedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0F172A',
        paddingVertical: 14,
        borderRadius: 14,
        gap: 8,
        elevation: 2,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
    confirmBtnText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#FFFFFF',
    },
    cancelBtn: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    cancelBtnText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#64748B',
    },
});
