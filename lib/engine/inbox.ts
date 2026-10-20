import type { Message, Page, Thread } from '../domain.ts';
import {
    Clock,
    Context,
    Deferred,
    Effect,
    Fiber,
    FiberSet,
    Layer,
    Semaphore,
} from 'effect';
import type { InboxRepositoryEffects } from './db.ts';
import { InboxRepositoryService } from './db.ts';
import type { InboxProviderEffects } from '../provider/inbox.ts';
import { InboxProviderService } from '../provider/inbox.ts';
import {
    InboxError,
    emptyEntities,
    emptyResource,
    type EntityFacts,
    type EngineError,
    type InboxErrorKind,
    type InboxProjection,
    type InboxRepository,
    type HistoryProjection,
    type PersistedResource,
    type RepositoryRead,
    type ResourceProjection,
    type ThreadFact,
    type HistoryWindowRequest,
    type HistoryWindowRead,
} from './resources.ts';

export { InboxError, emptyEntities, emptyResource };
export type {
    EntityFacts,
    EngineError,
    HistoryProjection,
    InboxErrorKind,
    InboxProjection,
    InboxRepository,
    PersistedResource,
    RepositoryRead,
    ResourceProjection,
    ThreadFact,
};

export type InboxEngine = {
    subscribe(
        listener: (value: InboxProjection) => void,
        threadId?: string,
        anchorId?: string,
        replaceListener?: (value: InboxProjection) => void,
    ): () => void;
    refresh(): Promise<void>;
    loadMoreInbox(): Promise<void>;
    refreshHistory(
        threadId: string,
        listener?: (value: InboxProjection) => void,
        anchorId?: string,
    ): Promise<void>;
    loadOlderHistory(
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ): Promise<void>;
    loadNewerHistory(
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ): Promise<void>;
    snapshot(): InboxProjection;
};

export interface InboxEngineEffects {
    readonly subscribe: InboxEngine['subscribe'];
    readonly refresh: Effect.Effect<void>;
    readonly loadMoreInbox: Effect.Effect<void>;
    readonly refreshHistory: (
        threadId: string,
        listener?: (value: InboxProjection) => void,
        anchorId?: string,
    ) => Effect.Effect<void>;
    readonly loadOlderHistory: (
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ) => Effect.Effect<void>;
    readonly loadNewerHistory: (
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ) => Effect.Effect<void>;
    readonly snapshot: () => InboxProjection;
}

export class InboxEngineService extends Context.Service<
    InboxEngineService,
    InboxEngineEffects
>()('icr/InboxEngine') {}

const MAX_INBOX_SEGMENTS = 20;
const MAX_HISTORY_ROOTS = 20;
const MAX_HISTORY_WINDOWS = 20;
const HISTORY_RETURN_KEYS = ['inbox:primary', 'inbox:primary:page:*'];
const MAX_NETWORK_READS = 4;

function errorOf(cause: unknown, fallback: InboxErrorKind): EngineError {
    if (cause instanceof InboxError)
        return { kind: cause.kind, message: cause.message };
    return { kind: fallback, message: new InboxError(fallback).message };
}

function capacityError(): EngineError {
    const error = new InboxError('capacity');
    return { kind: error.kind, message: error.message };
}

/** Synthetic parser IDs are only unique inside one conversation. */
export function scopeSyntheticMessage(
    message: Message,
    threadId: string,
): Message {
    if (!message.isSyntheticId) return message;
    const prefix = `synthetic:${threadId.length}:${threadId}:`;
    if (message.id.startsWith(prefix)) return message;
    return {
        ...message,
        id: `${prefix}${message.id.length}:${message.id}`,
        isSyntheticId: true,
    };
}

export function normalizeMessages(
    messages: Message[],
    threadId: string,
): Message[] {
    return messages.map((message) => scopeSyntheticMessage(message, threadId));
}

function uniqueIds(ids: string[]): string[] {
    return [...new Set(ids)];
}

export function normalizePage(page: Page<Thread>, fetchedAt = Date.now()) {
    const entities = emptyEntities();
    const orderedIds: string[] = [];
    for (const original of page.items) {
        const thread = original.lastMessage
            ? {
                  ...original,
                  lastMessage: scopeSyntheticMessage(
                      original.lastMessage,
                      original.key,
                  ),
              }
            : original;
        if (!orderedIds.includes(thread.key)) orderedIds.push(thread.key);
        for (const user of thread.users) entities.usersById[user.id] = user;
        if (thread.lastMessage)
            entities.messagesById[thread.lastMessage.id] = thread.lastMessage;
        const { users, lastMessage, ...baseFact } = thread;
        const fact: ThreadFact = {
            ...baseFact,
            userIds: users.map((user) => user.id),
        };
        if (lastMessage) fact.lastMessageId = lastMessage.id;
        entities.threadsById[thread.key] = fact;
    }
    const resource: ResourceProjection = {
        orderedIds,
        fetchedAt,
        hasNextPage: page.hasNextPage,
        availability: 'present',
        freshness: 'fresh',
        synchronization: 'idle',
    };
    if (page.cursor) resource.cursor = page.cursor;
    return {
        resource,
        entities,
    };
}

function copyFacts(facts: EntityFacts): EntityFacts {
    return {
        threadsById: { ...facts.threadsById },
        usersById: { ...facts.usersById },
        messagesById: { ...facts.messagesById },
    };
}

function mergeFacts(
    target: EntityFacts,
    incoming: EntityFacts,
    accepted: Map<string, number>,
    readOrder: number,
): Set<string> {
    const acceptedNow = new Set<string>();
    for (const [id, value] of Object.entries(incoming.usersById)) {
        const key = `user:${id}`;
        if ((accepted.get(key) ?? -1) <= readOrder) {
            target.usersById[id] = value;
            acceptedNow.add(key);
        }
    }
    for (const [id, value] of Object.entries(incoming.messagesById)) {
        const key = `message:${id}`;
        if ((accepted.get(key) ?? -1) <= readOrder) {
            target.messagesById[id] = value;
            acceptedNow.add(key);
        }
    }
    for (const [id, value] of Object.entries(incoming.threadsById)) {
        const key = `thread:${id}`;
        if ((accepted.get(key) ?? -1) <= readOrder) {
            target.threadsById[id] = value;
            acceptedNow.add(key);
        }
    }
    return acceptedNow;
}

function changedFacts(
    previous: EntityFacts,
    incoming: EntityFacts,
    accepted: Set<string>,
): EntityFacts {
    const changed = emptyEntities();
    for (const key of accepted) {
        const separator = key.indexOf(':');
        const id = key.slice(separator + 1);
        const kind = key.slice(0, separator);
        const field =
            kind === 'thread'
                ? 'threadsById'
                : kind === 'user'
                  ? 'usersById'
                  : 'messagesById';
        if (
            JSON.stringify(previous[field][id]) !==
            JSON.stringify(incoming[field][id])
        )
            Object.assign(changed[field], { [id]: incoming[field][id] });
    }
    return changed;
}

function addUnique(
    existing: string[],
    incoming: string[],
    prepend = false,
): string[] {
    return prepend
        ? uniqueIds([...incoming, ...existing])
        : uniqueIds([...existing, ...incoming]);
}

