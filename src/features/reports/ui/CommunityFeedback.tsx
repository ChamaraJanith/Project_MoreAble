import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import {
    fetchReportComments,
    fetchReportVotes,
    submitReportComment,
    submitReportVote,
} from '../api/reportFeedbackApi';
import {
    FeedbackVote,
    formatCommentCount,
    voteAccessibilityLabel,
} from '../utils/reportFeedback';
import {
    commentCountLabelValue,
    commentsLoadErrorMessage,
    initialFeedbackState,
    reportFeedbackReducer,
    shouldSendComment,
    shouldSendVote,
    votesLoadErrorMessage,
} from '../utils/reportFeedbackState';
import { FeedbackComments } from './FeedbackComments';

interface CommunityFeedbackProps {
    /** The report being voted and commented on. */
    reportId: string;
    /** The session token. Every feedback route refuses an anonymous request. */
    token: string | null;
}

/**
 * What other passengers make of a report.
 *
 * Every number and every comment on this screen comes from the API. A press on
 * Agree is a POST, the tallies drawn afterwards are the ones that came back,
 * and a comment appears as the record the server stored — with the name it
 * resolved and the time it wrote. Nothing is counted, named or timestamped
 * here, because a locally adjusted count is wrong the moment somebody else
 * votes, and it stays wrong until the screen is closed.
 *
 * Who is voting is never sent: the routes take the passenger from the verified
 * token, so there is no passengerId to pass, correctly or otherwise.
 *
 * The section loads on its own and fails on its own. A feedback endpoint that
 * cannot be reached costs the passenger this card, not the report they came to
 * read.
 */
export function CommunityFeedback({ reportId, token }: CommunityFeedbackProps) {
    const [state, dispatch] = useReducer(reportFeedbackReducer, initialFeedbackState);
    const [draft, setDraft] = useState('');

    // --------------------------------
    // Load
    //
    // Both halves are asked for together and land independently, so a thread
    // that fails to load still leaves the votes usable, and the other way
    // round.
    // --------------------------------
    useEffect(() => {
        if (!reportId || !token) {
            dispatch({ type: 'votesFailed' });
            dispatch({ type: 'commentsFailed' });
            return;
        }

        let isCurrent = true;

        dispatch({ type: 'loadStarted' });

        fetchReportVotes(reportId, token).then((result) => {
            if (!isCurrent) return;

            if (result.ok) dispatch({ type: 'votesLoaded', votes: result.value });
            else dispatch({ type: 'votesFailed' });
        });

        fetchReportComments(reportId, token).then((result) => {
            if (!isCurrent) return;

            if (result.ok) dispatch({ type: 'commentsLoaded', comments: result.value });
            else dispatch({ type: 'commentsFailed' });
        });

        // A report opened, closed and reopened quickly must not have the first
        // load's answer arrive over the second's.
        return () => {
            isCurrent = false;
        };
    }, [reportId, token]);

    // --------------------------------
    // Vote
    // --------------------------------
    const handleVote = useCallback(
        async (choice: FeedbackVote) => {
            // Guards the repeat press, the second press while one is in flight,
            // and a press before the tallies have arrived.
            if (!token || !shouldSendVote(state, choice)) return;

            dispatch({ type: 'voteStarted', vote: choice });

            const result = await submitReportVote(reportId, choice, token);

            if (result.ok) dispatch({ type: 'voteSucceeded', votes: result.value });
            else dispatch({ type: 'voteFailed' });
        },
        [reportId, token, state]
    );

    // --------------------------------
    // Comment
    //
    // The box is cleared only once the comment is stored, so a failed send
    // leaves the passenger their words rather than asking them to type it all
    // again.
    // --------------------------------
    const handleSubmitComment = useCallback(async () => {
        if (!token || !shouldSendComment(state, draft)) return;

        dispatch({ type: 'commentStarted' });

        const result = await submitReportComment(reportId, draft.trim(), token);

        if (!result.ok) {
            dispatch({ type: 'commentFailed' });
            return;
        }

        dispatch({ type: 'commentSucceeded', comment: result.value });
        setDraft('');
    }, [reportId, token, state, draft]);

    const votesError = votesLoadErrorMessage(state);
    const commentsError = commentsLoadErrorMessage(state);
    const commentCount = commentCountLabelValue(state);

    const areVotesLoading = state.votes.status === 'loading';
    const areVotesReady = state.votes.status === 'ready';

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
                {areVotesLoading ? (
                    <FeedbackLoading label="Loading community feedback" />
                ) : (
                    <>
                        <View style={styles.voteRow}>
                            <VotePill
                                choice="AGREE"
                                label="Agree"
                                // Only ever a number the API returned; null
                                // until it has, so nothing is claimed early.
                                count={areVotesReady ? state.votes.agreeCount : null}
                                isSelected={state.votes.myVote === 'AGREE'}
                                isPending={state.pendingVote === 'AGREE'}
                                isDisabled={state.pendingVote !== null}
                                onPress={handleVote}
                            />

                            <VotePill
                                choice="DISAGREE"
                                label="Disagree"
                                count={areVotesReady ? state.votes.disagreeCount : null}
                                isSelected={state.votes.myVote === 'DISAGREE'}
                                isPending={state.pendingVote === 'DISAGREE'}
                                isDisabled={state.pendingVote !== null}
                                onPress={handleVote}
                            />
                        </View>

                        {votesError ? (
                            <FeedbackError message={votesError} />
                        ) : (
                            <Text style={styles.note}>
                                Your feedback helps the community identify accessibility
                                issues.
                            </Text>
                        )}

                        {state.submitError && <FeedbackError message={state.submitError} />}
                    </>
                )}
            </View>

            {/* ---------------- Comments ---------------- */}
            <View style={styles.commentsHeader}>
                <Text style={styles.sectionTitleTight} accessibilityRole="header">
                    Comments
                </Text>

                {/* Only once there is something to count. A standing "0
                    comments" beside an empty state says the same thing twice,
                    the second time as a statistic. */}
                {commentCount !== null && (
                    <Text style={styles.commentsCount}>{formatCommentCount(commentCount)}</Text>
                )}
            </View>

            <View style={styles.card}>
                <FeedbackComments
                    comments={state.comments.items}
                    isLoading={state.comments.status === 'loading'}
                    loadError={commentsError}
                    isPosting={state.isPostingComment}
                    draft={draft}
                    onChangeDraft={setDraft}
                    onSubmit={handleSubmitComment}
                />
            </View>
        </>
    );
}

