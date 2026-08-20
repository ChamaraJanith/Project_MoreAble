import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { AccessibilityReport, ReportScope } from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { formatPhotoCount, formatReportDateTime } from '../utils/reportFormat';
import { reportCategoryIcon, reportCategoryLabel } from './reportCategories';

const SCOPE_TABS: { value: ReportScope; label: string }[] = [
    { value: 'all', label: 'All Reports' },
    { value: 'my', label: 'My Reports' },
    { value: 'verified', label: 'Verified Reports' },
];

const ALL_REPORTS_EMPTY_STATE = {
    icon: 'documents-outline' as keyof typeof Ionicons.glyphMap,
    title: 'No accessibility reports yet',
    description: 'Reports submitted by passengers will appear here.',
};

/**
 * "My Reports" and "Verified Reports" are presentation-only for now: their
 * backend scopes are not implemented yet, so these tabs deliberately render a
 * placeholder instead of querying `/api/reports`.
 */
type PlaceholderScope = Exclude<ReportScope, 'all'>;

const PLACEHOLDER_SECTIONS: Record<
    PlaceholderScope,
    {
        icon: keyof typeof Ionicons.glyphMap;
        title: string;
        description: string;
        secondaryDescription: string;
    }
> = {
    my: {
        icon: 'document-text-outline',
        title: 'My Reports',
        description: 'Your submitted reports will appear here.',
        secondaryDescription: 'Report history will be available in a later update.',
    },
    verified: {
        icon: 'checkmark-circle-outline',
        title: 'Verified Reports',
        description: 'Verified accessibility reports will appear here.',
        secondaryDescription:
            'This section will be connected to verified reports in a later update.',
    },
};

