import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { AccessibilityReport } from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import {
    AdminEmptyState,
    AdminErrorState,
    AdminListSkeleton,
    ConfirmDialog,
} from '../../admin/ui/AdminStates';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { canDeleteReport, canEditReport } from '../utils/reportOwnership';
import { reportApiPath, reportEditPath } from '../utils/reportRoutes';
import {
    hasBeenEdited,
    reportCardSummary,
    reportGalleryPhotos,
    reportJourneyEntries,
    reportReviewOutcome,
    reportTimelineRows,
} from '../utils/reportSummary';
import { CommunityFeedback } from './CommunityFeedback';
import {
    ReportEmptySection,
    ReportHero,
    ReportJourneyRow,
    ReportPhotoGallery,
    ReportPhotoViewer,
    ReportSectionTitle,
    reportDetailStyles,
} from './ReportDetailSections';

/**
 * One accessibility report in full.
 *
 * Reached from a card on either tab, addressed by the report id in the path —
 * which is the only place that id appears. Everything stored on the report is
 * shown here: what went wrong, on which bus and route, when, and every photo
 * that was attached as evidence.
 *
 * The sections themselves live in ReportDetailSections, because the admin
 * review page (MOV-160) draws the same report and has to be looking at the same
 * thing the passenger filed rather than at a second rendering of it.
 *
 * Edit and Delete are drawn only for the passenger who filed it, and only here:
 * they are decisions worth a screen of context rather than a control on a list
 * row. That is still a courtesy, not the rule — PUT and DELETE
 * /api/reports/[reportId] compare the report against the verified token and
 * refuse anybody else regardless.
 */
