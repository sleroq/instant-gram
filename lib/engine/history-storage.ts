import type { Message, User } from '../domain.ts';
import { isNumber, type JsonValue } from '../json.ts';
import {
    HISTORY_WINDOW_LIMIT,
    InboxError,
    emptyEntities,
    type EntityFacts,
    type HistoryProjection,
    type HistoryInventory,
    type HistoryWindowRead,
    type HistoryWindowRequest,
    type InboxRepository,
    type PersistedResource,
    type RepositoryRead,
    type ResourceCommit,
    type ThreadFact,
} from './resources.ts';

const stores = [
    'users',
    'threads',
    'messages',
    'resources',
    'meta',
    'refs',
    'historyInventory',
    'historyOrder',
    'historyChunks',
    'historyPrevious',
    'historyPreviousOrder',
];
type Kind = 'threads' | 'users' | 'messages';
type FactValidator = (
    kind: Kind,
    id: string,
    value: JsonValue | undefined,
) => boolean;
type Inventory = HistoryInventory & {
    accountId: string;
    generation: number;
    minRank: number;
    maxRank: number;
    headKey?: string;
    tailKey?: string;
    cursor?: string;
    hasNextPage: boolean;
    overlap?: number;
};
type Order = {
    accountId: string;
    threadId: string;
    messageId: string;
    generation: number;
    rank: number;
};
type Chunk = {
    accountId: string;
    resourceKey: string;
    part: number;
    orderedIds: string[];
    refs: PersistedResource['refs'];
};
type Row<T> = { accountId: string; id: string; value: T };
type Ref = { accountId: string; kind: Kind; id: string; count: number };
type Totals = { histories: number; messages: number };

function result<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new InboxError('storage'));
    });
}

/** Jump to a compound prefix without requiring a globally installed IDBKeyRange. */
function cursorEach<T>(
    source: IDBObjectStore | IDBIndex,
    prefix: IDBValidKey[],
    visit: (value: T, cursor: IDBCursorWithValue) => boolean | void,
    direction: IDBCursorDirection = 'next',
    start?: IDBValidKey[],
): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = source.openCursor(undefined, direction);
        let jumped = false;

        request.onerror = () => reject(new InboxError('storage'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            const key = cursor.key;
            if (!Array.isArray(key)) {
                reject(new InboxError('storage'));
                return;
            }
            const target =
                start ?? (direction === 'prev' ? [...prefix, []] : prefix);
            // IDB key arrays sort after scalar components; [] is an exclusive prefix ceiling.
            if (!jumped) {
                jumped = true;
                const comparison = compareKeys(key, target);
                if (
                    (direction === 'next' && comparison < 0) ||
                    (direction === 'prev' && comparison > 0)
                ) {
                    cursor.continue(target);
                    return;
                }
            }
            if (!prefix.every((part, i) => compareKeys(key[i]!, part) === 0)) {
                resolve();
                return;
            }

            try {
                // SAFETY: named store/index schemas fix the record type at each call site.
                const value = cursor.value as T;
                if (visit(value, cursor) === false) {
                    resolve();
                    return;
                }
                cursor.continue();
            } catch (error) {
                reject(error);
            }
        };
    });
}

function compareKeys(a: IDBValidKey, b: IDBValidKey): number {
    if (Array.isArray(a) && Array.isArray(b)) {
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            const value = compareKeys(a[i]!, b[i]!);
            if (value !== 0) return value;
        }
        return a.length - b.length;
    }
    if (Array.isArray(a)) return 1;
    if (Array.isArray(b)) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

async function get<T>(
    store: IDBObjectStore | IDBIndex,
    key: IDBValidKey,
): Promise<T | undefined> {
    // SAFETY: record shape is fixed by the named store, validated on external writes/migration.
    return (await result(store.get(key))) as T | undefined;
}

function revision(value: JsonValue | undefined): number {
    if (value === undefined) return 0;
    if (!isNumber(value) || !Number.isFinite(value) || value < 0)
        throw new InboxError('storage');
    return value;
}

function totalsKey(accountId: string): string {
    return `historyTotals:${accountId}`;
}

function freshInventory(accountId: string, threadId: string): Inventory {
    return {
        accountId,
        threadId,
        lastAccessedAt: 0,
        segmentCount: 0,
        retainedMessageCount: 0,
        activeMessageCount: 0,
        generation: 0,
        minRank: 0,
        maxRank: -1,
        hasNextPage: false,
    };
}

