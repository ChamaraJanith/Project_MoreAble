// Managing comments from the app (MOV-306 frontend, MOV-304 AC7).
//
// A passenger can reword or delete their own comment; an admin can remove any
// comment from a report's discussion, and cannot edit one. Everything below is
// the logic the two screens render — the helpers, the two reducers and the API
// client — tested directly, as the rest of this folder is (Jest here is
// node-only with no React renderer).

import { ReportCommentRecord } from '../../../src/entities/report/model/types';
import {
    deleteReportComment,
    updateReportComment,
} from '../../../src/features/reports/api/reportFeedbackApi';
import {
    COMMENT_EDITED_LABEL,
    MAX_FEEDBACK_COMMENT_LENGTH,
    formatCommentTimestamp,
    formatCommentTimestampLabel,
    isSubmittableCommentEdit,
} from '../../../src/features/reports/utils/reportFeedback';
import {
    FEEDBACK_MESSAGES,
    ReportFeedbackAction,
    ReportFeedbackState,
    commentCountLabelValue,
    initialFeedbackState,
    isCommentActionPending,
    removeComment,
    replaceComment,
    reportFeedbackReducer,
    shouldSendCommentDelete,
    shouldSendCommentEdit,
} from '../../../src/features/reports/utils/reportFeedbackState';
import { mapAdminReviewReport } from '../../../src/features/reports/utils/reportReview';
import {
    ReportReviewState,
    initialReviewState,
    isReviewBusy,
    reportReviewReducer,
    shouldSendCommentRemoval,
    shouldSendDecision,
    shouldSendRemark,
} from '../../../src/features/reports/utils/reportReviewState';
import { reportCommentApiPath } from '../../../src/features/reports/utils/reportRoutes';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const REPORT_ID = 'REP-00007';
const TOKEN = 'session-token-value';
const WRITTEN_AT = '2026-08-22T09:30:00.000Z';

function comment(commentId: string, overrides: Partial<ReportCommentRecord> = {}): ReportCommentRecord {
    return {
        commentId,
        reportId: REPORT_ID,
        passengerId: 'PAS-2026-00002',
        authorName: 'Kasun Silva',
        text: `Comment ${commentId}.`,
        createdAt: WRITTEN_AT,
        ...overrides,
    };
}

const FIRST = comment('CMT-00003');
const MIDDLE = comment('CMT-00002', { text: 'The ramp was not working.' });
const LAST = comment('CMT-00001');

/** A section with votes and a three-comment thread loaded, newest first. */
function loadedThread(items: ReportCommentRecord[] = [FIRST, MIDDLE, LAST]): ReportFeedbackState {
    const withVotes = reportFeedbackReducer(initialFeedbackState, {
        type: 'votesLoaded',
        votes: { myVote: null, agreeCount: 0, disagreeCount: 0 },
    });

    return reportFeedbackReducer(withVotes, { type: 'commentsLoaded', comments: items });
}

function run(state: ReportFeedbackState, ...actions: ReportFeedbackAction[]): ReportFeedbackState {
    return actions.reduce(reportFeedbackReducer, state);
}

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

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ==================================================================
// The "Edited" label
// ==================================================================
describe('the date line under a comment', () => {
    it('is the posted date alone on a comment nobody has edited', () => {
        const label = formatCommentTimestampLabel(FIRST);

        expect(label).toBe(formatCommentTimestamp(WRITTEN_AT));
        expect(label).not.toContain(COMMENT_EDITED_LABEL);
    });

    it('adds "Edited" once the comment has editedAt', () => {
        const edited = comment('CMT-9', { editedAt: '2026-08-23T10:00:00.000Z' });

        expect(formatCommentTimestampLabel(edited)).toBe(
            `${formatCommentTimestamp(WRITTEN_AT)} · Edited`
        );
    });

    it('keeps the posted date, not the edit date', () => {
        const edited = comment('CMT-9', { editedAt: '2026-12-31T23:00:00.000Z' });

        expect(formatCommentTimestampLabel(edited)).toContain(formatCommentTimestamp(WRITTEN_AT));
    });

    it('is labelled "Edited"', () => {
        expect(COMMENT_EDITED_LABEL).toBe('Edited');
    });
});

