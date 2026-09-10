import { isNumber, isString, type JsonObject, type JsonValue } from './json.ts';

export function parseTimestampMs(value: JsonValue | undefined): number | undefined {
    if (isNumber(value)) return value;
    if (isString(value) && /^\d+$/.test(value)) return Number(value);
    return undefined;
}

export function parseThreadActivityMs(
    thread: JsonObject,
): number {
    return (
        parseTimestampMs(thread.last_activity_timestamp_ms) ??
        parseTimestampMs(thread.last_activity_at_ms) ??
        parseTimestampMs(thread.last_activity_ms) ??
        0
    );
}
