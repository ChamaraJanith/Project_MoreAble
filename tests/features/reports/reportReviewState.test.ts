// The review page over time.
//
// The interesting failures on this screen are all about timing rather than
// about drawing: two presses of Verify becoming two decisions, a status
// appearing before the server recorded it, a Verify button still on offer under
// a report another admin decided a second ago.
//
// Each of those is a reducer transition or a guard, which is why they are
// testable at all — Jest here is node-only with no React renderer.

import { ReportCommentRecord } from '../../../src/entities/report/model/types';
import {
    AdminReviewReport,
    mapAdminReviewReport,
} from '../../../src/features/reports/utils/reportReview';
import {
    initialRemarkDraft,
    initialReviewState,
    isActionPending,
    isReviewBusy,
    reportReviewReducer,
    shouldSendDecision,
    shouldSendRemark,
} from '../../../src/features/reports/utils/reportReviewState';

const REPORT_ID = 'REP-00007';

function report(overrides: Record<string, any> = {}): AdminReviewReport {
    return mapAdminReviewReport({
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
        commentCount: 1,
        requiresAdminReview: true,
        flagged: true,
        review: null,
        ...overrides,
    });
}

function comment(): ReportCommentRecord {
    return {
        commentId: 'CMT-1',
        reportId: REPORT_ID,
        passengerId: 'PAS-2026-00003',
        authorName: 'Kasun Silva',
        text: 'Same thing happened to me.',
        createdAt: '2026-08-21T08:00:00.000Z',
    };
}

/** A page that has loaded one pending report, which is where most tests start. */
function loaded(overrides: Record<string, any> = {}) {
    return reportReviewReducer(initialReviewState, {
        type: 'loadSucceeded',
        report: report(overrides),
        comments: [comment()],
    });
}

// ==================================================================
// Loading
// ==================================================================
describe('loading the report', () => {
    it('starts with nothing drawn and nothing claimed', () => {
        expect(initialReviewState.status).toBe('loading');
        expect(initialReviewState.report).toBeNull();
        expect(initialReviewState.comments).toEqual([]);
        expect(initialReviewState.pendingAction).toBeNull();
    });

    it('puts the report and the thread on screen once they arrive', () => {
        const state = loaded();

        expect(state.status).toBe('ready');
        expect(state.report?.reportId).toBe(REPORT_ID);
        expect(state.comments).toHaveLength(1);
        expect(state.loadError).toBeNull();
    });

    it('keeps the report on screen while it is being refreshed', () => {
        // The reload that follows a decision must not blank the page and redraw
        // it: that reads as something having gone wrong rather than as the
        // decision that was just confirmed.
        const state = reportReviewReducer(loaded(), { type: 'loadStarted' });

        expect(state.status).toBe('loading');
        expect(state.report).not.toBeNull();
    });

    it('says why it could not load, and shows no report', () => {
        const state = reportReviewReducer(initialReviewState, {
            type: 'loadFailed',
            message: 'Your session has expired. Please sign in again.',
        });

        expect(state.status).toBe('failed');
        expect(state.report).toBeNull();
        expect(state.loadError).toBe('Your session has expired. Please sign in again.');
    });

    it('tells a deleted report apart from a failed load', () => {
        // "It is gone" and "we could not read it" are different facts, and only
        // one of them is worth offering Try Again for.
        const state = reportReviewReducer(loaded(), { type: 'reportMissing' });

        expect(state.status).toBe('missing');
        expect(state.report).toBeNull();
        expect(state.loadError).toBeNull();
    });
});

