import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { TransportOption } from '../../../src/entities/booking/model/types';
import { fetchTransportOptions } from '../../../src/features/booking/api/bookingApi';
import { TransportOptionCard } from '../../../src/features/booking/ui/TransportOptionCard';

export default function BookingOptionsScreen() {
    const router = useRouter();
    const { routeId } = useLocalSearchParams<{ routeId: string }>();
    const [options, setOptions] = useState<TransportOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!routeId) return;
        loadOptions();
    }, [routeId]);

    async function loadOptions() {
        try {
            setLoading(true);
            const data = await fetchTransportOptions(routeId as string);
            setOptions(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function handleSelect(option: TransportOption) {
        router.push({ pathname: '/booking/seats/[tripId]' as any, params: { tripId: option.tripId } });
    }

    if (loading) return <ActivityIndicator style={styles.center} size="large" color="#0a7ea4" />;
    if (error) return <Text style={styles.error}>{error}</Text>;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Available Transport Options</Text>
            <FlatList
                data={options}
                keyExtractor={(item) => item.tripId}
                renderItem={({ item }) => <TransportOptionCard option={item} onSelect={handleSelect} />}
                ListEmptyComponent={<Text style={styles.empty}>No transport options found.</Text>}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: '#f9f9f9' },
    title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
    center: { flex: 1, justifyContent: 'center' },
    error: { color: 'red', textAlign: 'center', marginTop: 20 },
    empty: { textAlign: 'center', color: '#888', marginTop: 30 },
});