import type { Message } from '../domain.ts';
import { isJsonObject, type JsonValue } from '../json.ts';
import type { EngineError, InboxProjection } from './resources.ts';
import { HISTORY_WINDOW_LIMIT } from './projection-limits.ts';

export type MutationIntent =
    | { type: 'send'; threadId: string; text: string; replyTo?: string }
    | { type: 'pin'; threadId: string; isPinned: boolean }
    | {
          type: 'read';
          threadId: string;
          messageId: string;
          timestampMs: number;
      };

export type MutationCommand = {
    accountId: string;
    accountEpoch: number;
    operationId: string;
    intent: MutationIntent;
};

export type MutationRequest = {
    intent: MutationIntent;
    threadFbid?: string;
    threadIgId?: string;
    viewerId?: string;
    offlineThreadingId: string;
};

export type MutationReceipt =
    | { type: 'send'; threadFbid: string; message: Message }
    | { type: 'pin'; threadFbid: string; isPinned: boolean }
    | {
          type: 'read';
          threadIgId: string;
          messageId: string;
          timestampMs: number;
      };

export type Operation = MutationCommand & {
    request: MutationRequest;
    createdAt: number;
    acceptedRevision: number;
    status:
        | 'queued'
        | 'dispatching'
        | 'succeeded'
        | 'failed'
        | 'outcome_unknown'
        | 'removed';
    attempts: number;
    retryable: boolean;
    error?: EngineError;
    receipt?: MutationReceipt;
    /** A read accepted after the send receipt included its canonical message ID. */
    echoed?: boolean;
};

export type OperationResult =
    | { ok: true; operationId: string; revision: number }
    | { ok: false; operationId: string; error: EngineError };

export const MAX_SEND_TEXT_LENGTH = 1000;
export const ACTIVE_OPERATION_LIMIT = 200;

export function isMutationCommand(
    value: JsonValue | undefined,
): value is MutationCommand {
    if (!isJsonObject(value)) return false;
    return (
        Object.keys(value).every((key) =>
            ['accountId', 'accountEpoch', 'operationId', 'intent'].includes(
                key,
            ),
        ) &&
        'accountId' in value &&
        typeof value.accountId === 'string' &&
        value.accountId.trim().length > 0 &&
        'operationId' in value &&
        typeof value.operationId === 'string' &&
        value.operationId.trim().length > 0 &&
        'accountEpoch' in value &&
        typeof value.accountEpoch === 'number' &&
        Number.isSafeInteger(value.accountEpoch) &&
        value.accountEpoch >= 0 &&
        'intent' in value &&
        isMutationIntent(value.intent)
    );
}

export function isMutationIntent(
    value: JsonValue | undefined,
): value is MutationIntent {
    if (!isJsonObject(value)) return false;
    if (
        !('type' in value) ||
        !('threadId' in value) ||
        typeof value.threadId !== 'string' ||
        !value.threadId.trim()
    )
        return false;

    switch (value.type) {
        case 'send':
            return (
                Object.keys(value).every((key) =>
                    ['type', 'threadId', 'text', 'replyTo'].includes(key),
                ) &&
                'text' in value &&
                typeof value.text === 'string' &&
                value.text.trim().length > 0 &&
                value.text.length <= MAX_SEND_TEXT_LENGTH &&
                (!('replyTo' in value) ||
                    value.replyTo === undefined ||
                    (typeof value.replyTo === 'string' &&
                        value.replyTo.trim().length > 0))
            );
        case 'pin':
            return (
                Object.keys(value).every((key) =>
                    ['type', 'threadId', 'isPinned'].includes(key),
                ) &&
                'isPinned' in value &&
                typeof value.isPinned === 'boolean'
            );
        case 'read':
            return (
                Object.keys(value).every((key) =>
                    ['type', 'threadId', 'messageId', 'timestampMs'].includes(
                        key,
                    ),
                ) &&
                'messageId' in value &&
                typeof value.messageId === 'string' &&
                !!value.messageId.trim() &&
                'timestampMs' in value &&
                typeof value.timestampMs === 'number' &&
                Number.isFinite(value.timestampMs)
            );
        default:
            return false;
    }
}

