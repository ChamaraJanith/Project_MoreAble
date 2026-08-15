import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { confirmBooking } from '../../../src/features/booking/api/bookingApi';
import { setSelectedVehicle, useSelectedVehicle } from '../../../src/features/booking/store/selectedVehicleStore';
import { useAuthStore } from '../../../src/shared/store/authStore';

export default function BookingConfirmScreen() {
    const router = useRouter();
    const { tripId, seatNumber, isPrioritySeat, origin, destination } = useLocalSearchParams<{
        tripId: string; seatNumber: string; isPrioritySeat: string; origin?: string; destination?: string;
    }>();

    const selectedVehicle = useSelectedVehicle();
    const { user } = useAuthStore();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    // Real trip origin/destination the passenger actually searched for —
    // falls back to the vehicle's route name if opened without a journey search.
    const journeyOrigin = (origin as string) || selectedVehicle?.origin || '—';
    const journeyDestination = (destination as string) || selectedVehicle?.destination || '—';

    async function handleConfirm() {
        if (!tripId || !seatNumber) return;

        setIsSubmitting(true);
        setSubmitError('');

        try {
            const booking = await confirmBooking({
                tripId: tripId as string,
                seatNumber: seatNumber as string,
                //isPrioritySeat: isPrioritySeat === '1',
                passengerId: user?.passengerId,
                origin: journeyOrigin !== '—' ? journeyOrigin : undefined,
                destination: journeyDestination !== '—' ? journeyDestination : undefined,
            });

            setSelectedVehicle(null);
            router.replace({ pathname: '/booking/ticket/[bookingId]', params: { bookingId: booking.bookingId } });
        } catch (err: any) {
            setSubmitError(err.message || 'Unable to confirm this booking. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
                    <Ionicons name="arrow-back" size={22} color="#0F172A" />
                </TouchableOpacity>
                <Text style={styles.title}>Booking Summary</Text>
            </View>

            <View style={styles.journeyBanner}>
                <View style={styles.journeyStop}>
                    <Ionicons name="ellipse" size={9} color="#0066CC" />
                    <Text style={styles.journeyText} numberOfLines={1}>{journeyOrigin}</Text>
                </View>
                <Ionicons name="arrow-forward" size={14} color="#94A3B8" style={{ marginHorizontal: 8 }} />
                <View style={styles.journeyStop}>
                    <Ionicons name="location" size={12} color="#0F172A" />
                    <Text style={styles.journeyText} numberOfLines={1}>{journeyDestination}</Text>
                </View>
            </View>

            <View style={styles.card}>
                <SummaryRow label="Route" value={selectedVehicle ? `${selectedVehicle.routeNumber} · ${selectedVehicle.routeName}` : '—'} />
                <SummaryRow label="Vehicle" value={selectedVehicle?.numberPlate ?? '—'} />
                <SummaryRow label="Departure" value={selectedVehicle?.departureTime ?? '—'} />
                <SummaryRow label="Est. Arrival" value={selectedVehicle?.estimatedArrivalTime ?? '—'} />
                <SummaryRow label="Seat" value={(seatNumber as string) ?? '—'} />
                <SummaryRow label="Priority Seat" value={isPrioritySeat === '1' ? 'Yes' : 'No'} isLast />
            </View>

            {!!submitError && (
                <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                    <Text style={styles.errorText}>{submitError}</Text>
                </View>
            )}

            <TouchableOpacity
                style={[styles.confirmButton, isSubmitting && styles.confirmButtonDisabled]}
                onPress={handleConfirm}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Confirm booking"
            >
                {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>CONFIRM BOOKING</Text>}
            </TouchableOpacity>
        </ScrollView>
    );
}

function SummaryRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
    return (
        <View style={[styles.row, isLast && styles.rowLast]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    content: { padding: 16, backgroundColor: '#F8FAFC', flexGrow: 1 },
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    backButton: { width: 40, height: 40, justifyContent: 'center' },
    title: { fontSize: 19, fontWeight: '800', color: '#0F172A', marginLeft: 6 },
    journeyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
    journeyStop: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    journeyText: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginLeft: 6, flexShrink: 1 },
    card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { fontSize: 13, color: '#64748B' },
    rowValue: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
    errorBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF4F4', borderRadius: 10, padding: 12, marginTop: 16 },
    errorText: { color: '#D32F2F', marginLeft: 8, flex: 1, fontSize: 13, fontWeight: '600' },
    confirmButton: { backgroundColor: '#0066CC', minHeight: 54, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
    confirmButtonDisabled: { backgroundColor: '#94A3B8' },
    confirmButtonText: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.5 },
});