// ==================================================================
// Duplicate submission
// ==================================================================
describe('preventing a second submission', () => {
    it('sends a decision from a loaded, pending report', () => {
        expect(shouldSendDecision(loaded())).toBe(true);
    });

    it('refuses a second decision while one is in flight', () => {
        // The whole guard against a double press: a second press cannot become
        // a second request even if it lands before React has re-rendered.
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });

        expect(shouldSendDecision(busy)).toBe(false);
        expect(isReviewBusy(busy)).toBe(true);
    });

    it('refuses a remark while anything is in flight', () => {
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });

        expect(shouldSendRemark(busy, 'Checked the ramp.')).toBe(false);
    });

    it('refuses a decision before the report has been read', () => {
        expect(shouldSendDecision(initialReviewState)).toBe(false);
    });

    it('refuses a decision on a report that could not be read', () => {
        const failed = reportReviewReducer(initialReviewState, {
            type: 'loadFailed',
            message: 'Failed to load the report for review.',
        });

        expect(shouldSendDecision(failed)).toBe(false);
    });

    it('says which action is busy, so only that button spins', () => {
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'REJECT',
        });

        expect(isActionPending(busy, 'REJECT')).toBe(true);
        expect(isActionPending(busy, 'VERIFY')).toBe(false);
    });

    it('frees the buttons again once the request answers', () => {
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });
        const done = reportReviewReducer(busy, {
            type: 'actionSucceeded',
            report: report({ status: 'VERIFIED' }),
            message: 'Report marked VERIFIED.',
        });

        expect(isReviewBusy(done)).toBe(false);
    });

    it('frees the buttons again when the request fails', () => {
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });
        const failed = reportReviewReducer(busy, {
            type: 'actionFailed',
            message: 'This report has already been reviewed (VERIFIED).',
        });

        expect(isReviewBusy(failed)).toBe(false);
    });
});

// ==================================================================
// What a decision does to the page
// ==================================================================
describe('recording a decision', () => {
    it('changes nothing on screen while the request is in flight', () => {
        // Nothing moves on the strength of a press alone.
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });

        expect(busy.report?.status).toBe('PENDING');
    });

    it('shows the status the API returned, not one assembled locally', () => {
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });
        const done = reportReviewReducer(busy, {
            type: 'actionSucceeded',
            report: report({ status: 'VERIFIED' }),
            message: 'Report marked VERIFIED.',
        });

        expect(done.report?.status).toBe('VERIFIED');
        expect(done.successMessage).toBe('Report marked VERIFIED.');
        expect(done.actionError).toBeNull();
    });

    it('stops offering a decision once one has been recorded', () => {
        const done = reportReviewReducer(loaded(), {
            type: 'actionSucceeded',
            report: report({ status: 'VERIFIED' }),
            message: 'Report marked VERIFIED.',
        });

        expect(shouldSendDecision(done)).toBe(false);
    });

    it('leaves the report exactly as it was when the decision failed', () => {
        // Showing it as verified here would tell the admin their decision was
        // recorded when it was not.
        const busy = reportReviewReducer(loaded(), {
            type: 'actionStarted',
            action: 'VERIFY',
        });
        const failed = reportReviewReducer(busy, {
            type: 'actionFailed',
            message: 'This report has already been reviewed (VERIFIED).',
        });

        expect(failed.report?.status).toBe('PENDING');
        expect(failed.actionError).toBe('This report has already been reviewed (VERIFIED).');
        expect(failed.successMessage).toBeNull();
    });

    it('clears the last outcome when the next action starts', () => {
        const done = reportReviewReducer(loaded(), {
            type: 'actionSucceeded',
            report: report({ status: 'VERIFIED' }),
            message: 'Report marked VERIFIED.',
        });
        const next = reportReviewReducer(done, {
            type: 'actionStarted',
            action: 'REMARK',
        });

        expect(next.successMessage).toBeNull();
        expect(next.actionError).toBeNull();
    });

    it('refreshes the page from the API after the decision', () => {
        // The decision's own response redraws the report; the reload that
        // follows it is what makes the tallies and the thread the server's too.
        const done = reportReviewReducer(loaded(), {
            type: 'actionSucceeded',
            report: report({ status: 'VERIFIED' }),
            message: 'Report marked VERIFIED.',
        });
        const reloading = reportReviewReducer(done, { type: 'loadStarted' });
        const reloaded = reportReviewReducer(reloading, {
            type: 'loadSucceeded',
            report: report({ status: 'VERIFIED', agreeCount: 8, commentCount: 4 }),
            comments: [comment()],
        });

        expect(reloaded.status).toBe('ready');
        expect(reloaded.report?.status).toBe('VERIFIED');
        expect(reloaded.report?.agreeCount).toBe(8);
        expect(reloaded.report?.commentCount).toBe(4);
    });
});

