// Journey dates and times in MoreAble service time (MOV-309).
//
// Timetables run on Sri Lanka local time (UTC+05:30, no DST), and the journey
// lifecycle decides a run's service day by that clock (journeyLifecycle). So a
// passenger sees a journey's scheduled and actual times — and the service date,
// the calendar date of its scheduled departure — on that same clock, wherever
// their phone is and whatever time zone it is set to.
//
// Each function takes a stored ISO 8601 instant, moves it onto the service
// clock by SERVICE_UTC_OFFSET_MINUTES and reads the UTC fields of the result.
// Nothing here reads the device's time zone or the current time, and nothing
// is ever filled in: a missing or unreadable instant is null, for the screen to
// show as unavailable.

import { formatFriendlyTime, MONTH_SHORT_NAMES, WEEKDAY_SHORT_NAMES } from '../../features/journey/utils/dateTime';
import { SERVICE_UTC_OFFSET_MINUTES } from './journeyLifecycle';

const SERVICE_OFFSET_MS = SERVICE_UTC_OFFSET_MINUTES * 60 * 1000;

/**
 * An instant needs its own offset ('Z' or '+05:30'): a date-time without one
 * is read in the device's time zone, and a bare date is not an instant.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i;

/** The instant on the service clock (its UTC fields are service wall time), or null. */
function onServiceClock(iso: string | null | undefined): Date | null {
    if (typeof iso !== 'string' || !ISO_INSTANT.test(iso.trim())) return null;

    const time = new Date(iso.trim()).getTime();
    return Number.isNaN(time) ? null : new Date(time + SERVICE_OFFSET_MS);
}

/** The service date of an instant, 'YYYY-MM-DD'; null when missing or unreadable. */
export function serviceDateOf(iso: string | null | undefined): string | null {
    const clock = onServiceClock(iso);
    if (!clock) return null;

    const month = String(clock.getUTCMonth() + 1).padStart(2, '0');
    const day = String(clock.getUTCDate()).padStart(2, '0');
    return `${clock.getUTCFullYear()}-${month}-${day}`;
}

/**
 * The service date of an instant for display, e.g. 'Mon, 21 Sep 2026'; null
 * when missing or unreadable. Always the date itself — never "Today" or
 * "Tomorrow", which would depend on the phone's own clock.
 */
export function formatServiceDate(iso: string | null | undefined): string | null {
    const clock = onServiceClock(iso);
    if (!clock) return null;

    return `${WEEKDAY_SHORT_NAMES[clock.getUTCDay()]}, ${clock.getUTCDate()} ${MONTH_SHORT_NAMES[clock.getUTCMonth()]} ${clock.getUTCFullYear()}`;
}

/** The service clock time of an instant, e.g. '11:30 PM'; null when missing or unreadable. */
export function formatServiceTime(iso: string | null | undefined): string | null {
    const clock = onServiceClock(iso);
    if (!clock) return null;

    const hour24 = clock.getUTCHours();
    return formatFriendlyTime({
        hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
        minute: clock.getUTCMinutes(),
        period: hour24 >= 12 ? 'PM' : 'AM',
    });
}
