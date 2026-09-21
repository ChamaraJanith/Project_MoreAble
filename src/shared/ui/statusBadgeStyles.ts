import { StyleSheet } from 'react-native';

// The "active" status badge colours, shared by every badge that should read
// like a CONFIRMED booking: the Bookings tab's CONFIRMED badge, and the
// Activities Ongoing / Completed badges (MOV-297). Moved here unchanged from
// the Bookings screen so the badges cannot drift apart.
export const statusBadgeStyles = StyleSheet.create({
    /** Badge background, e.g. CONFIRMED on the Bookings tab. */
    active: {
        backgroundColor: '#D1FAE5',
    },
    /** Badge text (and icon colour, via `color`). */
    activeText: {
        color: '#065F46',
    },
});
