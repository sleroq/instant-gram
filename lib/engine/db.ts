import { Context, Effect, Layer, Result } from 'effect';
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
    emptyEntities,
    type EntityFacts,
    type InboxRepository,
    type PersistedResource,
    type RepositoryRead,
    type ResourceCommit,
    type ThreadFact,
} from './resources.ts';

const DB_NAME = 'icr-successor';
const STORE_NAMES = [
    'users',
    'threads',
    'messages',
    'resources',
    'meta',
] as const;
const FACT_STORE_NAMES = ['users', 'threads', 'messages'] as const;

type Stored<T> = { accountId: string; id: string; value: T };

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

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new InboxError('storage'));
        transaction.onabort = () => reject(new InboxError('storage'));
    });
}

async function finishTransaction<T>(
    transaction: IDBTransaction,
    work: Promise<T>,
): Promise<T> {
    const completion = transactionDone(transaction);
    try {
        const value = await work;
        await completion;
        return value;
    } catch (error) {
        try {
            transaction.abort();
        } catch {
            // The transaction may already have aborted on its own request error.
        }
        await completion.catch(() => undefined);
        if (error instanceof InboxError) throw error;
        throw new InboxError('storage');
    }
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
        const request = factory.open(DB_NAME, 2);
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
                if (event.oldVersion < 2) {
                    void migrateV1(
                        transaction,
                        transaction.objectStore('users'),
                        transaction.objectStore('threads'),
                        transaction.objectStore('messages'),
                        resourcesStore,
                    );
                }
            } catch {
                abortUpgrade(transaction);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new InboxError('storage'));
    });
}

function rowValue<T>(value: JsonValue | undefined): Stored<T> {
    if (!storedRow(value)) throw new InboxError('storage');
    // SAFETY: this private adapter is called only for rows from the named store whose value is T.
    return value as Stored<T>;
}

function resourceMatches(resource: PersistedResource, keys: string[]): boolean {
    return keys.some((key) =>
        key.endsWith('*')
            ? resource.key.startsWith(key.slice(0, -1))
            : resource.key === key,
    );
}

function addResourceRefs(
    resource: PersistedResource,
    threadIds: Set<string>,
    userIds: Set<string>,
    messageIds: Set<string>,
): void {
    for (const id of resource.refs.threadIds) threadIds.add(id);
    for (const id of resource.refs.userIds) userIds.add(id);
    for (const id of resource.refs.messageIds) messageIds.add(id);
}

function entityRows<T>(rows: JsonValue[], accountId: string): Stored<T>[] {
    const result: Stored<T>[] = [];
    for (const value of rows) {
        const row = rowValue<T>(value);
        if (row.accountId !== accountId) throw new InboxError('storage');
        result.push(row);
    }
    return result;
}

async function rowsByIds<T>(
    store: IDBObjectStore,
    accountId: string,
    ids: Set<string>,
): Promise<Stored<T>[]> {
    const values = await Promise.all(
        [...ids].map((id) => requestResult(store.get([accountId, id]))),
    );
    const result: Stored<T>[] = [];
    for (const value of values) {
        if (value === undefined) throw new InboxError('storage');
        const row = rowValue<T>(value);
        if (row.accountId !== accountId) throw new InboxError('storage');
        result.push(row);
    }
    return result;
}

function requireFactIds<T>(ids: Set<string>, facts: Map<string, T>): void {
    for (const id of ids) if (!facts.has(id)) throw new InboxError('storage');
}

function requiredFact<T>(facts: Map<string, T>, id: string): T {
    const value = facts.get(id);
    if (value === undefined) throw new InboxError('storage');
    return value;
}

