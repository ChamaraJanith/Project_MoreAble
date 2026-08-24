import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { adminColors } from './adminTheme';

type BadgeStatus =
    | 'ACTIVE'
    | 'INACTIVE'
    | 'MAINTENANCE'
    | 'OUTBOUND'
    | 'RETURN'
    | 'PENDING'
    | 'VERIFIED'
    | 'REVIEWED'
    | 'RESOLVED'
    | 'REJECTED'
    | string;

interface StatusBadgeProps {
    status: BadgeStatus;
    size?: 'small' | 'medium';
}

// Each status carries an icon and a written label as well as colour, so the
// meaning never depends on colour perception alone.
const BADGE_CONFIG: Record<
    string,
    { label: string; color: string; background: string; icon: keyof typeof Ionicons.glyphMap }
> = {
    ACTIVE: {
        label: 'Active',
        color: adminColors.success,
        background: adminColors.successSoft,
        icon: 'checkmark-circle',
    },
    INACTIVE: {
        label: 'Inactive',
        color: adminColors.textSecondary,
        background: adminColors.borderSubtle,
        icon: 'pause-circle',
    },
    MAINTENANCE: {
        label: 'Maintenance',
        color: adminColors.warning,
        background: adminColors.warningSoft,
        icon: 'construct',
    },
    OUTBOUND: {
        label: 'Outbound',
        color: adminColors.primary,
        background: adminColors.primarySoft,
        icon: 'arrow-forward-circle',
    },
    RETURN: {
        label: 'Return',
        color: adminColors.purple,
        background: '#F5EEF8',
        icon: 'arrow-back-circle',
    },

    // Accessibility report review states.
    PENDING: {
        label: 'Pending',
        color: adminColors.warning,
        background: adminColors.warningSoft,
        icon: 'time',
    },
    // Green, not the app's blue: verified is an outcome an admin recorded, and
    // it has to read as one wherever it appears — the passenger list, the
    // details screen and the review queue all draw this same badge. Blue is
    // what every neutral accent on these screens already uses, so it said
    // "informational" where this has to say "confirmed".
    VERIFIED: {
        label: 'Verified',
        color: adminColors.success,
        background: adminColors.successSoft,
        icon: 'shield-checkmark',
    },
    REVIEWED: {
        label: 'Reviewed',
        color: adminColors.accent,
        background: adminColors.accentSoft,
        icon: 'eye',
    },
    RESOLVED: {
        label: 'Resolved',
        color: adminColors.success,
        background: adminColors.successSoft,
        icon: 'checkmark-done-circle',
    },
    REJECTED: {
        label: 'Rejected',
        color: adminColors.danger,
        background: adminColors.dangerSoft,
        icon: 'close-circle',
    },
};

export function StatusBadge({ status, size = 'medium' }: StatusBadgeProps) {
    const config = BADGE_CONFIG[status] ?? {
        label: status,
        color: adminColors.textSecondary,
        background: adminColors.borderSubtle,
        icon: 'ellipse' as keyof typeof Ionicons.glyphMap,
    };

    const isSmall = size === 'small';

    return (
        <View
            style={[
                styles.badge,
                isSmall && styles.badgeSmall,
                { backgroundColor: config.background },
            ]}
            accessibilityLabel={`Status: ${config.label}`}
        >
            <Ionicons name={config.icon} size={isSmall ? 12 : 14} color={config.color} />
            <Text style={[styles.label, isSmall && styles.labelSmall, { color: config.color }]}>
                {config.label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    badgeSmall: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    label: {
        fontSize: 12,
        fontWeight: '700',
        marginLeft: 5,
        letterSpacing: 0.2,
    },
    labelSmall: {
        fontSize: 11,
        marginLeft: 4,
    },
});