export const ReportDetailsScreen = () => {
    const { token, user, isAuthenticated } = useAuthStore();
    const params = useLocalSearchParams<{ reportId?: string | string[] }>();

    // Expo Router hands back an array when a segment repeats; the first value
    // is the one that matched this screen.
    const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;

    const [report, setReport] = useState<AccessibilityReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isMissing, setIsMissing] = useState(false);

    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    /** Which photo the full-screen viewer is showing, or null when closed. */
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);

    const loadReport = useCallback(async () => {
        if (!reportId) {
            setIsMissing(true);
            setIsLoading(false);
            return;
        }

        if (!isAuthenticated || !token) {
            setError('Authentication required.');
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_BASE_URL}${reportApiPath(reportId)}`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });

            const result = await response.json().catch(() => ({}));

            if (response.status === 404) {
                setIsMissing(true);
                setReport(null);
            } else if (response.ok && result.success) {
                setReport(result.report);
                setIsMissing(false);
            } else {
                setError(result.message || 'Failed to retrieve the report.');
            }
        } catch (err) {
            console.error('Fetch Report Details Error:', err);
            setError('Failed to retrieve the report.');
        } finally {
            setIsLoading(false);
        }
    }, [reportId, isAuthenticated, token]);

    // Reloaded on focus, so returning from the edit form shows what was just
    // saved rather than what was on screen when it was opened.
    useFocusEffect(
        useCallback(() => {
            loadReport();
        }, [loadReport])
    );

    const handleDelete = async () => {
        if (!report || !token) return;

        setIsDeleting(true);

        try {
            const response = await fetch(`${API_BASE_URL}${reportApiPath(report.reportId)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });

            const result = await response.json().catch(() => ({}));

            if (response.ok && result.success) {
                setIsConfirmingDelete(false);

                // Back to the list, which reloads the visible tab on focus —
                // so the deleted report is gone by the time it is seen again.
                router.back();
                Alert.alert('Report Deleted', 'Your accessibility report has been deleted.');
            } else {
                Alert.alert(
                    'Unable to delete report',
                    result.message || 'Please check your connection and try again.'
                );
            }
        } catch (err) {
            console.error('Delete Report Error:', err);
            Alert.alert('Unable to delete report', 'Please check your connection and try again.');
        } finally {
            setIsDeleting(false);
        }
    };

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={3} />;

        if (isMissing) {
            return (
                <AdminEmptyState
                    icon="document-outline"
                    title="Report not available"
                    description="This accessibility report may have been deleted."
                />
            );
        }

        if (error || !report) {
            return (
                <AdminErrorState
                    title="Unable to load report"
                    message={`${error ?? 'Failed to retrieve the report.'} Please check your connection and try again.`}
                    retryLabel="Try Again"
                    onRetry={loadReport}
                />
            );
        }

        const summary = reportCardSummary(report);
        const journey = reportJourneyEntries(report);
        const photos = reportGalleryPhotos(report);
        const isOwner = canEditReport(report, user?.passengerId);

        // What an admin decided, if one has. Null on a report still waiting to
        // be looked at, where the hero's "Pending" badge is the whole story.
        const review = reportReviewOutcome(report);

        // Only once there is more than one moment to show: on an untouched
        // report the hero's submitted date is the whole timeline already.
        const timelineRows = hasBeenEdited(report) ? reportTimelineRows(report) : [];

        return (
            <>
                {/* ---------------- Hero ---------------- */}
                <ReportHero
                    icon={summary.icon}
                    title={summary.title}
                    status={report.status}
                    submittedLabel={summary.submittedLabel}
                />

                {/* ---------------- Issue ---------------- */}
                <ReportSectionTitle>Issue Description</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    <Text style={reportDetailStyles.descriptionText}>{report.description}</Text>
                </View>

                {/* ---------------- Journey ---------------- */}
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

                {/* ---------------- Photo evidence ---------------- */}
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

                {/* ---------------- Timeline ---------------- */}
                {timelineRows.length > 0 && (
                    <>
                        <ReportSectionTitle>Report Timeline</ReportSectionTitle>

                        <View style={reportDetailStyles.card}>
                            {timelineRows.map((row, index) => (
                                <View
                                    key={row.label}
                                    style={[
                                        reportDetailStyles.timelineRow,
                                        index > 0 && reportDetailStyles.divided,
                                    ]}
                                >
                                    <Ionicons
                                        name={row.icon}
                                        size={16}
                                        color={adminColors.textSecondary}
                                    />
                                    <Text style={reportDetailStyles.timelineLabel}>
                                        {row.label}
                                    </Text>
                                    <Text style={reportDetailStyles.timelineValue}>
                                        {row.value}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </>
                )}

                {/* ---------------- Admin review ----------------
                    The answer to the report the passenger filed: what was
                    decided, when, and anything the admin wrote about it. Drawn
                    only once there is a review to show — a heading over an
                    empty card reads as a decision that has been made. */}
                {review && (
                    <>
                        <ReportSectionTitle>Admin Review</ReportSectionTitle>

                        <View style={reportDetailStyles.card}>
                            <View style={reportDetailStyles.timelineRow}>
                                <Ionicons
                                    name="shield-checkmark-outline"
                                    size={16}
                                    color={adminColors.textSecondary}
                                />
                                <Text style={reportDetailStyles.timelineLabel}>
                                    Decision
                                </Text>
                                <Text style={reportDetailStyles.timelineValue}>
                                    {review.statusLabel}
                                </Text>
                            </View>

                            {!!review.reviewedAt && (
                                <View
                                    style={[
                                        reportDetailStyles.timelineRow,
                                        reportDetailStyles.divided,
                                    ]}
                                >
                                    <Ionicons
                                        name="time-outline"
                                        size={16}
                                        color={adminColors.textSecondary}
                                    />
                                    <Text style={reportDetailStyles.timelineLabel}>
                                        Reviewed
                                    </Text>
                                    <Text style={reportDetailStyles.timelineValue}>
                                        {review.reviewedAt}
                                    </Text>
                                </View>
                            )}

                            {!!review.remark && (
                                <View style={reportDetailStyles.divided}>
                                    <Text style={styles.remarkLabel}>
                                        Administrator&apos;s remark
                                    </Text>
                                    <Text style={reportDetailStyles.descriptionText}>
                                        {review.remark}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </>
                )}

                {/* ---------------- Community feedback ----------------
                    Loads and fails on its own: the votes and the thread come
                    from their own endpoints, so a feedback request that does
                    not come back costs this card and not the report above it.
                    Who is voting comes off the token inside those calls — the
                    report id is all this screen has to hand over. */}
                <CommunityFeedback reportId={report.reportId} token={token} />

                {/* ---------------- Owner actions ---------------- */}
                {isOwner && (
                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => router.push(reportEditPath(report.reportId) as Href)}
                            accessibilityRole="button"
                            accessibilityLabel="Edit Report"
                        >
                            <Ionicons name="create-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.primaryButtonText}>Edit Report</Text>
                        </TouchableOpacity>

                        {canDeleteReport(report, user?.passengerId) && (
                            <TouchableOpacity
                                style={styles.dangerButton}
                                onPress={() => setIsConfirmingDelete(true)}
                                accessibilityRole="button"
                                accessibilityLabel="Delete Report"
                            >
                                <Ionicons
                                    name="trash-outline"
                                    size={18}
                                    color={adminColors.danger}
                                />
                                <Text style={styles.dangerButtonText}>Delete Report</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}
            </>
        );
    };

    const photos = report ? reportGalleryPhotos(report) : [];

    return (
        <View style={styles.container}>
            <AdminScreenHeader title="Report Details" />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {renderBody()}
            </ScrollView>

            <ReportPhotoViewer
                photos={photos}
                index={viewerIndex}
                onChangeIndex={setViewerIndex}
                onClose={() => setViewerIndex(null)}
            />

            <ConfirmDialog
                visible={isConfirmingDelete}
                title="Delete Report"
                message="Are you sure you want to delete this report?"
                confirmLabel="Delete Report"
                destructive
                isBusy={isDeleting}
                onCancel={() => setIsConfirmingDelete(false)}
                onConfirm={handleDelete}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    // ---- Admin review ----
    remarkLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginBottom: 6,
    },

    // ---- Owner actions ----
    actions: { marginTop: 28 },
    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primary,
        minHeight: 52,
        borderRadius: 12,
        ...adminShadow.card,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.3,
    },
    dangerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 52,
        borderRadius: 12,
        marginTop: 10,
    },
    dangerButtonText: {
        color: adminColors.danger,
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.3,
    },
});
