// The Reports tile on the admin dashboard (MOV-131, extended by MOV-134).
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

/** A queue holding exactly these report statuses, in this order. */
function queueOfStatuses(...statuses: string[]) {
    return {
        ok: true as const,
        value: {
            reports: statuses.map((status, index) => ({ reportId: `REP-${index}`, status })),
            flaggedCount: 0,
        },
    };
}

/** The state after reading a queue holding those statuses. */
function loadedStatuses(...statuses: string[]): ReportCountState {
    return reportCountReducer(
        initialReportCountState,
        reportCountAction(queueOfStatuses(...statuses))
    );
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
            'Reports 3. 0 verified. Opens the accessibility report review queue.'
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

// ==================================================================
// The verified total (MOV-134)
//
// The one MOV-134 statistic the Overview did not already state. It is a
// subtotal of the count above it, taken off the same single read, so what
// matters is that the two move together and can never describe different
// queues.
// ==================================================================
describe('the verified total', () => {
    it('counts only the reports an admin upheld', () => {
        const state = loadedStatuses('VERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

        expect(state.count).toBe(4);
        expect(state.verified).toBe(2);
    });

    it('excludes every status that is not a finding the report held', () => {
        const state = loadedStatuses('PENDING', 'REJECTED', 'REVIEWED', 'RESOLVED');

        expect(state.count).toBe(4);
        expect(state.verified).toBe(0);
    });

    it('is 0 rather than absent when nothing has been verified yet', () => {
        // The card renders its breakdown line on `verified !== null`, so a zero
        // has to be a zero — not a missing value that hides the line.
        const state = loadedStatuses('PENDING', 'PENDING');

        expect(state.verified).toBe(0);
        expect(isReportCountLoading(state)).toBe(false);
    });

    it('is not known before anything has been read', () => {
        expect(initialReportCountState.verified).toBeNull();
    });

    it('is dropped alongside the total when the read fails', () => {
        // A stale subtotal under a tile that has stopped being able to confirm
        // it is exactly as wrong as a stale total.
        const state = reportCountReducer(
            loadedStatuses('VERIFIED', 'PENDING'),
            reportCountAction({ ok: false, status: 500, message: 'Server error.' })
        );

        expect(state.count).toBeNull();
        expect(state.verified).toBeNull();
    });

    it('is dropped when there is no admin session to ask with', () => {
        expect(reportCountReducer(initialReportCountState, NO_SESSION_ACTION).verified).toBeNull();
    });

    it('stays on screen while the queue is being re-read', () => {
        const reloading = reportCountReducer(loadedStatuses('VERIFIED', 'PENDING'), {
            type: 'loadStarted',
        });

        // Same rule as the total: a returning admin does not watch a number
        // they can already see blink away and come back.
        expect(reloading.count).toBe(2);
        expect(reloading.verified).toBe(1);
    });

    it('is replaced by the next read rather than added to', () => {
        const afterReload = reportCountReducer(
            loadedStatuses('VERIFIED', 'VERIFIED', 'VERIFIED'),
            reportCountAction(queueOfStatuses('VERIFIED', 'PENDING'))
        );

        expect(afterReload.count).toBe(2);
        expect(afterReload.verified).toBe(1);
    });

    it('never exceeds the total it is a share of', () => {
        const state = loadedStatuses('VERIFIED', 'VERIFIED', 'PENDING', 'REJECTED', 'RESOLVED');

        // Guaranteed by both numbers coming out of one reading of one queue —
        // which is why the verified count is derived here and not fetched.
        expect(state.verified as number).toBeLessThanOrEqual(state.count as number);
    });

    it('is spoken on the tile alongside the total', () => {
        // The card sets an explicit accessibilityLabel, which replaces what its
        // children say, so a number only in the breakdown line would be visible
        // and unreachable.
        expect(reportCountAccessibilityLabel(loadedStatuses('VERIFIED', 'PENDING'))).toBe(
            'Reports 2. 1 verified. Opens the accessibility report review queue.'
        );
    });
});
