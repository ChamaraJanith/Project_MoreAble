import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { ReportCommentRecord } from '../../../entities/report/model/types';
import { adminColors } from '../../admin/ui/adminTheme';
import {
    MAX_FEEDBACK_COMMENT_LENGTH,
    OWN_COMMENT_LABEL,
    commentInitial,
    formatCommentTimestampLabel,
    isOwnComment,
    isSubmittableComment,
    isSubmittableCommentEdit,
} from '../utils/reportFeedback';
import { PendingCommentAction } from '../utils/reportFeedbackState';

/**
 * Just past the smallest a touch target should be, for the small text actions
 * under a comment: their text is 12pt, and the slop makes up the rest.
 */
const COMMENT_ACTION_HIT_SLOP = { top: 14, bottom: 14, left: 10, right: 10 };

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
    /** The signed-in passenger, whose own comments are marked "You". */
    viewerPassengerId?: string | null;

    // ---- Managing the passenger's own comments (MOV-306) ----
    /** The one comment open for editing, or null. */
    editingCommentId?: string | null;
    /** What is in that comment's editor. */
    editDraft?: string;
    onChangeEditDraft?: (text: string) => void;
    onStartEdit?: (comment: ReportCommentRecord) => void;
    onCancelEdit?: () => void;
    onSaveEdit?: () => void;
    /** Asks to delete — the caller confirms before anything is sent. */
    onRequestDelete?: (comment: ReportCommentRecord) => void;
    /** The edit or delete in flight, which that row draws busy. */
    pendingCommentAction?: PendingCommentAction | null;
    /** Why the last edit or delete failed, drawn inside this card. */
    commentActionError?: string | null;
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
    viewerPassengerId = null,
    editingCommentId = null,
    editDraft = '',
    onChangeEditDraft,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onRequestDelete,
    pendingCommentAction = null,
    commentActionError = null,
}: FeedbackCommentsProps) {
    const canSubmit = isSubmittableComment(draft) && !isPosting;

    /**
     * Edit and Delete, for the signed-in passenger's own comment and nobody
     * else's. Another passenger's comment gets no controls at all — the API
     * would refuse them (403), and offering them would be a promise it breaks.
     */
    const ownCommentActions = (comment: ReportCommentRecord) => {
        if (!isOwnComment(comment, viewerPassengerId)) return {};

        const isEditing = editingCommentId === comment.commentId;
        const isPending = pendingCommentAction?.commentId === comment.commentId;

        return {
            onEdit: onStartEdit ? () => onStartEdit(comment) : undefined,
            onDelete: onRequestDelete ? () => onRequestDelete(comment) : undefined,
            isEditing,
            editDraft: isEditing ? editDraft : '',
            onChangeEditDraft,
            onCancelEdit,
            onSaveEdit,
            canSaveEdit:
                isEditing &&
                pendingCommentAction === null &&
                isSubmittableCommentEdit(editDraft, comment.text),
            isSaving: isPending && pendingCommentAction?.kind === 'edit',
            isDeleting: isPending && pendingCommentAction?.kind === 'delete',
            actionsDisabled: pendingCommentAction !== null,
        };
    };

    return (
        <View>
            {isLoading ? (
                <CommentsLoading />
            ) : loadError ? (
                <CommentsError message={loadError} />
            ) : comments.length > 0 ? (
                comments.map((comment, index) => (
                    <CommentRow
                        key={comment.commentId}
                        comment={comment}
                        isFirst={index === 0}
                        isOwn={isOwnComment(comment, viewerPassengerId)}
                        {...ownCommentActions(comment)}
                    />
                ))
            ) : (
                <EmptyComments />
            )}

            {/* An edit or delete that did not go through, said inside the
                thread it was about. A comment that failed to POST is still
                reported under the votes, exactly as before. */}
            {commentActionError && <CommentsError message={commentActionError} />}

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
 *
 * The actions under the text are opt-in (MOV-306). The passenger thread passes
 * Edit and Delete for the viewer's own comments only; the admin review page
 * passes Delete alone, labelled "Remove", for moderation. A row given neither
 * draws exactly as it always has.
 */
export function CommentRow({
    comment,
    isFirst,
    isOwn = false,
    onEdit,
    onDelete,
    deleteLabel = 'Delete',
    isEditing = false,
    editDraft = '',
    onChangeEditDraft,
    onCancelEdit,
    onSaveEdit,
    canSaveEdit = false,
    isSaving = false,
    isDeleting = false,
    actionsDisabled = false,
}: {
    comment: ReportCommentRecord;
    isFirst: boolean;
    /**
     * Whether the signed-in passenger wrote it — see isOwnComment. Only the
     * passenger thread passes it; the admin review page does not, so its
     * thread carries no "You" marker.
     */
    isOwn?: boolean;
    /** Opens this comment for editing. Only ever passed for the viewer's own. */
    onEdit?: () => void;
    /** Asks to delete (or, for an admin, remove) this comment. */
    onDelete?: () => void;
    /** What the delete action is called: "Delete" for its author, "Remove" for an admin. */
    deleteLabel?: string;
    /** Whether the text is open in the inline editor. */
    isEditing?: boolean;
    editDraft?: string;
    onChangeEditDraft?: (text: string) => void;
    onCancelEdit?: () => void;
    onSaveEdit?: () => void;
    /** Whether Save may be pressed: not blank, not too long, not unchanged. */
    canSaveEdit?: boolean;
    /** The edit is on its way to the API. */
    isSaving?: boolean;
    /** The delete is on its way to the API. */
    isDeleting?: boolean;
    /** Something is in flight, so no further action may start. */
    actionsDisabled?: boolean;
}) {
    const hasActions = !isEditing && (!!onEdit || !!onDelete);
    const deleteAccessibilityLabel = isOwn
        ? `${deleteLabel} your comment`
        : `${deleteLabel} comment by ${comment.authorName}`;

    return (
        <View style={[styles.commentRow, !isFirst && styles.divided]}>
            <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{commentInitial(comment.authorName)}</Text>
            </View>

            <View style={styles.commentBody}>
                <View style={styles.commentHeader}>
                    <View style={styles.commentAuthorRow}>
                        <Text style={styles.commentAuthor} numberOfLines={1}>
                            {comment.authorName}
                        </Text>

                        {/* Said in a word, not a colour: the chip is what
                            marks the comment as the viewer's own. */}
                        {isOwn && (
                            <View style={styles.ownChip}>
                                <Text style={styles.ownChipText}>{OWN_COMMENT_LABEL}</Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.commentDate}>
                        {formatCommentTimestampLabel(comment)}
                    </Text>
                </View>

                {isEditing ? (
                    <View>
                        <TextInput
                            style={styles.editInput}
                            value={editDraft}
                            onChangeText={onChangeEditDraft}
                            maxLength={MAX_FEEDBACK_COMMENT_LENGTH}
                            multiline
                            autoFocus
                            editable={!isSaving}
                            accessibilityLabel="Edit your comment"
                        />

                        <View style={styles.editButtons}>
                            <TouchableOpacity
                                style={styles.editCancel}
                                onPress={onCancelEdit}
                                disabled={isSaving}
                                accessibilityRole="button"
                                accessibilityLabel="Cancel editing"
                                accessibilityState={{ disabled: isSaving }}
                            >
                                <Text style={styles.editCancelText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.editSave, !canSaveEdit && styles.editSaveDisabled]}
                                onPress={onSaveEdit}
                                disabled={!canSaveEdit}
                                accessibilityRole="button"
                                accessibilityLabel={isSaving ? 'Saving comment' : 'Save comment'}
                                accessibilityState={{ disabled: !canSaveEdit, busy: isSaving }}
                            >
                                {isSaving ? (
                                    <ActivityIndicator size="small" color={adminColors.textPlaceholder} />
                                ) : (
                                    <Text
                                        style={[
                                            styles.editSaveText,
                                            !canSaveEdit && styles.editSaveTextDisabled,
                                        ]}
                                    >
                                        Save
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <Text style={styles.commentText}>{comment.text}</Text>
                )}

                {hasActions && (
                    <View style={styles.commentActions}>
                        {onEdit && (
                            <TouchableOpacity
                                onPress={onEdit}
                                disabled={actionsDisabled}
                                hitSlop={COMMENT_ACTION_HIT_SLOP}
                                accessibilityRole="button"
                                accessibilityLabel="Edit your comment"
                                accessibilityState={{ disabled: actionsDisabled }}
                            >
                                <Text
                                    style={[
                                        styles.commentAction,
                                        actionsDisabled && styles.commentActionDisabled,
                                    ]}
                                >
                                    Edit
                                </Text>
                            </TouchableOpacity>
                        )}

                        {onEdit && onDelete && <Text style={styles.commentActionDot}>·</Text>}

                        {onDelete && (
                            <TouchableOpacity
                                onPress={onDelete}
                                disabled={actionsDisabled}
                                hitSlop={COMMENT_ACTION_HIT_SLOP}
                                accessibilityRole="button"
                                accessibilityLabel={deleteAccessibilityLabel}
                                accessibilityState={{ disabled: actionsDisabled, busy: isDeleting }}
                            >
                                {isDeleting ? (
                                    <ActivityIndicator size="small" color={adminColors.danger} />
                                ) : (
                                    <Text
                                        style={[
                                            styles.commentAction,
                                            styles.commentActionDanger,
                                            actionsDisabled && styles.commentActionDisabled,
                                        ]}
                                    >
                                        {deleteLabel}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>
                )}
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
    commentAuthorRow: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 10,
    },
    commentAuthor: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    ownChip: {
        marginLeft: 6,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 6,
        backgroundColor: adminColors.primarySoft,
    },
    ownChipText: {
        fontSize: 10,
        fontWeight: '800',
        color: adminColors.primary,
        letterSpacing: 0.4,
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

    // ---- Actions under a comment (MOV-306) ----
    commentActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    commentAction: {
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.primary,
    },
    commentActionDanger: { color: adminColors.danger },
    commentActionDisabled: { color: adminColors.textPlaceholder },
    commentActionDot: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginHorizontal: 8,
    },

    // ---- Inline editor, styled as the composer is ----
    editInput: {
        minHeight: 44,
        maxHeight: 110,
        marginTop: 6,
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
    editButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
        marginTop: 8,
    },
    editCancel: {
        minHeight: 44,
        minWidth: 72,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    editCancelText: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textSecondary,
    },
    editSave: {
        minHeight: 44,
        minWidth: 72,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: adminColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    editSaveDisabled: { backgroundColor: adminColors.borderSubtle },
    editSaveText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    editSaveTextDisabled: { color: adminColors.textPlaceholder },

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