export const AccessibilityReportsScreen = () => {
    const { token, user, isAuthenticated } = useAuthStore();

    const [reports, setReports] = useState<AccessibilityReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [scope, setScope] = useState<ReportScope>('all');

    const fetchReports = useCallback(
        async (mode: 'initial' | 'refresh' = 'initial') => {
            if (!isAuthenticated || !token) {
                setError('Authentication required.');
                setIsLoading(false);
                setIsRefreshing(false);
                return;
            }

            if (mode === 'refresh') setIsRefreshing(true);
            else setIsLoading(true);
            setError(null);

            try {
                // Always the `all` scope — the `my` and `verified` scopes are not
                // fetched at all while their tabs are placeholders.
                const response = await fetch(`${API_BASE_URL}/api/reports?scope=all`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const result = await response.json().catch(() => ({}));

                if (response.ok && result.success) {
                    setReports(result.reports || []);
                } else {
                    setError(result.message || 'Failed to retrieve accessibility reports.');
                }
            } catch (err) {
                console.error('Fetch Reports Error:', err);
                setError('Failed to retrieve accessibility reports.');
            } finally {
                setIsLoading(false);
                setIsRefreshing(false);
            }
        },
        [isAuthenticated, token]
    );

    // Reload on focus so a report submitted on the form screen shows immediately.
    // `scope` is intentionally not a dependency: switching tabs must never fire a
    // request, and returning to All Reports reuses the data already loaded.
    useFocusEffect(
        useCallback(() => {
            fetchReports();
        }, [fetchReports])
    );

    const goToReportForm = () => router.push('/reports');

    const renderBody = () => {
        // Checked first so a placeholder tab never shows the All Reports loading
        // skeleton or a backend error it had no part in.
        if (scope !== 'all') return <ComingSoonSection scope={scope} />;

        if (isLoading) return <AdminListSkeleton count={3} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load reports"
                    message={`${error} Please check your connection and try again.`}
                    retryLabel="Try Again"
                    onRetry={() => fetchReports()}
                />
            );
        }

        if (reports.length === 0) {
            return (
                <AdminEmptyState
                    icon={ALL_REPORTS_EMPTY_STATE.icon}
                    title={ALL_REPORTS_EMPTY_STATE.title}
                    description={ALL_REPORTS_EMPTY_STATE.description}
                    actionLabel="Report Accessibility Issue"
                    onAction={goToReportForm}
                />
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {reports.length} report{reports.length === 1 ? '' : 's'}
                </Text>

                {reports.map((report) => (
                    <ReportCard
                        key={report.reportId}
                        report={report}
                        isOwnReport={!!user?.passengerId && report.passengerId === user.passengerId}
                    />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Accessibility Reports"
                subtitle="Track accessibility issues reported across the network"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    // Pull-to-refresh belongs only to the tab backed by the API.
                    scope === 'all' ? (
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={() => fetchReports('refresh')}
                        />
                    ) : undefined
                }
            >
                {/* Primary action */}
                <TouchableOpacity
                    style={styles.createButton}
                    onPress={goToReportForm}
                    accessibilityRole="button"
                    accessibilityLabel="Report Accessibility Issue"
                >
                    <Ionicons name="add-circle-outline" size={22} color="#FFFFFF" />
                    <Text style={styles.createButtonText}>Report Accessibility Issue</Text>
                </TouchableOpacity>

                {/* Scope tabs */}
                <View style={styles.segmentedControl} accessibilityRole="tablist">
                    {SCOPE_TABS.map((tab) => {
                        const isSelected = scope === tab.value;

                        return (
                            <TouchableOpacity
                                key={tab.value}
                                style={[styles.segment, isSelected && styles.segmentSelected]}
                                onPress={() => setScope(tab.value)}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: isSelected }}
                                accessibilityLabel={`View ${tab.label}`}
                            >
                                <Text
                                    style={[styles.segmentText, isSelected && styles.segmentTextSelected]}
                                    numberOfLines={1}
                                >
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
/**
 * Placeholder for a tab whose backend scope is not implemented yet. Renders no
 * loading or error state because it never talks to the API.
 */
function ComingSoonSection({ scope }: { scope: PlaceholderScope }) {
    const section = PLACEHOLDER_SECTIONS[scope];

    return (
        <View>
            <View style={styles.comingSoonBadge}>
                <Ionicons name="time-outline" size={12} color={adminColors.warning} />
                <Text style={styles.comingSoonText}>Coming Soon</Text>
            </View>

            <AdminEmptyState
                icon={section.icon}
                title={section.title}
                description={section.description}
                secondaryDescription={section.secondaryDescription}
            />
        </View>
    );
}

// ------------------------------------------------------------------
interface ReportCardProps {
    report: AccessibilityReport;
    isOwnReport: boolean;
}

function ReportCard({ report, isOwnReport }: ReportCardProps) {
    // Photo evidence is still UI-only, so a count only appears once the API
    // starts returning one of these fields.
    const photoCount = report.photoCount ?? report.photoUrls?.length ?? 0;

    // Prefer the display snapshot taken when the report was filed; fall back to
    // the raw id so a report whose snapshot is missing still identifies its bus.
    const busLabel = report.vehicle?.numberPlate ?? report.busId;
    const routeLabel = report.route?.routeNumber
        ? `Route ${report.route.routeNumber}`
        : report.routeId;

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <View style={styles.categoryIconCircle}>
                    <Ionicons
                        name={reportCategoryIcon(report.issueCategory)}
                        size={22}
                        color={adminColors.primary}
                    />
                </View>

                <View style={styles.cardHeadings}>
                    <Text style={styles.categoryText} numberOfLines={2}>
                        {reportCategoryLabel(report.issueCategory)}
                    </Text>
                    <Text style={styles.reportIdText} numberOfLines={1}>
                        {report.reportId}
                    </Text>
                </View>

                <StatusBadge status={report.status} size="small" />
            </View>

            <Text style={styles.descriptionText} numberOfLines={3}>
                {report.description}
            </Text>

            {(!!busLabel || !!routeLabel || photoCount > 0 || isOwnReport) && (
                <View style={styles.chipWrap}>
                    {!!busLabel && <MetaChip icon="bus-outline" label={busLabel} />}
                    {!!routeLabel && <MetaChip icon="git-branch-outline" label={routeLabel} />}
                    {photoCount > 0 && (
                        <MetaChip icon="images-outline" label={formatPhotoCount(photoCount)} />
                    )}
                    {isOwnReport && (
                        <MetaChip icon="person-circle-outline" label="Your report" highlighted />
                    )}
                </View>
            )}

            <View style={styles.cardFooter}>
                <Ionicons name="calendar-outline" size={14} color={adminColors.textMuted} />
                <Text style={styles.footerText}>
                    Submitted {formatReportDateTime(report.createdAt)}
                </Text>
            </View>
        </View>
    );
}

function MetaChip({
    icon,
    label,
    highlighted = false,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    highlighted?: boolean;
}) {
    return (
        <View style={[styles.metaChip, highlighted && styles.metaChipHighlighted]}>
            <Ionicons
                name={icon}
                size={12}
                color={highlighted ? adminColors.primary : adminColors.textSecondary}
            />
            <Text style={[styles.metaChipText, highlighted && styles.metaChipTextHighlighted]}>
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    createButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primary,
        minHeight: 54,
        borderRadius: 12,
        paddingHorizontal: 16,
        marginBottom: 16,
        ...adminShadow.card,
    },
    createButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 8,
    },

    segmentedControl: {
        flexDirection: 'row',
        backgroundColor: adminColors.surface,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 12,
        padding: 4,
        marginBottom: 16,
    },
    segment: {
        flex: 1,
        minHeight: 40,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderRadius: 9,
    },
    segmentSelected: { backgroundColor: adminColors.primary },
    segmentText: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textSecondary,
    },
    segmentTextSelected: { color: '#FFFFFF' },

    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        marginBottom: 10,
        fontWeight: '600',
    },

    // Sits inside the top-right corner of the placeholder card below it.
    comingSoonBadge: {
        position: 'absolute',
        top: 20,
        right: 12,
        zIndex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.warningSoft,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    comingSoonText: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.warning,
        marginLeft: 4,
        letterSpacing: 0.2,
    },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center' },
    categoryIconCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardHeadings: { flex: 1, marginLeft: 14, marginRight: 8 },
    categoryText: {
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.textPrimary,
    },
    reportIdText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 3,
        letterSpacing: 0.3,
    },

    descriptionText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 19,
        marginTop: 12,
    },

    chipWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    metaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surfaceMuted,
        borderWidth: 1,
        borderColor: adminColors.border,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    metaChipHighlighted: {
        backgroundColor: adminColors.primarySoft,
        borderColor: adminColors.primarySoft,
    },
    metaChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 4,
    },
    metaChipTextHighlighted: { color: adminColors.primary },

    cardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 14,
        paddingTop: 12,
    },
    footerText: {
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginLeft: 6,
    },
});
