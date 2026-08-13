import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TransportOption } from '../../../entities/booking/model/types';

interface Props {
    option: TransportOption;
    onSelect: (option: TransportOption) => void;
}

export function TransportOptionCard({ option, onSelect }: Props) {
    return (
        <TouchableOpacity style={styles.card} onPress={() => onSelect(option)}>
            <View style={styles.headerRow}>
                <Text style={styles.vehicleNumber}>{option.vehicleNumber}</Text>
                <Text style={styles.score}>Score: {option.accessibilityScore}%</Text>
            </View>
            <Text style={styles.routeText}>Route {option.routeNumber}</Text>
            <Text style={styles.timeText}>
                Departs: {option.departureTime} → Arrives: {option.estimatedArrivalTime}
            </Text>
            <View style={styles.facilitiesRow}>
                {option.facilities.ramp && <Text style={styles.badge}>Ramp</Text>}
                {option.facilities.wheelchairSpace && <Text style={styles.badge}>Wheelchair</Text>}
                {option.facilities.audioAnnouncement && <Text style={styles.badge}>Audio</Text>}
                {option.facilities.lowFloor && <Text style={styles.badge}>Low Floor</Text>}
            </View>
            <Text style={styles.seatsText}>
                Available: {option.availableSeats} seats ({option.availablePrioritySeats} priority)
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', marginBottom: 12, backgroundColor: '#fff' },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    vehicleNumber: { fontSize: 16, fontWeight: '700' },
    score: { color: '#0a7ea4', fontWeight: '600' },
    routeText: { marginTop: 4, color: '#444' },
    timeText: { marginTop: 4, color: '#666', fontSize: 13 },
    facilitiesRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
    badge: { backgroundColor: '#e6f4f8', color: '#0a7ea4', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 11, marginRight: 6 },
    seatsText: { marginTop: 8, fontSize: 13, fontWeight: '500' },
});