export function sameMutationIntent(
    a: MutationIntent,
    b: MutationIntent,
): boolean {
    if (a.type !== b.type || a.threadId !== b.threadId) return false;
    switch (a.type) {
        case 'send':
            return (
                b.type === 'send' &&
                a.text === b.text &&
                a.replyTo === b.replyTo
            );
        case 'pin':
            return b.type === 'pin' && a.isPinned === b.isPinned;
        case 'read':
            return (
                b.type === 'read' &&
                a.messageId === b.messageId &&
                a.timestampMs === b.timestampMs
            );
    }
}

/** Settled aliases are retained for the most recent 200 sends per account. */
export const SETTLED_SEND_ALIAS_LIMIT = 200;

/** Active records are acceptance-bounded; only the latest settled send aliases stay visible. */
export function retainRuntimeOperations(
    operations: readonly Operation[],
): Operation[] {
    const ordered = [...operations].sort(
        (a, b) =>
            a.acceptedRevision - b.acceptedRevision ||
            a.createdAt - b.createdAt,
    );
    const aliases = new Set(
        ordered
            .filter(
                (operation) =>
                    operation.status === 'succeeded' &&
                    operation.receipt?.type === 'send',
            )
            .slice(-SETTLED_SEND_ALIAS_LIMIT)
            .map((operation) => operation.operationId),
    );
    return ordered.filter(
        (operation) =>
            operation.status !== 'removed' &&
            (operation.status !== 'succeeded' ||
                aliases.has(operation.operationId)),
    );
}

