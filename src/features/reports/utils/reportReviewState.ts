/**
 * The review page as a state machine (MOV-160).
 *
 * A review is not a form that is filled in and submitted. It is a report that
 * is read, decided once, and then re-read — and the awkward parts are all about
 * time: two presses of Verify must not become two requests, a decision must not
 * appear on screen before the server has recorded it, and a report that another
 * admin decided a second earlier has to stop offering a decision.
 *
 * All of that lives in a reducer rather than in the component for the reason
 * this project already gives: Jest here is node-only with no React renderer, so
 * a reducer can be tested and a heap of `useState` calls cannot.
 *
 * Nothing here invents a status. What the page shows after a decision is the
 * report the API returned, not the report on screen with a field changed
 * locally — the second would be a claim about what the server stored rather
 * than a reading of it.
 */

import { ReportCommentRecord, ReportReviewAction } from '../../../entities/report/model/types';
import {
    AdminReviewReport,
    canDecideReport,
    isSubmittableRemark,
} from './reportReview';

/** Where the page has got to. */
export type ReviewLoadStatus = 'loading' | 'ready' | 'failed' | 'missing';

export interface ReportReviewState {
    status: ReviewLoadStatus;
    /** The report under review, or null until one has been read. */
    report: AdminReviewReport | null;
    /** The community thread, newest first, as the review endpoint returned it. */
    comments: ReportCommentRecord[];
    /** Why the report could not be read, or null. Never an action failure. */
    loadError: string | null;
    /**
     * The action currently in flight.
     *
     * Doubles as the guard against a second submission and as the button to
     * draw busy: there is no separate `isSubmitting` flag that could fall out
     * of step with which action is actually running.
     */
    pendingAction: ReportReviewAction | null;
    /** Why the last action failed, or null. Never a load failure. */
    actionError: string | null;
    /** What just succeeded, in the API's own words. Cleared on the next action. */
    successMessage: string | null;
}

export const initialReviewState: ReportReviewState = {
    status: 'loading',
    report: null,
    comments: [],
    loadError: null,
    pendingAction: null,
    actionError: null,
    successMessage: null,
};

export type ReviewPageAction =
    | { type: 'loadStarted' }
    | { type: 'loadSucceeded'; report: AdminReviewReport; comments: ReportCommentRecord[] }
    | { type: 'loadFailed'; message: string }
    | { type: 'reportMissing' }
    | { type: 'actionStarted'; action: ReportReviewAction }
    | { type: 'actionSucceeded'; report: AdminReviewReport; message: string }
    | { type: 'actionFailed'; message: string };

export function reportReviewReducer(
    state: ReportReviewState,
    action: ReviewPageAction
): ReportReviewState {
    switch (action.type) {
        // A fresh read, on opening the report and again after a decision.
        //
        // The report already on screen is deliberately kept: the reload that
        // follows a successful action would otherwise blank the page and redraw
        // it, which reads as something having gone wrong rather than as the
        // decision that was just confirmed. Only the errors are cleared.
        case 'loadStarted':
            return {
                ...state,
                status: 'loading',
                loadError: null,
            };

        case 'loadSucceeded':
            return {
                ...state,
                status: 'ready',
                report: action.report,
                comments: action.comments,
                loadError: null,
            };

        // The report already on screen is kept, and the message is drawn above
        // it. A refresh that did not come back is a reason to say so, not a
        // reason to throw away a report that was read perfectly well a moment
        // ago — and on the FIRST load there is no report to keep, so the screen
        // falls through to its error state exactly as before.
        case 'loadFailed':
            return {
                ...state,
                status: 'failed',
                loadError: action.message,
                pendingAction: null,
            };

        // Deleted, or never there. Distinct from a failure because there is
        // nothing to retry — "we could not load it" and "it is gone" are
        // different facts, and only one of them offers Try Again.
        case 'reportMissing':
            return {
                ...state,
                status: 'missing',
                report: null,
                comments: [],
                loadError: null,
                pendingAction: null,
            };

        // The button goes busy and the report stays exactly as it was, so
        // nothing on screen moves on the strength of a press alone.
        case 'actionStarted':
            return {
                ...state,
                pendingAction: action.action,
                actionError: null,
                successMessage: null,
            };

        // What is drawn afterwards is the report the API returned — including
        // its status, which is the server's answer to what the action meant.
        case 'actionSucceeded':
            return {
                ...state,
                status: 'ready',
                report: action.report,
                pendingAction: null,
                actionError: null,
                successMessage: action.message,
            };

        // The decision did not happen, so the report is left as it was. Showing
        // it as verified here would tell the admin their decision was recorded
        // when it was not.
        case 'actionFailed':
            return {
                ...state,
                pendingAction: null,
                actionError: action.message,
                successMessage: null,
            };

        default:
            return state;
    }
}

// ------------------------------------------------------------------
// Guards
//
// Every one of these answers "should this press send a request", and each says
// no for a reason the screen can also draw as a disabled control. They are the
// reason a double press cannot become two decisions.
//
// What they deliberately do NOT require is `status === 'ready'`. The report is
// kept on screen while it refreshes and after a refresh that failed, and the
// screen draws the whole page — remark box and buttons included — whenever it
// holds a report. Gating on 'ready' therefore produced a page that looked
// entirely normal, with the admin's remark sitting in the box and Save Remark
// on screen, whose controls quietly did nothing: the reload that runs on every
// focus and after every action was enough to disable them, and a reload that
// never came back disabled them for good. Having a report and nothing in
// flight is what actually makes an action sendable, so that is what they ask.
// ------------------------------------------------------------------

/**
 * Whether pressing Verify or Reject should send anything.
 *
 * Three reasons not to. Something is already in flight, and a second request
 * would race it. The report has not been read yet, so there is nothing to
 * decide. Or it has already been decided — the API answers 409, and the
 * decision is a record rather than a setting.
 */
export function shouldSendDecision(state: ReportReviewState): boolean {
    if (state.pendingAction !== null) return false;
    if (!state.report || state.status === 'missing') return false;

    return canDecideReport(state.report);
}

/**
 * Whether the remark composer should be sending what is in it.
 *
 * A remark carries no decision, so unlike Verify and Reject it stays available
 * on a report that has already been decided — what it will not send is blank
 * space, or a second copy of a remark still on its way.
 */
export function shouldSendRemark(state: ReportReviewState, draft: string): boolean {
    if (state.pendingAction !== null) return false;
    if (!state.report || state.status === 'missing') return false;

    return isSubmittableRemark(draft);
}

/** Whether this particular action is the one currently in flight. */
export function isActionPending(
    state: ReportReviewState,
    action: ReportReviewAction
): boolean {
    return state.pendingAction === action;
}

/** Whether anything at all is in flight — what disables every other control. */
export function isReviewBusy(state: ReportReviewState): boolean {
    return state.pendingAction !== null;
}

/**
 * The remark to show in the composer when the page opens.
 *
 * A report that has already been remarked on opens with that text, so an admin
 * revisiting a decision sees what was written rather than an empty box beside a
 * remark displayed above it.
 */
export function initialRemarkDraft(report: AdminReviewReport | null): string {
    return report?.review?.adminRemark ?? report?.adminRemark ?? '';
}
