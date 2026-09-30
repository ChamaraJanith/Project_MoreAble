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
import { adminColors } from '../../admin/ui/adminTheme';
import { MAX_FEEDBACK_COMMENT_LENGTH } from '../utils/reportFeedback';
import { CommentImageAttachment } from './useCommentImageAttachment';

/** Past the smallest a touch target should be, for the small close controls. */
const SMALL_CONTROL_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

interface CommentComposerProps {
    value: string;
    onChangeText: (text: string) => void;
    onSubmit: () => void;
    /** Whether Send may be pressed — decided by the caller's state helpers. */
    canSubmit: boolean;
    /** The comment or reply is on its way to the API. */
    isPosting: boolean;
    attachment: CommentImageAttachment;
    placeholder: string;
    accessibilityLabel: string;
    accessibilityHint?: string;
    /** "Replying to Kasun", with a control to close the composer. */
    replyingTo?: string;
    onCancel?: () => void;
    /** Why the last send failed, said inside the composer. */
    error?: string | null;
    autoFocus?: boolean;
    /** Drawn inside a thread (the reply box) rather than under it. */
    compact?: boolean;
}

/**
 * The box for writing a comment or a reply, with an optional photo.
 *
 * The photo is previewed above the input as soon as it is picked, uploading in
 * place: a spinner while it goes, Retry if it failed, and a remove control
 * throughout. Send stays disabled until the photo is uploaded, so a comment is
 * never posted without the photo its author attached.
 */
export function CommentComposer({
    value,
    onChangeText,
    onSubmit,
    canSubmit,
    isPosting,
    attachment,
    placeholder,
    accessibilityLabel,
    accessibilityHint,
    replyingTo,
    onCancel,
    error = null,
    autoFocus = false,
    compact = false,
}: CommentComposerProps) {
    const { image } = attachment;
    const attachDisabled = isPosting || attachment.isPicking;

    return (
        <View style={compact ? styles.compact : styles.composer}>
            {replyingTo && (
                <View style={styles.replyingRow}>
                    <Ionicons name="return-down-forward" size={14} color={adminColors.primary} />
                    <Text style={styles.replyingText} numberOfLines={1}>
                        {replyingTo}
                    </Text>

                    {onCancel && (
                        <TouchableOpacity
                            onPress={onCancel}
                            disabled={isPosting}
                            hitSlop={SMALL_CONTROL_HIT_SLOP}
                            accessibilityRole="button"
                            accessibilityLabel="Cancel reply"
                        >
                            <Ionicons name="close" size={18} color={adminColors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {image && (
                <View style={styles.previewRow}>
                    <View style={styles.preview}>
                        <Image
                            source={{ uri: image.uri }}
                            style={styles.previewImage}
                            accessibilityLabel="Attached photo preview"
                        />

                        {image.status === 'uploading' && (
                            <View style={styles.previewOverlay}>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            </View>
                        )}

                        {image.status === 'failed' && (
                            <TouchableOpacity
                                style={[styles.previewOverlay, styles.previewOverlayFailed]}
                                onPress={attachment.retry}
                                disabled={isPosting}
                                accessibilityRole="button"
                                accessibilityLabel="Retry uploading the photo"
                            >
                                <Ionicons name="refresh" size={16} color="#FFFFFF" />
                                <Text style={styles.retryText}>Retry</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={styles.removeButton}
                            onPress={attachment.remove}
                            disabled={isPosting}
                            accessibilityRole="button"
                            accessibilityLabel="Remove the attached photo"
                        >
                            <Ionicons name="close" size={12} color="#FFFFFF" />
                        </TouchableOpacity>
                    </View>

                    <Text
                        style={[
                            styles.previewStatus,
                            image.status === 'failed' && styles.errorText,
                        ]}
                        accessibilityLiveRegion="polite"
                    >
                        {image.status === 'uploading'
                            ? 'Uploading photo…'
                            : image.status === 'failed'
                              ? image.error || 'Photo upload failed.'
                              : 'Photo attached'}
                    </Text>
                </View>
            )}

            <View style={styles.inputRow}>
                <TouchableOpacity
                    style={[styles.attachButton, attachDisabled && styles.attachButtonDisabled]}
                    onPress={attachment.attach}
                    disabled={attachDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={image ? 'Change the attached photo' : 'Attach a photo'}
                    accessibilityState={{ disabled: attachDisabled, busy: attachment.isPicking }}
                >
                    <Ionicons
                        name="camera-outline"
                        size={20}
                        color={attachDisabled ? adminColors.textPlaceholder : adminColors.primary}
                    />
                </TouchableOpacity>

                <TextInput
                    style={[styles.input, compact && styles.inputOnMuted]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={adminColors.textPlaceholder}
                    maxLength={MAX_FEEDBACK_COMMENT_LENGTH}
                    multiline
                    autoFocus={autoFocus}
                    editable={!isPosting}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityHint={accessibilityHint}
                />

                <TouchableOpacity
                    style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    accessibilityRole="button"
                    accessibilityLabel={isPosting ? 'Sending' : 'Send'}
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

            {error && (
                <View style={styles.errorRow} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle-outline" size={15} color={adminColors.danger} />
                    <Text style={[styles.statusText, styles.errorText]}>{error}</Text>
                </View>
            )}
        </View>
    );
}

const PREVIEW_SIZE = 72;

const styles = StyleSheet.create({
    composer: {
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
    },
    compact: {
        padding: 10,
        borderRadius: 12,
        backgroundColor: adminColors.surfaceMuted,
    },

    replyingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
    },
    replyingText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '700',
        color: adminColors.primary,
    },

    previewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    preview: {
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
    },
    previewImage: {
        width: '100%',
        height: '100%',
        borderRadius: 10,
        backgroundColor: adminColors.borderSubtle,
    },
    previewOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    previewOverlayFailed: { backgroundColor: 'rgba(0, 0, 0, 0.6)' },
    retryText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 2,
    },
    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: adminColors.danger,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: adminColors.surface,
    },
    previewStatus: {
        flex: 1,
        marginLeft: 12,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.textMuted,
        lineHeight: 17,
    },

    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    attachButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        marginRight: 8,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    attachButtonDisabled: { backgroundColor: adminColors.surfaceMuted },
    input: {
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
    inputOnMuted: { backgroundColor: adminColors.surface },
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

    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        marginTop: 10,
    },
    statusText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
    },
    errorText: { color: adminColors.danger },
});
