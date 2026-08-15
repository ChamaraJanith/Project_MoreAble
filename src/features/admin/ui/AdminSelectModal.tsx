import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface AdminSelectOption {
    /** Stable value kept internally — never rendered to the admin. */
    value: string;
    /** Primary line, e.g. a route number + name or a bus number plate. */
    label: string;
    /** Optional supporting line, e.g. bus model or route endpoints. */
    description?: string;
}

interface AdminSelectModalProps {
    visible: boolean;
    title: string;
    options: AdminSelectOption[];
    selectedValue: string | null;
    emptyMessage: string;
    onClose: () => void;
    onSelect: (value: string) => void;
}

export function AdminSelectModal({
    visible,
    title,
    options,
    selectedValue,
    emptyMessage,
    onClose,
    onSelect,
}: AdminSelectModalProps) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={`Close ${title}`}
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
                            accessibilityLabel="Close"
                        >
                            <Ionicons name="close" size={24} color="#1A2530" />
                        </TouchableOpacity>
                    </View>

                    {options.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="information-circle-outline" size={26} color="#7A8793" />
                            <Text style={styles.emptyText}>{emptyMessage}</Text>
                        </View>
                    ) : (
                        <ScrollView style={styles.optionList} showsVerticalScrollIndicator={false}>
                            {options.map((option) => {
                                const isSelected = option.value === selectedValue;

                                return (
                                    <TouchableOpacity
                                        key={option.value}
                                        style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                                        onPress={() => onSelect(option.value)}
                                        accessibilityRole="button"
                                        accessibilityLabel={
                                            option.description ? `${option.label}, ${option.description}` : option.label
                                        }
                                        accessibilityState={{ selected: isSelected }}
                                    >
                                        <View style={styles.optionTextGroup}>
                                            <Text style={styles.optionLabel} numberOfLines={1}>
                                                {option.label}
                                            </Text>
                                            {!!option.description && (
                                                <Text style={styles.optionDescription} numberOfLines={1}>
                                                    {option.description}
                                                </Text>
                                            )}
                                        </View>

                                        {isSelected && (
                                            <Ionicons name="checkmark-circle" size={22} color="#1976D2" />
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(26, 37, 48, 0.45)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 28,
        maxHeight: '75%',
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1A2530',
    },
    closeButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    optionList: {
        flexGrow: 0,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 60,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E4EAF1',
        backgroundColor: '#FFFFFF',
        marginBottom: 10,
    },
    optionRowSelected: {
        borderColor: '#1976D2',
        backgroundColor: '#EEF5FF',
    },
    optionTextGroup: {
        flex: 1,
        marginRight: 10,
    },
    optionLabel: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1A2530',
    },
    optionDescription: {
        fontSize: 13,
        color: '#71808D',
        marginTop: 3,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 30,
        paddingHorizontal: 12,
    },
    emptyText: {
        marginTop: 10,
        fontSize: 14,
        color: '#71808D',
        textAlign: 'center',
        lineHeight: 20,
    },
});
