import { Context, Effect, Layer, Result } from 'effect';
import { migrateHistoryStorage, storageRepository } from './history-storage.ts';
import type { Message, User } from '../domain.ts';
import {
    isBoolean,
    isJsonObject,
    isNumber,
    isString,
    type JsonObject,
    type JsonValue,
} from '../json.ts';
import {
    InboxError,
    type HistoryInventory,
    type HistoryWindowRequest,
    type HistoryWindowRead,
    type EntityFacts,
    type InboxRepository,
    type PersistedResource,
    type RepositoryRead,
    type ResourceCommit,
    type ThreadFact,
} from './resources.ts';

const DB_NAME = 'icr-successor';
const FACT_STORE_NAMES = ['users', 'threads', 'messages'] as const;

type LegacyResource = {
    orderedIds: string[];
    fetchedAt: number;
    cursor?: string;
    hasNextPage: boolean;
};

function isStringArray(value: JsonValue | undefined): value is string[] {
    return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
    );
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
    return isNumber(value) && Number.isFinite(value);
}

function isEngineError(
    value: JsonValue | undefined,
): value is { kind: string; message: string } {
    if (!isJsonObject(value)) return false;
    return typeof value.kind === 'string' && typeof value.message === 'string';
}

function validResource(
    value: JsonValue | undefined,
): value is PersistedResource {
    if (!isJsonObject(value)) return false;
    if (typeof value.key !== 'string' || !isStringArray(value.orderedIds))
        return false;
    if (
        !isFiniteNumber(value.fetchedAt) ||
        typeof value.hasNextPage !== 'boolean'
    )
        return false;
    if (value.cursor !== undefined && typeof value.cursor !== 'string')
        return false;
    if (value.threadId !== undefined && typeof value.threadId !== 'string')
        return false;
    if (value.viewerId !== undefined && typeof value.viewerId !== 'string')
        return false;
    if (
        value.chunkCount !== undefined &&
        (!isFiniteNumber(value.chunkCount) ||
            !Number.isSafeInteger(value.chunkCount) ||
            value.chunkCount < 0)
    )
        return false;
    if (
        value.activeGeneration !== undefined &&
        (!isFiniteNumber(value.activeGeneration) ||
            !Number.isSafeInteger(value.activeGeneration) ||
            value.activeGeneration < 0)
    )
        return false;
    if (
        value.requestCursor !== undefined &&
        typeof value.requestCursor !== 'string'
    )
        return false;
    if (value.availability !== 'absent' && value.availability !== 'present')
        return false;
    if (value.freshness !== 'fresh' && value.freshness !== 'stale')
        return false;
    if (
        !['idle', 'refreshing', 'error'].includes(String(value.synchronization))
    )
        return false;
    if (value.error !== undefined && !isEngineError(value.error)) return false;
    if (
        value.retentionLimited !== undefined &&
        typeof value.retentionLimited !== 'boolean'
    )
        return false;
    if (
        value.failedOperation !== undefined &&
        value.failedOperation !== 'refresh' &&
        value.failedOperation !== 'continuation'
    )
        return false;

    if (!isJsonObject(value.refs)) return false;
    return (
        isStringArray(value.refs.threadIds) &&
        isStringArray(value.refs.userIds) &&
        isStringArray(value.refs.messageIds)
    );
}

function validUser(value: JsonValue | undefined, id: string): value is User {
    if (!isJsonObject(value)) return false;
    return (
        value.id === id &&
        typeof value.username === 'string' &&
        typeof value.fullName === 'string' &&
        (value.picUrl === null || typeof value.picUrl === 'string')
    );
}

function validOptionalString(value: JsonObject, key: string): boolean {
    return value[key] === undefined || isString(value[key]);
}

function validOptionalNumber(value: JsonObject, key: string): boolean {
    return value[key] === undefined || isFiniteNumber(value[key]);
}

