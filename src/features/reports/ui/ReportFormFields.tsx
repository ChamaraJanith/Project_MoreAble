import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { adminColors } from '../../admin/ui/adminTheme';

// Field shells styled from the same tokens as the Bus/Route admin forms, so the
// report form reads as part of the same management UI.

interface ReportTextAreaProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    helper?: string;
    maxLength: number;
    /**
     * Whether the field accepts typing.
     *
     * Defaults to true, which is every existing caller. The admin remark
     * composer (MOV-160) turns it off while a remark is on its way to the API,
     * so the text cannot change out from under the request that is sending it.
     */
    editable?: boolean;
}

export function ReportTextArea({
    label,
    value,
    onChangeText,
    placeholder,
    helper,
    maxLength,
    editable = true,
}: ReportTextAreaProps) {
    return (
        <View style={styles.fieldBlock}>
            <FieldLabel label={label} />

            <TextInput
                style={styles.textArea}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={adminColors.textPlaceholder}
                multiline
                numberOfLines={5}
                maxLength={maxLength}
                textAlignVertical="top"
                editable={editable}
                accessibilityLabel={label}
            />

            <View style={styles.helperRow}>
                {!!helper && <Text style={[styles.helperText, styles.helperTextGrow]}>{helper}</Text>}
                <Text style={styles.counterText}>
                    {value.length}/{maxLength}
                </Text>
            </View>
        </View>
    );
}

interface ReportSelectFieldProps {
    label: string;
    /** Rendered value, or `null` to show the placeholder. */
    value: string | null;
    placeholder: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    /** Supporting line shown under the value once something is selected. */
    secondary?: string;
    helper?: string;
    optional?: boolean;
    /** Disables the trigger, e.g. while its options are still loading. */
    disabled?: boolean;
    /** Replaces the chevron with a tick once a choice has been made. */
    showSelectedTick?: boolean;
}

export function ReportSelectField({
    label,
    value,
    placeholder,
    icon,
    onPress,
    secondary,
    helper,
    optional = false,
    disabled = false,
    showSelectedTick = false,
}: ReportSelectFieldProps) {
    return (
        <View style={styles.fieldBlock}>
            <FieldLabel label={label} optional={optional} />

            <TouchableOpacity
                style={[styles.inputWrapper, disabled && styles.inputWrapperDisabled]}
                onPress={onPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityValue={{ text: value ?? 'Not selected' }}
                accessibilityHint="Double tap to choose an option"
                accessibilityState={{ disabled }}
            >
                <Ionicons
                    name={icon}
                    size={20}
                    color={value ? adminColors.primary : adminColors.textMuted}
                    style={styles.inputIcon}
                />

                <View style={styles.selectTextGroup}>
                    <Text
                        style={[styles.selectValue, !value && styles.selectPlaceholder]}
                        numberOfLines={1}
                    >
                        {value ?? placeholder}
                    </Text>
                    {!!value && !!secondary && (
                        <Text style={styles.selectSecondary} numberOfLines={1}>
                            {secondary}
                        </Text>
                    )}
                </View>

                {value && showSelectedTick ? (
                    <Ionicons name="checkmark-circle" size={20} color={adminColors.primary} />
                ) : (
                    <Ionicons name="chevron-down" size={18} color={adminColors.textMuted} />
                )}
            </TouchableOpacity>

            {!!helper && <Text style={styles.helperText}>{helper}</Text>}
        </View>
    );
}

/** Required fields carry an asterisk; optional ones say so in words. */
function FieldLabel({ label, optional = false }: { label: string; optional?: boolean }) {
    return (
        <Text style={styles.fieldLabel}>
            {label}
            {optional ? <Text style={styles.optionalText}>{'  · Optional'}</Text> : ' *'}
        </Text>
    );
}

const styles = StyleSheet.create({
    fieldBlock: { marginBottom: 16 },
    fieldLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 8,
    },
    optionalText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
    },

    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 54,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingHorizontal: 12,
    },
    inputWrapperDisabled: {
        backgroundColor: adminColors.borderSubtle,
        opacity: 0.7,
    },
    inputIcon: { marginRight: 10 },

    selectTextGroup: {
        flex: 1,
        marginRight: 8,
    },
    selectValue: {
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
    },
    selectPlaceholder: {
        fontWeight: '500',
        color: adminColors.textPlaceholder,
    },
    selectSecondary: {
        fontSize: 12,
        color: adminColors.textSecondary,
        marginTop: 3,
    },

    textArea: {
        minHeight: 120,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        padding: 14,
        fontSize: 15,
        color: adminColors.textPrimary,
        lineHeight: 21,
    },

    helperRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    helperText: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 6,
        lineHeight: 17,
    },
    helperTextGrow: { flex: 1, marginTop: 0, marginRight: 10 },
    counterText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
    },
});
