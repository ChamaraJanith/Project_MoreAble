import { AppText as Text } from '../../../src/shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FareBreakdown } from '../../../src/entities/booking/model/types';
import {
    confirmBooking,
    fetchFare,
} from '../../../src/features/booking/api/bookingApi';
import {
    setSelectedVehicle,
    useSelectedVehicle,
} from '../../../src/features/booking/store/selectedVehicleStore';
import { useAuthStore } from '../../../src/shared/store/authStore';

export default function BookingConfirmScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const {
        tripId,
        seatNumber,
        isPrioritySeat,
        origin,
        destination,
    } = useLocalSearchParams<{
        tripId: string;
        seatNumber: string;
        isPrioritySeat: string;
        origin?: string;
        destination?: string;
    }>();

    const selectedVehicle = useSelectedVehicle();
    const { user } = useAuthStore();

    const journeyOrigin =
        (origin as string) ||
        selectedVehicle?.origin ||
        '—';

    const journeyDestination =
        (destination as string) ||
        selectedVehicle?.destination ||
        '—';

    const [fare, setFare] =
        useState<FareBreakdown | null>(null);

    const [fareLoading, setFareLoading] =
        useState(true);

    const [fareError, setFareError] =
        useState('');

    const isSeatWheelchair = (seatNumber as string)?.startsWith('W');
    const isUserWheelchair = Boolean((user as any)?.isWheelchairUser || (user as any)?.accessibilityNeeds?.includes('wheelchair'));
    const isUserWalking = Boolean((user as any)?.isWalkingDifficultyPerson || (user as any)?.accessibilityNeeds?.includes('walking_difficulty'));

    const [wheelchairAssistance, setWheelchairAssistance] =
        useState(isSeatWheelchair || isUserWheelchair);

    const [boardingAssistance, setBoardingAssistance] =
        useState(isSeatWheelchair || isUserWheelchair);

    const [walkingAssistance, setWalkingAssistance] =
        useState(isUserWalking);

    const [prioritySeatAssistance, setPrioritySeatAssistance] =
        useState(isPrioritySeat === '1');

    const [specialRequests, setSpecialRequests] =
        useState('');

    const requiresReceiverDetails = isSeatWheelchair || isUserWheelchair || prioritySeatAssistance;

    const [receiverName, setReceiverName] = useState('');
    const [receiverPhone, setReceiverPhone] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [isCodeSent, setIsCodeSent] = useState(false);
    const [isVerified, setIsVerified] = useState(false);

    const [hasConfirmedDetails, setHasConfirmedDetails] =
        useState(false);

    const [isSubmitting, setIsSubmitting] =
        useState(false);

    const [submitError, setSubmitError] =
        useState('');

    const hasAssistance =
        wheelchairAssistance ||
        boardingAssistance ||
        walkingAssistance ||
        prioritySeatAssistance;

    useEffect(() => {
        if (
            !selectedVehicle?.routeId ||
            journeyOrigin === '—' ||
            journeyDestination === '—'
        ) {
            setFareLoading(false);
            return;
        }

        setFareLoading(true);
        setFareError('');

        fetchFare(
            selectedVehicle.routeId,
            journeyOrigin,
            journeyDestination,
            {
                passengerId: user?.passengerId,
                hasAssistance,
                isWheelchair: isSeatWheelchair || isUserWheelchair,
            }
        )
            .then(setFare)
            .catch((err) => setFareError(err.message))
            .finally(() => setFareLoading(false));
    }, [
        selectedVehicle?.routeId,
        journeyOrigin,
        journeyDestination,
        user?.passengerId,
        hasAssistance,
        isSeatWheelchair,
        isUserWheelchair,
    ]);

    async function handleConfirm() {
        if (
            !tripId ||
            !seatNumber ||
            !hasConfirmedDetails
        ) {
            return;
        }

        if (requiresReceiverDetails && (!isVerified || !receiverName || !receiverPhone)) {
            setSubmitError('Please verify receiver details before confirming.');
            return;
        }

        setIsSubmitting(true);
        setSubmitError('');

        try {
            const booking = await confirmBooking({
                tripId: tripId as string,
                seatNumber: seatNumber as string,
                passengerId: user?.passengerId,
                origin:
                    journeyOrigin !== '—'
                        ? journeyOrigin
                        : undefined,
                destination:
                    journeyDestination !== '—'
                        ? journeyDestination
                        : undefined,
                assistanceRequested: {
                    wheelchairAssistance,
                    boardingAssistance,
                    walkingAssistance,
                    prioritySeatAssistance,
                },
                specialRequests:
                    specialRequests.trim() || undefined,
                receiverDetails: requiresReceiverDetails
                    ? { name: receiverName, phone: receiverPhone }
                    : undefined,
            });

            setSelectedVehicle(null);

            router.replace({
                pathname:
                    '/booking/ticket/[bookingId]',
                params: {
                    bookingId: booking.bookingId,
                },
            });
        } catch (err: any) {
            setSubmitError(
                err.message ||
                'Unable to confirm this booking. Please try again.'
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <ScrollView
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: insets.top > 0 ? insets.top + 10 : 20,
                    paddingBottom: insets.bottom > 0 ? insets.bottom + 40 : 40,
                },
            ]}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.headerRow}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name="arrow-back"
                        size={22}
                        color="#0F172A"
                    />
                </TouchableOpacity>

                <View style={styles.headerTextGroup}>
                    <Text style={styles.title}>
                        Review Booking
                    </Text>
                    <Text style={styles.subtitle}>
                        Confirm trip details & accessibility fare
                    </Text>
                </View>
            </View>

            {/* Passenger Details */}
            <Text style={styles.sectionLabel}>
                Passenger Details
            </Text>

            <View style={styles.card}>
                <View style={styles.passengerRow}>
                    <View style={styles.passengerAvatar}>
                        <Ionicons
                            name="person"
                            size={20}
                            color="#64748B"
                        />
                    </View>

                    <View style={{ flex: 1 }}>
                        <Text
                            style={styles.passengerName}
                        >
                            {user?.userName ||
                                'Guest Passenger'}
                        </Text>

                        <Text
                            style={styles.passengerType}
                        >
                            {user?.isElderPerson
                                ? 'Elderly Passenger'
                                : 'Community Commuter'}
                        </Text>
                    </View>
                </View>

                <TextInput
                    style={styles.assistanceInput}
                    placeholder="Mobility assistance or special requests (optional)"
                    placeholderTextColor="#94A3B8"
                    value={specialRequests}
                    onChangeText={setSpecialRequests}
                    multiline
                    accessibilityLabel="Mobility assistance or special requests"
                />
            </View>

            {/* Receiver Details (Conditional) */}
            {requiresReceiverDetails && (
                <>
                    <Text style={styles.sectionLabel}>
                        Receiver Details (Required for Special Seats)
                    </Text>

                    <View style={styles.card}>
                        <TextInput
                            style={styles.receiverInput}
                            placeholder="Receiver Name"
                            placeholderTextColor="#94A3B8"
                            value={receiverName}
                            onChangeText={setReceiverName}
                            editable={!isVerified}
                        />
                        <TextInput
                            style={[styles.receiverInput, { marginTop: 12 }]}
                            placeholder="Receiver Phone Number"
                            placeholderTextColor="#94A3B8"
                            value={receiverPhone}
                            onChangeText={setReceiverPhone}
                            keyboardType="phone-pad"
                            editable={!isVerified}
                        />

                        {!isCodeSent ? (
                            <TouchableOpacity
                                style={styles.verifyButton}
                                onPress={() => {
                                    if (!receiverName || !receiverPhone) {
                                        Alert.alert('Error', 'Please enter name and phone number.');
                                        return;
                                    }
                                    setIsCodeSent(true);
                                    Alert.alert('Code Sent', 'A verification code has been sent to the receiver. (Use 1234)');
                                }}
                            >
                                <Text style={styles.verifyButtonText}>Send Code</Text>
                            </TouchableOpacity>
                        ) : !isVerified ? (
                            <View style={styles.verificationContainer}>
                                <TextInput
                                    style={styles.codeInput}
                                    placeholder="Enter Code (e.g. 1234)"
                                    placeholderTextColor="#94A3B8"
                                    value={verificationCode}
                                    onChangeText={setVerificationCode}
                                    keyboardType="number-pad"
                                />
                                <TouchableOpacity
                                    style={styles.verifyConfirmButton}
                                    onPress={() => {
                                        if (verificationCode === '1234') {
                                            setIsVerified(true);
                                            Alert.alert('Verified', 'Receiver details verified successfully.');
                                        } else {
                                            Alert.alert('Error', 'Invalid verification code.');
                                        }
                                    }}
                                >
                                    <Text style={styles.verifyButtonText}>Verify</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.verifiedBadge}>
                                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                                <Text style={styles.verifiedText}>Receiver Verified</Text>
                            </View>
                        )}
                    </View>
                </>
            )}

            {/* Trip Details */}
            <Text style={styles.sectionLabel}>
                Trip Details
            </Text>

            <View style={styles.card}>
                <View style={styles.busRow}>
                    <View>
                        <Text style={styles.busPlate}>
                            {selectedVehicle?.numberPlate ??
                                '—'}
                        </Text>

                        <Text style={styles.busModel}>
                            {selectedVehicle?.busModel ?? ''}
                        </Text>
                    </View>

                    <View style={styles.busBadge}>
                        <Text
                            style={styles.busBadgeText}
                        >
                            ROUTE{' '}
                            {selectedVehicle?.routeNumber ??
                                '—'}
                        </Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.stopRow}>
                    <Ionicons
                        name="ellipse-outline"
                        size={14}
                        color="#0066CC"
                    />

                    <View style={{ marginLeft: 10 }}>
                        <Text style={styles.stopLabel}>
                            Pick-up
                        </Text>

                        <Text style={styles.stopValue}>
                            {journeyOrigin}
                        </Text>
                    </View>
                </View>

                <View style={styles.stopRow}>
                    <Ionicons
                        name="location"
                        size={14}
                        color="#0F172A"
                    />

                    <View style={{ marginLeft: 10 }}>
                        <Text style={styles.stopLabel}>
                            Drop-off
                        </Text>

                        <Text style={styles.stopValue}>
                            {journeyDestination}
                        </Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.timeRow}>
                    <Text style={styles.timeText}>
                        Departs{' '}
                        {selectedVehicle?.departureTime ??
                            '—'}
                    </Text>

                    <Text style={styles.timeText}>
                        Est. arrival{' '}
                        {selectedVehicle?.estimatedArrivalTime ??
                            '—'}
                    </Text>
                </View>
            </View>

            {/* Seat */}
            <Text style={styles.sectionLabel}>
                Seat
            </Text>

            <View style={styles.card}>
                <View style={styles.row}>
                    <Text style={styles.rowLabel}>
                        Seat Number
                    </Text>

                    <Text style={styles.rowValue}>
                        {(seatNumber as string) ?? '—'}
                        {isPrioritySeat === '1'
                            ? ' (Priority)'
                            : ''}
                    </Text>
                </View>
            </View>

            {/* Assistance Requested */}
            <Text style={styles.sectionLabel}>
                Assistance Requested
            </Text>

            {(wheelchairAssistance || isSeatWheelchair) && (
                <View style={styles.guardianNoticeCard}>
                    <View style={styles.guardianNoticeHeader}>
                        <View style={styles.guardianNoticeIconCircle}>
                            <Ionicons name="people" size={20} color="#6D28D9" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <View style={styles.guardianBadgeRow}>
                                <Text style={styles.guardianNoticeTitle}>
                                    Wheelchair & Companion Paired
                                </Text>
                                <View style={styles.guardianSeatBadge}>
                                    <Text style={styles.guardianSeatBadgeText}>SEAT G1 RESERVED</Text>
                                </View>
                            </View>
                            <Text style={styles.guardianNoticeText}>
                                Seat G1 is automatically reserved right beside wheelchair space W1 for your accompanying helper or family member.
                            </Text>
                        </View>
                    </View>
                </View>
            )}

            <View style={styles.card}>
                <AssistanceToggle
                    label="Wheelchair Assistance & Ramp"
                    description="Crew deploys ramp and secures wheelchair safely"
                    iconName="accessibility"
                    iconColor="#0284C7"
                    value={wheelchairAssistance}
                    onChange={setWheelchairAssistance}
                />

                <AssistanceToggle
                    label="Boarding Support & Assistance"
                    description="Staff assists with steps, door entry, and heavy bags"
                    iconName="hand-left"
                    iconColor="#7C3AED"
                    value={boardingAssistance}
                    onChange={setBoardingAssistance}
                />

                <AssistanceToggle
                    label="Walking Assistance"
                    description="Personal guidance and support walking to your seat"
                    iconName="walk"
                    iconColor="#D97706"
                    value={walkingAssistance}
                    onChange={setWalkingAssistance}
                />

                <AssistanceToggle
                    label="Priority Seat Assistance"
                    description="Reserved front-row seating with extra legroom"
                    iconName="ribbon"
                    iconColor="#059669"
                    value={prioritySeatAssistance}
                    onChange={setPrioritySeatAssistance}
                    isLast
                />
            </View>

            {/* Estimated Fare */}
            <Text style={styles.sectionLabel}>
                Estimated Fare Breakdown
            </Text>

            <View style={styles.fareContainerCard}>
                {fareLoading ? (
                    <View style={styles.fareLoadingBox}>
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.fareLoadingText}>Calculating accurate fare...</Text>
                    </View>
                ) : fareError ? (
                    <View style={styles.fareErrorBox}>
                        <Ionicons name="alert-circle" size={24} color="#EF4444" />
                        <Text style={styles.fareErrorText}>{fareError}</Text>
                    </View>
                ) : fare ? (
                    <>
                        {/* Summary Header */}
                        <View style={styles.fareHeaderBanner}>
                            <View>
                                <Text style={styles.fareHeaderSubtitle}>Journey Distance</Text>
                                <Text style={styles.fareHeaderDistance}>{fare.distanceKm} Kilometers</Text>
                            </View>
                            <View style={styles.fareHeaderTotalBox}>
                                <Text style={styles.fareHeaderTotalLabel}>TOTAL AMOUNT</Text>
                                <Text style={styles.fareHeaderTotalValue}>LKR {fare.totalFare}.00</Text>
                            </View>
                        </View>

                        {/* Itemized Breakdown Table */}
                        <View style={styles.fareBreakdownList}>
                            {/* Base Fare Row */}
                            <View style={styles.fareItemRow}>
                                <View style={styles.fareItemIconCircle}>
                                    <Ionicons name="bus-outline" size={16} color="#0284C7" />
                                </View>
                                <View style={styles.fareItemTextCol}>
                                    <Text style={styles.fareItemTitle}>Transit Journey Fare</Text>
                                    <Text style={styles.fareItemDesc}>
                                        Base Rs. {fare.baseFare} + Distance Rs. {fare.distanceFare}
                                        {fare.isEstimate ? ' (estimated)' : ''}
                                    </Text>
                                </View>
                                <Text style={styles.fareItemPrice}>LKR {fare.subtotalFare}.00</Text>
                            </View>

                            {/* Concession Discount Row */}
                            {Boolean(fare.concessionDiscount && fare.concessionDiscount > 0) && (
                                <View style={styles.fareItemRow}>
                                    <View style={[styles.fareItemIconCircle, { backgroundColor: '#ECFDF5' }]}>
                                        <Ionicons name="gift-outline" size={16} color="#059669" />
                                    </View>
                                    <View style={styles.fareItemTextCol}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <Text style={[styles.fareItemTitle, { color: '#047857' }]}>
                                                {fare.concessionType === 'ACCESSIBILITY'
                                                    ? 'Accessibility Concession'
                                                    : 'Senior Citizen (60+) Discount'}
                                            </Text>
                                            <View style={styles.discountBadge}>
                                                <Text style={styles.discountBadgeText}>-{fare.concessionDiscountPercent}%</Text>
                                            </View>
                                        </View>
                                        <Text style={styles.fareItemDesc}>Applied to verified passenger profile</Text>
                                    </View>
                                    <Text style={[styles.fareItemPrice, { color: '#059669', fontWeight: '800' }]}>
                                        - LKR {fare.concessionDiscount}.00
                                    </Text>
                                </View>
                            )}

                            {/* Conductor Assistance Fee Row */}
                            {Boolean(fare.assistanceFee && fare.assistanceFee > 0) && (
                                <View style={styles.fareItemRow}>
                                    <View style={[styles.fareItemIconCircle, { backgroundColor: '#F3E8FF' }]}>
                                        <Ionicons name="hand-left-outline" size={16} color="#7C3AED" />
                                    </View>
                                    <View style={styles.fareItemTextCol}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <Text style={[styles.fareItemTitle, { color: '#6D28D9' }]}>
                                                Dedicated Crew Assistance
                                            </Text>
                                            <View style={styles.assistBadge}>
                                                <Text style={styles.assistBadgeText}>STAFF SUPPORT</Text>
                                            </View>
                                        </View>
                                        <Text style={styles.fareItemDesc}>Ramp deployment & boarding care</Text>
                                    </View>
                                    <Text style={[styles.fareItemPrice, { color: '#6D28D9' }]}>
                                        + LKR {fare.assistanceFee}.00
                                    </Text>
                                </View>
                            )}

                            {/* Guardian Companion Seat Row */}
                            {Boolean(fare.guardianFare && fare.guardianFare > 0) && (
                                <View style={styles.fareItemRow}>
                                    <View style={[styles.fareItemIconCircle, { backgroundColor: '#EFF6FF' }]}>
                                        <Ionicons name="people-outline" size={16} color="#0284C7" />
                                    </View>
                                    <View style={styles.fareItemTextCol}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <Text style={[styles.fareItemTitle, { color: '#0369A1' }]}>
                                                Guardian Seat ({fare.pairedSeatNumber ?? 'G1'})
                                            </Text>
                                            <View style={styles.guardianPill}>
                                                <Text style={styles.guardianPillText}>COMPANION SEAT</Text>
                                            </View>
                                        </View>
                                        <Text style={styles.fareItemDesc}>Auto-reserved companion ticket ({fare.guardianRatePercent}%)</Text>
                                    </View>
                                    <Text style={[styles.fareItemPrice, { color: '#0284C7' }]}>
                                        + LKR {fare.guardianFare}.00
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Total Card Footer */}
                        <View style={styles.fareFooterBox}>
                            <View style={styles.fareFooterRow}>
                                <Ionicons name="card-outline" size={18} color="#0284C7" />
                                <Text style={styles.fareFooterNote}>
                                    Pay cash or scan contactless QR upon boarding to conductor
                                </Text>
                            </View>
                        </View>
                    </>
                ) : (
                    <View style={styles.fareErrorBox}>
                        <Text style={styles.fareErrorText}>Fare details currently unavailable.</Text>
                    </View>
                )}
            </View>

            <View style={styles.noteBanner}>
                <Ionicons
                    name="time-outline"
                    size={18}
                    color="#0066CC"
                />

                <Text style={styles.noteText}>
                    Please arrive at the boarding point at least 10 minutes before departure.
                </Text>
            </View>

            <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() =>
                    setHasConfirmedDetails(
                        (v) => !v
                    )
                }
                accessibilityRole="checkbox"
                accessibilityState={{
                    checked: hasConfirmedDetails,
                }}
                accessibilityLabel="I confirm that the booking details are correct"
            >
                <Ionicons
                    name={
                        hasConfirmedDetails
                            ? 'checkbox'
                            : 'square-outline'
                    }
                    size={24}
                    color={
                        hasConfirmedDetails
                            ? '#0066CC'
                            : '#94A3B8'
                    }
                />

                <Text style={styles.checkboxText}>
                    I confirm that the passenger and journey details are correct.
                </Text>
            </TouchableOpacity>

            {!!submitError && (
                <View style={styles.errorBanner}>
                    <Ionicons
                        name="alert-circle-outline"
                        size={18}
                        color="#D32F2F"
                    />

                    <Text style={styles.errorText}>
                        {submitError}
                    </Text>
                </View>
            )}

            <TouchableOpacity
                style={[
                    styles.confirmButton,
                    (!hasConfirmedDetails ||
                        isSubmitting ||
                        (requiresReceiverDetails && !isVerified)) &&
                        styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirm}
                disabled={
                    !hasConfirmedDetails ||
                    isSubmitting ||
                    (requiresReceiverDetails && !isVerified)
                }
                accessibilityRole="button"
                accessibilityLabel="Confirm booking"
                accessibilityState={{
                    disabled:
                        !hasConfirmedDetails ||
                        isSubmitting ||
                        (requiresReceiverDetails && !isVerified),
                }}
            >
                {isSubmitting ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <View style={styles.confirmButtonContent}>
                        <Ionicons name="checkmark-circle-outline" size={22} color="#FFFFFF" />
                        <Text style={styles.confirmButtonText}>
                            CONFIRM BOOKING
                        </Text>
                    </View>
                )}
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.editButton}
                onPress={() => router.back()}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Edit booking"
            >
                <Text style={styles.editButtonText}>
                    Edit Booking Details
                </Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

