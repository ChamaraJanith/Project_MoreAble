import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    Bus,
    BusAccessibilityFacilities,
    BusStatus,
    CountedFacility,
} from '../../../entities/bus/model/types';
import { createBus, getBus, updateBus } from '../api/busAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

interface BusFormProps {
    /** When provided the form edits that bus; otherwise it creates a new one. */
    numberPlate?: string;
}

type BooleanFacilityKey = 'wheelchairRamp' | 'audioAnnouncement' | 'lowFloorVehicle' | 'walkingAssistance';
type CountedFacilityKey = 'wheelchairSpace' | 'guardianSeats' | 'prioritySeats' | 'elderlySeats';

const BOOLEAN_FACILITIES: { key: BooleanFacilityKey; label: string; hint: string }[] = [
    { key: 'wheelchairRamp', label: 'Wheelchair Ramp', hint: 'Boarding ramp available' },
    { key: 'audioAnnouncement', label: 'Audio Announcement', hint: 'Spoken stop announcements' },
    { key: 'lowFloorVehicle', label: 'Low Floor Vehicle', hint: 'Step-free boarding' },
    { key: 'walkingAssistance', label: 'Walking Assistance', hint: 'Staff assistance on board' },
];

const COUNTED_FACILITIES: { key: CountedFacilityKey; label: string }[] = [
    { key: 'wheelchairSpace', label: 'Wheelchair Space' },
    { key: 'guardianSeats', label: 'Guardian Seats' },
    { key: 'prioritySeats', label: 'Priority Seats' },
    { key: 'elderlySeats', label: 'Elderly Seats' },
];

const STATUS_OPTIONS: BusStatus[] = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];
const STATUS_LABELS: Record<BusStatus, string> = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    MAINTENANCE: 'Maintenance',
};

const emptyCounted: CountedFacility = { available: false, count: 0 };

function defaultFacilities(): BusAccessibilityFacilities {
    return {
        wheelchairRamp: false,
        audioAnnouncement: false,
        lowFloorVehicle: false,
        walkingAssistance: false,
        wheelchairSpace: { ...emptyCounted },
        guardianSeats: { ...emptyCounted },
        prioritySeats: { ...emptyCounted },
        elderlySeats: { ...emptyCounted },
    };
}