export function projectOperations(
    projection: InboxProjection,
    operations: readonly Operation[],
): InboxProjection {
    const byId = new Map(
        (projection.operations ?? []).map((operation) => [
            operation.operationId,
            operation,
        ]),
    );
    for (const operation of operations) {
        const existing = byId.get(operation.operationId);
        if (existing?.acceptedRevision && !operation.acceptedRevision) continue;
        byId.set(operation.operationId, operation);
    }

    const ordered = [...byId.values()]
        .filter((operation) => operation.accountId === projection.accountId)
        .sort(
            (a, b) =>
                (a.acceptedRevision || Number.MAX_SAFE_INTEGER) -
                    (b.acceptedRevision || Number.MAX_SAFE_INTEGER) ||
                a.createdAt - b.createdAt ||
                a.operationId.localeCompare(b.operationId),
        );
    const settled = ordered.filter(
        (operation) =>
            operation.status === 'succeeded' &&
            operation.intent.type === 'send',
    );
    const aliases = new Set(
        settled
            .slice(-SETTLED_SEND_ALIAS_LIMIT)
            .map((operation) => operation.operationId),
    );
    const entities = {
        ...projection.entities,
        threadsById: { ...projection.entities.threadsById },
        messagesById: { ...projection.entities.messagesById },
    };
    const histories = { ...projection.histories };
    const latestCanonicalTimestamp = new Map(
        Object.entries(projection.histories).map(([threadId, history]) => [
            threadId,
            history.orderedIds.reduce((latest, id) => {
                const message = projection.entities.messagesById[id];
                return message && (!message.delivery || message.serverId)
                    ? Math.max(latest, message.ts)
                    : latest;
            }, -Infinity),
        ]),
    );

    for (const operation of ordered) {
        const intent = operation.intent;
        const thread = entities.threadsById[intent.threadId];
        if (operation.status === 'removed') continue;
        if (operation.status === 'succeeded' && intent.type !== 'send')
            continue;
        if (intent.type !== 'send' && operation.status === 'failed') continue;
        if (intent.type === 'pin' && thread) {
            entities.threadsById[intent.threadId] = {
                ...thread,
                serverIsPin: intent.isPinned,
                pinOrder: intent.isPinned
                    ? operation.acceptedRevision || Number.MAX_SAFE_INTEGER
                    : undefined,
            };
        } else if (intent.type === 'read' && thread) {
            if (intent.timestampMs >= (thread.readWatermarkMs ?? -Infinity)) {
                entities.threadsById[intent.threadId] = {
                    ...thread,
                    readWatermarkMs: intent.timestampMs,
                    readWatermarkMessageId: intent.messageId,
                };
            }
        } else if (intent.type === 'send') {
            if (
                operation.status === 'succeeded' &&
                (!aliases.has(operation.operationId) ||
                    operation.receipt?.type !== 'send')
            )
                continue;
            const id = `operation:${operation.operationId}`;
            const receipt =
                operation.receipt?.type === 'send'
                    ? operation.receipt.message
                    : undefined;
            const message: Message = {
                ...(receipt ?? {
                    kind: 'text',
                    text: intent.text,
                    senderId: operation.request.viewerId ?? '',
                    ts: operation.createdAt,
                    repliedTo: intent.replyTo,
                }),
                id,
                delivery: {
                    operationId: operation.operationId,
                    status: operation.status,
                    retryable: operation.retryable,
                },
            };
            if (receipt) message.serverId = receipt.id;
            if (operation.error && message.delivery)
                message.delivery.error = operation.error;
            entities.messagesById[id] = message;
            if (receipt) delete entities.messagesById[receipt.id];
            for (const [threadId, history] of Object.entries(histories)) {
                if (threadId !== intent.threadId) continue;
                const ids = history.orderedIds.map((key) =>
                    key === receipt?.id ? id : key,
                );
                if (
                    !ids.includes(id) &&
                    !history.cachedNewer &&
                    !history.newerCoverageAvailable &&
                    (operation.status !== 'succeeded' ||
                        (!operation.echoed &&
                            message.ts >=
                                latestCanonicalTimestamp.get(threadId)!))
                )
                    ids.push(id);
                histories[threadId] = {
                    ...history,
                    orderedIds:
                        history.cachedNewer || history.newerCoverageAvailable
                            ? [...new Set(ids)]
                            : [...new Set(ids)].slice(-HISTORY_WINDOW_LIMIT),
                };
            }
            if (
                thread &&
                ((thread.lastActivityMs <= message.ts && !operation.echoed) ||
                    thread.lastMessageId === receipt?.id ||
                    thread.lastMessageId === id)
            )
                entities.threadsById[intent.threadId] = {
                    ...thread,
                    lastMessageId: id,
                    lastActivityMs: Math.max(thread.lastActivityMs, message.ts),
                };
        }
    }

    for (const [id, thread] of Object.entries(entities.threadsById)) {
        if (
            thread.readWatermarkMs !== undefined &&
            (thread.lastActivityMs < thread.readWatermarkMs ||
                (thread.lastActivityMs === thread.readWatermarkMs &&
                    thread.lastMessageId !== undefined &&
                    thread.readWatermarkMessageId !== undefined &&
                    (entities.messagesById[thread.lastMessageId]?.serverId ??
                        thread.lastMessageId) ===
                        (entities.messagesById[thread.readWatermarkMessageId]
                            ?.serverId ?? thread.readWatermarkMessageId)))
        )
            entities.threadsById[id] = { ...thread, isUnread: false };
    }

    const orderedIds = [...projection.inbox.orderedIds].sort((a, b) => {
        const left = entities.threadsById[a];
        const right = entities.threadsById[b];
        if (!left || !right) return 0;
        return (
            Number(right.serverIsPin) - Number(left.serverIsPin) ||
            (left.serverIsPin && right.serverIsPin
                ? (right.pinOrder ?? 0) - (left.pinOrder ?? 0)
                : 0) ||
            right.lastActivityMs - left.lastActivityMs
        );
    });
    return {
        ...projection,
        entities,
        histories,
        inbox: { ...projection.inbox, orderedIds },
        operations: retainRuntimeOperations(ordered),
    };
}
