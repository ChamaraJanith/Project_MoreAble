// POST and GET /api/reports/[reportId]/vote — the community answering a report.
//
// The rule these tests exist for is that one passenger is one voice. MOV-144's
// pill already refuses to fire twice, but that is the app being polite; what
// actually holds the line is this route keying the vote document by report and
// passenger, so a second Agree rewrites the first instead of adding to the
// tally, and a Disagree after an Agree moves the vote rather than holding both.
//
// The other rule worth pinning down is what five agreements do: they flag the
// report for an admin to look at, and they do NOT verify it. A report that can
// verify itself is a report that never needed an admin.

import {
    GET as getVotes,
    POST as castVote,
} from '../../../app/api/reports/[reportId]/vote+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the signature check is stubbed, so the Authorization header parsing in
// authenticateRequest runs for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const REPORT_ID = 'REP-00007';
const FILED_AT = new Date('2026-08-20T14:05:00.000Z');

/** Six passengers, which is one more than the admin review threshold needs. */
const PASSENGERS = [
    'PAS-2026-00001',
    'PAS-2026-00002',
    'PAS-2026-00003',
    'PAS-2026-00004',
    'PAS-2026-00005',
    'PAS-2026-00006',
];

const AUTHOR = PASSENGERS[0];

/** A session token per passenger — the token IS the passenger id here. */
const SESSIONS: Record<string, Record<string, string>> = Object.fromEntries(
    PASSENGERS.map((passengerId, index) => [
        passengerId,
        {
            uid: `UID-${index}`,
            passengerId,
            role: 'PASSENGER',
            email: `${passengerId.toLowerCase()}@example.com`,
        },
    ])
);

function storedReport(overrides: Record<string, any> = {}) {
    return {
        id: REPORT_ID,
        reportId: REPORT_ID,
        passengerId: AUTHOR,
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        status: 'PENDING',
        createdAt: FILED_AT,
        updatedAt: FILED_AT,
        ...overrides,
    };
}

function firestoreWith(report: Record<string, any> = storedReport()) {
    return createFakeFirestore({ reports: [report], votes: [] });
}

function request(
    method: string,
    options: { token?: string; body?: unknown; reportId?: string } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    return new Request(
        `http://localhost/api/reports/${options.reportId ?? REPORT_ID}/vote`,
        {
            method,
            headers,
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        }
    );
}

/** The params Expo Router hands the handler for this route. */
function params(reportId: string = REPORT_ID) {
    return { params: { reportId } };
}

/** Casts one vote as one passenger and hands back the parsed response. */
async function vote(token: string, choice: string, reportId: string = REPORT_ID) {
    const response = await castVote(
        request('POST', { token, body: { vote: choice }, reportId }),
        params(reportId)
    );

    return { response, body: await response.json() };
}

/** Every vote document currently stored, whatever report it belongs to. */
async function storedVotes(db: any) {
    const snapshot = await db.collection('votes').get();

    return snapshot.docs.map((doc: any) => doc.data());
}

/** The report as it stands after the votes cast against it. */
async function storedReportDoc(db: any) {
    const doc = await db.collection('reports').doc(REPORT_ID).get();

    return doc.data();
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Authentication
// ==================================================================
describe('/api/reports/[reportId]/vote - authentication', () => {
    it('refuses to record a vote without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await castVote(
            request('POST', { body: { vote: 'AGREE' } }),
            params()
        );

        expect(response.status).toBe(401);

        // Nothing was read or written: the refusal happens before the database
        // is touched at all.
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses to read votes without a token', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getVotes(request('GET'), params());

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('refuses a token that does not verify', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await castVote(
            request('POST', { token: 'forged', body: { vote: 'AGREE' } }),
            params()
        );

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });
});

