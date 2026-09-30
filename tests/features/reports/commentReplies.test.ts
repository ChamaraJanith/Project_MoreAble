// Replies and photos on the passenger comment thread: the pure half.
//
// Grouping the flat list into threads, deciding when a composer may send
// (never while its photo is still uploading), what a picked file must be to
// count as a comment photo, and how the list changes when a comment with
// replies is deleted. Jest here is node-only, so the screens are covered
// through these helpers and a few source checks.

import * as fs from 'fs';
import * as path from 'path';
import {
    MAX_COMMENT_IMAGE_BYTES,
    ReportCommentRecord,
    ReportPhotoDraft,
} from '../../../src/entities/report/model/types';
import { submitReportComment } from '../../../src/features/reports/api/reportFeedbackApi';
import {
    canSubmitCommentDraft,
    commentImageProblem,
    countVisibleComments,
    groupCommentThreads,
    replyingToLabel,
} from '../../../src/features/reports/utils/reportFeedback';
import {
    FEEDBACK_MESSAGES,
    ReportFeedbackState,
    commentCountLabelValue,
    initialFeedbackState,
    removeCommentFromThread,
    reportFeedbackReducer,
    shouldSendComment,
    shouldSendReply,
} from '../../../src/features/reports/utils/reportFeedbackState';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const PHOTO_URL = 'https://res.cloudinary.com/moveable/image/upload/v1/comments/ramp.jpg';

function comment(commentId: string, overrides: Partial<ReportCommentRecord> = {}): ReportCommentRecord {
    return {
        commentId,
        reportId: 'REP-00007',
        passengerId: 'PAS-2026-00002',
        authorName: 'Kasun Silva',
        text: `Comment ${commentId}`,
        createdAt: '2026-08-21T08:00:00.000Z',
        ...overrides,
    };
}

function photo(status: ReportPhotoDraft['status']): ReportPhotoDraft {
    return {
        uri: 'file:///photo.jpg',
        status,
        ...(status === 'uploaded' ? { url: PHOTO_URL } : {}),
    };
}

// Newest first, as the API sends them.
const NEWER = comment('CMT-00003', { createdAt: '2026-08-21T10:00:00.000Z' });
const OLDER = comment('CMT-00001', { createdAt: '2026-08-21T08:00:00.000Z' });
const LATE_REPLY = comment('CMT-00004', {
    parentCommentId: OLDER.commentId,
    createdAt: '2026-08-21T11:00:00.000Z',
});
const EARLY_REPLY = comment('CMT-00002', {
    parentCommentId: OLDER.commentId,
    createdAt: '2026-08-21T09:00:00.000Z',
});

function loaded(items: ReportCommentRecord[]): ReportFeedbackState {
    return reportFeedbackReducer(initialFeedbackState, { type: 'commentsLoaded', comments: items });
}

// ==================================================================
// Threads
// ==================================================================
describe('groupCommentThreads', () => {
    it('puts replies under their comment, oldest first, and keeps top-level order', () => {
        const threads = groupCommentThreads([LATE_REPLY, NEWER, EARLY_REPLY, OLDER]);

        expect(threads.map((thread) => thread.comment.commentId)).toEqual([
            NEWER.commentId,
            OLDER.commentId,
        ]);
        expect(threads[1].replies.map((reply) => reply.commentId)).toEqual([
            EARLY_REPLY.commentId,
            LATE_REPLY.commentId,
        ]);
        expect(threads[0].replies).toEqual([]);
    });

    it('shows a reply whose parent is missing as a top-level comment rather than losing it', () => {
        const orphan = comment('CMT-00009', { parentCommentId: 'CMT-00404' });

        expect(groupCommentThreads([orphan]).map((thread) => thread.comment)).toEqual([orphan]);
    });

    it('hides a deleted placeholder once it has no replies left', () => {
        const placeholder = { ...OLDER, text: '', deleted: true };

        expect(groupCommentThreads([placeholder])).toEqual([]);
        expect(groupCommentThreads([placeholder, EARLY_REPLY])).toHaveLength(1);
    });

    it('counts only comments still saying something', () => {
        expect(countVisibleComments([NEWER, { ...OLDER, deleted: true }, EARLY_REPLY])).toBe(2);
        expect(commentCountLabelValue(loaded([{ ...OLDER, deleted: true }, EARLY_REPLY]))).toBe(1);
    });

    it('names whom a reply answers', () => {
        expect(replyingToLabel('Kasun Silva')).toBe('Replying to Kasun Silva');
        expect(replyingToLabel('  ')).toBe('Replying to Passenger');
    });
});

