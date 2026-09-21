// Where an Activities card leads (MOV-294).
//
// Both destinations live here, rather than inline in the screen, so the next
// step has one place to change. Until the dedicated ongoing-journey tracking
// screen exists (MOV-297), an ongoing journey opens the passenger's existing
// ticket and journey details — the same screen the Booking tab uses.

export interface ActivityHref {
    pathname: '/booking/ticket/[bookingId]';
    params: { bookingId: string };
}

/** The journey view for an ongoing activity. MOV-297 repoints this to live tracking. */
export function ongoingJourneyHref(bookingId: string): ActivityHref {
    return { pathname: '/booking/ticket/[bookingId]', params: { bookingId } };
}

/** The details view for a completed activity. */
export function completedJourneyHref(bookingId: string): ActivityHref {
    return { pathname: '/booking/ticket/[bookingId]', params: { bookingId } };
}
