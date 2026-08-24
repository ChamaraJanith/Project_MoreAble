// The Reports tile on the admin dashboard (MOV-131).
//
// The tile makes one claim — how many accessibility reports exist — and the
// things that can go wrong with it are all about what it says when it does not
// know. Three cases carry the whole feature:
//
//   loading  — nothing read yet, so a spinner and no number at all;
//   empty    — the API answered with zero reports, so "0" and not a dash;
//   failed   — the API refused or could not be reached, so a dash and never a
//              stale number under a tile that has stopped being able to
//              confirm it.
//
// Nothing here is hardcoded and nothing is derived twice: the total is the
// length of what the API returned, and the failure wording is the same
// reviewErrorMessage the review queue itself shows.

import {
    NO_SESSION_ACTION,
    REPORT_COUNT_UNAVAILABLE,
    ReportCountState,
    initialReportCountState,
    isReportCountLoading,
    reportCountAccessibilityLabel,
    reportCountAction,
    reportCountLabel,
    reportCountReducer,
} from '../../../src/features/reports/utils/reportCountState';
import { REVIEW_ERROR_MESSAGES, REVIEW_FALLBACK_MESSAGE } from '../../../src/features/reports/utils/reportReview';

/** A queue of `size` reports, as the API client hands one back. */
function queueOf(size: number) {
    return {
        ok: true as const,
        value: {
            reports: Array.from({ length: size }, (_, index) => ({ reportId: `REP-${index}` })),
            flaggedCount: 0,
        },
    };
}

/** The state after reading a queue of `size` reports. */
function loaded(size: number): ReportCountState {
    return reportCountReducer(initialReportCountState, reportCountAction(queueOf(size)));
}

// ==================================================================
// Loading
// ==================================================================
describe('the loading state', () => {
    it('starts with nothing read, so the tile draws a spinner', () => {
        expect(initialReportCountState.count).toBeNull();
        expect(isReportCountLoading(initialReportCountState)).toBe(true);
        expect(reportCountAccessibilityLabel(initialReportCountState)).toBe('Reports, loading');
    });

    it('keeps the number already on screen while it is being re-read', () => {
        const reloading = reportCountReducer(loaded(7), { type: 'loadStarted' });

        expect(reloading.status).toBe('loading');
        expect(reloading.count).toBe(7);
        // Still a number, not a spinner — a returning admin does not watch a
        // count they can already see blink away and come back.
        expect(isReportCountLoading(reloading)).toBe(false);
        expect(reportCountLabel(reloading)).toBe('7');
    });

    it('clears a previous failure when a fresh read starts', () => {
        const failed = reportCountReducer(initialReportCountState, {
            type: 'loadFailed',
            status: 500,
        });

        expect(reportCountReducer(failed, { type: 'loadStarted' }).error).toBeNull();
    });
});

// ==================================================================
// The count
// ==================================================================
describe('the count', () => {
    it('is the number of reports the API returned', () => {
        const state = loaded(12);

        expect(state.status).toBe('ready');
        expect(state.count).toBe(12);
        expect(reportCountLabel(state)).toBe('12');
        expect(state.error).toBeNull();
    });

    it('shows 0 rather than a dash when there are no reports', () => {
        const state = loaded(0);

        expect(state.count).toBe(0);
        expect(reportCountLabel(state)).toBe('0');
        expect(isReportCountLoading(state)).toBe(false);
        expect(reportCountAccessibilityLabel(state)).toContain('Reports 0');
    });

    it('replaces the previous total rather than adding to it', () => {
        const afterReload = reportCountReducer(loaded(9), reportCountAction(queueOf(4)));

        expect(afterReload.count).toBe(4);
    });

    it('says on the tile that it opens the review queue', () => {
        expect(reportCountAccessibilityLabel(loaded(3))).toBe(
            'Reports 3. Opens the accessibility report review queue.'
        );
    });
});

// ==================================================================
// Failure
// ==================================================================
describe('a failed read', () => {
    it('shows a dash instead of a number', () => {
        const state = reportCountReducer(
            initialReportCountState,
            reportCountAction({ ok: false, message: 'Failed to load reports for review.' })
        );

        expect(state.status).toBe('failed');
        expect(state.count).toBeNull();
        expect(reportCountLabel(state)).toBe(REPORT_COUNT_UNAVAILABLE);
        expect(isReportCountLoading(state)).toBe(false);
    });

    it('drops a stale total rather than leaving it under a tile that cannot confirm it', () => {
        const state = reportCountReducer(
            loaded(5),
            reportCountAction({ ok: false, status: 500, message: 'Server error.' })
        );

        expect(state.count).toBeNull();
        expect(reportCountLabel(state)).toBe(REPORT_COUNT_UNAVAILABLE);
    });

    it('uses the same wording the review queue shows for a refusal', () => {
        const expired = reportCountReducer(
            initialReportCountState,
            reportCountAction({ ok: false, status: 401, message: 'Unauthorized.' })
        );
        const forbidden = reportCountReducer(
            initialReportCountState,
            reportCountAction({ ok: false, status: 403, message: 'Forbidden.' })
        );

        expect(expired.error).toBe(REVIEW_ERROR_MESSAGES[401]);
        expect(forbidden.error).toBe(REVIEW_ERROR_MESSAGES[403]);
    });

    it('falls back to the shared message when the network said nothing useful', () => {
        const state = reportCountReducer(
            initialReportCountState,
            reportCountAction({ ok: false, message: '' })
        );

        expect(state.error).toBe(REVIEW_FALLBACK_MESSAGE);
    });

    it('reads a missing admin session exactly as the API refusing one', () => {
        const state = reportCountReducer(initialReportCountState, NO_SESSION_ACTION);

        expect(state.error).toBe(REVIEW_ERROR_MESSAGES[401]);
        expect(reportCountLabel(state)).toBe(REPORT_COUNT_UNAVAILABLE);
        expect(reportCountAccessibilityLabel(state)).toBe(
            'Reports, count unavailable. Opens the accessibility report review queue.'
        );
    });

    it('recovers on the next successful read', () => {
        const failed = reportCountReducer(initialReportCountState, NO_SESSION_ACTION);
        const recovered = reportCountReducer(failed, reportCountAction(queueOf(2)));

        expect(recovered.status).toBe('ready');
        expect(recovered.count).toBe(2);
        expect(recovered.error).toBeNull();
    });
});
