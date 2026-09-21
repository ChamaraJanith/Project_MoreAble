// Positive accessibility feedback (MOV-300): the categories, the form's
// required fields, the payload it builds, and the isolated submit client that
// MOV-301 will connect to the real endpoint.

import {
    isPositiveFeedbackCategory,
    isReportIssueCategory,
    POSITIVE_FEEDBACK_CATEGORIES,
    REPORT_ISSUE_CATEGORIES,
} from '../../../src/entities/report/model/types';
import { submitPositiveFeedback } from '../../../src/features/reports/api/positiveFeedbackApi';
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

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

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
// Submit client — POST /api/reports with type POSITIVE
// ==================================================================
describe('submitPositiveFeedback', () => {
    const payload = buildPositiveFeedbackPayload(completeForm())!;
    const TOKEN = 'session-token-value';

    const mockFetch = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
        mockFetch.mockReset();
        global.fetch = mockFetch as unknown as typeof fetch;
    });
    afterAll(() => {
        global.fetch = originalFetch;
    });

    function respondWith(status: number, body: unknown) {
        mockFetch.mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        });
    }

    function sentRequest() {
        const [url, init] = mockFetch.mock.calls[0];

        return {
            url: String(url),
            init,
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body ? JSON.parse(init.body) : undefined,
        };
    }

    const CREATED = {
        reportId: 'REP-00012',
        passengerId: 'PSG-00001',
        type: 'POSITIVE',
        category: 'HELPFUL_DRIVER',
        description: payload.description,
        status: 'PENDING',
    };

    it('posts the payload to the existing reports endpoint', async () => {
        respondWith(201, { success: true, report: CREATED });

        await submitPositiveFeedback(payload, TOKEN);

        const request = sentRequest();
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(request.url).toBe('/api/reports');
        expect(request.init.method).toBe('POST');
        expect(request.body).toEqual(payload);
    });

    it('sends the session token and no passengerId', async () => {
        respondWith(201, { success: true, report: CREATED });

        await submitPositiveFeedback(payload, TOKEN);

        const request = sentRequest();
        expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(request.headers['Content-Type']).toBe('application/json');
        expect(request.body).not.toHaveProperty('passengerId');
    });

    it('returns the created report on success', async () => {
        respondWith(201, { success: true, report: CREATED });

        await expect(submitPositiveFeedback(payload, TOKEN)).resolves.toEqual({
            ok: true,
            report: CREATED,
        });
    });

    it('refuses to report success when no report came back', async () => {
        respondWith(201, { success: true });

        const result = await submitPositiveFeedback(payload, TOKEN);

        expect(result.ok).toBe(false);
    });

    it('refuses a request without a session, without calling the API', async () => {
        const result = await submitPositiveFeedback(payload, '');

        expect(result).toEqual({
            ok: false,
            status: 401,
            message: 'Authentication required. Please log in again.',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('passes the API wording through for a 400', async () => {
        respondWith(400, { success: false, message: 'Invalid feedback category.' });

        await expect(submitPositiveFeedback(payload, TOKEN)).resolves.toEqual({
            ok: false,
            status: 400,
            message: 'Invalid feedback category.',
        });
    });

    it('explains a 401 and a 403', async () => {
        respondWith(401, { success: false, message: 'Authentication required.' });
        expect(await submitPositiveFeedback(payload, TOKEN)).toMatchObject({
            ok: false,
            status: 401,
            message: 'Authentication required. Please log in again.',
        });

        respondWith(403, { success: false, message: 'Only passengers can create accessibility reports.' });
        expect(await submitPositiveFeedback(payload, TOKEN)).toMatchObject({
            ok: false,
            status: 403,
            message: 'Only passengers can submit accessibility feedback.',
        });
    });

    it('does not leak a server error message', async () => {
        respondWith(500, { success: false, message: 'Failed', error: 'Firestore unavailable' });

        expect(await submitPositiveFeedback(payload, TOKEN)).toEqual({
            ok: false,
            status: 500,
            message: 'Unable to submit your feedback right now. Please try again.',
        });
    });

    it('reports a network failure as a failure', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockFetch.mockRejectedValue(new TypeError('Network request failed'));

        const result = await submitPositiveFeedback(payload, TOKEN);

        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ message: expect.stringMatching(/unable to connect/i) });
        errorSpy.mockRestore();
    });
});
