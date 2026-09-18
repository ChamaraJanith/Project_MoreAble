import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import Svg, { Circle } from 'react-native-svg';
import {
    ActivityIndicator,
    Modal,
    ScrollView,
    StyleSheet,
    
    TouchableOpacity,
    View
} from 'react-native';
import { AdminUserSummary, AccessibilityVerificationStatus } from '../../../entities/user/model/types';
import { getUserById, updateUserAccountStatus, updateUserAccessibilityVerificationStatus, updateUserVerification } from '../api/userAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState, ConfirmDialog } from './AdminStates';
import {
    AccountStatusBadge,
    ElderBadge,
    VerificationBadge,
    AccessibilityVerificationBadge,
    accountStatusActionCopy,
    verificationActionCopy,
    getUserInitials,
} from './UserListScreen';
import { adminColors, adminShadow } from './adminTheme';

interface UserDetailsScreenProps {
    userId: string;
}

/** Renders an ISO timestamp readably, leaving anything unparsable untouched. */
export function formatTimestamp(value: string | null): string {
    if (!value) return 'Not recorded';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export const UserDetailsScreen = ({ userId }: UserDetailsScreenProps) => {
    const [user, setUser] = useState<AdminUserSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [isConfirmVisible, setIsConfirmVisible] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [statusError, setStatusError] = useState('');
    const [statusSuccess, setStatusSuccess] = useState('');

    const [isAccStatusModalVisible, setIsAccStatusModalVisible] = useState(false);
    const [isUpdatingAccStatus, setIsUpdatingAccStatus] = useState(false);

    const [isConfirmVerificationVisible, setIsConfirmVerificationVisible] = useState(false);
    const [isUpdatingVerification, setIsUpdatingVerification] = useState(false);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');

        try {
            const found = await getUserById(userId);

            if (!found) {
                setError('This user could not be found. They may have been removed.');
            }

            setUser(found);
        } catch (err: any) {
            setError(err?.message || "We couldn't retrieve this user right now.");
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const handleConfirmStatusChange = async () => {
        if (!user || isUpdatingStatus) return;

        const copy = accountStatusActionCopy(user);

        setIsUpdatingStatus(true);
        setStatusError('');
        setStatusSuccess('');

        try {
            const updated = await updateUserAccountStatus(user.documentId, copy.nextStatus);

            setUser((previous) =>
                previous
                    ? {
                          ...previous,
                          accountStatus: updated?.accountStatus ?? copy.nextStatus,
                          updatedAt: updated?.updatedAt ?? previous.updatedAt,
                      }
                    : previous
            );

            setStatusSuccess(copy.successMessage);
            setIsConfirmVisible(false);
        } catch (err: any) {
            // The displayed status is left unchanged.
            setStatusError(err?.message || 'Unable to update this account status.');
            setIsConfirmVisible(false);
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    const handleConfirmVerificationChange = async () => {
        if (!user || isUpdatingVerification) return;

        const copy = verificationActionCopy(user);

        setIsUpdatingVerification(true);
        setStatusError('');
        setStatusSuccess('');

        try {
            const updated = await updateUserVerification(user.documentId, copy.nextStatus);

            setUser((previous) =>
                previous
                    ? {
                          ...previous,
                          isVerified: updated?.isVerified ?? copy.nextStatus,
                          updatedAt: updated?.updatedAt ?? previous.updatedAt,
                      }
                    : previous
            );

            setStatusSuccess(copy.successMessage);
            setIsConfirmVerificationVisible(false);
        } catch (err: any) {
            setStatusError(err?.message || 'Unable to update verification status.');
            setIsConfirmVerificationVisible(false);
        } finally {
            setIsUpdatingVerification(false);
        }
    };

    const handleAccStatusChange = async (newStatus: AccessibilityVerificationStatus) => {
        if (!user || isUpdatingAccStatus) return;

        setIsUpdatingAccStatus(true);
        setStatusError('');
        setStatusSuccess('');

        try {
            const updated = await updateUserAccessibilityVerificationStatus(user.documentId, newStatus);

            setUser((previous) =>
                previous
                    ? {
                          ...previous,
                          accessibilityVerificationStatus: updated?.accessibilityVerificationStatus ?? newStatus,
                          updatedAt: updated?.updatedAt ?? previous.updatedAt,
                      }
                    : previous
            );

            setStatusSuccess(`Accessibility status updated to ${newStatus}.`);
            setIsAccStatusModalVisible(false);
        } catch (err: any) {
            setStatusError(err?.message || 'Unable to update accessibility status.');
            setIsAccStatusModalVisible(false);
        } finally {
            setIsUpdatingAccStatus(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="User Profile" />
                <View style={styles.centered} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="large" color={adminColors.primary} />
                    <Text style={styles.centeredText}>Loading user profile…</Text>
                </View>
            </View>
        );
    }

    if (error || !user) {
        return (
            <View style={styles.container}>
                <AdminScreenHeader title="User Profile" />
                <View style={styles.content}>
                    <AdminErrorState
                        title="Unable to load this user"
                        message={error || 'This user could not be found.'}
                        onRetry={load}
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title={user.userName || 'User Profile'}
                subtitle={user.passengerId}
            />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Identity */}
                <View style={styles.heroCard}>
                    <View style={styles.heroAvatar}>
                        <Text style={styles.heroAvatarText}>{getUserInitials(user)}</Text>
                    </View>

                    <Text style={styles.heroName}>{user.userName || 'Unnamed user'}</Text>
                    <Text style={styles.heroId}>{user.passengerId}</Text>

                    <View style={styles.heroBadges}>
                        <AccountStatusBadge accountStatus={user.accountStatus} />
                        <VerificationBadge isVerified={user.isVerified} />
                        {user.accessibilityVerificationStatus && <AccessibilityVerificationBadge status={user.accessibilityVerificationStatus} />}
                        {user.isElderPerson && <ElderBadge />}
                    </View>
                </View>

                <View style={styles.scoreCardContainer}>
                    <View style={styles.scoreCardTextContainer}>
                        <Text style={styles.scoreCardTitle}>Profile Verification Status</Text>
                        <Text style={styles.scoreCardSubtitle}>
                            Profile completion status ({
                                (() => {
                                    let score = 0;
                                    if (user.userName) score++;
                                    if (user.email) score++;
                                    if (user.phoneNumber) score++;
                                    if (user.nicNo) score++;
                                    if (user.accessibilityProfileId) score++;
                                    return Math.round((score / 5) * 100);
                                })()
                            }% Complete)
                        </Text>
                    </View>
                    <View style={styles.scoreCardCircleContainer}>
                        <Svg width={46} height={46}>
                            <Circle
                                stroke="#F59E0B"
                                fill="none"
                                cx={23}
                                cy={23}
                                r={21}
                                strokeWidth={3}
                                strokeDasharray={`${21 * 2 * Math.PI}`}
                                strokeDashoffset={`${(21 * 2 * Math.PI) - (((() => {
                                    let score = 0;
                                    if (user.userName) score++;
                                    if (user.email) score++;
                                    if (user.phoneNumber) score++;
                                    if (user.nicNo) score++;
                                    if (user.accessibilityProfileId) score++;
                                    return score / 5;
                                })()) * (21 * 2 * Math.PI))}`}
                                strokeLinecap="round"
                                transform="rotate(-90 23 23)"
                            />
                        </Svg>
                        <View style={styles.scoreCardPercentageContainer}>
                            <Text style={styles.scoreCardPercentageText}>
                                {(() => {
                                    let score = 0;
                                    if (user.userName) score++;
                                    if (user.email) score++;
                                    if (user.phoneNumber) score++;
                                    if (user.nicNo) score++;
                                    if (user.accessibilityProfileId) score++;
                                    return Math.round((score / 5) * 100);
                                })()}%
                            </Text>
                        </View>
                    </View>
                </View>

                {!!statusSuccess && (
                    <View style={styles.successBanner} accessibilityLiveRegion="polite">
                        <Ionicons
                            name="checkmark-circle-outline"
                            size={18}
                            color={adminColors.success}
                        />
                        <Text style={styles.successBannerText}>{statusSuccess}</Text>
                    </View>
                )}

                {!!statusError && (
                    <View style={styles.statusErrorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons
                            name="alert-circle-outline"
                            size={18}
                            color={adminColors.danger}
                        />
                        <Text style={styles.statusErrorText}>{statusError}</Text>
                    </View>
                )}

                {/* Personal */}
                <Text style={styles.sectionTitle}>Personal Information</Text>
                <View style={styles.card}>
                    <DetailRow label="Full Name" value={user.userName || 'Not provided'} />
                    <DetailRow label="Passenger ID" value={user.passengerId} />
                    <DetailRow label="NIC Number" value={user.nicNo || 'Not provided'} />
                    <DetailRow
                        label="Age"
                        value={
                            typeof user.calculatedAge === 'number'
                                ? `${user.calculatedAge}`
                                : 'Not recorded'
                        }
                    />
                    <DetailRow
                        label="Elder User"
                        value={user.isElderPerson ? 'Yes' : 'No'}
                        isLast
                    />
                </View>

                {/* Contact */}
                <Text style={styles.sectionTitle}>Contact Information</Text>
                <View style={styles.card}>
                    <DetailRow label="Email" value={user.email || 'Not provided'} />
                    <DetailRow label="Primary Phone" value={user.phoneNumber || 'Not provided'} />
                    <DetailRow
                        label="Secondary Phone"
                        value={user.secondaryPhoneNumber || 'Not provided'}
                        isLast
                    />
                </View>

                {/* Account */}
                <Text style={styles.sectionTitle}>Account Information</Text>
                <View style={styles.card}>
                    <DetailRow
                        label="Account Status"
                        value={user.accountStatus === 'ACTIVE' ? 'Active' : 'Suspended'}
                    />
                    <DetailRow
                        label="Verification"
                        value={user.isVerified ? 'Verified' : 'Unverified'}
                    />
                    <DetailRow label="Role" value={user.role} />
                    <DetailRow label="Registered" value={formatTimestamp(user.createdAt)} />
                    <DetailRow
                        label="Last Updated"
                        value={formatTimestamp(user.updatedAt)}
                        isLast
                    />
                </View>

                {/* Linked records */}
                <Text style={styles.sectionTitle}>Linked Records</Text>
                <View style={styles.card}>
                    <DetailRow
                        label="Guardian"
                        value={user.guardianId || 'No guardian linked'}
                    />
                    <DetailRow
                        label="Accessibility Profile"
                        value={user.accessibilityProfileId || 'No profile linked'}
                    />
                    <DetailRow
                        label="Accessibility Status"
                        value={user.accessibilityVerificationStatus || 'Not specified'}
                        isLast
                    />
                    <View style={styles.noteRow}>
                        <Ionicons
                            name="information-circle-outline"
                            size={15}
                            color={adminColors.textMuted}
                        />
                        <Text style={styles.noteText}>
                            Only the linked record references are available here.
                        </Text>
                    </View>
                </View>

                {/* Manage */}
                <Text style={styles.sectionTitle}>Manage</Text>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.actionRow}
                        onPress={() => {
                            setStatusError('');
                            setStatusSuccess('');
                            setIsConfirmVisible(true);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={accountStatusActionCopy(user).accessibilityLabel}
                    >
                        <View
                            style={[
                                styles.actionIcon,
                                {
                                    backgroundColor:
                                        user.accountStatus === 'ACTIVE'
                                            ? adminColors.dangerSoft
                                            : adminColors.successSoft,
                                },
                            ]}
                        >
                            <Ionicons
                                name={
                                    user.accountStatus === 'ACTIVE'
                                        ? 'ban-outline'
                                        : 'checkmark-circle-outline'
                                }
                                size={20}
                                color={
                                    user.accountStatus === 'ACTIVE'
                                        ? adminColors.danger
                                        : adminColors.success
                                }
                            />
                        </View>

                        <View style={styles.actionTextGroup}>
                            <Text
                                style={[
                                    styles.actionLabel,
                                    {
                                        color:
                                            user.accountStatus === 'ACTIVE'
                                                ? adminColors.danger
                                                : adminColors.textPrimary,
                                    },
                                ]}
                            >
                                {accountStatusActionCopy(user).actionLabel} User
                            </Text>
                            <Text style={styles.actionHint}>
                                {user.accountStatus === 'ACTIVE'
                                    ? 'Blocks account access until reactivated'
                                    : 'Restores this account access'}
                            </Text>
                        </View>

                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionRow, { borderTopWidth: 1, borderTopColor: adminColors.borderSubtle }]}
                        onPress={() => {
                            setStatusError('');
                            setStatusSuccess('');
                            setIsConfirmVerificationVisible(true);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={verificationActionCopy(user).accessibilityLabel}
                    >
                        <View
                            style={[
                                styles.actionIcon,
                                {
                                    backgroundColor: user.isVerified
                                        ? adminColors.warningSoft
                                        : adminColors.successSoft,
                                },
                            ]}
                        >
                            <Ionicons
                                name={user.isVerified ? 'close-circle-outline' : 'checkmark-circle-outline'}
                                size={20}
                                color={user.isVerified ? adminColors.warning : adminColors.success}
                            />
                        </View>

                        <View style={styles.actionTextGroup}>
                            <Text
                                style={[
                                    styles.actionLabel,
                                    { color: user.isVerified ? adminColors.warning : adminColors.textPrimary },
                                ]}
                            >
                                {verificationActionCopy(user).actionLabel} User
                            </Text>
                            <Text style={styles.actionHint}>
                                {user.isVerified
                                    ? 'Removes verified identity status'
                                    : 'Confirms user identity'}
                            </Text>
                        </View>

                        <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                    </TouchableOpacity>

                    {user.accessibilityProfileId && (
                        <TouchableOpacity
                            style={[styles.actionRow, { borderTopWidth: 1, borderTopColor: adminColors.borderSubtle }]}
                            onPress={() => {
                                setStatusError('');
                                setStatusSuccess('');
                                setIsAccStatusModalVisible(true);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Manage Accessibility Verification Status"
                        >
                            <View style={[styles.actionIcon, { backgroundColor: adminColors.primarySoft }]}>
                                <Ionicons name="accessibility-outline" size={20} color={adminColors.primary} />
                            </View>

                            <View style={styles.actionTextGroup}>
                                <Text style={[styles.actionLabel, { color: adminColors.textPrimary }]}>
                                    Accessibility Status
                                </Text>
                                <Text style={styles.actionHint}>
                                    Current: {user.accessibilityVerificationStatus || 'Not specified'}
                                </Text>
                            </View>

                            <Ionicons name="chevron-forward" size={20} color={adminColors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>

            <ConfirmDialog
                visible={isConfirmVisible}
                title={accountStatusActionCopy(user).title}
                message={accountStatusActionCopy(user).message}
                confirmLabel={
                    isUpdatingStatus
                        ? accountStatusActionCopy(user).busyLabel
                        : accountStatusActionCopy(user).confirmLabel
                }
                destructive={accountStatusActionCopy(user).destructive}
                isBusy={isUpdatingStatus}
                onCancel={() => {
                    if (!isUpdatingStatus) setIsConfirmVisible(false);
                }}
                onConfirm={handleConfirmStatusChange}
            />

            <ConfirmDialog
                visible={isConfirmVerificationVisible}
                title={verificationActionCopy(user).title}
                message={verificationActionCopy(user).message}
                confirmLabel={
                    isUpdatingVerification
                        ? verificationActionCopy(user).busyLabel
                        : verificationActionCopy(user).confirmLabel
                }
                destructive={verificationActionCopy(user).destructive}
                isBusy={isUpdatingVerification}
                onCancel={() => {
                    if (!isUpdatingVerification) setIsConfirmVerificationVisible(false);
                }}
                onConfirm={handleConfirmVerificationChange}
            />

            <StatusSelectDialog
                visible={isAccStatusModalVisible}
                isBusy={isUpdatingAccStatus}
                currentStatus={user?.accessibilityVerificationStatus || null}
                onSelect={handleAccStatusChange}
                onCancel={() => {
                    if (!isUpdatingAccStatus) setIsAccStatusModalVisible(false);
                }}
            />
        </View>
    );
};

function DetailRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
    return (
        <View style={[styles.detailRow, isLast && styles.detailRowLast]}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue} numberOfLines={2}>
                {value}
            </Text>
        </View>
    );
}

function StatusSelectDialog({ visible, isBusy, currentStatus, onSelect, onCancel }: { visible: boolean, isBusy: boolean, currentStatus: AccessibilityVerificationStatus | null, onSelect: (s: AccessibilityVerificationStatus) => void, onCancel: () => void }) {
    const statuses: AccessibilityVerificationStatus[] = ['PENDING', 'VERIFIED', 'REJECTED'];
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.dialogBackdrop}>
                <View style={styles.dialogCard} accessibilityViewIsModal>
                    <Text style={styles.dialogTitle} accessibilityRole="header">
                        Set Accessibility Status
                    </Text>
                    <View style={{ width: '100%', marginTop: 10 }}>
                        {statuses.map(s => (
                            <TouchableOpacity
                                key={s}
                                style={[
                                    styles.dialogConfirmButton,
                                    { marginBottom: 8, backgroundColor: s === currentStatus ? adminColors.primarySoft : adminColors.surface, borderWidth: 1, borderColor: adminColors.border },
                                    isBusy && styles.dialogButtonDisabled
                                ]}
                                onPress={() => onSelect(s)}
                                disabled={isBusy}
                            >
                                <Text style={[styles.dialogConfirmText, { color: s === currentStatus ? adminColors.primary : adminColors.textPrimary }]}>
                                    {s}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <TouchableOpacity
                        style={styles.dialogCancelButton}
                        onPress={onCancel}
                        disabled={isBusy}
                    >
                        <Text style={styles.dialogCancelText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    heroCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 22,
        alignItems: 'center',
        ...adminShadow.card,
    },
    heroAvatar: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    heroAvatarText: {
        fontSize: 22,
        fontWeight: '800',
        color: adminColors.primary,
        letterSpacing: 0.5,
    },
    heroName: {
        fontSize: 20,
        fontWeight: '800',
        color: adminColors.textPrimary,
        textAlign: 'center',
    },
    heroId: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 4,
        marginBottom: 16,
    },
    heroBadges: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
    },
    dialogHint: {
        fontSize: 13,
        fontWeight: '500',
        color: adminColors.textMuted,
        textAlign: 'center',
        marginBottom: 20,
    },

    scoreCardContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#0066CC',
        padding: 16,
        marginBottom: 16,
    },
    scoreCardTextContainer: {
        flex: 1,
        marginRight: 16,
    },
    scoreCardTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#1E3A8A',
        marginBottom: 4,
    },
    scoreCardSubtitle: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
    },
    scoreCardCircleContainer: {
        width: 46,
        height: 46,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scoreCardPercentageContainer: {
        position: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
    },
    scoreCardPercentageText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#F59E0B',
    },
    heroId: {
        fontSize: 13,
        color: adminColors.textSecondary,
        marginTop: 4,
        letterSpacing: 0.3,
    },
    heroBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 12,
        marginTop: 20,
    },
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        ...adminShadow.card,
    },

    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: adminColors.borderSubtle,
    },
    detailRowLast: { borderBottomWidth: 0 },
    detailLabel: { fontSize: 13, color: adminColors.textSecondary, marginRight: 12 },
    detailValue: {
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
        textAlign: 'right',
    },

    noteRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    noteText: {
        flex: 1,
        fontSize: 12,
        color: adminColors.textMuted,
        marginLeft: 7,
        lineHeight: 17,
    },

    actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, minHeight: 60 },
    actionIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    actionTextGroup: { flex: 1 },
    actionLabel: { fontSize: 15, fontWeight: '700', color: adminColors.textPrimary },
    actionHint: { fontSize: 12, color: adminColors.textMuted, marginTop: 2 },

    successBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.successSoft,
        borderWidth: 1,
        borderColor: '#CDE8CE',
        borderRadius: 10,
        padding: 12,
        marginTop: 12,
    },
    successBannerText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.success,
        marginLeft: 8,
        lineHeight: 18,
    },

    statusErrorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        padding: 12,
        marginTop: 12,
    },
    statusErrorText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 8,
        lineHeight: 18,
    },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    centeredText: { marginTop: 12, fontSize: 14, color: adminColors.textSecondary },
    dialogBackdrop: { flex: 1, backgroundColor: 'rgba(26, 37, 48, 0.5)', justifyContent: 'center', paddingHorizontal: 28 },
    dialogCard: { backgroundColor: adminColors.surface, borderRadius: 16, padding: 24, alignItems: 'center' },
    dialogTitle: { fontSize: 18, fontWeight: '700', color: adminColors.textPrimary, textAlign: 'center', marginBottom: 8 },
    dialogConfirmButton: { alignSelf: 'stretch', minHeight: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    dialogButtonDisabled: { opacity: 0.6 },
    dialogConfirmText: { fontSize: 15, fontWeight: '700' },
    dialogCancelButton: { alignSelf: 'stretch', minHeight: 46, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    dialogCancelText: { color: adminColors.textSecondary, fontSize: 15, fontWeight: '600' },
});