import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
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
import {
    ReportIssueCategory,
    ReportPhotoDraft,
} from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSelectModal, AdminSelectOption } from '../../admin/ui/AdminSelectModal';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { PhotoEvidencePicker } from './PhotoEvidencePicker';
import { REPORT_CATEGORY_OPTIONS } from './reportCategories';
import { ReportSelectField, ReportTextArea, ReportTextField } from './ReportFormFields';

const DESCRIPTION_MAX_LENGTH = 600;

export const ReportIssueScreen = () => {
    const { token, isAuthenticated } = useAuthStore();

    // ---- Submitted to the backend --------------------------------------
    const [issueCategory, setIssueCategory] = useState<ReportIssueCategory | null>(null);
    const [description, setDescription] = useState('');

    // ---- Collected in the UI only (MOV-140) ----------------------------
    // The current POST /api/reports contract accepts issueCategory and
    // description only, so these stay local until the backend stores them.
    const [busNumber, setBusNumber] = useState('');
    const [routeNumber, setRouteNumber] = useState('');
    const [photos, setPhotos] = useState<ReportPhotoDraft[]>([]);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedCategoryOption = REPORT_CATEGORY_OPTIONS.find(
        (option) => option.value === issueCategory
    );

    const categoryOptions = useMemo<AdminSelectOption[]>(
        () => REPORT_CATEGORY_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
        []
    );

    const canSubmit = !!issueCategory && !!description.trim() && !isSubmitting;

    const handleSubmit = async () => {
        setError(null);

        if (!isAuthenticated || !token) {
            setError('Authentication required. Please log in again.');
            return;
        }

        if (!issueCategory) {
            setError('Please select an issue category.');
            return;
        }

        const trimmedDescription = description.trim();
        if (!trimmedDescription) {
            setError('Please provide a description of the issue.');
            return;
        }

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
                } else if (response.status === 400) {
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
                        onPress={() => setIsCategoryModalOpen(true)}
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
                    <ReportTextField
                        label="Bus / Vehicle Number"
                        value={busNumber}
                        onChangeText={setBusNumber}
                        placeholder="Enter bus or vehicle number"
                        icon="bus-outline"
                        optional
                        maxLength={20}
                    />

                    <ReportTextField
                        label="Route Number"
                        value={routeNumber}
                        onChangeText={setRouteNumber}
                        placeholder="Enter route number"
                        icon="git-branch-outline"
                        optional
                        maxLength={20}
                        helper="Adding the vehicle and route helps us trace the exact bus involved."
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
                visible={isCategoryModalOpen}
                title="Select Category"
                options={categoryOptions}
                selectedValue={issueCategory}
                emptyMessage="No issue categories are available."
                onClose={() => setIsCategoryModalOpen(false)}
                onSelect={(value) => {
                    setIssueCategory(value as ReportIssueCategory);
                    setIsCategoryModalOpen(false);
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
