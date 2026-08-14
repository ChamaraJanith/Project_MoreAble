import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Stop } from '../../../entities/stop/model/types';
import { createStop, getStop, toStopId, updateStop } from '../api/stopAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

interface StopFormProps {
    /** When provided the form edits that stop; otherwise it creates a new one. */
    stopId?: string;
}

export const StopForm = ({ stopId }: StopFormProps) => {
    const isEditing = !!stopId;

    const [isLoadingStop, setIsLoadingStop] = useState(isEditing);
    const [loadError, setLoadError] = useState('');

    const [name, setName] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [savedStopName, setSavedStopName] = useState<string | null>(null);

    const loadStop = useCallback(async () => {
        if (!stopId) return;

        setIsLoadingStop(true);
        setLoadError('');

        try {
            const stop = await getStop(stopId);
            setName(stop.name ?? '');
            setLatitude(stop.latitude != null ? String(stop.latitude) : '');
            setLongitude(stop.longitude != null ? String(stop.longitude) : '');
        } catch (err: any) {
            setLoadError(err?.message || 'Unable to load this stop.');
        } finally {
            setIsLoadingStop(false);
        }
    }, [stopId]);

    useEffect(() => {
        loadStop();
    }, [loadStop]);

    const validate = (): boolean => {
        const next: Record<string, string> = {};

        if (!name.trim()) {
            next.name = 'Stop name is required.';
        }

        if (!latitude.trim()) {
            next.latitude = 'Latitude is required.';
        } else {
            const value = Number(latitude);
            if (!Number.isFinite(value)) {
                next.latitude = 'Latitude must be a valid number.';
            } else if (value < -90 || value > 90) {
                next.latitude = 'Latitude must be between -90 and 90.';
            }
        }

        if (!longitude.trim()) {
            next.longitude = 'Longitude is required.';
        } else {
            const value = Number(longitude);
            if (!Number.isFinite(value)) {
                next.longitude = 'Longitude must be a valid number.';
            } else if (value < -180 || value > 180) {
                next.longitude = 'Longitude must be between -180 and 180.';
            }
        }

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSubmit = async () => {
        setSubmitError('');
        if (!validate()) return;

        setIsSubmitting(true);

        const trimmedName = name.trim();

        try {
            const shared = {
                name: trimmedName,
                latitude: Number(latitude),
                longitude: Number(longitude),
            };

            let saved: Stop;

            if (isEditing && stopId) {
                saved = await updateStop(stopId, shared);
            } else {
                // The document id is derived from the name, matching the ids
                // already used in Firestore, so the admin never types one.
                saved = await createStop({ stopId: toStopId(trimmedName), ...shared });
            }

            setSavedStopName(saved?.name ?? trimmedName);
        } catch (err: any) {
            const message: string = err?.message || '';

            // The backend rejects a duplicate document id; expressed in the
            // admin's terms that means the name is already taken.
            setSubmitError(
                /already exists/i.test(message)
                    ? 'A stop with this name already exists. Choose a different name.'
                    : message || 'Unable to save the stop. Please try again.'
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    // -------------------- Success --------------------
    if (savedStopName) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title={isEditing ? 'Edit Bus Stop' : 'Add New Stop'} />
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.successCard} accessibilityLiveRegion="polite">
                        <View style={styles.successIcon}>
                            <Ionicons name="checkmark-circle" size={44} color={adminColors.success} />
                        </View>
                        <Text style={styles.successTitle}>
                            {isEditing ? 'Stop updated' : 'Stop added'}
                        </Text>
                        <Text style={styles.successDescription}>
                            {savedStopName} {isEditing ? 'was updated' : 'was added'} successfully.
                        </Text>

                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => router.back()}
                            accessibilityRole="button"
                            accessibilityLabel="Back to stops"
                        >
                            <Text style={styles.primaryButtonText}>BACK TO STOPS</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </View>
        );
    }

    // -------------------- Loading / load error --------------------
    if (isLoadingStop) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Edit Bus Stop" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading stop details…</Text>
                </View>
            </View>
        );
    }

    if (loadError) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Edit Bus Stop" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this stop"
                        message={loadError}
                        onRetry={loadStop}
                    />
                </View>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <AdminScreenHeader
                title={isEditing ? 'Edit Bus Stop' : 'Add New Stop'}
                subtitle={
                    isEditing ? 'Update this stop and its coordinates' : 'Register a stop on the network'
                }
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text style={styles.sectionTitle}>Stop Information</Text>

                <View style={styles.card}>
                    <FormField
                        label="Stop Name"
                        required
                        value={name}
                        onChangeText={setName}
                        placeholder="Battaramulla"
                        error={errors.name}
                        icon="location-outline"
                    />
                </View>

                <Text style={styles.sectionTitle}>Coordinates</Text>

                <View style={styles.card}>
                    <FormField
                        label="Latitude"
                        required
                        value={latitude}
                        onChangeText={setLatitude}
                        placeholder="6.90167"
                        keyboardType="numbers-and-punctuation"
                        error={errors.latitude}
                        helper="Between -90 and 90"
                        icon="navigate-outline"
                    />

                    <FormField
                        label="Longitude"
                        required
                        value={longitude}
                        onChangeText={setLongitude}
                        placeholder="79.91917"
                        keyboardType="numbers-and-punctuation"
                        error={errors.longitude}
                        helper="Between -180 and 180"
                        icon="compass-outline"
                        isLast
                    />
                </View>

                {!!submitError && (
                    <View style={styles.submitErrorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color={adminColors.danger} />
                        <Text style={styles.submitErrorText}>{submitError}</Text>
                    </View>
                )}

                <TouchableOpacity
                    style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel={isEditing ? 'Save changes' : 'Save stop'}
                    accessibilityState={{ disabled: isSubmitting }}
                >
                    {isSubmitting ? (
                        <View style={styles.submittingRow}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                            <Text style={styles.primaryButtonText}>  SAVING STOP…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryButtonText}>
                            {isEditing ? 'SAVE CHANGES' : 'SAVE STOP'}
                        </Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => router.back()}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

interface FormFieldProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    error?: string;
    helper?: string;
    icon: keyof typeof Ionicons.glyphMap;
    keyboardType?: 'default' | 'numbers-and-punctuation';
    required?: boolean;
    isLast?: boolean;
}