function resourceKeyForInbox(cursor?: string): string {
    return cursor ? `inbox:primary:page:${cursor}` : 'inbox:primary';
}

function resourceKeyForHistory(threadId: string, cursor?: string): string {
    return cursor
        ? `history:${threadId}:page:${cursor}`
        : `history:${threadId}`;
}

function recordFor(
    key: string,
    resource: ResourceProjection,
    entities: EntityFacts,
    threadId?: string,
    viewerId?: string,
    requestCursor?: string,
): PersistedResource {
    const userIds: string[] = [];
    const messageIds: string[] = [];
    const refs = {
        threadIds: threadId ? [threadId] : [...resource.orderedIds],
        userIds,
        messageIds,
    };
    if (threadId) {
        refs.messageIds = [...resource.orderedIds];
        const thread = entities.threadsById[threadId];
        if (thread) refs.userIds.push(...thread.userIds);
    } else {
        for (const id of resource.orderedIds) {
            const thread = entities.threadsById[id];
            if (!thread) continue;
            refs.userIds.push(...thread.userIds);
            if (thread.lastMessageId)
                refs.messageIds.push(thread.lastMessageId);
        }
    }
    const result: PersistedResource = {
        ...resource,
        key,
        refs: {
            threadIds: uniqueIds(refs.threadIds),
            userIds: uniqueIds(refs.userIds),
            messageIds: uniqueIds(refs.messageIds),
        },
    };
    if (threadId) result.threadId = threadId;
    if (viewerId) result.viewerId = viewerId;
    if (requestCursor) result.requestCursor = requestCursor;
    return result;
}

type Listener = {
    notify: (value: InboxProjection) => void;
    threadId?: string;
    authorized: boolean;
    anchorId?: string;
    window?: HistoryProjection;
    rejectedThreadId?: string;
    waiter?: Fiber.Fiber<void, InboxError>;
};

