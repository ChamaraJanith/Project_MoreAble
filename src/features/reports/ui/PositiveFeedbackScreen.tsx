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
    View,
} from 'react-native';
import { PositiveFeedbackCategory } from '../../../entities/report/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminSelectModal, AdminSelectOption } from '../../admin/ui/AdminSelectModal';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { submitPositiveFeedback } from '../api/positiveFeedbackApi';
import {
    buildPositiveFeedbackPayload,
    POSITIVE_FEEDBACK_DESCRIPTION_MAX_LENGTH,
    PositiveFeedbackFormState,
    positiveFeedbackFieldErrors,
} from '../utils/positiveFeedbackValidation';
import { reportFormPath } from '../utils/reportRoutes';
import { POSITIVE_FEEDBACK_CATEGORY_OPTIONS } from './positiveFeedbackCategories';
import { ReportSelectField, ReportTextArea } from './ReportFormFields';
import { ReportJourneyFields } from './ReportJourneyFields';

/** Dark enough on successSoft to pass WCAG AA for body text. */
const SUCCESS_TEXT = '#1B5E20';

/**
 * Sharing a GOOD accessibility experience (MOV-300).
 *
 * Built from the same pieces as the issue report form — the field shells, the
 * picker sheet and the shared route/bus selector — so it reads as part of the
 * same flow. It differs in what is required (only the category and the
 * description) and in where it is sent: see positiveFeedbackApi.
 */
