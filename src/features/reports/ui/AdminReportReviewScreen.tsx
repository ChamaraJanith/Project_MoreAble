import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useReducer, useRef, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { ReportReviewAction } from '../../../entities/report/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import {
    AdminEmptyState,
    AdminErrorState,
    AdminListSkeleton,
    ConfirmDialog,
} from '../../admin/ui/AdminStates';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { fetchReportForReview, submitReportReview } from '../api/reportReviewApi';
import {
    MAX_ADMIN_REMARK_LENGTH,
    NEEDS_REVIEW_LABEL,
    REJECT_ACTION,
    REMARK_ACTION,
    VERIFY_ACTION,
    canDecideReport,
    remarkToSubmit,
    reportStatusLabel,
    reviewErrorMessage,
    reviewStatusOf,
    shouldReloadAfterFailure,
} from '../utils/reportReview';
import { formatReportDateTime } from '../utils/reportFormat';
import {
    initialRemarkDraft,
    initialReviewState,
    isActionPending,
    isReviewBusy,
    reportReviewReducer,
    shouldSendDecision,
    shouldSendRemark,
} from '../utils/reportReviewState';
import {
    reportCardSummary,
    reportGalleryPhotos,
    reportJourneyEntries,
} from '../utils/reportSummary';
import { CommentRow } from './FeedbackComments';
import {
    ReportEmptySection,
    ReportHero,
    ReportJourneyRow,
    ReportPhotoGallery,
    ReportPhotoViewer,
    ReportSectionTitle,
    reportDetailStyles,
} from './ReportDetailSections';
import { ReportTextArea } from './ReportFormFields';

/** What each decision is called, and what the admin is asked to confirm. */
const DECISION_COPY: Record<
    'VERIFY' | 'REJECT',
    { title: string; message: string; confirmLabel: string }
> = {
    VERIFY: {
        title: 'Verify Report?',
        message:
            'Verifying confirms this accessibility issue is genuine. The decision is recorded against your account and cannot be changed afterwards.',
        confirmLabel: 'Verify Report',
    },
    REJECT: {
        title: 'Reject Report?',
        message:
            'Rejecting marks this accessibility issue as not upheld. The decision is recorded against your account and cannot be changed afterwards.',
        confirmLabel: 'Reject Report',
    },
};

/**
 * One accessibility report, as the administrator deciding it reads it (MOV-160).
 *
 * The page is ordered by what a decision actually needs, in that order: where
 * the report stands and whether the community flagged it, what went wrong, on
 * which bus and route, the photo evidence, what other passengers made of it,
 * the remark, and only then the two buttons that decide it.
 *
 * Everything above those buttons is drawn from the same components the
 * passenger's details screen uses, so the reviewer is looking at what was
 * filed rather than at a second rendering of it. Everything on it comes from
 * GET /api/reports/:reportId/review in one request — no count, status or
 * comment on this screen is assembled locally.
 *
 * Verify and Reject are offered only from PENDING. The API answers 409 on a
 * report that has already been decided, because the review is a record of what
 * was found and overwriting it would erase who found it and when — so drawing
 * the buttons there would be offering an action that cannot succeed. A remark
 * carries no decision, so it stays available for the life of the report.
 */