function buildEntities(
    threadRows: Stored<ThreadFact>[],
    userRows: Stored<User>[],
    messageRows: Stored<Message>[],
    threadIds: Set<string>,
    userIds: Set<string>,
    messageIds: Set<string>,
): EntityFacts {
    const entities = emptyEntities();
    for (const row of threadRows) {
        if (!validThread(row.value, row.id)) throw new InboxError('storage');
        if (!threadIds.has(row.id)) continue;
        entities.threadsById[row.id] = row.value;
        for (const id of row.value.userIds) userIds.add(id);
        if (row.value.lastMessageId) messageIds.add(row.value.lastMessageId);
    }
    for (const row of userRows) {
        if (!validUser(row.value, row.id)) throw new InboxError('storage');
        if (userIds.has(row.id)) entities.usersById[row.id] = row.value;
    }
    for (const row of messageRows) {
        if (!validMessage(row.value, row.id)) throw new InboxError('storage');
        if (messageIds.has(row.id)) entities.messagesById[row.id] = row.value;
    }
    return entities;
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

    async function readResources(
        accountId: string,
        keys: string[],
    ): Promise<RepositoryRead> {
        if (!validAccountId(accountId) || keys.some((key) => key.length === 0))
            throw new InboxError('storage');
        const database = await open();
        const transaction = database.transaction([...STORE_NAMES], 'readonly');
        const work = (async () => {
            const resourceRows = await requestResult(
                transaction
                    .objectStore('resources')
                    .index('accountId')
                    .getAll(accountId),
            );
            const revisionValue = await requestResult(
                transaction.objectStore('meta').get('revision'),
            );
            const selected: PersistedResource[] = [];
            const threadIds = new Set<string>();
            const userIds = new Set<string>();
            const messageIds = new Set<string>();
            for (const value of resourceRows) {
                const row = rowValue<PersistedResource>(value);
                if (
                    row.accountId !== accountId ||
                    !validResource(row.value) ||
                    row.value.key !== row.id
                )
                    throw new InboxError('storage');
                if (resourceMatches(row.value, keys)) {
                    selected.push(row.value);
                    addResourceRefs(row.value, threadIds, userIds, messageIds);
                }
            }
            const threadRows = await rowsByIds<ThreadFact>(
                transaction.objectStore('threads'),
                accountId,
                threadIds,
            );
            for (const row of threadRows) {
                if (!validThread(row.value, row.id))
                    throw new InboxError('storage');
                for (const id of row.value.userIds) userIds.add(id);
                if (row.value.lastMessageId)
                    messageIds.add(row.value.lastMessageId);
            }
            const userRows = await rowsByIds<User>(
                transaction.objectStore('users'),
                accountId,
                userIds,
            );
            const messageRows = await rowsByIds<Message>(
                transaction.objectStore('messages'),
                accountId,
                messageIds,
            );
            const entities = buildEntities(
                threadRows,
                userRows,
                messageRows,
                threadIds,
                userIds,
                messageIds,
            );
            return {
                resources: selected,
                entities,
                revision: validRevision(revisionValue),
            };
        })();
        return finishTransaction(transaction, work);
    }

    async function commitResources(
        accountId: string,
        update: Parameters<InboxRepository['commitResources']>[1],
    ): Promise<RepositoryRead> {
        if (
            !validAccountId(accountId) ||
            !validEntities(update.entities) ||
            update.resources.some((resource) => !validResource(resource)) ||
            (update.deleteKeys ?? []).some(
                (key) => key.length === 0 || key.endsWith('*'),
            )
        )
            throw new InboxError('storage');
        const resourceKeys = new Set<string>();
        for (const resource of update.resources) {
            if (!validKey(resource.key) || resourceKeys.has(resource.key))
                throw new InboxError('storage');
            resourceKeys.add(resource.key);
        }
        const database = await open();
        const transaction = database.transaction([...STORE_NAMES], 'readwrite');
        const work = (async () => {
            const resourceStore = transaction.objectStore('resources');
            const oldResourceRows = entityRows<PersistedResource>(
                await requestResult(
                    resourceStore.index('accountId').getAll(accountId),
                ),
                accountId,
            );
            const oldThreadRows = entityRows<ThreadFact>(
                await requestResult(
                    transaction
                        .objectStore('threads')
                        .index('accountId')
                        .getAll(accountId),
                ),
                accountId,
            );
            const oldUserRows = entityRows<User>(
                await requestResult(
                    transaction
                        .objectStore('users')
                        .index('accountId')
                        .getAll(accountId),
                ),
                accountId,
            );
            const oldMessageRows = entityRows<Message>(
                await requestResult(
                    transaction
                        .objectStore('messages')
                        .index('accountId')
                        .getAll(accountId),
                ),
                accountId,
            );
            const resources = new Map<string, PersistedResource>();
            for (const row of oldResourceRows) {
                if (!validResource(row.value) || row.value.key !== row.id)
                    throw new InboxError('storage');
                resources.set(row.id, row.value);
            }
            for (const key of update.deleteKeys ?? []) resources.delete(key);
            for (const resource of update.resources)
                resources.set(resource.key, resource);

            const threads = new Map<string, ThreadFact>();
            const users = new Map<string, User>();
            const messages = new Map<string, Message>();
            for (const row of oldThreadRows) {
                if (!validThread(row.value, row.id))
                    throw new InboxError('storage');
                threads.set(row.id, row.value);
            }
            for (const row of oldUserRows) {
                if (!validUser(row.value, row.id))
                    throw new InboxError('storage');
                users.set(row.id, row.value);
            }
            for (const row of oldMessageRows) {
                if (!validMessage(row.value, row.id))
                    throw new InboxError('storage');
                messages.set(row.id, row.value);
            }
            for (const [id, value] of Object.entries(
                update.entities.threadsById,
            ))
                threads.set(id, value);
            for (const [id, value] of Object.entries(update.entities.usersById))
                users.set(id, value);
            for (const [id, value] of Object.entries(
                update.entities.messagesById,
            ))
                messages.set(id, value);

            const threadIds = new Set<string>();
            const userIds = new Set<string>();
            const messageIds = new Set<string>();
            for (const resource of resources.values())
                addResourceRefs(resource, threadIds, userIds, messageIds);
            for (const id of threadIds) {
                const thread = threads.get(id);
                if (!thread) throw new InboxError('storage');
                for (const userId of thread.userIds) userIds.add(userId);
                if (thread.lastMessageId) messageIds.add(thread.lastMessageId);
            }
            requireFactIds(userIds, users);
            requireFactIds(messageIds, messages);

            const retainedResources = [...resources.values()];
            const retainedEntities = emptyEntities();
            for (const id of threadIds)
                retainedEntities.threadsById[id] = requiredFact(threads, id);
            for (const id of userIds)
                retainedEntities.usersById[id] = requiredFact(users, id);
            for (const id of messageIds)
                retainedEntities.messagesById[id] = requiredFact(messages, id);

            for (const row of oldResourceRows)
                if (!resources.has(row.id))
                    resourceStore.delete([accountId, row.id]);
            for (const resource of update.resources)
                resourceStore.put({
                    accountId,
                    id: resource.key,
                    value: resource,
                });
            pruneFacts(
                transaction.objectStore('threads'),
                oldThreadRows,
                accountId,
                threadIds,
            );
            pruneFacts(
                transaction.objectStore('users'),
                oldUserRows,
                accountId,
                userIds,
            );
            pruneFacts(
                transaction.objectStore('messages'),
                oldMessageRows,
                accountId,
                messageIds,
            );
            putFacts(
                transaction,
                accountId,
                update.entities,
                threadIds,
                userIds,
                messageIds,
            );
            const revision =
                validRevision(
                    await requestResult(
                        transaction.objectStore('meta').get('revision'),
                    ),
                ) + 1;
            transaction.objectStore('meta').put(revision, 'revision');
            return {
                resources: retainedResources,
                entities: retainedEntities,
                revision,
            };
        })();
        return finishTransaction(transaction, work);
    }

    return {
        readResources,
        commitResources,
        async close() {
            const database =
                openedDatabase ?? (opened ? await opened : undefined);
            database?.close();
            openedDatabase = undefined;
            opened = undefined;
        },
    };
}

