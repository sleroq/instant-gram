export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | JsonObject;

export type JsonObject = { [key: string]: JsonValue | undefined };

export function parseJson(text: string): JsonValue {
    // SAFETY: JSON.parse validates JSON syntax and produces only JSON primitive/array/object values.
    return JSON.parse(text) as JsonValue;
}

export function isJsonObject(
    value: JsonValue | undefined,
): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: JsonValue | undefined): value is string {
    return typeof value === 'string';
}

export function isNumber(value: JsonValue | undefined): value is number {
    return typeof value === 'number';
}

export function isBoolean(value: JsonValue | undefined): value is boolean {
    return typeof value === 'boolean';
}