class Work {
    readonly tx: IDBTransaction;
    readonly accountId: string;
    readonly validateFact?: FactValidator;
    readonly validateResource?: (resource: PersistedResource) => boolean;
    constructor(
        tx: IDBTransaction,
        accountId: string,
        validateFact?: FactValidator,
        validateResource?: (resource: PersistedResource) => boolean,
    ) {
        this.tx = tx;
        this.accountId = accountId;
        this.validateFact = validateFact;
        this.validateResource = validateResource;
    }
    store(name: string): IDBObjectStore {
        return this.tx.objectStore(name);
    }
    async fact<T>(kind: Kind, id: string): Promise<T> {
        const row = await get<Row<T>>(this.store(kind), [this.accountId, id]);
        // SAFETY: candidate JSON from IndexedDB is validated at this persistence boundary.
        const candidate = row?.value as JsonValue | undefined;
        if (
            !row ||
            row.accountId !== this.accountId ||
            row.id !== id ||
            (this.validateFact && !this.validateFact(kind, id, candidate))
        )
            throw new InboxError('storage');
        return row.value;
    }
    async refCount(kind: Kind, id: string): Promise<number> {
        return (
            (await get<Ref>(this.store('refs'), [this.accountId, kind, id]))
                ?.count ?? 0
        );
    }
    async edge(kind: Kind, id: string, delta: number): Promise<void> {
        const count = await this.refCount(kind, id);
        const next = count + delta;
        if (next < 0) throw new InboxError('storage');
        if (next > 0) {
            await this.fact(kind, id);
            this.store('refs').put({
                accountId: this.accountId,
                kind,
                id,
                count: next,
            });
        } else this.store('refs').delete([this.accountId, kind, id]);
        if (
            kind === 'threads' &&
            ((count === 0 && next > 0) || (count > 0 && next === 0))
        ) {
            const thread = await this.fact<ThreadFact>('threads', id);
            await this.threadEdges(thread, next > 0 ? 1 : -1);
        }
    }
    async threadEdges(thread: ThreadFact, delta: number): Promise<void> {
        for (const id of new Set(thread.userIds))
            await this.edge('users', id, delta);
        if (thread.lastMessageId)
            await this.edge('messages', thread.lastMessageId, delta);
    }
    async references(
        refs: PersistedResource['refs'],
        delta: number,
    ): Promise<void> {
        for (const id of new Set(refs.threadIds))
            await this.edge('threads', id, delta);
        for (const id of new Set(refs.userIds))
            await this.edge('users', id, delta);
        for (const id of new Set(refs.messageIds))
            await this.edge('messages', id, delta);
    }
    async chunks(
        resource: PersistedResource,
        visit: (chunk: Chunk) => Promise<void>,
    ): Promise<void> {
        for (let part = 1; part <= (resource.chunkCount ?? 0); part++) {
            const chunk = await get<Chunk>(this.store('historyChunks'), [
                this.accountId,
                resource.key,
                part,
            ]);
            if (!chunk) throw new InboxError('storage');
            await visit(chunk);
        }
    }
    async resourceRefs(
        resource: PersistedResource,
        delta: number,
    ): Promise<void> {
        await this.references(resource.refs, delta);
        await this.chunks(resource, async (chunk) => {
            await this.references(chunk.refs, delta);
        });
    }
    async inventory(threadId: string): Promise<Inventory> {
        return (
            (await get<Inventory>(this.store('historyInventory'), [
                this.accountId,
                threadId,
            ])) ?? freshInventory(this.accountId, threadId)
        );
    }
    async adjustInventory(
        resource: PersistedResource,
        delta: number,
    ): Promise<void> {
        const threadId = resource.threadId;
        if (!threadId) return;
        const inventory = await this.inventory(threadId);
        let messageDelta = 0;
        await this.pageIds(resource, async (ids) => {
            for (const id of ids) {
                const kind = `history:${threadId}`;
                const key = [this.accountId, kind, id];
                const count =
                    (await get<{ count: number }>(this.store('refs'), key))
                        ?.count ?? 0;
                const next = count + delta;
                if (next < 0) throw new InboxError('storage');
                if (next === 0) this.store('refs').delete(key);
                else
                    this.store('refs').put({
                        accountId: this.accountId,
                        kind,
                        id,
                        count: next,
                    });
                if (count === 0) messageDelta++;
                if (next === 0) messageDelta--;
            }
        });

        const meta = this.store('meta');
        const totals = (await get<Totals>(meta, totalsKey(this.accountId))) ?? {
            histories: 0,
            messages: 0,
        };
        if (inventory.segmentCount === 0 && delta > 0) totals.histories++;
        inventory.segmentCount += delta;
        inventory.retainedMessageCount += messageDelta;
        totals.messages += messageDelta;
        if (inventory.segmentCount === 0 && delta < 0) totals.histories--;
        if (delta > 0)
            inventory.lastAccessedAt = Math.max(
                inventory.lastAccessedAt,
                resource.fetchedAt,
            );
        this.store('historyInventory').put(inventory);
        meta.put(totals, totalsKey(this.accountId));
    }
    async put(resource: PersistedResource): Promise<PersistedResource> {
        const stored: PersistedResource = {
            ...resource,
            refs: {
                threadIds: [...new Set(resource.refs.threadIds)],
                userIds: [...new Set(resource.refs.userIds)],
                messageIds: [...new Set(resource.refs.messageIds)],
            },
            orderedIds: [...new Set(resource.orderedIds)],
        };
        delete stored.activeGeneration;
        delete stored.chunkCount;

        if (resource.threadId) {
            const ids = stored.orderedIds;
            const directMessages = stored.refs.messageIds;
            stored.orderedIds = ids.slice(0, HISTORY_WINDOW_LIMIT);
            const directThreads = stored.refs.threadIds;
            const directUsers = stored.refs.userIds;
            stored.refs.messageIds = directMessages.slice(
                0,
                HISTORY_WINDOW_LIMIT,
            );
            stored.refs.threadIds = directThreads.slice(
                0,
                HISTORY_WINDOW_LIMIT,
            );
            stored.refs.userIds = directUsers.slice(0, HISTORY_WINDOW_LIMIT);
            const count = Math.max(
                ...[ids, directMessages, directThreads, directUsers].map(
                    (values) => Math.ceil(values.length / HISTORY_WINDOW_LIMIT),
                ),
            );
            stored.chunkCount = Math.max(0, count - 1);
            for (let part = 1; part < count; part++) {
                this.store('historyChunks').put({
                    accountId: this.accountId,
                    resourceKey: resource.key,
                    part,
                    orderedIds: ids.slice(
                        part * HISTORY_WINDOW_LIMIT,
                        (part + 1) * HISTORY_WINDOW_LIMIT,
                    ),
                    refs: {
                        threadIds: directThreads.slice(
                            part * HISTORY_WINDOW_LIMIT,
                            (part + 1) * HISTORY_WINDOW_LIMIT,
                        ),
                        userIds: directUsers.slice(
                            part * HISTORY_WINDOW_LIMIT,
                            (part + 1) * HISTORY_WINDOW_LIMIT,
                        ),
                        messageIds: directMessages.slice(
                            part * HISTORY_WINDOW_LIMIT,
                            (part + 1) * HISTORY_WINDOW_LIMIT,
                        ),
                    },
                } satisfies Chunk);
            }
        }

        this.store('resources').put({
            accountId: this.accountId,
            id: stored.key,
            value: stored,
        });
        return stored;
    }
    async pruneRefs(refs: PersistedResource['refs']): Promise<void> {
        for (const id of refs.threadIds) {
            if ((await this.refCount('threads', id)) > 0) continue;
            const thread = await this.fact<ThreadFact>('threads', id);
            await this.pruneRefs({
                threadIds: [],
                userIds: thread.userIds,
                messageIds: thread.lastMessageId ? [thread.lastMessageId] : [],
            });
            this.store('threads').delete([this.accountId, id]);
        }
        for (const id of refs.userIds)
            if ((await this.refCount('users', id)) === 0)
                this.store('users').delete([this.accountId, id]);
        for (const id of refs.messageIds)
            if ((await this.refCount('messages', id)) === 0)
                this.store('messages').delete([this.accountId, id]);
    }
    async remove(resource: PersistedResource, gc = false): Promise<void> {
        await this.adjustInventory(resource, -1);
        await this.resourceRefs(resource, -1);
        if (gc) {
            await this.pruneRefs(resource.refs);
            await this.chunks(resource, async (chunk) => {
                await this.pruneRefs(chunk.refs);
            });
        }
        for (let part = 1; part <= (resource.chunkCount ?? 0); part++)
            this.store('historyChunks').delete([
                this.accountId,
                resource.key,
                part,
            ]);
        this.store('resources').delete([this.accountId, resource.key]);
    }
    async pageIds(
        resource: PersistedResource,
        visit: (ids: string[]) => Promise<void>,
    ): Promise<void> {
        // Physical chunks preserve provider order; page order is chronological.
        await visit(resource.orderedIds);
        await this.chunks(resource, async (chunk) => {
            await visit(chunk.orderedIds);
        });
    }
    async link(
        inventory: Inventory,
        resource: PersistedResource,
        head: boolean,
        previousScope = false,
    ): Promise<number> {
        let added = 0;
        const previous = previousScope
            ? undefined
            : await get<Inventory>(this.store('historyPrevious'), [
                  this.accountId,
                  inventory.threadId,
              ]);
        let pageSize = resource.orderedIds.length;
        await this.chunks(resource, async (chunk) => {
            pageSize += chunk.orderedIds.length;
        });

        // Reserve older ranks in advance so IDs remain chronological within a page.
        let rank = head ? 0 : inventory.minRank - pageSize;
        await this.pageIds(resource, async (ids) => {
            for (const messageId of ids) {
                const old = await get<Order>(
                    this.store(
                        previousScope ? 'historyPreviousOrder' : 'historyOrder',
                    ),
                    [this.accountId, inventory.threadId, messageId],
                );
                if (old?.generation === inventory.generation) continue;
                this.store(
                    previousScope ? 'historyPreviousOrder' : 'historyOrder',
                ).put({
                    accountId: this.accountId,
                    threadId: inventory.threadId,
                    messageId,
                    generation: inventory.generation,
                    rank: rank++,
                } satisfies Order);
                added++;
                if (
                    previous &&
                    (await get(this.store('historyPreviousOrder'), [
                        this.accountId,
                        inventory.threadId,
                        messageId,
                    ]))
                )
                    inventory.overlap = (inventory.overlap ?? 0) + 1;
            }
        });

        if (!head && added === 0 && resource.hasNextPage)
            throw new InboxError('no_progress');
        if (head) {
            inventory.minRank = 0;
            inventory.maxRank = added - 1;
        } else if (added > 0) inventory.minRank -= pageSize;
        inventory.activeMessageCount += added;
        inventory.tailKey = resource.key;
        inventory.cursor = resource.cursor;
        inventory.hasNextPage = resource.hasNextPage;
        if (previousScope) return added;
        resource.activeGeneration = inventory.generation;
        this.store('resources').put({
            accountId: this.accountId,
            id: resource.key,
            value: resource,
        });
        return added;
    }
    async continuation(
        threadId: string,
        cursor: string,
    ): Promise<PersistedResource | undefined> {
        // Segment keys are provider-cursor keys in the engine, but use the durable cursor index for exact linkage.
        return (
            await get<Row<PersistedResource>>(
                this.store('resources').index('historyCursor'),
                [this.accountId, threadId, cursor],
            )
        )?.value;
    }
    async snapshot(resource: PersistedResource, key: string): Promise<void> {
        const old = await get<Row<PersistedResource>>(this.store('resources'), [
            this.accountId,
            key,
        ]);
        const ids: string[] = [];
        const refs: PersistedResource['refs'] = {
            threadIds: [],
            userIds: [],
            messageIds: [],
        };
        await this.pageIds(resource, async (part) => {
            ids.push(...part);
        });
        function add(part: PersistedResource['refs']) {
            refs.threadIds.push(...part.threadIds);
            refs.userIds.push(...part.userIds);
            refs.messageIds.push(...part.messageIds);
        }
        add(resource.refs);
        await this.chunks(resource, async (chunk) => {
            add(chunk.refs);
        });
        await this.references(refs, 1);
        if (old) await this.remove(old.value, true);
        const copy = { ...resource, key, orderedIds: ids, refs };
        delete copy.requestCursor;
        const stored = await this.put(copy);
        await this.adjustInventory(stored, 1);
    }
    async capture(threadId: string): Promise<void> {
        if (
            await get(this.store('historyPrevious'), [this.accountId, threadId])
        )
            return;

        const inventory = await this.inventory(threadId);
        if (!inventory.headKey || !inventory.activeMessageCount) return;
        const head = await get<Row<PersistedResource>>(
            this.store('resources'),
            [this.accountId, inventory.headKey],
        );
        if (!head) throw new InboxError('storage');
        const key = `history-previous:${threadId}`;
        await this.snapshot(head.value, key);
        // Order ownership is separate from physical head ownership. Copy only one
        // physical chunk at a time, releasing the batch before seeking the next.
        let after: string | undefined;
        let owner: PersistedResource | undefined;
        let part = 0;
        const prefix = [this.accountId, threadId];
        while (true) {
            const ids: string[] = [];
            await cursorEach<Order>(
                this.store('historyOrder'),
                prefix,
                (order) => {
                    if (order.messageId === after) return;
                    this.store('historyPreviousOrder').put(order);
                    ids.push(order.messageId);
                    return ids.length < HISTORY_WINDOW_LIMIT;
                },
                'next',
                after === undefined ? undefined : [...prefix, after],
            );
            if (ids.length === 0) break;
            const refs = { threadIds: [], userIds: [], messageIds: ids };
            await this.references(refs, 1);
            if (!owner) {
                const resource = {
                    ...head.value,
                    key: `${key}:orders`,
                    orderedIds: ids,
                    refs,
                };
                delete resource.requestCursor;
                owner = await this.put(resource);
            } else {
                this.store('historyChunks').put({
                    accountId: this.accountId,
                    resourceKey: owner.key,
                    part: ++part,
                    orderedIds: ids,
                    refs,
                } satisfies Chunk);
            }
            after = ids[ids.length - 1]!;
        }
        if (!owner) throw new InboxError('storage');
        owner.chunkCount = part;
        this.store('resources').put({
            accountId: this.accountId,
            id: owner.key,
            value: owner,
        });
        await this.adjustInventory(owner, 1);
        this.store('historyPrevious').put({ ...inventory, headKey: key });
    }
    async retirePrevious(threadId: string): Promise<void> {
        for (const key of [
            `history-previous:${threadId}`,
            `history-previous:${threadId}:orders`,
        ]) {
            const row = await get<Row<PersistedResource>>(
                this.store('resources'),
                [this.accountId, key],
            );
            if (row) await this.remove(row.value, true);
        }
        const pages = await this.select([
            `history-previous-page:${threadId}:*`,
        ]);
        for (const page of pages) await this.remove(page, true);
        await cursorEach<Order>(
            this.store('historyPreviousOrder'),
            [this.accountId, threadId],
            (_order, cursor) => {
                cursor.delete();
            },
        );
        this.store('historyPrevious').delete([this.accountId, threadId]);
    }
    async activate(resource: PersistedResource): Promise<void> {
        const threadId = resource.threadId;
        if (!threadId) return;

        const inventory = await this.inventory(threadId);
        const prior = await get<Inventory>(this.store('historyPrevious'), [
            this.accountId,
            threadId,
        ]);
        if (
            prior &&
            resource.requestCursor !== undefined &&
            prior.hasNextPage &&
            prior.cursor === resource.requestCursor
        ) {
            await this.pageIds(resource, async (ids) => {
                for (const id of ids) {
                    const key = [this.accountId, threadId, id];
                    const current = await get<Order>(
                        this.store('historyOrder'),
                        key,
                    );
                    if (
                        current?.generation === inventory.generation &&
                        !(await get(this.store('historyPreviousOrder'), key))
                    )
                        inventory.overlap = (inventory.overlap ?? 0) + 1;
                }
            });
            await this.link(prior, resource, false, true);
            await this.snapshot(
                resource,
                `history-previous-page:${threadId}:${resource.requestCursor}`,
            );
            this.store('historyPrevious').put(prior);
            if (inventory.overlap === prior.activeMessageCount)
                await this.retirePrevious(threadId);
            const ownership = await this.inventory(threadId);
            inventory.segmentCount = ownership.segmentCount;
            inventory.retainedMessageCount = ownership.retainedMessageCount;
            this.store('historyInventory').put(inventory);
        }
        if (resource.requestCursor === undefined) {
            await cursorEach<Order>(
                this.store('historyOrder'),
                [this.accountId, threadId],
                (_order, cursor) => {
                    cursor.delete();
                },
            );
            inventory.generation++;
            inventory.overlap = 0;
            inventory.activeMessageCount = 0;
            inventory.headKey = resource.key;
            await this.link(inventory, resource, true);
        } else {
            if (
                !inventory.headKey ||
                !inventory.hasNextPage ||
                inventory.cursor !== resource.requestCursor
            )
                return;
            if (resource.activeGeneration === inventory.generation)
                throw new InboxError('no_progress');
            await this.link(inventory, resource, false);
        }
        while (inventory.hasNextPage && inventory.cursor !== undefined) {
            const next = await this.continuation(threadId, inventory.cursor);
            if (!next) break;
            if (next.activeGeneration === inventory.generation)
                throw new InboxError('no_progress');
            await this.link(inventory, next, false);
        }
        const previous = await get<Inventory>(this.store('historyPrevious'), [
            this.accountId,
            threadId,
        ]);
        if (previous && inventory.overlap === previous.activeMessageCount)
            await this.retirePrevious(threadId);
        const ownership = await this.inventory(threadId);
        inventory.segmentCount = ownership.segmentCount;
        inventory.retainedMessageCount = ownership.retainedMessageCount;
        inventory.lastAccessedAt = Math.max(
            inventory.lastAccessedAt,
            resource.fetchedAt,
        );
        this.store('historyInventory').put(inventory);
    }
    async select(keys: string[]): Promise<PersistedResource[]> {
        const selected = new Map<string, PersistedResource>();
        for (const key of keys) {
            if (key.endsWith('*')) {
                const prefix = key.slice(0, -1);
                await cursorEach<Row<PersistedResource>>(
                    this.store('resources'),
                    [this.accountId],
                    (row) => {
                        if (!row.id.startsWith(prefix)) return false;
                        if (
                            row.accountId !== this.accountId ||
                            row.id !== row.value.key
                        )
                            throw new InboxError('storage');
                        selected.set(row.id, row.value);
                    },
                    'next',
                    [this.accountId, prefix],
                );
            } else {
                const row = await get<Row<PersistedResource>>(
                    this.store('resources'),
                    [this.accountId, key],
                );
                if (row) {
                    if (
                        row.accountId !== this.accountId ||
                        row.id !== row.value.key
                    )
                        throw new InboxError('storage');
                    selected.set(key, row.value);
                }
            }
        }

        const resources = [...selected.values()];
        if (
            this.validateResource &&
            resources.some((resource) => !this.validateResource!(resource))
        )
            throw new InboxError('storage');
        return resources;
    }
    async entities(
        resources: PersistedResource[],
        includeChunks = true,
    ): Promise<EntityFacts> {
        const facts = emptyEntities();
        const threadIds = new Set<string>();
        const userIds = new Set<string>();
        const messageIds = new Set<string>();
        function add(refs: PersistedResource['refs']) {
            for (const id of refs.threadIds) threadIds.add(id);
            for (const id of refs.userIds) userIds.add(id);
            for (const id of refs.messageIds) messageIds.add(id);
        }
        for (const resource of resources) {
            add(resource.refs);
            if (includeChunks)
                await this.chunks(resource, async (chunk) => {
                    add(chunk.refs);
                });
        }
        for (const id of threadIds) {
            const thread = await this.fact<ThreadFact>('threads', id);
            facts.threadsById[id] = thread;
            for (const userId of thread.userIds) userIds.add(userId);
            if (thread.lastMessageId) messageIds.add(thread.lastMessageId);
        }
        for (const id of userIds)
            facts.usersById[id] = await this.fact<User>('users', id);
        for (const id of messageIds)
            facts.messagesById[id] = await this.fact<Message>('messages', id);
        return facts;
    }
    async read(keys: string[]): Promise<RepositoryRead> {
        const resources = await this.select(keys);
        return {
            resources,
            entities: await this.entities(resources),
            revision: revision(await get(this.store('meta'), 'revision')),
        };
    }
    async prune(candidates: Map<Kind, Set<string>>): Promise<void> {
        for (const [kind, ids] of candidates) {
            for (const id of ids)
                if ((await this.refCount(kind, id)) === 0)
                    this.store(kind).delete([this.accountId, id]);
        }
    }
}

