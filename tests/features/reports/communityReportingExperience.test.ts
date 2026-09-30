// MOV-305 — the community reporting experience, as the passenger and the admin
// read it: whose comment is whose, what the community feedback section says
// under each kind of report, what the admin review card says about positive
// feedback, which tab offers a Status filter, and what the receipt promises.
//
// Pure helpers first, as the rest of this folder tests them (Jest here is
// node-only with no renderer), then a few source checks that the screens
// actually use them.

import * as fs from 'fs';
import * as path from 'path';
import { AdminReportReview } from '../../../src/entities/report/model/types';
import {
    OWN_COMMENT_LABEL,
    communityFeedbackCopy,
    isOwnComment,
} from '../../../src/features/reports/utils/reportFeedback';
import {
    ADMIN_REMARK_HELPER,
    NO_ADMIN_REVIEW_YET_MESSAGE,
    POSITIVE_FEEDBACK_AUTO_ACCEPTED_NOTE,
    adminReviewStatusNote,
    canDecideReport,
} from '../../../src/features/reports/utils/reportReview';
import {
    DEFAULT_REPORT_FILTERS,
    filtersForScope,
    isStatusFilterAvailable,
} from '../../../src/features/reports/utils/reportSearch';
import { receiptNote } from '../../../src/features/reports/utils/reportSummary';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ------------------------------------------------------------------
// FIX 3 — the viewer's own comments
// ------------------------------------------------------------------
describe('own comment indicator', () => {
    const comment = { passengerId: 'PSG-00001' };

    it('marks a comment written by the signed-in passenger as their own', () => {
        expect(isOwnComment(comment, 'PSG-00001')).toBe(true);
    });

    it("does not mark another passenger's comment", () => {
        expect(isOwnComment(comment, 'PSG-00002')).toBe(false);
    });

    it('marks nothing for a session with no passenger id', () => {
        expect(isOwnComment(comment, null)).toBe(false);
        expect(isOwnComment(comment, undefined)).toBe(false);
        expect(isOwnComment(comment, '')).toBe(false);
    });

    it('never treats a comment with no author as anybody’s', () => {
        expect(isOwnComment({ passengerId: '' }, '')).toBe(false);
        expect(isOwnComment(null, 'PSG-00001')).toBe(false);
    });

    it('labels the viewer’s own comments "You"', () => {
        expect(OWN_COMMENT_LABEL).toBe('You');
    });

    describe('on screen', () => {
        const comments = read('src/features/reports/ui/FeedbackComments.tsx');
        const community = read('src/features/reports/ui/CommunityFeedback.tsx');
        const admin = read('src/features/reports/ui/AdminReportReviewScreen.tsx');

        it('the passenger thread decides each row from the signed-in passenger', () => {
            expect(comments).toContain('isOwn={isOwnComment(comment, viewerPassengerId)}');
            expect(community).toContain('viewerPassengerId={viewerPassengerId}');
            expect(community).toContain('store.user?.passengerId');
        });

        it('the admin thread carries no "You" marker', () => {
            expect(admin).toContain('<CommentRow');
            expect(admin).not.toContain('isOwn=');
        });

        // MOV-306 — comment management replaces the MOV-305 rule that the thread
        // offered no edit, delete or moderation at all.
        it('wires Edit and Delete in the passenger thread only under isOwnComment', () => {
            // The actions are built by one helper that returns nothing at all
            // unless the signed-in passenger wrote the comment...
            expect(comments).toContain('const ownCommentActions = (comment: ReportCommentRecord) => {');
            expect(comments).toContain(
                'if (!isOwnComment(comment, viewerPassengerId)) return {};'
            );
            expect(comments).toContain('onEdit: onStartEdit ?');
            expect(comments).toContain('onDelete: onRequestDelete ?');

            // ...and that helper is the only way they reach a row.
            expect(comments).toContain('{...ownCommentActions(comment)}');
            expect(comments.match(/onEdit: /g)).toHaveLength(1);
            expect(comments.match(/onDelete: /g)).toHaveLength(1);
        });

        it('keeps the "You" chip exactly as it was', () => {
            expect(comments).toContain('{isOwn && (');
            expect(comments).toContain('<Text style={styles.ownChipText}>{OWN_COMMENT_LABEL}</Text>');
        });

        it('gives the admin thread Remove, but no Edit and no "You" marker', () => {
            expect(admin).toContain('onDelete={() => setCommentToRemove(comment)}');
            expect(admin).toContain('deleteLabel="Remove"');
            expect(admin).not.toContain('onEdit');
            expect(admin).not.toContain('isOwn');
        });

        it('confirms a delete with ConfirmDialog on both screens', () => {
            expect(community).toContain('<ConfirmDialog');
            expect(community).toContain('title="Delete Comment"');
            expect(community).toContain(
                'message="Are you sure you want to delete this comment? This cannot be undone."'
            );
            expect(community).toContain('confirmLabel="Delete Comment"');

            expect(admin).toContain('title="Remove Comment?"');
            expect(admin).toContain(
                `message="This permanently removes the comment from the report's discussion."`
            );
            expect(admin).toContain('confirmLabel="Remove Comment"');
        });

        it('marks both ConfirmDialogs destructive', () => {
            const communityDialog = community.slice(community.indexOf('title="Delete Comment"'));
            const adminDialog = admin.slice(admin.indexOf('title="Remove Comment?"'));

            expect(communityDialog.slice(0, 400)).toContain('destructive');
            expect(adminDialog.slice(0, 400)).toContain('destructive');
        });

        it('keeps a comment that failed to post reported under the votes, as before', () => {
            expect(community).toContain(
                '{state.submitError && <FeedbackError message={state.submitError} />}'
            );
            expect(comments).toContain(
                '{commentActionError && <CommentsError message={commentActionError} />}'
            );
        });
    });
});