export interface InboxRepositoryEffects {
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
        readResources: (accountId, keys) =>
            run(repository.readResources(accountId, keys)),
        commitResources: (accountId, update) =>
            run(repository.commitResources(accountId, update)),
        close: () => run(repository.close),
    };
}

function validRevision(value: JsonValue | undefined): number {
    if (value === undefined) return 0;
    if (!isFiniteNumber(value) || value < 0) throw new InboxError('storage');
    return value;
}

function pruneFacts<T>(
    store: IDBObjectStore,
    rows: Stored<T>[],
    accountId: string,
    retained: Set<string>,
): void {
    for (const row of rows)
        if (!retained.has(row.id)) store.delete([accountId, row.id]);
}

function putFacts(
    transaction: IDBTransaction,
    accountId: string,
    entities: EntityFacts,
    threadIds: Set<string>,
    userIds: Set<string>,
    messageIds: Set<string>,
): void {
    for (const id of threadIds) {
        const value = entities.threadsById[id];
        if (value)
            transaction.objectStore('threads').put({ accountId, id, value });
    }
    for (const id of userIds) {
        const value = entities.usersById[id];
        if (value)
            transaction.objectStore('users').put({ accountId, id, value });
    }
    for (const id of messageIds) {
        const value = entities.messagesById[id];
        if (value)
            transaction.objectStore('messages').put({ accountId, id, value });
    }
}
