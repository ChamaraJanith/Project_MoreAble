import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { ReportPhotoDraft } from '../../../entities/report/model/types';
import {
    CLOUDINARY_NOT_CONFIGURED_MESSAGE,
    isCloudinaryConfigured,
    uploadReportPhoto,
} from '../api/reportPhotoUpload';
import { commentImageProblem } from '../utils/reportFeedback';

/** One composer's optional photo, and the controls that change it. */
export interface CommentImageAttachment {
    /** The picked photo and where its upload has got to, or null. */
    image: ReportPhotoDraft | null;
    /** The picker is open. */
    isPicking: boolean;
    /** Offers the camera or the library (the library alone on web). */
    attach: () => void;
    /** Drops the photo — also how a failed one is abandoned. */
    remove: () => void;
    /** Runs a failed upload again. */
    retry: () => void;
    /** Clears the photo after the comment it belonged to was stored. */
    reset: () => void;
}

/**
 * The photo on one comment or reply composer.
 *
 * Uses the same pipeline as a report's photo evidence: the photo is uploaded
 * to Cloudinary as soon as it is picked, and the composer only ever sends the
 * resulting secure URL — so Send stays disabled until that upload succeeds,
 * and a failed one offers Retry or Remove rather than a comment without it.
 *
 * Nothing here holds a credential: the upload is unsigned against a public
 * preset (see reportPhotoUpload).
 */
export function useCommentImageAttachment(): CommentImageAttachment {
    const [image, setImage] = useState<ReportPhotoDraft | null>(null);
    const [isPicking, setIsPicking] = useState(false);

    // The photo currently on the composer, so an upload that finishes after
    // it was removed or replaced lands nowhere.
    const currentUri = useRef<string | null>(null);

    const upload = useCallback(async (photo: ReportPhotoDraft) => {
        const result = await uploadReportPhoto(photo);

        if (currentUri.current !== photo.uri) return;

        setImage((current) =>
            current?.uri !== photo.uri
                ? current
                : result.ok
                  ? { ...current, status: 'uploaded', url: result.url, error: undefined }
                  : { ...current, status: 'failed', url: undefined, error: result.message }
        );
    }, []);

    const accept = useCallback(
        (asset: ImagePicker.ImagePickerAsset) => {
            const problem = commentImageProblem(asset);

            if (problem) {
                Alert.alert('Photo not added', problem);
                return;
            }

            const photo: ReportPhotoDraft = {
                uri: asset.uri,
                base64: asset.base64,
                mimeType: asset.mimeType ?? 'image/jpeg',
                fileName: asset.fileName,
                fileSize: asset.fileSize,
                status: 'uploading',
            };

            currentUri.current = photo.uri;
            setImage(photo);
            upload(photo);
        },
        [upload]
    );

    const launch = useCallback(
        async (source: 'camera' | 'library') => {
            if (!isCloudinaryConfigured()) {
                Alert.alert('Photo upload unavailable', CLOUDINARY_NOT_CONFIGURED_MESSAGE);
                return;
            }

            setIsPicking(true);

            try {
                const permission =
                    source === 'camera'
                        ? await ImagePicker.requestCameraPermissionsAsync()
                        : await ImagePicker.requestMediaLibraryPermissionsAsync();

                if (!permission.granted) {
                    Alert.alert(
                        source === 'camera' ? 'Camera access needed' : 'Photo access needed',
                        source === 'camera'
                            ? 'Allow camera access in your device settings to take a photo.'
                            : 'Allow photo library access in your device settings to attach a photo.'
                    );
                    return;
                }

                const options: ImagePicker.ImagePickerOptions = {
                    mediaTypes: ['images'],
                    quality: 0.7,
                    base64: true,
                };

                const result =
                    source === 'camera'
                        ? await ImagePicker.launchCameraAsync(options)
                        : await ImagePicker.launchImageLibraryAsync(options);

                if (result.canceled || !result.assets?.[0]) return;

                accept(result.assets[0]);
            } catch (error) {
                console.error('Comment Photo Picker Error:', error);
                Alert.alert('Unable to add photo', 'Something went wrong opening your photos.');
            } finally {
                setIsPicking(false);
            }
        },
        [accept]
    );

    const attach = useCallback(() => {
        if (isPicking) return;

        // Alert's buttons do nothing on web, where the camera is also rarely
        // what anybody means — go straight to the file chooser there.
        if (Platform.OS === 'web') {
            launch('library');
            return;
        }

        Alert.alert('Attach a photo', undefined, [
            { text: 'Take Photo', onPress: () => launch('camera') },
            { text: 'Choose from Library', onPress: () => launch('library') },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [isPicking, launch]);

    const reset = useCallback(() => {
        currentUri.current = null;
        setImage(null);
    }, []);

    const retry = useCallback(() => {
        if (!image || image.status !== 'failed') return;

        const photo: ReportPhotoDraft = { ...image, status: 'uploading', error: undefined };

        setImage(photo);
        upload(photo);
    }, [image, upload]);

    return { image, isPicking, attach, remove: reset, retry, reset };
}
