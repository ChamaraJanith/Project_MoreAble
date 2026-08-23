import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import {
    FeedbackVote,
    ReportComment,
    addLocalComment,
    applyVote,
    formatCommentCount,
    voteAccessibilityLabel,
} from '../utils/reportFeedback';
import { FeedbackComments } from './FeedbackComments';

interface CommunityFeedbackProps {
    /** Name shown on a comment written here. Falls back to "You". */
    authorName?: string;
}

/**
 * What other passengers make of a report (MOV-144).
 *
 * The controls are real and the state behind them is local: a vote highlights,
 * a comment appears, and leaving the screen puts both back. What is deliberately
 * absent is any number claiming how the wider community has voted, and any
 * comment nobody wrote. There is no API behind this yet — MOV-145 and MOV-146
 * add it — and a seeded "18 agree" would read as eighteen people agreeing
 * rather than as a placeholder. The section shows the shape of the interaction
 * and an honest empty state instead.
 */
export function CommunityFeedback({ authorName }: CommunityFeedbackProps) {
    const [selectedVote, setSelectedVote] = useState<FeedbackVote | null>(null);
    const [comments, setComments] = useState<ReportComment[]>([]);
    const [draft, setDraft] = useState('');

    // `applyVote` returns the selection untouched when the same side is pressed
    // twice, so a repeat press can never become a second vote.
    const handleVote = (choice: FeedbackVote) => {
        setSelectedVote((current) => applyVote(current, choice));
    };

    const handleSubmitComment = () => {
        const next = addLocalComment(
            comments,
            draft,
            authorName ?? 'You',
            new Date().toISOString()
        );

        // Nothing submittable was typed: leave what is in the box alone rather
        // than silently clearing it.
        if (next === comments) return;

        setComments(next);
        setDraft('');
    };

    return (
        <>
            <Text style={styles.sectionTitle} accessibilityRole="header">
                Community Feedback
            </Text>

            <Text style={styles.sectionIntro}>
                Share your experience to help verify accessibility issues.
            </Text>

            {/* ---------------- Votes ---------------- */}
            <View style={styles.card}>
                <View style={styles.voteRow}>
                    <VotePill
                        choice="AGREE"
                        label="Agree"
                        isSelected={selectedVote === 'AGREE'}
                        onPress={handleVote}
                    />

                    <VotePill
                        choice="DISAGREE"
                        label="Disagree"
                        isSelected={selectedVote === 'DISAGREE'}
                        onPress={handleVote}
                    />
                </View>

                <Text style={styles.note}>
                    Your feedback helps the community identify accessibility issues.
                </Text>
            </View>

            {/* ---------------- Comments ---------------- */}
            <View style={styles.commentsHeader}>
                <Text style={styles.sectionTitleTight} accessibilityRole="header">
                    Comments
                </Text>

                {/* Only once there is something to count. A standing "0
                    comments" beside an empty state says the same thing twice,
                    the second time as a statistic. */}
                {comments.length > 0 && (
                    <Text style={styles.commentsCount}>
                        {formatCommentCount(comments.length)}
                    </Text>
                )}
            </View>

            <View style={styles.card}>
                <FeedbackComments
                    comments={comments}
                    draft={draft}
                    onChangeDraft={setDraft}
                    onSubmit={handleSubmitComment}
                />
            </View>
        </>
    );
}

const VOTE_TINT: Record<FeedbackVote, { accent: string; soft: string }> = {
    AGREE: { accent: adminColors.success, soft: adminColors.successSoft },
    DISAGREE: { accent: adminColors.danger, soft: adminColors.dangerSoft },
};

/**
 * One vote, as a pill rather than a card.
 *
 * Which side was picked is said three ways — a tinted pill, the icon filling
 * in, and a tick after the label — because colour alone would leave that state
 * unreadable to anybody who cannot see it. 46pt tall: past the 44pt minimum
 * without becoming the largest thing on the screen.
 */
function VotePill({
    choice,
    label,
    isSelected,
    onPress,
}: {
    choice: FeedbackVote;
    label: string;
    isSelected: boolean;
    onPress: (choice: FeedbackVote) => void;
}) {
    const tint = VOTE_TINT[choice];

    const icon: keyof typeof Ionicons.glyphMap =
        choice === 'AGREE'
            ? isSelected
                ? 'thumbs-up'
                : 'thumbs-up-outline'
            : isSelected
              ? 'thumbs-down'
              : 'thumbs-down-outline';

    return (
        <TouchableOpacity
            style={[
                styles.votePill,
                isSelected && { backgroundColor: tint.soft, borderColor: tint.accent },
            ]}
            onPress={() => onPress(choice)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={voteAccessibilityLabel(choice, isSelected)}
            accessibilityHint={
                isSelected ? 'You have already voted this way' : 'Double tap to cast this vote'
            }
            accessibilityState={{ selected: isSelected }}
        >
            <Ionicons
                name={icon}
                size={18}
                color={isSelected ? tint.accent : adminColors.textSecondary}
            />

            <Text style={[styles.votePillLabel, isSelected && { color: tint.accent }]}>
                {label}
            </Text>

            {isSelected && <Ionicons name="checkmark-circle" size={15} color={tint.accent} />}
        </TouchableOpacity>
    );
}

// Spacing, radii and type sizes are the ones ReportDetailsScreen already uses
// for its sections, so this reads as another part of the same page.
const styles = StyleSheet.create({
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        padding: 16,
        ...adminShadow.card,
    },

    sectionTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 24,
    },
    sectionTitleTight: {
        flex: 1,
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    sectionIntro: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 19,
        marginTop: 6,
        marginBottom: 10,
    },

    // ---- Votes ----
    voteRow: { flexDirection: 'row', gap: 10 },
    votePill: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        minHeight: 46,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        paddingHorizontal: 10,
    },
    votePillLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },

    note: {
        fontSize: 12,
        color: adminColors.textMuted,
        lineHeight: 17,
        marginTop: 12,
    },

    commentsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 10,
    },
    commentsCount: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.textMuted,
        marginLeft: 10,
    },
});
