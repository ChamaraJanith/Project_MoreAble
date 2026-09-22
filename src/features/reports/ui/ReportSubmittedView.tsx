import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AccessibilityReport } from '../../../entities/report/model/types';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import { reportSubmissionReceipt } from '../utils/reportSummary';
import { ReportTypeBadge } from './ReportTypeBadge';

interface ReportSubmittedViewProps {
    /** The report exactly as POST /api/reports stored and returned it. */
    report: AccessibilityReport;
    onViewMyReports: () => void;
    onSubmitAnother: () => void;
}

/**
 * The confirmation shown in place of the form once a report — an issue or
 * positive feedback — has been stored.
 *
 * It renders what the API sent back rather than what the form held, so every
 * detail on it (the id, the time, the status) is one the backend actually
 * recorded. Green is used only for the success mark; the actions stay in the
 * MoveAble blue like every other primary control.
 */
export function ReportSubmittedView({
    report,
    onViewMyReports,
    onSubmitAnother,
}: ReportSubmittedViewProps) {
    const receipt = reportSubmissionReceipt(report);
    const isPositive = receipt.reportType === 'POSITIVE';

    return (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View
                style={styles.successHalo}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <View style={styles.successCircle}>
                    <Ionicons name="checkmark" size={44} color="#FFFFFF" />
                </View>
            </View>

            <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
                Report Submitted!
            </Text>
            <Text style={styles.subtitle}>
                {isPositive
                    ? 'Thank you for sharing what worked well. It helps us keep accessibility on track.'
                    : 'Thank you for helping us improve accessibility.'}
            </Text>

            <View style={styles.card}>
                <Text style={styles.cardTitle} accessibilityRole="header">
                    Report Details
                </Text>

                <DetailRow label="Report ID">
                    <Text style={styles.valueStrong} selectable>
                        {receipt.reportId}
                    </Text>
                </DetailRow>

                <DetailRow label="Submitted">
                    <Text style={styles.value}>{receipt.submittedLabel}</Text>
                </DetailRow>

                <DetailRow label="Status">
                    <StatusBadge status={receipt.status} size="small" />
                </DetailRow>

                <DetailRow label="Report Type">
                    <ReportTypeBadge type={receipt.reportType} />
                </DetailRow>

                <DetailRow label="Category" isLast>
                    <Text style={styles.value} numberOfLines={2}>
                        {receipt.categoryLabel}
                    </Text>
                </DetailRow>
            </View>

            <View style={styles.infoNote}>
                <Ionicons name="information-circle-outline" size={18} color={adminColors.primary} />
                <Text style={styles.infoNoteText}>
                    You can edit or delete it from My Reports while it is pending review.
                </Text>
            </View>

            <TouchableOpacity
                style={styles.primaryButton}
                onPress={onViewMyReports}
                accessibilityRole="button"
                accessibilityLabel="View My Reports"
            >
                <Ionicons name="document-text-outline" size={18} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>View My Reports</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.secondaryButton}
                onPress={onSubmitAnother}
                accessibilityRole="button"
                accessibilityLabel="Submit Another Report"
            >
                <Ionicons name="add-circle-outline" size={18} color={adminColors.primary} />
                <Text style={styles.secondaryButtonText}>Submit Another Report</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

function DetailRow({
    label,
    isLast = false,
    children,
}: {
    label: string;
    isLast?: boolean;
    children: React.ReactNode;
}) {
    return (
        <View style={[styles.row, !isLast && styles.rowDivided]}>
            <Text style={styles.label}>{label}</Text>
            <View style={styles.rowValue}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    content: {
        padding: 20,
        paddingTop: 32,
        paddingBottom: 40,
        alignItems: 'stretch',
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
    },

    successHalo: {
        alignSelf: 'center',
        width: 104,
        height: 104,
        borderRadius: 52,
        backgroundColor: adminColors.successSoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    successCircle: {
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: adminColors.success,
        justifyContent: 'center',
        alignItems: 'center',
    },

    title: {
        fontSize: 24,
        fontWeight: '800',
        color: adminColors.textPrimary,
        textAlign: 'center',
        marginTop: 20,
    },
    subtitle: {
        fontSize: 15,
        color: adminColors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        marginTop: 8,
        paddingHorizontal: 12,
    },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: adminColors.border,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
        marginTop: 24,
        ...adminShadow.card,
    },
    cardTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: adminColors.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
        paddingVertical: 10,
        gap: 12,
    },
    rowDivided: { borderBottomWidth: 1, borderBottomColor: adminColors.borderSubtle },
    label: { fontSize: 14, fontWeight: '600', color: adminColors.textSecondary },
    rowValue: { flexShrink: 1, alignItems: 'flex-end' },
    value: {
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textPrimary,
        textAlign: 'right',
    },
    valueStrong: {
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.textPrimary,
        letterSpacing: 0.3,
    },

    infoNote: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.primarySoft,
        borderRadius: 12,
        padding: 12,
        marginTop: 14,
    },
    infoNoteText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        color: '#0D47A1',
        marginLeft: 8,
    },

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
        letterSpacing: 0.3,
    },
    secondaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 54,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: adminColors.primary,
        backgroundColor: adminColors.surface,
        marginTop: 12,
    },
    secondaryButtonText: {
        color: adminColors.primary,
        fontSize: 16,
        fontWeight: '700',
        marginLeft: 8,
        letterSpacing: 0.3,
    },
});
