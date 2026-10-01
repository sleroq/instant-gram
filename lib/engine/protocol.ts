import type { InboxProjection } from './inbox.ts';
import type { JsonValue } from '../json.ts';

export const INBOX_CLIENT_PORT = 'icr:solid-inbox-v2';
/** JSON values are the only values accepted by the client command boundary. */
export type ClientCommandInput = JsonValue;
export type SnapshotMessage = {
    kind: 'snapshot';
    sequence: number;
    projection: InboxProjection;
};
export type ClientCommand =
    | { kind: 'subscribe'; threadId?: string; anchorId?: string }
    | { kind: 'refresh' }
    | { kind: 'load-more-inbox' }
    | { kind: 'refresh-history'; threadId: string; anchorId?: string }
    | { kind: 'load-older-history'; threadId: string }
    | { kind: 'load-newer-history'; threadId: string };

type CommandCandidate = {
    kind?: unknown;
    threadId?: unknown;
    anchorId?: unknown;
};

export function isClientCommand<T>(value: T): value is T & ClientCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    // SAFETY: the object and its JSON-compatible fields are checked below before use.
    const item = value as CommandCandidate;
    if (typeof item.kind !== 'string') return false;
    const keys = Object.keys(item);
    if (item.kind === 'refresh' || item.kind === 'load-more-inbox')
        return keys.length === 1;
    const hasThread =
        typeof item.threadId === 'string' && item.threadId.length > 0;
    const hasAnchor =
        typeof item.anchorId === 'string' && item.anchorId.length > 0;
    if (item.kind === 'subscribe' || item.kind === 'refresh-history') {
        if (item.kind === 'subscribe' && keys.length === 1) return true;
        return (
            hasThread &&
            (keys.length === 2 || (keys.length === 3 && hasAnchor)) &&
            keys.every((key) => ['kind', 'threadId', 'anchorId'].includes(key))
        );
    }
    return (
        (item.kind === 'load-older-history' ||
            item.kind === 'load-newer-history') &&
        keys.length === 2 &&
        hasThread &&
        keys.every((key) => ['kind', 'threadId'].includes(key))
    );
}