/** A section still waiting on the API, without taking the page with it. */
function FeedbackLoading({ label }: { label: string }) {
    return (
        <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={adminColors.primary} />
            <Text style={styles.loadingText}>{label}…</Text>
        </View>
    );
}

/**
 * Something that did not work, said plainly and in place.
 *
 * Announced politely rather than assertively: it interrupts nothing, and a
 * passenger who has just pressed something is already listening.
 */
function FeedbackError({ message }: { message: string }) {
    return (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={15} color={adminColors.danger} />
            <Text style={styles.errorText}>{message}</Text>
        </View>
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
 *
 * The count beside the label is the server's, and it is absent rather than zero
 * until the server has given one. While a vote is in flight the tick is
 * replaced by a spinner and both pills stop responding, so a rapid double press
 * cannot become two requests.
 */
function VotePill({
    choice,
    label,
    count,
    isSelected,
    isPending,
    isDisabled,
    onPress,
}: {
    choice: FeedbackVote;
    label: string;
    count: number | null;
    isSelected: boolean;
    isPending: boolean;
    isDisabled: boolean;
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
                isDisabled && styles.votePillBusy,
            ]}
            onPress={() => onPress(choice)}
            disabled={isDisabled}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={voteAccessibilityLabel(choice, isSelected, count)}
            accessibilityHint={
                isSelected ? 'You have already voted this way' : 'Double tap to cast this vote'
            }
            accessibilityState={{ selected: isSelected, disabled: isDisabled, busy: isPending }}
        >
            <Ionicons
                name={icon}
                size={18}
                color={isSelected ? tint.accent : adminColors.textSecondary}
            />

            <Text style={[styles.votePillLabel, isSelected && { color: tint.accent }]}>
                {label}
            </Text>

            {count !== null && (
                <Text
                    style={[styles.votePillCount, isSelected && { color: tint.accent }]}
                    // The pill already announces the count in its own label;
                    // reading the bare number again would be a second, less
                    // useful announcement of the same thing.
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    {count}
                </Text>
            )}

            {isPending ? (
                <ActivityIndicator size="small" color={tint.accent} />
            ) : (
                isSelected && (
                    <Ionicons name="checkmark-circle" size={15} color={tint.accent} />
                )
            )}
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
    votePillBusy: { opacity: 0.7 },
    votePillLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    votePillCount: {
        fontSize: 13,
        fontWeight: '800',
        color: adminColors.textSecondary,
        fontVariant: ['tabular-nums'],
    },

    note: {
        fontSize: 12,
        color: adminColors.textMuted,
        lineHeight: 17,
        marginTop: 12,
    },

    // ---- Loading and errors ----
    loading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 10,
    },
    loadingText: {
        fontSize: 12,
        color: adminColors.textMuted,
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        marginTop: 12,
    },
    errorText: {
        flex: 1,
        fontSize: 12,
        color: adminColors.danger,
        lineHeight: 17,
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