function validReplyPreview(value: JsonValue | undefined): boolean {
    if (!isJsonObject(value) || !isString(value.kind)) return false;
    if (value.kind === 'text') return isString(value.text);
    if (value.kind === 'media') {
        return (
            isString(value.title) &&
            validOptionalString(value, 'thumbUrl') &&
            validOptionalString(value, 'subtitle')
        );
    }
    return value.kind === 'unavailable' && isString(value.label);
}

function validReaction(value: JsonValue | undefined): boolean {
    return (
        isJsonObject(value) &&
        isString(value.senderId) &&
        isString(value.reaction) &&
        validOptionalNumber(value, 'timestampMs')
    );
}

function validImage(value: JsonValue | undefined): boolean {
    if (!isJsonObject(value) || !isString(value.url)) return false;
    return (
        validOptionalString(value, 'previewUrl') &&
        validOptionalNumber(value, 'width') &&
        validOptionalNumber(value, 'height')
    );
}

function validSentMessageFields(value: JsonObject): boolean {
    return (
        isString(value.senderId) &&
        validOptionalString(value, 'repliedTo') &&
        (value.replyPreview === undefined ||
            validReplyPreview(value.replyPreview))
    );
}

function validMessage(
    value: JsonValue | undefined,
    id: string,
): value is Message {
    if (
        !isJsonObject(value) ||
        value.id !== id ||
        !isFiniteNumber(value.ts) ||
        (value.isSyntheticId !== undefined && value.isSyntheticId !== true) ||
        (value.reactions !== undefined &&
            (!Array.isArray(value.reactions) ||
                !value.reactions.every((reaction) =>
                    validReaction(reaction),
                ))) ||
        (value.isPinned !== undefined && !isBoolean(value.isPinned)) ||
        !isString(value.kind)
    )
        return false;

    switch (value.kind) {
        case 'text':
            return isString(value.text) && validSentMessageFields(value);
        case 'activity':
            return isString(value.text);
        case 'reaction_log':
            return isString(value.fragment);
        case 'image':
            return (
                validSentMessageFields(value) &&
                Array.isArray(value.images) &&
                value.images.every((image) => validImage(image))
            );
        case 'reel_share':
            return (
                validSentMessageFields(value) &&
                (value.mediaType === 'reel' || value.mediaType === 'post') &&
                isString(value.shortcode) &&
                isString(value.targetUrl) &&
                isString(value.thumbUrl) &&
                isString(value.author) &&
                validOptionalString(value, 'caption') &&
                validOptionalString(value, 'mediaId') &&
                validOptionalNumber(value, 'previewWidth') &&
                validOptionalNumber(value, 'previewHeight')
            );
        case 'inline_share':
            return (
                validSentMessageFields(value) &&
                isString(value.thumbUrl) &&
                isString(value.title) &&
                validOptionalString(value, 'targetUrl') &&
                validOptionalString(value, 'subtitle')
            );
        case 'unsupported':
            return (
                validSentMessageFields(value) &&
                isString(value.contentType) &&
                isJsonObject(value.fallback) &&
                isString(value.fallback.label) &&
                validOptionalString(value.fallback, 'preview') &&
                validOptionalString(value.fallback, 'targetUrl') &&
                validOptionalString(value.fallback, 'thumbUrl')
            );
        default:
            return false;
    }
}

function validThread(
    value: JsonValue | undefined,
    id: string,
): value is ThreadFact {
    if (!isJsonObject(value)) return false;
    return (
        value.key === id &&
        typeof value.title === 'string' &&
        typeof value.isGroup === 'boolean' &&
        typeof value.isMuted === 'boolean' &&
        typeof value.folder === 'string' &&
        isFiniteNumber(value.lastActivityMs) &&
        typeof value.isUnread === 'boolean' &&
        typeof value.serverIsPin === 'boolean' &&
        isStringArray(value.userIds) &&
        (value.lastMessageId === undefined ||
            typeof value.lastMessageId === 'string')
    );
}

