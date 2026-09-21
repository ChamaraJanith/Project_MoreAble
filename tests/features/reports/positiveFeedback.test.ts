// Positive accessibility feedback (MOV-300): the categories, the form's
// required fields, the payload it builds, and the isolated submit client that
// MOV-301 will connect to the real endpoint.

import {
    isPositiveFeedbackCategory,
    isReportIssueCategory,
    POSITIVE_FEEDBACK_CATEGORIES,
    REPORT_ISSUE_CATEGORIES,
} from '../../../src/entities/report/model/types';
import {
    POSITIVE_FEEDBACK_UNAVAILABLE_MESSAGE,
    submitPositiveFeedback,
} from '../../../src/features/reports/api/positiveFeedbackApi';
import {
    POSITIVE_FEEDBACK_CATEGORY_OPTIONS,
    positiveFeedbackCategoryLabel,
} from '../../../src/features/reports/ui/positiveFeedbackCategories';
import {
    buildPositiveFeedbackPayload,
    firstMissingPositiveFeedbackField,
    PositiveFeedbackFormState,
    positiveFeedbackFieldErrors,
} from '../../../src/features/reports/utils/positiveFeedbackValidation';

/** A form with everything filled in; tests take away what they are about. */
function completeForm(overrides: Partial<PositiveFeedbackFormState> = {}): PositiveFeedbackFormState {
    return {
        category: 'HELPFUL_DRIVER',
        description: 'The driver lowered the ramp and waited until I was seated.',
        routeId: 'R-138-OUT',
        busId: 'BUS-00007',
        ...overrides,
    };
}

// ==================================================================
// Categories
// ==================================================================
describe('positive feedback categories', () => {
    it('offers the five categories from the story, in order', () => {
        expect(POSITIVE_FEEDBACK_CATEGORY_OPTIONS.map((option) => option.label)).toEqual([
            'Helpful Driver',
            'Easy Wheelchair Boarding',
            'Clear Stop Announcement',
            'Good Priority Seating',
            'Accessible Bus Stop',
        ]);
    });

    it('gives every category in the model a label, description and icon', () => {
        expect(POSITIVE_FEEDBACK_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([
            ...POSITIVE_FEEDBACK_CATEGORIES,
        ]);

        for (const option of POSITIVE_FEEDBACK_CATEGORY_OPTIONS) {
            expect(option.label).toBeTruthy();
            expect(option.description).toBeTruthy();
            expect(option.icon).toBeTruthy();
        }
    });

    it('keeps positive and issue categories apart', () => {
        // So a compliment can never pass the issue route's validation, or the
        // reverse.
        for (const category of POSITIVE_FEEDBACK_CATEGORIES) {
            expect(isReportIssueCategory(category)).toBe(false);
        }
        for (const category of REPORT_ISSUE_CATEGORIES) {
            expect(isPositiveFeedbackCategory(category)).toBe(false);
        }
    });

    it('rejects values that are not categories', () => {
        expect(isPositiveFeedbackCategory('')).toBe(false);
        expect(isPositiveFeedbackCategory(null)).toBe(false);
        expect(isPositiveFeedbackCategory('helpful_driver')).toBe(false);
    });

    it('falls back to the raw value for an unknown category', () => {
        expect(positiveFeedbackCategoryLabel('ACCESSIBLE_BUS_STOP')).toBe('Accessible Bus Stop');
        expect(positiveFeedbackCategoryLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    });
});

// ==================================================================
// Validation
// ==================================================================
describe('positive feedback validation', () => {
    it('accepts a complete form', () => {
        expect(positiveFeedbackFieldErrors(completeForm())).toEqual({});
        expect(firstMissingPositiveFeedbackField(completeForm())).toBeNull();
    });

    it('requires a category', () => {
        expect(positiveFeedbackFieldErrors(completeForm({ category: null }))).toEqual({
            category: 'Please choose what went well.',
        });
    });

    it('requires a description, ignoring whitespace', () => {
        expect(positiveFeedbackFieldErrors(completeForm({ description: '   \n ' }))).toEqual({
            description: 'Please tell us a little about your experience.',
        });
    });

    it('reports every missing field at once, category first', () => {
        const state = completeForm({ category: null, description: '' });

        expect(Object.keys(positiveFeedbackFieldErrors(state))).toEqual(['category', 'description']);
        expect(firstMissingPositiveFeedbackField(state)).toBe('Please choose what went well.');
    });

    it('does not require a route or a bus', () => {
        expect(positiveFeedbackFieldErrors(completeForm({ routeId: null, busId: null }))).toEqual({});
    });
});

// ==================================================================
// Payload
// ==================================================================
describe('buildPositiveFeedbackPayload', () => {
    it('builds the POSITIVE payload with the existing id field names', () => {
        expect(
            buildPositiveFeedbackPayload(completeForm({ description: '  Great ramp.  ' }))
        ).toEqual({
            type: 'POSITIVE',
            category: 'HELPFUL_DRIVER',
            description: 'Great ramp.',
            routeId: 'R-138-OUT',
            busId: 'BUS-00007',
        });
    });

    it('omits the route and bus when none were picked', () => {
        const payload = buildPositiveFeedbackPayload(completeForm({ routeId: null, busId: null }));

        expect(payload).not.toBeNull();
        expect(payload).not.toHaveProperty('routeId');
        expect(payload).not.toHaveProperty('busId');
    });

    it('never carries a passengerId', () => {
        expect(buildPositiveFeedbackPayload(completeForm())).not.toHaveProperty('passengerId');
    });

    it('returns null while the form is incomplete', () => {
        expect(buildPositiveFeedbackPayload(completeForm({ category: null }))).toBeNull();
        expect(buildPositiveFeedbackPayload(completeForm({ description: '' }))).toBeNull();
    });
});

// ==================================================================
// Submit client (placeholder until MOV-301)
// ==================================================================
describe('submitPositiveFeedback', () => {
    const payload = buildPositiveFeedbackPayload(completeForm())!;

    let logSpy: jest.SpyInstance;
    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => logSpy.mockRestore());

    it('refuses a request without a session', async () => {
        await expect(submitPositiveFeedback(payload, '', { simulate: true })).resolves.toEqual({
            ok: false,
            status: 401,
            message: 'Authentication required. Please log in again.',
        });
    });

    it('says honestly that it is not available when not simulating', async () => {
        await expect(submitPositiveFeedback(payload, 'token', { simulate: false })).resolves.toEqual({
            ok: false,
            status: 501,
            message: POSITIVE_FEEDBACK_UNAVAILABLE_MESSAGE,
        });
    });

    it('defaults to not simulating outside a development build', async () => {
        const result = await submitPositiveFeedback(payload, 'token');

        expect(result.ok).toBe(false);
    });

    it('succeeds when simulating', async () => {
        await expect(submitPositiveFeedback(payload, 'token', { simulate: true })).resolves.toEqual({
            ok: true,
        });
    });

    it('makes no network request', async () => {
        const fetchSpy = jest.fn();
        const originalFetch = global.fetch;
        global.fetch = fetchSpy as unknown as typeof fetch;

        try {
            await submitPositiveFeedback(payload, 'token', { simulate: false });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            global.fetch = originalFetch;
        }
    });
});
