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
import { Route, RouteDirection, RouteStatus } from '../../../entities/route/model/types';
import { createRoute, getRoute, updateRoute } from '../api/routeAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

interface RouteFormProps {
    /** When provided the form edits that route; otherwise it creates a new one. */
    routeId?: string;
}

const DIRECTIONS: { value: RouteDirection; label: string }[] = [
    { value: 'OUTBOUND', label: 'Outbound' },
    { value: 'RETURN', label: 'Return' },
];

const STATUSES: { value: RouteStatus; label: string }[] = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
];

/**
 * Stored stop-to-stop timings as text inputs, one per gap between stops.
 *
 * Always exactly `stopCount - 1` entries, so an input can never end up bound to
 * the wrong pair of stops. Anything unusable becomes an empty field — an
 * untimed gap is shown as untimed rather than as zero minutes.
 */
function toSegmentInputs(
    stored: (number | null)[] | null | undefined,
    stopCount: number
): string[] {
    const source = Array.isArray(stored) ? stored : [];

    return Array.from({ length: Math.max(stopCount - 1, 0) }, (_, index) => {
        const entry = source[index];
        return typeof entry === 'number' && Number.isFinite(entry) && entry >= 0
            ? String(entry)
            : '';
    });
}

export const RouteForm = ({ routeId }: RouteFormProps) => {
    const isEditing = !!routeId;

    const [isLoadingRoute, setIsLoadingRoute] = useState(isEditing);
    const [loadError, setLoadError] = useState('');

    const [routeIdValue, setRouteIdValue] = useState(routeId ?? '');
    const [routeNumber, setRouteNumber] = useState('');
    const [routeName, setRouteName] = useState('');
    const [direction, setDirection] = useState<RouteDirection>('OUTBOUND');
    const [startStopId, setStartStopId] = useState('');
    const [endStopId, setEndStopId] = useState('');
    const [distanceKm, setDistanceKm] = useState('');
    const [estimatedDuration, setEstimatedDuration] = useState('');
    const [status, setStatus] = useState<RouteStatus>('ACTIVE');
    // Start/end locations are derived from the first and last stop so they can
    // never drift out of sync with the ordered stop list.
    const [stops, setStops] = useState<string[]>(['', '']);
    // Travelling minutes for the GAPS between the stops above: entry `i` is the
    // time from stop `i` to stop `i + 1`, so there is always one fewer entry
    // than there are stops (MOV-88). Held as text because these are text
    // inputs; an empty entry means this gap has not been timed yet and is saved
    // as null rather than as a guessed number.
    const [segmentMinutes, setSegmentMinutes] = useState<string[]>(['']);

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [savedRouteNumber, setSavedRouteNumber] = useState<string | null>(null);

    const loadRoute = useCallback(async () => {
        if (!routeId) return;

        setIsLoadingRoute(true);
        setLoadError('');

        try {
            const route = await getRoute(routeId);

            setRouteIdValue(route.routeId);
            setRouteNumber(route.routeNumber ?? '');
            setRouteName(route.routeName ?? '');
            setDirection(route.direction ?? 'OUTBOUND');
            setStartStopId(route.startStopId ?? '');
            setEndStopId(route.endStopId ?? '');
            setDistanceKm(route.distanceKm != null ? String(route.distanceKm) : '');
            setEstimatedDuration(route.estimatedDuration ?? '');
            setStatus(route.status ?? 'ACTIVE');
            const loadedStops =
                Array.isArray(route.stops) && route.stops.length >= 2 ? route.stops : ['', ''];
            setStops(loadedStops);
            setSegmentMinutes(toSegmentInputs(route.segmentDurationsMinutes, loadedStops.length));
        } catch (err: any) {
            setLoadError(err?.message || 'Unable to load this route.');
        } finally {
            setIsLoadingRoute(false);
        }
    }, [routeId]);

    useEffect(() => {
        loadRoute();
    }, [loadRoute]);

    const updateStop = (index: number, value: string) => {
        setStops((prev) => prev.map((stop, i) => (i === index ? value : stop)));
    };

    const updateSegmentMinutes = (index: number, value: string) => {
        // Whole minutes only — a stop-to-stop timing is entered as an integer
        // the same way the rest of this form takes numbers.
        const digitsOnly = value.replace(/[^0-9]/g, '');
        setSegmentMinutes((prev) => prev.map((entry, i) => (i === index ? digitsOnly : entry)));
    };

    const addStop = () => {
        setStops((prev) => [...prev, '']);
        // The new stop opens a new, untimed gap after the previous last stop.
        setSegmentMinutes((prev) => [...prev, '']);
    };

    const removeStop = (index: number) => {
        if (stops.length <= 2) return;

        const lastIndex = stops.length - 1;

        setStops((prev) => prev.filter((_, i) => i !== index));

        setSegmentMinutes((prev) => {
            const next = [...prev];

            if (index === 0) {
                next.shift();
            } else if (index === lastIndex) {
                next.pop();
            } else {
                // Removing a middle stop merges the gaps either side of it into
                // one longer gap whose real timing nobody has measured. One
                // entry goes, and the surviving merged gap is blanked rather
                // than inheriting half of the old journey.
                next.splice(index, 1);
                next[index - 1] = '';
            }

            return next;
        });
    };

    const moveStop = (index: number, offset: -1 | 1) => {
        const target = index + offset;
        if (target < 0 || target >= stops.length) return;

        setStops((prev) => {
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });

        setSegmentMinutes((prev) => {
            const next = [...prev];

            // Reordering stops changes which pairs of stops the timings around
            // the move describe, so those entries are cleared. Keeping them
            // would silently attach a measured time to a gap it was never
            // measured for.
            for (const gap of [index - 1, index, target - 1, target]) {
                if (gap >= 0 && gap < next.length) next[gap] = '';
            }

            return next;
        });
    };

    // Which positions in `stops` survive the blank-filtering below. Kept
    // explicitly so the timings can be re-aligned to the saved stop list: a gap
    // belongs to the stop it starts at, and dropping a blank row must not shift
    // every timing after it onto the wrong pair of stops.
    const keptStopIndices = stops
        .map((stop, index) => ({ stop, index }))
        .filter((entry) => entry.stop.trim().length > 0)
        .map((entry) => entry.index);

    const cleanedStops = keptStopIndices.map((index) => stops[index].trim());
    const startLocation = cleanedStops[0] ?? '';
    const endLocation = cleanedStops.length > 1 ? cleanedStops[cleanedStops.length - 1] : '';

    // One entry per gap in `cleanedStops`, in the same travel order. An empty
    // field becomes null: the gap is recorded as untimed, never as zero.
    const cleanedSegmentDurations: (number | null)[] = keptStopIndices
        .slice(0, -1)
        .map((stopIndex) => {
            const raw = segmentMinutes[stopIndex];
            if (typeof raw !== 'string' || raw.trim() === '') return null;

            const minutes = Number(raw);
            return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
        });

    const timedGapCount = cleanedSegmentDurations.filter((entry) => entry !== null).length;
    const totalGapCount = cleanedSegmentDurations.length;
    const isFullyTimed = totalGapCount > 0 && timedGapCount === totalGapCount;

    // Shown back to the operator as a sanity check against the route's own
    // estimated duration — the two describe the same end-to-end journey.
    const timedTotalMinutes = cleanedSegmentDurations.reduce<number>(
        (total, entry) => total + (entry ?? 0),
        0
    );

    const validate = (): boolean => {
        const next: Record<string, string> = {};

        if (!isEditing && !routeIdValue.trim()) next.routeId = 'Route ID is required.';
        if (!routeNumber.trim()) next.routeNumber = 'Route number is required.';
        if (!routeName.trim()) next.routeName = 'Route name is required.';
        if (!startStopId.trim()) next.startStopId = 'Start stop ID is required.';
        if (!endStopId.trim()) next.endStopId = 'End stop ID is required.';

        if (cleanedStops.length < 2) {
            next.stops = 'A route needs at least two stops with names.';
        }

        if (distanceKm.trim()) {
            const distance = Number(distanceKm);
            if (!Number.isFinite(distance) || distance <= 0) {
                next.distanceKm = 'Distance must be a positive number.';
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
            const shared = {
                routeNumber: routeNumber.trim(),
                routeName: routeName.trim(),
                direction,
                startLocation,
                endLocation,
                startStopId: startStopId.trim(),
                endStopId: endStopId.trim(),
                stops: cleanedStops,
                distanceKm: distanceKm.trim() ? Number(distanceKm) : null,
                estimatedDuration: estimatedDuration.trim() || null,
                // Sent aligned to `stops` above. Null when the operator has
                // timed nothing, so a route with no timings is stored as
                // untimed rather than as a row of zeroes — passenger screens
                // then report no journey duration instead of a wrong one.
                segmentDurationsMinutes: timedGapCount > 0 ? cleanedSegmentDurations : null,
                status,
            };

            let saved: Route;

            if (isEditing && routeId) {
                saved = await updateRoute(routeId, shared);
            } else {
                saved = await createRoute({ routeId: routeIdValue.trim(), ...shared });
            }

            setSavedRouteNumber(saved?.routeNumber ?? routeNumber.trim());
        } catch (err: any) {
            setSubmitError(err?.message || 'Unable to save the route. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // -------------------- Success --------------------
    if (savedRouteNumber) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title={isEditing ? 'Edit Route' : 'Add Route'} />
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.successCard} accessibilityLiveRegion="polite">
                        <View style={styles.successIcon}>
                            <Ionicons name="checkmark-circle" size={44} color={adminColors.success} />
                        </View>
                        <Text style={styles.successTitle}>
                            {isEditing ? 'Route updated' : 'Route created'}
                        </Text>
                        <Text style={styles.successDescription}>
                            Route {savedRouteNumber} {isEditing ? 'was updated' : 'was created'} successfully.
                        </Text>

                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => router.back()}
                            accessibilityRole="button"
                            accessibilityLabel="Back to routes"
                        >
                            <Text style={styles.primaryButtonText}>BACK TO ROUTES</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </View>
        );
    }

    // -------------------- Loading / load error --------------------
    if (isLoadingRoute) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Edit Route" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading route details…</Text>
                </View>
            </View>
        );
    }

    if (loadError) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Edit Route" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this route"
                        message={loadError}
                        onRetry={loadRoute}
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
                title={isEditing ? 'Edit Route' : 'Add Route'}
                subtitle={isEditing ? `Update route ${routeNumber}` : 'Create a transport route'}
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ---------------- Route Identity ---------------- */}
                <Text style={styles.sectionTitle}>Route Identity</Text>

                <View style={styles.card}>
                    <FormField
                        label="Route ID"
                        value={routeIdValue}
                        onChangeText={setRouteIdValue}
                        placeholder="177_KADUWELA_KOLLUPITIYA"
                        autoCapitalize="characters"
                        editable={!isEditing}
                        error={errors.routeId}
                        helper={isEditing ? 'The route ID identifies the route and cannot be changed.' : undefined}
                        icon="key-outline"
                    />

                    <View style={styles.twoColumn}>
                        <View style={styles.column}>
                            <FormField
                                label="Route Number"
                                value={routeNumber}
                                onChangeText={setRouteNumber}
                                placeholder="177"
                                error={errors.routeNumber}
                                icon="pricetag-outline"
                            />
                        </View>
                        <View style={styles.column}>
                            <FormField
                                label="Distance (km)"
                                value={distanceKm}
                                onChangeText={(text) => setDistanceKm(text.replace(/[^0-9.]/g, ''))}
                                placeholder="20"
                                keyboardType="decimal-pad"
                                error={errors.distanceKm}
                                icon="navigate-outline"
                            />
                        </View>
                    </View>

                    <FormField
                        label="Route Name"
                        value={routeName}
                        onChangeText={setRouteName}
                        placeholder="Kaduwela - Kollupitiya"
                        error={errors.routeName}
                        icon="map-outline"
                    />

                    <FormField
                        label="Estimated Duration"
                        value={estimatedDuration}
                        onChangeText={setEstimatedDuration}
                        placeholder="1h 9min"
                        error={errors.estimatedDuration}
                        icon="time-outline"
                    />

                    <Text style={styles.fieldLabel}>Direction</Text>
                    <View style={styles.optionRow}>
                        {DIRECTIONS.map((option) => (
                            <OptionButton
                                key={option.value}
                                label={option.label}
                                isSelected={direction === option.value}
                                onPress={() => setDirection(option.value)}
                            />
                        ))}
                    </View>

                    <View style={styles.fieldSpacer} />

                    <Text style={styles.fieldLabel}>Status</Text>
                    <View style={styles.optionRow}>
                        {STATUSES.map((option) => (
                            <OptionButton
                                key={option.value}
                                label={option.label}
                                isSelected={status === option.value}
                                onPress={() => setStatus(option.value)}
                            />
                        ))}
                    </View>
                </View>

                {/* ---------------- Stops ---------------- */}
                <Text style={styles.sectionTitle}>Route Stops</Text>

                <View style={styles.card}>
                    <Text style={styles.stopsHelper}>
                        Stops run in travel order. The first stop is the starting point and the last is the
                        destination. Enter the real travelling time between each pair of stops — a
                        passenger boarding partway along the route is shown the total for the stops they
                        actually travel, so an untimed gap is better left blank than guessed.
                    </Text>

                    {stops.map((stop, index) => {
                        const isFirst = index === 0;
                        const isLast = index === stops.length - 1;

                        return (
                            <React.Fragment key={index}>
                            <View style={styles.stopRow}>
                                <View style={styles.stopIndexBadge}>
                                    <Text style={styles.stopIndexText}>{index + 1}</Text>
                                </View>

                                <View style={styles.stopInputGroup}>
                                    <TextInput
                                        style={styles.stopInput}
                                        value={stop}
                                        onChangeText={(text) => updateStop(index, text)}
                                        placeholder={
                                            isFirst ? 'Starting stop' : isLast ? 'Ending stop' : 'Stop name'
                                        }
                                        placeholderTextColor={adminColors.textPlaceholder}
                                        accessibilityLabel={`Stop ${index + 1}`}
                                    />
                                    {(isFirst || isLast) && (
                                        <Text style={styles.stopRoleText}>
                                            {isFirst ? 'Starting Stop' : 'Ending Stop'}
                                        </Text>
                                    )}
                                </View>

                                <View style={styles.stopControls}>
                                    <TouchableOpacity
                                        style={styles.stopControlButton}
                                        onPress={() => moveStop(index, -1)}
                                        disabled={isFirst}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Move stop ${index + 1} up`}
                                        accessibilityState={{ disabled: isFirst }}
                                    >
                                        <Ionicons
                                            name="chevron-up"
                                            size={17}
                                            color={isFirst ? adminColors.textPlaceholder : adminColors.textPrimary}
                                        />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={styles.stopControlButton}
                                        onPress={() => moveStop(index, 1)}
                                        disabled={isLast}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Move stop ${index + 1} down`}
                                        accessibilityState={{ disabled: isLast }}
                                    >
                                        <Ionicons
                                            name="chevron-down"
                                            size={17}
                                            color={isLast ? adminColors.textPlaceholder : adminColors.textPrimary}
                                        />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={styles.stopControlButton}
                                        onPress={() => removeStop(index)}
                                        disabled={stops.length <= 2}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Remove stop ${index + 1}`}
                                        accessibilityState={{ disabled: stops.length <= 2 }}
                                    >
                                        <Ionicons
                                            name="close"
                                            size={17}
                                            color={
                                                stops.length <= 2
                                                    ? adminColors.textPlaceholder
                                                    : adminColors.danger
                                            }
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {!isLast && (
                                <View style={styles.segmentRow}>
                                    <View style={styles.segmentConnectorColumn}>
                                        <View style={styles.segmentConnectorLine} />
                                    </View>

                                    <TextInput
                                        style={styles.segmentInput}
                                        value={segmentMinutes[index] ?? ''}
                                        onChangeText={(text) => updateSegmentMinutes(index, text)}
                                        placeholder="—"
                                        placeholderTextColor={adminColors.textPlaceholder}
                                        keyboardType="number-pad"
                                        accessibilityLabel={`Travelling minutes from stop ${index + 1} to stop ${index + 2}`}
                                    />

                                    <Text style={styles.segmentUnitText}>
                                        min to stop {index + 2}
                                    </Text>
                                </View>
                            )}
                            </React.Fragment>
                        );
                    })}

                    <TouchableOpacity
                        style={styles.addStopButton}
                        onPress={addStop}
                        accessibilityRole="button"
                        accessibilityLabel="Add stop"
                    >
                        <Ionicons name="add" size={18} color={adminColors.primary} />
                        <Text style={styles.addStopText}>Add Stop</Text>
                    </TouchableOpacity>

                    {!!errors.stops && (
                        <View style={styles.errorRow}>
                            <Ionicons name="alert-circle" size={14} color={adminColors.danger} />
                            <Text style={styles.errorText}>{errors.stops}</Text>
                        </View>
                    )}

                    {cleanedStops.length >= 2 && (
                        <View style={styles.derivedBox}>
                            <Text style={styles.derivedText}>
                                <Text style={styles.derivedLabel}>Timings: </Text>
                                {timedGapCount === 0
                                    ? `None of the ${totalGapCount} gaps timed — passengers will see no journey duration.`
                                    : isFullyTimed
                                      ? `All ${totalGapCount} gaps timed · ${timedTotalMinutes} min end to end`
                                      : `${timedGapCount} of ${totalGapCount} gaps timed — a journey crossing an untimed gap shows no duration.`}
                            </Text>
                            <Text style={styles.derivedText}>
                                <Text style={styles.derivedLabel}>Start: </Text>
                                {startLocation}
                            </Text>
                            <Text style={styles.derivedText}>
                                <Text style={styles.derivedLabel}>End: </Text>
                                {endLocation}
                            </Text>
                        </View>
                    )}
                </View>

                {/* ---------------- Stop references ---------------- */}
                <Text style={styles.sectionTitle}>Stop References</Text>

                <View style={styles.card}>
                    <FormField
                        label="Start Stop ID"
                        value={startStopId}
                        onChangeText={setStartStopId}
                        placeholder="STOP-KADUWELA"
                        autoCapitalize="characters"
                        error={errors.startStopId}
                        icon="location-outline"
                    />
                    <FormField
                        label="End Stop ID"
                        value={endStopId}
                        onChangeText={setEndStopId}
                        placeholder="STOP-KOLLUPITIYA"
                        autoCapitalize="characters"
                        error={errors.endStopId}
                        icon="flag-outline"
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
                    accessibilityLabel={isEditing ? 'Save changes' : 'Create route'}
                    accessibilityState={{ disabled: isSubmitting }}
                >
                    {isSubmitting ? (
                        <View style={styles.submittingRow}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                            <Text style={styles.primaryButtonText}>  SAVING ROUTE…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryButtonText}>
                            {isEditing ? 'SAVE CHANGES' : 'CREATE ROUTE'}
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

function OptionButton({
    label,
    isSelected,
    onPress,
}: {
    label: string;
    isSelected: boolean;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
            onPress={onPress}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
        >
            <Ionicons
                name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                size={17}
                color={isSelected ? adminColors.primary : adminColors.textPlaceholder}
            />
            <Text style={[styles.optionButtonText, isSelected && styles.optionButtonTextSelected]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

interface FormFieldProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    error?: string;
    helper?: string;
    icon: keyof typeof Ionicons.glyphMap;
    keyboardType?: 'default' | 'decimal-pad';
    autoCapitalize?: 'none' | 'characters' | 'words';
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
                    editable={editable}
                    accessibilityLabel={label}
                    accessibilityState={{ disabled: !editable }}
                />
                {!editable && <Ionicons name="lock-closed" size={15} color={adminColors.textPlaceholder} />}
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
    fieldSpacer: { height: 16 },
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

    helperText: { fontSize: 12, color: adminColors.textMuted, marginTop: 6, lineHeight: 17 },
    errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    errorText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 5,
    },

    twoColumn: { flexDirection: 'row', gap: 12 },
    column: { flex: 1 },

    optionRow: { flexDirection: 'row', gap: 10 },
    optionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 50,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        backgroundColor: adminColors.surfaceMuted,
    },
    optionButtonSelected: {
        borderColor: adminColors.primary,
        backgroundColor: adminColors.primarySoft,
    },
    optionButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 8,
    },
    optionButtonTextSelected: { color: adminColors.textPrimary },

    stopsHelper: {
        fontSize: 12,
        color: adminColors.textMuted,
        lineHeight: 17,
        marginBottom: 14,
    },
    stopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    stopIndexBadge: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stopIndexText: { fontSize: 13, fontWeight: '800', color: adminColors.primary },
    stopInputGroup: { flex: 1, marginHorizontal: 10 },
    stopInput: {
        minHeight: 48,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingHorizontal: 12,
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textPrimary,
    },
    stopRoleText: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.primary,
        marginTop: 4,
        marginLeft: 2,
    },
    segmentRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    segmentConnectorColumn: { width: 30, alignItems: 'center' },
    segmentConnectorLine: {
        width: 2,
        height: 26,
        borderRadius: 1,
        backgroundColor: adminColors.border,
    },
    segmentInput: {
        width: 66,
        minHeight: 40,
        marginLeft: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingHorizontal: 10,
        textAlign: 'center',
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    segmentUnitText: {
        marginLeft: 10,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
    },

    stopControls: { flexDirection: 'row' },
    stopControlButton: {
        width: 32,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },

    addStopButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: adminColors.primary,
        backgroundColor: adminColors.primarySoft,
        marginTop: 6,
    },
    addStopText: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.primary,
        marginLeft: 6,
    },

    derivedBox: {
        marginTop: 14,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        padding: 12,
        gap: 4,
    },
    derivedText: { fontSize: 13, color: adminColors.textPrimary, fontWeight: '600' },
    derivedLabel: { color: adminColors.textMuted, fontWeight: '600' },

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