import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { AdminUserSummary } from '../../../entities/user/model/types';
import { getUserById, updateUserAccountStatus } from '../api/userAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminErrorState, ConfirmDialog } from './AdminStates';
import {
    AccountStatusBadge,
    ElderBadge,
    VerificationBadge,
    accountStatusActionCopy,
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
                        {user.isElderPerson && <ElderBadge />}
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
});