function validEntities(value: EntityFacts): boolean {
    if (
        !isJsonObject(value.threadsById) ||
        !isJsonObject(value.usersById) ||
        !isJsonObject(value.messagesById)
    )
        return false;
    for (const [id, fact] of Object.entries(value.threadsById))
        if (!validThread(fact, id)) return false;
    for (const [id, user] of Object.entries(value.usersById))
        if (!validUser(user, id)) return false;
    for (const [id, message] of Object.entries(value.messagesById))
        if (!validMessage(message, id)) return false;
    return true;
}

function validStoredFact(
    kind: 'threads' | 'users' | 'messages',
    id: string,
    value: JsonValue | undefined,
): boolean {
    return kind === 'threads'
        ? validThread(value, id)
        : kind === 'users'
          ? validUser(value, id)
          : validMessage(value, id);
}

function validAccountId(accountId: string): boolean {
    return accountId.length > 0;
}

function validKey(key: string): boolean {
    return key.length > 0;
}

type StoredEnvelope = JsonObject & {
    accountId: string;
    id: string;
    value: JsonValue | undefined;
};

function storedRow(value: JsonValue | undefined): value is StoredEnvelope {
    if (!isJsonObject(value)) return false;
    return (
        typeof value.accountId === 'string' &&
        typeof value.id === 'string' &&
        validKey(value.id) &&
        'value' in value
    );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new InboxError('storage'));
    });
}

function abortUpgrade(transaction: IDBTransaction): void {
    try {
        transaction.abort();
    } catch {
        // An IDB request error may have already started the abort.
    }
}

type LegacyRow = {
    accountId: string;
    id: string;
    value: JsonValue | undefined;
};

function legacyRows(values: JsonValue[]): LegacyRow[] {
    const rows: LegacyRow[] = [];
    for (const value of values) {
        if (!storedRow(value) || !validAccountId(value.accountId))
            throw new Error('Invalid v1 record envelope');
        rows.push({
            accountId: value.accountId,
            id: value.id,
            value: value.value,
        });
    }
    return rows;
}

function legacyResource(
    value: JsonValue | undefined,
): LegacyResource | undefined {
    if (
        !isJsonObject(value) ||
        !isStringArray(value.orderedIds) ||
        !isFiniteNumber(value.fetchedAt) ||
        !isBoolean(value.hasNextPage)
    )
        return undefined;
    if (value.cursor !== undefined && !isString(value.cursor)) return undefined;
    if (
        value.refs !== undefined &&
        (!isJsonObject(value.refs) ||
            !isStringArray(value.refs.threadIds) ||
            !isStringArray(value.refs.userIds) ||
            !isStringArray(value.refs.messageIds))
    )
        return undefined;
    const result: LegacyResource = {
        orderedIds: value.orderedIds,
        fetchedAt: value.fetchedAt,
        hasNextPage: value.hasNextPage,
    };
    if (value.cursor !== undefined) result.cursor = value.cursor;
    return result;
}