export const makeInboxEngine = Effect.fn('InboxEngine.make')(function* (
    repository: InboxRepositoryEffects,
    provider: InboxProviderEffects,
) {
    const runProducer = yield* FiberSet.makeRuntime<never>();
    function fork<A, E>(effect: Effect.Effect<A, E>) {
        return runProducer(effect.pipe(Effect.tapDefect(Effect.logError)));
    }
    let closed = false;
    const listeners = new Map<(value: InboxProjection) => void, Listener>();
    type Flight = {
        fiber: Fiber.Fiber<void, InboxError>;
        accountId: string;
        epoch: number;
        threadId?: string;
        generation?: number;
        readOrder?: number;
        waiters?: Set<Listener>;
    };
    const flights = new Map<string, Flight>();

    // Register before releasing the gate: even synchronous producers cannot
    // complete and remove their flight before it is installed.
    function start<A, E>(work: Effect.Effect<A, E>, remove: () => void) {
        const gate = Deferred.makeUnsafe<void>();
        const fiber = fork(
            Effect.andThen(Deferred.await(gate), work).pipe(
                Effect.ensuring(Effect.sync(remove)),
            ),
        );
        return {
            fiber,
            activate: () => Deferred.doneUnsafe(gate, Effect.void),
        };
    }

    function detachFlights(matches: (flight: Flight) => boolean) {
        const obsolete: Fiber.Fiber<void, InboxError>[] = [];
        for (const [key, flight] of flights) {
            if (!matches(flight)) continue;
            flights.delete(key);
            obsolete.push(flight.fiber);
        }
        if (obsolete.length) fork(Fiber.interruptAll(obsolete));
    }
    const inboxSegments = new Map<string, PersistedResource>();
    const acceptedReadOrder = new Map<string, number>();
    const detailInterest = new Map<string, number>();
    const detailGeneration = new Map<string, number>();
    const recentHistories: string[] = [];
    let state: InboxProjection = {
        accountId: null,
        accountEpoch: 0,
        workerEpoch: crypto.randomUUID(),
        commitRevision: 0,
        entities: emptyEntities(),
        inbox: {
            orderedIds: [],
            fetchedAt: 0,
            hasNextPage: false,
            availability: 'absent',
            freshness: 'stale',
            synchronization: 'idle',
        },
        histories: {},
    };
    let identityFlight: Fiber.Fiber<string, InboxError> | undefined;
    let identityToken = 0;
    let bootstrapFlight: Fiber.Fiber<void, InboxError> | undefined;
    let bootstrapInboxFlight: Fiber.Fiber<void, InboxError> | undefined;
    let hydratedEpoch = -1;
    let verified = false;
    let readOrder = 0;
    const commitPermit = yield* Semaphore.make(1);
    const networkPermit = yield* Semaphore.make(MAX_NETWORK_READS);

    yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
            closed = true;
            identityToken++;
            listeners.clear();
            detailInterest.clear();
            detailGeneration.clear();
            flights.clear();
            identityFlight = undefined;
            bootstrapFlight = undefined;
            bootstrapInboxFlight = undefined;
        }),
    );

    function inLane<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
        return commitPermit.withPermits(1)(work);
    }

    function commitInLane<A, E>(
        work: Effect.Effect<A, E>,
    ): Effect.Effect<A, E> {
        return inLane(Effect.uninterruptible(work));
    }

    function network<T, E>(
        work: Effect.Effect<T, E>,
        canStart = () => true,
    ): Effect.Effect<T | undefined, E> {
        return networkPermit.withPermits(1)(
            Effect.suspend(() =>
                !closed && canStart() ? work : Effect.succeed(undefined),
            ),
        );
    }

    function inboxChain(): PersistedResource[] {
        const head = inboxSegments.get('inbox:primary');
        if (!head) return [];
        const result = [head];
        const visited = new Set<string>();
        let current = head;
        while (
            current.hasNextPage &&
            current.cursor &&
            !visited.has(current.cursor)
        ) {
            visited.add(current.cursor);
            const next = inboxSegments.get(resourceKeyForInbox(current.cursor));
            if (!next) break;
            result.push(next);
            current = next;
        }
        return result;
    }

    function inboxProjection(): ResourceProjection {
        const chain = inboxChain();
        const head = chain[0];
        if (!head) return state.inbox;
        const tail = chain.at(-1)!;
        return {
            ...head,
            orderedIds: addUnique(
                [],
                chain.flatMap((resource) => resource.orderedIds),
            ),
            cursor: tail.cursor,
            hasNextPage: tail.hasNextPage,
            availability: 'present',
            synchronization: 'idle',
        };
    }

    function historyProjection(threadId: string) {
        return state.histories[threadId];
    }

    function projectFor(
        threadId?: string,
        window?: HistoryProjection,
        anchorId?: string,
    ): InboxProjection {
        const selected = threadId
            ? [
                  threadId,
                  ...recentHistories
                      .filter((id) => id !== threadId)
                      .slice(0, 2),
              ]
            : recentHistories.slice(0, 2);

        const histories = Object.fromEntries(
            selected
                .map((id) => [
                    id,
                    id === threadId
                        ? (window ??
                          ((
                              anchorId
                                  ? state.histories[id]?.orderedIds.includes(
                                        anchorId,
                                    )
                                  : !state.histories[id]?.cachedNewer
                          )
                              ? state.histories[id]
                              : undefined))
                        : state.histories[id],
                ])
                .filter((entry): entry is [string, HistoryProjection] =>
                    Boolean(entry[1]),
                ),
        );
        const threadIds = new Set(state.inbox.orderedIds);
        for (const history of Object.values(histories))
            threadIds.add(history.threadId);
        const entities: EntityFacts = emptyEntities();
        const messageIds = new Set<string>();
        for (const id of threadIds) {
            const fact = state.entities.threadsById[id];
            if (!fact) continue;
            entities.threadsById[id] = fact;
            for (const userId of fact.userIds) {
                const user = state.entities.usersById[userId];
                if (user) entities.usersById[userId] = user;
            }
            if (fact.lastMessageId) messageIds.add(fact.lastMessageId);
        }
        for (const history of Object.values(histories))
            for (const id of history.orderedIds) messageIds.add(id);
        for (const id of messageIds) {
            const message = state.entities.messagesById[id];
            if (message) entities.messagesById[id] = message;
        }
        return { ...state, entities, histories };
    }

    function checkingProjection(): InboxProjection {
        return {
            ...state,
            accountId: null,
            entities: emptyEntities(),
            histories: {},
            inbox: {
                ...emptyResource(),
                synchronization: state.inbox.error ? 'error' : 'refreshing',
                error: state.inbox.error,
            },
        };
    }

    function listenerProjection(subscription: Listener): InboxProjection {
        const projection = subscription.authorized
            ? projectFor(
                  subscription.threadId,
                  subscription.window,
                  subscription.anchorId,
              )
            : checkingProjection();
        if (subscription.rejectedThreadId) {
            const id = subscription.rejectedThreadId;
            projection.histories[id] = {
                ...emptyResource(),
                threadId: id,
                synchronization: 'error',
                error: capacityError(),
                failedOperation: 'refresh',
            };
        }
        return projection;
    }

    function notify() {
        if (closed) return;
        for (const subscription of listeners.values())
            subscription.notify(listenerProjection(subscription));
    }

    function admit(
        subscription: Listener,
        threadId: string,
        previous?: Listener,
    ): boolean {
        const windowCount = [...detailInterest.values()].reduce(
            (total, count) => total + count,
            0,
        );
        const creditedThread = previous?.threadId;
        const rootCredit =
            creditedThread &&
            creditedThread !== threadId &&
            detailInterest.get(creditedThread) === 1
                ? 1
                : 0;
        if (
            windowCount - (creditedThread ? 1 : 0) >= MAX_HISTORY_WINDOWS ||
            (!detailInterest.has(threadId) &&
                detailInterest.size - rootCredit >= MAX_HISTORY_ROOTS)
        ) {
            subscription.rejectedThreadId = threadId;
            return false;
        }
        const count = detailInterest.get(threadId) ?? 0;
        if (count === 0)
            detailGeneration.set(
                threadId,
                (detailGeneration.get(threadId) ?? 0) + 1,
            );
        detailInterest.set(threadId, count + 1);
        subscription.threadId = threadId;
        subscription.rejectedThreadId = undefined;
        touchRecent(threadId);
        return true;
    }

    function update(next: InboxProjection) {
        if (closed) return;
        state = next;
        notify();
    }

    function setInboxRuntime(patch: Partial<ResourceProjection>) {
        update({ ...state, inbox: { ...state.inbox, ...patch } });
    }

    function setHistoryRuntime(
        threadId: string,
        patch: Partial<HistoryProjection>,
    ) {
        for (const subscription of targetsFor(threadId)) {
            if (subscription.window)
                subscription.window = { ...subscription.window, ...patch };
        }
        const current = state.histories[threadId] ??
            historyProjection(threadId) ?? {
                threadId,
                orderedIds: [],
                fetchedAt: 0,
                hasNextPage: true,
                availability: 'absent' as const,
                freshness: 'stale' as const,
                synchronization: 'idle' as const,
            };
        update({
            ...state,
            histories: {
                ...state.histories,
                [threadId]: { ...current, ...patch },
            },
        });
    }

    function resetAccount(
        accountId: string | null,
        error?: EngineError,
        preserveIdentity?: Fiber.Fiber<string, InboxError>,
    ) {
        if (closed) return;
        identityToken++;
        const previousIdentity = identityFlight;
        identityFlight = undefined;
        if (previousIdentity && previousIdentity !== preserveIdentity)
            fork(Fiber.interrupt(previousIdentity));
        const previousBootstrap = bootstrapFlight;
        bootstrapFlight = undefined;
        bootstrapInboxFlight = undefined;
        detachFlights(() => true);
        if (previousBootstrap) fork(Fiber.interrupt(previousBootstrap));
        inboxSegments.clear();
        for (const subscription of listeners.values())
            subscription.window = undefined;
        acceptedReadOrder.clear();
        recentHistories.length = 0;
        verified = accountId !== null;
        const inbox: ResourceProjection = {
            orderedIds: [],
            fetchedAt: 0,
            hasNextPage: false,
            availability: 'absent',
            freshness: 'stale',
            synchronization: error ? 'error' : 'refreshing',
        };
        if (error) inbox.error = error;
        update({
            ...state,
            accountId,
            accountEpoch: state.accountEpoch + 1,
            commitRevision: 0,
            entities: emptyEntities(),
            histories: {},
            inbox,
        });
    }

    function touchRecent(threadId: string) {
        const index = recentHistories.indexOf(threadId);
        if (index >= 0) recentHistories.splice(index, 1);
        recentHistories.unshift(threadId);
    }

    function preserveRuntime(
        next: HistoryProjection,
        previous: ResourceProjection | undefined,
        affected: boolean,
    ): HistoryProjection;
    function preserveRuntime(
        next: ResourceProjection,
        previous: ResourceProjection | undefined,
        affected: boolean,
    ): ResourceProjection;
    function preserveRuntime(
        next: ResourceProjection,
        previous: ResourceProjection | undefined,
        affected: boolean,
    ): ResourceProjection {
        if (!previous || affected) return next;
        const result = {
            ...next,
            synchronization: previous.synchronization,
            freshness: previous.freshness,
        };
        if (previous.error) result.error = previous.error;
        if (previous.failedOperation)
            result.failedOperation = previous.failedOperation;
        return result;
    }

    function installRead(
        result: RepositoryRead,
        replace = false,
        affected: { inbox: boolean; histories: Set<string> } = {
            inbox: false,
            histories: new Set(),
        },
    ) {
        if (replace) {
            inboxSegments.clear();
        }
        for (const resource of result.resources) {
            if (resource.key.startsWith('inbox:primary'))
                inboxSegments.set(resource.key, resource);
        }

        const inbox = preserveRuntime(
            inboxProjection(),
            state.inbox,
            affected.inbox,
        );
        const histories = { ...state.histories };
        for (const id of result.deletedHistoryIds ?? []) {
            delete histories[id];
            delete state.histories[id];
            for (const subscription of targetsFor(id))
                subscription.window = undefined;
        }
        for (const [threadId, previous] of Object.entries(state.histories)) {
            if (affected.histories.has(threadId)) continue;
            if (histories[threadId]) {
                histories[threadId] = preserveRuntime(
                    histories[threadId],
                    previous,
                    false,
                );
            } else if (
                !replace ||
                (detailInterest.has(threadId) &&
                    previous.availability === 'absent')
            ) {
                histories[threadId] = previous;
            }
        }
        state = {
            ...state,
            commitRevision: result.revision,
            entities: {
                threadsById: {
                    ...state.entities.threadsById,
                    ...result.entities.threadsById,
                },
                usersById: {
                    ...state.entities.usersById,
                    ...result.entities.usersById,
                },
                messagesById: {
                    ...state.entities.messagesById,
                    ...result.entities.messagesById,
                },
            },
            inbox,
            histories,
        };
    }

    function pruneRuntimeReferences() {
        const retained = new Set([
            ...detailInterest.keys(),
            ...recentHistories
                .filter((id) => !detailInterest.has(id))
                .slice(0, 2),
        ]);
        state.histories = Object.fromEntries(
            Object.entries(state.histories).filter(([id]) => retained.has(id)),
        );
        for (const threadId of detailInterest.keys()) {
            const representative = targetsFor(threadId).find(
                (target) => target.window,
            )?.window;
            if (representative) state.histories[threadId] = representative;
        }

        // Canonical messages are the union of at most 20 admitted 400-row
        // windows, two warm 400-row histories, and bounded inbox dependencies.
        // Rejected subscriptions contribute neither a window nor a reference.
        const facts = emptyEntities();
        const views = [
            ...Object.values(state.histories),
            ...[...listeners.values()].flatMap((subscription) =>
                subscription.window ? [subscription.window] : [],
            ),
        ];
        const threadIds = new Set([
            ...state.inbox.orderedIds,
            ...views.map((view) => view.threadId),
        ]);
        const messageIds = new Set(views.flatMap((view) => view.orderedIds));
        for (const id of threadIds) {
            const thread = state.entities.threadsById[id];
            if (!thread) continue;
            facts.threadsById[id] = thread;
            for (const userId of thread.userIds) {
                const user = state.entities.usersById[userId];
                if (user) facts.usersById[userId] = user;
            }
            if (thread.lastMessageId) messageIds.add(thread.lastMessageId);
        }
        for (const id of messageIds) {
            const message = state.entities.messagesById[id];
            if (message) facts.messagesById[id] = message;
        }
        state.entities = facts;

        // An older producer may still reference facts outside all mounted windows.
        const minLiveOrder = Math.min(
            ...[...flights.values()].flatMap((flight) =>
                flight.readOrder === undefined ? [] : [flight.readOrder],
            ),
        );
        for (const key of acceptedReadOrder.keys()) {
            const separator = key.indexOf(':');
            const kind = key.slice(0, separator);
            const id = key.slice(separator + 1);
            if (
                (kind === 'thread' && !state.entities.threadsById[id]) ||
                (kind === 'user' && !state.entities.usersById[id]) ||
                (kind === 'message' && !state.entities.messagesById[id])
            )
                if ((acceptedReadOrder.get(key) ?? 0) < minLiveOrder)
                    acceptedReadOrder.delete(key);
        }
        for (let index = recentHistories.length - 1; index >= 0; index--) {
            if (!state.histories[recentHistories[index]])
                recentHistories.splice(index, 1);
        }
        for (const threadId of detailGeneration.keys()) {
            if (!detailInterest.has(threadId) && !state.histories[threadId])
                detailGeneration.delete(threadId);
        }
    }

    function installWindow(
        threadId: string,
        result: HistoryWindowRead,
        targets: Listener[],
    ) {
        state.entities = {
            threadsById: {
                ...state.entities.threadsById,
                ...result.entities.threadsById,
            },
            usersById: {
                ...state.entities.usersById,
                ...result.entities.usersById,
            },
            messagesById: {
                ...state.entities.messagesById,
                ...result.entities.messagesById,
            },
        };
        state.commitRevision = Math.max(state.commitRevision, result.revision);
        if (result.history) {
            state.histories[threadId] = preserveRuntime(
                result.history,
                state.histories[threadId],
                false,
            );
            if (result.history.newerCoverageAvailable)
                state.histories[threadId].freshness = 'stale';
            for (const target of targets) {
                if (listeners.get(target.notify) !== target) continue;
                target.window = preserveRuntime(
                    result.history,
                    target.window,
                    false,
                );
                if (result.history.newerCoverageAvailable)
                    target.window.freshness = 'stale';
                target.anchorId = target.window.orderedIds[0];
            }
        }
    }

    function targetsFor(
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ) {
        return [...listeners.values()].filter(
            (subscription) =>
                subscription.threadId === threadId &&
                (!listener || subscription.notify === listener),
        );
    }

    function hydrateHistory(
        accountId: string,
        threadId: string,
        targets = targetsFor(threadId),
        request?: HistoryWindowRequest,
    ): Effect.Effect<void, InboxError> {
        return Effect.gen(function* () {
            const epoch = state.accountEpoch;
            const generation = detailGeneration.get(threadId);
            if (
                closed ||
                accountId !== state.accountId ||
                !detailInterest.has(threadId)
            )
                return;
            if (!request && targets.length > 1) {
                for (const target of targets)
                    yield* hydrateHistory(accountId, threadId, [target]);
                return;
            }

            const selectedRequest: HistoryWindowRequest | undefined =
                request ??
                (targets[0]?.window?.orderedIds[0]
                    ? {
                          anchorId: targets[0].window.orderedIds[0],
                          direction: 'at',
                          coverageGeneration:
                              targets[0].window.coverageGeneration,
                      }
                    : targets[0]?.anchorId
                      ? { anchorId: targets[0].anchorId }
                      : undefined);
            const key = `hydrate:${accountId}:${epoch}:${threadId}:${generation}:${selectedRequest?.coverageGeneration ?? 'current'}:${selectedRequest?.direction ?? 'at'}:${selectedRequest?.anchorId ?? 'newest'}`;
            let flight = flights.get(key);
            if (!flight) {
                const waiters = new Set<Listener>();
                const work = inLane(
                    Effect.gen(function* () {
                        const result = yield* repository.readHistoryWindow(
                            accountId,
                            threadId,
                            selectedRequest,
                        );
                        if (
                            closed ||
                            accountId !== state.accountId ||
                            epoch !== state.accountEpoch ||
                            generation !== detailGeneration.get(threadId) ||
                            !detailInterest.has(threadId)
                        )
                            return;
                        yield* Effect.uninterruptible(
                            Effect.gen(function* () {
                                installWindow(threadId, result, [...waiters]);
                                const accessedAt =
                                    yield* Clock.currentTimeMillis;
                                yield* repository.touchHistory(
                                    accountId,
                                    threadId,
                                    accessedAt,
                                );
                                touchRecent(threadId);
                                pruneRuntimeReferences();
                                update(state);
                            }),
                        );
                    }),
                );
                const started = start(work, () => {
                    if (flights.get(key) === created) flights.delete(key);
                });
                const created: Flight = {
                    fiber: started.fiber,
                    accountId,
                    epoch,
                    threadId,
                    generation,
                    waiters,
                };
                flight = created;
                flights.set(key, flight);
                for (const target of targets) waiters.add(target);
                started.activate();
            } else for (const target of targets) flight.waiters?.add(target);
            yield* Fiber.join(flight.fiber);
        });
    }

    function rereadWindows(accountId: string, threadId: string) {
        return Effect.gen(function* () {
            const targets = targetsFor(threadId);
            for (const target of targets) {
                const anchorId =
                    target.window?.orderedIds[0] ?? target.anchorId;
                const result = yield* repository.readHistoryWindow(
                    accountId,
                    threadId,
                    {
                        anchorId,
                        direction: 'at',
                        coverageGeneration: target.window?.coverageGeneration,
                    },
                );
                installWindow(threadId, result, [target]);
            }
            if (!targets.length)
                installWindow(
                    threadId,
                    yield* repository.readHistoryWindow(accountId, threadId),
                    [],
                );
        });
    }

    function hydrate(accountId: string, keys: string[], epoch: number) {
        return inLane(
            Effect.gen(function* () {
                const result = yield* repository.readResources(accountId, keys);
                if (
                    closed ||
                    epoch !== state.accountEpoch ||
                    accountId !== state.accountId
                )
                    return;
                installRead(result);
                update(state);
            }),
        );
    }

    function bootstrap(
        accountId: string,
        epoch: number,
    ): Effect.Effect<void, InboxError> {
        return Effect.gen(function* () {
            const keys = ['inbox:primary', 'inbox:primary:page:*'];
            const hydrated = yield* Effect.result(
                hydrate(accountId, [...new Set(keys)], epoch),
            );
            if (hydrated._tag === 'Failure') {
                const cause = hydrated.failure;
                if (
                    epoch === state.accountEpoch &&
                    accountId === state.accountId
                ) {
                    setInboxRuntime(
                        failed('refresh', errorOf(cause, 'storage')),
                    );
                }
            }
            if (
                closed ||
                epoch !== state.accountEpoch ||
                accountId !== state.accountId
            )
                return;
            hydratedEpoch = epoch;

            const inboxFlight = start(
                runInbox(undefined, accountId, epoch),
                () => undefined,
            );
            bootstrapInboxFlight = inboxFlight.fiber;
            inboxFlight.activate();
            fork(
                Effect.andThen(
                    Fiber.join(inboxFlight.fiber),
                    Effect.sync(() => {
                        if (
                            closed ||
                            epoch !== state.accountEpoch ||
                            accountId !== state.accountId
                        )
                            return;
                        for (const id of detailInterest.keys()) {
                            fork(
                                Effect.andThen(
                                    hydrateHistory(accountId, id),
                                    Effect.suspend(() =>
                                        knownThread(id)
                                            ? runHistory(id, false, false)
                                            : Effect.void,
                                    ),
                                ),
                            );
                        }
                    }),
                ),
            );
        });
    }

    const ensureIdentity = Effect.fn('InboxEngine.ensureIdentity')(function* (
        force = false,
    ): Effect.fn.Return<string, InboxError> {
        if (closed) return yield* Effect.interrupt;
        if (identityFlight) return yield* Fiber.join(identityFlight);
        if (!force && verified && state.accountId) return state.accountId;
        let token = ++identityToken;
        const work = Effect.gen(function* () {
            const accountId = yield* provider.account;
            if (closed || token !== identityToken)
                return yield* Effect.fail(
                    new InboxError('provider_unavailable'),
                );
            if (state.accountId !== accountId) {
                resetAccount(accountId, undefined, checked.fiber);
                token = identityToken;
                identityFlight = checked.fiber;
            }
            verified = true;
            if (hydratedEpoch !== state.accountEpoch && !bootstrapFlight) {
                const epoch = state.accountEpoch;
                const current = start(bootstrap(accountId, epoch), () => {
                    if (bootstrapFlight === current.fiber)
                        bootstrapFlight = undefined;
                });
                bootstrapFlight = current.fiber;
                current.activate();
            }
            if (bootstrapFlight) yield* Fiber.join(bootstrapFlight);
            if (
                closed ||
                token !== identityToken ||
                accountId !== state.accountId
            )
                return yield* Effect.fail(
                    new InboxError('provider_unavailable'),
                );
            return accountId;
        }).pipe(
            Effect.tapError((cause) =>
                Effect.sync(() => {
                    if (closed || token !== identityToken) return;
                    verified = false;
                    const error = errorOf(cause, 'provider_unavailable');
                    if (error.kind === 'auth')
                        resetAccount(null, error, checked.fiber);
                    else
                        setInboxRuntime({
                            freshness: 'stale',
                            ...failed('refresh', error),
                        });
                }),
            ),
        );
        const checked = start(work, () => {
            if (identityFlight === checked.fiber) {
                identityFlight = undefined;
                notify();
            }
        });
        identityFlight = checked.fiber;
        notify();
        checked.activate();
        return yield* Fiber.join(checked.fiber);
    });

    function knownThread(threadId: string): boolean {
        return Boolean(
            state.entities.threadsById[threadId] || state.histories[threadId],
        );
    }

    function activeInboxKeys(): Set<string> {
        return new Set(inboxChain().map((resource) => resource.key));
    }

    function inboxDeletes(forKey: string): string[] | undefined {
        const keys = [...inboxSegments.keys()].filter((key) =>
            key.startsWith('inbox:primary:page:'),
        );
        const addsSegment = !inboxSegments.has(forKey);
        if (keys.length + (addsSegment ? 1 : 0) < MAX_INBOX_SEGMENTS)
            return undefined;
        const active = activeInboxKeys();
        const candidate = inboxSegments.get(
            keys
                .sort(
                    (a, b) =>
                        inboxSegments.get(a)!.fetchedAt -
                        inboxSegments.get(b)!.fetchedAt,
                )
                .find((key) => !active.has(key))!,
        );
        return candidate ? [candidate.key] : undefined;
    }

    function noProgress(
        cursor: string | undefined,
        nextCursor: string | undefined,
        ids: string[],
        activeIds: string[],
        chain: PersistedResource[],
        hasNextPage: boolean,
    ): boolean {
        if (!cursor || !hasNextPage) return false;
        if (nextCursor === cursor) return true;
        if (ids.every((id) => activeIds.includes(id))) return true;
        const cursors = new Set(
            chain.flatMap((resource) =>
                resource.cursor ? [resource.cursor] : [],
            ),
        );
        return Boolean(nextCursor && cursors.has(nextCursor));
    }

    function failed(kind: 'refresh' | 'continuation', error: EngineError) {
        return {
            synchronization: 'error' as const,
            failedOperation: kind,
            error,
        };
    }

    const runInbox = Effect.fn('InboxEngine.runInbox')(function* (
        cursor: string | undefined,
        accountId?: string,
        epoch = state.accountEpoch,
    ): Effect.fn.Return<void, InboxError> {
        const account = accountId ?? (yield* ensureIdentity());
        const key = `inbox:${state.accountEpoch}:${account}:${cursor ?? 'head'}`;
        const current = flights.get(key);
        if (current) return yield* Fiber.join(current.fiber);
        if (epoch !== state.accountEpoch || account !== state.accountId) return;
        if (cursor && state.inbox.retentionLimited) return;
        const order = ++readOrder;
        const failedTailCursor =
            cursor === undefined &&
            state.inbox.failedOperation === 'continuation'
                ? state.inbox.cursor
                : undefined;
        const failedTailError = failedTailCursor
            ? state.inbox.error
            : undefined;
        setInboxRuntime({ synchronization: 'refreshing' });
        const work = Effect.matchEffect(
            network(
                provider.inbox(account, cursor),
                () =>
                    epoch === state.accountEpoch && account === state.accountId,
            ),
            {
                onSuccess: (page) =>
                    commitInLane(
                        Effect.gen(function* () {
                            if (closed) return;
                            if (!page) {
                                if (
                                    epoch === state.accountEpoch &&
                                    account === state.accountId &&
                                    state.inbox.synchronization === 'refreshing'
                                )
                                    setInboxRuntime({
                                        synchronization: 'idle',
                                    });
                                return;
                            }
                            if (
                                closed ||
                                epoch !== state.accountEpoch ||
                                account !== state.accountId
                            )
                                return;
                            const fetchedAt = yield* Clock.currentTimeMillis;
                            const normalized = normalizePage(page, fetchedAt);
                            const chain = inboxChain();
                            const activeIds = chain.flatMap(
                                (resource) => resource.orderedIds,
                            );
                            if (
                                noProgress(
                                    cursor,
                                    page.cursor,
                                    normalized.resource.orderedIds,
                                    activeIds,
                                    chain,
                                    page.hasNextPage,
                                )
                            ) {
                                setInboxRuntime(
                                    failed(
                                        'continuation',
                                        errorOf(
                                            new InboxError('no_progress'),
                                            'no_progress',
                                        ),
                                    ),
                                );
                                return;
                            }
                            const resource = {
                                ...normalized.resource,
                                synchronization: 'idle' as const,
                            };
                            const resourceKey = resourceKeyForInbox(cursor);
                            const deleteKeys = inboxDeletes(resourceKey) ?? [];
                            if (
                                !inboxSegments.has(resourceKey) &&
                                deleteKeys.length === 0 &&
                                inboxSegments.size >= MAX_INBOX_SEGMENTS
                            ) {
                                setInboxRuntime({
                                    ...failed('continuation', capacityError()),
                                    retentionLimited: true,
                                });
                                return;
                            }
                            const merged = copyFacts(state.entities);
                            const acceptedNow = mergeFacts(
                                merged,
                                normalized.entities,
                                acceptedReadOrder,
                                order,
                            );
                            const record = recordFor(
                                resourceKey,
                                resource,
                                merged,
                                undefined,
                                undefined,
                                cursor,
                            );
                            if (
                                closed ||
                                epoch !== state.accountEpoch ||
                                account !== state.accountId
                            )
                                return;
                            const commitResult = yield* Effect.result(
                                repository.commitResources(account, {
                                    resources: [record],
                                    entities: changedFacts(
                                        state.entities,
                                        merged,
                                        acceptedNow,
                                    ),
                                    deleteKeys,
                                    returnKeys: HISTORY_RETURN_KEYS,
                                    retention: {
                                        protectedThreadIds: [
                                            ...detailInterest.keys(),
                                        ],
                                        maxHistories: 20,
                                        maxMessages: 20000,
                                    },
                                }),
                            );
                            if (commitResult._tag === 'Success') {
                                const committed = commitResult.success;
                                if (
                                    epoch !== state.accountEpoch ||
                                    account !== state.accountId
                                )
                                    return;
                                for (const deleteKey of deleteKeys)
                                    inboxSegments.delete(deleteKey);
                                installRead(committed, true, {
                                    inbox: true,
                                    histories: new Set(),
                                });
                                state.entities = {
                                    threadsById: {
                                        ...merged.threadsById,
                                        ...state.entities.threadsById,
                                    },
                                    usersById: {
                                        ...merged.usersById,
                                        ...state.entities.usersById,
                                    },
                                    messagesById: {
                                        ...merged.messagesById,
                                        ...state.entities.messagesById,
                                    },
                                };
                                for (const key of acceptedNow)
                                    acceptedReadOrder.set(key, order);
                                pruneRuntimeReferences();
                                const rebuilt = inboxProjection();
                                const inbox = {
                                    ...rebuilt,
                                    freshness: 'fresh' as const,
                                    synchronization:
                                        failedTailCursor &&
                                        rebuilt.cursor === failedTailCursor
                                            ? ('error' as const)
                                            : ('idle' as const),
                                };
                                if (
                                    failedTailCursor &&
                                    rebuilt.cursor === failedTailCursor &&
                                    failedTailError
                                ) {
                                    inbox.error = failedTailError;
                                    inbox.failedOperation = 'continuation';
                                }
                                update({
                                    ...state,
                                    inbox,
                                });
                            } else {
                                if (
                                    closed ||
                                    epoch !== state.accountEpoch ||
                                    account !== state.accountId
                                )
                                    return;
                                const cause = commitResult.failure;
                                setInboxRuntime({
                                    freshness: 'stale',
                                    ...failed(
                                        cursor ? 'continuation' : 'refresh',
                                        errorOf(cause, 'storage'),
                                    ),
                                });
                            }
                        }),
                    ),
                onFailure: (cause) =>
                    Effect.sync(() => {
                        if (
                            epoch !== state.accountEpoch ||
                            account !== state.accountId
                        )
                            return;
                        const error = errorOf(cause, 'protocol');
                        if (error.kind === 'auth') resetAccount(null, error);
                        else
                            setInboxRuntime(
                                failed(
                                    cursor ? 'continuation' : 'refresh',
                                    error,
                                ),
                            );
                    }),
            },
        );
        const producer = start(work, () => {
            if (flights.get(key) === flight) flights.delete(key);
        });
        const flight: Flight = {
            fiber: producer.fiber,
            accountId: account,
            epoch,
            readOrder: order,
        };
        flights.set(key, flight);
        producer.activate();
        yield* Fiber.join(flight.fiber);
    });

    const runHistory = Effect.fn('InboxEngine.runHistory')(function* (
        threadId: string,
        older: boolean,
        force: boolean,
        context?: HistoryProjection,
    ): Effect.fn.Return<void, InboxError> {
        const account = yield* ensureIdentity();
        const interest = detailInterest.get(threadId) ?? 0;
        const generation = detailGeneration.get(threadId) ?? 0;
        if (!knownThread(threadId) || interest === 0) return;
        const current =
            context ?? state.histories[threadId] ?? historyProjection(threadId);
        if (older && !current?.hasNextPage) return;
        if (!older && !force && current?.availability === 'present') return;
        const cursor = older ? current?.cursor : undefined;
        const key = `history:${state.accountEpoch}:${threadId}:${generation}:${cursor ?? 'head'}`;
        const existing = flights.get(key);
        if (existing) return yield* Fiber.join(existing.fiber);
        const epoch = state.accountEpoch;
        const order = ++readOrder;
        setHistoryRuntime(threadId, {
            synchronization: 'refreshing',
            error: undefined,
        });
        const work = Effect.matchEffect(
            network(
                provider.history(
                    account,
                    state.entities.threadsById[threadId]?.threadFbid ??
                        threadId,
                    cursor,
                ),
                () =>
                    epoch === state.accountEpoch &&
                    account === state.accountId &&
                    (detailInterest.get(threadId) ?? 0) > 0 &&
                    detailGeneration.get(threadId) === generation,
            ),
            {
                onSuccess: (result) =>
                    commitInLane(
                        Effect.gen(function* () {
                            if (closed) return;
                            if (!result) {
                                if (
                                    epoch === state.accountEpoch &&
                                    detailGeneration.get(threadId) ===
                                        generation &&
                                    (detailInterest.get(threadId) ?? 0) > 0
                                )
                                    setHistoryRuntime(threadId, {
                                        synchronization: 'idle',
                                    });
                                return;
                            }
                            if (
                                closed ||
                                epoch !== state.accountEpoch ||
                                account !== state.accountId
                            )
                                return;
                            if (
                                (detailInterest.get(threadId) ?? 0) === 0 ||
                                detailGeneration.get(threadId) !== generation
                            )
                                return;
                            const messages = normalizeMessages(
                                result.items,
                                threadId,
                            );
                            const fetchedAt = yield* Clock.currentTimeMillis;
                            const normalized: ResourceProjection = {
                                orderedIds: uniqueIds(
                                    messages.map((message) => message.id),
                                ),
                                fetchedAt,
                                hasNextPage: result.hasNextPage,
                                availability: 'present',
                                freshness: 'fresh',
                                synchronization: 'idle',
                            };
                            if (result.cursor)
                                normalized.cursor = result.cursor;
                            const resourceKey = resourceKeyForHistory(
                                threadId,
                                cursor,
                            );
                            const incoming = copyFacts(state.entities);
                            const detailThread =
                                !older && result.thread?.key === threadId
                                    ? normalizePage({
                                          items: [result.thread],
                                          hasNextPage: false,
                                      }).entities
                                    : emptyEntities();
                            const messageFacts = emptyEntities();
                            for (const message of messages)
                                messageFacts.messagesById[message.id] = message;
                            const acceptedNow = mergeFacts(
                                incoming,
                                detailThread,
                                acceptedReadOrder,
                                order,
                            );
                            for (const key of mergeFacts(
                                incoming,
                                messageFacts,
                                acceptedReadOrder,
                                order,
                            ))
                                acceptedNow.add(key);
                            const viewerId =
                                current?.viewerId ?? result.viewerId;
                            const record = recordFor(
                                resourceKey,
                                normalized,
                                incoming,
                                threadId,
                                viewerId,
                                cursor,
                            );
                            const commitUpdate = {
                                resources: [record],
                                entities: changedFacts(
                                    state.entities,
                                    incoming,
                                    acceptedNow,
                                ),
                                returnKeys: HISTORY_RETURN_KEYS,
                                retention: {
                                    protectedThreadIds: [
                                        ...detailInterest.keys(),
                                    ],
                                    maxHistories: 20,
                                    maxMessages: 20000,
                                },
                            };
                            if (
                                closed ||
                                epoch !== state.accountEpoch ||
                                account !== state.accountId ||
                                detailGeneration.get(threadId) !== generation ||
                                !detailInterest.has(threadId)
                            )
                                return;
                            const commitResult = yield* Effect.result(
                                repository.commitResources(
                                    account,
                                    commitUpdate,
                                ),
                            );
                            if (commitResult._tag === 'Success') {
                                const committed = commitResult.success;
                                if (
                                    epoch !== state.accountEpoch ||
                                    account !== state.accountId
                                )
                                    return;
                                installRead(committed, true, {
                                    inbox: false,
                                    histories: new Set([threadId]),
                                });
                                state.entities = incoming;
                                for (const key of acceptedNow)
                                    acceptedReadOrder.set(key, order);
                                yield* rereadWindows(account, threadId);
                                for (const subscription of targetsFor(
                                    threadId,
                                )) {
                                    if (subscription.window) {
                                        subscription.window = {
                                            ...subscription.window,
                                            synchronization: 'idle',
                                            error: undefined,
                                            failedOperation: undefined,
                                        };
                                        if (
                                            !older &&
                                            current?.failedOperation ===
                                                'continuation' &&
                                            subscription.window.cursor ===
                                                current.cursor
                                        )
                                            subscription.window =
                                                preserveRuntime(
                                                    subscription.window,
                                                    current,
                                                    false,
                                                );
                                    }
                                }
                                pruneRuntimeReferences();
                                const projected = historyProjection(threadId);
                                const next: HistoryProjection | undefined =
                                    projected
                                        ? {
                                              ...projected,
                                              synchronization: 'idle' as const,
                                              error: undefined,
                                              failedOperation: undefined,
                                          }
                                        : undefined;
                                if (next) {
                                    if (
                                        !older &&
                                        current?.failedOperation ===
                                            'continuation' &&
                                        current.error &&
                                        next.cursor === current.cursor
                                    ) {
                                        next.synchronization = 'error';
                                        next.failedOperation = 'continuation';
                                        next.error = current.error;
                                    }
                                    touchRecent(threadId);
                                    update({
                                        ...state,
                                        histories: {
                                            ...state.histories,
                                            [threadId]: {
                                                ...next,
                                                freshness:
                                                    next.newerCoverageAvailable
                                                        ? 'stale'
                                                        : 'fresh',
                                            },
                                        },
                                    });
                                }
                            } else {
                                if (
                                    closed ||
                                    epoch !== state.accountEpoch ||
                                    account !== state.accountId ||
                                    detailGeneration.get(threadId) !==
                                        generation
                                )
                                    return;
                                const cause = commitResult.failure;
                                setHistoryRuntime(threadId, {
                                    freshness: 'stale',
                                    ...failed(
                                        older ? 'continuation' : 'refresh',
                                        errorOf(cause, 'storage'),
                                    ),
                                });
                            }
                        }),
                    ),
                onFailure: (cause) =>
                    Effect.sync(() => {
                        if (
                            !closed &&
                            account === state.accountId &&
                            epoch === state.accountEpoch &&
                            (detailInterest.get(threadId) ?? 0) > 0 &&
                            detailGeneration.get(threadId) === generation
                        ) {
                            const error = errorOf(cause, 'protocol');
                            if (error.kind === 'auth')
                                resetAccount(null, error);
                            else
                                setHistoryRuntime(
                                    threadId,
                                    failed(
                                        older ? 'continuation' : 'refresh',
                                        error,
                                    ),
                                );
                        }
                    }),
            },
        );
        const producer = start(work, () => {
            if (flights.get(key) === flight) flights.delete(key);
        });
        const flight: Flight = {
            fiber: producer.fiber,
            accountId: account,
            epoch,
            threadId,
            generation,
            readOrder: order,
        };
        flights.set(key, flight);
        producer.activate();
        yield* Fiber.join(flight.fiber);
    });

    function subscribe(
        listener: (value: InboxProjection) => void,
        threadId?: string,
        anchorId?: string,
        replaceListener?: (value: InboxProjection) => void,
    ) {
        if (closed) return () => undefined;
        const previous = replaceListener
            ? listeners.get(replaceListener)
            : undefined;
        const subscription: Listener = {
            notify: listener,
            authorized: previous?.authorized ?? false,
            anchorId,
        };
        listeners.set(listener, subscription);
        if (threadId) admit(subscription, threadId, previous);
        listener(listenerProjection(subscription));

        subscription.waiter = fork(
            Effect.matchEffect(ensureIdentity(!previous), {
                onSuccess: (accountId) =>
                    Effect.gen(function* () {
                        if (
                            closed ||
                            listeners.get(listener) !== subscription ||
                            accountId !== state.accountId
                        )
                            return;
                        subscription.authorized = true;
                        listener(listenerProjection(subscription));
                        if (subscription.threadId && !bootstrapFlight) {
                            yield* hydrateHistory(
                                accountId,
                                subscription.threadId,
                                [subscription],
                            );
                            if (
                                !closed &&
                                listeners.get(listener) === subscription &&
                                accountId === state.accountId &&
                                subscription.threadId &&
                                knownThread(subscription.threadId)
                            )
                                yield* runHistory(
                                    subscription.threadId,
                                    false,
                                    false,
                                );
                        } else if (!threadId) {
                            notify();
                        }
                    }),
                onFailure: () => Effect.void,
            }),
        );

        return () => {
            const current = listeners.get(listener);
            if (current !== subscription) return;
            listeners.delete(listener);
            for (const flight of flights.values())
                flight.waiters?.delete(current);
            detachFlights((flight) =>
                Boolean(flight.waiters && !flight.waiters.size),
            );
            if (current.waiter) fork(Fiber.interrupt(current.waiter));
            if (current.threadId) {
                touchRecent(current.threadId);
                const count = (detailInterest.get(current.threadId) ?? 1) - 1;
                if (count > 0) detailInterest.set(current.threadId, count);
                else {
                    detailInterest.delete(current.threadId);
                    detailGeneration.set(
                        current.threadId,
                        (detailGeneration.get(current.threadId) ?? 0) + 1,
                    );
                    detachFlights(
                        (flight) => flight.threadId === current.threadId,
                    );
                    if (
                        state.histories[current.threadId]?.synchronization ===
                        'refreshing'
                    )
                        setHistoryRuntime(current.threadId, {
                            synchronization: 'idle',
                        });
                }
            }
            pruneRuntimeReferences();
            notify();
        };
    }

    const refresh = Effect.fn('InboxEngine.refresh')(
        function* (): Effect.fn.Return<void, never> {
            const previousEpoch = state.accountEpoch;
            const identity = yield* Effect.result(ensureIdentity(true));
            if (identity._tag === 'Failure') return;
            const account = identity.success;
            if (previousEpoch !== state.accountEpoch) {
                if (bootstrapInboxFlight)
                    yield* Effect.ignore(Fiber.join(bootstrapInboxFlight));
                return;
            }
            yield* Effect.ignore(runInbox(undefined, account));
        },
    )();

    const loadMoreInbox = Effect.fn('InboxEngine.loadMoreInbox')(
        function* (): Effect.fn.Return<void, never> {
            const cursor = state.inbox.cursor;
            if (
                !state.inbox.hasNextPage ||
                !cursor ||
                state.inbox.retentionLimited
            )
                return;
            yield* Effect.ignore(runInbox(cursor));
        },
    )();

    const refreshHistory = Effect.fn('InboxEngine.refreshHistory')(function* (
        threadId: string,
        listener?: (value: InboxProjection) => void,
        anchorId?: string,
    ): Effect.fn.Return<void, never> {
        const target = listener ? listeners.get(listener) : undefined;
        if (
            listener &&
            (!target ||
                (target.threadId !== threadId &&
                    target.rejectedThreadId !== threadId))
        )
            return;
        const previousEpoch = state.accountEpoch;
        const identity = yield* Effect.result(ensureIdentity(true));
        if (identity._tag === 'Failure') return;

        for (const subscription of listeners.values()) {
            if (listener && subscription.notify !== listener) continue;
            if (subscription.rejectedThreadId === threadId) {
                subscription.authorized = true;
                admit(subscription, threadId);
            }
        }
        notify();

        if (!detailInterest.has(threadId)) return;
        const targets = targetsFor(threadId, listener);
        for (const target of targets)
            target.anchorId =
                anchorId ?? target.window?.orderedIds[0] ?? target.anchorId;
        yield* Effect.ignore(
            hydrateHistory(
                identity.success,
                threadId,
                targets,
                anchorId ? { anchorId } : undefined,
            ),
        );
        if (previousEpoch !== state.accountEpoch) return;
        if (!knownThread(threadId)) yield* Effect.ignore(runInbox(undefined));
        yield* Effect.ignore(runHistory(threadId, false, true));
    });

    function shiftHistory(
        threadId: string,
        listener: ((value: InboxProjection) => void) | undefined,
        direction: 'older' | 'newer',
    ) {
        return Effect.gen(function* () {
            const identity = yield* Effect.result(ensureIdentity());
            if (identity._tag === 'Failure') return;

            const accountId = identity.success;
            const targets = targetsFor(threadId, listener);
            const networkGroups = new Map<
                string | undefined,
                { window: HistoryProjection; targets: Listener[] }
            >();
            for (const target of targets) {
                if (!target.window)
                    yield* Effect.ignore(
                        hydrateHistory(accountId, threadId, [target]),
                    );
                const window = target.window;
                if (!window) continue;
                const cached =
                    direction === 'older'
                        ? window.cachedOlder
                        : window.cachedNewer;
                const anchorId =
                    direction === 'older'
                        ? window.orderedIds[0]
                        : window.orderedIds.at(-1);
                if (cached && anchorId)
                    yield* Effect.ignore(
                        hydrateHistory(accountId, threadId, [target], {
                            anchorId,
                            direction,
                            coverageGeneration: window.coverageGeneration,
                        }),
                    );
                else if (direction === 'newer' && window.newerCoverageAvailable)
                    yield* Effect.ignore(
                        hydrateHistory(accountId, threadId, [target], {
                            direction: 'newer',
                        }),
                    );
                else if (direction === 'older' && window.hasNextPage) {
                    const group = networkGroups.get(window.cursor);
                    if (group) group.targets.push(target);
                    else
                        networkGroups.set(window.cursor, {
                            window,
                            targets: [target],
                        });
                }
            }
            for (const group of networkGroups.values()) {
                const anchors = new Map(
                    group.targets.map((target) => [
                        target,
                        {
                            anchorId: target.window?.orderedIds[0],
                            coverageGeneration:
                                target.window?.coverageGeneration,
                        },
                    ]),
                );
                yield* Effect.ignore(
                    runHistory(threadId, true, false, group.window),
                );
                for (const target of group.targets) {
                    if (listeners.get(target.notify) !== target) continue;
                    const request = anchors.get(target);
                    if (request?.anchorId)
                        yield* Effect.ignore(
                            hydrateHistory(accountId, threadId, [target], {
                                ...request,
                                direction: 'older',
                            }),
                        );
                }
            }
        });
    }

    function loadOlderHistory(
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ) {
        return shiftHistory(threadId, listener, 'older');
    }
    function loadNewerHistory(
        threadId: string,
        listener?: (value: InboxProjection) => void,
    ) {
        return shiftHistory(threadId, listener, 'newer');
    }

    return {
        subscribe,
        refresh,
        loadMoreInbox,
        refreshHistory,
        loadOlderHistory,
        loadNewerHistory,
        snapshot: () => state,
    };
});

export const inboxEngineLive = Layer.effect(
    InboxEngineService,
    Effect.gen(function* () {
        const repository = yield* InboxRepositoryService;
        const provider = yield* InboxProviderService;
        return InboxEngineService.of(
            yield* makeInboxEngine(repository, provider),
        );
    }),
);
