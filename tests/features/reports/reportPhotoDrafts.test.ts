// Photos a report already has, when the form is opened to edit it.
//
// The point of this module is that editing a report does not re-upload the
// evidence it was filed with. Each stored Cloudinary URL becomes a draft that
// is already finished, so the picker displays it and can remove it, while the
// bytes — which are not even on this phone — never move.

import { existingPhotoDrafts, arePhotoUrlsUnchanged } from '../../../src/features/reports/utils/reportPhotoDrafts';
import { uploadedPhotoUrls } from '../../../src/features/reports/utils/reportFormValidation';

const PHOTOS = [
    'https://res.cloudinary.com/moreable/image/upload/v1/a.jpg',
    'https://res.cloudinary.com/moreable/image/upload/v1/b.jpg',
];

describe('opening the form on a report‘s existing photos', () => {
    it('makes a draft for every stored photo', () => {
        expect(existingPhotoDrafts(PHOTOS)).toHaveLength(PHOTOS.length);
    });

    it('marks them as already uploaded', () => {
        // Which is what stops the form from uploading them again, and what
        // lets Submit go live without waiting for anything.
        existingPhotoDrafts(PHOTOS).forEach((draft) => {
            expect(draft.status).toBe('uploaded');
        });
    });

    it('keeps the Cloudinary URL as the photo‘s address', () => {
        expect(existingPhotoDrafts(PHOTOS).map((draft) => draft.url)).toEqual(PHOTOS);
    });

    it('renders each thumbnail from that same URL', () => {
        // A stored photo has no local file behind it, so the remote URL is
        // both what is displayed and what is saved.
        existingPhotoDrafts(PHOTOS).forEach((draft) => {
            expect(draft.uri).toBe(draft.url);
        });
    });

    it('carries no image bytes', () => {
        existingPhotoDrafts(PHOTOS).forEach((draft) => {
            expect(draft.base64).toBeNull();
        });
    });

    it('submits the very same URLs back', () => {
        // The round trip that matters: what was stored comes out of the form
        // unchanged when the passenger edits nothing about the photos.
        expect(uploadedPhotoUrls(existingPhotoDrafts(PHOTOS))).toEqual(PHOTOS);
    });

    it('survives a removal without disturbing the rest', () => {
        const remaining = existingPhotoDrafts(PHOTOS).filter(
            (draft) => draft.uri !== PHOTOS[0]
        );

        expect(uploadedPhotoUrls(remaining)).toEqual([PHOTOS[1]]);
    });

    it('starts empty for a report with no photos', () => {
        expect(existingPhotoDrafts(undefined)).toEqual([]);
        expect(existingPhotoDrafts(null)).toEqual([]);
        expect(existingPhotoDrafts([])).toEqual([]);
    });

    it('skips a blank entry rather than showing an empty thumbnail', () => {
        expect(existingPhotoDrafts([PHOTOS[0], '   '])).toHaveLength(1);
    });
});

describe('whether the evidence changed', () => {
    it('sees no change when the photos come back as they were', () => {
        expect(arePhotoUrlsUnchanged(PHOTOS, uploadedPhotoUrls(existingPhotoDrafts(PHOTOS)))).toBe(
            true
        );
    });

    it('sees a removal', () => {
        expect(arePhotoUrlsUnchanged(PHOTOS, [PHOTOS[0]])).toBe(false);
    });

    it('sees an addition', () => {
        expect(
            arePhotoUrlsUnchanged(PHOTOS, [
                ...PHOTOS,
                'https://res.cloudinary.com/moreable/image/upload/v1/c.jpg',
            ])
        ).toBe(false);
    });

    it('sees a reorder', () => {
        expect(arePhotoUrlsUnchanged(PHOTOS, [PHOTOS[1], PHOTOS[0]])).toBe(false);
    });

    it('treats a report that had none and still has none as unchanged', () => {
        expect(arePhotoUrlsUnchanged(undefined, [])).toBe(true);
    });
});
