import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { adminColors, adminShadow } from './adminTheme';

// ------------------------------------------------------------------
// Skeleton list — mirrors the real card shape so the layout does not
// jump when data arrives.
// ------------------------------------------------------------------
export function AdminListSkeleton({ count = 3 }: { count?: number }) {
    return (
        <View accessibilityLabel="Loading" accessibilityLiveRegion="polite">
            {Array.from({ length: count }).map((_, index) => (
                <View key={index} style={styles.skeletonCard}>
                    <View style={styles.skeletonRow}>
                        <View style={styles.skeletonAvatar} />
                        <View style={styles.skeletonTextGroup}>
                            <View style={[styles.skeletonLine, { width: '45%' }]} />
                            <View style={[styles.skeletonLine, styles.skeletonLineThin, { width: '65%' }]} />
                        </View>
                        <View style={styles.skeletonBadge} />
                    </View>
                    <View style={styles.skeletonChips}>
                        <View style={styles.skeletonChip} />
                        <View style={styles.skeletonChip} />
                        <View style={[styles.skeletonChip, { width: 70 }]} />
                    </View>
                </View>
            ))}
        </View>
    );
}

// ------------------------------------------------------------------
// Empty state
// ------------------------------------------------------------------
interface AdminEmptyStateProps {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
    /** Quieter follow-up line, e.g. when a section is not available yet. */
    secondaryDescription?: string;
    actionLabel?: string;
    onAction?: () => void;
}

export function AdminEmptyState({
    icon,
    title,
    description,
    secondaryDescription,
    actionLabel,
    onAction,
}: AdminEmptyStateProps) {
    return (
        <View style={styles.stateCard} accessibilityLiveRegion="polite">
            <View style={styles.stateIconCircle}>
                <Ionicons name={icon} size={34} color={adminColors.primary} />
            </View>
            <Text style={styles.stateTitle}>{title}</Text>
            <Text style={styles.stateDescription}>{description}</Text>

            {!!secondaryDescription && (
                <Text style={styles.stateSecondaryDescription}>{secondaryDescription}</Text>
            )}

            {!!actionLabel && !!onAction && (
                <TouchableOpacity
                    style={styles.statePrimaryButton}
                    onPress={onAction}
                    accessibilityRole="button"
                    accessibilityLabel={actionLabel}
                >
                    <Ionicons name="add" size={19} color="#FFFFFF" />
                    <Text style={styles.statePrimaryButtonText}>{actionLabel}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

// ------------------------------------------------------------------
// Error state
// ------------------------------------------------------------------
interface AdminErrorStateProps {
    title: string;
    message: string;
    /** Wording for the retry action, where a screen already uses its own. */
    retryLabel?: string;
    onRetry: () => void;
}

export function AdminErrorState({
    title,
    message,
    retryLabel = 'Retry',
    onRetry,
}: AdminErrorStateProps) {
    return (
        <View style={styles.stateCard} accessibilityLiveRegion="assertive">
            <View style={[styles.stateIconCircle, { backgroundColor: adminColors.dangerSoft }]}>
                <Ionicons name="cloud-offline-outline" size={34} color={adminColors.danger} />
            </View>
            <Text style={styles.stateTitle}>{title}</Text>
            <Text style={styles.stateDescription}>{message}</Text>

            <TouchableOpacity
                style={styles.statePrimaryButton}
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel={retryLabel}
            >
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.statePrimaryButtonText}>{retryLabel}</Text>
            </TouchableOpacity>
        </View>
    );
}

// ------------------------------------------------------------------
// Confirmation dialog — used before any destructive action.
// ------------------------------------------------------------------
interface ConfirmDialogProps {
    visible: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    destructive?: boolean;
    isBusy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function ConfirmDialog({
    visible,
    title,
    message,
    confirmLabel,
    destructive = false,
    isBusy = false,
    onCancel,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.dialogBackdrop}>
                <View style={styles.dialogCard} accessibilityViewIsModal>
                    <View
                        style={[
                            styles.dialogIconCircle,
                            destructive && { backgroundColor: adminColors.dangerSoft },
                        ]}
                    >
                        <Ionicons
                            name={destructive ? 'trash-outline' : 'help-circle-outline'}
                            size={26}
                            color={destructive ? adminColors.danger : adminColors.primary}
                        />
                    </View>

                    <Text style={styles.dialogTitle} accessibilityRole="header">
                        {title}
                    </Text>
                    <Text style={styles.dialogMessage}>{message}</Text>

                    <TouchableOpacity
                        style={[
                            styles.dialogConfirmButton,
                            destructive && { backgroundColor: adminColors.danger },
                            isBusy && styles.dialogButtonDisabled,
                        ]}
                        onPress={onConfirm}
                        disabled={isBusy}
                        accessibilityRole="button"
                        accessibilityLabel={confirmLabel}
                        accessibilityState={{ disabled: isBusy }}
                    >
                        <Text style={styles.dialogConfirmText}>
                            {isBusy ? 'Please wait…' : confirmLabel}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.dialogCancelButton}
                        onPress={onCancel}
                        disabled={isBusy}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                    >
                        <Text style={styles.dialogCancelText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    skeletonCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },
    skeletonRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    skeletonAvatar: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: adminColors.borderSubtle,
    },
    skeletonTextGroup: {
        flex: 1,
        marginLeft: 14,
    },
    skeletonLine: {
        height: 12,
        borderRadius: 6,
        backgroundColor: adminColors.borderSubtle,
        marginBottom: 8,
    },
    skeletonLineThin: {
        height: 10,
        marginBottom: 0,
    },
    skeletonBadge: {
        width: 62,
        height: 22,
        borderRadius: 8,
        backgroundColor: adminColors.borderSubtle,
    },
    skeletonChips: {
        flexDirection: 'row',
        marginTop: 14,
        gap: 8,
    },
    skeletonChip: {
        width: 92,
        height: 22,
        borderRadius: 8,
        backgroundColor: adminColors.borderSubtle,
    },

    stateCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        paddingVertical: 32,
        paddingHorizontal: 24,
        alignItems: 'center',
        marginTop: 8,
        ...adminShadow.card,
    },
    stateIconCircle: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    stateTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: adminColors.textPrimary,
        textAlign: 'center',
        marginBottom: 8,
    },
    stateDescription: {
        fontSize: 14,
        color: adminColors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
        maxWidth: 300,
    },
    stateSecondaryDescription: {
        fontSize: 12,
        color: adminColors.textPlaceholder,
        textAlign: 'center',
        lineHeight: 18,
        maxWidth: 300,
        marginTop: 8,
    },
    statePrimaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: adminColors.primary,
        minHeight: 48,
        borderRadius: 12,
        paddingHorizontal: 22,
        marginTop: 20,
    },
    statePrimaryButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        marginLeft: 7,
    },

    dialogBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(26, 37, 48, 0.5)',
        justifyContent: 'center',
        paddingHorizontal: 28,
    },
    dialogCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
    },
    dialogIconCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    dialogTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        textAlign: 'center',
        marginBottom: 8,
    },
    dialogMessage: {
        fontSize: 14,
        color: adminColors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 20,
    },
    dialogConfirmButton: {
        alignSelf: 'stretch',
        backgroundColor: adminColors.primary,
        minHeight: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    dialogButtonDisabled: {
        opacity: 0.6,
    },
    dialogConfirmText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    dialogCancelButton: {
        alignSelf: 'stretch',
        minHeight: 46,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
    },
    dialogCancelText: {
        color: adminColors.textSecondary,
        fontSize: 15,
        fontWeight: '600',
    },
});