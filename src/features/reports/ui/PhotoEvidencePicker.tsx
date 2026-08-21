import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    MAX_REPORT_PHOTOS,
    ReportPhotoDraft,
} from '../../../entities/report/model/types';
import { adminColors } from '../../admin/ui/adminTheme';
import { uploadReportPhoto } from '../api/reportPhotoUpload';
import { formatPhotoCount } from '../utils/reportFormat';

// Defined once in the entity model and re-exported here so existing importers
// are unaffected — the picker cannot offer a slot the upload would refuse.
export { MAX_REPORT_PHOTOS };

interface PhotoEvidencePickerProps {
    photos: ReportPhotoDraft[];
    /**
     * A state setter rather than a plain callback, because uploads settle after
     * the pick that started them: applying each result functionally is what
     * stops two photos finishing at once from overwriting each other.
     */
    onChange: React.Dispatch<React.SetStateAction<ReportPhotoDraft[]>>;
    /** Locks the controls while the report is being submitted. */
    disabled?: boolean;
}

export function PhotoEvidencePicker({ photos, onChange, disabled = false }: PhotoEvidencePickerProps) {
    const [isPicking, setIsPicking] = useState(false);

    const remaining = MAX_REPORT_PHOTOS - photos.length;
    const isFull = remaining <= 0;
    const controlsDisabled = disabled || isPicking || isFull;

    /**
     * Uploads one photo and writes the outcome back onto its draft.
     *
     * Matched by uri, so a photo the passenger removed while it was in flight
     * simply finds nothing to update rather than reappearing in the grid.
     */
    const uploadPhoto = useCallback(
        async (photo: ReportPhotoDraft) => {
            const result = await uploadReportPhoto(photo);

            onChange((current) =>
                current.map((entry) =>
                    entry.uri !== photo.uri
                        ? entry
                        : result.ok
                          ? { ...entry, status: 'uploaded', url: result.url, error: undefined }
                          : { ...entry, status: 'failed', url: undefined, error: result.message }
                )
            );
        },
        [onChange]
    );

    /**
     * Appends new assets, skipping duplicates and anything over the cap, then
     * starts each upload.
     *
     * Uploading as the photo is picked rather than at submit time is what keeps
     * a `file://` uri out of the report: by the time Submit is pressed the
     * photo is already a Cloudinary URL, and the thumbnail says so while it is
     * not.
     */
    const appendAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
        const existingUris = new Set(photos.map((photo) => photo.uri));

        const added = assets
            .filter((asset) => !existingUris.has(asset.uri))
            .slice(0, remaining)
            .map<ReportPhotoDraft>((asset) => ({
                uri: asset.uri,
                base64: asset.base64,
                mimeType: asset.mimeType ?? 'image/jpeg',
                fileName: asset.fileName,
                fileSize: asset.fileSize,
                status: 'uploading',
            }));

        if (added.length === 0) return;

        onChange((current) => [...current, ...added]);
        added.forEach((photo) => uploadPhoto(photo));
    };

    /** Re-runs a failed upload for one photo, leaving the others alone. */
    const retryPhoto = (photo: ReportPhotoDraft) => {
        if (disabled) return;

        onChange((current) =>
            current.map((entry) =>
                entry.uri === photo.uri
                    ? { ...entry, status: 'uploading', error: undefined }
                    : entry
            )
        );

        uploadPhoto(photo);
    };

    const pickFromLibrary = async () => {
        if (controlsDisabled) return;
        setIsPicking(true);

        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (!permission.granted) {
                Alert.alert(
                    'Photo access needed',
                    'Allow photo library access in your device settings to attach photo evidence.'
                );
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsMultipleSelection: true,
                selectionLimit: remaining,
                quality: 0.7,
                base64: true,
            });

            if (result.canceled) return;
            appendAssets(result.assets);
        } catch (error) {
            console.error('Photo Library Error:', error);
            Alert.alert('Unable to open photos', 'Something went wrong opening your photo library.');
        } finally {
            setIsPicking(false);
        }
    };

    const takePhoto = async () => {
        if (controlsDisabled) return;
        setIsPicking(true);

        try {
            const permission = await ImagePicker.requestCameraPermissionsAsync();

            if (!permission.granted) {
                Alert.alert(
                    'Camera access needed',
                    'Allow camera access in your device settings to photograph the issue.'
                );
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.7,
                base64: true,
            });

            if (result.canceled) return;
            appendAssets(result.assets);
        } catch (error) {
            console.error('Camera Error:', error);
            Alert.alert('Unable to open camera', 'Something went wrong opening your camera.');
        } finally {
            setIsPicking(false);
        }
    };

    const removePhoto = (uri: string) => {
        onChange((current) => current.filter((photo) => photo.uri !== uri));
    };

    const uploadingCount = photos.filter((photo) => photo.status === 'uploading').length;
    const failedCount = photos.filter((photo) => photo.status === 'failed').length;

    return (
        <View style={styles.card}>
            <Text style={styles.supportingText}>
                Upload one or more photos to help us understand the accessibility issue.
            </Text>

            {/* Upload area */}
            <TouchableOpacity
                style={[styles.uploadArea, controlsDisabled && styles.uploadAreaDisabled]}
                onPress={pickFromLibrary}
                disabled={controlsDisabled}
                accessibilityRole="button"
                accessibilityLabel="Add photos from your photo library"
                accessibilityState={{ disabled: controlsDisabled }}
            >
                <View style={styles.uploadIconCircle}>
                    <Ionicons name="images-outline" size={26} color={adminColors.primary} />
                </View>
                <Text style={styles.uploadTitle}>{isFull ? 'Photo limit reached' : 'Add Photos'}</Text>
                <Text style={styles.uploadHint}>
                    {isFull
                        ? `You can attach up to ${MAX_REPORT_PHOTOS} photos.`
                        : 'Upload evidence of the accessibility issue'}
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.cameraButton, controlsDisabled && styles.cameraButtonDisabled]}
                onPress={takePhoto}
                disabled={controlsDisabled}
                accessibilityRole="button"
                accessibilityLabel="Take a photo with the camera"
                accessibilityState={{ disabled: controlsDisabled }}
            >
                <Ionicons name="camera-outline" size={18} color={adminColors.primary} />
                <Text style={styles.cameraButtonText}>Take Photo</Text>
            </TouchableOpacity>

            {/* Selected thumbnails */}
            {photos.length > 0 && (
                <>
                    <View style={styles.thumbnailGrid}>
                        {photos.map((photo, index) => (
                            <View key={photo.uri} style={styles.thumbnailWrapper}>
                                <Image
                                    source={{ uri: photo.uri }}
                                    style={styles.thumbnail}
                                    accessibilityLabel={`Selected photo ${index + 1}`}
                                />

                                {photo.status === 'uploading' && (
                                    <View style={styles.thumbnailOverlay}>
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    </View>
                                )}

                                {/* A failed photo keeps its slot and offers the
                                    retry rather than being dropped: Submit
                                    stays blocked until it succeeds or the
                                    passenger removes it. */}
                                {photo.status === 'failed' && (
                                    <TouchableOpacity
                                        style={[
                                            styles.thumbnailOverlay,
                                            styles.thumbnailOverlayFailed,
                                        ]}
                                        onPress={() => retryPhoto(photo)}
                                        disabled={disabled}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Retry uploading photo ${index + 1}`}
                                    >
                                        <Ionicons name="refresh" size={18} color="#FFFFFF" />
                                        <Text style={styles.retryText}>Retry</Text>
                                    </TouchableOpacity>
                                )}

                                <TouchableOpacity
                                    style={styles.removeButton}
                                    onPress={() => removePhoto(photo.uri)}
                                    disabled={disabled}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remove photo ${index + 1}`}
                                >
                                    <Ionicons name="close" size={14} color="#FFFFFF" />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>

                    <Text style={styles.countText} accessibilityLiveRegion="polite">
                        {formatPhotoCount(photos.length)} selected
                        {isFull ? '' : ` · ${remaining} more allowed`}
                        {uploadingCount > 0 ? ` · uploading ${uploadingCount}…` : ''}
                    </Text>

                    {failedCount > 0 && (
                        <Text style={styles.failedText} accessibilityRole="alert">
                            {failedCount === 1
                                ? 'A photo failed to upload. Tap Retry on it, or remove it.'
                                : `${failedCount} photos failed to upload. Retry them, or remove them.`}
                        </Text>
                    )}
                </>
            )}
        </View>
    );
}

const THUMBNAIL_SIZE = 92;

const styles = StyleSheet.create({
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    supportingText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 19,
        marginBottom: 14,
    },

    uploadArea: {
        alignItems: 'center',
        paddingVertical: 22,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: adminColors.primary,
        backgroundColor: adminColors.primarySoft,
    },
    uploadAreaDisabled: {
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
    },
    uploadIconCircle: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: adminColors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 10,
    },
    uploadTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    uploadHint: {
        fontSize: 12,
        color: adminColors.textSecondary,
        marginTop: 3,
        textAlign: 'center',
    },

    cameraButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 46,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surface,
        marginTop: 10,
    },
    cameraButtonDisabled: { opacity: 0.5 },
    cameraButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: adminColors.primary,
        marginLeft: 7,
    },

    thumbnailGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 16,
    },
    thumbnailWrapper: {
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
    },
    thumbnail: {
        width: '100%',
        height: '100%',
        borderRadius: 10,
        backgroundColor: adminColors.borderSubtle,
    },
    thumbnailOverlay: {
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
    thumbnailOverlayFailed: {
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    retryText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 3,
    },

    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: adminColors.danger,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: adminColors.surface,
    },

    countText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginTop: 12,
    },
    failedText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.danger,
        marginTop: 6,
        lineHeight: 18,
    },
});
