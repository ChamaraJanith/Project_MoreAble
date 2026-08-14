import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatFriendlyTime, TimeOfDay } from '../utils/dateTime';

interface TravelTimePickerModalProps {
    visible: boolean;
    selectedTime: TimeOfDay | null;
    onClose: () => void;
    onConfirm: (time: TimeOfDay) => void;
    /** Overrides the sheet heading so the picker can be reused for other times. */
    title?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const PERIODS: TimeOfDay['period'][] = ['AM', 'PM'];
const DEFAULT_TIME: TimeOfDay = { hour: 8, minute: 0, period: 'AM' };

export function TravelTimePickerModal({
    visible,
    selectedTime,
    onClose,
    onConfirm,
    title = 'Select Travel Time',
}: TravelTimePickerModalProps) {
    const [draft, setDraft] = useState<TimeOfDay>(selectedTime ?? DEFAULT_TIME);

    // Reset the working selection to match the current field value each time the picker opens.
    useEffect(() => {
        if (visible) {
            setDraft(selectedTime ?? DEFAULT_TIME);
        }
    }, [visible, selectedTime]);

    const handleConfirm = () => {
        onConfirm(draft);
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close time picker"
                />
                <View style={styles.sheet}>
                    <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle} accessibilityRole="header">
                            {title}
                        </Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityRole="button"
                            accessibilityLabel="Close time picker"
                        >
                            <Ionicons name="close" size={24} color="#0F172A" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.previewRow}>
                        <Ionicons name="time-outline" size={22} color="#0066CC" style={{ marginRight: 8 }} />
                        <Text style={styles.previewText}>{formatFriendlyTime(draft)}</Text>
                    </View>

                    <View style={styles.columnsRow}>
                        <TimeColumn
                            label="Hour"
                            values={HOURS}
                            selectedValue={draft.hour}
                            onSelect={(hour) => setDraft((prev) => ({ ...prev, hour }))}
                            formatLabel={(v) => String(v)}
                            accessibilityLabel="Hour"
                        />
                        <TimeColumn
                            label="Minute"
                            values={MINUTES}
                            selectedValue={draft.minute}
                            onSelect={(minute) => setDraft((prev) => ({ ...prev, minute }))}
                            formatLabel={(v) => v.toString().padStart(2, '0')}
                            accessibilityLabel="Minute"
                        />
                        <TimeColumn
                            label="Period"
                            values={PERIODS}
                            selectedValue={draft.period}
                            onSelect={(period) => setDraft((prev) => ({ ...prev, period }))}
                            formatLabel={(v) => String(v)}
                            accessibilityLabel="AM or PM"
                        />
                    </View>

                    <TouchableOpacity
                        style={styles.confirmButton}
                        onPress={handleConfirm}
                        accessibilityRole="button"
                        accessibilityLabel="Confirm travel time"
                    >
                        <Text style={styles.confirmButtonText}>CONFIRM TIME</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

interface TimeColumnProps<T extends string | number> {
    label: string;
    values: T[];
    selectedValue: T;
    onSelect: (value: T) => void;
    formatLabel: (value: T) => string;
    accessibilityLabel: string;
}

function TimeColumn<T extends string | number>({
    label, values, selectedValue, onSelect, formatLabel, accessibilityLabel,
}: TimeColumnProps<T>) {
    return (
        <View style={styles.column}>
            <Text style={styles.columnLabel}>{label}</Text>
            <ScrollView
                style={styles.columnScroll}
                showsVerticalScrollIndicator={false}
                accessibilityLabel={accessibilityLabel}
            >
                {values.map((value) => {
                    const isSelected = value === selectedValue;
                    return (
                        <TouchableOpacity
                            key={String(value)}
                            style={[styles.columnItem, isSelected && styles.columnItemSelected]}
                            onPress={() => onSelect(value)}
                            accessibilityRole="button"
                            accessibilityLabel={`${label} ${formatLabel(value)}`}
                            accessibilityState={{ selected: isSelected }}
                        >
                            <Text style={[styles.columnItemText, isSelected && styles.columnItemTextSelected]}>
                                {formatLabel(value)}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
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
    previewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EBF3FA',
        borderRadius: 16,
        paddingVertical: 14,
        marginBottom: 20,
    },
    previewText: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0066CC',
        letterSpacing: 0.5,
    },
    columnsRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    column: {
        flex: 1,
        alignItems: 'center',
    },
    columnLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#64748B',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    columnScroll: {
        height: 180,
        width: '100%',
    },
    columnItem: {
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 4,
        minHeight: 44,
        justifyContent: 'center',
    },
    columnItemSelected: {
        backgroundColor: '#0066CC',
    },
    columnItemText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#334155',
    },
    columnItemTextSelected: {
        color: '#FFFFFF',
        fontWeight: '800',
    },
    confirmButton: {
        backgroundColor: '#0066CC',
        minHeight: 58,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    confirmButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: 1,
    },
});