function FormField({
    label,
    value,
    onChangeText,
    placeholder,
    error,
    helper,
    icon,
    keyboardType = 'default',
    required = false,
    isLast = false,
}: FormFieldProps) {
    return (
        <View style={[styles.fieldBlock, isLast && styles.fieldBlockLast]}>
            <Text style={styles.fieldLabel}>
                {label}
                {required && <Text style={styles.requiredMark}> *</Text>}
            </Text>

            <View style={[styles.inputWrapper, !!error && styles.inputError]}>
                <Ionicons name={icon} size={18} color={adminColors.textMuted} style={styles.inputIcon} />
                <TextInput
                    style={styles.input}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={adminColors.textPlaceholder}
                    keyboardType={keyboardType}
                    accessibilityLabel={required ? `${label}, required` : label}
                />
            </View>

            {!!helper && !error && <Text style={styles.helperText}>{helper}</Text>}

            {!!error && (
                <View style={styles.errorRow}>
                    <Ionicons name="alert-circle" size={14} color={adminColors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 8,
    },
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },

    fieldBlock: { marginBottom: 16 },
    fieldBlockLast: { marginBottom: 0 },
    fieldLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 8,
    },
    requiredMark: { color: adminColors.danger },
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
    inputError: { borderColor: adminColors.danger, backgroundColor: adminColors.dangerSoft },
    inputIcon: { marginRight: 10 },
    input: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
        paddingVertical: 12,
    },

    helperText: { fontSize: 12, color: adminColors.textMuted, marginTop: 6 },
    errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    errorText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 5,
    },

    submitErrorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
        marginTop: 4,
    },
    submitErrorText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 8,
        lineHeight: 18,
    },

    primaryButton: {
        backgroundColor: adminColors.primary,
        minHeight: 54,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
        ...adminShadow.card,
    },
    primaryButtonDisabled: { backgroundColor: adminColors.textPlaceholder },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: 0.6,
    },
    submittingRow: { flexDirection: 'row', alignItems: 'center' },

    secondaryButton: {
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 10,
    },
    secondaryButtonText: { fontSize: 15, fontWeight: '600', color: adminColors.textSecondary },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    centeredText: { marginTop: 12, fontSize: 14, color: adminColors.textSecondary },

    successCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 24,
        alignItems: 'center',
        marginTop: 10,
        ...adminShadow.card,
    },
    successIcon: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: adminColors.successSoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    successTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 6,
    },
    successDescription: {
        fontSize: 14,
        color: adminColors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 18,
    },
});