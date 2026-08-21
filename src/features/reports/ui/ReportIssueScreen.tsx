import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Bus } from '../../../entities/bus/model/types';
import {
    ReportIssueCategory,
    ReportPhotoDraft,
} from '../../../entities/report/model/types';
import { Route } from '../../../entities/route/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSelectModal, AdminSelectOption } from '../../admin/ui/AdminSelectModal';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { loadReportReferenceData } from '../api/reportReferenceData';
import {
    canSubmitReport,
    firstMissingReportField,
    isBusSelectionUnlocked,
    photoUploadIssue,
    uploadedPhotoUrls,
} from '../utils/reportFormValidation';
import { PhotoEvidencePicker } from './PhotoEvidencePicker';
import { REPORT_CATEGORY_OPTIONS } from './reportCategories';
import { ReportSelectField, ReportTextArea } from './ReportFormFields';

const DESCRIPTION_MAX_LENGTH = 600;

const DIRECTION_LABELS: Record<string, string> = {
    OUTBOUND: 'Outbound',
    RETURN: 'Return',
};

/** Which picker sheet is open; only one can be at a time. */
type ActivePicker = 'category' | 'bus' | 'route' | null;

export const ReportIssueScreen = () => {
    const { token, isAuthenticated } = useAuthStore();

    // ---- Submitted to the backend --------------------------------------
    const [issueCategory, setIssueCategory] = useState<ReportIssueCategory | null>(null);
    const [description, setDescription] = useState('');

    // Both hold the canonical document id, never the display text: the API
    // resolves the id itself and snapshots the plate and route number from the
    // fleet record, so nothing shown on screen is trusted as a reference.
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    const [selectedBusId, setSelectedBusId] = useState<string | null>(null);

    // Each photo is uploaded to Cloudinary by the picker as soon as it is
    // chosen, so a draft carries the secure URL that will be submitted. The
    // `file://` uris behind the thumbnails are never sent anywhere.
    const [photos, setPhotos] = useState<ReportPhotoDraft[]>([]);

    // Whether a bus may be chosen yet. The route is asked for first, so
    // changing it drops a bus picked under the previous one rather than
    // leaving a stale selection behind.
    const isBusUnlocked = isBusSelectionUnlocked(selectedRouteId);

    const handleRouteSelected = (routeId: string) => {
        if (routeId !== selectedRouteId) setSelectedBusId(null);
        setSelectedRouteId(routeId);
    };

    // ---- Bus / route reference data ------------------------------------
    const [buses, setBuses] = useState<Bus[]>([]);
    const [routes, setRoutes] = useState<Route[]>([]);
    const [isLoadingReferenceData, setIsLoadingReferenceData] = useState(true);
    const [busError, setBusError] = useState<string | null>(null);
    const [routeError, setRouteError] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activePicker, setActivePicker] = useState<ActivePicker>(null);
    const [error, setError] = useState<string | null>(null);

    const loadReferenceData = useCallback(async () => {
        setIsLoadingReferenceData(true);

        const data = await loadReportReferenceData();

        setBuses(data.buses);
        setRoutes(data.routes);
        setBusError(data.busError);
        setRouteError(data.routeError);
        setIsLoadingReferenceData(false);
    }, []);

    // Loaded once on mount. The issue category and description do not depend on
    // it, so they stay usable throughout.
    useEffect(() => {
        loadReferenceData();
    }, [loadReferenceData]);

    const selectedCategoryOption = REPORT_CATEGORY_OPTIONS.find(
        (option) => option.value === issueCategory
    );

    const categoryOptions = useMemo<AdminSelectOption[]>(
        () => REPORT_CATEGORY_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
        []
    );

    const selectedBus = useMemo(
        () => buses.find((bus) => bus.busId === selectedBusId) ?? null,
        [buses, selectedBusId]
    );

    const selectedRoute = useMemo(
        () => routes.find((route) => route.routeId === selectedRouteId) ?? null,
        [routes, selectedRouteId]
    );

    // Every bus is offered, whatever its status: a passenger may well be
    // reporting the very fault that put the vehicle into maintenance.
    const busOptions = useMemo<AdminSelectOption[]>(
        () =>
            buses.map((bus) => ({
                value: bus.busId,
                label: bus.numberPlate,
                description: [bus.busModel, bus.manufacturer].filter(Boolean).join(' · '),
                status: bus.status,
            })),
        [buses]
    );

    // A route number exists once per direction, so the label has to carry the
    // direction too — "138" alone would be ambiguous.
    const routeOptions = useMemo<AdminSelectOption[]>(
        () =>
            routes.map((route) => ({
                value: route.routeId,
                label: `${route.routeNumber} · ${route.routeName}`,
                description: [
                    `${route.startLocation} → ${route.endLocation}`,
                    route.direction ? DIRECTION_LABELS[route.direction] ?? route.direction : null,
                ]
                    .filter(Boolean)
                    .join(' · '),
                status: route.status,
            })),
        [routes]
    );

    const formState = {
        issueCategory,
        description,
        routeId: selectedRouteId,
        busId: selectedBusId,
    };

    const canSubmit = canSubmitReport(formState, isSubmitting, photos);

    const handleSubmit = async () => {
        setError(null);

        if (!isAuthenticated || !token) {
            setError('Authentication required. Please log in again.');
            return;
        }

        // The same rules the Submit button is gated on, so a report can never
        // be sent by a route the button would have refused.
        const missingField = firstMissingReportField(formState);

        if (missingField) {
            setError(missingField);
            return;
        }

        const trimmedDescription = description.trim();

        // Every attached photo has to have reached Cloudinary. Submitting while
        // one is still uploading — or after one failed — would file a report
        // missing evidence the passenger believes they attached, and there is
        // no way to add it afterwards, so the report waits instead.
        const photoIssue = photoUploadIssue(photos);

        if (photoIssue) {
            setError(photoIssue);
            return;
        }

        const photoUrls = uploadedPhotoUrls(photos);

        setIsSubmitting(true);

        try {
            const response = await fetch(`${API_BASE_URL}/api/reports`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    issueCategory,
                    description: trimmedDescription,
                    routeId: selectedRouteId,
                    busId: selectedBusId,
                    // The Cloudinary URLs the picker already uploaded to, never
                    // the thumbnails' device uris. Omitted entirely when no
                    // photo was attached. passengerId is deliberately absent —
                    // it comes from the token.
                    ...(photoUrls.length > 0 ? { photoUrls } : {}),
                }),
            });

            const result = await response.json().catch(() => ({}));

            if (response.ok) {
                Alert.alert(
                    'Report Submitted',
                    `Your accessibility report has been submitted successfully.\n\nReport ID: ${result.report?.reportId || 'N/A'}`,
                    [{ text: 'Done', onPress: () => router.back() }]
                );
            } else {
                if (response.status === 401) {
                    setError('Authentication required. Please log in again.');
                } else if (response.status === 403) {
                    setError('Only passengers can submit accessibility reports.');
                } else if (response.status === 400 || response.status === 404) {
                    setError(result.message || 'Invalid request. Please check your inputs.');
                } else {
                    setError('Unable to submit the report right now. Please try again.');
                }
            }
        } catch (err) {
            console.error('Report Submission Error:', err);
            setError('Unable to connect to the server. Please check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <AdminScreenHeader
                title="Report Issue"
                subtitle="Tell us what went wrong so we can improve accessibility"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ---------------- Introduction ---------------- */}
                <View style={styles.introCard}>
                    <Ionicons name="information-circle" size={22} color={adminColors.accent} />
                    <Text style={styles.introText}>
                        Help us improve accessibility by reporting issues you experience during your
                        journey. Reports are reviewed by the operations team.
                    </Text>
                </View>

                {!!error && (
                    <View style={styles.errorBanner} accessibilityRole="alert">
                        <Ionicons name="alert-circle" size={18} color={adminColors.danger} />
                        <Text style={styles.errorBannerText}>{error}</Text>
                    </View>
                )}

                {/* ---------------- Issue Details ---------------- */}
                <Text style={styles.sectionTitle}>Issue Details</Text>

                <View style={styles.card}>
                    <ReportSelectField
                        label="Issue Category"
                        value={selectedCategoryOption?.label ?? null}
                        placeholder="Select a category"
                        icon={selectedCategoryOption?.icon ?? 'list-outline'}
                        onPress={() => setActivePicker('category')}
                    />

                    <ReportTextArea
                        label="Describe the Issue"
                        value={description}
                        onChangeText={setDescription}
                        placeholder="Please describe what happened and where the accessibility problem occurred."
                        helper="Include the stop, time and anything that would help us locate the problem."
                        maxLength={DESCRIPTION_MAX_LENGTH}
                    />
                </View>

                {/* ---------------- Bus / Vehicle Details ---------------- */}
                <Text style={styles.sectionTitle}>Bus / Vehicle Details</Text>

                <View style={styles.card}>
                    {isLoadingReferenceData ? (
                        <View style={styles.referenceLoadingRow} accessibilityLiveRegion="polite">
                            <ActivityIndicator size="small" color={adminColors.primary} />
                            <Text style={styles.referenceLoadingText}>
                                Loading buses and routes...
                            </Text>
                        </View>
                    ) : (
                        <>
                            {(!!busError || !!routeError) && (
                                <View style={styles.referenceErrorBanner} accessibilityRole="alert">
                                    <Ionicons
                                        name="cloud-offline-outline"
                                        size={18}
                                        color={adminColors.danger}
                                    />
                                    <Text style={styles.referenceErrorText}>
                                        {[busError, routeError].filter(Boolean).join(' ')}
                                    </Text>
                                    <TouchableOpacity
                                        onPress={loadReferenceData}
                                        style={styles.referenceRetryButton}
                                        accessibilityRole="button"
                                        accessibilityLabel="Retry loading buses and routes"
                                    >
                                        <Text style={styles.referenceRetryText}>Retry</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Route first: the bus field stays locked until a
                                route is chosen, so the journey is established
                                before the vehicle that ran it. */}
                            <ReportSelectField
                                label="Route"
                                value={
                                    selectedRoute
                                        ? `${selectedRoute.routeNumber} · ${selectedRoute.routeName}`
                                        : null
                                }
                                secondary={
                                    selectedRoute
                                        ? [
                                              `${selectedRoute.startLocation} → ${selectedRoute.endLocation}`,
                                              selectedRoute.direction
                                                  ? DIRECTION_LABELS[selectedRoute.direction] ??
                                                    selectedRoute.direction
                                                  : null,
                                          ]
                                              .filter(Boolean)
                                              .join(' · ')
                                        : undefined
                                }
                                placeholder={
                                    routes.length === 0 ? 'No routes available' : 'Select Route'
                                }
                                icon="git-branch-outline"
                                showSelectedTick
                                disabled={routes.length === 0}
                                onPress={() => setActivePicker('route')}
                            />

                            <ReportSelectField
                                label="Bus / Vehicle"
                                value={selectedBus?.numberPlate ?? null}
                                secondary={[selectedBus?.busModel, selectedBus?.manufacturer]
                                    .filter(Boolean)
                                    .join(' · ')}
                                placeholder={
                                    !isBusUnlocked
                                        ? 'Select Route first'
                                        : buses.length === 0
                                          ? 'No buses available'
                                          : 'Select Bus'
                                }
                                icon="bus-outline"
                                showSelectedTick
                                disabled={!isBusUnlocked || buses.length === 0}
                                onPress={() => setActivePicker('bus')}
                                helper={
                                    isBusUnlocked
                                        ? 'The route and vehicle together let us trace the exact bus involved.'
                                        : 'Choose the route you travelled on to pick the bus.'
                                }
                            />

                            {(!!selectedBusId || !!selectedRouteId) && (
                                <TouchableOpacity
                                    style={styles.clearSelectionButton}
                                    onPress={() => {
                                        setSelectedBusId(null);
                                        setSelectedRouteId(null);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel="Clear bus and route selection"
                                >
                                    <Ionicons
                                        name="close-circle-outline"
                                        size={16}
                                        color={adminColors.textSecondary}
                                    />
                                    <Text style={styles.clearSelectionText}>Clear selection</Text>
                                </TouchableOpacity>
                            )}
                        </>
                    )}
                </View>

                {/* ---------------- Photo Evidence ---------------- */}
                <Text style={styles.sectionTitle}>Photo Evidence</Text>

                <PhotoEvidencePicker
                    photos={photos}
                    onChange={setPhotos}
                    disabled={isSubmitting}
                />

                {/* ---------------- Submit ---------------- */}
                <TouchableOpacity
                    style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={!canSubmit}
                    accessibilityRole="button"
                    accessibilityLabel="Submit Report"
                    accessibilityState={{ disabled: !canSubmit }}
                >
                    {isSubmitting ? (
                        <View style={styles.submittingRow}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                            <Text style={[styles.primaryButtonText, styles.submittingText]}>
                                Submitting…
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.submittingRow}>
                            <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
                            <Text style={[styles.primaryButtonText, styles.submittingText]}>
                                Submit Report
                            </Text>
                        </View>
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

            <AdminSelectModal
                visible={activePicker === 'category'}
                title="Select Category"
                options={categoryOptions}
                selectedValue={issueCategory}
                emptyMessage="No issue categories are available."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    setIssueCategory(value as ReportIssueCategory);
                    setActivePicker(null);
                }}
            />

            <AdminSelectModal
                visible={activePicker === 'route'}
                title="Select Route"
                options={routeOptions}
                selectedValue={selectedRouteId}
                emptyMessage="No routes are available to select."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    handleRouteSelected(value);
                    setActivePicker(null);
                }}
            />

            <AdminSelectModal
                visible={activePicker === 'bus'}
                title="Select Bus"
                options={busOptions}
                selectedValue={selectedBusId}
                emptyMessage="No buses are available to select."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    setSelectedBusId(value);
                    setActivePicker(null);
                }}
            />
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    introCard: {
        flexDirection: 'row',
        backgroundColor: adminColors.accentSoft,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#CCE7F5',
        padding: 14,
        marginTop: 4,
    },
    introText: {
        flex: 1,
        fontSize: 13,
        color: '#0B5E80',
        lineHeight: 19,
        marginLeft: 10,
    },

    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        padding: 12,
        marginTop: 14,
    },
    errorBannerText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 8,
        lineHeight: 18,
    },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 20,
    },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },

    referenceLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
    },
    referenceLoadingText: {
        fontSize: 14,
        color: adminColors.textSecondary,
        marginLeft: 10,
    },
    referenceErrorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
    },
    referenceErrorText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 8,
        lineHeight: 17,
    },
    referenceRetryButton: {
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    referenceRetryText: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.danger,
    },

    clearSelectionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        minHeight: 40,
        paddingRight: 8,
    },
    clearSelectionText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 6,
    },

    primaryButton: {
        backgroundColor: adminColors.primary,
        minHeight: 54,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 16,
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
    submittingText: { marginLeft: 8 },

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
});
