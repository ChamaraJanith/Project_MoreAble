// The accessibility requirement controls on the Recommended Routes screen
// (MOV-91).
//
// Presentation only: which requirements exist, what they mean and what they
// filter is `accessibilityFilters`, so this file can never grow a second
// definition of them. It renders the list it is given and reports taps back.

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    ACCESSIBILITY_REQUIREMENTS,
    AccessibilityRequirementKey,
    AccessibilityRequirementSelection,
} from '../utils/accessibilityFilters';

/**
 * An icon per requirement, kept here rather than in the shared list so the
 * filtering rules stay free of anything that only a renderer cares about.
 */
const REQUIREMENT_ICONS: Record<AccessibilityRequirementKey, keyof typeof Ionicons.glyphMap> = {
    wheelchairRamp: 'accessibility-outline',
    prioritySeats: 'people-outline',
    audioAnnouncement: 'volume-high-outline',
    lowFloorVehicle: 'bus-outline',
    walkingAssistance: 'walk-outline',
};

interface AccessibilityFilterPanelProps {
    selection: AccessibilityRequirementSelection;
    onToggle: (key: AccessibilityRequirementKey) => void;
    onClear: () => void;
    /** How many journeys the current selection leaves, for the summary line. */
    matchingCount: number;
    /** How many journeys the search returned before filtering. */
    totalCount: number;
}

export function AccessibilityFilterPanel({
    selection,
    onToggle,
    onClear,
    matchingCount,
    totalCount,
}: AccessibilityFilterPanelProps) {
    const selectedCount = ACCESSIBILITY_REQUIREMENTS.filter(
        (requirement) => selection[requirement.key]
    ).length;

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <View style={styles.headerIconBadge}>
                    <Ionicons name="options-outline" size={18} color="#0066CC" />
                </View>
                <View style={styles.headerTextGroup}>
                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Accessibility requirements
                    </Text>
                    <Text style={styles.headerSubtitle}>
                        Pick what you need. Only journeys that have it are shown.
                    </Text>
                </View>
            </View>

            <View style={styles.chipWrap}>
                {ACCESSIBILITY_REQUIREMENTS.map((requirement) => {
                    const isSelected = selection[requirement.key] === true;

                    return (
                        <TouchableOpacity
                            key={requirement.key}
                            style={[styles.chip, isSelected && styles.chipSelected]}
                            onPress={() => onToggle(requirement.key)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: isSelected }}
                            accessibilityLabel={`${requirement.label}. ${requirement.description}`}
                            accessibilityHint={
                                isSelected
                                    ? 'Double tap to stop filtering by this requirement'
                                    : 'Double tap to show only journeys with this'
                            }
                        >
                            <Ionicons
                                name={isSelected ? 'checkmark-circle' : REQUIREMENT_ICONS[requirement.key]}
                                size={16}
                                color={isSelected ? '#FFFFFF' : '#334155'}
                            />
                            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                                {requirement.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {selectedCount > 0 && (
                <View style={styles.footerRow}>
                    <Text style={styles.footerText} accessibilityLiveRegion="polite">
                        {matchingCount} of {totalCount} journey{totalCount > 1 ? 's' : ''} match
                        {' '}{selectedCount} requirement{selectedCount > 1 ? 's' : ''}
                    </Text>
                    <TouchableOpacity
                        style={styles.clearButton}
                        onPress={onClear}
                        accessibilityRole="button"
                        accessibilityLabel="Clear accessibility requirements"
                        accessibilityHint="Double tap to show every journey again"
                    >
                        <Text style={styles.clearButtonText}>Clear all</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 20,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 14,
    },
    headerIconBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    headerTextGroup: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 2,
    },
    headerSubtitle: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 18,
    },
    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 2,
        borderColor: '#CBD5E1',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 48, // Large accessible touch target
    },
    chipSelected: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    chipText: {
        flexShrink: 1,
        fontSize: 14,
        fontWeight: '700',
        color: '#334155',
        marginLeft: 6,
    },
    chipTextSelected: {
        color: '#FFFFFF',
    },
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    footerText: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
        marginRight: 12,
    },
    clearButton: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    clearButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
    },
});
