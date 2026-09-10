import type { InboxProjection } from './inbox';

export const INBOX_CLIENT_PORT = 'icr:solid-inbox-v1';
export type SnapshotMessage = {
    kind: 'snapshot';
    sequence: number;
    projection: InboxProjection;
};
export type ClientCommand = { kind: 'subscribe' } | { kind: 'refresh' };
