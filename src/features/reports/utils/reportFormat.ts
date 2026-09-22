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

/**
 * How long ago a report was filed, for the compact card footer: "Just now",
 * "5m ago", "2h ago", "3d ago" — and the full date once it is over a week old,
 * where "23d ago" is harder to place than the date itself.
 *
 * `now` is a parameter so the wording can be tested against a fixed moment.
 * An unparseable value, or one in the future, falls back to the full date.
 */
export function formatRelativeReportTime(value: string, now: Date = new Date()): string {
    const time = new Date(value).getTime();

    if (Number.isNaN(time)) return value;

    const elapsedMs = now.getTime() - time;

    if (elapsedMs < 0) return formatReportDateTime(value);

    const minutes = Math.floor(elapsedMs / 60_000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);

    if (days < 7) return `${days}d ago`;

    return formatReportDateTime(value);
}

/** The words for a report's type, as its badge and the success receipt show it. */
const REPORT_TYPE_LABELS = {
    ISSUE: 'Accessibility Issue',
    POSITIVE: 'Positive Feedback',
} as const;

export function reportTypeLabel(type: 'ISSUE' | 'POSITIVE'): string {
    return REPORT_TYPE_LABELS[type];
}