async function performTransaction<T>(
    database: IDBDatabase,
    mode: IDBTransactionMode,
    accountId: string,
    run: (work: Work) => Promise<T>,
    validateFact: FactValidator,
    validateResource: (resource: PersistedResource) => boolean,
): Promise<T> {
    const tx = database.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new InboxError('storage'));
    });
    try {
        const value = await run(
            new Work(tx, accountId, validateFact, validateResource),
        );
        await done;
        return value;
    } catch (error) {
        try {
            tx.abort();
        } catch {
            /* Already completed/aborted. */
        }
        await done.catch(() => undefined);
        throw error instanceof InboxError ? error : new InboxError('storage');
    }
}

export function storageRepository(
    open: () => Promise<IDBDatabase>,
    close: () => Promise<void>,
    validate: (accountId: string, update: ResourceCommit) => void,
    validateFact: FactValidator,
    validateResource: (resource: PersistedResource) => boolean,
): InboxRepository {
    function transaction<T>(
        database: IDBDatabase,
        mode: IDBTransactionMode,
        accountId: string,
        run: (work: Work) => Promise<T>,
    ) {
        return performTransaction(
            database,
            mode,
            accountId,
            run,
            validateFact,
            validateResource,
        );
    }

    async function readHistoryInventory(
        accountId: string,
        limit = 24,
    ): Promise<HistoryInventory[]> {
        if (!accountId || !Number.isSafeInteger(limit) || limit < 0)
            throw new InboxError('storage');
        return transaction(
            await open(),
            'readonly',
            accountId,
            async (work) => {
                const summaries: HistoryInventory[] = [];
                if (limit === 0) return summaries;
                await cursorEach<Inventory>(
                    work.store('historyInventory').index('access'),
                    [accountId],
                    (inventory) => {
                        summaries.push({
                            threadId: inventory.threadId,
                            lastAccessedAt: inventory.lastAccessedAt,
                            segmentCount: inventory.segmentCount,
                            retainedMessageCount:
                                inventory.retainedMessageCount,
                            activeMessageCount: inventory.activeMessageCount,
                        });
                        return summaries.length < limit;
                    },
                    'prev',
                );
                return summaries;
            },
        );
    }

    return {
        close,
        readHistoryInventory,
        async readResources(accountId, keys) {
            if (!accountId || keys.some((key) => !key))
                throw new InboxError('storage');
            return transaction(await open(), 'readonly', accountId, (work) =>
                work.read(keys),
            );
        },
        async touchHistory(accountId, threadId, accessedAt) {
            if (!accountId || !threadId || !Number.isFinite(accessedAt))
                throw new InboxError('storage');
            await transaction(
                await open(),
                'readwrite',
                accountId,
                async (work) => {
                    const inventory = await work.inventory(threadId);
                    if (inventory.segmentCount === 0) return;
                    inventory.lastAccessedAt = Math.max(
                        inventory.lastAccessedAt,
                        accessedAt,
                    );
                    work.store('historyInventory').put(inventory);
                },
            );
        },
        async readHistoryWindow(
            accountId,
            threadId,
            request: HistoryWindowRequest = {},
        ): Promise<HistoryWindowRead> {
            if (
                !accountId ||
                !threadId ||
                (request.direction !== undefined &&
                    !['at', 'older', 'newer'].includes(request.direction))
            )
                throw new InboxError('storage');
            return transaction(
                await open(),
                'readonly',
                accountId,
                async (work) => {
                    const currentRevision = revision(
                        await get(work.store('meta'), 'revision'),
                    );
                    let inventory = await work.inventory(threadId);
                    const previous = await get<Inventory>(
                        work.store('historyPrevious'),
                        [accountId, threadId],
                    );
                    const currentAnchor =
                        request.anchorId === undefined
                            ? undefined
                            : await get<Order>(work.store('historyOrder'), [
                                  accountId,
                                  threadId,
                                  request.anchorId,
                              ]);
                    const previousAnchor =
                        request.anchorId === undefined
                            ? undefined
                            : await get<Order>(
                                  work.store('historyPreviousOrder'),
                                  [accountId, threadId, request.anchorId],
                              );
                    const usePrevious =
                        previous !== undefined &&
                        (request.coverageGeneration === previous.generation ||
                            (request.coverageGeneration === undefined &&
                                !currentAnchor &&
                                previousAnchor !== undefined));
                    if (usePrevious) inventory = previous;
                    const orderStore = work.store(
                        usePrevious ? 'historyPreviousOrder' : 'historyOrder',
                    );
                    if (!inventory.headKey)
                        return {
                            entities: emptyEntities(),
                            revision: currentRevision,
                        };
                    const head = (
                        await get<Row<PersistedResource>>(
                            work.store('resources'),
                            [accountId, inventory.headKey],
                        )
                    )?.value;
                    if (
                        !head ||
                        (work.validateResource && !work.validateResource(head))
                    )
                        throw new InboxError('storage');

                    let anchor =
                        request.anchorId === undefined
                            ? undefined
                            : await get<Order>(orderStore, [
                                  accountId,
                                  threadId,
                                  request.anchorId,
                              ]);
                    if (anchor?.generation !== inventory.generation)
                        anchor = undefined;

                    const index = orderStore.index('rank');
                    const prefix = [accountId, threadId, inventory.generation];
                    const orders: Order[] = [];
                    if (!anchor) {
                        await cursorEach<Order>(
                            index,
                            prefix,
                            (order) => {
                                orders.push(order);
                                return orders.length < HISTORY_WINDOW_LIMIT;
                            },
                            'prev',
                        );
                        orders.reverse();
                    } else {
                        const olderCount =
                            request.direction === 'older'
                                ? 320
                                : request.direction === 'at'
                                  ? 0
                                  : 80;
                        if (olderCount) {
                            await cursorEach<Order>(
                                index,
                                prefix,
                                (order) => {
                                    if (order.messageId !== anchor.messageId)
                                        orders.push(order);
                                    return orders.length < olderCount;
                                },
                                'prev',
                                [...prefix, anchor.rank],
                            );
                            orders.reverse();
                        }
                        await cursorEach<Order>(
                            index,
                            prefix,
                            (order) => {
                                orders.push(order);
                                return orders.length < HISTORY_WINDOW_LIMIT;
                            },
                            'next',
                            [...prefix, anchor.rank],
                        );
                    }

                    const orderedIds = orders.map((order) => order.messageId);
                    const entityResource: PersistedResource = {
                        ...head,
                        chunkCount: 0,
                        refs: {
                            threadIds: head.refs.threadIds,
                            userIds: head.refs.userIds,
                            messageIds: orderedIds,
                        },
                    };
                    const entities = await work.entities(
                        [entityResource],
                        false,
                    );

                    // Explicit domain projection: physical refs/keys/chunk metadata never cross this boundary.
                    const history: HistoryProjection = {
                        threadId,
                        orderedIds,
                        coverageGeneration: inventory.generation,
                        newerCoverageAvailable: usePrevious,
                        fetchedAt: head.fetchedAt,
                        cursor: inventory.cursor,
                        hasNextPage: inventory.hasNextPage,
                        availability: head.availability,
                        freshness: usePrevious ? 'stale' : head.freshness,
                        synchronization: head.synchronization,
                        cachedOlder:
                            orders.length > 0 &&
                            orders[0]!.rank > inventory.minRank,
                        cachedNewer:
                            orders.length > 0 &&
                            orders[orders.length - 1]!.rank < inventory.maxRank,
                    };
                    if (head.viewerId !== undefined)
                        history.viewerId = head.viewerId;
                    if (head.error !== undefined) history.error = head.error;
                    if (head.failedOperation !== undefined)
                        history.failedOperation = head.failedOperation;

                    return { history, entities, revision: currentRevision };
                },
            );
        },
        async commitResources(accountId, update) {
            validate(accountId, update);
            if (update.returnKeys?.some((key) => !key))
                throw new InboxError('storage');
            if (
                update.retention &&
                (!Number.isSafeInteger(update.retention.maxHistories) ||
                    update.retention.maxHistories < 0 ||
                    !Number.isSafeInteger(update.retention.maxMessages) ||
                    update.retention.maxMessages < 0 ||
                    update.retention.protectedThreadIds.some((id) => !id))
            )
                throw new InboxError('storage');
            return transaction(
                await open(),
                'readwrite',
                accountId,
                async (work) => {
                    const candidates = new Map<Kind, Set<string>>([
                        ['threads', new Set()],
                        ['users', new Set()],
                        ['messages', new Set()],
                    ]);
                    function remember(refs: PersistedResource['refs']) {
                        for (const id of refs.threadIds)
                            candidates.get('threads')!.add(id);
                        for (const id of refs.userIds)
                            candidates.get('users')!.add(id);
                        for (const id of refs.messageIds)
                            candidates.get('messages')!.add(id);
                    }

                    const oldResources = new Map<string, PersistedResource>();
                    for (const key of new Set([
                        ...(update.deleteKeys ?? []),
                        ...update.resources.map((resource) => resource.key),
                    ])) {
                        const old = await get<Row<PersistedResource>>(
                            work.store('resources'),
                            [accountId, key],
                        );
                        if (old) oldResources.set(key, old.value);
                    }

                    // User/message facts are installed before current thread dependency edges change.
                    for (const kind of ['users', 'messages'] as const) {
                        const facts =
                            kind === 'users'
                                ? update.entities.usersById
                                : update.entities.messagesById;
                        for (const [id, value] of Object.entries(facts)) {
                            work.store(kind).put({ accountId, id, value });
                            candidates.get(kind)!.add(id);
                        }
                    }
                    for (const [id, value] of Object.entries(
                        update.entities.threadsById,
                    )) {
                        const old = await get<Row<ThreadFact>>(
                            work.store('threads'),
                            [accountId, id],
                        );
                        if (old && (await work.refCount('threads', id)) > 0) {
                            await work.threadEdges(value, 1);
                            await work.threadEdges(old.value, -1);
                            remember({
                                threadIds: [],
                                userIds: old.value.userIds,
                                messageIds: old.value.lastMessageId
                                    ? [old.value.lastMessageId]
                                    : [],
                            });
                        }
                        work.store('threads').put({ accountId, id, value });
                        candidates.get('threads')!.add(id);
                    }

                    for (const resource of update.resources) {
                        if (
                            !resource.threadId ||
                            resource.requestCursor !== undefined
                        )
                            continue;
                        const old = oldResources.get(resource.key);
                        let unchangedCoverage =
                            old !== undefined &&
                            update.resources.length === 1 &&
                            (update.deleteKeys?.length ?? 0) === 0 &&
                            old.requestCursor === undefined &&
                            old.cursor === resource.cursor &&
                            old.hasNextPage === resource.hasNextPage;
                        if (unchangedCoverage && old) {
                            const ids = new Set(resource.orderedIds);
                            await work.pageIds(old, async (part) => {
                                if (part.some((id) => !ids.has(id)))
                                    unchangedCoverage = false;
                            });
                        }
                        if (unchangedCoverage) continue;
                        await work.capture(resource.threadId);
                        if (old && old.orderedIds.length)
                            await work.snapshot(
                                old,
                                `history-archive:${resource.threadId}:${old.orderedIds[0]}`,
                            );
                    }
                    // New edges precede old releases, including thread-owned transitive edges.
                    for (const resource of update.resources)
                        await work.references(resource.refs, 1);
                    for (const old of oldResources.values())
                        await work.remove(old, true);

                    const accepted: PersistedResource[] = [];
                    for (const resource of update.resources) {
                        const stored = await work.put(resource);
                        await work.adjustInventory(stored, 1);
                        accepted.push(stored);
                    }

                    // Active segment replacements must not leave ordering pointing at released facts.
                    const rebuildThreads = new Set<string>();
                    for (const old of oldResources.values()) {
                        if (!old.threadId || old.requestCursor === undefined)
                            continue;
                        const inventory = await work.inventory(old.threadId);
                        if (old.activeGeneration === inventory.generation)
                            rebuildThreads.add(old.threadId);
                    }
                    // Heads rebuild before continuations in a multi-page commit.
                    for (const resource of accepted.filter(
                        (resource) => resource.requestCursor === undefined,
                    ))
                        await work.activate(resource);
                    for (const threadId of rebuildThreads) {
                        if (
                            accepted.some(
                                (resource) =>
                                    resource.threadId === threadId &&
                                    resource.requestCursor === undefined,
                            )
                        )
                            continue;
                        const inventory = await work.inventory(threadId);
                        if (!inventory.headKey) continue;
                        const head = await get<Row<PersistedResource>>(
                            work.store('resources'),
                            [accountId, inventory.headKey],
                        );
                        if (head) await work.activate(head.value);
                    }
                    for (const resource of accepted.filter(
                        (resource) => resource.requestCursor !== undefined,
                    )) {
                        const current = (await get<Row<PersistedResource>>(
                            work.store('resources'),
                            [accountId, resource.key],
                        ))!.value;
                        const inventory = current.threadId
                            ? await work.inventory(current.threadId)
                            : undefined;
                        if (current.activeGeneration !== inventory?.generation)
                            await work.activate(current);
                    }

                    const deletedHistoryIds: string[] = [];
                    for (const threadId of new Set(
                        [...oldResources.values()].flatMap((resource) =>
                            resource.threadId ? [resource.threadId] : [],
                        ),
                    )) {
                        const inventory = await work.inventory(threadId);
                        if (inventory.segmentCount === 0) {
                            await cursorEach<Order>(
                                work.store('historyOrder').index('thread'),
                                [accountId, threadId],
                                (_order, cursor) => {
                                    cursor.delete();
                                },
                            );
                            work.store('historyInventory').delete([
                                accountId,
                                threadId,
                            ]);
                            deletedHistoryIds.push(threadId);
                        } else if (
                            inventory.headKey &&
                            !(await get(work.store('resources'), [
                                accountId,
                                inventory.headKey,
                            ]))
                        ) {
                            delete inventory.headKey;
                            delete inventory.tailKey;
                            delete inventory.cursor;
                            inventory.hasNextPage = false;
                            inventory.activeMessageCount = 0;
                            inventory.generation++;
                            work.store('historyInventory').put(inventory);
                        }
                    }
                    if (
                        update.retention &&
                        accepted.some((resource) => resource.threadId)
                    ) {
                        const protectedIds = new Set(
                            update.retention.protectedThreadIds,
                        );
                        let recent = 0;
                        await cursorEach<Inventory>(
                            work.store('historyInventory').index('access'),
                            [accountId],
                            (inventory) => {
                                if (!protectedIds.has(inventory.threadId)) {
                                    protectedIds.add(inventory.threadId);
                                    recent++;
                                }
                                return recent < 2;
                            },
                            'prev',
                        );
                        while (true) {
                            const totals = (await get<Totals>(
                                work.store('meta'),
                                totalsKey(accountId),
                            )) ?? { histories: 0, messages: 0 };
                            if (
                                totals.histories <=
                                    update.retention.maxHistories &&
                                totals.messages <= update.retention.maxMessages
                            )
                                break;
                            let victim: Inventory | undefined;
                            await cursorEach<Inventory>(
                                work.store('historyInventory').index('access'),
                                [accountId],
                                (inventory) => {
                                    if (protectedIds.has(inventory.threadId))
                                        return;
                                    victim = inventory;
                                    return false;
                                },
                            );
                            if (!victim) break;
                            // Fetch one descriptor at a time; no whole-history message array.
                            while (true) {
                                let page: PersistedResource | undefined;
                                await cursorEach<Row<PersistedResource>>(
                                    work.store('resources').index('history'),
                                    [accountId, victim.threadId],
                                    (row) => {
                                        page = row.value;
                                        return false;
                                    },
                                );
                                if (!page) break;
                                await work.remove(page, true);
                            }
                            await cursorEach<Order>(
                                work.store('historyOrder').index('thread'),
                                [accountId, victim.threadId],
                                (_order, cursor) => {
                                    cursor.delete();
                                },
                            );
                            await work.retirePrevious(victim.threadId);
                            work.store('historyInventory').delete([
                                accountId,
                                victim.threadId,
                            ]);
                            deletedHistoryIds.push(victim.threadId);
                        }
                    }

                    await work.prune(candidates);
                    const nextRevision =
                        revision(await get(work.store('meta'), 'revision')) + 1;
                    work.store('meta').put(nextRevision, 'revision');
                    return {
                        ...(await work.read(update.returnKeys ?? ['*'])),
                        deletedHistoryIds,
                    };
                },
            );
        },
    };
}

