import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Seat, SeatLayout, SeatSlot } from '../../../entities/booking/model/types';

interface Props {
    layout: SeatLayout;
    selectedSeat: string | null;
    onSelectSeat: (seatNumber: string) => void;
}

const UNIT = 46;
const SEAT_GAP = 8;
const SIDE_WIDTH = UNIT * 2 + SEAT_GAP; // width of a 2-seat group — every row and the wheelchair box match this

function seatStyle(seat: Seat, isSelected: boolean) {
    if (isSelected) return [styles.slot, styles.seat, styles.seatSelected];
    if (seat.status !== 'AVAILABLE') return [styles.slot, styles.seat, styles.seatOccupied];
    if (seat.category === 'PRIORITY') return [styles.slot, styles.seat, styles.seatPriority];
    if (seat.category === 'GUARDIAN') return [styles.slot, styles.seat, styles.seatGuardian];
    return [styles.slot, styles.seat, styles.seatStandard];
}

function seatTextStyle(seat: Seat, isSelected: boolean) {
    return isSelected || seat.status !== 'AVAILABLE' ? styles.seatTextLight : styles.seatTextDark;
}

function SeatButton({
    slot,
    selectedSeat,
    onSelectSeat,
}: {
    slot: SeatSlot;
    selectedSeat: string | null;
    onSelectSeat: (n: string) => void;
}) {
    if (slot.kind === 'EMPTY') return <View style={styles.slot} />;

    if (slot.kind === 'WHEELCHAIR_SPACE') {
        return (
            <View style={styles.wheelchairBox} accessibilityLabel="Wheelchair space, open floor bay">
                <Ionicons name="accessibility" size={20} color="#0066CC" />
                <View style={styles.wheelchairTextGroup}>
                    <Text style={styles.wheelchairTitle}>Wheelchair Space</Text>
                    <Text style={styles.wheelchairSubtitle}>Open floor bay</Text>
                </View>
            </View>
        );
    }

    const seat = slot.seat!;
    const isSelected = seat.seatNumber === selectedSeat;
    const isDisabled = seat.status !== 'AVAILABLE';

    return (
        <TouchableOpacity
            style={seatStyle(seat, isSelected)}
            disabled={isDisabled}
            onPress={() => onSelectSeat(seat.seatNumber)}
            accessibilityRole="button"
            accessibilityLabel={`Seat ${seat.seatNumber}${
                seat.category === 'PRIORITY' ? ', priority seat' : seat.category === 'GUARDIAN' ? ', guardian seat' : ''
            }, ${seat.status.toLowerCase()}`}
            accessibilityState={{ disabled: isDisabled, selected: isSelected }}
        >
            <Text style={seatTextStyle(seat, isSelected)}>{seat.seatNumber}</Text>
        </TouchableOpacity>
    );
}

export function SeatMap({ layout, selectedSeat, onSelectSeat }: Props) {
    return (
        <View style={styles.wrapper}>
            {/* Legend */}
            <View style={styles.legendRow}>
                <LegendItem color="#FFFFFF" label="Available" border />
                <LegendItem color="#0066CC" label="Selected" />
                <LegendItem color="#CBD5E1" label="Occupied" />
                <LegendItem color="#FFF3CD" label="Priority" />
                <LegendItem color="#E0E7FF" label="Guardian" />
            </View>

            {/* Bus body */}
            <View style={styles.busBody}>
                {/* Front of bus */}
                <View style={styles.frontRow}>
                    <View style={styles.frontBadge}>
                        <Ionicons name="disc-outline" size={15} color="#64748B" />
                        <Text style={styles.frontBadgeText}>DRIVER</Text>
                    </View>
                    <View style={styles.frontDivider} />
                    <View style={styles.frontBadge}>
                        <Ionicons name="log-in-outline" size={15} color="#64748B" />
                        <Text style={styles.frontBadgeText}>ENTRANCE</Text>
                    </View>
                </View>

                {/* Rows */}
                {layout.rows.map((row) => (
                    <View key={row.rowNumber} style={styles.row}>
                        <View style={styles.sideGroup}>
                            {row.left.map((slot, i) => (
                                <SeatButton key={`L${i}`} slot={slot} selectedSeat={selectedSeat} onSelectSeat={onSelectSeat} />
                            ))}
                        </View>

                        <View style={styles.aisle}>
                            <View style={styles.aisleLine} />
                        </View>

                        <View style={styles.sideGroup}>
                            {row.right.map((slot, i) => (
                                <SeatButton key={`R${i}`} slot={slot} selectedSeat={selectedSeat} onSelectSeat={onSelectSeat} />
                            ))}
                        </View>
                    </View>
                ))}

                {/* Rear of bus */}
                <View style={styles.rearLabel}>
                    <Text style={styles.rearLabelText}>REAR OF BUS</Text>
                </View>
            </View>
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
    wrapper: { paddingVertical: 4 },

    legendRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center' },
    legendDot: { width: 14, height: 14, borderRadius: 4, marginRight: 6 },
    legendDotBorder: { borderWidth: 1, borderColor: '#CBD5E1' },
    legendText: { fontSize: 12, color: '#475569' },

    busBody: {
        alignSelf: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        borderWidth: 2,
        borderColor: '#E2E8F0',
        paddingVertical: 20,
        paddingHorizontal: 18,
        elevation: 2,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
    },

    frontRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 18,
    },
    frontBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F1F5F9',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    frontBadgeText: { fontSize: 10, fontWeight: '800', color: '#64748B', marginLeft: 5, letterSpacing: 0.4 },
    frontDivider: { width: 1, height: 18, backgroundColor: '#E2E8F0', marginHorizontal: 14 },

    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: SEAT_GAP },
    sideGroup: { flexDirection: 'row', gap: SEAT_GAP, width: SIDE_WIDTH },
    aisle: { width: 28, alignItems: 'center', justifyContent: 'center', height: UNIT },
    aisleLine: { width: 1, height: '70%', borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#E2E8F0' },

    slot: { width: UNIT, height: UNIT },

    seat: {
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    seatStandard: { backgroundColor: '#FFFFFF' },
    seatPriority: { backgroundColor: '#FFF3CD', borderColor: '#E6C200' },
    seatGuardian: { backgroundColor: '#E0E7FF', borderColor: '#818CF8' },
    seatOccupied: { backgroundColor: '#CBD5E1', borderColor: '#94A3B8' },
    seatSelected: { backgroundColor: '#0066CC', borderColor: '#0066CC' },

    seatTextDark: { color: '#1E293B', fontWeight: '700', fontSize: 12 },
    seatTextLight: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },

    wheelchairBox: {
        width: SIDE_WIDTH,
        height: UNIT,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#0066CC',
        backgroundColor: '#EBF3FA',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingHorizontal: 8,
        gap: 6,
        overflow: 'hidden',
    },
    wheelchairTextGroup: { flexShrink: 1 },
    wheelchairTitle: { fontSize: 10, fontWeight: '800', color: '#0066CC', lineHeight: 12 },
    wheelchairSubtitle: { fontSize: 8, fontWeight: '600', color: '#5B8FC9', lineHeight: 10, marginTop: 1 },

    rearLabel: { alignItems: 'center', marginTop: 10 },
    rearLabelText: { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1 },
});