export const AdminReportReviewScreen = () => {
    const { token, isAuthenticated } = useAuthStore();
    const params = useLocalSearchParams<{ reportId?: string | string[] }>();

    // Expo Router hands back an array when a segment repeats; the first value
    // is the one that matched this screen.
    const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;

    const [state, dispatch] = useReducer(reportReviewReducer, initialReviewState);

    const [remark, setRemark] = useState('');

    // Whether the stored remark has already been put in the box. A ref rather
    // than state because nothing renders from it, and it has to be up to date
    // by the time the next load reads it rather than after the next commit.
    const hasLoadedRemark = useRef(false);

    /** The decision awaiting confirmation, or null when no dialog is open. */
    const [confirming, setConfirming] = useState<'VERIFY' | 'REJECT' | null>(null);

    /** Which photo the full-screen viewer is showing, or null when closed. */
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);

    const loadReport = useCallback(async () => {
        if (!reportId) {
            dispatch({ type: 'reportMissing' });
            return;
        }

        if (!isAuthenticated || !token) {
            dispatch({ type: 'loadFailed', message: reviewErrorMessage(401) });
            return;
        }

        dispatch({ type: 'loadStarted' });

        const result = await fetchReportForReview(reportId, token);

        if (result.ok) {
            dispatch({
                type: 'loadSucceeded',
                report: result.value.report,
                comments: result.value.comments,
            });

            // The stored remark fills the box the first time only. Refilling it
            // on every reload would wipe out whatever the admin had started
            // typing when the page refreshed underneath them.
            if (!hasLoadedRemark.current) {
                hasLoadedRemark.current = true;
                setRemark(initialRemarkDraft(result.value.report));
            }

            return;
        }

        if (result.status === 404) {
            dispatch({ type: 'reportMissing' });
            return;
        }

        dispatch({
            type: 'loadFailed',
            message: reviewErrorMessage(result.status, result.message),
        });
    }, [reportId, isAuthenticated, token]);

    // Reloaded on focus, so a report decided elsewhere is not still showing a
    // Verify button when this screen comes back into view.
    useFocusEffect(
        useCallback(() => {
            loadReport();
        }, [loadReport])
    );

    /**
     * Records one decision or remark.
     *
     * The guard is the reducer's, not this function's: `pendingAction` is what
     * says something is already in flight, and it is the same value the buttons
     * draw themselves busy and disabled from — so a second press cannot become
     * a second request even if it lands before React has re-rendered.
     *
     * On success the report the API returned goes on screen immediately, and
     * the page is reloaded behind it so the tallies and the thread are the
     * server's too. On a 404 or a 409 the report on screen is a description of
     * something that no longer exists in that form, so it reloads there as well
     * rather than leaving a stale decision on offer.
     */
    const runAction = useCallback(
        async (action: ReportReviewAction) => {
            if (!reportId || !token) return;

            dispatch({ type: 'actionStarted', action });

            const result = await submitReportReview(
                reportId,
                action,
                token,
                action === REMARK_ACTION ? remarkToSubmit(remark) : undefined
            );

            if (result.ok) {
                dispatch({
                    type: 'actionSucceeded',
                    report: result.value.report,
                    message: result.value.message,
                });

                loadReport();
                return;
            }

            dispatch({
                type: 'actionFailed',
                message: reviewErrorMessage(result.status, result.message),
            });

            if (shouldReloadAfterFailure(result.status)) loadReport();
        },
        [reportId, token, remark, loadReport]
    );

    const confirmDecision = () => {
        if (!confirming) return;

        const action = confirming === 'VERIFY' ? VERIFY_ACTION : REJECT_ACTION;

        setConfirming(null);

        // Re-checked at the moment of confirming, not only when the button was
        // pressed: the page reloads on focus and after every action, so the
        // report can have been decided by somebody else while this dialog sat
        // open.
        if (!shouldSendDecision(state)) return;

        runAction(action);
    };

    const handleSaveRemark = () => {
        if (!shouldSendRemark(state, remark)) return;

        runAction(REMARK_ACTION);
    };

    const { report } = state;

    const renderBody = () => {
        // A reload with a report already on screen keeps drawing it: the
        // skeleton belongs to the first read, not to the refresh that follows a
        // decision.
        if (state.status === 'loading' && !report) return <AdminListSkeleton count={3} />;

        if (state.status === 'missing') {
            return (
                <AdminEmptyState
                    icon="document-outline"
                    title="Report not available"
                    description="This accessibility report may have been deleted."
                />
            );
        }

        if (!report) {
            return (
                <AdminErrorState
                    title="Unable to load report"
                    message={state.loadError ?? reviewErrorMessage(undefined)}
                    retryLabel="Try Again"
                    onRetry={loadReport}
                />
            );
        }

        const summary = reportCardSummary(report);
        const journey = reportJourneyEntries(report);
        const photos = reportGalleryPhotos(report);

        const status = reviewStatusOf(report);
        const isDecidable = canDecideReport(report);
        const busy = isReviewBusy(state);

        return (
            <>
                {/* ---------------- 1. Status and review flag ---------------- */}
                <ReportHero
                    icon={summary.icon}
                    title={summary.title}
                    status={status}
                    submittedLabel={summary.submittedLabel}
                >
                    {report.flagged && (
                        <View style={styles.flagBanner}>
                            <Ionicons name="flag" size={14} color={adminColors.warning} />
                            <Text style={styles.flagText}>{NEEDS_REVIEW_LABEL}</Text>
                        </View>
                    )}
                </ReportHero>

                {/* The load kept the last report on screen while it refreshed;
                    this is what says so rather than letting the page look
                    simply idle. */}
                {state.status === 'loading' && (
                    <View style={styles.refreshing} accessibilityLiveRegion="polite">
                        <ActivityIndicator size="small" color={adminColors.primary} />
                        <Text style={styles.refreshingText}>Refreshing report…</Text>
                    </View>
                )}

                {state.loadError && <InlineMessage tone="error" message={state.loadError} />}

                {/* ---------------- 2. Issue ---------------- */}
                <ReportSectionTitle>Issue Description</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    <Text style={reportDetailStyles.descriptionText}>{report.description}</Text>
                </View>

                {/* ---------------- 3. Bus and route ---------------- */}
                <ReportSectionTitle>Journey Details</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    {journey.map((entry, index) => (
                        <ReportJourneyRow
                            key={entry.label}
                            entry={entry}
                            isFirst={index === 0}
                        />
                    ))}
                </View>

                {/* ---------------- 4. Photo evidence ---------------- */}
                <ReportSectionTitle>Photo Evidence</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    {photos.length > 0 ? (
                        <ReportPhotoGallery photos={photos} onOpen={setViewerIndex} />
                    ) : (
                        <ReportEmptySection
                            icon="images-outline"
                            message="No photos attached to this report."
                        />
                    )}
                </View>

                {/* ---------------- 5. Community feedback ----------------
                    Read only. The reviewer is deciding what the community
                    reported, not adding a voice to it — so the tallies and the
                    thread are shown and neither the vote pills nor the comment
                    composer are. */}
                <ReportSectionTitle>Community Feedback</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    <View style={styles.tallyRow}>
                        <Tally
                            icon="thumbs-up-outline"
                            label="Agree"
                            count={report.agreeCount}
                            tint={adminColors.success}
                        />
                        <Tally
                            icon="thumbs-down-outline"
                            label="Disagree"
                            count={report.disagreeCount}
                            tint={adminColors.danger}
                        />
                        <Tally
                            icon="chatbubble-outline"
                            label="Comments"
                            count={report.commentCount}
                            tint={adminColors.primary}
                        />
                    </View>
                </View>

                <ReportSectionTitle>Community Comments</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    {state.comments.length > 0 ? (
                        state.comments.map((comment, index) => (
                            <CommentRow
                                key={comment.commentId}
                                comment={comment}
                                isFirst={index === 0}
                            />
                        ))
                    ) : (
                        <ReportEmptySection
                            icon="chatbubble-ellipses-outline"
                            message="No passengers have commented on this report."
                        />
                    )}
                </View>

                {/* ---------------- 6. Admin remark ---------------- */}
                <ReportSectionTitle>Admin Review</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    {/* The review already recorded, if there is one. Shown
                        above the composer because it is what the report says
                        now, not what is being written about it. */}
                    {report.review ? (
                        <View style={styles.existingReview}>
                            <View style={styles.reviewRow}>
                                <Ionicons
                                    name="shield-checkmark-outline"
                                    size={16}
                                    color={adminColors.textSecondary}
                                />
                                <Text style={styles.reviewLabel}>Decision</Text>
                                <Text style={styles.reviewValue}>
                                    {reportStatusLabel(report.review.status ?? status)}
                                </Text>
                            </View>

                            {!!report.review.reviewedAt && (
                                <View style={[styles.reviewRow, reportDetailStyles.divided]}>
                                    <Ionicons
                                        name="time-outline"
                                        size={16}
                                        color={adminColors.textSecondary}
                                    />
                                    <Text style={styles.reviewLabel}>Reviewed</Text>
                                    <Text style={styles.reviewValue}>
                                        {formatReportDateTime(report.review.reviewedAt)}
                                    </Text>
                                </View>
                            )}

                            {!!report.review.adminRemark && (
                                <View style={styles.remarkQuote}>
                                    <Text style={styles.remarkQuoteLabel}>Current remark</Text>
                                    <Text style={styles.remarkQuoteText}>
                                        {report.review.adminRemark}
                                    </Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        <ReportEmptySection
                            icon="clipboard-outline"
                            message="No administrator has reviewed this report yet."
                        />
                    )}

                    <View style={styles.remarkComposer}>
                        <ReportTextArea
                            label="Admin Remark"
                            value={remark}
                            onChangeText={setRemark}
                            placeholder="Record what you found when reviewing this report..."
                            helper="Visible to administrators. Saving a remark does not change the report's status."
                            maxLength={MAX_ADMIN_REMARK_LENGTH}
                            editable={!busy}
                        />

                        <TouchableOpacity
                            style={[
                                styles.secondaryButton,
                                !shouldSendRemark(state, remark) && styles.buttonDisabled,
                            ]}
                            onPress={handleSaveRemark}
                            disabled={!shouldSendRemark(state, remark)}
                            accessibilityRole="button"
                            accessibilityLabel="Save Remark"
                            accessibilityState={{
                                disabled: !shouldSendRemark(state, remark),
                                busy: isActionPending(state, REMARK_ACTION),
                            }}
                        >
                            {isActionPending(state, REMARK_ACTION) ? (
                                <ActivityIndicator size="small" color={adminColors.primary} />
                            ) : (
                                <Ionicons
                                    name="save-outline"
                                    size={18}
                                    color={adminColors.primary}
                                />
                            )}
                            <Text style={styles.secondaryButtonText}>
                                {isActionPending(state, REMARK_ACTION)
                                    ? 'Saving…'
                                    : 'Save Remark'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Said where the action was taken, and announced. */}
                {state.actionError && (
                    <InlineMessage tone="error" message={state.actionError} />
                )}
                {state.successMessage && (
                    <InlineMessage tone="success" message={state.successMessage} />
                )}

                {/* ---------------- 7. Decisions ---------------- */}
                {isDecidable ? (
                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.verifyButton, busy && styles.buttonDisabled]}
                            onPress={() => setConfirming('VERIFY')}
                            disabled={!shouldSendDecision(state)}
                            accessibilityRole="button"
                            accessibilityLabel="Verify Report"
                            accessibilityState={{
                                disabled: !shouldSendDecision(state),
                                busy: isActionPending(state, VERIFY_ACTION),
                            }}
                        >
                            {isActionPending(state, VERIFY_ACTION) ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                                <Ionicons
                                    name="shield-checkmark"
                                    size={18}
                                    color="#FFFFFF"
                                />
                            )}
                            <Text style={styles.verifyButtonText}>
                                {isActionPending(state, VERIFY_ACTION)
                                    ? 'Verifying…'
                                    : 'Verify Report'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.rejectButton, busy && styles.buttonDisabled]}
                            onPress={() => setConfirming('REJECT')}
                            disabled={!shouldSendDecision(state)}
                            accessibilityRole="button"
                            accessibilityLabel="Reject Report"
                            accessibilityState={{
                                disabled: !shouldSendDecision(state),
                                busy: isActionPending(state, REJECT_ACTION),
                            }}
                        >
                            {isActionPending(state, REJECT_ACTION) ? (
                                <ActivityIndicator
                                    size="small"
                                    color={adminColors.danger}
                                />
                            ) : (
                                <Ionicons
                                    name="close-circle-outline"
                                    size={18}
                                    color={adminColors.danger}
                                />
                            )}
                            <Text style={styles.rejectButtonText}>
                                {isActionPending(state, REJECT_ACTION)
                                    ? 'Rejecting…'
                                    : 'Reject Report'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    // No Verify or Reject on a decided report. The API answers
                    // 409, and the decision is a record rather than a setting —
                    // so this states the outcome instead of offering to undo it.
                    <View style={styles.decidedNotice} accessibilityLiveRegion="polite">
                        <StatusBadge status={status} />
                        <Text style={styles.decidedText}>
                            This report has already been reviewed. A remark can still be
                            added, but the decision cannot be changed.
                        </Text>
                    </View>
                )}
            </>
        );
    };

    const photos = report ? reportGalleryPhotos(report) : [];

    return (
        <View style={styles.container}>
            <AdminScreenHeader title="Review Report" />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {renderBody()}
            </ScrollView>

            <ReportPhotoViewer
                photos={photos}
                index={viewerIndex}
                onChangeIndex={setViewerIndex}
                onClose={() => setViewerIndex(null)}
            />

            {/* Nothing is decided without being confirmed first: both outcomes
                are recorded against this admin and neither can be taken back. */}
            <ConfirmDialog
                visible={confirming !== null}
                title={confirming ? DECISION_COPY[confirming].title : ''}
                message={confirming ? DECISION_COPY[confirming].message : ''}
                confirmLabel={confirming ? DECISION_COPY[confirming].confirmLabel : ''}
                destructive={confirming === 'REJECT'}
                isBusy={isReviewBusy(state)}
                onCancel={() => setConfirming(null)}
                onConfirm={confirmDecision}
            />
        </View>
    );
};

