import { Ionicons } from '@expo/vector-icons';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import {
    Seat,
    SeatLayout,
    SeatMapRow,
    SeatSlot,
} from '../../../entities/booking/model/types';

interface Props {
    layout: SeatLayout;
    selectedSeatNumber: string | null;

    /** Passenger's age if known — used to visually flag elderly-reserved seats. Pass null for guests / unknown age. */
    passengerAge: number | null;

    onSelectSeat: (seat: Seat) => void;
}

const UNIT = 46;
const SEAT_GAP = 8;
const AISLE_WIDTH = 28;
const SIDE_WIDTH = UNIT * 2 + SEAT_GAP;

function isSeatLocked(
    seat: Seat,
    passengerAge: number | null,
): boolean {
    if (seat.category !== 'ELDERLY' || seat.minAge == null) {
        return false;
    }

    return passengerAge == null || passengerAge < seat.minAge;
}

function seatVisualStyle(
    seat: Seat,
    isSelected: boolean,
    isLocked: boolean,
) {
    if (isSelected) {
        return [
            styles.slot,
            styles.seat,
            styles.seatSelected,
        ];
    }

    if (seat.status !== 'AVAILABLE') {
        return [
            styles.slot,
            styles.seat,
            styles.seatOccupied,
        ];
    }

    if (isLocked) {
        return [
            styles.slot,
            styles.seat,
            styles.seatLocked,
        ];
    }

    if (seat.category === 'PRIORITY') {
        return [
            styles.slot,
            styles.seat,
            styles.seatPriority,
        ];
    }

    if (seat.category === 'ELDERLY') {
        return [
            styles.slot,
            styles.seat,
            styles.seatElderly,
        ];
    }

    if (seat.category === 'GUARDIAN') {
        return [
            styles.slot,
            styles.seat,
            styles.seatGuardian,
        ];
    }

    return [
        styles.slot,
        styles.seat,
        styles.seatStandard,
    ];
}

function seatTextStyle(
    seat: Seat,
    isSelected: boolean,
) {
    return isSelected || seat.status !== 'AVAILABLE'
        ? styles.seatTextLight
        : styles.seatTextDark;
}

