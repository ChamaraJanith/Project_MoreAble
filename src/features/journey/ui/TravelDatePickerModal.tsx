import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { addDays, isSameDay, MONTH_NAMES, startOfDay, WEEKDAY_SHORT_NAMES } from '../utils/dateTime';

interface TravelDatePickerModalProps {
    visible: boolean;
    selectedDate: Date | null;
    onClose: () => void;
    onSelect: (date: Date) => void;
}

export function TravelDatePickerModal({ visible, selectedDate, onClose, onSelect }: TravelDatePickerModalProps) {
    const today = useMemo(() => startOfDay(new Date()), []);
    const tomorrow = useMemo(() => addDays(today, 1), [today]);

    const [viewingMonth, setViewingMonth] = useState(() => {
        const base = selectedDate ?? today;
        return new Date(base.getFullYear(), base.getMonth(), 1);
    });

    // Reset the visible month to match the current selection each time the picker opens.
    useEffect(() => {
        if (visible) {
            const base = selectedDate ?? today;
            setViewingMonth(new Date(base.getFullYear(), base.getMonth(), 1));
        }
    }, [visible, selectedDate, today]);

    const canGoToPreviousMonth =
        viewingMonth.getFullYear() > today.getFullYear() ||
        (viewingMonth.getFullYear() === today.getFullYear() && viewingMonth.getMonth() > today.getMonth());

    const handlePrevMonth = () => {
        if (!canGoToPreviousMonth) return;
        setViewingMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setViewingMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    const calendarCells = useMemo(() => {
        const firstOfMonth = new Date(viewingMonth.getFullYear(), viewingMonth.getMonth(), 1);
        const daysInMonth = new Date(viewingMonth.getFullYear(), viewingMonth.getMonth() + 1, 0).getDate();
        const startWeekday = firstOfMonth.getDay();

        const cells: (Date | null)[] = [];
        for (let i = 0; i < startWeekday; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) {
            cells.push(new Date(viewingMonth.getFullYear(), viewingMonth.getMonth(), day));
        }
        return cells;
    }, [viewingMonth]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close date picker"
                />
                <View style={styles.sheet}>
                    <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle} accessibilityRole="header">
                            Select Travel Date
                        </Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityRole="button"
                            accessibilityLabel="Close date picker"
                        >
                            <Ionicons name="close" size={24} color="#0F172A" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.quickRow}>
                        <TouchableOpacity
                            style={styles.quickChip}
                            onPress={() => onSelect(today)}
                            accessibilityRole="button"
                            accessibilityLabel="Select today"
                        >
                            <Ionicons name="today-outline" size={18} color="#0066CC" style={{ marginRight: 6 }} />
                            <Text style={styles.quickChipText}>Today</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.quickChip}
                            onPress={() => onSelect(tomorrow)}
                            accessibilityRole="button"
                            accessibilityLabel="Select tomorrow"
                        >
                            <Ionicons name="arrow-forward-circle-outline" size={18} color="#0066CC" style={{ marginRight: 6 }} />
                            <Text style={styles.quickChipText}>Tomorrow</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.monthNavRow}>
                        <TouchableOpacity
                            onPress={handlePrevMonth}
                            disabled={!canGoToPreviousMonth}
                            style={styles.monthNavButton}
                            accessibilityRole="button"
                            accessibilityLabel="Previous month"
                            accessibilityState={{ disabled: !canGoToPreviousMonth }}
                        >
                            <Ionicons name="chevron-back" size={22} color={canGoToPreviousMonth ? '#0066CC' : '#CBD5E1'} />
                        </TouchableOpacity>
                        <Text style={styles.monthLabel} accessibilityLabel={`${MONTH_NAMES[viewingMonth.getMonth()]} ${viewingMonth.getFullYear()}`}>
                            {MONTH_NAMES[viewingMonth.getMonth()]} {viewingMonth.getFullYear()}
                        </Text>
                        <TouchableOpacity
                            onPress={handleNextMonth}
                            style={styles.monthNavButton}
                            accessibilityRole="button"
                            accessibilityLabel="Next month"
                        >
                            <Ionicons name="chevron-forward" size={22} color="#0066CC" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.weekdayRow}>
                        {WEEKDAY_SHORT_NAMES.map((label) => (
                            <Text key={label} style={styles.weekdayLabel}>{label.charAt(0)}</Text>
                        ))}
                    </View>

                    <View style={styles.calendarGrid}>
                        {calendarCells.map((date, index) => {
                            if (!date) {
                                return <View key={`empty-${index}`} style={styles.dayCell} />;
                            }
                            const isPast = date < today;
                            const isToday = isSameDay(date, today);
                            const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;

                            return (
                                <TouchableOpacity
                                    key={date.toISOString()}
                                    style={[
                                        styles.dayCell,
                                        isToday && !isSelected && styles.dayCellToday,
                                        isSelected && styles.dayCellSelected,
                                    ]}
                                    onPress={() => !isPast && onSelect(date)}
                                    disabled={isPast}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`}
                                    accessibilityState={{ disabled: isPast, selected: isSelected }}
                                >
                                    <Text
                                        style={[
                                            styles.dayCellText,
                                            isPast && styles.dayCellTextDisabled,
                                            isSelected && styles.dayCellTextSelected,
                                        ]}
                                    >
                                        {date.getDate()}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 36,
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sheetTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0F172A',
    },
    closeButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    quickRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    quickChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EBF3FA',
        borderWidth: 1,
        borderColor: '#CCE3F8',
        borderRadius: 14,
        minHeight: 50,
    },
    quickChipText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0066CC',
    },
    monthNavRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    monthNavButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    monthLabel: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
    },
    weekdayRow: {
        flexDirection: 'row',
        marginBottom: 4,
    },
    weekdayLabel: {
        flexBasis: '14.28%',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: '700',
        color: '#64748B',
    },
    calendarGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    dayCell: {
        flexBasis: '14.28%',
        aspectRatio: 1,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 12,
        marginVertical: 2,
    },
    dayCellToday: {
        borderWidth: 2,
        borderColor: '#0066CC',
    },
    dayCellSelected: {
        backgroundColor: '#0066CC',
    },
    dayCellText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1E293B',
    },
    dayCellTextDisabled: {
        color: '#CBD5E1',
    },
    dayCellTextSelected: {
        color: '#FFFFFF',
        fontWeight: '800',
    },
});