// ==================================================================
// What an edit may save
// ==================================================================
describe('isSubmittableCommentEdit', () => {
    const ORIGINAL = 'The ramp was not working.';

    it('accepts changed text', () => {
        expect(isSubmittableCommentEdit('The rear ramp was not working.', ORIGINAL)).toBe(true);
    });

    it('refuses a blank edit', () => {
        expect(isSubmittableCommentEdit('', ORIGINAL)).toBe(false);
    });

    it('refuses a whitespace-only edit', () => {
        expect(isSubmittableCommentEdit('    \n  ', ORIGINAL)).toBe(false);
    });

    it('refuses unchanged text', () => {
        expect(isSubmittableCommentEdit(ORIGINAL, ORIGINAL)).toBe(false);
    });

    it('refuses text that differs only in surrounding whitespace', () => {
        expect(isSubmittableCommentEdit(`   ${ORIGINAL}   `, ORIGINAL)).toBe(false);
    });

    it('accepts exactly 300 characters', () => {
        expect(MAX_FEEDBACK_COMMENT_LENGTH).toBe(300);
        expect(isSubmittableCommentEdit('x'.repeat(300), ORIGINAL)).toBe(true);
    });

    it('refuses 301 characters', () => {
        expect(isSubmittableCommentEdit('x'.repeat(301), ORIGINAL)).toBe(false);
    });

    it('measures the length after trimming', () => {
        expect(isSubmittableCommentEdit(`  ${'x'.repeat(300)}  `, ORIGINAL)).toBe(true);
    });
});

// ==================================================================
// The list helpers
// ==================================================================
describe('replaceComment and removeComment', () => {
    it('replaces a comment in the same position', () => {
        const reworded = { ...MIDDLE, text: 'Reworded.', editedAt: '2026-08-23T10:00:00.000Z' };

        const items = replaceComment([FIRST, MIDDLE, LAST], reworded);

        expect(items.map((entry) => entry.commentId)).toEqual(['CMT-00003', 'CMT-00002', 'CMT-00001']);
        expect(items[1]).toBe(reworded);
    });

    it('does not add a comment that is not on the list', () => {
        const items = replaceComment([FIRST, LAST], MIDDLE);

        expect(items).toEqual([FIRST, LAST]);
    });

    it('removes one comment and keeps the rest in order', () => {
        expect(removeComment([FIRST, MIDDLE, LAST], MIDDLE.commentId)).toEqual([FIRST, LAST]);
    });

    it('leaves the list alone for an unknown id', () => {
        expect(removeComment([FIRST, LAST], 'CMT-99999')).toEqual([FIRST, LAST]);
    });
});

