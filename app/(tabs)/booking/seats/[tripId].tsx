import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fetchSeats, SeatMapResponse } from '../../../../src/features/booking/api/bookingApi';
import { SeatMap } from '../../../../src/features/booking/ui/SeatMap';

export default function SeatSelectionScreen() {
    const router = useRouter();
    const { tripId } = useLocalSearchParams<{ tripId: string }>();

    const [data, setData] = useState<SeatMapResponse | null>(null);
    const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!tripId) return;
        loadSeats();
    }, [tripId]);

    async function loadSeats() {
        try {
            setLoading(true);
            const result = await fetchSeats(tripId as string);
            setData(result);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function handleContinue() {
        if (!selectedSeat || !data) return;
        // US06 will pick this up on the confirm screen
        router.push({
            pathname: '/booking/confirm' as any,
            params: { tripId: data.tripId, seatNumber: selectedSeat },
        });
    }

    if (loading) {
        return <ActivityIndicator style={styles.center} size="large" color="#0a7ea4" />;
    }

    if (error) {
        return (
            <View style={styles.center}>
                <Text style={styles.error}>{error}</Text>
            </View>
        );
    }

    if (!data) return null;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Select a Seat</Text>
            <Text style={styles.subtitle}>{data.vehicleNumber} · {data.totalSeats} seats</Text>

            <SeatMap
                seats={data.seats}
                selectedSeat={selectedSeat}
                onSelectSeat={setSelectedSeat}
            />

            <TouchableOpacity
                style={[styles.continueButton, !selectedSeat && styles.continueButtonDisabled]}
                onPress={handleContinue}
                disabled={!selectedSeat}
                accessibilityRole="button"
                accessibilityLabel="Continue to booking"
            >
                <Text style={styles.continueText}>
                    {selectedSeat ? `Continue with Seat ${selectedSeat}` : 'Select a seat to continue'}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: '#f9f9f9' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    title: { fontSize: 18, fontWeight: '700' },
    subtitle: { fontSize: 13, color: '#666', marginBottom: 12 },
    error: { color: 'red', textAlign: 'center' },
    continueButton: {
        marginTop: 20,
        backgroundColor: '#0066CC',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
    },
    continueButtonDisabled: { backgroundColor: '#94A3B8' },
    continueText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});