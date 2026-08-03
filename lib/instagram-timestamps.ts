export function parseTimestampMs(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return undefined;
}

export function parseThreadActivityMs(
    thread: Record<string, unknown>,
): number {
    return (
        parseTimestampMs(thread.last_activity_timestamp_ms) ??
        parseTimestampMs(thread.last_activity_at_ms) ??
        parseTimestampMs(thread.last_activity_ms) ??
        0
    );
}