// ------------------------------------------------------------------
// FIX 4 — the community feedback section's wording
// ------------------------------------------------------------------
describe('community feedback wording', () => {
    it('frames an issue as something the community can back up or question', () => {
        const copy = communityFeedbackCopy('ISSUE');

        expect(copy.intro).toMatch(/issue/i);
        expect(copy.note).toMatch(/accessibility issue/i);
    });

    it('never says positive feedback is being verified or is an issue', () => {
        const copy = communityFeedbackCopy('POSITIVE');
        const text = `${copy.intro} ${copy.note}`;

        expect(text).not.toMatch(/verif/i);
        expect(text).not.toMatch(/issue/i);
        expect(text).not.toMatch(/review/i);
    });

    it('uses different wording for the two kinds of report', () => {
        expect(communityFeedbackCopy('POSITIVE')).not.toEqual(communityFeedbackCopy('ISSUE'));
    });

    it('the details screen hands the report type to the section', () => {
        const details = read('src/features/reports/ui/ReportDetailsScreen.tsx');
        const community = read('src/features/reports/ui/CommunityFeedback.tsx');

        expect(details).toContain('reportType={summary.reportType}');
        expect(community).toContain('communityFeedbackCopy(reportType)');
        expect(community).not.toContain('help verify accessibility issues');
    });
});

