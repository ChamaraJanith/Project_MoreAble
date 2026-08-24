/**
 * Formatting helpers shared by the accessibility report screens.
 */

/** e.g. "20 Aug 2026 · 14:05". Returns the raw value when it is unparseable. */
export function formatReportDateTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return value;

    const day = date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
    const time = date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return `${day} · ${time}`;
}

/** "1 photo" / "3 photos" — keeps the pluralisation in one place. */
export function formatPhotoCount(count: number): string {
    return `${count} photo${count === 1 ? '' : 's'}`;
}

/**
 * The wording for a stored status.
 *
 * StatusBadge already draws these on screen, but it is a react-native
 * component and the modules that derive what a screen shows have to stay
 * renderer-free — and a screen reader announcing "status PENDING" is reading a
 * database value aloud. An unknown status falls back to itself rather than to a
 * guess, so a state the backend introduces later still reads as something.
 */
const STATUS_LABELS: Record<string, string> = {
    PENDING: 'Pending',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected',
    REVIEWED: 'Reviewed',
    RESOLVED: 'Resolved',
};

export function reportStatusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}
