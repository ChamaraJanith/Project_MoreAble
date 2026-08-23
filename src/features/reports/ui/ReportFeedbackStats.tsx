import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { adminColors } from '../../admin/ui/adminTheme';

/**
 * The community feedback a report can carry, as three icons on the card.
 *
 * No numbers beside them, on purpose. There is no backend for any of this yet —
 * MOV-145 and MOV-146 add the endpoints and the Firestore collections — and a
 * seeded count is a number a passenger would read as true. An icon says the
 * report can be commented on and voted on, which it can; "18 agree" would say
 * eighteen people agreed, which nobody did. The counts belong here once there
 * are real ones to show.
 *
 * Voting itself lives on the details screen, where there is the context to
 * decide. This row is a signpost to it, not a control.
 *
 * Nothing here is its own touch target, for the same reason the card's chevron
 * is not: the card is a single button with a single accessibility label, and a
 * touchable inside it would be a smaller target for the same action while
 * making that label unreachable. With no counts to announce, the icons carry
 * nothing a screen reader loses by skipping them.
 */
export function ReportFeedbackStats() {
    return (
        <View
            style={styles.row}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <View style={styles.icons}>
                <Ionicons
                    name="chatbubble-outline"
                    size={16}
                    color={adminColors.textMuted}
                />
                <Ionicons name="thumbs-up-outline" size={16} color={adminColors.textMuted} />
                <Ionicons name="thumbs-down-outline" size={16} color={adminColors.textMuted} />
            </View>

            <Text style={styles.viewReport}>View Report</Text>
        </View>
    );
}

// Sized off the card's existing footer — the same muted colour and 12pt type as
// the submitted date above it, so the row settles into the card instead of
// becoming a second thing competing with it.
const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 10,
    },
    icons: { flexDirection: 'row', alignItems: 'center', gap: 20 },
    viewReport: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.primary,
        letterSpacing: 0.2,
    },
});
