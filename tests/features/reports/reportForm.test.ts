// The report form's rules: which fields are required, and the order the two
// selectors have to be used in.
//
// These are pure functions rather than a rendered screen because the project's
// Jest setup is node-only with no React renderer, and because the gating is
// genuinely logic: what Submit does is decided entirely by what is selected.

import {
    REPORT_CATEGORY_OPTIONS,
    reportCategoryIcon,
    reportCategoryLabel,
} from '../../../src/features/reports/ui/reportCategories';
import {
    canSubmitReport,
    firstMissingReportField,
    isBusSelectionUnlocked,
    photoUploadIssue,
    ReportFormState,
    uploadedPhotoUrls,
} from '../../../src/features/reports/utils/reportFormValidation';
import {
    isReportIssueCategory,
    REPORT_ISSUE_CATEGORIES,
    ReportPhotoDraft,
} from '../../../src/entities/report/model/types';

/** A form with everything filled in; tests take away what they are about. */
function completeForm(overrides: Partial<ReportFormState> = {}): ReportFormState {
    return {
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        routeId: 'R-138-OUT',
        busId: 'BUS-00007',
        ...overrides,
    };
}

// ==================================================================
// Issue categories
// ==================================================================
describe('report issue categories', () => {
    it('offers Other as a selectable category', () => {
        const other = REPORT_CATEGORY_OPTIONS.find((option) => option.value === 'OTHER');

        expect(other).toBeDefined();
        expect(other?.label).toBe('Other');
    });

    it('accepts OTHER as a valid category value', () => {
        expect(isReportIssueCategory('OTHER')).toBe(true);
    });

    it('lists Other last, after the specific problems', () => {
        expect(REPORT_CATEGORY_OPTIONS[REPORT_CATEGORY_OPTIONS.length - 1].value).toBe('OTHER');
    });

    it('gives every category in the model a label and an icon', () => {
        // The picker is built from the model's list, so a category without
        // presentation would reach the screen unnamed.
        expect(REPORT_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([
            ...REPORT_ISSUE_CATEGORIES,
        ]);

        REPORT_CATEGORY_OPTIONS.forEach((option) => {
            expect(option.label.trim().length).toBeGreaterThan(0);
            expect(option.shortLabel.trim().length).toBeGreaterThan(0);
            expect(option.icon.trim().length).toBeGreaterThan(0);
        });
    });

    it('renders a stored OTHER report without falling back to the raw value', () => {
        expect(reportCategoryLabel('OTHER')).toBe('Other');
        expect(reportCategoryIcon('OTHER')).not.toBe('alert-circle-outline');
    });

    it('still falls back for a category the app does not know', () => {
        expect(reportCategoryLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
        expect(reportCategoryIcon('SOMETHING_NEW')).toBe('alert-circle-outline');
    });

    it('rejects a value that is not a category', () => {
        expect(isReportIssueCategory('NOT_A_CATEGORY')).toBe(false);
        expect(isReportIssueCategory('')).toBe(false);
        expect(isReportIssueCategory(undefined)).toBe(false);
    });
});

// ==================================================================
// Route before bus
// ==================================================================
describe('bus selection ordering', () => {
    it('keeps the bus picker locked until a route is chosen', () => {
        expect(isBusSelectionUnlocked(null)).toBe(false);
    });

    it('unlocks the bus picker once a route is chosen', () => {
        expect(isBusSelectionUnlocked('R-138-OUT')).toBe(true);
    });

    it('treats an empty route id as no route', () => {
        expect(isBusSelectionUnlocked('')).toBe(false);
    });
});

// ==================================================================
// Required fields
// ==================================================================
describe('report form submission gating', () => {
    it('allows submission once every required field is filled', () => {
        expect(canSubmitReport(completeForm(), false)).toBe(true);
        expect(firstMissingReportField(completeForm())).toBeNull();
    });

    it('blocks submission without an issue category', () => {
        const form = completeForm({ issueCategory: null });

        expect(canSubmitReport(form, false)).toBe(false);
        expect(firstMissingReportField(form)).toMatch(/issue category/i);
    });

    it('blocks submission without a description', () => {
        const form = completeForm({ description: '' });

        expect(canSubmitReport(form, false)).toBe(false);
        expect(firstMissingReportField(form)).toMatch(/description/i);
    });

    it('blocks submission when the description is only whitespace', () => {
        expect(canSubmitReport(completeForm({ description: '   ' }), false)).toBe(false);
    });

    it('blocks submission without a route — the route is required', () => {
        const form = completeForm({ routeId: null });

        expect(canSubmitReport(form, false)).toBe(false);
        expect(firstMissingReportField(form)).toMatch(/route/i);
    });

    it('blocks submission without a bus — the bus is required', () => {
        const form = completeForm({ busId: null });

        expect(canSubmitReport(form, false)).toBe(false);
        expect(firstMissingReportField(form)).toMatch(/bus/i);
    });

    it('asks for the route before the bus', () => {
        // Neither is selected: the message names the one the form wants first.
        const form = completeForm({ routeId: null, busId: null });

        expect(firstMissingReportField(form)).toMatch(/route/i);
    });

    it('blocks a second submission while one is in flight', () => {
        // The guard against a double-tap turning one report into two.
        expect(canSubmitReport(completeForm(), true)).toBe(false);
    });
});

// ==================================================================
// Photo evidence
//
// Photos are uploaded to Cloudinary as they are picked, so what the form has
// to decide is whether every one of them arrived. A report filed while an
// upload is in flight, or after one failed, would claim less evidence than the
// passenger attached — and there is no way to add it afterwards.
// ==================================================================
function photoDraft(overrides: Partial<ReportPhotoDraft> = {}): ReportPhotoDraft {
    return {
        uri: 'file:///data/user/0/cache/ramp.jpg',
        status: 'uploaded',
        url: 'https://res.cloudinary.com/moreable/image/upload/v1/reports/ramp.jpg',
        ...overrides,
    };
}

describe('report photo evidence gating', () => {
    it('allows submission with no photos at all', () => {
        expect(photoUploadIssue([])).toBeNull();
        expect(canSubmitReport(completeForm(), false, [])).toBe(true);
    });

    it('allows submission once every photo has uploaded', () => {
        const photos = [photoDraft(), photoDraft({ uri: 'file:///lift.jpg' })];

        expect(photoUploadIssue(photos)).toBeNull();
        expect(canSubmitReport(completeForm(), false, photos)).toBe(true);
    });

    it('blocks submission while a photo is still uploading', () => {
        const photos = [photoDraft(), photoDraft({ uri: 'file:///lift.jpg', status: 'uploading' })];

        expect(photoUploadIssue(photos)).toMatch(/finish uploading/i);
        expect(canSubmitReport(completeForm(), false, photos)).toBe(false);
    });

    it('blocks submission when a photo failed to upload', () => {
        const photos = [
            photoDraft(),
            photoDraft({ uri: 'file:///lift.jpg', status: 'failed', url: undefined }),
        ];

        expect(photoUploadIssue(photos)).toMatch(/retry/i);
        expect(canSubmitReport(completeForm(), false, photos)).toBe(false);
    });

    it('names the in-flight upload before the failed one', () => {
        // Waiting is the shorter answer: the retry only makes sense once
        // nothing else is still running.
        const photos = [
            photoDraft({ status: 'failed', url: undefined }),
            photoDraft({ uri: 'file:///lift.jpg', status: 'uploading' }),
        ];

        expect(photoUploadIssue(photos)).toMatch(/finish uploading/i);
    });

    it('submits the Cloudinary URLs, never the device uris', () => {
        const photos = [photoDraft(), photoDraft({ uri: 'file:///lift.jpg' })];

        const urls = uploadedPhotoUrls(photos);

        expect(urls).toHaveLength(2);
        urls.forEach((url) => {
            expect(url.startsWith('https://res.cloudinary.com/')).toBe(true);
            expect(url).not.toMatch(/file:\/\/|content:\/\//);
        });
    });

    it('sends nothing for a report with no photos', () => {
        expect(uploadedPhotoUrls([])).toEqual([]);
    });

    it('leaves out a photo that has no URL', () => {
        // Belt and braces: the gating above already stops this reaching submit.
        expect(
            uploadedPhotoUrls([
                photoDraft({ status: 'uploading', url: undefined }),
                photoDraft({ uri: 'file:///b.jpg', status: 'uploaded', url: undefined }),
            ])
        ).toEqual([]);
    });
});
