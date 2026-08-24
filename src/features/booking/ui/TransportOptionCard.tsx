import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TransportOption } from '../../../entities/booking/model/types';
import { accessibilityScoreColor as scoreColor } from '../../../shared/utils/accessibility';

interface Props {
    option: TransportOption;
    onSelect: (option: TransportOption) => void;
}

export function TransportOptionCard({ option, onSelect }: Props) {
    const isFull = option.availableSeats <= 0;

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <View>
                    <Text style={styles.plateText}>{option.numberPlate}</Text>
                    <Text style={styles.modelText}>{option.busModel}</Text>
                </View>
                <View style={styles.scoreBadge}>
                    <Ionicons name="accessibility" size={13} color={scoreColor(option.accessibilityScore)} />
                    <Text style={[styles.scoreText, { color: scoreColor(option.accessibilityScore) }]}>
                        {option.accessibilityScore}%
                    </Text>
                </View>
            </View>

            <View style={styles.routeRow}>
                <Ionicons name="git-branch-outline" size={14} color="#64748B" />
                <Text style={styles.routeText}>Route {option.routeNumber} · {option.routeName}</Text>
            </View>

            <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                    <Text style={styles.timeValue}>{option.departureTime}</Text>
                    <Text style={styles.timeCaption}>Departs</Text>
                </View>
                <Ionicons name="arrow-forward" size={16} color="#94A3B8" />
                <View style={[styles.timeBlock, styles.timeBlockEnd]}>
                    <Text style={styles.timeValue}>{option.estimatedArrivalTime}</Text>
                    <Text style={styles.timeCaption}>Est. arrival</Text>
                </View>
            </View>

            <View style={styles.facilitiesRow}>
                {option.facilities.wheelchairRamp && <Text style={styles.badge}>Ramp</Text>}
                {option.facilities.lowFloorVehicle && <Text style={styles.badge}>Low Floor</Text>}
                {option.facilities.audioAnnouncement && <Text style={styles.badge}>Audio</Text>}
                {option.facilities.walkingAssistance && <Text style={styles.badge}>Assistance</Text>}
            </View>

            <Text style={styles.seatsText}>
                {option.availableSeats} of {option.totalSeats} seats available
                {option.availablePrioritySeats > 0 ? ` · ${option.availablePrioritySeats} priority` : ''}
            </Text>

            <TouchableOpacity
                style={[styles.selectButton, isFull && styles.selectButtonDisabled]}
                onPress={() => onSelect(option)}
                disabled={isFull}
                accessibilityRole="button"
                accessibilityLabel={isFull ? 'No seats available on this vehicle' : `Select vehicle ${option.numberPlate}`}
            >
                <Text style={styles.selectButtonText}>{isFull ? 'FULLY BOOKED' : 'SELECT THIS VEHICLE'}</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#EEF2F7', shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    plateText: { fontSize: 17, fontWeight: '800', color: '#0F172A', letterSpacing: 0.3 },
    modelText: { fontSize: 12, color: '#64748B', marginTop: 2 },
    scoreBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
    scoreText: { fontSize: 12, fontWeight: '800', marginLeft: 4 },
    routeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    routeText: { fontSize: 13, fontWeight: '600', color: '#475569', marginLeft: 6 },
    timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    timeBlock: { alignItems: 'flex-start', flex: 1 },
    timeBlockEnd: { alignItems: 'flex-end' },
    timeValue: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
    timeCaption: { fontSize: 11, color: '#64748B', marginTop: 2 },
    facilitiesRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 6 },
    badge: { backgroundColor: '#EBF3FA', color: '#0066CC', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 11, fontWeight: '600' },
    seatsText: { fontSize: 13, fontWeight: '600', color: '#334155', marginTop: 10 },
    selectButton: { backgroundColor: '#0066CC', minHeight: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 14 },
    selectButtonDisabled: { backgroundColor: '#94A3B8' },
    selectButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
});