export const BusForm = ({ numberPlate }: BusFormProps) => {
    const isEditing = !!numberPlate;

    const [isLoadingBus, setIsLoadingBus] = useState(isEditing);
    const [loadError, setLoadError] = useState('');

    const [plate, setPlate] = useState(numberPlate ?? '');
    const [chassisNumber, setChassisNumber] = useState('');
    const [busModel, setBusModel] = useState('');
    const [manufacturer, setManufacturer] = useState('');
    const [manufactureYear, setManufactureYear] = useState('');
    const [seatCapacity, setSeatCapacity] = useState('');
    const [status, setStatus] = useState<BusStatus>('ACTIVE');
    const [facilities, setFacilities] = useState<BusAccessibilityFacilities>(defaultFacilities);
    // Counts are kept as strings so the input can be cleared while typing.
    const [counts, setCounts] = useState<Record<CountedFacilityKey, string>>({
        wheelchairSpace: '0',
        guardianSeats: '0',
        prioritySeats: '0',
        elderlySeats: '0',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [savedPlate, setSavedPlate] = useState<string | null>(null);

    const loadBus = useCallback(async () => {
        if (!numberPlate) return;

        setIsLoadingBus(true);
        setLoadError('');

        try {
            const bus = await getBus(numberPlate);

            setPlate(bus.numberPlate);
            setChassisNumber(bus.chassisNumber ?? '');
            setBusModel(bus.busModel ?? '');
            setManufacturer(bus.manufacturer ?? '');
            setManufactureYear(bus.manufactureYear ? String(bus.manufactureYear) : '');
            setSeatCapacity(bus.seatCapacity ? String(bus.seatCapacity) : '');
            setStatus(bus.status ?? 'ACTIVE');

            const loaded = { ...defaultFacilities(), ...(bus.accessibilityFacilities ?? {}) };
            setFacilities(loaded);
            setCounts({
                wheelchairSpace: String(loaded.wheelchairSpace?.count ?? 0),
                guardianSeats: String(loaded.guardianSeats?.count ?? 0),
                prioritySeats: String(loaded.prioritySeats?.count ?? 0),
                elderlySeats: String(loaded.elderlySeats?.count ?? 0),
            });
        } catch (err: any) {
            setLoadError(err?.message || 'Unable to load this bus.');
        } finally {
            setIsLoadingBus(false);
        }
    }, [numberPlate]);

    useEffect(() => {
        loadBus();
    }, [loadBus]);

    const currentYear = useMemo(() => new Date().getFullYear(), []);

    const toggleBoolean = (key: BooleanFacilityKey, value: boolean) => {
        setFacilities((prev) => ({ ...prev, [key]: value }));
    };

    const toggleCounted = (key: CountedFacilityKey, value: boolean) => {
        setFacilities((prev) => ({
            ...prev,
            // Turning a facility off resets its count so the payload stays consistent.
            [key]: { available: value, count: value ? prev[key]?.count ?? 0 : 0 },
        }));
        if (!value) {
            setCounts((prev) => ({ ...prev, [key]: '0' }));
        }
    };

    const changeCount = (key: CountedFacilityKey, raw: string) => {
        const digitsOnly = raw.replace(/[^0-9]/g, '');
        setCounts((prev) => ({ ...prev, [key]: digitsOnly }));
        setFacilities((prev) => ({
            ...prev,
            [key]: { available: prev[key]?.available ?? false, count: Number(digitsOnly || 0) },
        }));
    };

    const validate = (): boolean => {
        const next: Record<string, string> = {};

        if (!isEditing && !plate.trim()) next.numberPlate = 'Number plate is required.';
        if (!chassisNumber.trim()) next.chassisNumber = 'Chassis number is required.';
        if (!busModel.trim()) next.busModel = 'Bus model is required.';
        if (!manufacturer.trim()) next.manufacturer = 'Manufacturer is required.';

        const year = Number(manufactureYear);
        if (!manufactureYear.trim()) {
            next.manufactureYear = 'Manufacture year is required.';
        } else if (!Number.isInteger(year) || year < 1980 || year > currentYear + 1) {
            next.manufactureYear = `Enter a year between 1980 and ${currentYear + 1}.`;
        }

        const seats = Number(seatCapacity);
        if (!seatCapacity.trim()) {
            next.seatCapacity = 'Seat capacity is required.';
        } else if (!Number.isInteger(seats) || seats < 1) {
            next.seatCapacity = 'Seat capacity must be a positive whole number.';
        }

        for (const facility of COUNTED_FACILITIES) {
            const value = facilities[facility.key];
            if (value?.available && (!Number.isInteger(value.count) || value.count < 1)) {
                next[facility.key] = `Enter how many ${facility.label.toLowerCase()} are available.`;
            }
        }

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSubmit = async () => {
        setSubmitError('');
        if (!validate()) return;

        setIsSubmitting(true);

        try {
            const sharedPayload = {
                chassisNumber: chassisNumber.trim(),
                busModel: busModel.trim(),
                manufacturer: manufacturer.trim(),
                manufactureYear: Number(manufactureYear),
                seatCapacity: Number(seatCapacity),
                accessibilityFacilities: facilities,
                status,
            };

            let saved: Bus;

            if (isEditing && numberPlate) {
                saved = await updateBus(numberPlate, sharedPayload);
            } else {
                saved = await createBus({ numberPlate: plate.trim().toUpperCase(), ...sharedPayload });
            }

            setSavedPlate(saved?.numberPlate ?? plate.trim().toUpperCase());
        } catch (err: any) {
            setSubmitError(err?.message || 'Unable to save the bus. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // -------------------- Success --------------------
    if (savedPlate) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title={isEditing ? 'Edit Bus' : 'Add Bus'} />
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.successCard} accessibilityLiveRegion="polite">
                        <View style={styles.successIcon}>
                            <Ionicons name="checkmark-circle" size={44} color={adminColors.success} />
                        </View>
                        <Text style={styles.successTitle}>
                            {isEditing ? 'Bus updated' : 'Bus added'}
                        </Text>
                        <Text style={styles.successDescription}>
                            Bus {savedPlate} {isEditing ? 'was updated' : 'was added'} successfully.
                        </Text>

                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => router.back()}
                            accessibilityRole="button"
                            accessibilityLabel="Back to bus list"
                        >
                            <Text style={styles.primaryButtonText}>BACK TO BUSES</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </View>
        );
    }

    // -------------------- Loading / load error --------------------
    if (isLoadingBus) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Edit Bus" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading bus details…</Text>
                </View>
            </View>
        );
    }

    if (loadError) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Edit Bus" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this bus"
                        message={loadError}
                        onRetry={loadBus}
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
                title={isEditing ? 'Edit Bus' : 'Add Bus'}
                subtitle={isEditing ? `Update details for ${plate}` : 'Register a bus in the fleet'}
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ---------------- Basic Information ---------------- */}
                <Text style={styles.sectionTitle}>Basic Information</Text>

                <View style={styles.card}>
                    <FormField
                        label="Number Plate"
                        value={plate}
                        onChangeText={setPlate}
                        placeholder="NB-1234"
                        autoCapitalize="characters"
                        editable={!isEditing}
                        error={errors.numberPlate}
                        helper={
                            isEditing
                                ? 'The number plate identifies the bus and cannot be changed.'
                                : undefined
                        }
                        icon="pricetag-outline"
                    />

                    <FormField
                        label="Chassis Number"
                        value={chassisNumber}
                        onChangeText={setChassisNumber}
                        placeholder="CHS-2026-00001"
                        autoCapitalize="characters"
                        error={errors.chassisNumber}
                        icon="barcode-outline"
                    />

                    <FormField
                        label="Bus Model"
                        value={busModel}
                        onChangeText={setBusModel}
                        placeholder="Ashok Leyland Viking"
                        error={errors.busModel}
                        icon="bus-outline"
                    />

                    <FormField
                        label="Manufacturer"
                        value={manufacturer}
                        onChangeText={setManufacturer}
                        placeholder="Ashok Leyland"
                        error={errors.manufacturer}
                        icon="business-outline"
                    />

                    <View style={styles.twoColumn}>
                        <View style={styles.column}>
                            <FormField
                                label="Manufacture Year"
                                value={manufactureYear}
                                onChangeText={(text) => setManufactureYear(text.replace(/[^0-9]/g, ''))}
                                placeholder={String(currentYear)}
                                keyboardType="number-pad"
                                maxLength={4}
                                error={errors.manufactureYear}
                                icon="calendar-outline"
                            />
                        </View>
                        <View style={styles.column}>
                            <FormField
                                label="Seat Capacity"
                                value={seatCapacity}
                                onChangeText={(text) => setSeatCapacity(text.replace(/[^0-9]/g, ''))}
                                placeholder="54"
                                keyboardType="number-pad"
                                maxLength={3}
                                error={errors.seatCapacity}
                                icon="people-outline"
                            />
                        </View>
                    </View>

                    <Text style={styles.fieldLabel}>Status</Text>
                    <View style={styles.statusRow}>
                        {STATUS_OPTIONS.map((option) => {
                            const isSelected = status === option;

                            return (
                                <TouchableOpacity
                                    key={option}
                                    style={[styles.statusOption, isSelected && styles.statusOptionSelected]}
                                    onPress={() => setStatus(option)}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: isSelected }}
                                    accessibilityLabel={STATUS_LABELS[option]}
                                >
                                    <Ionicons
                                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                                        size={17}
                                        color={isSelected ? adminColors.primary : adminColors.textPlaceholder}
                                    />
                                    <Text
                                        style={[styles.statusText, isSelected && styles.statusTextSelected]}
                                        numberOfLines={1}
                                    >
                                        {STATUS_LABELS[option]}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>

                {/* ---------------- Accessibility Facilities ---------------- */}
                <Text style={styles.sectionTitle}>Accessibility Facilities</Text>

                <View style={styles.card}>
                    {BOOLEAN_FACILITIES.map((facility, index) => (
                        <View
                            key={facility.key}
                            style={[styles.toggleRow, index === 0 && styles.toggleRowFirst]}
                        >
                            <View style={styles.toggleTextGroup}>
                                <Text style={styles.toggleLabel}>{facility.label}</Text>
                                <Text style={styles.toggleHint}>{facility.hint}</Text>
                            </View>
                            <Switch
                                value={!!facilities[facility.key]}
                                onValueChange={(value) => toggleBoolean(facility.key, value)}
                                trackColor={{ false: '#D6DEE6', true: '#A8CBF0' }}
                                thumbColor={facilities[facility.key] ? adminColors.primary : '#F4F7FB'}
                                accessibilityLabel={facility.label}
                            />
                        </View>
                    ))}
                </View>

                {/* ---------------- Seating Facilities ---------------- */}
                <Text style={styles.sectionTitle}>Seating Facilities</Text>

                {COUNTED_FACILITIES.map((facility) => {
                    const value = facilities[facility.key] ?? emptyCounted;

                    return (
                        <View key={facility.key} style={styles.card}>
                            <View style={styles.toggleRowFirst}>
                                <View style={styles.toggleRow}>
                                    <View style={styles.toggleTextGroup}>
                                        <Text style={styles.toggleLabel}>{facility.label}</Text>
                                        <Text style={styles.toggleHint}>
                                            {value.available ? 'Available on this bus' : 'Not available'}
                                        </Text>
                                    </View>
                                    <Switch
                                        value={value.available}
                                        onValueChange={(next) => toggleCounted(facility.key, next)}
                                        trackColor={{ false: '#D6DEE6', true: '#A8CBF0' }}
                                        thumbColor={value.available ? adminColors.primary : '#F4F7FB'}
                                        accessibilityLabel={`${facility.label} available`}
                                    />
                                </View>
                            </View>

                            <View
                                style={[
                                    styles.countRow,
                                    !value.available && styles.countRowDisabled,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.countLabel,
                                        !value.available && styles.countLabelDisabled,
                                    ]}
                                >
                                    Number of seats
                                </Text>
                                <TextInput
                                    style={[
                                        styles.countInput,
                                        !value.available && styles.countInputDisabled,
                                        !!errors[facility.key] && styles.inputError,
                                    ]}
                                    value={counts[facility.key]}
                                    onChangeText={(text) => changeCount(facility.key, text)}
                                    editable={value.available}
                                    keyboardType="number-pad"
                                    maxLength={2}
                                    placeholder="0"
                                    placeholderTextColor={adminColors.textPlaceholder}
                                    accessibilityLabel={`${facility.label} count`}
                                    accessibilityState={{ disabled: !value.available }}
                                />
                            </View>

                            {!!errors[facility.key] && (
                                <View style={styles.errorRow}>
                                    <Ionicons name="alert-circle" size={14} color={adminColors.danger} />
                                    <Text style={styles.errorText}>{errors[facility.key]}</Text>
                                </View>
                            )}
                        </View>
                    );
                })}

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
                    accessibilityLabel={isEditing ? 'Save changes' : 'Add bus'}
                    accessibilityState={{ disabled: isSubmitting }}
                >
                    {isSubmitting ? (
                        <View style={styles.submittingRow}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                            <Text style={styles.primaryButtonText}>  SAVING BUS…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryButtonText}>
                            {isEditing ? 'SAVE CHANGES' : 'ADD BUS'}
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

// ------------------------------------------------------------------
interface FormFieldProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    error?: string;
    helper?: string;
    icon: keyof typeof Ionicons.glyphMap;
    keyboardType?: 'default' | 'number-pad';
    autoCapitalize?: 'none' | 'characters' | 'words';
    maxLength?: number;
    editable?: boolean;
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
    autoCapitalize = 'words',
    maxLength,
    editable = true,
}: FormFieldProps) {
    return (
        <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{label}</Text>

            <View
                style={[
                    styles.inputWrapper,
                    !editable && styles.inputWrapperReadOnly,
                    !!error && styles.inputError,
                ]}
            >
                <Ionicons
                    name={icon}
                    size={18}
                    color={editable ? adminColors.textMuted : adminColors.textPlaceholder}
                    style={styles.inputIcon}
                />
                <TextInput
                    style={[styles.input, !editable && styles.inputReadOnly]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={adminColors.textPlaceholder}
                    keyboardType={keyboardType}
                    autoCapitalize={autoCapitalize}
                    maxLength={maxLength}
                    editable={editable}
                    accessibilityLabel={label}
                    accessibilityState={{ disabled: !editable }}
                />
                {!editable && (
                    <Ionicons name="lock-closed" size={15} color={adminColors.textPlaceholder} />
                )}
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
    fieldLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 8,
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
    inputWrapperReadOnly: { backgroundColor: adminColors.borderSubtle },
    inputError: { borderColor: adminColors.danger, backgroundColor: adminColors.dangerSoft },
    inputIcon: { marginRight: 10 },
    input: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
        paddingVertical: 12,
    },
    inputReadOnly: { color: adminColors.textSecondary },

    helperText: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 6,
        lineHeight: 17,
    },
    errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    errorText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 5,
    },

    twoColumn: { flexDirection: 'row', gap: 12 },
    column: { flex: 1 },

    statusRow: { flexDirection: 'row', gap: 8 },
    statusOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 50,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 10,
        paddingHorizontal: 10,
        backgroundColor: adminColors.surfaceMuted,
    },
    statusOptionSelected: {
        borderColor: adminColors.primary,
        backgroundColor: adminColors.primarySoft,
    },
    statusText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 6,
    },
    statusTextSelected: { color: adminColors.textPrimary },

    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    toggleRowFirst: { borderTopWidth: 0 },
    toggleTextGroup: { flex: 1, marginRight: 12 },
    toggleLabel: {
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    toggleHint: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 2,
    },

    countRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 4,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    countRowDisabled: { opacity: 0.5 },
    countLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textPrimary,
    },
    countLabelDisabled: { color: adminColors.textMuted },
    countInput: {
        width: 84,
        minHeight: 46,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    countInputDisabled: {
        backgroundColor: adminColors.borderSubtle,
        color: adminColors.textPlaceholder,
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
    secondaryButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textSecondary,
    },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    centeredText: {
        marginTop: 12,
        fontSize: 14,
        color: adminColors.textSecondary,
    },

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