import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

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

    const [hasConfirmedDetails, setHasConfirmedDetails] =
        useState(false);

    const [isSubmitting, setIsSubmitting] =
        useState(false);

    const [submitError, setSubmitError] =
        useState('');

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
            journeyDestination
        )
            .then(setFare)
            .catch((err) => setFareError(err.message))
            .finally(() => setFareLoading(false));
    }, [
        selectedVehicle?.routeId,
        journeyOrigin,
        journeyDestination,
    ]);

    async function handleConfirm() {
        if (
            !tripId ||
            !seatNumber ||
            !hasConfirmedDetails
        ) {
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
        <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons
                        name="arrow-back"
                        size={22}
                        color="#0F172A"
                    />
                </TouchableOpacity>

                <Text style={styles.title}>
                    Review Booking
                </Text>
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
                    <Ionicons name="people" size={20} color="#7C3AED" />
                    <View style={{ marginLeft: 10, flex: 1 }}>
                        <Text style={styles.guardianNoticeTitle}>
                            Wheelchair & Guardian Companion Seat Paired ♿
                        </Text>
                        <Text style={styles.guardianNoticeText}>
                            As per safety policy, a paired Guardian seat (G1) has been automatically reserved beside your wheelchair position for your accompanying helper.
                        </Text>
                    </View>
                </View>
            )}

            <View style={styles.card}>
                <AssistanceToggle
                    label="Wheelchair Assistance & Ramp Access"
                    value={wheelchairAssistance}
                    onChange={setWheelchairAssistance}
                />

                <AssistanceToggle
                    label="Boarding Support & Assistance"
                    value={boardingAssistance}
                    onChange={setBoardingAssistance}
                />

                <AssistanceToggle
                    label="Walking Assistance"
                    value={walkingAssistance}
                    onChange={setWalkingAssistance}
                />

                <AssistanceToggle
                    label="Priority Seat Assistance"
                    value={prioritySeatAssistance}
                    onChange={setPrioritySeatAssistance}
                    isLast
                />
            </View>

            {/* Estimated Fare */}
            <Text style={styles.sectionLabel}>
                Estimated Fare
            </Text>

            <View style={styles.fareCard}>
                {fareLoading ? (
                    <ActivityIndicator color="#0066CC" />
                ) : fareError ? (
                    <Text style={styles.fareErrorText}>
                        {fareError}
                    </Text>
                ) : fare ? (
                    <>
                        <View style={styles.fareTopRow}>
                            <View>
                                <Text
                                    style={styles.fareLabel}
                                >
                                    Estimated Fare
                                </Text>

                                <Text
                                    style={styles.fareSub}
                                >
                                    Payment: Pay on boarding
                                </Text>
                            </View>

                            <Text
                                style={styles.fareAmount}
                            >
                                LKR {fare.totalFare}
                            </Text>
                        </View>

                        <Text
                            style={styles.fareDetail}
                        >
                            {fare.distanceKm} km · Base LKR{' '}
                            {fare.baseFare} + LKR{' '}
                            {fare.distanceFare} distance fare
                            {fare.isEstimate
                                ? ' · approximate'
                                : ''}
                        </Text>
                    </>
                ) : (
                    <Text style={styles.fareErrorText}>
                        Fare unavailable for this journey.
                    </Text>
                )}
            </View>

            <View style={styles.noteBanner}>
                <Ionicons
                    name="information-circle-outline"
                    size={16}
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
                    size={22}
                    color={
                        hasConfirmedDetails
                            ? '#0066CC'
                            : '#94A3B8'
                    }
                />

                <Text style={styles.checkboxText}>
                    I confirm that the booking details are correct.
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
                        isSubmitting) &&
                        styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirm}
                disabled={
                    !hasConfirmedDetails ||
                    isSubmitting
                }
                accessibilityRole="button"
                accessibilityLabel="Confirm booking"
                accessibilityState={{
                    disabled:
                        !hasConfirmedDetails ||
                        isSubmitting,
                }}
            >
                {isSubmitting ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text
                        style={
                            styles.confirmButtonText
                        }
                    >
                        CONFIRM BOOKING
                    </Text>
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
                    Edit Booking
                </Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

function AssistanceToggle({
    label,
    value,
    onChange,
    isLast,
}: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
    isLast?: boolean;
}) {
    return (
        <TouchableOpacity
            style={[
                styles.assistanceRow,
                isLast &&
                    styles.assistanceRowLast,
            ]}
            onPress={() => onChange(!value)}
            accessibilityRole="checkbox"
            accessibilityState={{
                checked: value,
            }}
            accessibilityLabel={label}
        >
            <Text style={styles.assistanceLabel}>
                {label}
            </Text>

            <Ionicons
                name={
                    value
                        ? 'checkmark-circle'
                        : 'ellipse-outline'
                }
                size={20}
                color={
                    value
                        ? '#10B981'
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
        marginBottom: 12,
    },

    backButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
    },

    title: {
        fontSize: 19,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 6,
    },

    sectionLabel: {
        fontSize: 13,
        fontWeight: '800',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginTop: 16,
        marginBottom: 8,
    },

    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },

    passengerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    passengerAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },

    passengerName: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
    },

    passengerType: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },

    assistanceInput: {
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 10,
        padding: 10,
        minHeight: 44,
        fontSize: 13,
        color: '#0F172A',
        textAlignVertical: 'top',
    },

    busRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },

    busPlate: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },

    busModel: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },

    busBadge: {
        backgroundColor: '#EBF3FA',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },

    busBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#0066CC',
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
    },

    stopValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
        marginTop: 1,
    },

    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },

    timeText: {
        fontSize: 12,
        color: '#475569',
        fontWeight: '600',
    },

    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },

    rowLabel: {
        fontSize: 13,
        color: '#64748B',
    },

    rowValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },

    assistanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },

    assistanceRowLast: {
        borderBottomWidth: 0,
    },

    assistanceLabel: {
        fontSize: 14,
        color: '#0F172A',
        fontWeight: '600',
    },

    fareCard: {
        backgroundColor: '#0F172A',
        borderRadius: 16,
        padding: 16,
    },

    fareTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },

    fareLabel: {
        fontSize: 13,
        color: '#CBD5E1',
        fontWeight: '700',
    },

    fareSub: {
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 2,
    },

    fareAmount: {
        fontSize: 22,
        fontWeight: '800',
        color: '#fff',
    },

    fareDetail: {
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 10,
    },

    fareErrorText: {
        fontSize: 13,
        color: '#FCA5A5',
        textAlign: 'center',
    },

    noteBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        borderRadius: 10,
        padding: 12,
        marginTop: 16,
    },

    noteText: {
        flex: 1,
        fontSize: 12,
        color: '#0066CC',
        marginLeft: 8,
        fontWeight: '600',
        lineHeight: 16,
    },

    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
    },

    checkboxText: {
        flex: 1,
        fontSize: 13,
        color: '#334155',
        marginLeft: 10,
        fontWeight: '600',
    },

    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF4F4',
        borderRadius: 10,
        padding: 12,
        marginTop: 16,
    },

    errorText: {
        color: '#D32F2F',
        marginLeft: 8,
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
    },

    confirmButton: {
        backgroundColor: '#0F172A',
        minHeight: 54,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 20,
    },

    confirmButtonDisabled: {
        backgroundColor: '#94A3B8',
    },

    confirmButtonText: {
        color: '#fff',
        fontWeight: '800',
        fontSize: 16,
        letterSpacing: 0.5,
    },

    guardianNoticeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3E8FF',
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#DDD6FE',
    },

    guardianNoticeTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#6B21A8',
        marginBottom: 2,
    },

    guardianNoticeText: {
        fontSize: 12,
        color: '#581C87',
        lineHeight: 16,
    },

    editButton: {
        minHeight: 50,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 10,
    },

    editButtonText: {
        color: '#334155',
        fontWeight: '700',
        fontSize: 14,
    },
});