import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { adminColors } from '../../admin/ui/adminTheme';

// Field shells styled from the same tokens as the Bus/Route admin forms, so the
// report form reads as part of the same management UI.

interface ReportTextFieldProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    icon: keyof typeof Ionicons.glyphMap;
    placeholder?: string;
    helper?: string;
    optional?: boolean;
    autoCapitalize?: 'none' | 'characters' | 'words';
    maxLength?: number;
}

export function ReportTextField({
    label,
    value,
    onChangeText,
    icon,
    placeholder,
    helper,
    optional = false,
    autoCapitalize = 'characters',
    maxLength,
}: ReportTextFieldProps) {
    return (
        <View style={styles.fieldBlock}>
            <FieldLabel label={label} optional={optional} />

            <View style={styles.inputWrapper}>
                <Ionicons name={icon} size={18} color={adminColors.textMuted} style={styles.inputIcon} />
                <TextInput
                    style={styles.input}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={adminColors.textPlaceholder}
                    autoCapitalize={autoCapitalize}
                    maxLength={maxLength}
                    accessibilityLabel={label}
                />
            </View>

            {!!helper && <Text style={styles.helperText}>{helper}</Text>}
        </View>
    );
}

interface ReportTextAreaProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    helper?: string;
    maxLength: number;
}

export function ReportTextArea({
    label,
    value,
    onChangeText,
    placeholder,
    helper,
    maxLength,
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
}

export function ReportSelectField({
    label,
    value,
    placeholder,
    icon,
    onPress,
}: ReportSelectFieldProps) {
    return (
        <View style={styles.fieldBlock}>
            <FieldLabel label={label} />

            <TouchableOpacity
                style={styles.inputWrapper}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityValue={{ text: value ?? 'Not selected' }}
                accessibilityHint="Double tap to choose an option"
            >
                <Ionicons
                    name={icon}
                    size={20}
                    color={value ? adminColors.primary : adminColors.textMuted}
                    style={styles.inputIcon}
                />
                <Text
                    style={[styles.selectValue, !value && styles.selectPlaceholder]}
                    numberOfLines={1}
                >
                    {value ?? placeholder}
                </Text>
                <Ionicons name="chevron-down" size={18} color={adminColors.textMuted} />
            </TouchableOpacity>
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
    inputIcon: { marginRight: 10 },
    input: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
        paddingVertical: 12,
    },

    selectValue: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
        marginRight: 8,
    },
    selectPlaceholder: {
        fontWeight: '500',
        color: adminColors.textPlaceholder,
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
