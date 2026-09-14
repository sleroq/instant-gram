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
    | { kind: 'subscribe'; threadId?: string }
    | { kind: 'refresh' }
    | { kind: 'load-more-inbox' }
    | { kind: 'refresh-history'; threadId: string }
    | { kind: 'load-older-history'; threadId: string };

type CommandCandidate = { kind?: unknown; threadId?: unknown };

export function isClientCommand<T>(value: T): value is T & ClientCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    // SAFETY: the object and its JSON-compatible fields are checked below before use.
    const item = value as CommandCandidate;
    if (typeof item.kind !== 'string') return false;
    const keys = Object.keys(item);
    if (item.kind === 'subscribe') {
        return (
            keys.length === 1 ||
            (keys.length === 2 &&
                typeof item.threadId === 'string' &&
                item.threadId.length > 0)
        );
    }
    if (item.kind === 'refresh' || item.kind === 'load-more-inbox')
        return keys.length === 1;
    return (
        (item.kind === 'refresh-history' ||
            item.kind === 'load-older-history') &&
        keys.length === 2 &&
        typeof item.threadId === 'string' &&
        item.threadId.length > 0
    );
}