// ==================================================================
// Casting a vote
// ==================================================================
describe('POST /api/reports/[reportId]/vote', () => {
    it('records an AGREE vote and returns the tallies', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await vote(PASSENGERS[1], 'AGREE');

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.vote).toBe('AGREE');
        expect(body.agreeCount).toBe(1);
        expect(body.disagreeCount).toBe(0);

        const votes = await storedVotes(db);

        expect(votes).toHaveLength(1);
        expect(votes[0]).toMatchObject({
            reportId: REPORT_ID,
            passengerId: PASSENGERS[1],
            vote: 'AGREE',
        });
    });

    it('records a DISAGREE vote', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await vote(PASSENGERS[1], 'DISAGREE');

        expect(response.status).toBe(200);
        expect(body.vote).toBe('DISAGREE');
        expect(body.agreeCount).toBe(0);
        expect(body.disagreeCount).toBe(1);
    });

    it('takes the voter from the token rather than the request body', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        // A caller claiming to be somebody else. The claim is ignored entirely:
        // the vote is stored against the passenger the token belongs to.
        const response = await castVote(
            request('POST', {
                token: PASSENGERS[1],
                body: { vote: 'AGREE', passengerId: PASSENGERS[2] },
            }),
            params()
        );

        expect(response.status).toBe(200);

        const votes = await storedVotes(db);

        expect(votes).toHaveLength(1);
        expect(votes[0].passengerId).toBe(PASSENGERS[1]);
    });

    it('does not turn a repeated vote into a second one', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        await vote(PASSENGERS[1], 'AGREE');
        const { body } = await vote(PASSENGERS[1], 'AGREE');

        expect(body.agreeCount).toBe(1);
        expect(await storedVotes(db)).toHaveLength(1);
    });

    it('moves a vote across rather than holding both', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        const { body } = await vote(PASSENGERS[1], 'DISAGREE');

        expect(body.vote).toBe('DISAGREE');
        expect(body.agreeCount).toBe(0);
        expect(body.disagreeCount).toBe(1);

        const votes = await storedVotes(db);

        expect(votes).toHaveLength(1);
        expect(votes[0].vote).toBe('DISAGREE');
    });

    it('keeps the original createdAt when a vote is changed', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        const first = (await storedVotes(db))[0].createdAt;

        await vote(PASSENGERS[1], 'DISAGREE');
        const changed = (await storedVotes(db))[0];

        expect(changed.createdAt).toBe(first);
    });

    it('counts every passenger separately', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        await vote(PASSENGERS[2], 'AGREE');
        const { body } = await vote(PASSENGERS[3], 'DISAGREE');

        expect(body.agreeCount).toBe(2);
        expect(body.disagreeCount).toBe(1);
        expect(await storedVotes(db)).toHaveLength(3);
    });

    it('lets a passenger vote on a report they filed themselves', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await vote(AUTHOR, 'AGREE');

        expect(response.status).toBe(200);
        expect(body.agreeCount).toBe(1);
    });

    it('one passenger cannot overwrite another passenger\'s vote', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        await vote(PASSENGERS[2], 'DISAGREE');

        const votes = await storedVotes(db);
        const first = votes.find((entry: any) => entry.passengerId === PASSENGERS[1]);

        expect(votes).toHaveLength(2);
        expect(first.vote).toBe('AGREE');
    });

    it('writes the tallies onto the report', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        await vote(PASSENGERS[2], 'DISAGREE');

        const report = await storedReportDoc(db);

        expect(report.agreeCount).toBe(1);
        expect(report.disagreeCount).toBe(1);
    });
});

// ==================================================================
// Rejected votes
// ==================================================================
describe('POST /api/reports/[reportId]/vote - rejections', () => {
    it.each([['MAYBE'], ['agree'], ['']])('rejects %p as a vote', async (choice) => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const { response } = await vote(PASSENGERS[1], choice);

        expect(response.status).toBe(400);
        expect(await storedVotes(db)).toHaveLength(0);
    });

    it('rejects a body with no vote in it', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const response = await castVote(
            request('POST', { token: PASSENGERS[1], body: {} }),
            params()
        );

        expect(response.status).toBe(400);
        expect(await storedVotes(db)).toHaveLength(0);
    });

    it('rejects a request with no body at all', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await castVote(
            request('POST', { token: PASSENGERS[1] }),
            params()
        );

        expect(response.status).toBe(400);
    });

    it('answers 404 for a report that does not exist', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        const { response, body } = await vote(PASSENGERS[1], 'AGREE', 'REP-99999');

        expect(response.status).toBe(404);
        expect(body.message).toMatch(/not found/i);
        expect(await storedVotes(db)).toHaveLength(0);
    });

    it('answers 400 when no report id reaches the handler', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await castVote(
            new Request('http://localhost/api/reports//vote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${PASSENGERS[1]}`,
                },
                body: JSON.stringify({ vote: 'AGREE' }),
            }),
            {}
        );

        expect(response.status).toBe(400);
    });
});

