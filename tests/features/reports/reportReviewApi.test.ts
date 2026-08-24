// The client half of admin review: what goes on the wire, and what comes back
// off it.
//
// Three things this has to get right.
//
// Every request carries the session token, because all three routes refuse an
// anonymous one and a passenger one — and it carries nothing identifying the
// admin beyond that, since the routes take the reviewer from the verified token
// and an adminId in a body would be a claim, not a fact.
//
// The body names an ACTION and never a status. What VERIFY means to the stored
// report is the route's to decide; a client that sent a status would be naming
// the state it wanted, which is exactly what the backend refuses to accept.
//
// And a failure has to keep its status. 401, 403, 404 and 409 mean four
// different things to the screen, and flattening them into one string would
// leave it unable to tell an expired session from a report another admin
// decided first.

import { submitReportReview } from '../../../src/features/reports/api/reportReviewApi';
import {
    fetchReportForReview,
    fetchReportsForReview,
} from '../../../src/features/reports/api/reportReviewApi';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const REPORT_ID = 'REP-00007';
const TOKEN = 'admin-session-token';

function respondWith(status: number, body: unknown) {
    mockFetch.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    });
}

/** The request the client actually sent. */
function sentRequest() {
    const [url, init] = mockFetch.mock.calls[0];

    return {
        url: String(url),
        init,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(init.body) : undefined,
    };
}

