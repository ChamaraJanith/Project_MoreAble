export function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

export function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_SHORT_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatFriendlyDate(date: Date): string {
    const today = startOfDay(new Date());
    const target = startOfDay(date);

    if (isSameDay(target, today)) {
        return `Today, ${target.getDate()} ${MONTH_SHORT_NAMES[target.getMonth()]} ${target.getFullYear()}`;
    }
    if (isSameDay(target, addDays(today, 1))) {
        return `Tomorrow, ${target.getDate()} ${MONTH_SHORT_NAMES[target.getMonth()]} ${target.getFullYear()}`;
    }
    return `${WEEKDAY_SHORT_NAMES[target.getDay()]}, ${target.getDate()} ${MONTH_SHORT_NAMES[target.getMonth()]} ${target.getFullYear()}`;
}

export interface TimeOfDay {
    hour: number; // 1-12
    minute: number; // 0-59
    period: 'AM' | 'PM';
}

export function formatFriendlyTime(time: TimeOfDay): string {
    return `${time.hour}:${time.minute.toString().padStart(2, '0')} ${time.period}`;
}

// Converts a selected date to the 'YYYY-MM-DD' format the Journey Search API expects.
export function toApiDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Converts a selected 12-hour time to the 24-hour 'HH:MM' format the Journey Search API expects.
export function toApiTimeString(time: TimeOfDay): string {
    let hour24 = time.hour % 12;
    if (time.period === 'PM') {
        hour24 += 12;
    }
    return `${String(hour24).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function parseApiDateString(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

export function parseApiTimeString(value: string): TimeOfDay {
    const [hourStr, minuteStr] = value.split(':');
    const hour24 = Number(hourStr) || 0;
    const minute = Number(minuteStr) || 0;
    const period: TimeOfDay['period'] = hour24 >= 12 ? 'PM' : 'AM';
    const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return { hour, minute, period };
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Minutes since midnight for an 'HH:MM' value, or null when it is unusable.
 *
 * Shared by everything below so "what counts as a readable time" is decided
 * once.
 */
export function apiTimeToMinutes(value: unknown): number | null {
    if (typeof value !== 'string') return null;

    const [hourStr, minuteStr] = value.split(':');
    const hours = Number(hourStr);
    const minutes = Number(minuteStr);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hourStr.trim() === '' || minuteStr === undefined || minuteStr.trim() === '') return null;

    return hours * 60 + minutes;
}

/** Minutes since midnight back to the zero-padded 'HH:MM' the API stores. */
export function minutesToApiTime(totalMinutes: number): string | null {
    if (!Number.isFinite(totalMinutes)) return null;

    // Wrapped rather than clamped: a late trip legitimately runs past midnight,
    // and the project stores a time of day, not a timestamp.
    const wrapped = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

    const hours = Math.floor(wrapped / 60);
    const minutes = wrapped % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Moves an 'HH:MM' time on by a number of minutes, wrapping past midnight.
 *
 * Used to place a passenger's own boarding and alighting times inside a trip
 * whose stored times describe the whole route (MOV-88). Returns null rather than
 * a wrong time when either input is unusable.
 */
export function addMinutesToApiTime(value: string, minutesToAdd: number): string | null {
    const base = apiTimeToMinutes(value);
    if (base === null || !Number.isFinite(minutesToAdd)) return null;

    return minutesToApiTime(base + minutesToAdd);
}

/**
 * Formats a whole number of minutes as e.g. "1h 10m" / "45m" / "2h".
 *
 * The project's single duration format. `formatDurationBetween` delegates here,
 * so a journey duration measured by summing configured stop-to-stop timings
 * (MOV-88) reads exactly like one measured between two clock times — there is
 * no second formatter to drift from this one.
 *
 * Zero is null, matching the long-standing behaviour of
 * `formatDurationBetween`: "0m" tells a passenger nothing useful.
 */
export function formatDurationMinutes(totalMinutes: number | null | undefined): string | null {
    if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes)) return null;
    if (totalMinutes <= 0) return null;

    const whole = Math.round(totalMinutes);
    if (whole === 0) return null;

    const hours = Math.floor(whole / 60);
    const minutes = whole % 60;

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/** Whole minutes between two 'HH:MM' times, treating a wrap as crossing midnight. */
export function minutesBetweenApiTimes(
    departureTime: string,
    arrivalTime: string
): number | null {
    const start = apiTimeToMinutes(departureTime);
    const end = apiTimeToMinutes(arrivalTime);
    if (start === null || end === null) return null;

    return end >= start ? end - start : end + MINUTES_PER_DAY - start;
}

// Formats the gap between two 'HH:MM' times as e.g. "1h 10m" / "45m".
// An arrival earlier than the departure is treated as crossing midnight.
export function formatDurationBetween(
    departureTime: string,
    arrivalTime: string
): string | null {
    return formatDurationMinutes(minutesBetweenApiTimes(departureTime, arrivalTime));
}