// ==================================================================
// Reading the votes
// ==================================================================
describe('GET /api/reports/[reportId]/vote', () => {
    it('reports no vote of their own for a passenger who has not voted', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getVotes(
            request('GET', { token: PASSENGERS[1] }),
            params()
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.myVote).toBeNull();
        expect(body.agreeCount).toBe(0);
        expect(body.disagreeCount).toBe(0);
    });

    it('hands back this session\'s own vote alongside the tallies', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        await vote(PASSENGERS[2], 'AGREE');
        await vote(PASSENGERS[3], 'DISAGREE');

        const response = await getVotes(
            request('GET', { token: PASSENGERS[3] }),
            params()
        );
        const body = await response.json();

        expect(body.myVote).toBe('DISAGREE');
        expect(body.agreeCount).toBe(2);
        expect(body.disagreeCount).toBe(1);
    });

    it('shows each passenger their own vote and nobody else\'s', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');
        await vote(PASSENGERS[2], 'DISAGREE');

        const first = await (
            await getVotes(request('GET', { token: PASSENGERS[1] }), params())
        ).json();
        const second = await (
            await getVotes(request('GET', { token: PASSENGERS[2] }), params())
        ).json();
        const third = await (
            await getVotes(request('GET', { token: PASSENGERS[3] }), params())
        ).json();

        expect(first.myVote).toBe('AGREE');
        expect(second.myVote).toBe('DISAGREE');
        expect(third.myVote).toBeNull();
    });

    it('answers 404 for a report that does not exist', async () => {
        mockGetAdminDb.mockReturnValue(firestoreWith());

        const response = await getVotes(
            request('GET', { token: PASSENGERS[1], reportId: 'REP-99999' }),
            params('REP-99999')
        );

        expect(response.status).toBe(404);
    });

    it('reads the report id out of the path when no params are given', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        await vote(PASSENGERS[1], 'AGREE');

        const response = await getVotes(request('GET', { token: PASSENGERS[1] }), {});
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.myVote).toBe('AGREE');
        expect(body.agreeCount).toBe(1);
    });
});

// ==================================================================
// The five-agree admin review rule
// ==================================================================
describe('the five-agree admin review flag', () => {
    it('leaves a report with four agreeing passengers unflagged', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 4)) {
            await vote(passenger, 'AGREE');
        }

        const report = await storedReportDoc(db);

        expect(report.agreeCount).toBe(4);
        expect(report.requiresAdminReview).toBe(false);
        expect(report.adminReviewFlaggedAt).toBeUndefined();
    });

    it('flags a report the moment it reaches five', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 4)) {
            await vote(passenger, 'AGREE');
        }

        const { body } = await vote(PASSENGERS[4], 'AGREE');

        expect(body.agreeCount).toBe(5);
        expect(body.requiresAdminReview).toBe(true);

        const report = await storedReportDoc(db);

        expect(report.requiresAdminReview).toBe(true);
        expect(typeof report.adminReviewFlaggedAt).toBe('string');
    });

    it('does not verify the report or touch its status', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 5)) {
            await vote(passenger, 'AGREE');
        }

        const report = await storedReportDoc(db);

        // Five passengers agreeing is a reason for an admin to look, not a
        // finding: only an admin moves a report to VERIFIED.
        expect(report.status).toBe('PENDING');
    });

    it('does not count disagreement towards the flag', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 5)) {
            await vote(passenger, 'DISAGREE');
        }

        const report = await storedReportDoc(db);

        expect(report.disagreeCount).toBe(5);
        expect(report.requiresAdminReview).toBe(false);
    });

    it('takes the flag down when a vote is changed back under the threshold', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 5)) {
            await vote(passenger, 'AGREE');
        }

        expect((await storedReportDoc(db)).requiresAdminReview).toBe(true);

        // The fifth passenger changes their mind, so the report is back to four
        // agreements — and an admin queue entry nobody stands behind.
        const { body } = await vote(PASSENGERS[4], 'DISAGREE');

        expect(body.agreeCount).toBe(4);
        expect(body.disagreeCount).toBe(1);
        expect(body.requiresAdminReview).toBe(false);

        const report = await storedReportDoc(db);

        expect(report.requiresAdminReview).toBe(false);
    });

    it('raises the flag again when the count comes back up', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 5)) {
            await vote(passenger, 'AGREE');
        }

        await vote(PASSENGERS[4], 'DISAGREE');

        const { body } = await vote(PASSENGERS[5], 'AGREE');

        expect(body.agreeCount).toBe(5);
        expect(body.requiresAdminReview).toBe(true);
    });

    it('does not re-flag on a repeated vote that changes nothing', async () => {
        const db = firestoreWith();
        mockGetAdminDb.mockReturnValue(db);

        for (const passenger of PASSENGERS.slice(0, 4)) {
            await vote(passenger, 'AGREE');
        }

        // A fourth passenger pressing Agree again is still four agreements.
        const { body } = await vote(PASSENGERS[3], 'AGREE');

        expect(body.agreeCount).toBe(4);
        expect(body.requiresAdminReview).toBe(false);
    });
});
