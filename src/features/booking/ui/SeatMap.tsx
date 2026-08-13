import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Seat } from '../../../entities/booking/model/types';

interface Props {
    seats: Seat[];
    selectedSeat: string | null;
    onSelectSeat: (seatNumber: string) => void;
}

export function SeatMap({ seats, selectedSeat, onSelectSeat }: Props) {
    // Group seats by row letter (A, B, C...) for a bus-like grid layout
    const rows: Record<string, Seat[]> = {};
    seats.forEach((seat) => {
        const rowLetter = seat.seatNumber.charAt(0);
        if (!rows[rowLetter]) rows[rowLetter] = [];
        rows[rowLetter].push(seat);
    });

    function getSeatStyle(seat: Seat) {
        if (seat.seatNumber === selectedSeat) return [styles.seat, styles.seatSelected];
        if (seat.status !== 'AVAILABLE') return [styles.seat, styles.seatUnavailable];
        if (seat.isPrioritySeat) return [styles.seat, styles.seatPriority];
        return [styles.seat, styles.seatAvailable];
    }

    function getSeatTextStyle(seat: Seat) {
        if (seat.seatNumber === selectedSeat || seat.status !== 'AVAILABLE') {
            return styles.seatTextLight;
        }
        return styles.seatTextDark;
    }

    return (
        <View style={styles.container}>
            {/* Legend */}
            <View style={styles.legendRow}>
                <LegendItem color="#E0E0E0" label="Occupied" />
                <LegendItem color="#FFF3CD" label="Priority" />
                <LegendItem color="#FFFFFF" label="Available" border />
                <LegendItem color="#0066CC" label="Selected" />
            </View>

            {Object.keys(rows).sort().map((rowLetter) => (
                <View key={rowLetter} style={styles.row}>
                    {rows[rowLetter]
                        .sort((a, b) => a.seatNumber.localeCompare(b.seatNumber))
                        .map((seat) => (
                            <TouchableOpacity
                                key={seat.seatNumber}
                                style={getSeatStyle(seat)}
                                disabled={seat.status !== 'AVAILABLE'}
                                onPress={() => onSelectSeat(seat.seatNumber)}
                                accessibilityRole="button"
                                accessibilityLabel={`Seat ${seat.seatNumber}${seat.isPrioritySeat ? ', priority seat' : ''}, ${seat.status.toLowerCase()}`}
                            >
                                <Text style={getSeatTextStyle(seat)}>{seat.seatNumber}</Text>
                            </TouchableOpacity>
                        ))}
                </View>
            ))}
        </View>
    );
}

function LegendItem({ color, label, border }: { color: string; label: string; border?: boolean }) {
    return (
        <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }, border && styles.legendDotBorder]} />
            <Text style={styles.legendText}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { paddingVertical: 12 },
    legendRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center' },
    legendDot: { width: 14, height: 14, borderRadius: 4, marginRight: 6 },
    legendDotBorder: { borderWidth: 1, borderColor: '#ccc' },
    legendText: { fontSize: 12, color: '#555' },
    row: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10, gap: 10 },
    seat: {
        width: 48,
        height: 48,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ccc',
    },
    seatAvailable: { backgroundColor: '#FFFFFF' },
    seatPriority: { backgroundColor: '#FFF3CD', borderColor: '#E6C200' },
    seatUnavailable: { backgroundColor: '#E0E0E0', borderColor: '#bbb' },
    seatSelected: { backgroundColor: '#0066CC', borderColor: '#0066CC' },
    seatTextDark: { color: '#1E293B', fontWeight: '700', fontSize: 13 },
    seatTextLight: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});