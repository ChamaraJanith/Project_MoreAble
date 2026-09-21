// Where an Activities card leads (MOV-294).
//
// Both destinations live here, rather than inline in the screen, so each has
// one place to change. An ongoing journey opens its live tracking screen
// (MOV-297); a completed one still opens the passenger's ticket and journey
// details — the same screen the Booking tab uses, which MOV-297 leaves alone.

export type ActivityHref =
    | { pathname: '/activities/journey/[bookingId]'; params: { bookingId: string } }
    | { pathname: '/booking/ticket/[bookingId]'; params: { bookingId: string } };

/** The live journey view for an ongoing activity (MOV-297). */
export function ongoingJourneyHref(bookingId: string): ActivityHref {
    return { pathname: '/activities/journey/[bookingId]', params: { bookingId } };
}

/** The details view for a completed activity. */
export function completedJourneyHref(bookingId: string): ActivityHref {
    return { pathname: '/booking/ticket/[bookingId]', params: { bookingId } };
}
