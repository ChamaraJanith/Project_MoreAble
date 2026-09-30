import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    ActivityIndicator,
    StyleSheet,
    
    TouchableOpacity,
    View
} from 'react-native';
import { ReportCommentRecord, ReportType } from '../../../entities/report/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import { ConfirmDialog } from '../../admin/ui/AdminStates';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import {
    deleteReportComment,
    fetchReportComments,
    fetchReportVotes,
    submitReportComment,
    submitReportVote,
    updateReportComment,
} from '../api/reportFeedbackApi';
import {
    FeedbackVote,
    communityFeedbackCopy,
    formatCommentCount,
    voteAccessibilityLabel,
} from '../utils/reportFeedback';
import {
    commentCountLabelValue,
    commentsLoadErrorMessage,
    initialFeedbackState,
    reportFeedbackReducer,
    shouldSendComment,
    shouldSendCommentDelete,
    shouldSendCommentEdit,
    shouldSendReply,
    shouldSendVote,
    votesLoadErrorMessage,
} from '../utils/reportFeedbackState';
import { CommentReplyTarget, FeedbackComments } from './FeedbackComments';
import { useCommentImageAttachment } from './useCommentImageAttachment';

interface CommunityFeedbackProps {
    /** The report being voted and commented on. */
    reportId: string;
    /**
     * ISSUE or POSITIVE — decides the section's wording, so positive feedback
     * is never described as something the community helps verify.
     */
    reportType: ReportType;
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
export function CommunityFeedback({ reportId, reportType, token }: CommunityFeedbackProps) {
    const [state, dispatch] = useReducer(reportFeedbackReducer, initialFeedbackState);
    const [draft, setDraft] = useState('');

    // What is in the open editor. Which comment is open lives in the reducer
    // (`editingCommentId`), so only one can ever be open at a time.
    const [editDraft, setEditDraft] = useState('');

    /** The comment awaiting delete confirmation, or null when no dialog is open. */
    const [commentToDelete, setCommentToDelete] = useState<ReportCommentRecord | null>(null);

    // The optional photo on each composer: the main box and the reply box.
    const commentImage = useCommentImageAttachment();
    const replyImage = useCommentImageAttachment();

    // The one open reply box — which thread it sits in, and whom it answers —
    // and what is typed in it.
    const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(null);
    const [replyDraft, setReplyDraft] = useState('');

    /** The report currently on screen, so a late reload cannot land on another. */
    const currentReportId = useRef(reportId);

    useEffect(() => {
        currentReportId.current = reportId;
    }, [reportId]);

    // Only to mark the viewer's own comments "You". Who is commenting is still
    // taken from the token by the API, never sent from here.
    const viewerPassengerId = useAuthStore((store) => store.user?.passengerId ?? null);

    const copy = communityFeedbackCopy(reportType);

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
        const image = commentImage.image;

        if (!token || !shouldSendComment(state, draft, image)) return;

        dispatch({ type: 'commentStarted' });

        const result = await submitReportComment(reportId, draft.trim(), token, {
            imageUrl: image?.url ?? null,
        });

        if (!result.ok) {
            dispatch({ type: 'commentFailed' });
            return;
        }

        dispatch({ type: 'commentSucceeded', comment: result.value });
        setDraft('');
        commentImage.reset();
        AccessibilityInfo.announceForAccessibility('Comment posted');
    }, [reportId, token, state, draft, commentImage]);

    // --------------------------------
    // Reply
    //
    // One reply box at a time, always under a top-level comment: Reply on a
    // reply opens the box for the thread it is in, "Replying to" its author.
    // Like the main box, it clears only once the reply is stored.
    // --------------------------------
    const handleStartReply = useCallback(
        (comment: ReportCommentRecord) => {
            const parentCommentId = comment.parentCommentId || comment.commentId;

            // Moving the box to another thread starts it empty; pressing Reply
            // again in the same thread keeps what was typed.
            if (replyTarget?.parentCommentId !== parentCommentId) {
                setReplyDraft('');
                replyImage.reset();
                dispatch({ type: 'replyDismissed' });
            }

            setReplyTarget({ parentCommentId, authorName: comment.authorName });
        },
        [replyTarget, replyImage]
    );

    const handleCancelReply = useCallback(() => {
        if (state.isPostingReply) return;

        setReplyTarget(null);
        setReplyDraft('');
        replyImage.reset();
        dispatch({ type: 'replyDismissed' });
    }, [state.isPostingReply, replyImage]);

    const handleSubmitReply = useCallback(async () => {
        const target = replyTarget;
        const image = replyImage.image;

        if (!token || !target || !shouldSendReply(state, target.parentCommentId, replyDraft, image)) {
            return;
        }

        dispatch({ type: 'replyStarted' });

        const result = await submitReportComment(reportId, replyDraft.trim(), token, {
            imageUrl: image?.url ?? null,
            parentCommentId: target.parentCommentId,
        });

        if (!result.ok) {
            dispatch({ type: 'replyFailed', message: result.message });
            return;
        }

        dispatch({ type: 'replySucceeded', comment: result.value });
        setReplyTarget(null);
        setReplyDraft('');
        replyImage.reset();
        AccessibilityInfo.announceForAccessibility('Reply posted');
    }, [reportId, token, state, replyTarget, replyDraft, replyImage]);

    // --------------------------------
    // The passenger's own comments (MOV-306)
    //
    // Offered only on comments the signed-in passenger wrote — FeedbackComments
    // decides that with isOwnComment — and the API checks it again from the
    // token. A 404 means the comment is gone, or the report is no longer
    // visible to this passenger, so the thread is read again rather than left
    // showing something that is not there.
    // --------------------------------
    const reloadComments = useCallback(async () => {
        if (!reportId || !token) return;

        const result = await fetchReportComments(reportId, token);

        if (currentReportId.current !== reportId) return;

        if (result.ok) dispatch({ type: 'commentsLoaded', comments: result.value });
        else dispatch({ type: 'commentsFailed' });
    }, [reportId, token]);

    const handleStartEdit = useCallback((comment: ReportCommentRecord) => {
        dispatch({ type: 'commentEditOpened', commentId: comment.commentId });
        setEditDraft(comment.text);
    }, []);

    const handleCancelEdit = useCallback(() => {
        dispatch({ type: 'commentEditCancelled' });
        setEditDraft('');
    }, []);

    // The editor stays open with the passenger's words in it until the edit is
    // stored; the row then shows the server's text and "Edited", in place.
    const handleSaveEdit = useCallback(async () => {
        const commentId = state.editingCommentId;

        if (!token || !commentId || !shouldSendCommentEdit(state, commentId, editDraft)) return;

        dispatch({ type: 'commentEditStarted', commentId });

        const result = await updateReportComment(reportId, commentId, editDraft.trim(), token);

        if (result.ok) {
            dispatch({ type: 'commentEditSucceeded', comment: result.value });
            setEditDraft('');
            return;
        }

        dispatch({ type: 'commentEditFailed' });

        if (result.status === 404) reloadComments();
    }, [reportId, token, state, editDraft, reloadComments]);

    const handleRequestDelete = useCallback(
        (comment: ReportCommentRecord) => {
            if (state.pendingCommentAction !== null) return;

            setCommentToDelete(comment);
        },
        [state.pendingCommentAction]
    );

    // The dialog stays open and busy while the delete is in flight, then
    // closes either way: a failure is said inside the comments card.
    const confirmDeleteComment = useCallback(async () => {
        const target = commentToDelete;

        if (!token || !target || !shouldSendCommentDelete(state, target.commentId)) {
            setCommentToDelete(null);
            return;
        }

        dispatch({ type: 'commentDeleteStarted', commentId: target.commentId });

        const result = await deleteReportComment(reportId, target.commentId, token);

        setCommentToDelete(null);

        if (result.ok) {
            dispatch({ type: 'commentDeleteSucceeded', commentId: target.commentId });

            // A reply box open in a thread that has just gone closes with it.
            if (replyTarget?.parentCommentId === target.commentId) handleCancelReply();

            AccessibilityInfo.announceForAccessibility('Comment deleted');
            return;
        }

        dispatch({ type: 'commentDeleteFailed' });

        if (result.status === 404) reloadComments();
    }, [reportId, token, state, commentToDelete, reloadComments, replyTarget, handleCancelReply]);

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

            <Text style={styles.sectionIntro}>{copy.intro}</Text>

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
                            <Text style={styles.note}>{copy.note}</Text>
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
                    attachment={commentImage}
                    viewerPassengerId={viewerPassengerId}
                    editingCommentId={state.editingCommentId}
                    editDraft={editDraft}
                    onChangeEditDraft={setEditDraft}
                    onStartEdit={handleStartEdit}
                    onCancelEdit={handleCancelEdit}
                    onSaveEdit={handleSaveEdit}
                    onRequestDelete={handleRequestDelete}
                    pendingCommentAction={state.pendingCommentAction}
                    commentActionError={state.commentActionError}
                    replyTarget={replyTarget}
                    replyDraft={replyDraft}
                    onChangeReplyDraft={setReplyDraft}
                    onStartReply={handleStartReply}
                    onCancelReply={handleCancelReply}
                    onSubmitReply={handleSubmitReply}
                    replyAttachment={replyImage}
                    isPostingReply={state.isPostingReply}
                    replyError={state.replyError}
                />
            </View>

            {/* A comment is not taken back without being confirmed first. */}
            <ConfirmDialog
                visible={commentToDelete !== null}
                title="Delete Comment"
                message="Are you sure you want to delete this comment? This cannot be undone."
                confirmLabel="Delete Comment"
                destructive
                isBusy={state.pendingCommentAction?.kind === 'delete'}
                onCancel={() => setCommentToDelete(null)}
                onConfirm={confirmDeleteComment}
            />
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