/** Cursor-driven v2 rebuild; migration stays in the upgrade transaction. */
export async function migrateHistoryStorage(
    tx: IDBTransaction,
    validateResource: (resource: PersistedResource) => boolean,
    validateFact: FactValidator,
): Promise<void> {
    const resourceStore = tx.objectStore('resources');
    resourceStore.createIndex('history', ['accountId', 'value.threadId', 'id']);
    resourceStore.createIndex(
        'historyCursor',
        ['accountId', 'value.threadId', 'value.requestCursor'],
        { unique: true },
    );

    // Mark partial histories first: one truncated segment invalidates the entire root.
    await new Promise<void>((resolve, reject) => {
        const request = resourceStore.openCursor();
        request.onerror = () => reject(new InboxError('storage'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            // SAFETY: validated below before dependency rebuilding.
            const row = cursor.value as Row<PersistedResource>;
            if (
                !row.accountId ||
                !validateResource(row.value) ||
                row.id !== row.value.key
            ) {
                reject(new InboxError('storage'));
                return;
            }
            if (row.value.threadId && row.value.retentionLimited)
                tx.objectStore('meta').put(true, [
                    'invalidHistory',
                    row.accountId,
                    row.value.threadId,
                ]);
            cursor.continue();
        };
    });

    // Await each row's keyed dependency work before advancing the upgrade cursor.
    await new Promise<void>((resolve, reject) => {
        const request = resourceStore.openCursor();
        request.onerror = () => reject(new InboxError('storage'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            // SAFETY: the adapter validates the migrated descriptor before it is used.
            const row = cursor.value as Row<PersistedResource>;
            void (async () => {
                if (!row.accountId || !validateResource(row.value))
                    throw new InboxError('storage');
                if (
                    row.value.threadId &&
                    (await get(tx.objectStore('meta'), [
                        'invalidHistory',
                        row.accountId,
                        row.value.threadId,
                    ]))
                ) {
                    cursor.delete();
                    cursor.continue();
                    return;
                }
                const work = new Work(
                    tx,
                    row.accountId,
                    validateFact,
                    validateResource,
                );
                const stored = await work.put(row.value);
                await work.resourceRefs(stored, 1);
                await work.adjustInventory(stored, 1);
                cursor.continue();
            })().catch(reject);
        };
    });
    await new Promise<void>((resolve, reject) => {
        const request = resourceStore.openCursor();
        request.onerror = () => reject(new InboxError('storage'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            // SAFETY: descriptors were validated in the first migration pass.
            const row = cursor.value as Row<PersistedResource>;
            void (async () => {
                if (row.value.threadId && row.value.requestCursor === undefined)
                    await new Work(
                        tx,
                        row.accountId,
                        validateFact,
                        validateResource,
                    ).activate(row.value);
                cursor.continue();
            })().catch(reject);
        };
    });
    await new Promise<void>((resolve, reject) => {
        const request = tx.objectStore('meta').openCursor();
        request.onerror = () => reject(new InboxError('storage'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            if (Array.isArray(cursor.key) && cursor.key[0] === 'invalidHistory')
                cursor.delete();
            cursor.continue();
        };
    });

    for (const kind of ['threads', 'users', 'messages'] as const) {
        await new Promise<void>((resolve, reject) => {
            const request = tx.objectStore(kind).openCursor();
            request.onerror = () => reject(new InboxError('storage'));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                // SAFETY: only envelope identity is used to query its keyed reference count.
                const row = cursor.value as Row<unknown>;
                void (async () => {
                    if (
                        (await new Work(tx, row.accountId).refCount(
                            kind,
                            row.id,
                        )) === 0
                    )
                        cursor.delete();
                    cursor.continue();
                })().catch(reject);
            };
        });
    }
}
