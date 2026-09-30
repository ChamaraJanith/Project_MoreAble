/**
 * Photo evidence for accessibility reports: what POST /api/reports will store.
 *
 * The app uploads each photo to Cloudinary as it is picked and sends only the
 * resulting `secure_url`, so the API never handles image bytes. What it does
 * have to do is refuse anything that is not one of those URLs — a report is a
 * historical record, and a `file://` uri or a plain-http link on it is evidence
 * that either cannot be fetched at all or can be swapped in transit, which
 * reads to a reviewer as a photo that simply does not load.
 */

import { MAX_REPORT_PHOTOS } from '../../entities/report/model/types';

// Re-exported so the API route takes the cap from the module that enforces it.
export { MAX_REPORT_PHOTOS };

/**
 * Cloudinary's delivery host.
 *
 * Pinned rather than accepting any https URL: without it the field is an open
 * invitation to hang an arbitrary third-party link off a report, which is then
 * loaded by every reviewer who opens it. Subdomains are allowed because a
 * Cloudinary account with a custom CNAME delivers from one.
 */
const CLOUDINARY_HOST_SUFFIX = '.cloudinary.com';

export type PhotoValidation<T> = { ok: true; value: T } | { ok: false; message: string };

function invalid<T>(message: string): PhotoValidation<T> {
    return { ok: false, message };
}

/**
 * Validates the `photoUrls` field: the Cloudinary URLs the app uploaded to.
 *
 * Absent, null and an empty list are all "no photos" — a passenger reporting an
 * issue they could not photograph is a normal submission, not an error.
 */
export function normalizeReportPhotoUrls(input: unknown): PhotoValidation<string[]> {
    if (input === undefined || input === null) return { ok: true, value: [] };

    if (!Array.isArray(input)) {
        return invalid('Photo URLs must be provided as a list.');
    }

    if (input.length > MAX_REPORT_PHOTOS) {
        return invalid(`A report can include at most ${MAX_REPORT_PHOTOS} photos.`);
    }

    const urls: string[] = [];

    for (let index = 0; index < input.length; index += 1) {
        const entry = input[index];
        const position = index + 1;

        if (typeof entry !== 'string' || !entry.trim()) {
            return invalid(`Photo URL ${position} is not a valid URL.`);
        }

        const problem = uploadedPhotoUrlProblem(entry.trim());

        if (problem) return invalid(`Photo URL ${position} ${problem}.`);

        urls.push(entry.trim());
    }

    return { ok: true, value: urls };
}

/**
 * What is wrong with one URL as an uploaded photo, or null when nothing is.
 *
 * Shared by report evidence and comment photos, so both hold a photo to the
 * same rule: https, and on Cloudinary's delivery host.
 */
function uploadedPhotoUrlProblem(value: string): string | null {
    let parsed: URL;

    try {
        parsed = new URL(value);
    } catch {
        return 'is not a valid URL';
    }

    if (parsed.protocol !== 'https:') return 'must be an https URL';

    if (!parsed.hostname.endsWith(CLOUDINARY_HOST_SUFFIX)) return 'is not an uploaded photo URL';

    return null;
}

/**
 * Validates a comment's optional `imageUrl`: one Cloudinary URL the app
 * uploaded to, or nothing. Absent, null and an empty string are all "no photo".
 */
export function normalizeCommentImageUrl(input: unknown): PhotoValidation<string | null> {
    if (input === undefined || input === null || input === '') return { ok: true, value: null };

    if (typeof input !== 'string' || !input.trim()) {
        return invalid('The attached photo is not a valid URL.');
    }

    const value = input.trim();
    const problem = uploadedPhotoUrlProblem(value);

    return problem ? invalid(`The attached photo ${problem}.`) : { ok: true, value };
}
