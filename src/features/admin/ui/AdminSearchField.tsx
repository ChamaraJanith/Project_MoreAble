import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { adminColors } from './adminTheme';

interface AdminSearchFieldProps {
    value: string;
    onChangeText: (value: string) => void;
    placeholder: string;
    /** What a screen reader calls the box, e.g. "Search reports". */
    accessibilityLabel: string;
    /** Shown at the end of the row, e.g. "3 of 12" — omitted while empty. */
    resultLabel?: string;
    autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
}

/**
 * The search box the list screens share.
 *
 * The same row the fleet and route lists have always drawn — surface, border,
 * radius and muted magnifier off the admin theme — pulled out as a component
 * once a second and third screen wanted it, so the passenger reports list and
 * the admin review queue cannot drift into two slightly different boxes.
 *
 * It only reports what was typed. Which reports that leaves is the calling
 * screen's business, and every one of them decides it against the list it
 * already holds rather than by asking the API again.
 */
export function AdminSearchField({
    value,
    onChangeText,
    placeholder,
    accessibilityLabel,
    resultLabel,
    autoCapitalize = 'none',
}: AdminSearchFieldProps) {
    return (
        <View style={styles.wrapper}>
            <Ionicons name="search" size={18} color={adminColors.textMuted} />

            <TextInput
                style={styles.input}
                placeholder={placeholder}
                placeholderTextColor={adminColors.textPlaceholder}
                value={value}
                onChangeText={onChangeText}
                autoCapitalize={autoCapitalize}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={accessibilityLabel}
            />

            {/* Only once there is something to count, so an untouched box is a
                box rather than a box with a tally beside it. */}
            {!!value && !!resultLabel && (
                <Text style={styles.resultLabel} numberOfLines={1}>
                    {resultLabel}
                </Text>
            )}

            {!!value && (
                <TouchableOpacity
                    onPress={() => onChangeText('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    style={styles.clearButton}
                >
                    <Ionicons
                        name="close-circle"
                        size={18}
                        color={adminColors.textPlaceholder}
                    />
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.border,
        paddingHorizontal: 14,
        minHeight: 48,
        marginBottom: 14,
    },
    input: {
        flex: 1,
        marginLeft: 10,
        fontSize: 15,
        color: adminColors.textPrimary,
        paddingVertical: 10,
    },
    // Never grows: the count gives way to the field on a narrow phone rather
    // than pushing the clear control off the row.
    resultLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textMuted,
        marginLeft: 8,
        flexShrink: 0,
    },
    clearButton: { padding: 6 },
});