export const PositiveFeedbackScreen = () => {
    const { token, isAuthenticated } = useAuthStore();

    const [category, setCategory] = useState<PositiveFeedbackCategory | null>(null);
    const [description, setDescription] = useState('');
    const [routeId, setRouteId] = useState<string | null>(null);
    const [busId, setBusId] = useState<string | null>(null);

    const [isCategoryPickerOpen, setIsCategoryPickerOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Field messages stay hidden until the first Submit, so an untouched form
    // does not open covered in red — and once shown, they clear live as each
    // field is filled in.
    const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

    const formState: PositiveFeedbackFormState = { category, description, routeId, busId };
    const fieldErrors = hasAttemptedSubmit ? positiveFeedbackFieldErrors(formState) : {};

    const selectedCategoryOption = POSITIVE_FEEDBACK_CATEGORY_OPTIONS.find(
        (option) => option.value === category
    );

    const categoryOptions = useMemo<AdminSelectOption[]>(
        () =>
            POSITIVE_FEEDBACK_CATEGORY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                description: option.description,
            })),
        []
    );

    const handleSubmit = async () => {
        if (isSubmitting) return;

        setError(null);
        setHasAttemptedSubmit(true);

        const payload = buildPositiveFeedbackPayload(formState);

        // Incomplete: the field messages now showing say what is missing.
        if (!payload) return;

        if (!isAuthenticated || !token) {
            setError('Authentication required. Please log in again.');
            return;
        }

        setIsSubmitting(true);

        try {
            const result = await submitPositiveFeedback(payload, token);

            if (result.ok) {
                Alert.alert(
                    'Thank You!',
                    'Your positive feedback has been submitted. It helps us recognise what is working well for passengers.',
                    [{ text: 'Done', onPress: () => router.back() }]
                );
            } else {
                setError(result.message);
            }
        } catch (err) {
            console.error('Positive Feedback Submission Error:', err);
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
                title="Positive Feedback"
                subtitle="Tell us what went well on your journey"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ---------------- Introduction ---------------- */}
                <View style={styles.introCard}>
                    <Ionicons
                        name="heart-circle"
                        size={24}
                        color={adminColors.success}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                    />
                    <View style={styles.introBody}>
                        <Text style={styles.introTitle} accessibilityRole="header">
                            Share a good experience
                        </Text>
                        <Text style={styles.introText}>
                            This form is for accessibility that worked well — a helpful driver,
                            smooth boarding or a clear announcement. Your feedback helps us
                            recognise and keep what works.
                        </Text>

                        <TouchableOpacity
                            style={styles.introLink}
                            onPress={() => router.replace(reportFormPath() as Href)}
                            disabled={isSubmitting}
                            accessibilityRole="link"
                            accessibilityLabel="Report an accessibility issue instead"
                        >
                            <Text style={styles.introLinkText}>Had a problem? Report an issue instead</Text>
                            <Ionicons name="chevron-forward" size={14} color={SUCCESS_TEXT} />
                        </TouchableOpacity>
                    </View>
                </View>

                {!!error && (
                    <View style={styles.errorBanner} accessibilityRole="alert">
                        <Ionicons name="alert-circle" size={18} color={adminColors.danger} />
                        <Text style={styles.errorBannerText}>{error}</Text>
                    </View>
                )}

                {/* ---------------- Your Experience ---------------- */}
                <Text style={styles.sectionTitle}>Your Experience</Text>

                <View style={styles.card}>
                    <ReportSelectField
                        label="What went well?"
                        value={selectedCategoryOption?.label ?? null}
                        secondary={selectedCategoryOption?.description}
                        placeholder="Select a category"
                        icon={selectedCategoryOption?.icon ?? 'thumbs-up-outline'}
                        showSelectedTick
                        disabled={isSubmitting}
                        error={fieldErrors.category}
                        onPress={() => setIsCategoryPickerOpen(true)}
                    />

                    <ReportTextArea
                        label="Describe Your Experience"
                        value={description}
                        onChangeText={setDescription}
                        placeholder="For example: the driver lowered the ramp and waited until I was seated."
                        helper="Mention the stop, time or anything that made the difference."
                        maxLength={POSITIVE_FEEDBACK_DESCRIPTION_MAX_LENGTH}
                        editable={!isSubmitting}
                        error={fieldErrors.description}
                    />
                </View>

                {/* ---------------- Journey Details ---------------- */}
                <Text style={styles.sectionTitle}>Journey Details</Text>
                <Text style={styles.sectionHint}>
                    Optional — add the route and bus if your feedback is about a specific journey.
                </Text>

                <View style={styles.card}>
                    <ReportJourneyFields
                        routeId={routeId}
                        busId={busId}
                        optional
                        onChange={(selection) => {
                            setRouteId(selection.routeId);
                            setBusId(selection.busId);
                        }}
                    />
                </View>

                {/* ---------------- Submit ---------------- */}
                <TouchableOpacity
                    style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Submit Feedback"
                    accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
                >
                    <View style={styles.buttonRow}>
                        {isSubmitting ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
                        )}
                        <Text style={styles.primaryButtonText}>
                            {isSubmitting ? 'Submitting…' : 'Submit Feedback'}
                        </Text>
                    </View>
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
                title="What went well?"
                options={categoryOptions}
                selectedValue={category}
                emptyMessage="No feedback categories are available."
                onClose={() => setIsCategoryPickerOpen(false)}
                onSelect={(value) => {
                    setCategory(value as PositiveFeedbackCategory);
                    setIsCategoryPickerOpen(false);
                }}
            />
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    // Capped and centred so the form stays a comfortable reading width on a
    // tablet or a large phone in landscape, and full-width on a small phone.
    content: {
        padding: 20,
        paddingBottom: 40,
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
    },

    introCard: {
        flexDirection: 'row',
        backgroundColor: adminColors.successSoft,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#CFE8D1',
        padding: 14,
        marginTop: 4,
    },
    introBody: { flex: 1, marginLeft: 10 },
    introTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: SUCCESS_TEXT,
        marginBottom: 4,
    },
    introText: {
        fontSize: 13,
        color: SUCCESS_TEXT,
        lineHeight: 19,
    },
    introLink: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        minHeight: 44,
    },
    introLinkText: {
        fontSize: 13,
        fontWeight: '700',
        color: SUCCESS_TEXT,
        textDecorationLine: 'underline',
        marginRight: 2,
        flexShrink: 1,
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
    sectionHint: {
        fontSize: 13,
        color: adminColors.textMuted,
        lineHeight: 18,
        marginTop: -6,
        marginBottom: 12,
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
    buttonRow: { flexDirection: 'row', alignItems: 'center' },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: 0.6,
        marginLeft: 8,
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
        color: adminColors.textSecondary,
    },
});
