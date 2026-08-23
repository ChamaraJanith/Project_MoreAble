/**
 * The photos a report already has, as form state.
 *
 * The form works in drafts: a picked photo is uploaded to Cloudinary as it is
 * chosen, and the draft carries the resulting secure URL. A report being edited
 * arrives with those URLs already — the upload happened when it was filed — so
 * each one becomes a draft that is already finished.
 *
 * That is what stops an edit from re-uploading photos nobody touched: a draft
 * in 'uploaded' state has nothing left to do, uploadedPhotoUrls picks its URL
 * straight back out, and the bytes never leave the phone a second time. It also
 * means removing one is the same operation as removing a newly picked photo.
 */

import { ReportPhotoDraft } from '../../../entities/report/model/types';

/**
 * Drafts for photos already stored on a report.
 *
 * The URL doubles as the draft's `uri` — the key the picker identifies photos
 * by, and what the thumbnail renders from. For a stored photo that is exactly
 * right: it is a remote https image, and it displays from the same URL the
 * report will be saved with.
 */
export function existingPhotoDrafts(photoUrls: string[] | undefined | null): ReportPhotoDraft[] {
    return (photoUrls ?? [])
        .filter((url) => typeof url === 'string' && !!url.trim())
        .map((url) => ({
            uri: url,
            status: 'uploaded' as const,
            url,
            // No base64: there are no local bytes behind a photo that was
            // uploaded on another day, and none are needed — a finished draft
            // is never re-uploaded, only kept or removed.
            base64: null,
        }));
}

/**
 * Whether the photos on the form still match the ones the report was loaded
 * with, in the same order.
 *
 * Used to tell an edit that changed nothing about its evidence from one that
 * added or removed a photo, without comparing image bytes.
 */
export function arePhotoUrlsUnchanged(
    original: string[] | undefined | null,
    current: string[]
): boolean {
    const before = original ?? [];

    return (
        before.length === current.length && before.every((url, index) => url === current[index])
    );
}