function StandardSeatButton({
    seat,
    isSelected,
    passengerAge,
    onPress,
}: {
    seat: Seat;
    isSelected: boolean;
    passengerAge: number | null;
    onPress: () => void;
}) {
    const isLocked = isSeatLocked(
        seat,
        passengerAge,
    );

    const isDisabled = seat.status !== 'AVAILABLE';
    // locked seats stay tappable so the screen can show *why*

    const categoryLabel =
        seat.category === 'PRIORITY'
            ? ', priority seat'
            : seat.category === 'ELDERLY'
                ? ', seat reserved for passengers 60 and above'
                : seat.category === 'GUARDIAN'
                    ? ', guardian seat'
                    : '';

    return (
        <TouchableOpacity
            style={seatVisualStyle(
                seat,
                isSelected,
                isLocked,
            )}
            disabled={isDisabled}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Seat ${seat.seatNumber}${categoryLabel}, ${
                isLocked
                    ? 'restricted to 60 and above'
                    : seat.status.toLowerCase()
            }`}
            accessibilityState={{
                disabled: isDisabled,
                selected: isSelected,
            }}
        >
            {isLocked ? (
                <Ionicons
                    name="lock-closed"
                    size={13}
                    color="#94A3B8"
                />
            ) : (
                <Text
                    style={seatTextStyle(
                        seat,
                        isSelected,
                    )}
                >
                    {seat.seatNumber}
                </Text>
            )}
        </TouchableOpacity>
    );
}

function WheelchairPairRow({
    wheelchairSeat,
    guardianSeat,
    selectedSeatNumber,
    onSelectSeat,
}: {
    wheelchairSeat: Seat;
    guardianSeat: Seat | null;
    selectedSeatNumber: string | null;
    onSelectSeat: (seat: Seat) => void;
}) {
    const isSelected =
        wheelchairSeat.seatNumber === selectedSeatNumber;

    const isOccupied =
        wheelchairSeat.status !== 'AVAILABLE';

    // Tapping either the wheelchair bay or its paired guardian seat selects
    // the same wheelchair unit — booking one always reserves the other.
    const handlePress = () =>
        onSelectSeat(wheelchairSeat);

    return (
        <View style={styles.row}>
            <TouchableOpacity
                style={[
                    styles.wheelchairBox,
                    isSelected &&
                        styles.wheelchairBoxSelected,
                    isOccupied &&
                        styles.wheelchairBoxOccupied,
                ]}
                disabled={isOccupied}
                onPress={handlePress}
                accessibilityRole="button"
                accessibilityLabel={`Wheelchair space ${
                    wheelchairSeat.seatNumber
                }${
                    guardianSeat
                        ? `, reserves guardian seat ${guardianSeat.seatNumber} automatically`
                        : ''
                }, ${wheelchairSeat.status.toLowerCase()}`}
                accessibilityState={{
                    disabled: isOccupied,
                    selected: isSelected,
                }}
            >
                <Ionicons
                    name="accessibility"
                    size={20}
                    color={
                        isSelected || isOccupied
                            ? '#FFFFFF'
                            : '#0066CC'
                    }
                />

                <View style={styles.wheelchairTextGroup}>
                    <Text
                        style={[
                            styles.wheelchairTitle,
                            (isSelected || isOccupied) &&
                                styles.wheelchairTitleLight,
                        ]}
                    >
                        Wheelchair Space
                    </Text>

                    <Text
                        style={[
                            styles.wheelchairSubtitle,
                            (isSelected || isOccupied) &&
                                styles.wheelchairSubtitleLight,
                        ]}
                    >
                        {isOccupied
                            ? 'Reserved'
                            : isSelected
                                ? 'Selected · guardian seat auto-reserved'
                                : 'Open floor bay'}
                    </Text>
                </View>
            </TouchableOpacity>

            <View style={styles.aisle}>
                <View style={styles.aisleLine} />
            </View>

            <View style={styles.sideGroup}>
                {guardianSeat ? (
                    <TouchableOpacity
                        style={[
                            styles.slot,
                            styles.seat,
                            styles.seatGuardian,
                            isSelected &&
                                styles.seatSelected,
                            isOccupied &&
                                styles.seatOccupied,
                        ]}
                        disabled={isOccupied}
                        onPress={handlePress}
                        accessibilityRole="button"
                        accessibilityLabel={`Guardian seat ${
                            guardianSeat.seatNumber
                        }, linked to the wheelchair space, ${wheelchairSeat.status.toLowerCase()}`}
                        accessibilityState={{
                            disabled: isOccupied,
                            selected: isSelected,
                        }}
                    >
                        <Text
                            style={
                                isSelected || isOccupied
                                    ? styles.seatTextLight
                                    : styles.seatTextDark
                            }
                        >
                            {guardianSeat.seatNumber}
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <View style={styles.slot} />
                )}

                <View style={styles.slot} />
            </View>
        </View>
    );
}

function SeatRow({
    row,
    selectedSeatNumber,
    passengerAge,
    onSelectSeat,
}: {
    row: SeatMapRow;
    selectedSeatNumber: string | null;
    passengerAge: number | null;
    onSelectSeat: (seat: Seat) => void;
}) {
    if (row.kind === 'WHEELCHAIR_PAIR') {
        const wheelchairSeat =
            row.left[0]?.seat ?? null;

        const guardianSeat =
            row.right[0]?.kind === 'SEAT'
                ? row.right[0].seat
                : null;

        if (!wheelchairSeat) {
            return null;
        }

        return (
            <WheelchairPairRow
                wheelchairSeat={wheelchairSeat}
                guardianSeat={guardianSeat}
                selectedSeatNumber={selectedSeatNumber}
                onSelectSeat={onSelectSeat}
            />
        );
    }

    const renderSlot = (
        slot: SeatSlot,
        key: string,
    ) => {
        if (slot.kind === 'EMPTY' || !slot.seat) {
            return (
                <View
                    key={key}
                    style={styles.slot}
                />
            );
        }

        return (
            <StandardSeatButton
                key={key}
                seat={slot.seat}
                isSelected={
                    slot.seat.seatNumber ===
                    selectedSeatNumber
                }
                passengerAge={passengerAge}
                onPress={() =>
                    onSelectSeat(slot.seat!)
                }
            />
        );
    };

    return (
        <View style={styles.row}>
            <View style={styles.sideGroup}>
                {row.left.map((slot, i) =>
                    renderSlot(
                        slot,
                        `L${i}`,
                    ),
                )}
            </View>

            <View style={styles.aisle}>
                <View style={styles.aisleLine} />
            </View>

            <View style={styles.sideGroup}>
                {row.right.map((slot, i) =>
                    renderSlot(
                        slot,
                        `R${i}`,
                    ),
                )}
            </View>
        </View>
    );
}

export function SeatMap({
    layout,
    selectedSeatNumber,
    passengerAge,
    onSelectSeat,
}: Props) {
    return (
        <View style={styles.wrapper}>
            <View style={styles.legendRow}>
                <LegendItem
                    color="#FFFFFF"
                    label="Available"
                    border
                />

                <LegendItem
                    color="#0066CC"
                    label="Selected"
                />

                <LegendItem
                    color="#CBD5E1"
                    label="Occupied"
                />

                <LegendItem
                    color="#FFF3CD"
                    label="Priority"
                />

                <LegendItem
                    color="#E0E7FF"
                    label="Guardian"
                />

                <LegendItem
                    color="#D1FAE5"
                    label="Elderly (60+)"
                />
            </View>

            <View style={styles.busBody}>
                <View style={styles.frontRow}>
                    <View style={styles.frontBadge}>
                        <Ionicons
                            name="log-in-outline"
                            size={15}
                            color="#64748B"
                        />

                        <Text style={styles.frontBadgeText}>
                            ENTRANCE
                        </Text>
                    </View>

                    <View style={styles.frontDivider} />

                    <View style={styles.frontBadge}>
                        <Ionicons
                            name="disc-outline"
                            size={15}
                            color="#64748B"
                        />

                        <Text style={styles.frontBadgeText}>
                            DRIVER
                        </Text>
                    </View>
                </View>

                {layout.rows.map((row) => (
                    <SeatRow
                        key={row.rowNumber}
                        row={row}
                        selectedSeatNumber={
                            selectedSeatNumber
                        }
                        passengerAge={passengerAge}
                        onSelectSeat={onSelectSeat}
                    />
                ))}

                <View style={styles.rearLabel}>
                    <Text style={styles.rearLabelText}>
                        REAR OF BUS
                    </Text>
                </View>
            </View>
        </View>
    );
}

function LegendItem({
    color,
    label,
    border,
}: {
    color: string;
    label: string;
    border?: boolean;
}) {
    return (
        <View style={styles.legendItem}>
            <View
                style={[
                    styles.legendDot,
                    {
                        backgroundColor: color,
                    },
                    border &&
                        styles.legendDotBorder,
                ]}
            />

            <Text style={styles.legendText}>
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        paddingVertical: 4,
    },

    legendRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 16,
        gap: 12,
    },

    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    legendDot: {
        width: 14,
        height: 14,
        borderRadius: 4,
        marginRight: 6,
    },

    legendDotBorder: {
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },

    legendText: {
        fontSize: 12,
        color: '#475569',
    },

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
        shadowOffset: {
            width: 0,
            height: 4,
        },
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

    frontBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#64748B',
        marginLeft: 5,
        letterSpacing: 0.4,
    },

    frontDivider: {
        width: 1,
        height: 18,
        backgroundColor: '#E2E8F0',
        marginHorizontal: 14,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: SEAT_GAP,
    },

    sideGroup: {
        flexDirection: 'row',
        gap: SEAT_GAP,
        width: SIDE_WIDTH,
    },

    aisle: {
        width: AISLE_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
        height: UNIT,
    },

    aisleLine: {
        width: 1,
        height: '70%',
        borderLeftWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#E2E8F0',
    },

    slot: {
        width: UNIT,
        height: UNIT,
    },

    seat: {
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },

    seatStandard: {
        backgroundColor: '#FFFFFF',
    },

    seatPriority: {
        backgroundColor: '#FFF3CD',
        borderColor: '#E6C200',
    },

    seatGuardian: {
        backgroundColor: '#E0E7FF',
        borderColor: '#818CF8',
    },

    seatElderly: {
        backgroundColor: '#D1FAE5',
        borderColor: '#34D399',
    },

    seatOccupied: {
        backgroundColor: '#CBD5E1',
        borderColor: '#94A3B8',
    },

    seatSelected: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },

    seatLocked: {
        backgroundColor: '#F1F5F9',
        borderColor: '#E2E8F0',
    },

    seatTextDark: {
        color: '#1E293B',
        fontWeight: '700',
        fontSize: 12,
    },

    seatTextLight: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 12,
    },

    wheelchairBox: {
        width: SIDE_WIDTH,
        minHeight: UNIT,
        borderRadius: 12,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: '#0066CC',
        backgroundColor: '#EBF3FA',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 8,
    },

    wheelchairBoxSelected: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
        borderStyle: 'solid',
    },

    wheelchairBoxOccupied: {
        backgroundColor: '#94A3B8',
        borderColor: '#94A3B8',
        borderStyle: 'solid',
    },

    wheelchairTextGroup: {
        flexShrink: 1,
    },

    wheelchairTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#0066CC',
    },

    wheelchairTitleLight: {
        color: '#FFFFFF',
    },

    wheelchairSubtitle: {
        fontSize: 10,
        fontWeight: '500',
        color: '#5B8FC9',
        marginTop: 1,
    },

    wheelchairSubtitleLight: {
        color: '#E0ECFB',
    },

    rearLabel: {
        alignItems: 'center',
        marginTop: 10,
    },

    rearLabelText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#94A3B8',
        letterSpacing: 1,
    },


    
});