import type { Message, Page, Thread, ThreadMessages } from '../domain.ts';
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

export interface InboxProvider {
    account(): Promise<string>;
    inbox(expectedAccountId: string, cursor?: string): Promise<Page<Thread>>;
    history(
        expectedAccountId: string,
        threadKey: string,
        cursor?: string,
    ): Promise<ThreadMessages>;
}

export type InboxEngine = {
    subscribe(
        listener: (value: InboxProjection) => void,
        threadId?: string,
    ): () => void;
    refresh(): Promise<void>;
    loadMoreInbox(): Promise<void>;
    refreshHistory(threadId: string): Promise<void>;
    loadOlderHistory(threadId: string): Promise<void>;
    snapshot(): InboxProjection;
};

const MAX_INBOX_SEGMENTS = 20;
const MAX_HISTORY_ROOTS = 20;
const MAX_HISTORY_SEGMENTS = 20;
const MAX_HISTORY_MESSAGES = 400;
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
};

export function createInboxEngine(
    repository: InboxRepository,
    provider: InboxProvider,
): InboxEngine {
    const listeners = new Map<(value: InboxProjection) => void, Listener>();
    const flights = new Map<string, Promise<void>>();
    const inboxSegments = new Map<string, PersistedResource>();
    const historySegments = new Map<string, PersistedResource>();
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
    let identityFlight: Promise<string> | undefined;
    let bootstrapFlight: Promise<void> | undefined;
    let hydratedEpoch = -1;
    let verified = false;
    let readOrder = 0;
    let networkReads = 0;
    const networkWaiters: Array<() => void> = [];
    let lane = Promise.resolve();

    function inLane<T>(work: () => Promise<T>): Promise<T> {
        const result = lane.then(work, work);
        lane = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    async function network<T>(
        work: () => Promise<T>,
        canStart = () => true,
    ): Promise<T | undefined> {
        if (networkReads >= MAX_NETWORK_READS)
            await new Promise<void>((resolve) => networkWaiters.push(resolve));
        if (!canStart()) {
            networkWaiters.shift()?.();
            return undefined;
        }
        networkReads++;
        try {
            return await work();
        } finally {
            networkReads--;
            networkWaiters.shift()?.();
        }
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

    function historyChain(threadId: string): PersistedResource[] {
        const head = historySegments.get(resourceKeyForHistory(threadId));
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
            const next = historySegments.get(
                resourceKeyForHistory(threadId, current.cursor),
            );
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

    function historyProjection(
        threadId: string,
    ): HistoryProjection | undefined {
        const chain = historyChain(threadId);
        const head = chain[0];
        if (!head) return state.histories[threadId];
        const previous = state.histories[threadId];
        const tail = chain.at(-1)!;
        const allIds = addUnique(
            [],
            chain
                .slice()
                .reverse()
                .flatMap((resource) => resource.orderedIds),
        );
        const ids = allIds.slice(-MAX_HISTORY_MESSAGES);
        const result: HistoryProjection = {
            ...head,
            threadId,
            orderedIds: ids,
            cursor: tail.cursor,
            hasNextPage: tail.hasNextPage,
            viewerId: previous?.viewerId ?? head.viewerId,
            availability: 'present',
            synchronization: 'idle',
        };
        if (
            allIds.length > MAX_HISTORY_MESSAGES ||
            (ids.length >= MAX_HISTORY_MESSAGES && tail.hasNextPage)
        )
            result.retentionLimited = true;
        return result;
    }

    function allHistories(): Record<string, HistoryProjection> {
        const ids = new Set<string>();
        for (const resource of historySegments.values())
            if (resource.threadId) ids.add(resource.threadId);
        const histories: Record<string, HistoryProjection> = {};
        for (const id of ids) {
            const value = historyProjection(id);
            if (value) histories[id] = value;
        }
        return histories;
    }

    function projectFor(threadId?: string): InboxProjection {
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
                .map((id) => [id, state.histories[id] ?? historyProjection(id)])
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

    function notify() {
        for (const {
            notify: listener,
            threadId,
            authorized,
        } of listeners.values())
            listener(
                authorized || !state.accountId
                    ? projectFor(threadId)
                    : checkingProjection(),
            );
    }

    function update(next: InboxProjection) {
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

    function resetAccount(accountId: string | null, error?: EngineError) {
        inboxSegments.clear();
        historySegments.clear();
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
        result: {
            resources: PersistedResource[];
            entities: EntityFacts;
            revision: number;
        },
        replace = false,
        affected: { inbox: boolean; histories: Set<string> } = {
            inbox: false,
            histories: new Set(),
        },
    ) {
        if (replace) {
            inboxSegments.clear();
            historySegments.clear();
        }
        for (const resource of result.resources) {
            if (resource.key.startsWith('inbox:primary'))
                inboxSegments.set(resource.key, resource);
            else if (
                resource.threadId &&
                resource.key.startsWith(`history:${resource.threadId}`)
            ) {
                historySegments.set(resource.key, resource);
            }
        }
        const inbox = preserveRuntime(
            inboxProjection(),
            state.inbox,
            affected.inbox,
        );
        const histories = allHistories();
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
            entities: replace
                ? copyFacts(result.entities)
                : {
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
        for (const key of acceptedReadOrder.keys()) {
            const separator = key.indexOf(':');
            const kind = key.slice(0, separator);
            const id = key.slice(separator + 1);
            if (
                (kind === 'thread' && !state.entities.threadsById[id]) ||
                (kind === 'user' && !state.entities.usersById[id]) ||
                (kind === 'message' && !state.entities.messagesById[id])
            )
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

    async function hydrate(accountId: string, keys: string[], epoch: number) {
        await inLane(async () => {
            const result = await repository.readResources(accountId, keys);
            if (epoch !== state.accountEpoch || accountId !== state.accountId)
                return;
            installRead(result);
            update(state);
        });
    }

    async function bootstrap(accountId: string, epoch: number) {
        const keys = ['inbox:primary', 'inbox:primary:page:*'];
        for (const id of detailInterest.keys())
            keys.push(`history:${id}`, `history:${id}:page:*`);
        try {
            await hydrate(accountId, [...new Set(keys)], epoch);
        } catch (cause) {
            if (epoch === state.accountEpoch && accountId === state.accountId) {
                setInboxRuntime(failed('refresh', errorOf(cause, 'storage')));
            }
        }
        hydratedEpoch = epoch;
        if (epoch !== state.accountEpoch || accountId !== state.accountId)
            return;
        const inboxFlight = runInbox(undefined, accountId, epoch);
        void inboxFlight
            .then(() => {
                for (const id of detailInterest.keys()) {
                    if (knownThread(id))
                        void runHistory(id, false, false).catch(
                            () => undefined,
                        );
                }
            })
            .catch(() => undefined);
        for (const id of detailInterest.keys()) {
            if (knownThread(id))
                void runHistory(id, false, false).catch(() => undefined);
        }
    }

    async function ensureIdentity(force = false): Promise<string> {
        if (identityFlight) return identityFlight;
        if (!force && verified && state.accountId) return state.accountId;
        const identityEpoch = state.accountEpoch;
        const flight = provider.account().then(async (accountId) => {
            if (
                identityEpoch !== state.accountEpoch &&
                state.accountId !== null
            )
                return state.accountId;
            if (state.accountId !== accountId) resetAccount(accountId);
            verified = true;
            if (hydratedEpoch !== state.accountEpoch && !bootstrapFlight) {
                const epoch = state.accountEpoch;
                bootstrapFlight = bootstrap(accountId, epoch).finally(() => {
                    bootstrapFlight = undefined;
                });
            }
            await bootstrapFlight;
            return accountId;
        });
        const checked = flight
            .catch((cause) => {
                if (identityEpoch === state.accountEpoch) {
                    verified = false;
                    const error = errorOf(cause, 'provider_unavailable');
                    if (error.kind === 'auth') resetAccount(null, error);
                    else
                        setInboxRuntime({
                            freshness: 'stale',
                            ...failed('refresh', error),
                        });
                }
                throw cause;
            })
            .finally(() => {
                if (identityFlight === checked) identityFlight = undefined;
            });
        identityFlight = checked;
        return checked;
    }

    function knownThread(threadId: string): boolean {
        return Boolean(
            state.entities.threadsById[threadId] ||
                state.histories[threadId] ||
                historySegments.has(resourceKeyForHistory(threadId)),
        );
    }

    function activeInboxKeys(): Set<string> {
        return new Set(inboxChain().map((resource) => resource.key));
    }

    function activeHistoryKeys(threadId: string): Set<string> {
        return new Set(historyChain(threadId).map((resource) => resource.key));
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

    function historyDeletes(
        threadId: string,
        forKey: string,
    ): string[] | undefined {
        const keys = [...historySegments.keys()].filter((key) =>
            key.startsWith(`history:${threadId}:page:`),
        );
        const addsSegment = !historySegments.has(forKey);
        if (keys.length + (addsSegment ? 1 : 0) < MAX_HISTORY_SEGMENTS)
            return undefined;
        const active = activeHistoryKeys(threadId);
        const candidateKey = keys
            .sort(
                (a, b) =>
                    historySegments.get(a)!.fetchedAt -
                    historySegments.get(b)!.fetchedAt,
            )
            .find((key) => !active.has(key));
        return candidateKey ? [candidateKey] : undefined;
    }

    function evictInactiveHistoryRoot(): string[] | undefined {
        const roots = [
            ...new Set(
                [...historySegments.values()]
                    .filter(
                        (resource) =>
                            resource.threadId !== undefined &&
                            resource.key ===
                                resourceKeyForHistory(resource.threadId),
                    )
                    .flatMap((resource) =>
                        resource.threadId ? [resource.threadId] : [],
                    ),
            ),
        ];
        if (roots.length < MAX_HISTORY_ROOTS) return undefined;
        const root = [
            ...recentHistories.slice().reverse(),
            ...roots.filter((id) => !recentHistories.includes(id)),
        ].find(
            (id) => roots.includes(id) && (detailInterest.get(id) ?? 0) === 0,
        );
        if (!root) return undefined;
        return [...historySegments.values()]
            .filter((resource) => resource.threadId === root)
            .map((resource) => resource.key);
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

    async function runInbox(
        cursor: string | undefined,
        accountId?: string,
        epoch = state.accountEpoch,
    ): Promise<void> {
        const account = accountId ?? (await ensureIdentity());
        const key = `inbox:${state.accountEpoch}:${account}:${cursor ?? 'head'}`;
        const current = flights.get(key);
        if (current) return current;
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
        const work = network(
            () => provider.inbox(account, cursor),
            () => epoch === state.accountEpoch && account === state.accountId,
        )
            .then((page) =>
                inLane(async () => {
                    if (!page) {
                        if (
                            epoch === state.accountEpoch &&
                            account === state.accountId &&
                            state.inbox.synchronization === 'refreshing'
                        )
                            setInboxRuntime({ synchronization: 'idle' });
                        return;
                    }
                    if (
                        epoch !== state.accountEpoch ||
                        account !== state.accountId
                    )
                        return;
                    const normalized = normalizePage(page);
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
                    try {
                        const commitUpdate = {
                            resources: [record],
                            entities: merged,
                            deleteKeys,
                        };
                        const committed = await repository.commitResources(
                            account,
                            commitUpdate,
                        );
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
                        pruneRuntimeReferences();
                        for (const key of acceptedNow)
                            acceptedReadOrder.set(key, order);
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
                    } catch (cause) {
                        setInboxRuntime({
                            freshness: 'stale',
                            ...failed(
                                cursor ? 'continuation' : 'refresh',
                                errorOf(cause, 'storage'),
                            ),
                        });
                    }
                }),
            )
            .catch((cause) => {
                if (epoch !== state.accountEpoch || account !== state.accountId)
                    return;
                const error = errorOf(cause, 'protocol');
                if (error.kind === 'auth') resetAccount(null, error);
                else
                    setInboxRuntime(
                        failed(cursor ? 'continuation' : 'refresh', error),
                    );
            });
        flights.set(key, work);
        void work.then(
            () => {
                if (flights.get(key) === work) flights.delete(key);
            },
            () => {
                if (flights.get(key) === work) flights.delete(key);
            },
        );
        return work;
    }

    async function runHistory(
        threadId: string,
        older: boolean,
        force: boolean,
    ): Promise<void> {
        const account = await ensureIdentity();
        const interest = detailInterest.get(threadId) ?? 0;
        const generation = detailGeneration.get(threadId) ?? 0;
        if (!knownThread(threadId) || interest === 0) return;
        const current =
            state.histories[threadId] ?? historyProjection(threadId);
        if (older && (!current?.hasNextPage || current.retentionLimited))
            return;
        if (!older && !force && current?.availability === 'present') return;
        const cursor = older ? current?.cursor : undefined;
        const key = `history:${state.accountEpoch}:${threadId}:${generation}:${cursor ?? 'head'}`;
        const existing = flights.get(key);
        if (existing) return existing;
        const epoch = state.accountEpoch;
        const order = ++readOrder;
        setHistoryRuntime(threadId, {
            synchronization: 'refreshing',
            error: undefined,
        });
        const work = network(
            () =>
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
        )
            .then((result) =>
                inLane(async () => {
                    if (!result) {
                        if (
                            epoch === state.accountEpoch &&
                            detailGeneration.get(threadId) === generation &&
                            (detailInterest.get(threadId) ?? 0) > 0
                        )
                            setHistoryRuntime(threadId, {
                                synchronization: 'idle',
                            });
                        return;
                    }
                    if (
                        epoch !== state.accountEpoch ||
                        account !== state.accountId
                    )
                        return;
                    if (
                        (detailInterest.get(threadId) ?? 0) === 0 ||
                        detailGeneration.get(threadId) !== generation
                    )
                        return;
                    const messages = normalizeMessages(result.items, threadId);
                    const normalized: ResourceProjection = {
                        orderedIds: uniqueIds(
                            messages.map((message) => message.id),
                        ),
                        fetchedAt: Date.now(),
                        hasNextPage: result.hasNextPage,
                        availability: 'present',
                        freshness: 'fresh',
                        synchronization: 'idle',
                    };
                    if (result.cursor) normalized.cursor = result.cursor;
                    const chain = historyChain(threadId);
                    const activeIds = chain.flatMap(
                        (resource) => resource.orderedIds,
                    );
                    if (
                        noProgress(
                            cursor,
                            result.cursor,
                            normalized.orderedIds,
                            activeIds,
                            chain,
                            result.hasNextPage,
                        )
                    ) {
                        setHistoryRuntime(
                            threadId,
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
                    const resourceKey = resourceKeyForHistory(threadId, cursor);
                    const deletes = historyDeletes(threadId, resourceKey) ?? [];
                    if (
                        !historySegments.has(resourceKey) &&
                        deletes.length === 0 &&
                        [...historySegments.keys()].filter((key) =>
                            key.startsWith(`history:${threadId}:page:`),
                        ).length >= MAX_HISTORY_SEGMENTS
                    ) {
                        setHistoryRuntime(threadId, {
                            ...failed('continuation', capacityError()),
                            retentionLimited: true,
                        });
                        return;
                    }
                    const retainedIds = older
                        ? uniqueIds(
                              historyChain(threadId).flatMap(
                                  (resource) => resource.orderedIds,
                              ),
                          )
                        : [];
                    const available = Math.max(
                        0,
                        MAX_HISTORY_MESSAGES - retainedIds.length,
                    );
                    const newIds = normalized.orderedIds.filter(
                        (id) => !retainedIds.includes(id),
                    );
                    normalized.orderedIds = newIds.slice(0, available);
                    if (newIds.length > available)
                        normalized.retentionLimited = true;
                    const isNewRoot = !historySegments.has(
                        resourceKeyForHistory(threadId),
                    );
                    const rootDeletes = isNewRoot
                        ? evictInactiveHistoryRoot()
                        : undefined;
                    const rootCount = new Set(
                        [...historySegments.values()]
                            .filter(
                                (resource) =>
                                    resource.threadId !== undefined &&
                                    resource.key ===
                                        resourceKeyForHistory(
                                            resource.threadId,
                                        ),
                            )
                            .map((resource) => resource.threadId),
                    ).size;
                    if (
                        isNewRoot &&
                        rootDeletes === undefined &&
                        rootCount >= MAX_HISTORY_ROOTS
                    ) {
                        setHistoryRuntime(
                            threadId,
                            failed('refresh', capacityError()),
                        );
                        return;
                    }
                    const allDeletes = uniqueIds([
                        ...deletes,
                        ...(rootDeletes ?? []),
                    ]);
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
                    const viewerId = current?.viewerId ?? result.viewerId;
                    const record = recordFor(
                        resourceKey,
                        normalized,
                        incoming,
                        threadId,
                        viewerId,
                        cursor,
                    );
                    try {
                        const commitUpdate = {
                            resources: [record],
                            entities: incoming,
                            deleteKeys: allDeletes,
                        };
                        const committed = await repository.commitResources(
                            account,
                            commitUpdate,
                        );
                        if (
                            epoch !== state.accountEpoch ||
                            account !== state.accountId
                        )
                            return;
                        for (const deleteKey of allDeletes) {
                            historySegments.delete(deleteKey);
                        }
                        installRead(committed, true, {
                            inbox: false,
                            histories: new Set([threadId]),
                        });
                        pruneRuntimeReferences();
                        for (const key of acceptedNow)
                            acceptedReadOrder.set(key, order);
                        const next = historyProjection(threadId);
                        if (next) {
                            if (
                                !older &&
                                current?.failedOperation === 'continuation' &&
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
                                        freshness: 'fresh',
                                    },
                                },
                            });
                        }
                    } catch (cause) {
                        setHistoryRuntime(threadId, {
                            freshness: 'stale',
                            ...failed(
                                older ? 'continuation' : 'refresh',
                                errorOf(cause, 'storage'),
                            ),
                        });
                    }
                }),
            )
            .catch((cause) => {
                if (
                    epoch === state.accountEpoch &&
                    (detailInterest.get(threadId) ?? 0) > 0 &&
                    detailGeneration.get(threadId) === generation
                ) {
                    const error = errorOf(cause, 'protocol');
                    if (error.kind === 'auth') resetAccount(null, error);
                    else
                        setHistoryRuntime(
                            threadId,
                            failed(older ? 'continuation' : 'refresh', error),
                        );
                }
            });
        flights.set(key, work);
        void work.then(
            () => {
                if (flights.get(key) === work) flights.delete(key);
            },
            () => {
                if (flights.get(key) === work) flights.delete(key);
            },
        );
        return work;
    }

    function subscribe(
        listener: (value: InboxProjection) => void,
        threadId?: string,
    ) {
        if (
            threadId &&
            !detailInterest.has(threadId) &&
            detailInterest.size >= MAX_HISTORY_ROOTS
        ) {
            const projection = projectFor(threadId);
            projection.histories[threadId] = {
                threadId,
                orderedIds: [],
                fetchedAt: 0,
                hasNextPage: false,
                availability: 'absent',
                freshness: 'stale',
                synchronization: 'error',
                error: capacityError(),
                failedOperation: 'refresh',
            };
            listener(projection);
            return () => undefined;
        }
        const hadListeners = listeners.size > 0;
        const subscription: Listener = {
            notify: listener,
            threadId,
            authorized: hadListeners && verified && !identityFlight,
        };
        listeners.set(listener, subscription);
        if (threadId) {
            const count = detailInterest.get(threadId) ?? 0;
            if (count === 0)
                detailGeneration.set(
                    threadId,
                    (detailGeneration.get(threadId) ?? 0) + 1,
                );
            detailInterest.set(threadId, count + 1);
            touchRecent(threadId);
        }
        if (subscription.authorized || !state.accountId) {
            listener(projectFor(threadId));
        } else {
            listener(checkingProjection());
        }
        void ensureIdentity(!hadListeners)
            .then(async (accountId) => {
                if (listeners.get(listener) !== subscription) return;
                subscription.authorized = true;
                listener(projectFor(threadId));
                if (threadId && !bootstrapFlight) {
                    await hydrate(
                        accountId,
                        [`history:${threadId}`, `history:${threadId}:page:*`],
                        state.accountEpoch,
                    );
                    if (knownThread(threadId))
                        await runHistory(threadId, false, false);
                } else if (!threadId) {
                    notify();
                }
            })
            .catch(() => undefined);
        return () => {
            const current = listeners.get(listener);
            if (!current) return;
            listeners.delete(listener);
            if (current.threadId) {
                const count = (detailInterest.get(current.threadId) ?? 1) - 1;
                if (count > 0) detailInterest.set(current.threadId, count);
                else {
                    detailInterest.delete(current.threadId);
                    detailGeneration.set(
                        current.threadId,
                        (detailGeneration.get(current.threadId) ?? 0) + 1,
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
        };
    }

    async function refresh(): Promise<void> {
        try {
            const previousEpoch = state.accountEpoch;
            const account = await ensureIdentity(true);
            if (previousEpoch !== state.accountEpoch) return;
            await runInbox(undefined, account);
        } catch {
            // The failed identity is already represented in the projection.
        }
    }

    async function loadMoreInbox(): Promise<void> {
        const cursor = state.inbox.cursor;
        if (!state.inbox.hasNextPage || !cursor || state.inbox.retentionLimited)
            return;
        await runInbox(cursor);
    }

    async function refreshHistory(threadId: string): Promise<void> {
        try {
            const previousEpoch = state.accountEpoch;
            await ensureIdentity(true);
            if (previousEpoch !== state.accountEpoch) return;
            if (!knownThread(threadId)) await runInbox(undefined);
            await runHistory(threadId, false, true);
        } catch {
            // Explicit operations publish their errors on the resource.
        }
    }

    async function loadOlderHistory(threadId: string): Promise<void> {
        try {
            await runHistory(threadId, true, false);
        } catch {
            // Explicit operations publish their errors on the resource.
        }
    }

    return {
        subscribe,
        refresh,
        loadMoreInbox,
        refreshHistory,
        loadOlderHistory,
        snapshot: () => state,
    };
}