// ------------------------------------------------------------------

/** One community tally, as a counted icon. Always a number the API returned. */
function Tally({
    icon,
    label,
    count,
    tint,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    count: number;
    tint: string;
}) {
    return (
        <View style={styles.tally} accessibilityLabel={`${count} ${label.toLowerCase()}`}>
            <Ionicons name={icon} size={18} color={tint} />
            <Text style={[styles.tallyCount, { color: tint }]}>{count}</Text>
            <Text style={styles.tallyLabel}>{label}</Text>
        </View>
    );
}

/**
 * Something that happened, said in place.
 *
 * Announced politely rather than assertively: it interrupts nothing, and an
 * admin who has just pressed something is already listening.
 */
function InlineMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
    const isError = tone === 'error';

    return (
        <View
            style={[styles.inlineMessage, isError ? styles.inlineError : styles.inlineSuccess]}
            accessibilityLiveRegion="polite"
        >
            <Ionicons
                name={isError ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                size={16}
                color={isError ? adminColors.danger : adminColors.success}
            />
            <Text
                style={[
                    styles.inlineMessageText,
                    { color: isError ? adminColors.danger : adminColors.success },
                ]}
            >
                {message}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    // ---- Review flag ----
    flagBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.warningSoft,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginTop: 12,
    },
    flagText: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.warning,
        marginLeft: 5,
        letterSpacing: 0.2,
    },

    refreshing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        marginTop: 12,
    },
    refreshingText: {
        fontSize: 12,
        color: adminColors.textMuted,
    },

    // ---- Community tallies ----
    tallyRow: { flexDirection: 'row' },
    tally: { flex: 1, alignItems: 'center' },
    tallyCount: {
        fontSize: 20,
        fontWeight: '800',
        marginTop: 6,
        fontVariant: ['tabular-nums'],
    },
    tallyLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        marginTop: 3,
    },

    // ---- Existing review ----
    existingReview: { marginBottom: 4 },
    reviewRow: { flexDirection: 'row', alignItems: 'center' },
    reviewLabel: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 10,
    },
    reviewValue: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    remarkQuote: {
        backgroundColor: adminColors.surfaceMuted,
        borderLeftWidth: 3,
        borderLeftColor: adminColors.primary,
        borderRadius: 10,
        padding: 13,
        marginTop: 14,
    },
    remarkQuoteLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    remarkQuoteText: {
        fontSize: 14,
        color: adminColors.textPrimary,
        lineHeight: 21,
        marginTop: 6,
    },

    remarkComposer: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 16,
        paddingTop: 16,
    },

    // ---- Feedback ----
    inlineMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 10,
        paddingHorizontal: 13,
        paddingVertical: 11,
        marginTop: 16,
    },
    inlineError: { backgroundColor: adminColors.dangerSoft },
    inlineSuccess: { backgroundColor: adminColors.successSoft },
    inlineMessageText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 19,
        marginLeft: 8,
    },

    // ---- Decisions ----
    actions: { marginTop: 28 },
    verifyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primary,
        minHeight: 52,
        borderRadius: 12,
        ...adminShadow.card,
    },
    verifyButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.3,
    },
    rejectButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.surface,
        borderWidth: 1.5,
        borderColor: adminColors.dangerBorder,
        minHeight: 52,
        borderRadius: 12,
        marginTop: 10,
    },
    rejectButtonText: {
        color: adminColors.danger,
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.3,
    },
    secondaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primarySoft,
        minHeight: 48,
        borderRadius: 12,
        marginTop: 12,
    },
    secondaryButtonText: {
        color: adminColors.primary,
        fontSize: 14,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.2,
    },
    buttonDisabled: { opacity: 0.5 },

    decidedNotice: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginTop: 28,
        alignItems: 'center',
        ...adminShadow.card,
    },
    decidedText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 20,
        textAlign: 'center',
        marginTop: 10,
    },
});
