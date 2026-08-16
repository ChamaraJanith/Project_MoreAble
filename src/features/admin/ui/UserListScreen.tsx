import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { AdminUserSummary } from '../../../entities/user/model/types';
import { getUsers } from '../api/userAdminApi';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton } from './AdminStates';
import { adminColors, adminShadow } from './adminTheme';

type VerificationFilter = 'ALL' | 'VERIFIED' | 'UNVERIFIED';
type UserTypeFilter = 'ALL' | 'ELDER' | 'STANDARD';

const VERIFICATION_FILTERS: { value: VerificationFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'VERIFIED', label: 'Verified' },
    { value: 'UNVERIFIED', label: 'Unverified' },
];

const USER_TYPE_FILTERS: { value: UserTypeFilter; label: string }[] = [
    { value: 'ALL', label: 'All users' },
    { value: 'ELDER', label: 'Elder users' },
    { value: 'STANDARD', label: 'Other users' },
];

/** Initials for the avatar, falling back to the passenger id. */
export function getUserInitials(user: AdminUserSummary): string {
    const name = user.userName?.trim();

    if (name) {
        const parts = name.split(/\s+/);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    }

    return user.passengerId?.slice(-2).toUpperCase() || 'U';
}

/** Case-insensitive match across the identifying fields an admin would type. */
export function matchesUserSearch(user: AdminUserSummary, term: string): boolean {
    const needle = term.trim().toLowerCase();
    if (!needle) return true;

    return [
        user.userName,
        user.email,
        user.phoneNumber,
        user.secondaryPhoneNumber,
        user.nicNo,
        user.passengerId,
    ].some((field) => typeof field === 'string' && field.toLowerCase().includes(needle));
}

