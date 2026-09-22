// The client half of the accessibility analytics (MOV-168).
//
// The Accessibility Analytics screen reads everything it draws through this
// module, so these tests cover the screen's whole data path. Component
// rendering is not covered because the project's Jest setup is
// `testEnvironment: node` with no React Native renderer — the same reason
// busAdminApi.test.ts gives, and the reason what the screen SAYS is tested in
// accessibilityAnalyticsPresentation.test.ts instead.
//
// Two rules matter most here.
//
// 1. THE AUTHORIZATION HEADER. The endpoint is admin-only, and `adminFetch` —
//    which every other admin client in this project uses — sends no
//    Authorization header at all. A call made through it would be refused 401
//    every time, so this module carries the session token explicitly, and the
//    assertion that it does is the point of the first block below.
//
// 2. NULL IS NOT ZERO. The backend distinguishes "no bus in service has a
//    usable score" from a real, measured zero. A `?? 0` anywhere on the way in
//    would turn an empty platform into one scoring zero, which is the opposite
//    finding — so the parsing is tested for it directly.

import {
    ANALYTICS_FALLBACK_MESSAGE,
    accessibilityAnalyticsPath,
    analyticsErrorMessage,
    fetchAccessibilityAnalytics,
} from '../../../src/features/admin/api/accessibilityAnalyticsApi';

// Hoisted above the imports by ts-jest, so the module graph never pulls in
// react-native / expo-constants, which cannot load under the node environment.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ADMIN_TOKEN = 'session-admin';

function jsonResponse(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** The analytics exactly as GET /api/analytics/accessibility answers them. */
function analyticsPayload(overrides: Record<string, unknown> = {}) {
    return {
        success: true,
        message: 'Accessibility analytics generated successfully.',
        averageScore: { value: 82, busesIncluded: 5 },
        mostAccessibleRoutes: [
            {
                routeId: 'R-138-OUT',
                routeNumber: '138',
                routeName: 'Colombo - Fort',
                averageScore: 91,
                busCount: 4,
            },
            {
                routeId: 'R-120-OUT',
                routeNumber: '120',
                routeName: 'Colombo - Kandy',
                averageScore: 87,
                busCount: 2,
            },
        ],
        mostReportedVehicles: [
            {
                busId: 'BUS-00001',
                numberPlate: 'NB-1234',
                busModel: 'Viking',
                manufacturer: 'Ashok Leyland',
                reportCount: 12,
                verifiedReportCount: 8,
            },
        ],
        trend: [
            { date: '2026-09-17', averageScore: null },
            { date: '2026-09-24', averageScore: 82 },
        ],
        generatedAt: '2026-09-24T10:30:00.000Z',
        trendWeeks: 12,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// 1. The request
// ==================================================================
describe('the request', () => {
    it('sends the admin session as a Bearer token', async () => {
        mockFetch.mockResolvedValue(jsonResponse(analyticsPayload()));

        await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [, init] = mockFetch.mock.calls[0];

        // The header `adminFetch` does not send, and without which this
        // endpoint answers 401.
        expect(init.headers.Authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
        expect(init.method).toBe('GET');
    });

    it('asks the endpoint MOV-169 built, with no window of its own', async () => {
        mockFetch.mockResolvedValue(jsonResponse(analyticsPayload()));

        await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        const [url] = mockFetch.mock.calls[0];

        // No `weeks`: the twelve MOV-133 asks for are the endpoint's default,
        // and the client does not name a window it does not own.
        expect(url).toBe('/api/analytics/accessibility');
    });

    it('names a window only when one is asked for', () => {
        expect(accessibilityAnalyticsPath()).toBe('/api/analytics/accessibility');
        expect(accessibilityAnalyticsPath(4)).toBe('/api/analytics/accessibility?weeks=4');
    });

    it('never sends who is asking — the route reads that off the token', async () => {
        mockFetch.mockResolvedValue(jsonResponse(analyticsPayload()));

        await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        const [url, init] = mockFetch.mock.calls[0];

        expect(url).not.toContain('adminId');
        expect(init.body).toBeUndefined();
    });
});

// ==================================================================
// 2. Reading the response
// ==================================================================
describe('reading the response', () => {
    it('parses every figure the endpoint sent', async () => {
        mockFetch.mockResolvedValue(jsonResponse(analyticsPayload()));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.averageScore).toEqual({ value: 82, busesIncluded: 5 });
        expect(result.value.mostAccessibleRoutes).toHaveLength(2);
        expect(result.value.mostAccessibleRoutes[0]).toEqual(
            expect.objectContaining({ routeNumber: '138', averageScore: 91, busCount: 4 })
        );
        expect(result.value.mostReportedVehicles[0]).toEqual(
            expect.objectContaining({
                numberPlate: 'NB-1234',
                reportCount: 12,
                verifiedReportCount: 8,
            })
        );
        expect(result.value.trend).toHaveLength(2);
        expect(result.value.generatedAt).toBe('2026-09-24T10:30:00.000Z');
        expect(result.value.trendWeeks).toBe(12);
    });

    it('keeps a null average as null rather than turning it into 0', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse(analyticsPayload({ averageScore: { value: null, busesIncluded: 0 } }))
        );

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // An empty platform and a platform scoring zero are opposite findings.
        expect(result.value.averageScore.value).toBeNull();
        expect(result.value.averageScore.value).not.toBe(0);
    });

    it('keeps a real average of 0, which is a finding rather than a gap', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse(analyticsPayload({ averageScore: { value: 0, busesIncluded: 3 } }))
        );

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.averageScore.value).toBe(0);
    });

    it('keeps a null week in the trend as null', async () => {
        mockFetch.mockResolvedValue(jsonResponse(analyticsPayload()));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.trend[0].averageScore).toBeNull();
        expect(result.value.trend[1].averageScore).toBe(82);
    });

    it('reads empty rankings as empty lists rather than gaps', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse(
                analyticsPayload({
                    mostAccessibleRoutes: [],
                    mostReportedVehicles: [],
                    trend: [],
                })
            )
        );

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.mostAccessibleRoutes).toEqual([]);
        expect(result.value.mostReportedVehicles).toEqual([]);
        expect(result.value.trend).toEqual([]);
    });

    it('survives a payload missing its optional fields', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true }));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.averageScore).toEqual({ value: null, busesIncluded: 0 });
        expect(result.value.mostAccessibleRoutes).toEqual([]);
        expect(result.value.mostReportedVehicles).toEqual([]);
        expect(result.value.trend).toEqual([]);
        expect(result.value.generatedAt).toBe('');
    });
});

