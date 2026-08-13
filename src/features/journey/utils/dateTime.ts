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
