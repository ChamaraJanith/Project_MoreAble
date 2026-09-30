import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    ActivityIndicator,
    Image,
    StyleSheet,
    
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { ReportCommentRecord } from '../../../entities/report/model/types';
import { adminColors } from '../../admin/ui/adminTheme';
import {
    DELETED_COMMENT_LABEL,
    MAX_FEEDBACK_COMMENT_LENGTH,
    OWN_COMMENT_LABEL,
    canSubmitCommentDraft,
    commentInitial,
    formatCommentTimestampLabel,
    groupCommentThreads,
    isOwnComment,
    isSubmittableCommentEdit,
    replyingToLabel,
} from '../utils/reportFeedback';
import { PendingCommentAction } from '../utils/reportFeedbackState';
import { CommentComposer } from './CommentComposer';
import { CommentImageAttachment } from './useCommentImageAttachment';

/**
 * Takes the 32pt action buttons under a comment past the smallest a touch
 * target should be (44pt) without making them look any larger.
 */
const COMMENT_ACTION_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

interface FeedbackCommentsProps {
    /**
     * Stored comments and replies, newest first, exactly as the API returned
     * them. Grouped into threads here.
     */
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
    /** The optional photo on the main composer. */
    attachment: CommentImageAttachment;
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

    // ---- Replies ----
    /** The comment the reply box is open under, and whose words it answers. */
    replyTarget?: CommentReplyTarget | null;
    replyDraft?: string;
    onChangeReplyDraft?: (text: string) => void;
    /** Opens the reply box for this comment (or, for a reply, its thread). */
    onStartReply?: (comment: ReportCommentRecord) => void;
    onCancelReply?: () => void;
    onSubmitReply?: () => void;
    /** The optional photo on the reply composer. */
    replyAttachment?: CommentImageAttachment;
    isPostingReply?: boolean;
    replyError?: string | null;
}

