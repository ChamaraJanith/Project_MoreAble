import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    
    TouchableOpacity,
    View
} from 'react-native';
import {
    AccessibilityReport,
    ReportIssueCategory,
    ReportPhotoDraft,
} from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSelectModal, AdminSelectOption } from '../../admin/ui/AdminSelectModal';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import {
    canSubmitReport,
    firstMissingReportField,
    photoUploadIssue,
    uploadedPhotoUrls,
} from '../utils/reportFormValidation';
import { existingPhotoDrafts } from '../utils/reportPhotoDrafts';
import { accessibilityReportsPath, reportApiPath } from '../utils/reportRoutes';
import { PhotoEvidencePicker } from './PhotoEvidencePicker';
import { REPORT_CATEGORY_OPTIONS } from './reportCategories';
import { ReportSelectField, ReportTextArea } from './ReportFormFields';
import { ReportJourneyFields } from './ReportJourneyFields';
import { ReportSubmittedView } from './ReportSubmittedView';

const DESCRIPTION_MAX_LENGTH = 600;

export interface ReportFormScreenProps {
    /** Filing a new report, or changing one that already exists. */
    mode: 'create' | 'edit';
    /** The report being edited. Required by 'edit', ignored by 'create'. */
    report?: AccessibilityReport;
}

/**
 * The accessibility report form, for both filing and editing.
 *
 * One component rather than two, because an edited report has to obey exactly
 * the rules a new one does — the same required fields, the same route-then-bus
 * ordering, the same refusal to submit while a photo is still uploading. A
 * second form would be those rules written down twice.
 *
 * Editing differs only in where the state starts and where it is sent: the
 * fields open pre-filled from the stored report, and Save issues a PUT against
 * that report instead of a POST.
 */
