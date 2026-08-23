import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    Alert,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
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
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { canDeleteReport, canEditReport } from '../utils/reportOwnership';
import { reportApiPath, reportEditPath } from '../utils/reportRoutes';
import {
    ReportGalleryPhoto,
    ReportJourneyEntry,
    galleryColumnsForWidth,
    hasBeenEdited,
    reportCardSummary,
    reportGalleryPhotos,
    reportJourneyEntries,
    reportTimelineRows,
} from '../utils/reportSummary';
import { CommunityFeedback } from './CommunityFeedback';

/**
 * One accessibility report in full.
 *
 * Reached from a card on either tab, addressed by the report id in the path —
 * which is the only place that id appears. Everything stored on the report is
 * shown here: what went wrong, on which bus and route, when, and every photo
 * that was attached as evidence.
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

        // Only once there is more than one moment to show: on an untouched
        // report the hero's submitted date is the whole timeline already.
        const timelineRows = hasBeenEdited(report) ? reportTimelineRows(report) : [];

        return (
            <>
                {/* ---------------- Hero ---------------- */}
                <View style={styles.hero}>
                    <View style={styles.heroIconCircle}>
                        <Ionicons name={summary.icon} size={30} color={adminColors.primary} />
                    </View>

                    <Text style={styles.heroTitle} accessibilityRole="header">
                        {summary.title}
                    </Text>

                    <View style={styles.heroBadge}>
                        <StatusBadge status={report.status} />
                    </View>

                    <Text style={styles.heroDate}>{summary.submittedLabel}</Text>
                </View>

                {/* ---------------- Issue ---------------- */}
                <SectionTitle>Issue Description</SectionTitle>

                <View style={styles.card}>
                    <Text style={styles.descriptionText}>{report.description}</Text>
                </View>

                {/* ---------------- Journey ---------------- */}
                <SectionTitle>Journey Details</SectionTitle>

                <View style={styles.card}>
                    {journey.map((entry, index) => (
                        <JourneyRow
                            key={entry.label}
                            entry={entry}
                            isFirst={index === 0}
                        />
                    ))}
                </View>

                {/* ---------------- Photo evidence ---------------- */}
                <SectionTitle>Photo Evidence</SectionTitle>

                <View style={styles.card}>
                    {photos.length > 0 ? (
                        <PhotoGallery photos={photos} onOpen={setViewerIndex} />
                    ) : (
                        <EmptySection
                            icon="images-outline"
                            message="No photos attached to this report."
                        />
                    )}
                </View>

                {/* ---------------- Timeline ---------------- */}
                {timelineRows.length > 0 && (
                    <>
                        <SectionTitle>Report Timeline</SectionTitle>

                        <View style={styles.card}>
                            {timelineRows.map((row, index) => (
                                <View
                                    key={row.label}
                                    style={[styles.timelineRow, index > 0 && styles.divided]}
                                >
                                    <Ionicons
                                        name={row.icon}
                                        size={16}
                                        color={adminColors.textSecondary}
                                    />
                                    <Text style={styles.timelineLabel}>{row.label}</Text>
                                    <Text style={styles.timelineValue}>{row.value}</Text>
                                </View>
                            ))}
                        </View>
                    </>
                )}

                {/* ---------------- Community feedback ---------------- */}
                <CommunityFeedback authorName={user?.userName} />

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

            <PhotoViewer
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

// ------------------------------------------------------------------
function SectionTitle({ children }: { children: string }) {
    return (
        <Text style={styles.sectionTitle} accessibilityRole="header">
            {children}
        </Text>
    );
}

/**
 * The bus, or the route.
 *
 * Both rows are always drawn. One the passenger did not fill in reads as "Not
 * provided" rather than vanishing, so the section keeps its shape and the
 * absence is stated instead of implied by a gap.
 */
function JourneyRow({ entry, isFirst }: { entry: ReportJourneyEntry; isFirst: boolean }) {
    const isMissing = !entry.primary;

    return (
        <View style={[styles.journeyRow, !isFirst && styles.divided]}>
            <View style={[styles.journeyIcon, isMissing && styles.journeyIconMuted]}>
                <Ionicons
                    name={entry.icon}
                    size={20}
                    color={isMissing ? adminColors.textPlaceholder : adminColors.primary}
                />
            </View>

            <View style={styles.journeyText}>
                <Text style={styles.journeyLabel}>{entry.label}</Text>

                {isMissing ? (
                    <Text style={styles.journeyMissing}>Not provided</Text>
                ) : (
                    <>
                        <Text style={styles.journeyPrimary}>{entry.primary}</Text>

                        {!!entry.secondary && (
                            <Text style={styles.journeySecondary}>{entry.secondary}</Text>
                        )}
                    </>
                )}
            </View>
        </View>
    );
}

/** Shown where a report simply has nothing recorded for a section. */
function EmptySection({
    icon,
    message,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    message: string;
}) {
    return (
        <View style={styles.emptySection}>
            <View style={styles.emptySectionIcon}>
                <Ionicons name={icon} size={20} color={adminColors.textPlaceholder} />
            </View>
            <Text style={styles.emptySectionText}>{message}</Text>
        </View>
    );
}

// ------------------------------------------------------------------
const GALLERY_GAP = 10;

// The grid sits inside a card, itself inside a padded screen: 20pt of screen
// padding and 16pt of card padding on each side.
const GALLERY_HORIZONTAL_INSET = 2 * 20 + 2 * 16;