// ==================================================================
// When a composer may send
// ==================================================================
describe('canSubmitCommentDraft', () => {
    it('sends text alone, a finished photo alone, or both', () => {
        expect(canSubmitCommentDraft('The ramp was blocked.', null)).toBe(true);
        expect(canSubmitCommentDraft('', photo('uploaded'))).toBe(true);
        expect(canSubmitCommentDraft('Look.', photo('uploaded'))).toBe(true);
    });

    it('does not send blank space with no photo', () => {
        expect(canSubmitCommentDraft('   ', null)).toBe(false);
    });

    it('never sends while the photo is uploading, or after it failed', () => {
        expect(canSubmitCommentDraft('Look.', photo('uploading'))).toBe(false);
        expect(canSubmitCommentDraft('Look.', photo('failed'))).toBe(false);
    });

    it('holds text to the length cap even with a photo', () => {
        expect(canSubmitCommentDraft('x'.repeat(301), photo('uploaded'))).toBe(false);
    });

    it('guards the main composer the same way', () => {
        const state = loaded([]);

        expect(shouldSendComment(state, '', photo('uploaded'))).toBe(true);
        expect(shouldSendComment(state, 'Look.', photo('uploading'))).toBe(false);
        expect(shouldSendComment({ ...state, isPostingComment: true }, 'Look.')).toBe(false);
    });
});

describe('shouldSendReply', () => {
    const state = loaded([NEWER, OLDER, EARLY_REPLY]);

    it('sends a reply to a top-level comment on the list', () => {
        expect(shouldSendReply(state, OLDER.commentId, 'Same here.')).toBe(true);
    });

    it('refuses a reply to a reply, to a missing comment, or to a placeholder', () => {
        expect(shouldSendReply(state, EARLY_REPLY.commentId, 'Nested.')).toBe(false);
        expect(shouldSendReply(state, 'CMT-99999', 'Gone.')).toBe(false);
        expect(
            shouldSendReply(loaded([{ ...OLDER, deleted: true }, EARLY_REPLY]), OLDER.commentId, 'Hi.')
        ).toBe(false);
    });

    it('refuses while a reply is in flight or its photo is uploading', () => {
        expect(shouldSendReply({ ...state, isPostingReply: true }, OLDER.commentId, 'Hi.')).toBe(false);
        expect(shouldSendReply(state, OLDER.commentId, 'Hi.', photo('uploading'))).toBe(false);
    });
});

// ==================================================================
// Comment photos
// ==================================================================
describe('commentImageProblem', () => {
    it('accepts an image within the limit', () => {
        expect(commentImageProblem({ mimeType: 'image/jpeg', fileSize: 200_000 })).toBeNull();
        expect(commentImageProblem({ mimeType: null, fileSize: undefined })).toBeNull();
    });

    it('refuses anything that is not an image', () => {
        expect(commentImageProblem({ mimeType: 'video/mp4', fileSize: 10 })).toMatch(/image/i);
        expect(commentImageProblem({ mimeType: 'application/pdf' })).toMatch(/image/i);
    });

    it('refuses an image over the size limit, measured from base64 when no size is given', () => {
        expect(
            commentImageProblem({ mimeType: 'image/png', fileSize: MAX_COMMENT_IMAGE_BYTES + 1 })
        ).toMatch(/5MB/);

        const tooBig = 'A'.repeat(Math.ceil(((MAX_COMMENT_IMAGE_BYTES + 3) * 4) / 3));

        expect(commentImageProblem({ mimeType: 'image/png', base64: tooBig })).toMatch(/5MB/);
    });
});

