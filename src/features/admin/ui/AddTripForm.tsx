import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Bus } from '../../../entities/bus/model/types';
import { Route } from '../../../entities/route/model/types';
import { TripStatus } from '../../../entities/trip/model/types';
import { formatFriendlyTime, TimeOfDay, toApiTimeString } from '../../journey/utils/dateTime';
import { TravelTimePickerModal } from '../../journey/ui/TravelTimePickerModal';
import { createTrip, fetchBuses, fetchRoutes } from '../api/tripAdminApi';
import { AdminSelectModal, AdminSelectOption } from './AdminSelectModal';

type ActivePicker = 'route' | 'bus' | 'departure' | 'arrival' | null;

const DIRECTION_LABELS: Record<string, string> = {
    OUTBOUND: 'Outbound',
    RETURN: 'Return',
};

export const AddTripForm = () => {
    const [routes, setRoutes] = useState<Route[]>([]);
    const [buses, setBuses] = useState<Bus[]>([]);

    const [isLoadingData, setIsLoadingData] = useState(true);
    const [loadError, setLoadError] = useState('');

    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    // Buses are chosen by number plate in the UI; the busId is resolved from the
    // selected bus only when the request is built.
    const [selectedNumberPlate, setSelectedNumberPlate] = useState<string | null>(null);
    const [departureTime, setDepartureTime] = useState<TimeOfDay | null>(null);
    const [arrivalTime, setArrivalTime] = useState<TimeOfDay | null>(null);
    const [turnNumber, setTurnNumber] = useState('');
    const [status, setStatus] = useState<TripStatus>('ACTIVE');

    const [activePicker, setActivePicker] = useState<ActivePicker>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [createdTripId, setCreatedTripId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setIsLoadingData(true);
        setLoadError('');

        try {
            const [routeList, busList] = await Promise.all([fetchRoutes(), fetchBuses()]);
            // A trip can only reference an ACTIVE route and ACTIVE bus, so
            // anything else is filtered out rather than offered and rejected.
            setRoutes(routeList.filter((route) => route.status === 'ACTIVE'));
            setBuses(busList.filter((bus) => bus.status === 'ACTIVE'));
        } catch (error: any) {
            setLoadError(error?.message || 'Unable to load routes and buses.');
        } finally {
            setIsLoadingData(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const selectedRoute = useMemo(
        () => routes.find((route) => route.routeId === selectedRouteId) ?? null,
        [routes, selectedRouteId]
    );

    const selectedBus = useMemo(
        () => buses.find((bus) => bus.numberPlate === selectedNumberPlate) ?? null,
        [buses, selectedNumberPlate]
    );

    const routeOptions: AdminSelectOption[] = useMemo(
        () =>
            routes.map((route) => ({
                value: route.routeId,
                label: `${route.routeNumber} · ${route.routeName}`,
                description: `${route.startLocation} → ${route.endLocation}${
                    route.direction ? `  ·  ${DIRECTION_LABELS[route.direction] ?? route.direction}` : ''
                }`,
            })),
        [routes]
    );

    const busOptions: AdminSelectOption[] = useMemo(
        () =>
            buses.map((bus) => ({
                value: bus.numberPlate,
                label: bus.numberPlate,
                description: [bus.busModel, bus.manufacturer].filter(Boolean).join(' · '),
            })),
        [buses]
    );

    const validate = (): boolean => {
        const nextErrors: Record<string, string> = {};

        if (!selectedRoute) nextErrors.route = 'Select a route for this trip.';
        if (!selectedBus) nextErrors.bus = 'Select the bus operating this trip.';
        if (!departureTime) nextErrors.departureTime = 'Select a departure time.';
        if (!arrivalTime) nextErrors.arrivalTime = 'Select an estimated arrival time.';

        const parsedTurn = Number(turnNumber);
        if (!turnNumber.trim()) {
            nextErrors.turnNumber = 'Enter the turn number for this trip.';
        } else if (!Number.isInteger(parsedTurn) || parsedTurn < 1) {
            nextErrors.turnNumber = 'Turn number must be a whole number of 1 or more.';
        }

        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    };

    const handleSubmit = async () => {
        setSubmitError('');

        if (!validate() || !selectedRoute || !selectedBus || !departureTime || !arrivalTime) {
            return;
        }

        setIsSubmitting(true);

        try {
            const trip = await createTrip({
                routeId: selectedRoute.routeId,
                // Resolve the chosen number plate back to the bus reference the
                // backend expects — busId never appears in the UI itself.
                busId: selectedBus.busId,
                departureTime: toApiTimeString(departureTime),
                estimatedArrivalTime: toApiTimeString(arrivalTime),
                turnNumber: Number(turnNumber),
                status,
            });

            setCreatedTripId(trip.tripId);
        } catch (error: any) {
            setSubmitError(error?.message || 'Unable to create the trip. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForAnotherTrip = () => {
        setCreatedTripId(null);
        setSelectedNumberPlate(null);
        setDepartureTime(null);
        setArrivalTime(null);
        setTurnNumber('');
        setStatus('ACTIVE');
        setErrors({});
        setSubmitError('');
    };

    // ---------------------------------------------------------------
    // Success state
    // ---------------------------------------------------------------
    if (createdTripId) {
        return (
            <View style={styles.container}>
                <AdminHeader title="Add Trip" subtitle="Schedule a bus turn" />

                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    <View style={styles.successCard} accessibilityLiveRegion="polite">
                        <View style={styles.successIcon}>
                            <Ionicons name="checkmark-circle" size={44} color="#388E3C" />
                        </View>

                        <Text style={styles.successTitle}>Trip created</Text>
                        <Text style={styles.successDescription}>
                            The trip has been added to the schedule and is now available for journey searches.
                        </Text>

                        <View style={styles.successSummary}>
                            <SummaryRow
                                label="Route"
                                value={selectedRoute ? `${selectedRoute.routeNumber} · ${selectedRoute.routeName}` : '—'}
                            />
                            <SummaryRow label="Bus" value={selectedBus?.numberPlate ?? '—'} />
                            <SummaryRow
                                label="Departure"
                                value={departureTime ? formatFriendlyTime(departureTime) : '—'}
                            />
                        </View>

                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={resetForAnotherTrip}
                            accessibilityRole="button"
                            accessibilityLabel="Add another trip"
                        >
                            <Text style={styles.primaryButtonText}>ADD ANOTHER TRIP</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={() => router.back()}
                            accessibilityRole="button"
                            accessibilityLabel="Back to dashboard"
                        >
                            <Text style={styles.secondaryButtonText}>Back to Dashboard</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </View>
        );
    }

    // ---------------------------------------------------------------
    // Loading state
    // ---------------------------------------------------------------
    if (isLoadingData) {
        return (
            <View style={styles.container}>
                <AdminHeader title="Add Trip" subtitle="Schedule a bus turn" />
                <View style={styles.centeredState} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color="#1976D2" />
                    <Text style={styles.centeredStateText}>Loading routes and buses…</Text>
                </View>
            </View>
        );
    }

    // ---------------------------------------------------------------
    // Load-failure state
    // ---------------------------------------------------------------
    if (loadError) {
        return (
            <View style={styles.container}>
                <AdminHeader title="Add Trip" subtitle="Schedule a bus turn" />
                <View style={styles.centeredState} accessibilityLiveRegion="assertive">
                    <Ionicons name="cloud-offline-outline" size={40} color="#D32F2F" />
                    <Text style={styles.centeredStateTitle}>Couldn&apos;t load data</Text>
                    <Text style={styles.centeredStateText}>{loadError}</Text>

                    <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={loadData}
                        accessibilityRole="button"
                        accessibilityLabel="Try again"
                    >
                        <Text style={styles.primaryButtonText}>TRY AGAIN</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const isSummaryReady = !!selectedRoute && !!selectedBus && !!departureTime && !!arrivalTime;

    return (
        <View style={styles.container}>
            <AdminHeader title="Add Trip" subtitle="Schedule a bus turn" />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ---------------- Route & Bus ---------------- */}
                <Text style={styles.sectionTitle}>Route & Bus</Text>

                <View style={styles.card}>
                    <FieldLabel text="Route" />
                    <SelectField
                        icon="navigate-outline"
                        placeholder="Select a route"
                        value={selectedRoute ? `${selectedRoute.routeNumber} · ${selectedRoute.routeName}` : null}
                        secondary={
                            selectedRoute ? `${selectedRoute.startLocation} → ${selectedRoute.endLocation}` : undefined
                        }
                        hasError={!!errors.route}
                        onPress={() => setActivePicker('route')}
                        accessibilityLabel="Route"
                    />
                    <FieldError message={errors.route} />

                    {/* Direction comes from the selected route, so it is shown as
                        context rather than duplicated as an editable field. */}
                    {!!selectedRoute?.direction && (
                        <View style={styles.inlineNote}>
                            <Ionicons name="git-compare-outline" size={15} color="#1976D2" />
                            <Text style={styles.inlineNoteText}>
                                Direction: {DIRECTION_LABELS[selectedRoute.direction] ?? selectedRoute.direction}
                                {'  '}(set by the route)
                            </Text>
                        </View>
                    )}

                    <View style={styles.fieldSpacer} />

                    <FieldLabel text="Bus" />
                    <SelectField
                        icon="bus-outline"
                        placeholder="Select a bus by number plate"
                        value={selectedBus?.numberPlate ?? null}
                        secondary={
                            selectedBus
                                ? [selectedBus.busModel, selectedBus.manufacturer].filter(Boolean).join(' · ')
                                : undefined
                        }
                        hasError={!!errors.bus}
                        onPress={() => setActivePicker('bus')}
                        accessibilityLabel="Bus number plate"
                    />
                    <FieldError message={errors.bus} />
                </View>

                {/* ---------------- Schedule ---------------- */}
                <Text style={styles.sectionTitle}>Schedule</Text>

                <View style={styles.card}>
                    <View style={styles.timeRow}>
                        <View style={styles.timeColumn}>
                            <FieldLabel text="Departure Time" />
                            <SelectField
                                icon="time-outline"
                                placeholder="Select"
                                value={departureTime ? formatFriendlyTime(departureTime) : null}
                                hasError={!!errors.departureTime}
                                onPress={() => setActivePicker('departure')}
                                accessibilityLabel="Departure time"
                            />
                        </View>

                        <View style={styles.timeColumn}>
                            <FieldLabel text="Est. Arrival Time" />
                            <SelectField
                                icon="flag-outline"
                                placeholder="Select"
                                value={arrivalTime ? formatFriendlyTime(arrivalTime) : null}
                                hasError={!!errors.arrivalTime}
                                onPress={() => setActivePicker('arrival')}
                                accessibilityLabel="Estimated arrival time"
                            />
                        </View>
                    </View>
                    <FieldError message={errors.departureTime || errors.arrivalTime} />

                    <View style={styles.fieldSpacer} />

                    <FieldLabel text="Turn Number" />
                    <View style={[styles.inputWrapper, !!errors.turnNumber && styles.inputWrapperError]}>
                        <Ionicons name="repeat-outline" size={20} color="#7A8793" style={styles.inputIcon} />
                        <TextInput
                            style={styles.input}
                            placeholder="e.g. 1"
                            placeholderTextColor="#9AA7B2"
                            keyboardType="number-pad"
                            value={turnNumber}
                            onChangeText={setTurnNumber}
                            accessibilityLabel="Turn number"
                            accessibilityHint="Which turn of the day this trip is for this bus"
                        />
                    </View>
                    <Text style={styles.helperText}>
                        The order of this trip in the bus&apos;s daily turns (1 = first turn).
                    </Text>
                    <FieldError message={errors.turnNumber} />
                </View>

                {/* ---------------- Status ---------------- */}
                <Text style={styles.sectionTitle}>Status</Text>

                <View style={styles.card}>
                    <View style={styles.statusRow}>
                        {(['ACTIVE', 'INACTIVE'] as TripStatus[]).map((option) => {
                            const isSelected = status === option;

                            return (
                                <TouchableOpacity
                                    key={option}
                                    style={[styles.statusOption, isSelected && styles.statusOptionSelected]}
                                    onPress={() => setStatus(option)}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: isSelected }}
                                    accessibilityLabel={option === 'ACTIVE' ? 'Active' : 'Inactive'}
                                >
                                    <Ionicons
                                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                                        size={19}
                                        color={isSelected ? '#1976D2' : '#9AA7B2'}
                                    />
                                    <Text style={[styles.statusText, isSelected && styles.statusTextSelected]}>
                                        {option === 'ACTIVE' ? 'Active' : 'Inactive'}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <Text style={styles.helperText}>
                        Only active trips appear in passenger journey searches.
                    </Text>
                </View>

                {/* ---------------- Review ---------------- */}
                <Text style={styles.sectionTitle}>Review</Text>

                <View style={[styles.card, styles.summaryCard]}>
                    {isSummaryReady ? (
                        <>
                            <SummaryRow
                                label="Route"
                                value={`${selectedRoute!.routeNumber} · ${selectedRoute!.routeName}`}
                            />
                            {!!selectedRoute?.direction && (
                                <SummaryRow
                                    label="Direction"
                                    value={DIRECTION_LABELS[selectedRoute.direction] ?? selectedRoute.direction}
                                />
                            )}
                            <SummaryRow label="Bus" value={selectedBus!.numberPlate} />
                            <SummaryRow label="Departure" value={formatFriendlyTime(departureTime!)} />
                            <SummaryRow label="Est. arrival" value={formatFriendlyTime(arrivalTime!)} />
                            <SummaryRow label="Status" value={status === 'ACTIVE' ? 'Active' : 'Inactive'} isLast />
                        </>
                    ) : (
                        <View style={styles.summaryPlaceholder}>
                            <Ionicons name="clipboard-outline" size={22} color="#9AA7B2" />
                            <Text style={styles.summaryPlaceholderText}>
                                Choose a route, bus and times to review the trip before creating it.
                            </Text>
                        </View>
                    )}
                </View>

                {!!submitError && (
                    <View style={styles.submitErrorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                        <Text style={styles.submitErrorText}>{submitError}</Text>
                    </View>
                )}

                <TouchableOpacity
                    style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Create trip"
                    accessibilityState={{ disabled: isSubmitting }}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                    ) : (
                        <Text style={styles.primaryButtonText}>CREATE TRIP</Text>
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

            {/* ---------------- Pickers ---------------- */}
            <AdminSelectModal
                visible={activePicker === 'route'}
                title="Select Route"
                options={routeOptions}
                selectedValue={selectedRouteId}
                emptyMessage="No active routes are available. Create a route first."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    setSelectedRouteId(value);
                    setActivePicker(null);
                }}
            />

            <AdminSelectModal
                visible={activePicker === 'bus'}
                title="Select Bus"
                options={busOptions}
                selectedValue={selectedNumberPlate}
                emptyMessage="No active buses are available. Add a bus first."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    setSelectedNumberPlate(value);
                    setActivePicker(null);
                }}
            />

            <TravelTimePickerModal
                visible={activePicker === 'departure'}
                title="Select Departure Time"
                selectedTime={departureTime}
                onClose={() => setActivePicker(null)}
                onConfirm={(time) => {
                    setDepartureTime(time);
                    setActivePicker(null);
                }}
            />

            <TravelTimePickerModal
                visible={activePicker === 'arrival'}
                title="Select Arrival Time"
                selectedTime={arrivalTime}
                onClose={() => setActivePicker(null)}
                onConfirm={(time) => {
                    setArrivalTime(time);
                    setActivePicker(null);
                }}
            />
        </View>
    );
};

// -------------------------------------------------------------------
// Small presentational helpers
// -------------------------------------------------------------------

function AdminHeader({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <View style={styles.header}>
            <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Go back"
            >
                <Ionicons name="arrow-back" size={22} color="#1A2530" />
            </TouchableOpacity>

            <View style={styles.headerTextGroup}>
                <Text style={styles.headerTitle} accessibilityRole="header">
                    {title}
                </Text>
                <Text style={styles.headerSubtitle}>{subtitle}</Text>
            </View>
        </View>
    );
}

function FieldLabel({ text }: { text: string }) {
    return <Text style={styles.fieldLabel}>{text}</Text>;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;

    return (
        <View style={styles.fieldErrorRow}>
            <Ionicons name="alert-circle" size={14} color="#D32F2F" />
            <Text style={styles.fieldErrorText}>{message}</Text>
        </View>
    );
}

interface SelectFieldProps {
    icon: keyof typeof Ionicons.glyphMap;
    placeholder: string;
    value: string | null;
    secondary?: string;
    hasError?: boolean;
    onPress: () => void;
    accessibilityLabel: string;
}

function SelectField({
    icon,
    placeholder,
    value,
    secondary,
    hasError,
    onPress,
    accessibilityLabel,
}: SelectFieldProps) {
    return (
        <TouchableOpacity
            style={[styles.selectField, hasError && styles.inputWrapperError]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{ text: value ?? 'Not selected' }}
            accessibilityHint="Double tap to choose an option"
        >
            <Ionicons name={icon} size={20} color={value ? '#1976D2' : '#7A8793'} style={styles.inputIcon} />

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

            <Ionicons name="chevron-down" size={18} color="#7A8793" />
        </TouchableOpacity>
    );
}

function SummaryRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
    return (
        <View style={[styles.summaryRow, isLast && styles.summaryRowLast]}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text style={styles.summaryValue} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 50,
        paddingBottom: 16,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 3,
    },
    backButton: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    headerTextGroup: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: '#1A2530',
    },
    headerSubtitle: {
        marginTop: 3,
        fontSize: 13,
        color: '#7A8793',
    },

    content: {
        padding: 20,
        paddingBottom: 40,
    },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 12,
        marginTop: 8,
    },

    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },

    fieldLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 8,
    },
    fieldSpacer: {
        height: 18,
    },

    selectField: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        borderWidth: 1,
        borderColor: '#E4EAF1',
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        paddingHorizontal: 12,
    },
    selectTextGroup: {
        flex: 1,
    },
    selectValue: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1A2530',
    },
    selectPlaceholder: {
        fontWeight: '400',
        color: '#9AA7B2',
    },
    selectSecondary: {
        fontSize: 12,
        color: '#71808D',
        marginTop: 2,
    },

    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        borderWidth: 1,
        borderColor: '#E4EAF1',
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        paddingHorizontal: 12,
    },
    inputWrapperError: {
        borderColor: '#D32F2F',
        backgroundColor: '#FEF4F4',
    },
    inputIcon: {
        marginRight: 10,
    },
    input: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: '#1A2530',
        paddingVertical: 12,
    },

    helperText: {
        fontSize: 12,
        color: '#7A8793',
        marginTop: 6,
        lineHeight: 17,
    },

    fieldErrorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    fieldErrorText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#D32F2F',
        marginLeft: 5,
        flex: 1,
    },

    inlineNote: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
        backgroundColor: '#EEF5FF',
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    inlineNoteText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#1976D2',
        marginLeft: 6,
        flex: 1,
    },

    timeRow: {
        flexDirection: 'row',
        gap: 12,
    },
    timeColumn: {
        flex: 1,
    },

    statusRow: {
        flexDirection: 'row',
        gap: 10,
    },
    statusOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        borderWidth: 1,
        borderColor: '#E4EAF1',
        borderRadius: 10,
        paddingHorizontal: 12,
        backgroundColor: '#F8FAFC',
    },
    statusOptionSelected: {
        borderColor: '#1976D2',
        backgroundColor: '#EEF5FF',
    },
    statusText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#71808D',
        marginLeft: 8,
    },
    statusTextSelected: {
        color: '#1A2530',
    },

    summaryCard: {
        borderWidth: 1,
        borderColor: '#E4EAF1',
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    summaryRowLast: {
        borderBottomWidth: 0,
    },
    summaryLabel: {
        fontSize: 13,
        color: '#71808D',
        marginRight: 12,
    },
    summaryValue: {
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
        color: '#1A2530',
        textAlign: 'right',
    },
    summaryPlaceholder: {
        alignItems: 'center',
        paddingVertical: 14,
    },
    summaryPlaceholderText: {
        fontSize: 13,
        color: '#7A8793',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 19,
        maxWidth: 280,
    },

    submitErrorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF4F4',
        borderWidth: 1,
        borderColor: '#F7D4D4',
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
        marginTop: 4,
    },
    submitErrorText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: '#D32F2F',
        marginLeft: 8,
        lineHeight: 18,
    },

    primaryButton: {
        backgroundColor: '#1976D2',
        minHeight: 54,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
        elevation: 2,
        shadowColor: '#1976D2',
        shadowOpacity: 0.25,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
    },
    primaryButtonDisabled: {
        backgroundColor: '#9AA7B2',
        elevation: 0,
        shadowOpacity: 0,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: 0.6,
    },

    secondaryButton: {
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 10,
    },
    secondaryButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#71808D',
    },

    centeredState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 30,
    },
    centeredStateTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1A2530',
        marginTop: 12,
        marginBottom: 6,
    },
    centeredStateText: {
        fontSize: 14,
        color: '#71808D',
        textAlign: 'center',
        marginTop: 10,
        lineHeight: 20,
    },

    successCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 22,
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        marginTop: 10,
    },
    successIcon: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#EEF8EF',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    successTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 6,
    },
    successDescription: {
        fontSize: 14,
        color: '#71808D',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 18,
    },
    successSummary: {
        alignSelf: 'stretch',
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 4,
        marginBottom: 18,
    },
});
