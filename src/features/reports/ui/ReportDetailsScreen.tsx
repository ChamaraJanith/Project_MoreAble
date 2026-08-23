import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    Alert,
    Dimensions,
    Image,
    Modal,
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
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { canDeleteReport, canEditReport } from '../utils/reportOwnership';
import { reportApiPath, reportEditPath } from '../utils/reportRoutes';
import {
    ReportDetailRow,
    ReportGalleryPhoto,
    reportCardSummary,
    reportGalleryPhotos,
    reportRouteRows,
    reportTimelineRows,
    reportVehicleRows,
} from '../utils/reportSummary';

/**
 * One accessibility report in full.
 *
 * Reached from a card on either tab, addressed by the report id in the path —
 * which is the only place that id appears. Everything stored on the report is
 * shown here: what went wrong, on which bus and route, when, and every photo
 * that was attached as evidence.
 *
 * Edit and Delete are drawn only for the passenger who filed it. That is a
 * courtesy, not the rule: PUT and DELETE /api/reports/[reportId] compare the
 * report against the verified token and refuse anybody else regardless.
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

    const isOwner = canEditReport(report, user?.passengerId);

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
        const vehicleRows = reportVehicleRows(report);
        const routeRows = reportRouteRows(report);
        const timelineRows = reportTimelineRows(report);
        const photos = reportGalleryPhotos(report);

        return (
            <>
                {/* ---------------- Issue ---------------- */}
                <View style={styles.card}>
                    <View style={styles.headlineRow}>
                        <View style={styles.categoryIconCircle}>
                            <Ionicons name={summary.icon} size={24} color={adminColors.primary} />
                        </View>

                        <View style={styles.headlineText}>
                            <Text style={styles.categoryText}>{summary.title}</Text>
                            <Text style={styles.headlineMeta}>{summary.submittedLabel}</Text>
                        </View>
                    </View>

                    <View style={styles.statusRow}>
                        <StatusBadge status={report.status} />
                    </View>
                </View>

                {/* ---------------- Description ---------------- */}
                <Text style={styles.sectionTitle}>Description</Text>

                <View style={styles.card}>
                    <Text style={styles.descriptionText}>{report.description}</Text>
                </View>

                {/* ---------------- Bus ---------------- */}
                <Text style={styles.sectionTitle}>Bus / Vehicle Details</Text>

                <View style={styles.card}>
                    {vehicleRows.length > 0 ? (
                        <DetailRows rows={vehicleRows} />
                    ) : (
                        <EmptySection
                            icon="bus-outline"
                            message="No bus details were recorded for this report."
                        />
                    )}
                </View>

                {/* ---------------- Route ---------------- */}
                <Text style={styles.sectionTitle}>Route Details</Text>

                <View style={styles.card}>
                    {routeRows.length > 0 ? (
                        <DetailRows rows={routeRows} />
                    ) : (
                        <EmptySection
                            icon="git-branch-outline"
                            message="No route details were recorded for this report."
                        />
                    )}
                </View>

                {/* ---------------- Photo evidence ---------------- */}
                <Text style={styles.sectionTitle}>Photo Evidence</Text>

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
                <Text style={styles.sectionTitle}>Report Timeline</Text>

                <View style={styles.card}>
                    <DetailRows rows={timelineRows} />
                </View>

                {/* ---------------- Owner actions ---------------- */}
                {isOwner && (
                    <>
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
                    </>
                )}
            </>
        );
    };

    const photos = report ? reportGalleryPhotos(report) : [];

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Report Details"
                subtitle="Everything recorded about this accessibility report"
            />

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
/** A label/value list, one row per stored field. */
function DetailRows({ rows }: { rows: ReportDetailRow[] }) {
    return (
        <>
            {rows.map((row, index) => (
                <View
                    key={row.label}
                    style={[styles.detailRow, index > 0 && styles.detailRowDivided]}
                >
                    <Ionicons name={row.icon} size={18} color={adminColors.textSecondary} />

                    <View style={styles.detailTextGroup}>
                        <Text style={styles.detailLabel}>{row.label}</Text>
                        <Text style={styles.detailValue}>{row.value}</Text>
                    </View>
                </View>
            ))}
        </>
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
            <Ionicons name={icon} size={20} color={adminColors.textPlaceholder} />
            <Text style={styles.emptySectionText}>{message}</Text>
        </View>
    );
}

// ------------------------------------------------------------------
const GALLERY_COLUMNS = 3;
const GALLERY_GAP = 10;

// The grid sits inside a card, itself inside a padded screen: 20pt of screen
// padding and 16pt of card padding on each side.
const GALLERY_TILE_SIZE = Math.floor(
    (Dimensions.get('window').width - 2 * 20 - 2 * 16 - GALLERY_GAP * (GALLERY_COLUMNS - 1)) /
        GALLERY_COLUMNS
);

/** Every attached photo, as tappable tiles. */
function PhotoGallery({
    photos,
    onOpen,
}: {
    photos: ReportGalleryPhoto[];
    onOpen: (index: number) => void;
}) {
    return (
        <>
            <View style={styles.galleryGrid}>
                {photos.map((photo, index) => (
                    <TouchableOpacity
                        key={photo.url}
                        style={styles.galleryTile}
                        onPress={() => onOpen(index)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={photo.accessibilityLabel}
                    >
                        <Image source={{ uri: photo.url }} style={styles.galleryImage} />
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
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 20,
    },

    headlineRow: { flexDirection: 'row', alignItems: 'center' },
    categoryIconCircle: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headlineText: { flex: 1, marginLeft: 14 },
    categoryText: {
        fontSize: 17,
        fontWeight: '800',
        color: adminColors.textPrimary,
    },
    headlineMeta: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 4,
    },
    statusRow: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 14,
        paddingTop: 14,
    },

    descriptionText: {
        fontSize: 14,
        color: adminColors.textSecondary,
        lineHeight: 21,
    },

    detailRow: { flexDirection: 'row', alignItems: 'flex-start' },
    detailRowDivided: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 12,
        paddingTop: 12,
    },
    detailTextGroup: { flex: 1, marginLeft: 12 },
    detailLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
    },
    detailValue: {
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
        marginTop: 3,
    },

    emptySection: { flexDirection: 'row', alignItems: 'center' },
    emptySectionText: {
        flex: 1,
        fontSize: 13,
        color: adminColors.textPlaceholder,
        marginLeft: 10,
        lineHeight: 19,
    },

    galleryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GALLERY_GAP,
    },
    galleryTile: {
        width: GALLERY_TILE_SIZE,
        height: GALLERY_TILE_SIZE,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: adminColors.borderSubtle,
    },
    galleryImage: { width: '100%', height: '100%' },
    galleryHint: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 12,
    },

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

    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primary,
        minHeight: 54,
        borderRadius: 12,
        marginTop: 24,
        ...adminShadow.card,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.4,
    },

    dangerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 54,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        backgroundColor: adminColors.dangerSoft,
        marginTop: 12,
    },
    dangerButtonText: {
        color: adminColors.danger,
        fontSize: 16,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.4,
    },
});
