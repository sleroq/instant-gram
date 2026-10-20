import { Clock, Effect } from 'effect';
import type { InboxRepositoryEffects } from './db.ts';
import type { InboxProviderEffects } from '../provider/inbox.ts';
import {
    InboxError,
    emptyEntities,
    type InboxProjection,
    type RepositoryRead,
    type EntityFacts,
} from './resources.ts';
import { retainRuntimeOperations } from './operations.ts';
import type {
    MutationCommand,
    MutationRequest,
    Operation,
    OperationResult,
} from './operations.ts';

/** The engine owns identity and its commit lane; this owner owns operation dispatch. */
export function makeOutbox(dependencies: {
    repository: InboxRepositoryEffects;
    provider: InboxProviderEffects;
    current(): InboxProjection;
    verify: Effect.Effect<string, InboxError>;
    commit<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E>;
    fork(work: Effect.Effect<void>): void;
    install(
        operations: Operation[],
        revision: number,
        read?: RepositoryRead,
    ): void;
    storageFailed(): void;
}) {
    const { repository, provider } = dependencies;
    const dispatching = new Set<string>();
    let operations: Operation[] = [];

    function current(accountId: string, epoch: number) {
        const state = dependencies.current();
        return state.accountId === accountId && state.accountEpoch === epoch;
    }

    function install(
        operation: Operation,
        revision: number,
        read?: RepositoryRead,
    ) {
        operations = retainRuntimeOperations([
            ...operations.filter(
                (item) => item.operationId !== operation.operationId,
            ),
            operation,
        ]);
        dependencies.install(operations, revision, read);
    }

    function persist(operation: Operation) {
        const epoch = dependencies.current().accountEpoch;
        const record = operation.error
            ? {
                  ...operation,
                  error: {
                      kind: operation.error.kind,
                      message: operation.error.message,
                  },
              }
            : operation;
        return Effect.map(
            repository.updateOperation(operation.accountId, record),
            (result) => {
                if (current(operation.accountId, epoch))
                    install(result.operation, result.revision, result);
                return result.operation;
            },
        );
    }

    function schedule() {
        const state = dependencies.current();
        if (!state.accountId) return;
        for (const target of new Set(
            operations
                .filter((item) => item.status === 'queued')
                .map((item) => item.intent.threadId),
        )) {
            const accountId = state.accountId;
            const epoch = state.accountEpoch;
            const key = `${accountId}:${epoch}:${target}`;
            if (dispatching.has(key)) continue;
            dispatching.add(key);
            dependencies.fork(
                drain(accountId, epoch, target).pipe(
                    Effect.catch(() =>
                        Effect.sync(() => {
                            if (current(accountId, epoch))
                                dependencies.storageFailed();
                        }),
                    ),
                    Effect.ensuring(Effect.sync(() => dispatching.delete(key))),
                ),
            );
        }
    }

    function settle(
        operation: Operation,
        receipt: NonNullable<Operation['receipt']>,
    ) {
        const entities = emptyEntities();
        const state = dependencies.current();
        const thread = state.entities.threadsById[operation.intent.threadId];
        if (receipt.type === 'send') {
            entities.messagesById[receipt.message.id] = receipt.message;
            if (thread && receipt.message.ts >= thread.lastActivityMs)
                entities.threadsById[thread.key] = {
                    ...thread,
                    lastMessageId: receipt.message.id,
                    lastActivityMs: receipt.message.ts,
                };
        } else if (receipt.type === 'pin' && thread) {
            entities.threadsById[thread.key] = {
                ...thread,
                serverIsPin: receipt.isPinned,
                pinOrder: receipt.isPinned ? operation.acceptedRevision : 0,
            };
        } else if (receipt.type === 'read' && thread) {
            const watermark = Math.max(
                thread.readWatermarkMs ?? 0,
                receipt.timestampMs,
            );
            const watermarkId =
                receipt.timestampMs >= (thread.readWatermarkMs ?? 0)
                    ? receipt.messageId
                    : thread.readWatermarkMessageId;
            entities.threadsById[thread.key] = {
                ...thread,
                readWatermarkMs: watermark,
                readWatermarkMessageId: watermarkId,
                isUnread:
                    thread.isUnread &&
                    !(
                        thread.lastActivityMs < watermark ||
                        (thread.lastActivityMs === watermark &&
                            thread.lastMessageId === watermarkId)
                    ),
            };
        }

        return Effect.map(
            repository.updateOperation(
                operation.accountId,
                {
                    ...operation,
                    status: 'succeeded',
                    receipt,
                    retryable: false,
                    error: undefined,
                },
                { resources: [], entities },
            ),
            (result) => {
                if (current(operation.accountId, state.accountEpoch))
                    install(result.operation, result.revision, result);
            },
        );
    }

    function matches(
        operation: Operation,
        receipt: NonNullable<Operation['receipt']>,
    ) {
        const request = operation.request;
        if (request.intent.type === 'send' && receipt.type === 'send')
            return (
                receipt.threadFbid === request.threadFbid &&
                receipt.message.kind === 'text' &&
                receipt.message.senderId === request.viewerId &&
                receipt.message.text === request.intent.text &&
                !receipt.message.isSyntheticId &&
                receipt.message.id.length > 0 &&
                Number.isFinite(receipt.message.ts) &&
                receipt.message.ts > 0
            );
        if (request.intent.type === 'pin' && receipt.type === 'pin')
            return (
                receipt.threadFbid === request.threadFbid &&
                receipt.isPinned === request.intent.isPinned
            );
        return (
            request.intent.type === 'read' &&
            receipt.type === 'read' &&
            receipt.threadIgId === request.threadIgId &&
            receipt.messageId === request.intent.messageId &&
            receipt.timestampMs === request.intent.timestampMs
        );
    }

    function drain(
        accountId: string,
        epoch: number,
        target: string,
    ): Effect.Effect<void, InboxError> {
        return Effect.gen(function* () {
            while (current(accountId, epoch)) {
                const operation = operations.find(
                    (item) =>
                        item.intent.threadId === target &&
                        item.status === 'queued',
                );
                if (!operation) return;

                const thread =
                    dependencies.current().entities.threadsById[target];
                if (
                    operation.intent.type === 'read' &&
                    operation.request.threadIgId &&
                    thread?.readWatermarkMs === operation.intent.timestampMs &&
                    thread.readWatermarkMessageId === operation.intent.messageId
                ) {
                    const receipt = {
                        type: 'read' as const,
                        threadIgId: operation.request.threadIgId,
                        messageId: operation.intent.messageId,
                        timestampMs: operation.intent.timestampMs,
                    };
                    yield* dependencies.commit(
                        Effect.suspend(() =>
                            current(accountId, epoch)
                                ? settle(operation, receipt)
                                : Effect.void,
                        ),
                    );
                    continue;
                }

                const identity = yield* Effect.result(dependencies.verify);
                if (!current(accountId, epoch)) return;
                if (identity._tag === 'Failure') {
                    yield* dependencies.commit(
                        persist({
                            ...operation,
                            status: 'failed',
                            retryable: true,
                            error: identity.failure,
                        }),
                    );
                    continue;
                }
                const attempted = yield* dependencies.commit(
                    Effect.suspend(() => {
                        if (!current(accountId, epoch))
                            return Effect.succeed(undefined);
                        return persist({
                            ...operation,
                            status: 'dispatching',
                            attempts: operation.attempts + 1,
                            retryable: false,
                            error: undefined,
                        });
                    }),
                );
                if (!attempted || !current(accountId, epoch)) return;
                const result = yield* Effect.result(
                    provider.mutate(accountId, attempted.request),
                );
                if (!current(accountId, epoch)) return;
                yield* dependencies.commit(
                    Effect.suspend(() => {
                        if (!current(accountId, epoch)) return Effect.void;
                        if (
                            result._tag === 'Success' &&
                            matches(attempted, result.success)
                        )
                            return settle(attempted, result.success);
                        const error =
                            result._tag === 'Failure'
                                ? result.failure
                                : new InboxError('unknown_outcome');
                        const retryable =
                            [
                                'provider_unavailable',
                                'auth',
                                'offline',
                                'rate_limited',
                            ].includes(error.kind) ||
                            (attempted.intent.type !== 'send' &&
                                error.kind === 'unknown_outcome');
                        return Effect.asVoid(
                            persist({
                                ...attempted,
                                status:
                                    retryable ||
                                    error.kind === 'invalid_request'
                                        ? 'failed'
                                        : 'outcome_unknown',
                                retryable,
                                error,
                            }),
                        );
                    }),
                );
            }
        });
    }

    function requestFor(
        command: MutationCommand,
        createdAt: number,
    ): MutationRequest {
        const state = dependencies.current();
        const thread = state.entities.threadsById[command.intent.threadId];
        if (!thread) throw new InboxError('invalid_request');
        const intent = command.intent;
        const viewerId = state.histories[intent.threadId]?.viewerId;
        if (
            (intent.type === 'send' && (!thread.threadFbid || !viewerId)) ||
            (intent.type === 'pin' && !thread.threadFbid) ||
            (intent.type === 'read' && !thread.threadIgId)
        )
            throw new InboxError('invalid_request');

        if (intent.type === 'send' && intent.replyTo) {
            const history = state.histories[intent.threadId];
            const message = state.entities.messagesById[intent.replyTo];
            const acceptedReply = operations.some(
                (operation) =>
                    operation.intent.threadId === intent.threadId &&
                    operation.status === 'succeeded' &&
                    operation.receipt?.type === 'send' &&
                    operation.receipt.message.id === intent.replyTo,
            );
            if (
                (!history?.orderedIds.includes(intent.replyTo) &&
                    !acceptedReply) ||
                (!message && !acceptedReply) ||
                message?.isSyntheticId
            )
                throw new InboxError('invalid_request');
        }
        if (intent.type === 'read') {
            const seen = state.entities.messagesById[intent.messageId];
            const belongsToThread =
                thread.lastMessageId === intent.messageId ||
                state.histories[intent.threadId]?.orderedIds.includes(
                    intent.messageId,
                );
            if (
                !belongsToThread ||
                !seen ||
                seen.isSyntheticId ||
                seen.ts !== intent.timestampMs
            )
                throw new InboxError('invalid_request');
        }

        return {
            intent,
            threadFbid: thread.threadFbid,
            threadIgId: thread.threadIgId,
            viewerId,
            offlineThreadingId: (
                (BigInt(createdAt) << 22n) |
                BigInt(crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffff)
            ).toString(),
        };
    }

    function resultOf(
        operationId: string,
        work: Effect.Effect<{ revision: number }, InboxError>,
    ): Effect.Effect<OperationResult> {
        return Effect.match(work, {
            onSuccess: ({ revision }) => ({
                ok: true as const,
                operationId,
                revision,
            }),
            onFailure: (error) => ({
                ok: false as const,
                operationId,
                error: { kind: error.kind, message: error.message },
            }),
        });
    }

    function accept(command: MutationCommand) {
        const work = Effect.gen(function* () {
            yield* dependencies.verify;
            const createdAt = yield* Clock.currentTimeMillis;
            return yield* dependencies.commit(
                Effect.gen(function* () {
                    if (!current(command.accountId, command.accountEpoch))
                        return yield* Effect.fail(new InboxError('auth'));
                    const previous = operations.find(
                        (operation) =>
                            operation.operationId === command.operationId,
                    );
                    const prepared = yield* Effect.result(
                        Effect.try({
                            try: () =>
                                previous?.request ??
                                requestFor(command, createdAt),
                            catch: () => new InboxError('invalid_request'),
                        }),
                    );
                    const accepted = yield* repository.acceptOperation(
                        command,
                        prepared._tag === 'Success'
                            ? prepared.success
                            : undefined,
                        createdAt,
                    );
                    if (!current(command.accountId, command.accountEpoch))
                        return yield* Effect.fail(new InboxError('auth'));
                    install(accepted.operation, accepted.revision);
                    schedule();
                    return {
                        ...accepted,
                        revision: accepted.operation.acceptedRevision,
                    };
                }),
            );
        });
        return resultOf(command.operationId, work);
    }

    function change(
        accountId: string,
        accountEpoch: number,
        operationId: string,
        action: 'retry' | 'remove',
    ) {
        return resultOf(
            operationId,
            Effect.gen(function* () {
                yield* dependencies.verify;
                return yield* dependencies.commit(
                    Effect.gen(function* () {
                        if (!current(accountId, accountEpoch))
                            return yield* Effect.fail(new InboxError('auth'));
                        const operation = operations.find(
                            (item) => item.operationId === operationId,
                        );
                        if (
                            !operation ||
                            (action === 'retry'
                                ? operation.status !== 'failed' ||
                                  !operation.retryable
                                : !['failed', 'outcome_unknown'].includes(
                                      operation.status,
                                  ))
                        )
                            return yield* Effect.fail(
                                new InboxError('invalid_request'),
                            );
                        const next = yield* persist({
                            ...operation,
                            status: action === 'retry' ? 'queued' : 'removed',
                            retryable: false,
                            error: undefined,
                        });
                        schedule();
                        return {
                            revision: dependencies.current().commitRevision,
                            operation: next,
                        };
                    }),
                );
            }),
        );
    }

    function load(accountId: string, epoch: number) {
        return Effect.gen(function* () {
            const result = yield* repository.readOperations(accountId);
            if (!current(accountId, epoch)) return;
            operations = result.operations;
            dependencies.install(operations, result.revision, {
                resources: [],
                entities: result.entities,
                revision: result.revision,
            });
            for (const operation of operations.filter(
                (item) => item.status === 'dispatching',
            )) {
                const send = operation.intent.type === 'send';
                yield* persist({
                    ...operation,
                    status: send ? 'outcome_unknown' : 'queued',
                    retryable: false,
                    error: send ? new InboxError('unknown_outcome') : undefined,
                });
            }
            schedule();
        });
    }

    /** Called in the engine commit lane after canonical history coverage is installed. */
    function observeHistory(threadId: string, messageIds: readonly string[]) {
        return Effect.gen(function* () {
            const ids = new Set(messageIds);
            for (const operation of operations.filter(
                (item) =>
                    item.intent.threadId === threadId &&
                    item.status === 'succeeded' &&
                    !item.echoed &&
                    item.receipt?.type === 'send' &&
                    ids.has(item.receipt.message.id),
            ))
                yield* persist({ ...operation, echoed: true });
        });
    }

    /** Fresh canonical read state can confirm an earlier uncertain receipt without replay. */
    function observeReads(facts: EntityFacts) {
        return Effect.gen(function* () {
            const epoch = dependencies.current().accountEpoch;
            for (const operation of operations.filter(
                (item) =>
                    item.intent.type === 'read' &&
                    (item.status === 'failed' ||
                        item.status === 'outcome_unknown'),
            )) {
                if (!current(operation.accountId, epoch)) return;
                const intent = operation.intent;
                if (intent.type !== 'read' || !operation.request.threadIgId)
                    continue;
                const thread = facts.threadsById[intent.threadId];
                const message = facts.messagesById[intent.messageId];
                if (
                    thread?.isUnread === false &&
                    thread.lastMessageId === intent.messageId &&
                    message?.ts === intent.timestampMs
                )
                    yield* settle(operation, {
                        type: 'read',
                        threadIgId: operation.request.threadIgId,
                        messageId: intent.messageId,
                        timestampMs: intent.timestampMs,
                    });
            }
        });
    }

    return {
        accept,
        change,
        load,
        observeHistory,
        observeReads,
        clear: () => {
            operations = [];
        },
    };
}
