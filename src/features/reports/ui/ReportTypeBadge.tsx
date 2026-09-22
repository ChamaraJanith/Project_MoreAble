import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ReportType } from '../../../entities/report/model/types';
import { adminColors } from '../../admin/ui/adminTheme';
import { reportTypeLabel } from '../utils/reportFormat';

/**
 * Red for an issue, green for positive feedback — soft backgrounds with a
 * darker foreground, so the chip marks the kind of report without competing
 * with the app's blue. The foregrounds are darker than the base semantic
 * colours so 11pt bold text stays above WCAG AA on the soft fills.
 */
export const REPORT_TYPE_TONES: Record<
    ReportType,
    {
        label: string;
        icon: keyof typeof Ionicons.glyphMap;
        foreground: string;
        background: string;
        border: string;
        iconColor: string;
    }
> = {
    ISSUE: {
        label: 'Issue',
        icon: 'warning',
        foreground: '#B71C1C',
        background: adminColors.dangerSoft,
        border: adminColors.dangerBorder,
        iconColor: adminColors.danger,
    },
    POSITIVE: {
        label: 'Positive',
        icon: 'thumbs-up',
        foreground: '#1B5E20',
        background: adminColors.successSoft,
        border: '#CFE8D1',
        iconColor: adminColors.success,
    },
};

/**
 * [ ⚠ ISSUE ] or [ 👍 POSITIVE ] — what kind of report this is, drawn apart
 * from the status badge so the two never read as one fact. Carries an icon and
 * a word as well as colour, so it never depends on colour perception alone.
 */
export function ReportTypeBadge({
    type,
    size = 'small',
}: {
    type: ReportType;
    size?: 'small' | 'medium';
}) {
    const tone = REPORT_TYPE_TONES[type];
    const isSmall = size === 'small';

    return (
        <View
            style={[
                styles.badge,
                isSmall && styles.badgeSmall,
                { backgroundColor: tone.background, borderColor: tone.border },
            ]}
            accessibilityLabel={`Type: ${reportTypeLabel(type)}`}
        >
            <Ionicons name={tone.icon} size={isSmall ? 11 : 13} color={tone.iconColor} />
            <Text
                style={[styles.label, isSmall && styles.labelSmall, { color: tone.foreground }]}
            >
                {tone.label.toUpperCase()}
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
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    badgeSmall: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
    },
    label: {
        fontSize: 12,
        fontWeight: '800',
        marginLeft: 5,
        letterSpacing: 0.6,
    },
    labelSmall: {
        fontSize: 11,
        marginLeft: 4,
    },
});
