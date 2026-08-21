/**
 * Uploads accessibility report photo evidence to Cloudinary.
 *
 * A report is a historical record, so its photos have to outlive the device
 * that took them: the picker's `file://` and `content://` uris are meaningless
 * to anyone but that one phone. Each photo is therefore uploaded as it is
 * picked, and only the `secure_url` Cloudinary returns is ever kept in form
 * state or sent to POST /api/reports.
 *
 * The upload is unsigned. The request carries the cloud name and the name of an
 * unsigned upload preset, both of which are public by design; signing would
 * need the API secret, and a secret bundled into a mobile app is a published
 * secret. Nothing here reads an API key or secret, and nothing should.
 */

/**
 * Cloudinary account and preset, inlined from `.env` at bundle time.
 *
 * Safe to expose under EXPO_PUBLIC_: an unsigned preset grants exactly one
 * ability — uploading into the folder the preset itself pins — and no ability
 * to read, overwrite or delete anything already there.
 */
const CLOUD_NAME = (process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || '').trim();
const UPLOAD_PRESET = (process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || '').trim();

/** Cloudinary refuses an image over 10MB on the free plans. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** A hung request must not leave a thumbnail spinning for ever. */
const UPLOAD_TIMEOUT_MS = 60_000;

const DEFAULT_MIME_TYPE = 'image/jpeg';

/** Shown when the app was built without the two variables above. */
export const CLOUDINARY_NOT_CONFIGURED_MESSAGE =
    'Photo upload is not configured. Please contact support or submit the report without photos.';

/** Whether an upload can be attempted at all. */
export function isCloudinaryConfigured(): boolean {
    return !!CLOUD_NAME && !!UPLOAD_PRESET;
}

/** What the picker hands over: the image itself, plus what it is called. */
export interface ReportPhotoSource {
    /** Local picker uri. Used only to identify the photo in form state. */
    uri: string;
    base64?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    fileSize?: number;
}

export type ReportPhotoUploadResult =
    | { ok: true; url: string }
    | { ok: false; message: string };

function failed(message: string): ReportPhotoUploadResult {
    return { ok: false, message };
}

/** Bytes behind a base64 payload, without materialising a buffer for them. */
function base64ByteLength(base64: string): number {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

    return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Uploads one photo and returns its `secure_url`.
 *
 * Base64 is sent as a `data:` URL rather than a file handle because that is the
 * one form the picker produces identically on native and on web — a
 * `{ uri, type, name }` part only works in React Native's FormData.
 *
 * Never throws: a failure is a result the caller renders on the thumbnail, so
 * the passenger can retry that one photo instead of losing the whole form.
 */
export async function uploadReportPhoto(
    photo: ReportPhotoSource
): Promise<ReportPhotoUploadResult> {
    if (!isCloudinaryConfigured()) {
        return failed(CLOUDINARY_NOT_CONFIGURED_MESSAGE);
    }

    const base64 = photo.base64?.trim();

    if (!base64) {
        // The picker returned no bytes for this asset, so there is nothing to
        // upload. Re-adding it is the only fix, and the message says so.
        return failed('This photo could not be read. Remove it and add it again.');
    }

    if (base64ByteLength(base64) > MAX_PHOTO_BYTES) {
        return failed(
            `This photo is larger than ${MAX_PHOTO_BYTES / (1024 * 1024)}MB. Please choose a smaller one.`
        );
    }

    const mimeType = photo.mimeType?.trim() || DEFAULT_MIME_TYPE;

    const form = new FormData();
    form.append('file', `data:${mimeType};base64,${base64}`);
    form.append('upload_preset', UPLOAD_PRESET);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
        const response = await fetch(
            `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
            { method: 'POST', body: form, signal: controller.signal }
        );

        const result = await response.json().catch(() => null);

        if (!response.ok) {
            // Cloudinary explains a rejected preset or an oversized file in
            // `error.message`, and that is worth showing verbatim: it is the
            // difference between "try again" and "this will never work".
            console.error('Cloudinary Upload Error:', response.status, result);

            return failed(
                typeof result?.error?.message === 'string'
                    ? result.error.message
                    : 'Photo upload failed. Please try again.'
            );
        }

        const secureUrl = typeof result?.secure_url === 'string' ? result.secure_url.trim() : '';

        // A 200 without an https url is not a successful upload, and storing
        // whatever came back would put an unusable value on the report.
        if (!secureUrl.startsWith('https://')) {
            console.error('Cloudinary Upload Error: no secure_url in response', result);

            return failed('Photo upload failed. Please try again.');
        }

        return { ok: true, url: secureUrl };
    } catch (error) {
        console.error('Cloudinary Upload Error:', error);

        return failed(
            (error as Error)?.name === 'AbortError'
                ? 'Photo upload timed out. Please try again.'
                : 'Photo upload failed. Check your connection and try again.'
        );
    } finally {
        clearTimeout(timeout);
    }
}
