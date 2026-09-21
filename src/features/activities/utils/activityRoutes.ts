// Where an Activities card leads (MOV-294).
//
// Every destination lives here, rather than inline in the screens, so each has
// one place to change. An ongoing journey opens its live tracking screen
// (MOV-297). A completed one with a recorded completion opens its journey
// summary (MOV-297); one finished before completions were recorded has no such
// record and still opens the passenger's ticket — the Booking tab's screen,
// which MOV-297 leaves alone.

export type ActivityHref =
    | { pathname: '/activities/journey/[bookingId]'; params: { bookingId: string } }
    | { pathname: '/activities/completed/[bookingId]'; params: { bookingId: string } }
    | { pathname: '/booking/ticket/[bookingId]'; params: { bookingId: string } };

/** The Activities list, opened on its Ongoing tab (MOV-297 "Back to Ongoing"). */
export function ongoingActivitiesHref() {
    return { pathname: '/activities', params: { tab: 'ongoing' } } as const;
}

/** The live journey view for an ongoing activity (MOV-297). */
export function ongoingJourneyHref(bookingId: string): ActivityHref {
    return { pathname: '/activities/journey/[bookingId]', params: { bookingId } };
}

/** The summary of a journey whose completion was recorded (MOV-297). */
export function completedJourneyDetailsHref(bookingId: string): ActivityHref {
    return { pathname: '/activities/completed/[bookingId]', params: { bookingId } };
}

/** The details view for a completed activity with no recorded completion. */
export function completedJourneyHref(bookingId: string): ActivityHref {
    return { pathname: '/booking/ticket/[bookingId]', params: { bookingId } };
}