// ==================================================================
// Passenger reducer — editing
// ==================================================================
describe('editing one of the passenger’s comments', () => {
    it('starts with no editor open, nothing in flight and no error', () => {
        expect(initialFeedbackState.editingCommentId).toBeNull();
        expect(initialFeedbackState.pendingCommentAction).toBeNull();
        expect(initialFeedbackState.commentActionError).toBeNull();
    });

    it('opens the editor on the comment asked for', () => {
        const state = run(loadedThread(), { type: 'commentEditOpened', commentId: MIDDLE.commentId });

        expect(state.editingCommentId).toBe(MIDDLE.commentId);
    });

    it('keeps only one comment editable at a time', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditOpened', commentId: FIRST.commentId }
        );

        expect(state.editingCommentId).toBe(FIRST.commentId);
    });

    it('closes the editor on Cancel, leaving the comment as it was', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditCancelled' }
        );

        expect(state.editingCommentId).toBeNull();
        expect(state.comments.items[1]).toBe(MIDDLE);
    });

    it('marks the edit in flight on that comment', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditStarted', commentId: MIDDLE.commentId }
        );

        expect(state.pendingCommentAction).toEqual({ commentId: MIDDLE.commentId, kind: 'edit' });
        expect(isCommentActionPending(state, MIDDLE.commentId, 'edit')).toBe(true);
        expect(isCommentActionPending(state, MIDDLE.commentId, 'delete')).toBe(false);
        expect(isCommentActionPending(state, FIRST.commentId, 'edit')).toBe(false);
    });

    it('replaces the comment in the same position on success, keeping the count', () => {
        const before = loadedThread();
        const stored = { ...MIDDLE, text: 'Reworded.', editedAt: '2026-08-23T10:00:00.000Z' };

        const state = run(
            before,
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditStarted', commentId: MIDDLE.commentId },
            { type: 'commentEditSucceeded', comment: stored }
        );

        expect(state.comments.items.map((entry) => entry.commentId)).toEqual(
            before.comments.items.map((entry) => entry.commentId)
        );
        expect(state.comments.items[1].text).toBe('Reworded.');
        expect(state.comments.items[1].editedAt).toBe('2026-08-23T10:00:00.000Z');
        expect(commentCountLabelValue(state)).toBe(commentCountLabelValue(before));
        expect(state.editingCommentId).toBeNull();
        expect(state.pendingCommentAction).toBeNull();
    });

    it('keeps the original text on failure, with the editor still open', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditStarted', commentId: MIDDLE.commentId },
            { type: 'commentEditFailed' }
        );

        expect(state.comments.items[1]).toBe(MIDDLE);
        expect(state.editingCommentId).toBe(MIDDLE.commentId);
        expect(state.pendingCommentAction).toBeNull();
        expect(state.commentActionError).toBe(FEEDBACK_MESSAGES.commentEditFailed);
    });

    it('does not report a comment edit failure as a failed post', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditStarted', commentId: MIDDLE.commentId },
            { type: 'commentEditFailed' }
        );

        expect(state.submitError).toBeNull();
    });

    it('clears the error when the editor is opened again', () => {
        const failed = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditStarted', commentId: MIDDLE.commentId },
            { type: 'commentEditFailed' },
            { type: 'commentEditCancelled' },
            { type: 'commentEditOpened', commentId: MIDDLE.commentId }
        );

        expect(failed.commentActionError).toBeNull();
    });

    it('closes an editor whose comment a fresh thread no longer holds', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentsLoaded', comments: [FIRST, LAST] }
        );

        expect(state.editingCommentId).toBeNull();
    });

    it('keeps an editor open across a reload that still holds its comment', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentsLoaded', comments: [FIRST, MIDDLE, LAST] }
        );

        expect(state.editingCommentId).toBe(MIDDLE.commentId);
    });
});

// ==================================================================
// Passenger reducer — deleting
// ==================================================================
describe('deleting one of the passenger’s comments', () => {
    it('removes the comment and updates the count on success', () => {
        const before = loadedThread();

        const state = run(
            before,
            { type: 'commentDeleteStarted', commentId: MIDDLE.commentId },
            { type: 'commentDeleteSucceeded', commentId: MIDDLE.commentId }
        );

        expect(state.comments.items).toEqual([FIRST, LAST]);
        expect(commentCountLabelValue(before)).toBe(3);
        expect(commentCountLabelValue(state)).toBe(2);
        expect(state.pendingCommentAction).toBeNull();
    });

    it('announces no count once the last comment is gone', () => {
        const state = run(
            loadedThread([MIDDLE]),
            { type: 'commentDeleteStarted', commentId: MIDDLE.commentId },
            { type: 'commentDeleteSucceeded', commentId: MIDDLE.commentId }
        );

        expect(state.comments.items).toEqual([]);
        expect(state.comments.status).toBe('ready');
        expect(commentCountLabelValue(state)).toBeNull();
    });

    it('keeps the comment on failure', () => {
        const state = run(
            loadedThread(),
            { type: 'commentDeleteStarted', commentId: MIDDLE.commentId },
            { type: 'commentDeleteFailed' }
        );

        expect(state.comments.items).toEqual([FIRST, MIDDLE, LAST]);
        expect(state.pendingCommentAction).toBeNull();
        expect(state.commentActionError).toBe(FEEDBACK_MESSAGES.commentDeleteFailed);
    });

    it('closes the editor if the comment being edited is the one deleted', () => {
        const state = run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditCancelled' },
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentDeleteStarted', commentId: MIDDLE.commentId },
            { type: 'commentDeleteSucceeded', commentId: MIDDLE.commentId }
        );

        expect(state.editingCommentId).toBeNull();
    });
});

