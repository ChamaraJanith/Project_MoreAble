// The client half of community feedback: what goes on the wire, and what comes
// back off it.
//
// Two things this has to get right. Every request carries the session token,
// because all four routes refuse an anonymous one — and it carries nothing
// identifying the passenger beyond that, since the routes take who is voting
// from the verified token and a passengerId in a body would be a claim, not a
// fact.
//
// And a failure has to stay a failure. Each call reports what went wrong rather
// than an empty result that the screen would draw as "nobody has voted" or "no
// comments yet".

import { ReportCommentRecord } from '../../../src/entities/report/model/types';
import {
    fetchReportComments,
    fetchReportVotes,
    submitReportComment,
    submitReportVote,
} from '../../../src/features/reports/api/reportFeedbackApi';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const REPORT_ID = 'REP-00007';
const TOKEN = 'session-token-value';

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

function storedComment(overrides: Partial<ReportCommentRecord> = {}): ReportCommentRecord {
    return {
        commentId: 'CMT-00001',
        reportId: REPORT_ID,
        passengerId: 'PAS-2026-00002',
        authorName: 'Kasun Silva',
        text: 'The ramp was not working properly.',
        createdAt: '2026-08-22T09:30:00.000Z',
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
// Reading the votes
// ==================================================================
describe('fetchReportVotes', () => {
    it('GETs the vote route for that report, with the token', async () => {
        respondWith(200, { success: true, myVote: null, agreeCount: 0, disagreeCount: 0 });

        await fetchReportVotes(REPORT_ID, TOKEN);

        const { url, init, headers } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/vote`);
        expect(init.method).toBe('GET');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('hands back the passenger own vote and both tallies', async () => {
        respondWith(200, {
            success: true,
            myVote: 'AGREE',
            agreeCount: 5,
            disagreeCount: 2,
        });

        const result = await fetchReportVotes(REPORT_ID, TOKEN);

        expect(result).toEqual({
            ok: true,
            value: { myVote: 'AGREE', agreeCount: 5, disagreeCount: 2 },
        });
    });

    it('reads a passenger who has not voted as no vote', async () => {
        respondWith(200, { success: true, myVote: null, agreeCount: 3, disagreeCount: 0 });

        const result = await fetchReportVotes(REPORT_ID, TOKEN);

        expect(result.ok && result.value.myVote).toBeNull();
    });

    it('reports a refusal rather than an empty tally', async () => {
        respondWith(401, { success: false, message: 'Authentication required.' });

        const result = await fetchReportVotes(REPORT_ID, TOKEN);

        expect(result).toEqual({ ok: false, message: 'Authentication required.' });
    });

    it('reports a report that is gone', async () => {
        respondWith(404, { success: false, message: 'Report not found.' });

        const result = await fetchReportVotes(REPORT_ID, TOKEN);

        expect(result.ok).toBe(false);
    });

    it('reports a request that never arrived', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await fetchReportVotes(REPORT_ID, TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to load votes.' });
    });
});

// ==================================================================
// Casting a vote
// ==================================================================
describe('submitReportVote', () => {
    it('POSTs the vote and nothing else', async () => {
        respondWith(200, {
            success: true,
            vote: 'AGREE',
            agreeCount: 1,
            disagreeCount: 0,
            requiresAdminReview: false,
        });

        await submitReportVote(REPORT_ID, 'AGREE', TOKEN);

        const { url, init, headers, body } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/vote`);
        expect(init.method).toBe('POST');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(headers['Content-Type']).toBe('application/json');

        // The body is the vote alone: who is voting is the token's to say.
        expect(body).toEqual({ vote: 'AGREE' });
        expect(JSON.stringify(body)).not.toMatch(/PAS-|passengerId/);
    });

    it('sends DISAGREE when that is what was pressed', async () => {
        respondWith(200, {
            success: true,
            vote: 'DISAGREE',
            agreeCount: 0,
            disagreeCount: 1,
        });

        await submitReportVote(REPORT_ID, 'DISAGREE', TOKEN);

        expect(sentRequest().body).toEqual({ vote: 'DISAGREE' });
    });

    it('hands back the tallies the server returned', async () => {
        respondWith(200, {
            success: true,
            vote: 'AGREE',
            agreeCount: 5,
            disagreeCount: 2,
            requiresAdminReview: true,
        });

        const result = await submitReportVote(REPORT_ID, 'AGREE', TOKEN);

        expect(result).toEqual({
            ok: true,
            value: {
                myVote: 'AGREE',
                agreeCount: 5,
                disagreeCount: 2,
                requiresAdminReview: true,
            },
        });
    });

    it('reports the admin review flag as false when the server did not raise it', async () => {
        respondWith(200, {
            success: true,
            vote: 'AGREE',
            agreeCount: 2,
            disagreeCount: 0,
            requiresAdminReview: false,
        });

        const result = await submitReportVote(REPORT_ID, 'AGREE', TOKEN);

        expect(result.ok && result.value.requiresAdminReview).toBe(false);
    });

    it('reports a rejected vote', async () => {
        respondWith(400, {
            success: false,
            message: 'Vote must be either AGREE or DISAGREE.',
        });

        const result = await submitReportVote(REPORT_ID, 'AGREE', TOKEN);

        expect(result).toEqual({
            ok: false,
            message: 'Vote must be either AGREE or DISAGREE.',
        });
    });

    it('reports a vote that never left the device', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await submitReportVote(REPORT_ID, 'AGREE', TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to record your vote.' });
    });
});

// ==================================================================
// Reading the thread
// ==================================================================
describe('fetchReportComments', () => {
    it('GETs the comments route for that report, with the token', async () => {
        respondWith(200, { success: true, count: 0, comments: [] });

        await fetchReportComments(REPORT_ID, TOKEN);

        const { url, init, headers } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/comments`);
        expect(init.method).toBe('GET');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('hands back the stored comments in the order they came', async () => {
        const newest = storedComment({ commentId: 'CMT-00002', text: 'Newest.' });
        const oldest = storedComment({ commentId: 'CMT-00001', text: 'Oldest.' });

        respondWith(200, { success: true, count: 2, comments: [newest, oldest] });

        const result = await fetchReportComments(REPORT_ID, TOKEN);

        expect(result).toEqual({ ok: true, value: [newest, oldest] });
    });

    it('reads an empty thread as an empty thread', async () => {
        respondWith(200, { success: true, count: 0, comments: [] });

        const result = await fetchReportComments(REPORT_ID, TOKEN);

        expect(result).toEqual({ ok: true, value: [] });
    });

    it('reports a failure rather than an empty thread', async () => {
        respondWith(500, { success: false, message: 'Failed to retrieve comments.' });

        const result = await fetchReportComments(REPORT_ID, TOKEN);

        expect(result.ok).toBe(false);
    });

    it('reports a request that never arrived', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await fetchReportComments(REPORT_ID, TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to load comments.' });
    });
});

// ==================================================================
// Writing a comment
// ==================================================================
describe('submitReportComment', () => {
    it('POSTs the comment under the key the route reads', async () => {
        respondWith(201, { success: true, comment: storedComment() });

        await submitReportComment(REPORT_ID, 'The ramp was not working properly.', TOKEN);

        const { url, init, headers, body } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/comments`);
        expect(init.method).toBe('POST');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(body).toEqual({ comment: 'The ramp was not working properly.' });

        // No author and no passenger travel with it: the route resolves both
        // from the token.
        expect(JSON.stringify(body)).not.toMatch(/authorName|passengerId/);
    });

    it('hands back the record the server stored', async () => {
        const stored = storedComment({ commentId: 'CMT-00009' });

        respondWith(201, { success: true, comment: stored });

        const result = await submitReportComment(REPORT_ID, 'Same here.', TOKEN);

        expect(result).toEqual({ ok: true, value: stored });
    });

    it('reports a comment the API refused', async () => {
        respondWith(400, {
            success: false,
            message: 'A comment can be at most 300 characters.',
        });

        const result = await submitReportComment(REPORT_ID, 'a'.repeat(301), TOKEN);

        expect(result).toEqual({
            ok: false,
            message: 'A comment can be at most 300 characters.',
        });
    });

    it('reports a success that carried no comment as a failure', async () => {
        respondWith(201, { success: true });

        const result = await submitReportComment(REPORT_ID, 'Anything.', TOKEN);

        expect(result.ok).toBe(false);
    });

    it('reports a comment that never left the device', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await submitReportComment(REPORT_ID, 'Same here.', TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to add your comment.' });
    });
});

// ==================================================================
// Report ids that need encoding
// ==================================================================
describe('the report id in the path', () => {
    it('is encoded rather than pasted in', async () => {
        respondWith(200, { success: true, myVote: null, agreeCount: 0, disagreeCount: 0 });

        await fetchReportVotes('REP 00007', TOKEN);

        expect(sentRequest().url).toBe('/api/reports/REP%2000007/vote');
    });
});
