export function normalizeLocation(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}