// ==================================================================
// Passenger reducer — double sends and unknown comments
// ==================================================================
describe('comment actions that must not send', () => {
    const inFlightEdit = () =>
        run(
            loadedThread(),
            { type: 'commentEditOpened', commentId: MIDDLE.commentId },
            { type: 'commentEditStarted', commentId: MIDDLE.commentId }
        );

    it('will not send an edit while another action is in flight', () => {
        expect(shouldSendCommentEdit(inFlightEdit(), MIDDLE.commentId, 'Reworded again.')).toBe(false);
    });

    it('will not send a delete while another action is in flight', () => {
        expect(shouldSendCommentDelete(inFlightEdit(), FIRST.commentId)).toBe(false);
    });

    it('ignores a second start while one is in flight', () => {
        const state = run(inFlightEdit(), { type: 'commentDeleteStarted', commentId: FIRST.commentId });

        expect(state.pendingCommentAction).toEqual({ commentId: MIDDLE.commentId, kind: 'edit' });
    });

    it('will not open another editor while an action is in flight', () => {
        const state = run(inFlightEdit(), { type: 'commentEditOpened', commentId: FIRST.commentId });

        expect(state.editingCommentId).toBe(MIDDLE.commentId);
    });

    it('will not cancel an edit that is already on its way', () => {
        const state = run(inFlightEdit(), { type: 'commentEditCancelled' });

        expect(state.editingCommentId).toBe(MIDDLE.commentId);
    });

    it('sends an edit only for the comment open in the editor', () => {
        const state = run(loadedThread(), { type: 'commentEditOpened', commentId: MIDDLE.commentId });

        expect(shouldSendCommentEdit(state, MIDDLE.commentId, 'Reworded.')).toBe(true);
        expect(shouldSendCommentEdit(state, FIRST.commentId, 'Reworded.')).toBe(false);
    });

    it('will not send an edit that is blank, unchanged or too long', () => {
        const state = run(loadedThread(), { type: 'commentEditOpened', commentId: MIDDLE.commentId });

        expect(shouldSendCommentEdit(state, MIDDLE.commentId, '   ')).toBe(false);
        expect(shouldSendCommentEdit(state, MIDDLE.commentId, MIDDLE.text)).toBe(false);
        expect(shouldSendCommentEdit(state, MIDDLE.commentId, 'x'.repeat(301))).toBe(false);
    });

    it('does nothing for a comment id that is not on the list', () => {
        const before = loadedThread();

        const opened = run(before, { type: 'commentEditOpened', commentId: 'CMT-99999' });
        const editStarted = run(before, { type: 'commentEditStarted', commentId: 'CMT-99999' });
        const deleteStarted = run(before, { type: 'commentDeleteStarted', commentId: 'CMT-99999' });

        expect(opened).toBe(before);
        expect(editStarted).toBe(before);
        expect(deleteStarted).toBe(before);
        expect(shouldSendCommentDelete(before, 'CMT-99999')).toBe(false);
        expect(shouldSendCommentEdit(before, 'CMT-99999', 'Reworded.')).toBe(false);
    });

    it('does not bring back a comment when an edit lands after it was removed', () => {
        const state = run(
            loadedThread([FIRST, LAST]),
            { type: 'commentEditSucceeded', comment: { ...MIDDLE, text: 'Late.' } }
        );

        expect(state.comments.items).toEqual([FIRST, LAST]);
    });
});

// ==================================================================
// API client
// ==================================================================
describe('reportCommentApiPath', () => {
    it('addresses one comment under its report, both ids encoded', () => {
        expect(reportCommentApiPath('REP 7', 'CMT/1')).toBe('/api/reports/REP%207/comments/CMT%2F1');
    });
});