async function migrateV1(
    transaction: IDBTransaction,
    usersStore: IDBObjectStore,
    threadsStore: IDBObjectStore,
    messagesStore: IDBObjectStore,
    resourcesStore: IDBObjectStore,
): Promise<void> {
    try {
        const usersRequest = requestResult(usersStore.getAll());
        const threadsRequest = requestResult(threadsStore.getAll());
        const messagesRequest = requestResult(messagesStore.getAll());
        const resourcesRequest = requestResult(resourcesStore.getAll());
        const [rawUsers, rawThreads, rawMessages, rawResources] =
            await Promise.all([
                usersRequest,
                threadsRequest,
                messagesRequest,
                resourcesRequest,
            ]);

        const users = legacyRows(rawUsers);
        const threads = legacyRows(rawThreads);
        const messages = legacyRows(rawMessages);
        const resources = legacyRows(rawResources);
        const usersByAccount = new Map<string, Map<string, User>>();
        const threadsByAccount = new Map<string, Map<string, ThreadFact>>();
        const messagesByAccount = new Map<string, Map<string, Message>>();
        for (const row of users) {
            if (!validAccountId(row.accountId) || !validUser(row.value, row.id))
                throw new Error('Invalid v1 user');
            const facts =
                usersByAccount.get(row.accountId) ?? new Map<string, User>();
            facts.set(row.id, row.value);
            usersByAccount.set(row.accountId, facts);
        }
        for (const row of threads) {
            if (
                !validAccountId(row.accountId) ||
                !validThread(row.value, row.id)
            )
                throw new Error('Invalid v1 thread');
            const facts =
                threadsByAccount.get(row.accountId) ??
                new Map<string, ThreadFact>();
            facts.set(row.id, row.value);
            threadsByAccount.set(row.accountId, facts);
        }
        for (const row of messages) {
            if (
                !validAccountId(row.accountId) ||
                !validMessage(row.value, row.id)
            )
                throw new Error('Invalid v1 message');
            const facts =
                messagesByAccount.get(row.accountId) ??
                new Map<string, Message>();
            facts.set(row.id, row.value);
            messagesByAccount.set(row.accountId, facts);
        }

        for (const row of resources) {
            if (!validAccountId(row.accountId))
                throw new Error('Invalid v1 resource account');
            const old = legacyResource(row.value);
            if (!old) throw new Error('Invalid v1 resource');
            const threadFacts =
                threadsByAccount.get(row.accountId) ??
                new Map<string, ThreadFact>();
            const userFacts =
                usersByAccount.get(row.accountId) ?? new Map<string, User>();
            const messageFacts =
                messagesByAccount.get(row.accountId) ??
                new Map<string, Message>();
            const threadIds = [...new Set(old.orderedIds)];
            const userIds = new Set<string>();
            const messageIds = new Set<string>();
            for (const threadId of threadIds) {
                const thread = threadFacts.get(threadId);
                if (!thread) throw new Error('Invalid v1 thread reference');
                for (const userId of thread.userIds) {
                    if (!userFacts.has(userId))
                        throw new Error('Invalid v1 user reference');
                    userIds.add(userId);
                }
                if (thread.lastMessageId) {
                    if (!messageFacts.has(thread.lastMessageId))
                        throw new Error('Invalid v1 message reference');
                    messageIds.add(thread.lastMessageId);
                }
            }
            const resource: PersistedResource = {
                key: row.id,
                ...old,
                availability: 'present',
                freshness: 'stale',
                synchronization: 'idle',
                refs: {
                    threadIds,
                    userIds: [...userIds],
                    messageIds: [...messageIds],
                },
            };
            if (!validResource(resource))
                throw new Error('Invalid migrated resource');
            resourcesStore.put({
                accountId: row.accountId,
                id: row.id,
                value: resource,
            });
        }
    } catch {
        abortUpgrade(transaction);
    }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DB_NAME, 4);
        request.onupgradeneeded = (event) => {
            const database = request.result;
            const transaction = request.transaction;
            if (!transaction) {
                reject(new InboxError('storage'));
                return;
            }

            try {
                let resourcesStore: IDBObjectStore;
                if (event.oldVersion < 1) {
                    for (const name of FACT_STORE_NAMES) {
                        const store = database.createObjectStore(name, {
                            keyPath: ['accountId', 'id'],
                        });
                        store.createIndex('accountId', 'accountId');
                    }
                    resourcesStore = database.createObjectStore('resources', {
                        keyPath: ['accountId', 'id'],
                    });
                    resourcesStore.createIndex('accountId', 'accountId');
                    database.createObjectStore('meta');
                } else {
                    resourcesStore = transaction.objectStore('resources');
                }

                if (event.oldVersion < 4) {
                    database.createObjectStore('historyPrevious', {
                        keyPath: ['accountId', 'threadId'],
                    });
                    const previous = database.createObjectStore(
                        'historyPreviousOrder',
                        {
                            keyPath: ['accountId', 'threadId', 'messageId'],
                        },
                    );
                    previous.createIndex('rank', [
                        'accountId',
                        'threadId',
                        'generation',
                        'rank',
                    ]);
                    previous.createIndex('thread', ['accountId', 'threadId']);
                }

                if (event.oldVersion < 3) {
                    database.createObjectStore('refs', {
                        keyPath: ['accountId', 'kind', 'id'],
                    });
                    const inventory = database.createObjectStore(
                        'historyInventory',
                        { keyPath: ['accountId', 'threadId'] },
                    );
                    inventory.createIndex('accountId', 'accountId');
                    inventory.createIndex('access', [
                        'accountId',
                        'lastAccessedAt',
                        'threadId',
                    ]);
                    const order = database.createObjectStore('historyOrder', {
                        keyPath: ['accountId', 'threadId', 'messageId'],
                    });
                    order.createIndex('rank', [
                        'accountId',
                        'threadId',
                        'generation',
                        'rank',
                    ]);
                    order.createIndex('thread', ['accountId', 'threadId']);
                    const chunks = database.createObjectStore('historyChunks', {
                        keyPath: ['accountId', 'resourceKey', 'part'],
                    });
                    chunks.createIndex('resource', [
                        'accountId',
                        'resourceKey',
                    ]);
                    void (async () => {
                        if (event.oldVersion > 0 && event.oldVersion < 2) {
                            await migrateV1(
                                transaction,
                                transaction.objectStore('users'),
                                transaction.objectStore('threads'),
                                transaction.objectStore('messages'),
                                resourcesStore,
                            );
                        }
                        await migrateHistoryStorage(
                            transaction,
                            validResource,
                            validStoredFact,
                        );
                    })().catch(() => abortUpgrade(transaction));
                }
            } catch {
                abortUpgrade(transaction);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new InboxError('storage'));
    });
}

