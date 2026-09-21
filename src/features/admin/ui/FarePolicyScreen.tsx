import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { FarePolicy } from '../../../entities/booking/model/types';
import { calculateFare, DEFAULT_FARE_POLICY } from '../../../shared/utils/fare';
import { getFarePolicy, resetFarePolicyToDefaults, updateFarePolicy } from '../api/fareAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { adminColors, adminShadow } from './adminTheme';

export function FarePolicyScreen() {
    const [policy, setPolicy] = useState<FarePolicy>(DEFAULT_FARE_POLICY);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Form inputs as strings for smooth typing
    const [baseFareInput, setBaseFareInput] = useState('30');
    const [baseDistanceInput, setBaseDistanceInput] = useState('2');
    const [ratePerKmInput, setRatePerKmInput] = useState('8.5');
    const [accessibilityDiscountInput, setAccessibilityDiscountInput] = useState('20');
    const [elderlyDiscountInput, setElderlyDiscountInput] = useState('15');
    const [assistanceSurchargeInput, setAssistanceSurchargeInput] = useState('50');
    const [guardianCompanionRateInput, setGuardianCompanionRateInput] = useState('100');

    // Simulator states
    const [simDistanceInput, setSimDistanceInput] = useState('10');
    const [simAccessibility, setSimAccessibility] = useState(false);
    const [simElderly, setSimElderly] = useState(false);
    const [simAssistance, setSimAssistance] = useState(true);
    const [simWheelchairPaired, setSimWheelchairPaired] = useState(false);

    const loadPolicy = useCallback(async (isRefresh = false) => {
        if (isRefresh) setIsRefreshing(true);
        else setIsLoading(true);
        setErrorMessage('');
        setSuccessMessage('');

        try {
            const fetched = await getFarePolicy();
            setPolicy(fetched);
            setBaseFareInput(String(fetched.baseFare ?? 30));
            setBaseDistanceInput(String(fetched.baseDistanceKm ?? 2));
            setRatePerKmInput(String(fetched.ratePerKm ?? 8.5));
            setAccessibilityDiscountInput(String(fetched.accessibilityDiscountPercent ?? 20));
            setElderlyDiscountInput(String(fetched.elderlyDiscountPercent ?? 15));
            setAssistanceSurchargeInput(String(fetched.assistanceSurchargeLkr ?? 50));
            setGuardianCompanionRateInput(String(fetched.guardianCompanionRatePercent ?? 100));
        } catch (err: any) {
            setErrorMessage(err.message || 'Unable to load fare policy from server.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadPolicy();
    }, [loadPolicy]);

    // Live preview policy object constructed from current inputs
    const liveDraftPolicy: FarePolicy = useMemo(() => {
        const bFare = parseFloat(baseFareInput);
        const bDist = parseFloat(baseDistanceInput);
        const rKm = parseFloat(ratePerKmInput);
        const accDisc = parseFloat(accessibilityDiscountInput);
        const eldDisc = parseFloat(elderlyDiscountInput);
        const astFee = parseFloat(assistanceSurchargeInput);
        const guardRate = parseFloat(guardianCompanionRateInput);

        return {
            id: 'default',
            currency: 'LKR',
            baseFare: !isNaN(bFare) && bFare >= 0 ? bFare : DEFAULT_FARE_POLICY.baseFare,
            baseDistanceKm: !isNaN(bDist) && bDist >= 0 ? bDist : DEFAULT_FARE_POLICY.baseDistanceKm,
            ratePerKm: !isNaN(rKm) && rKm >= 0 ? rKm : DEFAULT_FARE_POLICY.ratePerKm,
            accessibilityDiscountPercent: !isNaN(accDisc) && accDisc >= 0 ? accDisc : DEFAULT_FARE_POLICY.accessibilityDiscountPercent,
            elderlyDiscountPercent: !isNaN(eldDisc) && eldDisc >= 0 ? eldDisc : DEFAULT_FARE_POLICY.elderlyDiscountPercent,
            assistanceSurchargeLkr: !isNaN(astFee) && astFee >= 0 ? astFee : DEFAULT_FARE_POLICY.assistanceSurchargeLkr,
            guardianCompanionRatePercent: !isNaN(guardRate) && guardRate >= 0 ? guardRate : DEFAULT_FARE_POLICY.guardianCompanionRatePercent,
            updatedAt: policy.updatedAt,
            updatedBy: policy.updatedBy,
        };
    }, [
        baseFareInput,
        baseDistanceInput,
        ratePerKmInput,
        accessibilityDiscountInput,
        elderlyDiscountInput,
        assistanceSurchargeInput,
        guardianCompanionRateInput,
        policy.updatedAt,
        policy.updatedBy,
    ]);

    // Simulated fare result
    const simulatedFare = useMemo(() => {
        const dist = parseFloat(simDistanceInput) || 0;
        return calculateFare(dist, true, {
            policy: liveDraftPolicy,
            isAccessibilityEligible: simAccessibility,
            isElderlyEligible: simElderly,
            hasAssistanceRequested: simAssistance,
            isWheelchairPaired: simWheelchairPaired,
        });
    }, [simDistanceInput, liveDraftPolicy, simAccessibility, simElderly, simAssistance, simWheelchairPaired]);

    async function handleSave() {
        const bFare = parseFloat(baseFareInput);
        const bDist = parseFloat(baseDistanceInput);
        const rKm = parseFloat(ratePerKmInput);
        const accDisc = parseFloat(accessibilityDiscountInput);
        const eldDisc = parseFloat(elderlyDiscountInput);
        const astFee = parseFloat(assistanceSurchargeInput);
        const guardRate = parseFloat(guardianCompanionRateInput);

        if (isNaN(bFare) || bFare < 0) {
            Alert.alert('Validation Error', 'Please enter a valid positive base fare (LKR).');
            return;
        }
        if (isNaN(bDist) || bDist < 0) {
            Alert.alert('Validation Error', 'Please enter a valid base distance (km).');
            return;
        }
        if (isNaN(rKm) || rKm < 0) {
            Alert.alert('Validation Error', 'Please enter a valid rate per km (LKR).');
            return;
        }
        if (isNaN(accDisc) || accDisc < 0 || accDisc > 100) {
            Alert.alert('Validation Error', 'Accessibility discount must be between 0% and 100%.');
            return;
        }
        if (isNaN(eldDisc) || eldDisc < 0 || eldDisc > 100) {
            Alert.alert('Validation Error', 'Senior citizen discount must be between 0% and 100%.');
            return;
        }
        if (isNaN(astFee) || astFee < 0) {
            Alert.alert('Validation Error', 'Assistance surcharge must be a positive amount (LKR).');
            return;
        }
        if (isNaN(guardRate) || guardRate < 0 || guardRate > 200) {
            Alert.alert('Validation Error', 'Guardian companion rate must be between 0% and 200%.');
            return;
        }

        setIsSaving(true);
        setErrorMessage('');
        setSuccessMessage('');

        try {
            const updated = await updateFarePolicy({
                baseFare: bFare,
                baseDistanceKm: bDist,
                ratePerKm: rKm,
                accessibilityDiscountPercent: accDisc,
                elderlyDiscountPercent: eldDisc,
                assistanceSurchargeLkr: astFee,
                guardianCompanionRatePercent: guardRate,
                updatedBy: 'Admin (MoveAble Portal)',
            });

            setPolicy(updated);
            setSuccessMessage('Fare policy and pricing rules updated successfully!');
            setTimeout(() => setSuccessMessage(''), 4000);
        } catch (err: any) {
            setErrorMessage(err.message || 'Failed to update fare policy.');
        } finally {
            setIsSaving(false);
        }
    }

    async function handleResetToDefaults() {
        Alert.alert(
            'Reset to Baseline Defaults',
            'Are you sure you want to reset all transit fares and discounts to National Transport Commission (NTC) baseline defaults?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset Defaults',
                    style: 'destructive',
                    onPress: async () => {
                        setIsSaving(true);
                        setErrorMessage('');
                        try {
                            const reset = await resetFarePolicyToDefaults();
                            setPolicy(reset);
                            setBaseFareInput(String(reset.baseFare));
                            setBaseDistanceInput(String(reset.baseDistanceKm));
                            setRatePerKmInput(String(reset.ratePerKm));
                            setAccessibilityDiscountInput(String(reset.accessibilityDiscountPercent));
                            setElderlyDiscountInput(String(reset.elderlyDiscountPercent));
                            setAssistanceSurchargeInput(String(reset.assistanceSurchargeLkr));
                            setGuardianCompanionRateInput(String(reset.guardianCompanionRatePercent ?? 100));
                            setSuccessMessage('Fare policy reset to baseline standards.');
                            setTimeout(() => setSuccessMessage(''), 4000);
                        } catch (err: any) {
                            setErrorMessage(err.message || 'Failed to reset fare policy.');
                        } finally {
                            setIsSaving(false);
                        }
                    },
                },
            ]
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <AdminScreenHeader
                title="Fare Policy & Pricing"
                subtitle="Configure network fares, concessions, and conductor assistance fees"
            />

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => loadPolicy(true)} />}
            >
                {/* Status Banners */}
                {!!errorMessage && (
                    <View style={styles.errorBanner}>
                        <Ionicons name="alert-circle" size={20} color={adminColors.danger} />
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                )}

                {!!successMessage && (
                    <View style={styles.successBanner}>
                        <Ionicons name="checkmark-circle" size={20} color={adminColors.success} />
                        <Text style={styles.successText}>{successMessage}</Text>
                    </View>
                )}

                {isLoading ? (
                    <View style={styles.centerLoading}>
                        <ActivityIndicator size="large" color={adminColors.primary} />
                        <Text style={styles.loadingText}>Loading current fare policy...</Text>
                    </View>
                ) : (
                    <>
                        {/* Audit Info Card */}
                        <View style={styles.auditCard}>
                            <View style={styles.auditIconRow}>
                                <Ionicons name="shield-checkmark" size={18} color={adminColors.primary} />
                                <Text style={styles.auditTitle}>Active Network Fare Configuration</Text>
                            </View>
                            <Text style={styles.auditSubtitle}>
                                Last modified: {policy.updatedAt ? new Date(policy.updatedAt).toLocaleString() : 'System Default'}
                                {policy.updatedBy ? ` · By ${policy.updatedBy}` : ''}
                            </Text>
                        </View>

                        {/* Section 1: Standard Distance Rates */}
                        <View style={styles.card}>
                            <View style={styles.cardHeader}>
                                <View style={styles.iconCircleBlue}>
                                    <Ionicons name="bus" size={20} color={adminColors.primary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardHeading}>Standard Transit Base Rates</Text>
                                    <Text style={styles.cardSubheading}>
                                        Standard distance-based fare formula applied to all routes
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.inputRow}>
                                <View style={styles.inputCol}>
                                    <Text style={styles.inputLabel}>Minimum Base Fare (LKR)</Text>
                                    <View style={styles.inputWrapper}>
                                        <Text style={styles.inputPrefix}>Rs.</Text>
                                        <TextInput
                                            style={styles.textInput}
                                            value={baseFareInput}
                                            onChangeText={setBaseFareInput}
                                            keyboardType="numeric"
                                            placeholder="30.00"
                                            placeholderTextColor={adminColors.textPlaceholder}
                                        />
                                    </View>
                                    <Text style={styles.helperText}>Flat entry fare for first stage</Text>
                                </View>

                                <View style={styles.inputCol}>
                                    <Text style={styles.inputLabel}>Base Distance (KM)</Text>
                                    <View style={styles.inputWrapper}>
                                        <TextInput
                                            style={styles.textInput}
                                            value={baseDistanceInput}
                                            onChangeText={setBaseDistanceInput}
                                            keyboardType="numeric"
                                            placeholder="2.0"
                                            placeholderTextColor={adminColors.textPlaceholder}
                                        />
                                        <Text style={styles.inputSuffix}>km</Text>
                                    </View>
                                    <Text style={styles.helperText}>Covered by minimum fare</Text>
                                </View>
                            </View>

                            <View style={{ marginTop: 12 }}>
                                <Text style={styles.inputLabel}>Rate Per Additional KM (LKR/km)</Text>
                                <View style={styles.inputWrapper}>
                                    <Text style={styles.inputPrefix}>Rs.</Text>
                                    <TextInput
                                        style={styles.textInput}
                                        value={ratePerKmInput}
                                        onChangeText={setRatePerKmInput}
                                        keyboardType="numeric"
                                        placeholder="8.50"
                                        placeholderTextColor={adminColors.textPlaceholder}
                                    />
                                    <Text style={styles.inputSuffix}>/ km</Text>
                                </View>
                                <Text style={styles.helperText}>
                                    Charged incrementally for each kilometer beyond {baseDistanceInput || '2'} km
                                </Text>
                            </View>
                        </View>

                        {/* Section 2: Concession Discounts */}
                        <View style={styles.card}>
                            <View style={styles.cardHeader}>
                                <View style={styles.iconCircleGreen}>
                                    <Ionicons name="accessibility" size={20} color={adminColors.success} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardHeading}>Concessions & Community Discounts</Text>
                                    <Text style={styles.cardSubheading}>
                                        Discount percentages for verified accessibility and senior commuters
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.inputRow}>
                                <View style={styles.inputCol}>
                                    <Text style={styles.inputLabel}>Accessibility Discount (%)</Text>
                                    <View style={styles.inputWrapper}>
                                        <TextInput
                                            style={styles.textInput}
                                            value={accessibilityDiscountInput}
                                            onChangeText={setAccessibilityDiscountInput}
                                            keyboardType="numeric"
                                            placeholder="20"
                                            placeholderTextColor={adminColors.textPlaceholder}
                                        />
                                        <Text style={styles.inputSuffix}>%</Text>
                                    </View>
                                    <Text style={styles.helperText}>For Low Vision, Hearing & Mobility needs</Text>
                                </View>

                                <View style={styles.inputCol}>
                                    <Text style={styles.inputLabel}>Senior Citizen 60+ Discount (%)</Text>
                                    <View style={styles.inputWrapper}>
                                        <TextInput
                                            style={styles.textInput}
                                            value={elderlyDiscountInput}
                                            onChangeText={setElderlyDiscountInput}
                                            keyboardType="numeric"
                                            placeholder="15"
                                            placeholderTextColor={adminColors.textPlaceholder}
                                        />
                                        <Text style={styles.inputSuffix}>%</Text>
                                    </View>
                                    <Text style={styles.helperText}>For elderly passengers aged 60+</Text>
                                </View>
                            </View>
                        </View>

                        {/* Section 3: Conductor Assistance Surcharge */}
                        <View style={styles.card}>
                            <View style={styles.cardHeader}>
                                <View style={styles.iconCirclePurple}>
                                    <Ionicons name="people" size={20} color={adminColors.purple} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardHeading}>Conductor Dedicated Assistance Surcharge</Text>
                                    <Text style={styles.cardSubheading}>
                                        Fee compensating crew for personal boarding, wheelchair, or walking support
                                    </Text>
                                </View>
                            </View>

                            <View>
                                <Text style={styles.inputLabel}>Assistance Service Fee (LKR)</Text>
                                <View style={styles.inputWrapper}>
                                    <Text style={styles.inputPrefix}>Rs.</Text>
                                    <TextInput
                                        style={styles.textInput}
                                        value={assistanceSurchargeInput}
                                        onChangeText={setAssistanceSurchargeInput}
                                        keyboardType="numeric"
                                        placeholder="50.00"
                                        placeholderTextColor={adminColors.textPlaceholder}
                                    />
                                </View>
                                <Text style={styles.helperText}>
                                    Added when passenger requests Wheelchair Ramp, Boarding, or Walking Assistance
                                </Text>
                            </View>
                        </View>

                        {/* Section 4: Wheelchair Companion & Guardian Seat Policy */}
                        <View style={styles.card}>
                            <View style={styles.cardHeader}>
                                <View style={styles.iconCircleCyan}>
                                    <Ionicons name="people-circle" size={22} color={adminColors.accent} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardHeading}>Wheelchair Companion / Guardian Seat Pricing</Text>
                                    <Text style={styles.cardSubheading}>
                                        Pricing for the companion seat (G1) auto-reserved alongside wheelchair bay (W1)
                                    </Text>
                                </View>
                            </View>

                            <View>
                                <Text style={styles.inputLabel}>Guardian Seat Rate (% of Journey Fare)</Text>
                                <View style={styles.inputWrapper}>
                                    <TextInput
                                        style={styles.textInput}
                                        value={guardianCompanionRateInput}
                                        onChangeText={setGuardianCompanionRateInput}
                                        keyboardType="numeric"
                                        placeholder="100"
                                        placeholderTextColor={adminColors.textPlaceholder}
                                    />
                                    <Text style={styles.inputSuffix}>%</Text>
                                </View>
                                <Text style={styles.helperText}>
                                    Default 100% (Standard Ticket Price). Set lower (e.g., 50%) for subsidized companion transit.
                                </Text>
                            </View>
                        </View>

                        {/* Section 5: Interactive Live Fare Simulator */}
                        <View style={styles.simulatorCard}>
                            <View style={styles.cardHeader}>
                                <View style={styles.iconCircleCyan}>
                                    <Ionicons name="calculator" size={20} color={adminColors.accent} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardHeading}>Interactive Real-Time Fare Simulator</Text>
                                    <Text style={styles.cardSubheading}>
                                        Test-drive your pricing rules live before saving
                                    </Text>
                                </View>
                            </View>

                            {/* Simulator Controls */}
                            <View style={{ marginBottom: 16 }}>
                                <Text style={styles.inputLabel}>Journey Distance to Test (km):</Text>
                                <View style={styles.inputWrapper}>
                                    <TextInput
                                        style={styles.textInput}
                                        value={simDistanceInput}
                                        onChangeText={setSimDistanceInput}
                                        keyboardType="numeric"
                                        placeholder="10"
                                    />
                                    <Text style={styles.inputSuffix}>km</Text>
                                </View>
                            </View>

                            {/* Simulator Filter Toggles */}
                            <Text style={styles.inputLabel}>Passenger Scenario:</Text>
                            <View style={styles.toggleRow}>
                                <TouchableOpacity
                                    style={[styles.simToggleChip, simAccessibility && styles.simToggleChipActive]}
                                    onPress={() => {
                                        setSimAccessibility(!simAccessibility);
                                        if (!simAccessibility) setSimElderly(false);
                                    }}
                                >
                                    <Ionicons
                                        name={simAccessibility ? 'checkbox' : 'square-outline'}
                                        size={18}
                                        color={simAccessibility ? '#FFFFFF' : adminColors.textSecondary}
                                    />
                                    <Text style={[styles.simToggleText, simAccessibility && styles.simToggleTextActive]}>
                                        Accessibility Profile (-{accessibilityDiscountInput}%)
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.simToggleChip, simElderly && styles.simToggleChipActive]}
                                    onPress={() => {
                                        setSimElderly(!simElderly);
                                        if (!simElderly) setSimAccessibility(false);
                                    }}
                                >
                                    <Ionicons
                                        name={simElderly ? 'checkbox' : 'square-outline'}
                                        size={18}
                                        color={simElderly ? '#FFFFFF' : adminColors.textSecondary}
                                    />
                                    <Text style={[styles.simToggleText, simElderly && styles.simToggleTextActive]}>
                                        Elderly 60+ (-{elderlyDiscountInput}%)
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.simToggleChip, simAssistance && styles.simToggleChipActive]}
                                    onPress={() => setSimAssistance(!simAssistance)}
                                >
                                    <Ionicons
                                        name={simAssistance ? 'checkbox' : 'square-outline'}
                                        size={18}
                                        color={simAssistance ? '#FFFFFF' : adminColors.textSecondary}
                                    />
                                    <Text style={[styles.simToggleText, simAssistance && styles.simToggleTextActive]}>
                                        Assistance Requested (+Rs. {assistanceSurchargeInput})
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.simToggleChip, simWheelchairPaired && styles.simToggleChipActive]}
                                    onPress={() => setSimWheelchairPaired(!simWheelchairPaired)}
                                >
                                    <Ionicons
                                        name={simWheelchairPaired ? 'checkbox' : 'square-outline'}
                                        size={18}
                                        color={simWheelchairPaired ? '#FFFFFF' : adminColors.textSecondary}
                                    />
                                    <Text style={[styles.simToggleText, simWheelchairPaired && styles.simToggleTextActive]}>
                                        Wheelchair Space W1 (Pairs G1 Seat @ {guardianCompanionRateInput}%)
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Live Result Display */}
                            <View style={styles.simResultBox}>
                                <View style={styles.simResultHeader}>
                                    <Text style={styles.simResultLabel}>Calculated Total Ticket Price</Text>
                                    <Text style={styles.simResultTotal}>LKR {simulatedFare.totalFare}.00</Text>
                                </View>

                                <View style={styles.simDivider} />

                                <View style={styles.simDetailRow}>
                                    <Text style={styles.simDetailKey}>Base Fare (first {baseDistanceInput} km):</Text>
                                    <Text style={styles.simDetailVal}>LKR {simulatedFare.baseFare}.00</Text>
                                </View>
                                <View style={styles.simDetailRow}>
                                    <Text style={styles.simDetailKey}>Distance Fare ({Math.max(0, parseFloat(simDistanceInput) - parseFloat(baseDistanceInput))} km @ Rs. {ratePerKmInput}/km):</Text>
                                    <Text style={styles.simDetailVal}>LKR {simulatedFare.distanceFare}.00</Text>
                                </View>
                                <View style={styles.simDetailRow}>
                                    <Text style={styles.simDetailKey}>Subtotal Journey Fare:</Text>
                                    <Text style={styles.simDetailVal}>LKR {simulatedFare.subtotalFare}.00</Text>
                                </View>
                                {simulatedFare.concessionDiscount ? (
                                    <View style={styles.simDetailRow}>
                                        <Text style={[styles.simDetailKey, { color: adminColors.success }]}>
                                            {simulatedFare.concessionType === 'ACCESSIBILITY' ? 'Accessibility Discount' : 'Elderly Discount'} ({simulatedFare.concessionDiscountPercent}%):
                                        </Text>
                                        <Text style={[styles.simDetailVal, { color: adminColors.success }]}>
                                            - LKR {simulatedFare.concessionDiscount}.00
                                        </Text>
                                    </View>
                                ) : null}
                                {simulatedFare.assistanceFee ? (
                                    <View style={styles.simDetailRow}>
                                        <Text style={[styles.simDetailKey, { color: adminColors.purple }]}>
                                            Conductor Assistance Service Fee:
                                        </Text>
                                        <Text style={[styles.simDetailVal, { color: adminColors.purple }]}>
                                            + LKR {simulatedFare.assistanceFee}.00
                                        </Text>
                                    </View>
                                ) : null}
                                {simulatedFare.guardianFare ? (
                                    <View style={styles.simDetailRow}>
                                        <Text style={[styles.simDetailKey, { color: adminColors.accent }]}>
                                            Guardian Companion Seat ({simulatedFare.pairedSeatNumber ?? 'G1'}) ({simulatedFare.guardianRatePercent}%):
                                        </Text>
                                        <Text style={[styles.simDetailVal, { color: adminColors.accent }]}>
                                            + LKR {simulatedFare.guardianFare}.00
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        </View>

                        {/* Action Buttons */}
                        <View style={styles.actionRow}>
                            <TouchableOpacity
                                style={styles.saveButton}
                                onPress={handleSave}
                                disabled={isSaving}
                                activeOpacity={0.8}
                            >
                                {isSaving ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <>
                                        <Ionicons name="save-outline" size={20} color="#FFFFFF" />
                                        <Text style={styles.saveButtonText}>Save Policy Changes</Text>
                                    </>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.resetButton}
                                onPress={handleResetToDefaults}
                                disabled={isSaving}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="refresh-outline" size={18} color={adminColors.danger} />
                                <Text style={styles.resetButtonText}>Reset to NTC Baseline</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: adminColors.background,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    centerLoading: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: adminColors.textSecondary,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderColor: adminColors.dangerBorder,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
        gap: 8,
    },
    errorText: {
        flex: 1,
        fontSize: 13,
        color: adminColors.danger,
        fontWeight: '500',
    },
    successBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.successSoft,
        borderColor: '#C6E8C8',
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
        gap: 8,
    },
    successText: {
        flex: 1,
        fontSize: 13,
        color: adminColors.success,
        fontWeight: '600',
    },
    auditCard: {
        backgroundColor: adminColors.primarySoft,
        borderColor: '#D4E5F9',
        borderWidth: 1,
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
    },
    auditIconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
    },
    auditTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.primary,
    },
    auditSubtitle: {
        fontSize: 12,
        color: adminColors.textSecondary,
    },
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: adminColors.border,
        ...adminShadow.card,
    },
    simulatorCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1.5,
        borderColor: adminColors.accent,
        ...adminShadow.card,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
    },
    iconCircleBlue: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconCircleGreen: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: adminColors.successSoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconCirclePurple: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#F3E8FF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconCircleCyan: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: adminColors.accentSoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardHeading: {
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    cardSubheading: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 2,
    },
    inputRow: {
        flexDirection: 'row',
        gap: 12,
    },
    inputCol: {
        flex: 1,
    },
    inputLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textPrimary,
        marginBottom: 6,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surfaceMuted,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        height: 44,
    },
    inputPrefix: {
        fontSize: 14,
        color: adminColors.textSecondary,
        marginRight: 6,
        fontWeight: '600',
    },
    inputSuffix: {
        fontSize: 13,
        color: adminColors.textSecondary,
        marginLeft: 6,
        fontWeight: '500',
    },
    textInput: {
        flex: 1,
        fontSize: 15,
        color: adminColors.textPrimary,
        fontWeight: '600',
        paddingVertical: 0,
    },
    helperText: {
        fontSize: 11,
        color: adminColors.textSecondary,
        marginTop: 4,
    },
    toggleRow: {
        flexDirection: 'column',
        gap: 8,
        marginTop: 6,
        marginBottom: 16,
    },
    simToggleChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
    },
    simToggleChipActive: {
        backgroundColor: adminColors.primary,
        borderColor: adminColors.primary,
    },
    simToggleText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textPrimary,
    },
    simToggleTextActive: {
        color: '#FFFFFF',
    },
    simResultBox: {
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        padding: 14,
    },
    simResultHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    simResultLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    simResultTotal: {
        fontSize: 18,
        fontWeight: '800',
        color: adminColors.primary,
    },
    simDivider: {
        height: 1,
        backgroundColor: '#E2E8F0',
        marginVertical: 10,
    },
    simDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    simDetailKey: {
        fontSize: 12,
        color: adminColors.textSecondary,
    },
    simDetailVal: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textPrimary,
    },
    actionRow: {
        gap: 12,
        marginTop: 8,
    },
    saveButton: {
        flexDirection: 'row',
        height: 48,
        backgroundColor: adminColors.primary,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        ...adminShadow.card,
    },
    saveButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    resetButton: {
        flexDirection: 'row',
        height: 44,
        backgroundColor: adminColors.surface,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
    },
    resetButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.danger,
    },
});