// ==================================================================
// 3. Failures
// ==================================================================
describe('failures', () => {
    it('reports a refused session with its status and its own wording', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false }, 401));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result).toEqual({
            ok: false,
            status: 401,
            message: 'Your session has expired. Please sign in again.',
        });
    });

    it('tells a passenger session apart from an expired one', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false }, 403));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result).toEqual({
            ok: false,
            status: 403,
            message: 'Only an administrator can view accessibility analytics.',
        });
    });

    it('falls back to one friendly wording for anything else', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false }, 500));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result).toEqual({
            ok: false,
            status: 500,
            message: ANALYTICS_FALLBACK_MESSAGE,
        });
    });

    it('treats a 200 that is not a success as a failure', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false, message: 'nope' }));

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result.ok).toBe(false);
    });

    it('reports a network failure without throwing', async () => {
        mockFetch.mockRejectedValue(new Error('offline'));
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        const result = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(result).toEqual({ ok: false, message: ANALYTICS_FALLBACK_MESSAGE });

        consoleError.mockRestore();
    });

    it('words every known refusal', () => {
        expect(analyticsErrorMessage(401)).toContain('session');
        expect(analyticsErrorMessage(403)).toContain('administrator');
        expect(analyticsErrorMessage(500)).toBe(ANALYTICS_FALLBACK_MESSAGE);
        expect(analyticsErrorMessage(undefined)).toBe(ANALYTICS_FALLBACK_MESSAGE);
    });
});

// ==================================================================
// 4. Retry
// ==================================================================
describe('retry', () => {
    it('makes a second request, and can succeed where the first failed', async () => {
        mockFetch
            .mockResolvedValueOnce(jsonResponse({ success: false }, 500))
            .mockResolvedValueOnce(jsonResponse(analyticsPayload()));

        const failed = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(failed.ok).toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // What the screen's Retry control does: the same call again.
        const retried = await fetchAccessibilityAnalytics(ADMIN_TOKEN);

        expect(retried.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        // And it carries the session the second time too.
        expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    });
});