export function createInboxRepository(
    factory: IDBFactory = globalThis.indexedDB,
): InboxRepository {
    let opened: Promise<IDBDatabase> | undefined;
    let openedDatabase: IDBDatabase | undefined;

    function open(): Promise<IDBDatabase> {
        if (!opened) {
            const opening = openDatabase(factory)
                .then((database) => {
                    openedDatabase = database;
                    database.onversionchange = () => {
                        database.close();
                        if (openedDatabase === database) {
                            openedDatabase = undefined;
                            if (opened === opening) opened = undefined;
                        }
                    };
                    return database;
                })
                .catch((error) => {
                    if (error instanceof InboxError) throw error;
                    throw new InboxError('storage');
                });
            opened = opening;
            void opening.catch(() => {
                if (opened === opening) opened = undefined;
            });
        }
        return opened;
    }

    return storageRepository(
        open,
        async () => {
            const database =
                openedDatabase ?? (opened ? await opened : undefined);
            database?.close();
            openedDatabase = undefined;
            opened = undefined;
        },
        (accountId, update) => {
            if (
                !validAccountId(accountId) ||
                !validEntities(update.entities) ||
                update.resources.some((resource) => {
                    if (!validResource(resource)) return true;
                    if (resource.threadId === undefined) return false;
                    const messageIds = new Set(resource.refs.messageIds);
                    return resource.orderedIds.some(
                        (id) => !messageIds.has(id),
                    );
                }) ||
                (update.deleteKeys ?? []).some(
                    (key) => !key || key.endsWith('*'),
                )
            )
                throw new InboxError('storage');
            const keys = new Set<string>();
            for (const resource of update.resources) {
                if (!validKey(resource.key) || keys.has(resource.key))
                    throw new InboxError('storage');
                keys.add(resource.key);
            }
        },
        validStoredFact,
        validResource,
    );
}