/** Where an open reply box sits, and who it answers. */
export interface CommentReplyTarget {
    /** Always a top-level comment: replies go one level deep. */
    parentCommentId: string;
    /** The author of the comment or reply that Reply was pressed on. */
    authorName: string;
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
    attachment,
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
    replyTarget = null,
    replyDraft = '',
    onChangeReplyDraft,
    onStartReply,
    onCancelReply,
    onSubmitReply,
    replyAttachment,
    isPostingReply = false,
    replyError = null,
}: FeedbackCommentsProps) {
    const canSubmit = canSubmitCommentDraft(draft, attachment.image) && !isPosting;
    const canSubmitReply =
        canSubmitCommentDraft(replyDraft, replyAttachment?.image ?? null) && !isPostingReply;
    const threads = groupCommentThreads(comments);

    /**
     * Edit and Delete, for the signed-in passenger's own comment and nobody
     * else's. Another passenger's comment gets no controls at all — the API
     * would refuse them (403), and offering them would be a promise it breaks.
     */
    const ownCommentActions = (comment: ReportCommentRecord) => {
        if (!isOwnComment(comment, viewerPassengerId)) return {};
        if (comment.deleted) return {};

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

    /**
     * One comment or reply. The only place a row is drawn, so the viewer's own
     * Edit and Delete reach every row through ownCommentActions and nothing
     * else. Reply is offered on anything still saying something.
     */
    const renderComment = (comment: ReportCommentRecord, isReply = false) => (
        <CommentRow
            comment={comment}
            isFirst
            isReply={isReply}
            isOwn={isOwnComment(comment, viewerPassengerId)}
            onReply={
                onStartReply && !comment.deleted && editingCommentId !== comment.commentId
                    ? () => onStartReply(comment)
                    : undefined
            }
            {...ownCommentActions(comment)}
        />
    );

    return (
        <View>
            {isLoading ? (
                <CommentsLoading />
            ) : loadError ? (
                <CommentsError message={loadError} />
            ) : threads.length > 0 ? (
                threads.map((thread, index) => (
                    <CommentThreadLayout
                        key={thread.comment.commentId}
                        isFirst={index === 0}
                        comment={renderComment(thread.comment)}
                        // One level only: Reply on a reply adds to this same
                        // thread, so every reply hangs off the one rail.
                        replies={thread.replies.map((reply) => (
                            <React.Fragment key={reply.commentId}>
                                {renderComment(reply, true)}
                            </React.Fragment>
                        ))}
                        footer={
                            replyTarget?.parentCommentId === thread.comment.commentId &&
                            replyAttachment &&
                            onChangeReplyDraft &&
                            onSubmitReply ? (
                                <CommentComposer
                                    compact
                                    autoFocus
                                    value={replyDraft}
                                    onChangeText={onChangeReplyDraft}
                                    onSubmit={onSubmitReply}
                                    canSubmit={canSubmitReply}
                                    isPosting={isPostingReply}
                                    attachment={replyAttachment}
                                    placeholder="Write a reply..."
                                    accessibilityLabel="Write a reply"
                                    replyingTo={replyingToLabel(replyTarget.authorName)}
                                    onCancel={onCancelReply}
                                    error={replyError}
                                />
                            ) : null
                        }
                    />
                ))
            ) : (
                <EmptyComments />
            )}

            {/* An edit or delete that did not go through, said inside the
                thread it was about. A comment that failed to POST is still
                reported under the votes, exactly as before. */}
            {commentActionError && <CommentsError message={commentActionError} />}

            <CommentComposer
                value={draft}
                onChangeText={onChangeDraft}
                onSubmit={onSubmit}
                canSubmit={canSubmit}
                isPosting={isPosting}
                attachment={attachment}
                placeholder="Write a comment..."
                accessibilityLabel="Add a comment"
                accessibilityHint="Share what you experienced on this journey"
            />
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
 * One top-level comment and everything hanging off it.
 *
 * The replies — and the reply box, when it is open here — sit on a thin rail
 * that drops from the centre of the parent's avatar, so which comment a reply
 * answers is read from the shape of the thread rather than worked out from
 * its indent. Threads are separated by a hairline; nothing inside a thread is.
 *
 * Shared by the passenger thread and the admin review page, so the two draw
 * the same thread the same way.
 */
export function CommentThreadLayout({
    isFirst,
    comment,
    replies = [],
    footer = null,
}: {
    /** The first thread in the card draws no separator above it. */
    isFirst: boolean;
    /** The top-level comment's row. */
    comment: React.ReactNode;
    /** The reply rows, oldest first. */
    replies?: React.ReactNode[];
    /** Drawn at the end of the rail: the open reply box, if any. */
    footer?: React.ReactNode;
}) {
    const hasRail = replies.length > 0 || !!footer;

    return (
        <View style={!isFirst && styles.threadDivided}>
            {comment}

            {hasRail && (
                <View style={styles.threadRail}>
                    {replies}
                    {footer}
                </View>
            )}
        </View>
    );
}

/**
 * One secondary action under a comment — Reply, Edit, Delete.
 *
 * A quiet icon-and-label button: small enough not to compete with what was
 * said, but shaped like a control rather than a stray word. The visible box is
 * 32pt; the hit slop takes the touch target past 44pt.
 */
function CommentActionButton({
    icon,
    label,
    onPress,
    disabled,
    accessibilityLabel,
    destructive = false,
    isBusy = false,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled: boolean;
    accessibilityLabel: string;
    destructive?: boolean;
    isBusy?: boolean;
}) {
    const color = disabled
        ? adminColors.textPlaceholder
        : destructive
          ? adminColors.danger
          : adminColors.textSecondary;

    return (
        <TouchableOpacity
            style={styles.actionButton}
            onPress={onPress}
            disabled={disabled}
            hitSlop={COMMENT_ACTION_HIT_SLOP}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled, busy: isBusy }}
        >
            {isBusy ? (
                <ActivityIndicator size="small" color={color} />
            ) : (
                <Ionicons name={icon} size={14} color={color} />
            )}
            <Text style={[styles.actionLabel, { color }]}>{label}</Text>
        </TouchableOpacity>
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
    isReply = false,
    isOwn = false,
    onReply,
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
    /** Drawn as a reply: a smaller avatar, indented by the thread around it. */
    isReply?: boolean;
    /** Opens the reply box under this comment's thread. */
    onReply?: () => void;
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
    // A deleted placeholder says so and nothing else: no actions, no photo.
    const isDeleted = !!comment.deleted;
    const hasActions = !isDeleted && !isEditing && (!!onReply || !!onEdit || !!onDelete);
    const deleteAccessibilityLabel = isOwn
        ? `${deleteLabel} your comment`
        : `${deleteLabel} comment by ${comment.authorName}`;

    return (
        <View style={[styles.commentRow, !isFirst && styles.divided]}>
            <View style={[styles.avatar, isReply && styles.avatarReply]}>
                <Text style={[styles.avatarInitial, isReply && styles.avatarInitialReply]}>
                    {isDeleted ? '–' : commentInitial(comment.authorName)}
                </Text>
            </View>

            <View style={styles.commentBody}>
                {/* Who, then when — stacked, so the name is never pushed
                    against a date at the far edge of the card. */}
                <View style={styles.commentAuthorRow}>
                    <Text style={styles.commentAuthor} numberOfLines={1}>
                        {isDeleted ? 'Deleted comment' : comment.authorName}
                    </Text>

                    {/* Said in a word, not a colour: the chip is what
                        marks the comment as the viewer's own. */}
                    {isOwn && (
                        <View style={styles.ownChip}>
                            <Text style={styles.ownChipText}>{OWN_COMMENT_LABEL}</Text>
                        </View>
                    )}
                </View>
                <Text style={styles.commentDate}>{formatCommentTimestampLabel(comment)}</Text>

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
                ) : isDeleted ? (
                    <Text style={[styles.commentText, styles.commentTextDeleted]}>
                        {DELETED_COMMENT_LABEL}
                    </Text>
                ) : (
                    !!comment.text && <Text style={styles.commentText}>{comment.text}</Text>
                )}

                {!isDeleted && !!comment.imageUrl && (
                    <Image
                        source={{ uri: comment.imageUrl }}
                        style={styles.commentImage}
                        resizeMode="cover"
                        accessibilityLabel={`Photo attached by ${comment.authorName}`}
                    />
                )}

                {hasActions && (
                    <View style={styles.commentActions}>
                        {onReply && (
                            <CommentActionButton
                                icon="arrow-undo-outline"
                                label="Reply"
                                onPress={onReply}
                                disabled={actionsDisabled}
                                accessibilityLabel={`Reply to ${comment.authorName}`}
                            />
                        )}

                        {onEdit && (
                            <CommentActionButton
                                icon="create-outline"
                                label="Edit"
                                onPress={onEdit}
                                disabled={actionsDisabled}
                                accessibilityLabel="Edit your comment"
                            />
                        )}

                        {onDelete && (
                            <CommentActionButton
                                icon="trash-outline"
                                label={deleteLabel}
                                onPress={onDelete}
                                disabled={actionsDisabled}
                                accessibilityLabel={deleteAccessibilityLabel}
                                destructive
                                isBusy={isDeleting}
                            />
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

    // ---- One thread: a comment, then its replies on a rail ----
    threadDivided: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 14,
        paddingTop: 14,
    },
    threadRail: {
        // The 2pt rail sits under the centre of the 34pt parent avatar.
        marginLeft: 16,
        marginTop: 8,
        paddingLeft: 14,
        borderLeftWidth: 2,
        borderLeftColor: adminColors.border,
        gap: 12,
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
    avatarReply: { width: 28, height: 28, borderRadius: 14 },
    avatarInitialReply: { fontSize: 12 },
    commentBody: { flex: 1, minWidth: 0, marginLeft: 10 },
    commentAuthorRow: {
        flexDirection: 'row',
        alignItems: 'center',
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
        fontWeight: '500',
        color: adminColors.textMuted,
        marginTop: 1,
    },
    commentText: {
        // The darkest thing in the row after the name: what was said
        // outranks the controls under it.
        fontSize: 13,
        color: adminColors.textPrimary,
        lineHeight: 19,
        marginTop: 6,
    },
    commentTextDeleted: {
        fontStyle: 'italic',
        color: adminColors.textPlaceholder,
    },
    commentImage: {
        width: '100%',
        maxWidth: 260,
        aspectRatio: 4 / 3,
        borderRadius: 10,
        marginTop: 8,
        backgroundColor: adminColors.borderSubtle,
    },

    // ---- Actions under a comment: quiet icon-and-label buttons ----
    commentActions: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 2,
        marginTop: 4,
        // Pulls the first button's padding back so its icon lines up with
        // the comment text above it.
        marginLeft: -8,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 32,
        paddingHorizontal: 8,
        borderRadius: 8,
    },
    actionLabel: {
        fontSize: 12,
        fontWeight: '600',
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
});
