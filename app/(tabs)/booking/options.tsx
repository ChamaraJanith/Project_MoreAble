import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TransportOption } from '../../../src/entities/booking/model/types';
import { fetchTransportOptions } from '../../../src/features/booking/api/bookingApi';
import { setSelectedVehicle } from '../../../src/features/booking/store/selectedVehicleStore';
import { TransportOptionCard } from '../../../src/features/booking/ui/TransportOptionCard';

export default function BookingOptionsScreen() {
    const router = useRouter();
    const { routeId, origin, destination } = useLocalSearchParams<{
        routeId: string; origin?: string; destination?: string;
    }>();
    const [options, setOptions] = useState<TransportOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!routeId) { setLoading(false); return; }
        loadOptions();
    }, [routeId]);

    async function loadOptions() {
        try {
            setLoading(true);
            setError('');
            setOptions(await fetchTransportOptions(routeId as string));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function handleSelect(option: TransportOption) {
        setSelectedVehicle({
            tripId: option.tripId,
            routeId: option.routeId,
            routeNumber: option.routeNumber,
            routeName: option.routeName,
            numberPlate: option.numberPlate,
            busModel: option.busModel,
            departureTime: option.departureTime,
            estimatedArrivalTime: option.estimatedArrivalTime,
            accessibilityScore: option.accessibilityScore,
            origin: (origin as string) || option.routeName.split('-')[0]?.trim() || '',
            destination: (destination as string) || '',
            selectedAt: Date.now(),
        });

        router.push({
            pathname: '/booking/seats/[tripId]',
            params: { tripId: option.tripId, origin: origin ?? '', destination: destination ?? '' },
        });
    }

    if (!routeId) {
        return (
            <View style={styles.center}>
                <Text style={styles.empty}>No route selected. Please search for a route first.</Text>
            </View>
        );
    }

    if (loading) return <ActivityIndicator style={styles.center} size="large" color="#0066CC" />;

    if (error) {
        return (
            <View style={styles.center}>
                <Text style={styles.error}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={loadOptions} accessibilityRole="button" accessibilityLabel="Retry">
                    <Text style={styles.retryText}>TRY AGAIN</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Available Transport Options</Text>
            {origin && destination ? (
                <Text style={styles.subtitle}>{origin} → {destination}</Text>
            ) : (
                <Text style={styles.subtitle}>Compare vehicles and pick the one that suits you.</Text>
            )}

            <FlatList
                data={options}
                keyExtractor={(item) => item.tripId}
                renderItem={({ item }) => <TransportOptionCard option={item} onSelect={handleSelect} />}
                contentContainerStyle={styles.list}
                ListEmptyComponent={<Text style={styles.empty}>No transport options found for this route right now.</Text>}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: '#F8FAFC' },
    list: { paddingBottom: 30 },
    title: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
    subtitle: { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16, fontWeight: '600' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
    error: { color: '#D32F2F', textAlign: 'center', marginBottom: 16 },
    retryButton: { backgroundColor: '#0066CC', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
    retryText: { color: '#fff', fontWeight: '700' },
    empty: { textAlign: 'center', color: '#888', marginTop: 30 },
});