export const UserListScreen = () => {
    const [users, setUsers] = useState<AdminUserSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [verification, setVerification] = useState<VerificationFilter>('ALL');
    const [userType, setUserType] = useState<UserTypeFilter>('ALL');

    const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') setIsRefreshing(true);
        else setIsLoading(true);
        setError('');

        try {
            // Replaces the list outright, so a refresh can never duplicate rows.
            setUsers(await getUsers());
        } catch (err: any) {
            setError(err?.message || "We couldn't retrieve the user list right now.");
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    // Every figure below is derived from the fetched data - nothing hardcoded.
    const summary = useMemo(
        () => ({
            total: users.length,
            verified: users.filter((user) => user.isVerified).length,
            unverified: users.filter((user) => !user.isVerified).length,
            elder: users.filter((user) => user.isElderPerson).length,
        }),
        [users]
    );

    const filteredUsers = useMemo(() => {
        const matching = users.filter((user) => {
            if (verification === 'VERIFIED' && !user.isVerified) return false;
            if (verification === 'UNVERIFIED' && user.isVerified) return false;
            if (userType === 'ELDER' && !user.isElderPerson) return false;
            if (userType === 'STANDARD' && user.isElderPerson) return false;

            return matchesUserSearch(user, search);
        });

        return [...matching].sort((a, b) =>
            (a.userName ?? '').localeCompare(b.userName ?? '')
        );
    }, [users, search, verification, userType]);

    const hasActiveFilters =
        search.trim().length > 0 || verification !== 'ALL' || userType !== 'ALL';

    const resetFilters = () => {
        setSearch('');
        setVerification('ALL');
        setUserType('ALL');
    };

    const renderBody = () => {
        if (isLoading) return <AdminListSkeleton count={4} />;

        if (error) {
            return (
                <AdminErrorState
                    title="Unable to load users"
                    message={`${error} Please check your connection and try again.`}
                    onRetry={() => load()}
                />
            );
        }

        if (users.length === 0) {
            return (
                <AdminEmptyState
                    icon="people-outline"
                    title="No registered users yet"
                    description="There are currently no users to display."
                />
            );
        }

        if (filteredUsers.length === 0) {
            return (
                <View>
                    <AdminEmptyState
                        icon="search-outline"
                        title="No users found"
                        description="Try adjusting your search or filters."
                    />
                    <TouchableOpacity
                        style={styles.resetButton}
                        onPress={resetFilters}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search and filters"
                    >
                        <Ionicons name="refresh-outline" size={17} color={adminColors.primary} />
                        <Text style={styles.resetButtonText}>Clear search and filters</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <>
                <Text style={styles.resultCount}>
                    {filteredUsers.length} of {users.length} user{users.length === 1 ? '' : 's'}
                </Text>

                {filteredUsers.map((user) => (
                    <TouchableOpacity
                        key={user.documentId}
                        style={styles.card}
                        onPress={() =>
                            router.push({
                                pathname: '/(admin)/users/[userId]',
                                params: { userId: user.documentId },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={
                            `${user.userName || user.passengerId}, ${user.passengerId}, ` +
                            `${user.isVerified ? 'verified' : 'unverified'}` +
                            `${user.isElderPerson ? ', elder user' : ''}`
                        }
                        accessibilityHint="Opens the full user profile"
                    >
                        <View style={styles.cardTop}>
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>{getUserInitials(user)}</Text>
                            </View>

                            <View style={styles.cardHeadings}>
                                <Text style={styles.userName} numberOfLines={1}>
                                    {user.userName || 'Unnamed user'}
                                </Text>
                                <Text style={styles.passengerId} numberOfLines={1}>
                                    {user.passengerId}
                                </Text>
                            </View>

                            <Ionicons
                                name="chevron-forward"
                                size={20}
                                color={adminColors.textMuted}
                            />
                        </View>

                        <View style={styles.contactBlock}>
                            <ContactRow icon="mail-outline" value={user.email} />
                            <ContactRow icon="call-outline" value={user.phoneNumber} />
                        </View>

                        <View style={styles.badgeRow}>
                            <VerificationBadge isVerified={user.isVerified} />
                            {user.isElderPerson && <ElderBadge />}
                            {typeof user.calculatedAge === 'number' && (
                                <View style={styles.ageChip}>
                                    <Text style={styles.ageChipText}>Age {user.calculatedAge}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                title="User Management"
                subtitle="View and manage registered MoveAble users"
                action={
                    <TouchableOpacity
                        style={styles.refreshButton}
                        onPress={() => load('refresh')}
                        disabled={isRefreshing}
                        accessibilityRole="button"
                        accessibilityLabel="Refresh user list"
                        accessibilityState={{ disabled: isRefreshing }}
                    >
                        <Ionicons name="refresh" size={20} color={adminColors.primary} />
                    </TouchableOpacity>
                }
            />

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={() => load('refresh')} />
                }
            >
                {/* Overview - derived from the fetched passenger accounts */}
                {!error && (
                    <View style={styles.summaryGrid}>
                        <SummaryCard
                            icon="people"
                            tint={adminColors.primary}
                            background={adminColors.primarySoft}
                            value={summary.total}
                            label="Total Users"
                            isLoading={isLoading}
                        />
                        <SummaryCard
                            icon="checkmark-circle"
                            tint={adminColors.success}
                            background={adminColors.successSoft}
                            value={summary.verified}
                            label="Verified"
                            isLoading={isLoading}
                        />
                        <SummaryCard
                            icon="alert-circle"
                            tint={adminColors.warning}
                            background={adminColors.warningSoft}
                            value={summary.unverified}
                            label="Unverified"
                            isLoading={isLoading}
                        />
                        <SummaryCard
                            icon="accessibility"
                            tint={adminColors.purple}
                            background="#F5EEF8"
                            value={summary.elder}
                            label="Elder Users"
                            isLoading={isLoading}
                        />
                    </View>
                )}

                {/* Search */}
                <View style={styles.searchWrapper}>
                    <Ionicons name="search" size={18} color={adminColors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search users by name, email, phone or NIC..."
                        placeholderTextColor={adminColors.textPlaceholder}
                        value={search}
                        onChangeText={setSearch}
                        autoCapitalize="none"
                        accessibilityLabel="Search users by name, email, phone or NIC"
                    />
                    {!!search && (
                        <TouchableOpacity
                            onPress={() => setSearch('')}
                            style={styles.clearSearchButton}
                            accessibilityRole="button"
                            accessibilityLabel="Clear search"
                        >
                            <Ionicons
                                name="close-circle"
                                size={18}
                                color={adminColors.textPlaceholder}
                            />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Filters - applied to the already fetched list, no extra requests */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {VERIFICATION_FILTERS.map((filter) => (
                        <FilterChip
                            key={filter.value}
                            label={filter.label}
                            isSelected={verification === filter.value}
                            onPress={() => setVerification(filter.value)}
                        />
                    ))}
                </ScrollView>

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                >
                    {USER_TYPE_FILTERS.map((filter) => (
                        <FilterChip
                            key={filter.value}
                            label={filter.label}
                            isSelected={userType === filter.value}
                            onPress={() => setUserType(filter.value)}
                        />
                    ))}
                </ScrollView>

                {hasActiveFilters && !isLoading && !error && filteredUsers.length > 0 && (
                    <TouchableOpacity
                        style={styles.inlineResetButton}
                        onPress={resetFilters}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search and filters"
                    >
                        <Ionicons name="close-circle-outline" size={15} color={adminColors.primary} />
                        <Text style={styles.inlineResetText}>Clear filters</Text>
                    </TouchableOpacity>
                )}

                {renderBody()}
            </ScrollView>
        </View>
    );
};

// ------------------------------------------------------------------
function SummaryCard({
    icon,
    tint,
    background,
    value,
    label,
    isLoading,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    background: string;
    value: number;
    label: string;
    isLoading: boolean;
}) {
    return (
        <View
            style={styles.summaryCard}
            accessible
            accessibilityLabel={isLoading ? `${label}, loading` : `${label}: ${value}`}
        >
            <View style={[styles.summaryIcon, { backgroundColor: background }]}>
                <Ionicons name={icon} size={20} color={tint} />
            </View>
            <Text style={styles.summaryValue}>{isLoading ? '—' : value}</Text>
            <Text style={styles.summaryLabel}>{label}</Text>
        </View>
    );
}

function ContactRow({
    icon,
    value,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    value: string | null;
}) {
    return (
        <View style={styles.contactRow}>
            <Ionicons name={icon} size={14} color={adminColors.textMuted} />
            <Text style={styles.contactText} numberOfLines={1}>
                {value || 'Not provided'}
            </Text>
        </View>
    );
}

/** Status carries an icon and a word, never colour alone. */
export function VerificationBadge({ isVerified }: { isVerified: boolean }) {
    return (
        <View
            style={[
                styles.badge,
                {
                    backgroundColor: isVerified
                        ? adminColors.successSoft
                        : adminColors.warningSoft,
                },
            ]}
            accessibilityLabel={isVerified ? 'Verified account' : 'Unverified account'}
        >
            <Ionicons
                name={isVerified ? 'checkmark-circle' : 'alert-circle'}
                size={13}
                color={isVerified ? adminColors.success : adminColors.warning}
            />
            <Text
                style={[
                    styles.badgeText,
                    { color: isVerified ? adminColors.success : adminColors.warning },
                ]}
            >
                {isVerified ? 'Verified' : 'Unverified'}
            </Text>
        </View>
    );
}

export function ElderBadge() {
    return (
        <View
            style={[styles.badge, { backgroundColor: '#F5EEF8' }]}
            accessibilityLabel="Elder user"
        >
            <Ionicons name="accessibility" size={13} color={adminColors.purple} />
            <Text style={[styles.badgeText, { color: adminColors.purple }]}>Elder User</Text>
        </View>
    );
}

function FilterChip({
    label,
    isSelected,
    onPress,
}: {
    label: string;
    isSelected: boolean;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.filterChip, isSelected && styles.filterChipSelected]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`Filter by ${label}`}
        >
            <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    refreshButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },

    summaryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    summaryCard: {
        width: '48%',
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        ...adminShadow.card,
    },
    summaryIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        justifyContent: 'center',
        alignItems: 'center',
    },
    summaryValue: {
        fontSize: 22,
        fontWeight: '800',
        color: adminColors.textPrimary,
        marginTop: 10,
    },
    summaryLabel: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 2,
        fontWeight: '600',
    },

    searchWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.border,
        paddingHorizontal: 14,
        minHeight: 50,
        marginTop: 4,
        marginBottom: 12,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 15,
        color: adminColors.textPrimary,
        paddingVertical: 10,
    },
    clearSearchButton: { padding: 6 },

    filterRow: { gap: 8, paddingBottom: 10 },
    filterChip: {
        minHeight: 38,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surface,
    },
    filterChipSelected: {
        backgroundColor: adminColors.primary,
        borderColor: adminColors.primary,
    },
    filterChipText: { fontSize: 13, fontWeight: '600', color: adminColors.textSecondary },
    filterChipTextSelected: { color: '#FFFFFF' },

    inlineResetButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        minHeight: 36,
        marginBottom: 6,
    },
    inlineResetText: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.primary,
        marginLeft: 5,
    },

    resultCount: {
        fontSize: 13,
        color: adminColors.textMuted,
        marginTop: 4,
        marginBottom: 10,
        fontWeight: '600',
    },

    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        ...adminShadow.card,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center' },
    avatar: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: 15,
        fontWeight: '800',
        color: adminColors.primary,
        letterSpacing: 0.5,
    },
    cardHeadings: { flex: 1, marginHorizontal: 14 },
    userName: {
        fontSize: 16,
        fontWeight: '800',
        color: adminColors.textPrimary,
    },
    passengerId: {
        fontSize: 12,
        color: adminColors.textSecondary,
        marginTop: 3,
        letterSpacing: 0.3,
    },

    contactBlock: {
        marginTop: 14,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 8,
    },
    contactRow: { flexDirection: 'row', alignItems: 'center' },
    contactText: {
        flex: 1,
        fontSize: 13,
        color: adminColors.textSecondary,
        marginLeft: 8,
        fontWeight: '500',
    },

    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    badgeText: { fontSize: 11, fontWeight: '700', marginLeft: 5 },
    ageChip: {
        backgroundColor: adminColors.borderSubtle,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
        justifyContent: 'center',
    },
    ageChipText: { fontSize: 11, fontWeight: '700', color: adminColors.textSecondary },

    resetButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.primary,
        backgroundColor: adminColors.primarySoft,
        marginTop: 14,
    },
    resetButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.primary,
        marginLeft: 7,
    },
});