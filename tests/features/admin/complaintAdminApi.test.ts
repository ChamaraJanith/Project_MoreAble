// The client half of Complaint Management (MOV-176).
//
// Two rules matter most:
//
// 1. THE AUTHORIZATION HEADER. Every complaint route is admin-only, and
//    `adminFetch` sends no Authorization header, so this client carries the
//    session token on every call.
//
// 2. ACTIONS, NOT STATUSES. A workflow call sends exactly the action body the
//    API defines — never a status, and never an actor id.

import {
    assignComplaint,
    createComplaint,
    getComplaint,
    getComplaints,
    reassignComplaint,
    resolveComplaint,
    startComplaint,
} from '../../../src/features/admin/api/complaintAdminApi';

// Hoisted above the imports by ts-jest, so the module graph never pulls in
// react-native / expo-constants, which cannot load under the node environment.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const TOKEN = 'session-admin';

function jsonResponse(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const COMPLAINT = {
    complaintId: 'CMP-00001',
    reportId: 'REP-00025',
    status: 'ASSIGNED',
    issueCategory: 'BROKEN_RAMP',
    description: 'Ramp broken.',
    createdBy: 'UID-ADMIN',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
};

beforeEach(() => {
    mockFetch.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function lastCall() {
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];

    return { url, init, body: init.body ? JSON.parse(init.body) : undefined };
}

describe('reads', () => {
    it('lists complaints with the session token and the API filters', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, complaints: [COMPLAINT, { junk: true }] }));

        const result = await getComplaints(TOKEN, { status: 'ASSIGNED', assignedTo: 'ADM-2026-00001' });

        expect(result).toEqual({ ok: true, value: [COMPLAINT] });

        const { url, init } = lastCall();

        expect(url).toBe('/api/complaints?status=ASSIGNED&assignedTo=ADM-2026-00001');
        expect(init.method).toBe('GET');
        expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('reads one complaint and its source report', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: true, complaint: COMPLAINT, sourceReport: { reportId: 'REP-00025', status: 'VERIFIED' } })
        );

        const result = await getComplaint('CMP-00001', TOKEN);

        expect(result).toEqual({
            ok: true,
            value: { complaint: COMPLAINT, sourceReport: { reportId: 'REP-00025', status: 'VERIFIED' } },
        });
        expect(lastCall().url).toBe('/api/complaints/CMP-00001');
    });

    it('reads a deleted source report as null', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, complaint: COMPLAINT, sourceReport: null }));

        const result = await getComplaint('CMP-00001', TOKEN);

        expect(result.ok && result.value.sourceReport).toBeNull();
    });

    it.each([401, 403, 404, 500])('returns a %s with its status and the API message', async (status) => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false, message: 'Refused.' }, status));

        expect(await getComplaint('CMP-00001', TOKEN)).toEqual({ ok: false, status, message: 'Refused.' });
    });

    it('answers a network failure without a status', async () => {
        mockFetch.mockRejectedValue(new Error('offline'));

        expect(await getComplaints(TOKEN)).toEqual({ ok: false, message: 'Failed to load complaints.' });
    });

    it('treats a success without a complaint as a failure', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true }));

        const result = await getComplaint('CMP-00001', TOKEN);

        expect(result.ok).toBe(false);
    });
});

describe('writes', () => {
    beforeEach(() => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: true, message: 'Complaint marked IN_PROGRESS.', complaint: COMPLAINT })
        );
    });

    it.each([
        ['ASSIGN', () => assignComplaint('CMP-00001', 'ADM-2026-00002', TOKEN), { action: 'ASSIGN', assignedTo: 'ADM-2026-00002' }],
        ['REASSIGN', () => reassignComplaint('CMP-00001', 'ADM-2026-00002', TOKEN), { action: 'REASSIGN', assignedTo: 'ADM-2026-00002' }],
        ['START', () => startComplaint('CMP-00001', TOKEN), { action: 'START' }],
        ['RESOLVE', () => resolveComplaint('CMP-00001', 'Ramp repaired.', TOKEN), { action: 'RESOLVE', resolutionNote: 'Ramp repaired.' }],
    ])('%s sends exactly its action body with the token', async (_action, call, expectedBody) => {
        const result = await call();

        expect(result).toEqual({
            ok: true,
            value: { complaint: COMPLAINT, message: 'Complaint marked IN_PROGRESS.' },
        });

        const { url, init, body } = lastCall();

        expect(url).toBe('/api/complaints/CMP-00001');
        expect(init.method).toBe('PATCH');
        expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(body).toEqual(expectedBody);
        expect(body).not.toHaveProperty('status');
    });

    it('creates a complaint from a report id alone', async () => {
        await createComplaint('REP-00025', TOKEN);

        const { url, init, body } = lastCall();

        expect(url).toBe('/api/complaints');
        expect(init.method).toBe('POST');
        expect(body).toEqual({ reportId: 'REP-00025' });
    });

    it('carries a 409 back with its status', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: false, message: 'Cannot START a complaint that is IN_PROGRESS.' }, 409)
        );

        expect(await startComplaint('CMP-00001', TOKEN)).toEqual({
            ok: false,
            status: 409,
            message: 'Cannot START a complaint that is IN_PROGRESS.',
        });
    });
});
