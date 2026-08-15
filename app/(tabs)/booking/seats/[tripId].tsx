import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fetchSeats, SeatMapResponse } from '../../../../src/features/booking/api/bookingApi';
import { SeatMap } from '../../../../src/features/booking/ui/SeatMap';

export default function SeatSelectionScreen() {
    const router = useRouter();
    const { tripId } = useLocalSearchParams<{ tripId: string }>();

    const [data, setData] = useState<SeatMapResponse | null>(null);
    const [selectedSeatNumber, setSelectedSeatNumber] = useState<string | null>(null);
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
            setData(await fetchSeats(tripId as string));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    const selectedSeat = data?.seats.find((s) => s.seatNumber === selectedSeatNumber) ?? null;

    function handleContinue() {
        if (!selectedSeat || !data) return;

        router.push({
            pathname: '/booking/confirm',
            params: {
                tripId: data.tripId,
                seatNumber: selectedSeat.seatNumber,
                isPrioritySeat: selectedSeat.isPrioritySeat ? '1' : '0',
            },
        });
    }

    if (loading) return <ActivityIndicator style={styles.center} size="large" color="#0066CC" />;

    if (error) {
        return (
            <View style={styles.center}>
                <Ionicons name="alert-circle-outline" size={32} color="#D32F2F" style={{ marginBottom: 10 }} />
                <Text style={styles.error}>{error}</Text>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Choose another vehicle">
                    <Text style={styles.backButtonText}>CHOOSE ANOTHER VEHICLE</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (!data) return null;

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.title}>Select a Seat</Text>
            <Text style={styles.subtitle}>
                {data.numberPlate} · {data.routeNumber ? `Route ${data.routeNumber} · ` : ''}{data.totalSeats} seats
            </Text>
            <Text style={styles.timeText}>Departs {data.departureTime} · Est. arrival {data.estimatedArrivalTime}</Text>

            <SeatMap
                layout={data.layout}
                selectedSeat={selectedSeatNumber}
                onSelectSeat={setSelectedSeatNumber}
            />

            {selectedSeat && (
                <View style={styles.selectedBanner}>
                    <Text style={styles.selectedLabel}>Selected Seat: {selectedSeat.seatNumber}</Text>
                    {selectedSeat.category !== 'STANDARD' && (
                        <View style={styles.selectedChip}>
                            <Text style={styles.selectedChipText}>
                                {selectedSeat.category === 'PRIORITY' ? 'PRIORITY SEAT' : 'GUARDIAN SEAT'}
                            </Text>
                        </View>
                    )}
                </View>
            )}

            <TouchableOpacity
                style={[styles.continueButton, !selectedSeat && styles.continueButtonDisabled]}
                onPress={handleContinue}
                disabled={!selectedSeat}
                accessibilityRole="button"
                accessibilityLabel="Continue to booking"
            >
                <Text style={styles.continueText}>
                    {selectedSeat ? `Continue with Seat ${selectedSeat.seatNumber}` : 'Select a seat to continue'}
                </Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flexGrow: 1, padding: 16, backgroundColor: '#F8FAFC' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    title: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
    subtitle: { fontSize: 13, color: '#666', marginTop: 4 },
    timeText: { fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 12 },
    error: { color: '#D32F2F', textAlign: 'center', marginBottom: 16 },
    backButton: { backgroundColor: '#0066CC', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
    backButtonText: { color: '#fff', fontWeight: '700' },
    selectedBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: '#E2E8F0' },
    selectedLabel: { fontSize: 14, fontWeight: '700', color: '#0F172A', flex: 1 },
    selectedChip: { backgroundColor: '#FFF3CD', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    selectedChipText: { fontSize: 11, fontWeight: '800', color: '#92722A' },
    continueButton: { marginTop: 20, backgroundColor: '#0066CC', paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
    continueButtonDisabled: { backgroundColor: '#94A3B8' },
    continueText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});