// ==================================================================
// The remark
// ==================================================================
describe('saving a remark', () => {
    it('sends what was written on a pending report', () => {
        expect(shouldSendRemark(loaded(), 'Checked with the depot.')).toBe(true);
    });

    it('refuses an empty remark client-side', () => {
        expect(shouldSendRemark(loaded(), '')).toBe(false);
    });

    it('refuses a remark that is nothing but whitespace', () => {
        expect(shouldSendRemark(loaded(), '    ')).toBe(false);
        expect(shouldSendRemark(loaded(), '\n\t')).toBe(false);
    });

    it('still sends a remark on a report that has already been decided', () => {
        // A remark carries no decision, so the API accepts REMARK at any point
        // in the report's life — unlike Verify and Reject.
        const decided = loaded({ status: 'VERIFIED' });

        expect(shouldSendDecision(decided)).toBe(false);
        expect(shouldSendRemark(decided, 'Following up with the depot.')).toBe(true);
    });

    it('still sends a remark while the report is being refreshed', () => {
        // The reload runs on every screen focus and after every action, and it
        // keeps the report on screen — so the page looks entirely normal, with
        // the remark in the box and Save Remark showing. Refusing to send here
        // is what made pressing it do nothing at all.
        const refreshing = reportReviewReducer(loaded(), { type: 'loadStarted' });

        expect(refreshing.report).not.toBeNull();
        expect(shouldSendRemark(refreshing, 'Chasing the depot.')).toBe(true);
    });

    it('still sends a remark after a refresh that failed', () => {
        // A refresh that never came back used to disable the composer for good,
        // leaving an admin retyping a remark that could never be saved.
        const stale = reportReviewReducer(loaded(), {
            type: 'loadFailed',
            message: 'Failed to load the report for review.',
        });

        expect(stale.report).not.toBeNull();
        expect(shouldSendRemark(stale, 'Chasing the depot.')).toBe(true);
    });

    it('still offers a decision while the report is being refreshed', () => {
        const refreshing = reportReviewReducer(loaded(), { type: 'loadStarted' });

        expect(shouldSendDecision(refreshing)).toBe(true);
    });

    it('sends nothing at all once the report is gone', () => {
        const gone = reportReviewReducer(loaded(), { type: 'reportMissing' });

        expect(shouldSendRemark(gone, 'Chasing the depot.')).toBe(false);
        expect(shouldSendDecision(gone)).toBe(false);
    });

    it('refuses a remark before the report has been read', () => {
        expect(shouldSendRemark(initialReviewState, 'Checked the ramp.')).toBe(false);
    });

    it('opens the composer with the remark already on the report', () => {
        // An admin revisiting a decision sees what was written rather than an
        // empty box beside a remark displayed above it.
        const withRemark = report({
            status: 'VERIFIED',
            review: {
                status: 'VERIFIED',
                reviewedBy: 'ADM-0001',
                reviewedAt: '2026-08-23T11:00:00.000Z',
                adminRemark: 'Confirmed with the depot.',
            },
        });

        expect(initialRemarkDraft(withRemark)).toBe('Confirmed with the depot.');
    });

    it('opens the composer empty on a report nobody has remarked on', () => {
        expect(initialRemarkDraft(report())).toBe('');
        expect(initialRemarkDraft(null)).toBe('');
    });
});

// ==================================================================
// Unknown actions
// ==================================================================
describe('the reducer itself', () => {
    it('leaves the state alone for an action it does not know', () => {
        const state = loaded();

        expect(reportReviewReducer(state, { type: 'nonsense' } as any)).toBe(state);
    });
});
