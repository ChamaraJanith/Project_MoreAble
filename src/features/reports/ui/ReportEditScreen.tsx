import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AccessibilityReport } from '../../../entities/report/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { useAuthStore } from '../../../shared/store/authStore';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { adminColors } from '../../admin/ui/adminTheme';
import { canEditReport, isReportOwnedBy } from '../utils/reportOwnership';
import { reportApiPath } from '../utils/reportRoutes';
import { ReportFormScreen } from './ReportFormScreen';

/**
 * Editing one report.
 *
 * The report is loaded first and the form is mounted only once it is here, so
 * every field opens pre-filled rather than filling in underneath the passenger
 * as the request lands.
 *
 * Ownership and the report's review state are checked here too, for the case
 * where this screen is reached directly by its path rather than through the
 * details screen's Edit button. Neither is the rule — PUT
 * /api/reports/[reportId] refuses anybody but the author, and refuses even the
 * author once an admin has decided the report, whatever this screen renders.
 */
export const ReportEditScreen = () => {
    const { token, user, isAuthenticated } = useAuthStore();
    const params = useLocalSearchParams<{ reportId?: string | string[] }>();

    const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;

    const [report, setReport] = useState<AccessibilityReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isMissing, setIsMissing] = useState(false);

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
            console.error('Fetch Report For Edit Error:', err);
            setError('Failed to retrieve the report.');
        } finally {
            setIsLoading(false);
        }
    }, [reportId, isAuthenticated, token]);

    // Loaded once: re-fetching on focus would throw away whatever the
    // passenger had typed the moment they came back from the photo picker.
    useEffect(() => {
        loadReport();
    }, [loadReport]);

    if (report && canEditReport(report, user?.passengerId)) {
        return <ReportFormScreen mode="edit" report={report} />;
    }

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="Edit Report"
                subtitle="Update the details of your accessibility report"
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {isLoading ? (
                    <AdminListSkeleton count={2} />
                ) : isMissing ? (
                    <AdminEmptyState
                        icon="document-outline"
                        title="Report not available"
                        description="This accessibility report may have been deleted."
                    />
                ) : error ? (
                    <AdminErrorState
                        title="Unable to load report"
                        message={`${error} Please check your connection and try again.`}
                        retryLabel="Try Again"
                        onRetry={loadReport}
                    />
                ) : isReportOwnedBy(report, user?.passengerId) ? (
                    // Theirs, but decided. Worth saying so plainly: the report
                    // has not gone anywhere, it has simply been answered.
                    <AdminEmptyState
                        icon="shield-checkmark-outline"
                        title="This report has been reviewed"
                        description="An administrator has already decided this report, so its details can no longer be changed."
                        secondaryDescription="You can still open the report to read the decision and the community's feedback."
                    />
                ) : (
                    <AdminEmptyState
                        icon="lock-closed-outline"
                        title="You cannot edit this report"
                        description="Only the passenger who submitted a report can change it."
                    />
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },
});
