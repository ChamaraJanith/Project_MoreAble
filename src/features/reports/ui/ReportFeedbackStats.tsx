import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { adminColors } from '../../admin/ui/adminTheme';
import { ReportCardFeedbackCounts } from '../utils/reportSummary';

interface ReportFeedbackStatsProps {
    /** The three tallies, already resolved to numbers. Never fetched here. */
    counts: ReportCardFeedbackCounts;
}

/**
 * The community feedback a report has drawn, as three counted icons.
 *
 * All three numbers arrive with the list. The two vote tallies are stored on
 * the report document — POST /api/reports/:reportId/vote writes them there —
 * and the comment count is tallied for the whole page by GET /api/reports. So a
 * list of thirty reports still costs the one request it always did: a per-card
 * lookup would turn it into thirty round trips to draw three small numbers.
 *
 * Zero is drawn rather than hidden. A row that showed a number only sometimes
 * would leave a passenger comparing cards that count and cards that do not, and
 * "no comments yet" is worth saying about a report as plainly as "two".
 *
 * Voting and commenting themselves live on the details screen, where there is
 * the context to decide. This row is a signpost to it, not a control.
 *
 * Nothing here is its own touch target, for the same reason the card's chevron
 * is not: the card is a single button with a single accessibility label, and a
 * touchable inside it would be a smaller target for the same action while
 * making that label unreachable. The counts are announced as part of that one
 * label, so this row stays hidden from screen readers rather than repeating
 * them out of context.
 */
export function ReportFeedbackStats({ counts }: ReportFeedbackStatsProps) {
    return (
        <View
            style={styles.row}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <View style={styles.icons}>
                <Stat icon="chatbubble-outline" count={counts.commentCount} />
                <Stat icon="thumbs-up-outline" count={counts.agreeCount} />
                <Stat icon="thumbs-down-outline" count={counts.disagreeCount} />
            </View>

            <Text style={styles.viewReport}>View Report</Text>
        </View>
    );
}

/** One icon and its number. */
function Stat({ icon, count }: { icon: keyof typeof Ionicons.glyphMap; count: number }) {
    return (
        <View style={styles.stat}>
            <Ionicons name={icon} size={16} color={adminColors.textMuted} />
            <Text style={styles.count}>{count}</Text>
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
    stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    count: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textMuted,
        fontVariant: ['tabular-nums'],
    },
    viewReport: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.primary,
        letterSpacing: 0.2,
    },
});
