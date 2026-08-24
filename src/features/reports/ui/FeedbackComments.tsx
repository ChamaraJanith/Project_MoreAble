import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { ReportCommentRecord } from '../../../entities/report/model/types';
import { adminColors } from '../../admin/ui/adminTheme';
import {
    MAX_FEEDBACK_COMMENT_LENGTH,
    commentInitial,
    formatCommentTimestamp,
    isSubmittableComment,
} from '../utils/reportFeedback';

interface FeedbackCommentsProps {
    /** Stored comments, newest first, exactly as the API returned them. */
    comments: ReportCommentRecord[];
    /** The thread has been asked for and has not arrived. */
    isLoading: boolean;
    /** Why the thread could not be read, or null. */
    loadError: string | null;
    /** A comment is on its way to the API. */
    isPosting: boolean;
    draft: string;
    onChangeDraft: (text: string) => void;
    onSubmit: () => void;
}

/**
 * What other passengers said, and the box for saying something back.
 *
 * The composer sits below the list rather than above it so the thread reads in
 * one direction, and a newly written comment lands directly beside the box it
 * was just typed into.
 *
 * The box stays usable while the thread is loading and even when it failed to
 * load: not being able to read what others said is no reason to stop somebody
 * saying their own piece. What it is not is usable while a comment is in
 * flight — Send goes busy until the API answers, and the text stays put until
 * it answers well.
 */
export function FeedbackComments({
    comments,
    isLoading,
    loadError,
    isPosting,
    draft,
    onChangeDraft,
    onSubmit,
}: FeedbackCommentsProps) {
    const canSubmit = isSubmittableComment(draft) && !isPosting;

    return (
        <View>
            {isLoading ? (
                <CommentsLoading />
            ) : loadError ? (
                <CommentsError message={loadError} />
            ) : comments.length > 0 ? (
                comments.map((comment, index) => (
                    <CommentRow key={comment.commentId} comment={comment} isFirst={index === 0} />
                ))
            ) : (
                <EmptyComments />
            )}

            <View style={styles.composer}>
                <TextInput
                    style={styles.composerInput}
                    value={draft}
                    onChangeText={onChangeDraft}
                    placeholder="Add a comment..."
                    placeholderTextColor={adminColors.textPlaceholder}
                    maxLength={MAX_FEEDBACK_COMMENT_LENGTH}
                    multiline
                    editable={!isPosting}
                    accessibilityLabel="Add a comment"
                    accessibilityHint="Share what you experienced on this journey"
                />

                <TouchableOpacity
                    style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    accessibilityRole="button"
                    accessibilityLabel={isPosting ? 'Sending comment' : 'Send comment'}
                    accessibilityState={{ disabled: !canSubmit, busy: isPosting }}
                >
                    {isPosting ? (
                        <ActivityIndicator size="small" color={adminColors.textPlaceholder} />
                    ) : (
                        <Ionicons
                            name="send"
                            size={17}
                            color={canSubmit ? '#FFFFFF' : adminColors.textPlaceholder}
                        />
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

/** The thread, still being read. */
function CommentsLoading() {
    return (
        <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={adminColors.primary} />
            <Text style={styles.statusText}>Loading comments…</Text>
        </View>
    );
}

/**
 * The thread could not be read.
 *
 * Said where the comments would have been, rather than as an empty thread:
 * "no comments yet" and "we could not fetch the comments" are different facts,
 * and only one of them is true here.
 */
function CommentsError({ message }: { message: string }) {
    return (
        <View style={styles.status} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={15} color={adminColors.danger} />
            <Text style={[styles.statusText, styles.statusTextError]}>{message}</Text>
        </View>
    );
}

/**
 * One passenger's comment: who said it, what they said, and when.
 *
 * Exported because the admin review page (MOV-160) shows the same thread
 * without a composer under it: a reviewer reads what the community said, they
 * do not join the conversation. Drawing that thread from this row rather than
 * from a second one is what keeps the two readings identical.
 */
export function CommentRow({ comment, isFirst }: { comment: ReportCommentRecord; isFirst: boolean }) {
    return (
        <View style={[styles.commentRow, !isFirst && styles.divided]}>
            <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{commentInitial(comment.authorName)}</Text>
            </View>

            <View style={styles.commentBody}>
                <View style={styles.commentHeader}>
                    <Text style={styles.commentAuthor} numberOfLines={1}>
                        {comment.authorName}
                    </Text>
                    <Text style={styles.commentDate}>
                        {formatCommentTimestamp(comment.createdAt)}
                    </Text>
                </View>

                <Text style={styles.commentText}>{comment.text}</Text>
            </View>
        </View>
    );
}

/** Shown before anybody has replied — an invitation rather than a blank. */
function EmptyComments() {
    return (
        <View style={styles.empty} accessibilityLiveRegion="polite">
            <View style={styles.emptyIcon}>
                <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={20}
                    color={adminColors.textPlaceholder}
                />
            </View>

            <Text style={styles.emptyTitle}>No comments yet</Text>
            <Text style={styles.emptyText}>Be the first to share your experience.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    // ---- Loading / failed ----
    status: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 8,
    },
    statusText: {
        flex: 1,
        fontSize: 12,
        color: adminColors.textMuted,
        lineHeight: 17,
    },
    statusTextError: { color: adminColors.danger },

    divided: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 12,
        paddingTop: 12,
    },

    // ---- One comment ----
    commentRow: { flexDirection: 'row' },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarInitial: {
        fontSize: 14,
        fontWeight: '800',
        color: adminColors.primary,
    },
    commentBody: { flex: 1, marginLeft: 11 },
    commentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    commentAuthor: {
        flex: 1,
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginRight: 10,
    },
    commentDate: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
    },
    commentText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 20,
        marginTop: 4,
    },

    // ---- Empty state ----
    empty: { alignItems: 'center', paddingVertical: 6 },
    emptyIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: adminColors.surfaceMuted,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginTop: 9,
    },
    emptyText: {
        fontSize: 12,
        color: adminColors.textPlaceholder,
        marginTop: 3,
        textAlign: 'center',
    },

    // ---- Composer ----
    composer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    composerInput: {
        flex: 1,
        minHeight: 44,
        maxHeight: 110,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 10,
        paddingHorizontal: 13,
        paddingVertical: 11,
        fontSize: 13,
        color: adminColors.textPrimary,
        lineHeight: 19,
    },
    sendButton: {
        // 44pt square: the smallest a touch target should be, and no larger.
        width: 44,
        height: 44,
        borderRadius: 22,
        marginLeft: 9,
        backgroundColor: adminColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonDisabled: { backgroundColor: adminColors.borderSubtle },
});