/** Every attached photo, as square tiles that reflow with the screen width. */
function PhotoGallery({
    photos,
    onOpen,
}: {
    photos: ReportGalleryPhoto[];
    onOpen: (index: number) => void;
}) {
    const { width } = useWindowDimensions();

    const columns = galleryColumnsForWidth(width);
    const tileSize = Math.floor(
        (width - GALLERY_HORIZONTAL_INSET - GALLERY_GAP * (columns - 1)) / columns
    );

    return (
        <>
            <View style={styles.galleryGrid}>
                {photos.map((photo, index) => (
                    <TouchableOpacity
                        key={photo.url}
                        style={[styles.galleryTile, { width: tileSize }]}
                        onPress={() => onOpen(index)}
                        activeOpacity={0.8}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={photo.accessibilityLabel}
                    >
                        {/* Square and cropped to fill, so a portrait photo and
                            a landscape one sit in the grid the same way. */}
                        <Image
                            source={{ uri: photo.url }}
                            style={styles.galleryImage}
                            resizeMode="cover"
                        />
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={styles.galleryHint}>Tap a photo to view it full screen.</Text>
        </>
    );
}

/**
 * One photo, full screen.
 *
 * `index` doubles as the open/closed state: there is no separate visible flag
 * to fall out of step with which photo is being shown.
 */
function PhotoViewer({
    photos,
    index,
    onChangeIndex,
    onClose,
}: {
    photos: ReportGalleryPhoto[];
    index: number | null;
    onChangeIndex: (index: number) => void;
    onClose: () => void;
}) {
    const photo = index !== null ? photos[index] : undefined;

    return (
        <Modal
            visible={!!photo}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            supportedOrientations={['portrait', 'landscape']}
        >
            <View style={styles.viewerBackdrop}>
                <View style={styles.viewerBar}>
                    <Text style={styles.viewerCounter}>
                        {photo ? `Photo ${photo.position} of ${photo.total}` : ''}
                    </Text>

                    <TouchableOpacity
                        style={styles.viewerCloseButton}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close photo"
                    >
                        <Ionicons name="close" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>

                {!!photo && (
                    <Image
                        source={{ uri: photo.url }}
                        style={styles.viewerImage}
                        resizeMode="contain"
                        accessibilityLabel={`Photo evidence ${photo.position} of ${photo.total}`}
                    />
                )}

                {photos.length > 1 && index !== null && (
                    <View style={styles.viewerNav}>
                        <TouchableOpacity
                            style={[
                                styles.viewerNavButton,
                                index === 0 && styles.viewerNavButtonDisabled,
                            ]}
                            onPress={() => onChangeIndex(index - 1)}
                            disabled={index === 0}
                            accessibilityRole="button"
                            accessibilityLabel="Previous photo"
                            accessibilityState={{ disabled: index === 0 }}
                        >
                            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.viewerNavButton,
                                index === photos.length - 1 && styles.viewerNavButtonDisabled,
                            ]}
                            onPress={() => onChangeIndex(index + 1)}
                            disabled={index === photos.length - 1}
                            accessibilityRole="button"
                            accessibilityLabel="Next photo"
                            accessibilityState={{ disabled: index === photos.length - 1 }}
                        >
                            <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        padding: 16,
        ...adminShadow.card,
    },

    sectionTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 24,
        marginBottom: 10,
    },

    // ---- Hero ----
    hero: {
        backgroundColor: adminColors.surface,
        borderRadius: 16,
        paddingVertical: 24,
        paddingHorizontal: 20,
        alignItems: 'center',
        ...adminShadow.card,
    },
    heroIconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    heroTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: adminColors.textPrimary,
        textAlign: 'center',
        marginTop: 14,
    },
    heroBadge: { marginTop: 12 },
    heroDate: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 12,
    },

    descriptionText: {
        fontSize: 15,
        color: adminColors.textSecondary,
        lineHeight: 23,
    },

    // ---- Journey ----
    divided: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 14,
        paddingTop: 14,
    },
    journeyRow: { flexDirection: 'row', alignItems: 'center' },
    journeyIcon: {
        width: 42,
        height: 42,
        borderRadius: 12,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    journeyIconMuted: { backgroundColor: adminColors.surfaceMuted },
    journeyText: { flex: 1, marginLeft: 14 },
    journeyLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    journeyPrimary: {
        fontSize: 16,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginTop: 4,
    },
    journeySecondary: {
        fontSize: 13,
        color: adminColors.textSecondary,
        marginTop: 3,
    },
    journeyMissing: {
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPlaceholder,
        marginTop: 4,
    },

    // ---- Timeline ----
    timelineRow: { flexDirection: 'row', alignItems: 'center' },
    timelineLabel: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 10,
    },
    timelineValue: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },

    // ---- Empty section ----
    emptySection: { flexDirection: 'row', alignItems: 'center' },
    emptySectionIcon: {
        width: 42,
        height: 42,
        borderRadius: 12,
        backgroundColor: adminColors.surfaceMuted,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptySectionText: {
        flex: 1,
        fontSize: 14,
        color: adminColors.textPlaceholder,
        marginLeft: 14,
        lineHeight: 20,
    },

    // ---- Gallery ----
    galleryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GALLERY_GAP,
    },
    galleryTile: {
        aspectRatio: 1,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: adminColors.borderSubtle,
    },
    galleryImage: { width: '100%', height: '100%' },
    galleryHint: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 12,
    },

    // ---- Full-screen viewer ----
    viewerBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        justifyContent: 'center',
    },
    viewerBar: {
        position: 'absolute',
        top: 44,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 1,
    },
    viewerCounter: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    viewerCloseButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
    },
    viewerImage: { width: '100%', height: '78%' },
    viewerNav: {
        position: 'absolute',
        bottom: 44,
        left: 16,
        right: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    viewerNavButton: {
        width: 52,
        height: 52,
        borderRadius: 26,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
    },
    viewerNavButtonDisabled: { opacity: 0.3 },

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