function apiReport(overrides: Record<string, any> = {}) {
    return {
        documentId: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: 'PAS-2026-00002',
        issueCategory: 'BROKEN_RAMP',
        description: 'The boarding ramp would not fold out.',
        status: 'PENDING',
        createdAt: '2026-08-20T09:30:00.000Z',
        updatedAt: '2026-08-20T09:30:00.000Z',
        agreeCount: 6,
        disagreeCount: 1,
        commentCount: 2,
        requiresAdminReview: true,
        flagged: true,
        review: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ==================================================================
// The queue
// ==================================================================
describe('fetchReportsForReview', () => {
    it('GETs the review scope, with the token', async () => {
        respondWith(200, { success: true, reports: [], flaggedCount: 0 });

        await fetchReportsForReview(TOKEN);

        const { url, init, headers } = sentRequest();

        expect(url).toBe('/api/reports?scope=review');
        expect(init.method).toBe('GET');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('asks the API for the flagged slice rather than filtering afterwards', async () => {
        respondWith(200, { success: true, reports: [], flaggedCount: 0 });

        await fetchReportsForReview(TOKEN, 'FLAGGED');

        expect(sentRequest().url).toBe('/api/reports?scope=review&flagged=true');
    });

    it('maps every report the API returned', async () => {
        respondWith(200, {
            success: true,
            reports: [apiReport(), apiReport({ documentId: 'REP-2', reportId: 'REP-2' })],
            flaggedCount: 2,
        });

        const result = await fetchReportsForReview(TOKEN);

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(result.value.reports).toHaveLength(2);
        expect(result.value.reports[0].reportId).toBe(REPORT_ID);
        expect(result.value.reports[0].agreeCount).toBe(6);
        expect(result.value.reports[0].commentCount).toBe(2);
        expect(result.value.reports[0].flagged).toBe(true);
        expect(result.value.flaggedCount).toBe(2);
    });

    it('reports a refused request rather than an empty queue', async () => {
        // An empty list and "you may not read this" are different facts, and
        // only one of them means there is nothing to review.
        respondWith(403, {
            success: false,
            message: 'Only an administrator can review accessibility reports.',
        });

        const result = await fetchReportsForReview(TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.status).toBe(403);
        expect(result.message).toBe(
            'Only an administrator can review accessibility reports.'
        );
    });

    it('reports a network failure rather than throwing at the screen', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await fetchReportsForReview(TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.message).toBe('Failed to load reports for review.');
    });
});

// ==================================================================
// One report
// ==================================================================
describe('fetchReportForReview', () => {
    it('GETs the review route for that report, with the token', async () => {
        respondWith(200, { success: true, report: apiReport(), comments: [] });

        await fetchReportForReview(REPORT_ID, TOKEN);

        const { url, init, headers } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/review`);
        expect(init.method).toBe('GET');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('hands back the report, the thread and any review already recorded', async () => {
        respondWith(200, {
            success: true,
            report: apiReport({
                status: 'VERIFIED',
                review: {
                    status: 'VERIFIED',
                    reviewedBy: 'ADM-0001',
                    reviewedAt: '2026-08-23T11:00:00.000Z',
                    adminRemark: 'Confirmed with the depot.',
                },
            }),
            comments: [
                {
                    commentId: 'CMT-1',
                    reportId: REPORT_ID,
                    passengerId: 'PAS-2026-00003',
                    authorName: 'Kasun Silva',
                    text: 'Same thing happened to me.',
                    createdAt: '2026-08-21T08:00:00.000Z',
                },
            ],
            review: {
                status: 'VERIFIED',
                reviewedBy: 'ADM-0001',
                reviewedAt: '2026-08-23T11:00:00.000Z',
                adminRemark: 'Confirmed with the depot.',
            },
        });

        const result = await fetchReportForReview(REPORT_ID, TOKEN);

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(result.value.report.status).toBe('VERIFIED');
        expect(result.value.comments).toHaveLength(1);
        expect(result.value.comments[0].authorName).toBe('Kasun Silva');
        expect(result.value.review?.adminRemark).toBe('Confirmed with the depot.');
    });

    it('keeps the 404 so the screen can say the report is gone', async () => {
        respondWith(404, { success: false, message: 'Report not found.' });

        const result = await fetchReportForReview(REPORT_ID, TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.status).toBe(404);
    });

    it('percent-encodes a report id that needs it', async () => {
        respondWith(200, { success: true, report: apiReport(), comments: [] });

        await fetchReportForReview('REP 1/2', TOKEN);

        expect(sentRequest().url).toBe('/api/reports/REP%201%2F2/review');
    });
});

// ==================================================================
// Recording a decision
// ==================================================================
describe('submitReportReview', () => {
    it('POSTs VERIFY to verify a report', async () => {
        respondWith(200, {
            success: true,
            message: 'Report marked VERIFIED.',
            report: apiReport({ status: 'VERIFIED' }),
        });

        await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        const { url, init, headers, body } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/review`);
        expect(init.method).toBe('POST');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(headers['Content-Type']).toBe('application/json');
        expect(body).toEqual({ action: 'VERIFY' });
    });

    it('POSTs REJECT to reject a report', async () => {
        respondWith(200, {
            success: true,
            message: 'Report marked REJECTED.',
            report: apiReport({ status: 'REJECTED' }),
        });

        await submitReportReview(REPORT_ID, 'REJECT', TOKEN);

        expect(sentRequest().body).toEqual({ action: 'REJECT' });
    });

    it('POSTs REMARK with the text when saving a remark', async () => {
        respondWith(200, {
            success: true,
            message: 'Review remark saved.',
            report: apiReport({ adminRemark: 'Confirmed with the depot.' }),
        });

        await submitReportReview(
            REPORT_ID,
            'REMARK',
            TOKEN,
            'Confirmed with the depot.'
        );

        expect(sentRequest().body).toEqual({
            action: 'REMARK',
            adminRemark: 'Confirmed with the depot.',
        });
    });

    it('never names a status, only an action', async () => {
        // What VERIFY does to the stored report is the route's to decide. A
        // status in the body would be the client naming the state it wanted.
        respondWith(200, {
            success: true,
            message: 'Report marked VERIFIED.',
            report: apiReport({ status: 'VERIFIED' }),
        });

        await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(sentRequest().body).not.toHaveProperty('status');
    });

    it('sends no remark alongside a decision', async () => {
        // A decision does not have to be explained to be recorded, and an empty
        // remark is one the route would refuse.
        respondWith(200, {
            success: true,
            message: 'Report marked VERIFIED.',
            report: apiReport({ status: 'VERIFIED' }),
        });

        await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(sentRequest().body).not.toHaveProperty('adminRemark');
    });

    it('identifies the admin by nothing but the token', async () => {
        respondWith(200, {
            success: true,
            message: 'Report marked VERIFIED.',
            report: apiReport({ status: 'VERIFIED' }),
        });

        await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        const { body } = sentRequest();

        expect(body).not.toHaveProperty('adminId');
        expect(body).not.toHaveProperty('reviewedBy');
        expect(body).not.toHaveProperty('passengerId');
    });

    it('hands back the report the API stored, not the one that was sent', async () => {
        respondWith(200, {
            success: true,
            message: 'Report marked VERIFIED.',
            report: apiReport({
                status: 'VERIFIED',
                review: {
                    status: 'VERIFIED',
                    reviewedBy: 'ADM-0001',
                    reviewedAt: '2026-08-24T10:00:00.000Z',
                    adminRemark: null,
                },
            }),
            review: {
                status: 'VERIFIED',
                reviewedBy: 'ADM-0001',
                reviewedAt: '2026-08-24T10:00:00.000Z',
                adminRemark: null,
            },
        });

        const result = await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(result.value.report.status).toBe('VERIFIED');
        expect(result.value.review?.reviewedBy).toBe('ADM-0001');
        expect(result.value.message).toBe('Report marked VERIFIED.');
    });

    it('keeps the 409 when another admin decided the report first', async () => {
        respondWith(409, {
            success: false,
            message: 'This report has already been reviewed (VERIFIED).',
        });

        const result = await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.status).toBe(409);
        expect(result.message).toBe('This report has already been reviewed (VERIFIED).');
    });

    it('keeps the 401 when the session has expired', async () => {
        respondWith(401, { success: false, message: 'Authentication required.' });

        const result = await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.status).toBe(401);
    });

    it('keeps the 403 when the session is not an administrator', async () => {
        respondWith(403, {
            success: false,
            message: 'Only an administrator can review accessibility reports.',
        });

        const result = await submitReportReview(REPORT_ID, 'REJECT', TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.status).toBe(403);
    });

    it('reports a network failure rather than throwing at the screen', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(result.ok).toBe(false);

        if (result.ok) return;

        expect(result.message).toBe('Failed to record the review.');
    });

    it('treats a 200 with no report as a failure', async () => {
        // Nothing to draw afterwards is not a success, however the status line
        // reads: the page redraws from the returned report.
        respondWith(200, { success: true, message: 'Report marked VERIFIED.' });

        const result = await submitReportReview(REPORT_ID, 'VERIFY', TOKEN);

        expect(result.ok).toBe(false);
    });
});