// ------------------------------------------------------------------
// FIX 5 — the admin review card on positive feedback
// ------------------------------------------------------------------
describe('admin review card', () => {
    const positive = { type: 'POSITIVE', status: 'PUBLISHED' };
    const issue = { status: 'PENDING' };
    const remarkOnly: AdminReportReview = {
        status: 'PUBLISHED',
        reviewedBy: null,
        reviewedAt: null,
        adminRemark: 'Thanks for sharing.',
    };

    it('says positive feedback was accepted automatically, never that a review is pending', () => {
        expect(adminReviewStatusNote(positive, null)).toBe(POSITIVE_FEEDBACK_AUTO_ACCEPTED_NOTE);
        expect(adminReviewStatusNote(positive, null)).not.toBe(NO_ADMIN_REVIEW_YET_MESSAGE);
    });

    it('draws no decision on positive feedback even once a remark is saved on it', () => {
        expect(adminReviewStatusNote(positive, remarkOnly)).toBe(
            POSITIVE_FEEDBACK_AUTO_ACCEPTED_NOTE
        );
    });

    it('still says an undecided issue has not been reviewed', () => {
        expect(adminReviewStatusNote(issue, null)).toBe(NO_ADMIN_REVIEW_YET_MESSAGE);
    });

    it('draws the recorded decision on a reviewed issue', () => {
        const review: AdminReportReview = {
            status: 'VERIFIED',
            reviewedBy: 'admin-uid',
            reviewedAt: '2026-09-01T10:00:00.000Z',
            adminRemark: null,
        };

        expect(adminReviewStatusNote({ status: 'VERIFIED' }, review)).toBeNull();
    });

    it('keeps Verify and Reject off positive feedback', () => {
        expect(canDecideReport(positive)).toBe(false);
        expect(canDecideReport(issue)).toBe(true);
    });

    it('says a remark is visible to anyone who can view the report', () => {
        expect(ADMIN_REMARK_HELPER).toMatch(/anyone who can view this report/i);
        expect(ADMIN_REMARK_HELPER).not.toMatch(/passenger who filed/i);
    });

    it('the review page uses both', () => {
        const admin = read('src/features/reports/ui/AdminReportReviewScreen.tsx');

        expect(admin).toContain('adminReviewStatusNote(report, report.review)');
        expect(admin).toContain('helper={ADMIN_REMARK_HELPER}');
        expect(admin).not.toContain('Shown to the passenger who filed this report');
    });
});

// ------------------------------------------------------------------
// FIX 6 — the Status filter, by tab
// ------------------------------------------------------------------
describe('status filter availability', () => {
    it('is offered on My Reports', () => {
        expect(isStatusFilterAvailable('my')).toBe(true);
    });

    it('is not offered on the public All Reports feed', () => {
        expect(isStatusFilterAvailable('all')).toBe(false);
    });

    it('drops a status chosen on My Reports when moving to All Reports', () => {
        const filters = { ...DEFAULT_REPORT_FILTERS, status: 'PENDING' as const, type: 'ISSUE' as const };

        expect(filtersForScope(filters, 'all')).toEqual({ ...filters, status: 'ALL' });
    });

    it('keeps every other filter, and keeps the status on My Reports', () => {
        const filters = { ...DEFAULT_REPORT_FILTERS, status: 'REJECTED' as const, routeId: 'R-1' };

        expect(filtersForScope(filters, 'my')).toBe(filters);
        expect(filtersForScope(filters, 'all').routeId).toBe('R-1');
    });

    it('returns the same filters when there is nothing to drop', () => {
        expect(filtersForScope(DEFAULT_REPORT_FILTERS, 'all')).toBe(DEFAULT_REPORT_FILTERS);
    });

    it('the list screen and the sheet follow the rule', () => {
        const list = read('src/features/reports/ui/AccessibilityReportsScreen.tsx');
        const sheet = read('src/features/reports/ui/ReportFilterSheet.tsx');

        expect(list).toContain('showStatusFilter={isStatusFilterAvailable(scope)}');
        expect(list).toContain('filtersForScope(current, next)');
        expect(sheet).toContain('{showStatusFilter && (');
    });
});

// ------------------------------------------------------------------
// FIX 7 — the submission receipt
// ------------------------------------------------------------------
describe('submission receipt note', () => {
    it('tells the author of an issue who can see it and what they can still do', () => {
        const note = receiptNote('ISSUE');

        expect(note).toMatch(/only you can see this report until an administrator verifies it/i);
        expect(note).toMatch(/edit it .* while it is pending/i);
        expect(note).toMatch(/delete it at any time/i);
    });

    it('does not tie deleting an issue to it being pending', () => {
        expect(receiptNote('ISSUE')).not.toMatch(/edit or delete it from My Reports while/i);
    });

    it('tells positive feedback it is public straight away, with no review', () => {
        const note = receiptNote('POSITIVE');

        expect(note).toMatch(/shared with the community straight away/i);
        expect(note).not.toMatch(/verif|review|pending/i);
    });

    it('the receipt screen uses it', () => {
        const receipt = read('src/features/reports/ui/ReportSubmittedView.tsx');

        expect(receipt).toContain('receiptNote(receipt.reportType)');
    });
});
