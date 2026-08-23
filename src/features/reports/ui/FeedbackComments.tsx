import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { adminColors } from '../../admin/ui/adminTheme';
import {
    MAX_FEEDBACK_COMMENT_LENGTH,
    ReportComment,
    commentInitial,
    formatCommentTimestamp,
    isSubmittableComment,
} from '../utils/reportFeedback';

interface FeedbackCommentsProps {
    comments: ReportComment[];
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
 */
export function FeedbackComments({
    comments,
    draft,
    onChangeDraft,
    onSubmit,
}: FeedbackCommentsProps) {
    const canSubmit = isSubmittableComment(draft);

    return (
        <View>
            {comments.length > 0 ? (
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
                    accessibilityLabel="Add a comment"
                    accessibilityHint="Share what you experienced on this journey"
                />

                <TouchableOpacity
                    style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    accessibilityRole="button"
                    accessibilityLabel="Send comment"
                    accessibilityState={{ disabled: !canSubmit }}
                >
                    <Ionicons
                        name="send"
                        size={17}
                        color={canSubmit ? '#FFFFFF' : adminColors.textPlaceholder}
                    />
                </TouchableOpacity>
            </View>
        </View>
    );
}

/** One passenger's comment: who said it, what they said, and when. */
function CommentRow({ comment, isFirst }: { comment: ReportComment; isFirst: boolean }) {
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
