import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ReportPhotoDraft } from '../../../entities/report/model/types';
import { adminColors } from '../../admin/ui/adminTheme';
import { formatPhotoCount } from '../utils/reportFormat';

/** Enough evidence to describe an issue without making the form unwieldy. */
export const MAX_REPORT_PHOTOS = 5;

interface PhotoEvidencePickerProps {
    photos: ReportPhotoDraft[];
    onChange: (photos: ReportPhotoDraft[]) => void;
    /** Locks the controls while the report is being submitted. */
    disabled?: boolean;
}

export function PhotoEvidencePicker({ photos, onChange, disabled = false }: PhotoEvidencePickerProps) {
    const [isPicking, setIsPicking] = useState(false);

    const remaining = MAX_REPORT_PHOTOS - photos.length;
    const isFull = remaining <= 0;
    const controlsDisabled = disabled || isPicking || isFull;

    /** Appends new assets, skipping duplicates and anything over the cap. */
    const appendAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
        const existingUris = new Set(photos.map((photo) => photo.uri));

        const added = assets
            .filter((asset) => !existingUris.has(asset.uri))
            .slice(0, remaining)
            .map<ReportPhotoDraft>((asset) => ({
                uri: asset.uri,
                fileName: asset.fileName,
                fileSize: asset.fileSize,
            }));

        if (added.length > 0) onChange([...photos, ...added]);
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
        onChange(photos.filter((photo) => photo.uri !== uri));
    };

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
                    </Text>
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
});