function AssistanceToggle({
    label,
    description,
    iconName,
    iconColor = '#0066CC',
    value,
    onChange,
    isLast,
}: {
    label: string;
    description?: string;
    iconName: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    value: boolean;
    onChange: (v: boolean) => void;
    isLast?: boolean;
}) {
    return (
        <TouchableOpacity
            style={[
                styles.assistanceRow,
                value && styles.assistanceRowActive,
                isLast && styles.assistanceRowLast,
            ]}
            onPress={() => onChange(!value)}
            accessibilityRole="checkbox"
            accessibilityState={{
                checked: value,
            }}
            accessibilityLabel={`${label}. ${description || ''}`}
        >
            <View style={[styles.assistanceIconContainer, { backgroundColor: value ? '#EBF3FA' : '#F1F5F9' }]}>
                <Ionicons name={iconName} size={20} color={value ? iconColor : '#94A3B8'} />
            </View>

            <View style={styles.assistanceTextContainer}>
                <Text style={[styles.assistanceLabel, value && styles.assistanceLabelActive]}>
                    {label}
                </Text>
                {!!description && (
                    <Text style={styles.assistanceDescription}>
                        {description}
                    </Text>
                )}
            </View>

            <Ionicons
                name={
                    value
                        ? 'checkbox'
                        : 'square-outline'
                }
                size={24}
                color={
                    value
                        ? '#059669'
                        : '#CBD5E1'
                }
            />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    content: {
        padding: 16,
        backgroundColor: '#F8FAFC',
        flexGrow: 1,
        paddingBottom: 40,
    },

    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },

    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
    },

    headerTextGroup: {
        marginLeft: 12,
        flex: 1,
    },

    title: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.3,
    },

    subtitle: {
        fontSize: 13,
        color: '#64748B',
        fontWeight: '500',
        marginTop: 2,
    },

    sectionLabel: {
        fontSize: 13,
        fontWeight: '800',
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 18,
        marginBottom: 8,
    },

    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
    },

    passengerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    passengerAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },

    passengerName: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
    },

    passengerType: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
        fontWeight: '500',
    },

    assistanceInput: {
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 10,
        padding: 12,
        minHeight: 48,
        fontSize: 14,
        color: '#0F172A',
        textAlignVertical: 'top',
        backgroundColor: '#FAFAFA',
    },

    receiverInput: {
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 10,
        padding: 12,
        fontSize: 14,
        color: '#0F172A',
        backgroundColor: '#FAFAFA',
    },

    verifyButton: {
        backgroundColor: '#0066CC',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
        marginTop: 12,
    },

    verifyButtonText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: 14,
    },

    verificationContainer: {
        flexDirection: 'row',
        marginTop: 12,
        gap: 8,
    },

    codeInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 10,
        padding: 12,
        fontSize: 14,
        color: '#0F172A',
        backgroundColor: '#FAFAFA',
    },

    verifyConfirmButton: {
        backgroundColor: '#059669',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },

    verifiedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#D1FAE5',
        padding: 8,
        borderRadius: 8,
        marginTop: 12,
        justifyContent: 'center',
        gap: 6,
    },

    verifiedText: {
        color: '#047857',
        fontWeight: '600',
        fontSize: 13,
    },

    busRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },

    busPlate: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
    },

    busModel: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
    },

    busBadge: {
        backgroundColor: '#EBF3FA',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: '#BAE6FD',
    },

    busBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#0066CC',
        letterSpacing: 0.3,
    },

    divider: {
        height: 1,
        backgroundColor: '#F1F5F9',
        marginVertical: 12,
    },

    stopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },

    stopLabel: {
        fontSize: 11,
        color: '#94A3B8',
        fontWeight: '600',
        textTransform: 'uppercase',
    },

    stopValue: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
        marginTop: 2,
    },

    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },

    timeText: {
        fontSize: 13,
        color: '#475569',
        fontWeight: '600',
    },

    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },

    rowLabel: {
        fontSize: 14,
        color: '#64748B',
        fontWeight: '500',
    },

    rowValue: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
    },

    // Guardian Notice Card
    guardianNoticeCard: {
        backgroundColor: '#FAF5FF',
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1.5,
        borderColor: '#DDD6FE',
    },

    guardianNoticeHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },

    guardianNoticeIconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#EDE9FE',
        justifyContent: 'center',
        alignItems: 'center',
    },

    guardianBadgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 4,
    },

    guardianNoticeTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#6B21A8',
    },

    guardianSeatBadge: {
        backgroundColor: '#7C3AED',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },

    guardianSeatBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.4,
    },

    guardianNoticeText: {
        fontSize: 12,
        color: '#581C87',
        lineHeight: 17,
    },

    // Assistance Rows
    assistanceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 6,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
        borderRadius: 10,
    },

    assistanceRowActive: {
        backgroundColor: '#F8FAFC',
    },

    assistanceRowLast: {
        borderBottomWidth: 0,
    },

    assistanceIconContainer: {
        width: 38,
        height: 38,
        borderRadius: 19,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },

    assistanceTextContainer: {
        flex: 1,
        marginRight: 8,
    },

    assistanceLabel: {
        fontSize: 14,
        color: '#1E293B',
        fontWeight: '700',
    },

    assistanceLabelActive: {
        color: '#0F172A',
    },

    assistanceDescription: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
        lineHeight: 16,
    },

    // Enhanced Fare Card Breakdown
    fareContainerCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        overflow: 'hidden',
        shadowColor: '#0052A3',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },

    fareHeaderBanner: {
        backgroundColor: '#0052A3',
        paddingHorizontal: 18,
        paddingVertical: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },

    fareHeaderSubtitle: {
        fontSize: 11,
        color: '#BAE6FD',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },

    fareHeaderDistance: {
        fontSize: 16,
        fontWeight: '800',
        color: '#FFFFFF',
        marginTop: 2,
    },

    fareHeaderTotalBox: {
        alignItems: 'flex-end',
    },

    fareHeaderTotalLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: '#BAE6FD',
        letterSpacing: 0.6,
    },

    fareHeaderTotalValue: {
        fontSize: 24,
        fontWeight: '900',
        color: '#FFFFFF',
        marginTop: 1,
    },

    fareBreakdownList: {
        padding: 16,
        backgroundColor: '#FFFFFF',
        gap: 12,
    },

    fareItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },

    fareItemIconCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },

    fareItemTextCol: {
        flex: 1,
        marginRight: 10,
    },

    fareItemTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1E293B',
    },

    fareItemDesc: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 1,
    },

    fareItemPrice: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },

    discountBadge: {
        backgroundColor: '#D1FAE5',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },

    discountBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#059669',
    },

    assistBadge: {
        backgroundColor: '#EDE9FE',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },

    assistBadgeText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#7C3AED',
    },

    guardianPill: {
        backgroundColor: '#E0F2FE',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },

    guardianPillText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#0284C7',
    },

    fareFooterBox: {
        backgroundColor: '#F0F7FF',
        borderTopWidth: 1,
        borderTopColor: '#E0F2FE',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },

    fareFooterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    fareFooterNote: {
        flex: 1,
        fontSize: 12,
        color: '#0284C7',
        fontWeight: '600',
        lineHeight: 16,
    },

    fareLoadingBox: {
        padding: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },

    fareLoadingText: {
        marginTop: 10,
        fontSize: 13,
        color: '#64748B',
        fontWeight: '600',
    },

    fareErrorBox: {
        padding: 20,
        alignItems: 'center',
        gap: 8,
    },

    fareErrorText: {
        fontSize: 13,
        color: '#EF4444',
        textAlign: 'center',
        fontWeight: '600',
    },

    // Note Banner
    noteBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        borderRadius: 12,
        padding: 12,
        marginTop: 16,
        borderWidth: 1,
        borderColor: '#BAE6FD',
    },

    noteText: {
        flex: 1,
        fontSize: 13,
        color: '#0066CC',
        marginLeft: 8,
        fontWeight: '600',
        lineHeight: 17,
    },

    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        paddingVertical: 4,
    },

    checkboxText: {
        flex: 1,
        fontSize: 14,
        color: '#1E293B',
        marginLeft: 10,
        fontWeight: '600',
        lineHeight: 18,
    },

    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        borderRadius: 12,
        padding: 12,
        marginTop: 16,
        borderWidth: 1,
        borderColor: '#FECACA',
    },

    errorText: {
        color: '#DC2626',
        marginLeft: 8,
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
    },

    confirmButton: {
        backgroundColor: '#0066CC',
        minHeight: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 20,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 4,
    },

    confirmButtonDisabled: {
        backgroundColor: '#94A3B8',
        shadowOpacity: 0,
        elevation: 0,
    },

    confirmButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    confirmButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 16,
        letterSpacing: 0.5,
    },

    editButton: {
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
    },

    editButtonText: {
        color: '#475569',
        fontWeight: '700',
        fontSize: 14,
    },
});