describe('updateReportComment', () => {
    it('PATCHes the comment route with { comment } and the token', async () => {
        respondWith(200, { success: true, comment: { ...MIDDLE, text: 'Reworded.' } });

        await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        const { url, init, headers, body } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/comments/${MIDDLE.commentId}`);
        expect(init.method).toBe('PATCH');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(headers['Content-Type']).toBe('application/json');
        expect(body).toEqual({ comment: 'Reworded.' });
    });

    it('sends nothing identifying the passenger beyond the token', async () => {
        respondWith(200, { success: true, comment: MIDDLE });

        await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        expect(Object.keys(sentRequest().body)).toEqual(['comment']);
    });

    it('hands back the record the server stored', async () => {
        const stored = { ...MIDDLE, text: 'Reworded.', editedAt: '2026-08-23T10:00:00.000Z' };
        respondWith(200, { success: true, comment: stored });

        const result = await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        expect(result).toEqual({ ok: true, value: stored });
    });

    it('reports the API’s message and status on a refusal', async () => {
        respondWith(403, { success: false, message: 'You can only edit your own comments.' });

        const result = await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        expect(result).toEqual({
            ok: false,
            message: 'You can only edit your own comments.',
            status: 403,
        });
    });

    it('carries a 404 so the screen can reload the thread', async () => {
        respondWith(404, { success: false, message: 'Comment not found.' });

        const result = await updateReportComment(REPORT_ID, 'CMT-99999', 'Reworded.', TOKEN);

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.status).toBe(404);
    });

    it('falls back to its own wording when nothing readable came back', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error('not json');
            },
        });

        const result = await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to update your comment.', status: 500 });
    });

    it('reports a success that carried no comment as a failure', async () => {
        respondWith(200, { success: true });

        const result = await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        expect(result.ok).toBe(false);
    });

    it('falls back on a network error, with no status', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await updateReportComment(REPORT_ID, MIDDLE.commentId, 'Reworded.', TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to update your comment.' });
    });
});

describe('deleteReportComment', () => {
    it('DELETEs the encoded comment route with the token and no body', async () => {
        respondWith(200, { success: true, message: 'Comment deleted.', commentId: 'CMT/1' });

        await deleteReportComment(REPORT_ID, 'CMT/1', TOKEN);

        const { url, init, headers } = sentRequest();

        expect(url).toBe(`/api/reports/${REPORT_ID}/comments/CMT%2F1`);
        expect(init.method).toBe('DELETE');
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(headers['Content-Type']).toBeUndefined();
        expect(init.body).toBeUndefined();
    });

    it('hands back the removed comment id', async () => {
        respondWith(200, { success: true, commentId: MIDDLE.commentId });

        const result = await deleteReportComment(REPORT_ID, MIDDLE.commentId, TOKEN);

        expect(result).toEqual({ ok: true, value: MIDDLE.commentId });
    });

    it('reports the API’s message and status on a refusal', async () => {
        respondWith(403, { success: false, message: 'You can only delete your own comments.' });

        const result = await deleteReportComment(REPORT_ID, MIDDLE.commentId, TOKEN);

        expect(result).toEqual({
            ok: false,
            message: 'You can only delete your own comments.',
            status: 403,
        });
    });

    it('falls back on a network error, with no status', async () => {
        mockFetch.mockRejectedValue(new Error('Network request failed'));

        const result = await deleteReportComment(REPORT_ID, MIDDLE.commentId, TOKEN);

        expect(result).toEqual({ ok: false, message: 'Failed to delete the comment.' });
    });
});

// ==================================================================
// Admin reducer — removing a comment
// ==================================================================
describe('an admin removing a comment', () => {
    function adminLoaded(overrides: Partial<ReportReviewState> = {}): ReportReviewState {
        const report = mapAdminReviewReport({
            documentId: REPORT_ID,
            reportId: REPORT_ID,
            passengerId: 'PAS-2026-00001',
            issueCategory: 'BROKEN_RAMP',
            description: 'The boarding ramp would not fold out.',
            status: 'PENDING',
            createdAt: '2026-08-20T09:30:00.000Z',
            updatedAt: '2026-08-20T09:30:00.000Z',
            agreeCount: 6,
            disagreeCount: 1,
            commentCount: 3,
            requiresAdminReview: true,
            flagged: true,
            review: null,
        });

        const state = reportReviewReducer(initialReviewState, {
            type: 'loadSucceeded',
            report: report!,
            comments: [FIRST, MIDDLE, LAST],
        });

        return { ...state, ...overrides };
    }

    it('starts with nothing being removed', () => {
        expect(initialReviewState.removingCommentId).toBeNull();
        expect(initialReviewState.commentRemovalError).toBeNull();
    });

    it('marks the comment being removed', () => {
        const state = reportReviewReducer(adminLoaded(), {
            type: 'commentRemovalStarted',
            commentId: MIDDLE.commentId,
        });

        expect(state.removingCommentId).toBe(MIDDLE.commentId);
    });

    it('removes the comment and brings the comment count down with it', () => {
        const state = [
            { type: 'commentRemovalStarted', commentId: MIDDLE.commentId } as const,
            { type: 'commentRemovalSucceeded', commentId: MIDDLE.commentId } as const,
        ].reduce(reportReviewReducer, adminLoaded());

        expect(state.comments).toEqual([FIRST, LAST]);
        expect(state.report?.commentCount).toBe(2);
        expect(state.removingCommentId).toBeNull();
        expect(state.commentRemovalError).toBeNull();
    });

    it('keeps the comment and the count on failure, and says why', () => {
        const state = [
            { type: 'commentRemovalStarted', commentId: MIDDLE.commentId } as const,
            { type: 'commentRemovalFailed', message: 'Comment not found.' } as const,
        ].reduce(reportReviewReducer, adminLoaded());

        expect(state.comments).toEqual([FIRST, MIDDLE, LAST]);
        expect(state.report?.commentCount).toBe(3);
        expect(state.removingCommentId).toBeNull();
        expect(state.commentRemovalError).toBe('Comment not found.');
    });

    it('will not send a second removal while one is in flight', () => {
        const state = reportReviewReducer(adminLoaded(), {
            type: 'commentRemovalStarted',
            commentId: MIDDLE.commentId,
        });

        expect(shouldSendCommentRemoval(state, FIRST.commentId)).toBe(false);
        expect(
            reportReviewReducer(state, { type: 'commentRemovalStarted', commentId: FIRST.commentId })
        ).toBe(state);
    });

    it('does nothing for a comment that is not in the thread', () => {
        const before = adminLoaded();

        expect(shouldSendCommentRemoval(before, 'CMT-99999')).toBe(false);
        expect(
            reportReviewReducer(before, { type: 'commentRemovalStarted', commentId: 'CMT-99999' })
        ).toBe(before);
    });

    it('will not send before a report is on the page', () => {
        expect(shouldSendCommentRemoval(initialReviewState, MIDDLE.commentId)).toBe(false);
    });

    it('leaves Verify, Reject and Save Remark available while a removal runs', () => {
        const state = reportReviewReducer(adminLoaded(), {
            type: 'commentRemovalStarted',
            commentId: MIDDLE.commentId,
        });

        expect(state.pendingAction).toBeNull();
        expect(isReviewBusy(state)).toBe(false);
        expect(shouldSendDecision(state)).toBe(true);
        expect(shouldSendRemark(state, 'Checked with the depot.')).toBe(true);
    });

    it('never touches the decision state — pending action, error or success message', () => {
        const deciding = reportReviewReducer(adminLoaded(), { type: 'actionStarted', action: 'VERIFY' });

        const afterRemoval = [
            { type: 'commentRemovalStarted', commentId: MIDDLE.commentId } as const,
            { type: 'commentRemovalFailed', message: 'Comment not found.' } as const,
        ].reduce(reportReviewReducer, deciding);

        expect(afterRemoval.pendingAction).toBe('VERIFY');
        expect(afterRemoval.actionError).toBeNull();
        expect(afterRemoval.successMessage).toBeNull();
    });

    it('can still remove a comment while a decision is on its way', () => {
        const deciding = reportReviewReducer(adminLoaded(), { type: 'actionStarted', action: 'REJECT' });

        expect(shouldSendCommentRemoval(deciding, MIDDLE.commentId)).toBe(true);
    });

    it('does not put a removal failure where a decision failure goes', () => {
        const state = reportReviewReducer(adminLoaded(), {
            type: 'commentRemovalFailed',
            message: 'Comment not found.',
        });

        expect(state.actionError).toBeNull();
    });

    it('lets a later reload replace the thread as the server now holds it', () => {
        const removed = [
            { type: 'commentRemovalStarted', commentId: MIDDLE.commentId } as const,
            { type: 'commentRemovalSucceeded', commentId: MIDDLE.commentId } as const,
        ].reduce(reportReviewReducer, adminLoaded());

        const reloaded = reportReviewReducer(removed, {
            type: 'loadSucceeded',
            report: { ...removed.report!, commentCount: 2 },
            comments: [FIRST, LAST],
        });

        expect(reloaded.comments).toEqual([FIRST, LAST]);
        expect(reloaded.report?.commentCount).toBe(2);
    });
});