export const ReportFormScreen = ({ mode, report }: ReportFormScreenProps) => {
    const { token, isAuthenticated } = useAuthStore();

    const isEditing = mode === 'edit' && !!report;

    // ---- Submitted to the backend --------------------------------------
    const [issueCategory, setIssueCategory] = useState<ReportIssueCategory | null>(
        report?.issueCategory ?? null
    );
    const [description, setDescription] = useState(report?.description ?? '');

    // Both hold the canonical document id, never the display text: the API
    // resolves the id itself and snapshots the plate and route number from the
    // fleet record, so nothing shown on screen is trusted as a reference.
    //
    // An edited report opens on the ids it was filed with, so the pickers show
    // the same bus and route the passenger chose — and clearing them is an
    // ordinary edit, which is why they are ids rather than a locked snapshot.
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(
        report?.routeId ?? null
    );
    const [selectedBusId, setSelectedBusId] = useState<string | null>(report?.busId ?? null);

    // Each photo is uploaded to Cloudinary by the picker as soon as it is
    // chosen, so a draft carries the secure URL that will be submitted. The
    // `file://` uris behind the thumbnails are never sent anywhere.
    //
    // A report being edited starts with its stored Cloudinary URLs as drafts
    // that are already finished, so they display, can be removed, and are saved
    // back unchanged — without the bytes ever being uploaded a second time.
    const [photos, setPhotos] = useState<ReportPhotoDraft[]>(() =>
        existingPhotoDrafts(report?.photoUrls)
    );

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCategoryPickerOpen, setIsCategoryPickerOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The report the API stored, once a new one has been filed. While set,
    // the confirmation is shown in place of the form.
    const [submittedReport, setSubmittedReport] = useState<AccessibilityReport | null>(null);

    const resetForm = () => {
        setIssueCategory(null);
        setDescription('');
        setSelectedRouteId(null);
        setSelectedBusId(null);
        setPhotos([]);
        setError(null);
        setSubmittedReport(null);
    };

    const selectedCategoryOption = REPORT_CATEGORY_OPTIONS.find(
        (option) => option.value === issueCategory
    );

    const categoryOptions = useMemo<AdminSelectOption[]>(
        () => REPORT_CATEGORY_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
        []
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
            // The same body either way. On an edit it goes to the report's own
            // route, where the API checks the token against the report's author
            // before changing anything — and keeps the report id, the author and
            // the review status exactly as they were.
            const response = await fetch(
                isEditing
                    ? `${API_BASE_URL}${reportApiPath(report.reportId)}`
                    : `${API_BASE_URL}/api/reports`,
                {
                    method: isEditing ? 'PUT' : 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        issueCategory,
                        description: trimmedDescription,
                        routeId: selectedRouteId,
                        busId: selectedBusId,
                        // The Cloudinary URLs the picker already uploaded to,
                        // never the thumbnails' device uris. Omitted entirely
                        // when no photo was attached. passengerId is
                        // deliberately absent — it comes from the token.
                        ...(photoUrls.length > 0 ? { photoUrls } : {}),
                    }),
                }
            );

            const result = await response.json().catch(() => ({}));

            if (response.ok && !isEditing && result?.report?.reportId) {
                // A new report: confirm it with what the API actually stored.
                setSubmittedReport(result.report as AccessibilityReport);
            } else if (response.ok) {
                Alert.alert(
                    isEditing ? 'Report Updated' : 'Report Submitted',
                    isEditing
                        ? 'Your changes have been saved.'
                        : 'Your accessibility report has been submitted successfully.',
                    // Back to where the form was opened from. Both the details
                    // screen and the list reload on focus, so the change is
                    // already there when they reappear.
                    [{ text: 'Done', onPress: () => router.back() }]
                );
            } else {
                if (response.status === 401) {
                    setError('Authentication required. Please log in again.');
                } else if (response.status === 403) {
                    setError(
                        isEditing
                            ? 'You can only edit your own reports.'
                            : 'Only passengers can submit accessibility reports.'
                    );
                } else if (response.status === 409) {
                    // The report was decided while this form was open. Trying
                    // again cannot help, so the API's own wording is shown —
                    // it names the status the report reached — rather than an
                    // invitation to repeat a request that will be refused.
                    setError(
                        result.message ||
                            'This report has already been reviewed, so it can no longer be edited.'
                    );
                } else if (response.status === 400 || response.status === 404) {
                    setError(result.message || 'Invalid request. Please check your inputs.');
                } else {
                    setError(
                        isEditing
                            ? 'Unable to save your changes right now. Please try again.'
                            : 'Unable to submit the report right now. Please try again.'
                    );
                }
            }
        } catch (err) {
            console.error('Report Submission Error:', err);
            setError('Unable to connect to the server. Please check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (submittedReport) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="Report Issue" tone="brand" />
                <ReportSubmittedView
                    report={submittedReport}
                    // Back to the list the form was opened from, on My Reports,
                    // rather than stacking a second copy of it.
                    onViewMyReports={() => router.dismissTo(accessibilityReportsPath('my') as Href)}
                    onSubmitAnother={resetForm}
                />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <AdminScreenHeader
                tone="brand"
                title={isEditing ? 'Edit Report' : 'Report Issue'}
                subtitle={
                    isEditing
                        ? 'Update the details of your accessibility report'
                        : 'Tell us what went wrong so we can improve accessibility'
                }
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
                        {isEditing
                            ? 'Update anything that was wrong or missing. Your report keeps its current review status.'
                            : 'Help us improve accessibility by reporting issues you experience during your journey. Reports are reviewed by the operations team.'}
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
                        onPress={() => setIsCategoryPickerOpen(true)}
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
                    <ReportJourneyFields
                        routeId={selectedRouteId}
                        busId={selectedBusId}
                        onChange={({ routeId, busId }) => {
                            setSelectedRouteId(routeId);
                            setSelectedBusId(busId);
                        }}
                    />
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
                    accessibilityLabel={isEditing ? 'Save Changes' : 'Submit Report'}
                    accessibilityState={{ disabled: !canSubmit }}
                >
                    {isSubmitting ? (
                        <View style={styles.submittingRow}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                            <Text style={[styles.primaryButtonText, styles.submittingText]}>
                                {isEditing ? 'Saving…' : 'Submitting…'}
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.submittingRow}>
                            <Ionicons
                                name={isEditing ? 'save-outline' : 'paper-plane-outline'}
                                size={18}
                                color="#FFFFFF"
                            />
                            <Text style={[styles.primaryButtonText, styles.submittingText]}>
                                {isEditing ? 'Save Changes' : 'Submit Report'}
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
                visible={isCategoryPickerOpen}
                title="Select Category"
                options={categoryOptions}
                selectedValue={issueCategory}
                emptyMessage="No issue categories are available."
                onClose={() => setIsCategoryPickerOpen(false)}
                onSelect={(value) => {
                    setIssueCategory(value as ReportIssueCategory);
                    setIsCategoryPickerOpen(false);
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