export interface InboxRepositoryEffects {
    readonly readHistoryWindow: (
        accountId: string,
        threadId: string,
        request?: HistoryWindowRequest,
    ) => Effect.Effect<HistoryWindowRead, InboxError>;
    readonly touchHistory: (
        accountId: string,
        threadId: string,
        accessedAt: number,
    ) => Effect.Effect<void, InboxError>;
    readonly readHistoryInventory: (
        accountId: string,
        limit?: number,
    ) => Effect.Effect<HistoryInventory[], InboxError>;
    readonly readResources: (
        accountId: string,
        keys: string[],
    ) => Effect.Effect<RepositoryRead, InboxError>;
    readonly commitResources: (
        accountId: string,
        update: ResourceCommit,
    ) => Effect.Effect<RepositoryRead, InboxError>;
    readonly close: Effect.Effect<void, InboxError>;
}

export class InboxRepositoryService extends Context.Service<
    InboxRepositoryService,
    InboxRepositoryEffects
>()('icr/InboxRepository') {}

function storageError(cause: unknown): InboxError {
    return cause instanceof InboxError ? cause : new InboxError('storage');
}

export function makeInboxRepository(
    factory: IDBFactory = globalThis.indexedDB,
): InboxRepositoryEffects {
    const repository = createInboxRepository(factory);
    return {
        readHistoryWindow: (accountId, threadId, request) =>
            Effect.tryPromise({
                try: () =>
                    repository.readHistoryWindow(accountId, threadId, request),
                catch: storageError,
            }),
        touchHistory: (accountId, threadId, accessedAt) =>
            Effect.tryPromise({
                try: () =>
                    repository.touchHistory(accountId, threadId, accessedAt),
                catch: storageError,
            }),
        readHistoryInventory: (accountId, limit) =>
            Effect.tryPromise({
                try: () => repository.readHistoryInventory(accountId, limit),
                catch: storageError,
            }),
        readResources: (accountId, keys) =>
            Effect.tryPromise({
                try: () => repository.readResources(accountId, keys),
                catch: storageError,
            }),
        commitResources: (accountId, update) =>
            Effect.tryPromise({
                try: () => repository.commitResources(accountId, update),
                catch: storageError,
            }),
        close: Effect.tryPromise({
            try: () => repository.close(),
            catch: storageError,
        }),
    };
}

export function inboxRepositoryLive(
    factory: IDBFactory = globalThis.indexedDB,
): Layer.Layer<InboxRepositoryService> {
    return Layer.effect(
        InboxRepositoryService,
        Effect.acquireRelease(
            Effect.sync(() => makeInboxRepository(factory)),
            (repository) => Effect.orDie(repository.close),
        ),
    );
}

/**
 * Compatibility boundary for the Promise-based engine and repository tests.
 * Worker suspension can skip scoped finalizers; committed IDB transactions,
 * rather than `close`, remain the durability boundary.
 */
export function inboxRepositoryPromiseFacade(
    repository: InboxRepositoryEffects,
    runPromise: <A>(effect: Effect.Effect<A>) => Promise<A> = Effect.runPromise,
): InboxRepository {
    async function run<A>(effect: Effect.Effect<A, InboxError>) {
        const result = await runPromise(Effect.result(effect));
        if (Result.isFailure(result)) throw result.failure;
        return result.success;
    }
    return {
        readHistoryWindow: (accountId, threadId, request) =>
            run(repository.readHistoryWindow(accountId, threadId, request)),
        touchHistory: (accountId, threadId, accessedAt) =>
            run(repository.touchHistory(accountId, threadId, accessedAt)),
        readHistoryInventory: (accountId, limit) =>
            run(repository.readHistoryInventory(accountId, limit)),
        readResources: (accountId, keys) =>
            run(repository.readResources(accountId, keys)),
        commitResources: (accountId, update) =>
            run(repository.commitResources(accountId, update)),
        close: () => run(repository.close),
    };
}
