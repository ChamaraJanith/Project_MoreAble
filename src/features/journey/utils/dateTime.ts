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