// ==================================================================
// The reducer
// ==================================================================
describe('replies in the reducer', () => {
    it('adds a stored reply to the list without locking the main composer', () => {
        const started = reportFeedbackReducer(loaded([OLDER]), { type: 'replyStarted' });

        expect(started.isPostingReply).toBe(true);
        expect(started.isPostingComment).toBe(false);

        const done = reportFeedbackReducer(started, { type: 'replySucceeded', comment: EARLY_REPLY });

        expect(done.isPostingReply).toBe(false);
        expect(groupCommentThreads(done.comments.items)[0].replies).toEqual([EARLY_REPLY]);
    });

    it('says a failed reply in the reply box, in the API’s words when it gave some', () => {
        const failed = reportFeedbackReducer(loaded([OLDER]), { type: 'replyFailed' });
        const explained = reportFeedbackReducer(loaded([OLDER]), {
            type: 'replyFailed',
            message: 'That comment has been deleted.',
        });

        expect(failed.replyError).toBe(FEEDBACK_MESSAGES.replySubmitFailed);
        expect(failed.submitError).toBeNull();
        expect(explained.replyError).toBe('That comment has been deleted.');
        expect(reportFeedbackReducer(failed, { type: 'replyDismissed' }).replyError).toBeNull();
    });
});

describe('removeCommentFromThread', () => {
    it('turns a comment with replies into a placeholder, dropping its words and photo', () => {
        const withPhoto = { ...OLDER, imageUrl: PHOTO_URL };
        const items = removeCommentFromThread([withPhoto, EARLY_REPLY], OLDER.commentId);

        expect(items[0]).toMatchObject({ commentId: OLDER.commentId, deleted: true, text: '' });
        expect(items[0]).not.toHaveProperty('imageUrl');
        expect(items[1]).toBe(EARLY_REPLY);
    });

    it('removes a comment with no replies outright', () => {
        expect(removeCommentFromThread([NEWER, OLDER], NEWER.commentId)).toEqual([OLDER]);
    });

    it('removes a placeholder with its last reply, and keeps it while others remain', () => {
        const placeholder = { ...OLDER, text: '', deleted: true };

        expect(
            removeCommentFromThread([placeholder, EARLY_REPLY, LATE_REPLY], EARLY_REPLY.commentId)
        ).toEqual([placeholder, LATE_REPLY]);
        expect(removeCommentFromThread([placeholder, EARLY_REPLY], EARLY_REPLY.commentId)).toEqual([]);
    });

    it('is what a confirmed delete does to the list', () => {
        const state = reportFeedbackReducer(
            reportFeedbackReducer(loaded([OLDER, EARLY_REPLY]), {
                type: 'commentDeleteStarted',
                commentId: OLDER.commentId,
            }),
            { type: 'commentDeleteSucceeded', commentId: OLDER.commentId }
        );

        expect(state.comments.items[0].deleted).toBe(true);
        expect(commentCountLabelValue(state)).toBe(1);
    });
});

// ==================================================================
// On the wire
// ==================================================================
describe('submitReportComment with attachments', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
        global.fetch = mockFetch as unknown as typeof fetch;
        mockFetch.mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({ success: true, comment: EARLY_REPLY }),
        });
    });

    afterEach(() => mockFetch.mockReset());

    it('sends the photo URL and the parent only when present', async () => {
        await submitReportComment('REP-00007', 'Same here.', 'token', {
            imageUrl: PHOTO_URL,
            parentCommentId: OLDER.commentId,
        });
        await submitReportComment('REP-00007', 'Plain.', 'token', { imageUrl: null });

        const bodies = mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body));

        expect(bodies[0]).toEqual({
            comment: 'Same here.',
            imageUrl: PHOTO_URL,
            parentCommentId: OLDER.commentId,
        });
        expect(bodies[1]).toEqual({ comment: 'Plain.' });
    });
});

// ==================================================================
// On screen
// ==================================================================
describe('the screens', () => {
    const ROOT = path.resolve(__dirname, '../../..');
    const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

    const comments = read('src/features/reports/ui/FeedbackComments.tsx');
    const community = read('src/features/reports/ui/CommunityFeedback.tsx');
    const hook = read('src/features/reports/ui/useCommentImageAttachment.ts');

    it('draws every row, reply or not, through the one renderComment', () => {
        expect(comments.match(/<CommentRow\b/g)).toHaveLength(1);
        expect(comments).toContain('{renderComment(reply, true)}');
    });

    it('uploads comment photos through the existing Cloudinary pipeline', () => {
        expect(hook).toContain('uploadReportPhoto(photo)');
        expect(hook).toContain('commentImageProblem(asset)');
        expect(hook).not.toMatch(/firebase\/storage|api_secret|API_SECRET/);
    });

    it('clears the composer and its photo only after a stored comment or reply', () => {
        expect(community).toContain('commentImage.reset();');
        expect(community).toContain('replyImage.reset();');
        expect(community).toContain('parentCommentId: target.parentCommentId');
    });
});
