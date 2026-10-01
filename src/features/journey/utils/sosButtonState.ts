// What SOSButton shows once triggerSOSAlert has answered.
//
// Kept out of the component so the rule can be tested on its own: the button
// turns to "SOS ACTIVATED" only when the server recorded the SOS
// (`success: true`). Anything else — a failure, a thrown error, an answer of
// the wrong shape — leaves the button ready to try again and shows why the SOS
// was not sent.

export const SOS_NOT_SENT_MESSAGE = 'Your SOS was NOT sent. Please try again or call for help directly.';

export interface SOSButtonState {
    activated: boolean;
    errorMessage: string;
}

/** The button state for what triggerSOSAlert returned. */
export function sosButtonStateFor(result: unknown): SOSButtonState {
    const outcome = result as { success?: unknown; message?: unknown } | null | undefined;

    if (outcome?.success === true) {
        return { activated: true, errorMessage: '' };
    }

    // Only a real failure's own message is shown; an answer of any other shape
    // could say anything, so it gets the plain "not sent".
    const message =
        outcome?.success === false && typeof outcome.message === 'string' ? outcome.message.trim() : '';
    return { activated: false, errorMessage: message || SOS_NOT_SENT_MESSAGE };
}

/** The button state when triggerSOSAlert itself threw. */
export function sosButtonStateForError(error: unknown): SOSButtonState {
    const message = error instanceof Error ? error.message.trim() : '';
    return {
        activated: false,
        errorMessage: message ? `${message} ${SOS_NOT_SENT_MESSAGE}` : SOS_NOT_SENT_MESSAGE,
    };
}
