import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { Seat } from '../../../../src/entities/booking/model/types';
import {
    fetchSeats,
    SeatMapResponse,
} from '../../../../src/features/booking/api/bookingApi';
import { PriorityAccessModal } from '../../../../src/features/booking/ui/PriorityAccessModal';
import { SeatMap } from '../../../../src/features/booking/ui/SeatMap';
import { useAuthStore } from '../../../../src/shared/store/authStore';
import { isAutoEligibleForPriority } from '../../../../src/shared/utils/priorityEligibility';


const ELDERLY_MIN_AGE = 60;

export default function SeatSelectionScreen() {
    const router = useRouter();

    const { tripId, origin, destination } = useLocalSearchParams<{
        tripId: string; origin?: string; destination?: string;
    }>();

    const { user } = useAuthStore();

    const [pendingPrioritySeat, setPendingPrioritySeat] = useState<Seat | null>(null);
    const [priorityReasonBySeat, setPriorityReasonBySeat] = useState<Record<string, string>>({});

    const passengerAge =
        typeof user?.calculatedAge === 'number'
            ? user.calculatedAge
            : null;

    const [data, setData] =
        useState<SeatMapResponse | null>(null);

    const [selectedSeatNumber, setSelectedSeatNumber] =
        useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!tripId) return;

        loadSeats();
    }, [tripId]);

    async function loadSeats() {
        try {
            setLoading(true);
            setError('');
            setSelectedSeatNumber(null);

            setData(
                await fetchSeats(tripId as string)
            );
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function showLockedMessage(message: string) {
        if (Platform.OS === 'web') {
            window.alert(message);
        } else {
            Alert.alert(
                'Seat Restricted',
                message
            );
        }
    }

    function handleSelectSeat(seat: Seat) {
        if (seat.category === 'ELDERLY') {
            if (passengerAge == null) {
                showLockedMessage(
                    'This seat is reserved for passengers aged 60 and above. Please log in with your registered account to book it.'
                );

                return;
            }

            if (
                passengerAge <
                (seat.minAge ?? ELDERLY_MIN_AGE)
            ) {
                showLockedMessage(
                    `This seat is reserved for passengers aged ${
                        seat.minAge ?? ELDERLY_MIN_AGE
                    } and above.`
                );

                return;
            }
        }

        // Priority seats: auto-eligible passengers (elderly / have an
        // accessibility profile) proceed straight through — the system has
        // already "identified" their accessibility requirement. Everyone else
        // is asked to briefly declare why they need it before it's held for them.
        if (seat.category === 'PRIORITY' && !isAutoEligibleForPriority(user)) {
            setPendingPrioritySeat(seat);
            return;
        }

        setSelectedSeatNumber(
            seat.seatNumber
        );
    }

    function handlePriorityReasonConfirm(reason: string) {
        if (!pendingPrioritySeat) return;
        setPriorityReasonBySeat((prev) => ({ ...prev, [pendingPrioritySeat.seatNumber]: reason }));
        setSelectedSeatNumber(pendingPrioritySeat.seatNumber);
        setPendingPrioritySeat(null);
    }

    const selectedSeat =
        data?.seats.find(
            (s) =>
                s.seatNumber ===
                selectedSeatNumber
        ) ?? null;

    function handleContinue() {
        if (!selectedSeat || !data) return;

        router.push({
            pathname: '/booking/confirm',
            params: {
                tripId: data.tripId,
                seatNumber: selectedSeat.seatNumber,
                isPrioritySeat: selectedSeat.isPrioritySeat ? '1' : '0',
                priorityReason: selectedSeat.seatNumber ? (priorityReasonBySeat[selectedSeat.seatNumber] ?? '') : '',
                origin: origin ?? '',
                destination: destination ?? '',
            },
        });
    }

    if (loading) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <ActivityIndicator
                    style={styles.center}
                    size="large"
                    color="#0066CC"
                />
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.center}>
                    <Ionicons
                        name="alert-circle-outline"
                        size={32}
                        color="#D32F2F"
                        style={{ marginBottom: 10 }}
                    />

                    <Text style={styles.error}>
                        {error}
                    </Text>

                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                        accessibilityRole="button"
                        accessibilityLabel="Choose another vehicle"
                    >
                        <Text style={styles.backButtonText}>
                            CHOOSE ANOTHER VEHICLE
                        </Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (!data) return null;

    const isElderlySelected =
        selectedSeat?.category === 'ELDERLY';

    const isWheelchairSelected =
        selectedSeat?.category === 'WHEELCHAIR';

    return (
        <SafeAreaView style={styles.safeArea}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.headerBackButton}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons
                        name="arrow-back"
                        size={22}
                        color="#0F172A"
                    />
                </TouchableOpacity>

                <View style={styles.headerTextGroup}>
                    <Text
                        style={styles.title}
                        numberOfLines={1}
                    >
                        Select Your Seat
                    </Text>

                    <Text
                        style={styles.subtitle}
                        numberOfLines={1}
                    >
                        {data.numberPlate} ·{' '}
                        {data.routeNumber
                            ? `Route ${data.routeNumber} · `
                            : ''}
                        {data.totalSeats} seats
                    </Text>

                    <Text
                        style={styles.timeText}
                        numberOfLines={1}
                    >
                        Departs {data.departureTime} · Est. arrival{' '}
                        {data.estimatedArrivalTime}
                    </Text>
                </View>
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* Login Information */}
                {passengerAge == null && (
                    <View style={styles.infoBanner}>
                        <Ionicons
                            name="information-circle-outline"
                            size={16}
                            color="#0066CC"
                        />

                        <Text style={styles.infoBannerText}>
                            Log in to unlock seats reserved for passengers aged 60 and above.
                        </Text>
                    </View>
                )}

                {/* Seat Map */}
                <SeatMap
                    layout={data.layout}
                    selectedSeatNumber={
                        selectedSeatNumber
                    }
                    passengerAge={passengerAge}
                    onSelectSeat={handleSelectSeat}
                />

                {/* Selected Seat */}
                {selectedSeat && (
                    <View style={styles.selectedBanner}>
                        <View style={styles.selectedTextGroup}>
                            <Text
                                style={styles.selectedLabel}
                            >
                                Selected Seat:{' '}
                                {isWheelchairSelected
                                    ? `Wheelchair Space (${selectedSeat.seatNumber})`
                                    : selectedSeat.seatNumber}
                            </Text>

                            {isWheelchairSelected &&
                                selectedSeat.pairedSeatNumber && (
                                    <Text
                                        style={
                                            styles.selectedSubtext
                                        }
                                    >
                                        Guardian seat{' '}
                                        {
                                            selectedSeat.pairedSeatNumber
                                        }{' '}
                                        will be reserved automatically.
                                    </Text>
                                )}
                        </View>

                        {selectedSeat.category !==
                            'STANDARD' &&
                            !isWheelchairSelected && (
                                <View
                                    style={
                                        styles.selectedChip
                                    }
                                >
                                    <Text
                                        style={
                                            styles.selectedChipText
                                        }
                                    >
                                        {selectedSeat.category ===
                                        'PRIORITY'
                                            ? 'PRIORITY SEAT'
                                            : selectedSeat.category ===
                                              'ELDERLY'
                                                ? '60+ SEAT'
                                                : 'GUARDIAN SEAT'}
                                    </Text>
                                </View>
                            )}
                    </View>
                )}

                {/* Elderly Seat Notice */}
                {isElderlySelected && (
                    <View style={styles.noticeBanner}>
                        <Ionicons
                            name="alert-circle-outline"
                            size={16}
                            color="#B45309"
                        />

                        <Text
                            style={
                                styles.noticeBannerText
                            }
                        >
                            This seat is reserved for passengers aged 60 and above.
                        </Text>
                    </View>
                )}

                {/* Continue Button */}
                <TouchableOpacity
                    style={[
                        styles.continueButton,
                        !selectedSeat &&
                            styles.continueButtonDisabled,
                    ]}
                    onPress={handleContinue}
                    disabled={!selectedSeat}
                    accessibilityRole="button"
                    accessibilityLabel="Continue to booking"
                >
                    <Text style={styles.continueText}>
                        {selectedSeat
                            ? `Continue with Seat ${selectedSeat.seatNumber}`
                            : 'Select a seat to continue'}
                    </Text>
                </TouchableOpacity>
            </ScrollView>

            <PriorityAccessModal
                visible={!!pendingPrioritySeat}
                onCancel={() => setPendingPrioritySeat(null)}
                onConfirm={handlePriorityReasonConfirm}
            />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },

    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },

    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 14,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },

    headerBackButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 4,
    },

    headerTextGroup: {
        flex: 1,
        paddingTop: 6,
    },

    title: {
        fontSize: 19,
        fontWeight: '800',
        color: '#0F172A',
    },

    subtitle: {
        fontSize: 13,
        color: '#475569',
        marginTop: 3,
        fontWeight: '600',
    },

    timeText: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },

    content: {
        padding: 16,
        paddingBottom: 32,
    },

    infoBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        borderRadius: 10,
        padding: 10,
        marginBottom: 14,
    },

    infoBannerText: {
        flex: 1,
        fontSize: 12,
        color: '#0066CC',
        marginLeft: 8,
        fontWeight: '600',
        lineHeight: 16,
    },

    error: {
        color: '#D32F2F',
        textAlign: 'center',
        marginBottom: 16,
    },

    backButton: {
        backgroundColor: '#0066CC',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 10,
    },

    backButtonText: {
        color: '#fff',
        fontWeight: '700',
    },

    selectedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 14,
        marginTop: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },

    selectedTextGroup: {
        flex: 1,
    },

    selectedLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },

    selectedSubtext: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 3,
    },

    selectedChip: {
        backgroundColor: '#FFF3CD',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },

    selectedChipText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#92722A',
    },

    noticeBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFBEB',
        borderRadius: 10,
        padding: 10,
        marginTop: 10,
    },

    noticeBannerText: {
        flex: 1,
        fontSize: 12,
        color: '#B45309',
        marginLeft: 8,
        fontWeight: '600',
    },

    continueButton: {
        marginTop: 20,
        backgroundColor: '#0066CC',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
    },

    continueButtonDisabled: {
        backgroundColor: '#94A3B8',
    },

    continueText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 15,
    },
});