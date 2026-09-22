import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { BusRatingSummary } from '../../../entities/rating/model/types';
import { AccessibilityReport } from '../../../entities/report/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import { AppText as Text } from '../../../shared/ui/AppText';
import {
    goBackOrTo,
    JOURNEY_ROUTE_DETAILS_PATH,
} from '../../journey/utils/journeyNavigation';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from '../../admin/ui/AdminStates';
import { getBusRatingSummary, getVerifiedBusReports } from '../api/busCommunityApi';
import {
    NO_VERIFIED_FEEDBACK_DESCRIPTION,
    NO_VERIFIED_FEEDBACK_TITLE,
    RECENT_FEEDBACK_LIMIT,
} from '../utils/busCommunityFeedback';
import { reportCardSummary } from '../utils/reportSummary';
import { reportDetailsPath } from '../utils/reportRoutes';
import { BusRatingSummaryCard } from './BusRatingSummaryView';
import { ReportListCard } from './ReportListCard';

type LoadState = 'LOADING' | 'READY' | 'ERROR';

/**
 * Community Feedback for one bus (MOV-80).
 *
 * What other passengers have said about the vehicle a passenger is about to
 * board: the average rating they gave it, and the reports about it an
 * administrator has verified, newest first.
 *
 * Passenger-facing only. Every report here has already been through review, and
 * nothing that belongs to the review itself is shown — no reviewer, no admin
 * remark, no pending or rejected account. A rejected report is one an admin
 * found did not hold, and repeating it to a passenger choosing a bus would
 * publish a finding nobody stands behind.
 *
 * Reached from Route Details, and pushed onto the journey stack, so Back returns
 * there rather than to Home.
 *
 * The two halves load independently and fail independently: the ratings are not
 * being served yet (MOV-116), and a screen that showed nothing until they were
 * would withhold the verified reports, which work today.
 */
export function BusCommunityFeedbackScreen() {
    const { busId, numberPlate, busModel } = useLocalSearchParams<{
        busId?: string;
        numberPlate?: string;
        busModel?: string;
    }>();
    const token = useAuthStore((store) => store.token);
    const passengerId = useAuthStore((store) => store.user?.passengerId ?? null);

    const [state, setState] = useState<LoadState>('LOADING');
    const [summary, setSummary] = useState<BusRatingSummary | null>(null);
    const [ratingsUnavailable, setRatingsUnavailable] = useState(false);
    const [reports, setReports] = useState<AccessibilityReport[]>([]);
    const [errorMessage, setErrorMessage] = useState('');

    const load = useCallback(
        async (isCurrent: () => boolean) => {
            if (!token || !busId) {
                setState('ERROR');
                setErrorMessage('Sign in and choose a bus to see its community feedback.');
                return;
            }

            setState('LOADING');

            // Side by side: neither half waits on the other, and the ratings
            // being unavailable must not hide the reports.
            const [ratingResult, reportResult] = await Promise.all([
                getBusRatingSummary(token, busId),
                getVerifiedBusReports(token, busId, RECENT_FEEDBACK_LIMIT),
            ]);

            if (!isCurrent()) return;

            if (ratingResult.ok) {
                setSummary(ratingResult.value);
                setRatingsUnavailable(false);
            } else {
                setSummary(null);
                setRatingsUnavailable(true);
            }

            if (reportResult.ok) {
                setReports(reportResult.value);
                setState('READY');
                return;
            }

            // Only the reports failing is worth an error state — they are the
            // half this screen can actually serve today.
            setErrorMessage(reportResult.message);
            setState('ERROR');
        },
        [token, busId]
    );

    /**
     * One read, whether it was the screen coming into focus or the passenger
     * tapping Retry. The returned cleanup is what makes a read that is still in
     * flight when the screen is left stop short of setting state; Retry calls
     * this directly and lets the focus effect's own cleanup cover it.
     */
    const runLoad = useCallback(() => {
        let active = true;
        load(() => active);

        return () => {
            active = false;
        };
    }, [load]);

    useFocusEffect(runLoad);

    const busTitle = numberPlate || 'This bus';
    const busSubtitle = busModel || null;

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => goBackOrTo(JOURNEY_ROUTE_DETAILS_PATH)}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="arrow-back" size={24} color="#0F172A" />
                </TouchableOpacity>
                <Text style={styles.headerTitle} accessibilityRole="header">
                    Community Feedback
                </Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* ---------------- Which bus ---------------- */}
                <View style={styles.busCard}>
                    <View style={styles.busIconBadge}>
                        <Ionicons name="bus" size={18} color="#0066CC" />
                    </View>
                    <View style={styles.busTextGroup}>
                        <Text style={styles.busPlateText} numberOfLines={1}>
                            {busTitle}
                        </Text>
                        {busSubtitle ? (
                            <Text style={styles.busModelText} numberOfLines={1}>
                                {busSubtitle}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {/* ---------------- Average rating ---------------- */}
                <BusRatingSummaryCard
                    summary={summary}
                    loading={state === 'LOADING'}
                    unavailable={ratingsUnavailable}
                />

                {/* ---------------- Verified feedback ---------------- */}
                <View style={styles.sectionHeadingRow}>
                    <Ionicons name="shield-checkmark-outline" size={16} color="#0F172A" />
                    <Text style={styles.sectionHeadingText} accessibilityRole="header">
                        Recent verified feedback
                    </Text>
                </View>
                <Text style={styles.sectionCaption}>
                    Reports about this bus that an administrator has verified, newest first.
                </Text>

                {state === 'LOADING' ? (
                    <AdminListSkeleton count={2} />
                ) : state === 'ERROR' ? (
                    <AdminErrorState
                        title="Unable to load community feedback"
                        message={errorMessage}
                        onRetry={runLoad}
                    />
                ) : reports.length === 0 ? (
                    <AdminEmptyState
                        icon="shield-checkmark-outline"
                        title={NO_VERIFIED_FEEDBACK_TITLE}
                        description={NO_VERIFIED_FEEDBACK_DESCRIPTION}
                    />
                ) : (
                    reports.map((report) => (
                        <ReportListCard
                            key={report.reportId}
                            summary={reportCardSummary(report, {
                                isOwnReport: !!passengerId && report.passengerId === passengerId,
                            })}
                            status={typeof report.status === 'string' ? report.status : ''}
                            onOpen={() => router.push(reportDetailsPath(report.reportId) as any)}
                        />
                    ))
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 32,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        gap: 8,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 19,
        fontWeight: '800',
        color: '#0F172A',
    },
    busCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    busIconBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#E0F2FE',
    },
    busTextGroup: {
        flex: 1,
    },
    busPlateText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    busModelText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
    },
    sectionHeadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        marginBottom: 4,
    },
    sectionHeadingText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
    },
    sectionCaption: {
        fontSize: 12,
        color: '#64748B',
        marginBottom: 12,
    },
});
