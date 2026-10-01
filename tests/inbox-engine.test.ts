import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createInboxRepository } from '../lib/engine/db.ts';
import type {
    HistoryWindowRequest,
    HistoryWindowRead,
    ResourceCommit,
} from '../lib/engine/resources.ts';
import type { Message, Page, Thread } from '../lib/domain.ts';
import {
    createInboxEngine,
    InboxError,
    normalizeMessages,
    normalizePage,
    emptyEntities,
    type EntityFacts,
    type InboxRepository,
    type InboxProjection,
    type PersistedResource,
    type RepositoryRead,
} from '../lib/engine/inbox.ts';

function thread(id: string): Thread {
    return {
        key: id,
        title: `Thread ${id}`,
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 1,
        isUnread: false,
        serverIsPin: false,
        users: [{ id: `u-${id}`, username: id, fullName: id, picUrl: null }],
        lastMessage: {
            id: `m-${id}`,
            kind: 'text',
            text: id,
            senderId: `u-${id}`,
            ts: 1,
        },
    };
}

function page(...items: Thread[]): Page<Thread> {
    return { items, hasNextPage: false };
}

function message(id: string): Message {
    return {
        id,
        kind: 'text',
        text: id,
        senderId: 'u-thread',
        ts: Number(id.replace('m-', '')) || 1,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

function record(
    key: string,
    normalized: ReturnType<typeof normalizePage>,
    threadId?: string,
): PersistedResource {
    const refs = threadId
        ? {
              threadIds: [threadId],
              userIds: [`u-${threadId}`],
              messageIds: normalized.resource.orderedIds,
          }
        : {
              threadIds: normalized.resource.orderedIds,
              userIds: normalized.resource.orderedIds.map((id) => `u-${id}`),
              messageIds: normalized.resource.orderedIds.map((id) => `m-${id}`),
          };
    const result: PersistedResource = {
        ...normalized.resource,
        key,
        refs,
    };
    if (threadId) result.threadId = threadId;
    return result;
}

class MemoryRepository implements InboxRepository {
    readonly resources = new Map<string, PersistedResource>();
    entities: EntityFacts = {
        threadsById: {},
        usersById: {},
        messagesById: {},
    };
    revision = 0;
    fail = false;

    async readResources(
        _accountId: string,
        keys: string[],
    ): Promise<RepositoryRead> {
        function matches(key: string) {
            return keys.some((wanted) =>
                wanted.endsWith('*')
                    ? key.startsWith(wanted.slice(0, -1))
                    : key === wanted,
            );
        }
        return {
            resources: [...this.resources.values()].filter((resource) =>
                matches(resource.key),
            ),
            entities: this.entities,
            revision: this.revision,
        };
    }

    async readHistoryWindow(
        _accountId: string,
        threadId: string,
        request?: HistoryWindowRequest,
    ): Promise<HistoryWindowRead> {
        const head = this.resources.get(`history:${threadId}`);
        if (!head) return { entities: this.entities, revision: this.revision };
        const chain = [head];
        const visited = new Set<string>();
        let tail = head;
        while (tail.hasNextPage && tail.cursor && !visited.has(tail.cursor)) {
            visited.add(tail.cursor);
            const next = this.resources.get(
                `history:${threadId}:page:${tail.cursor}`,
            );
            if (!next) break;
            chain.push(next);
            tail = next;
        }

        const ids = [
            ...new Set(
                chain
                    .slice()
                    .reverse()
                    .flatMap((segment) => segment.orderedIds.slice().reverse()),
            ),
        ];
        const anchor = request?.anchorId ? ids.indexOf(request.anchorId) : -1;
        let start = Math.max(0, ids.length - 400);
        if (anchor >= 0)
            start =
                request?.direction === 'older'
                    ? Math.max(0, anchor - 320)
                    : request?.direction === 'newer'
                      ? Math.max(0, anchor - 80)
                      : anchor;
        const end = Math.min(ids.length, start + 400);
        return {
            history: {
                ...head,
                threadId,
                orderedIds: ids.slice(start, end),
                cursor: tail.cursor,
                hasNextPage: tail.hasNextPage,
                cachedOlder: start > 0,
                cachedNewer: end < ids.length,
            },
            entities: this.entities,
            revision: this.revision,
        };
    }

    async touchHistory() {}
    async readHistoryInventory() {
        return [];
    }

    async commitResources(
        _accountId: string,
        update: ResourceCommit,
    ): Promise<RepositoryRead> {
        if (this.fail) throw new Error('disk');
        for (const key of update.deleteKeys ?? []) this.resources.delete(key);
        for (const resource of update.resources) {
            if (
                resource.requestCursor &&
                resource.hasNextPage &&
                resource.cursor === resource.requestCursor
            )
                throw new InboxError('no_progress');
            this.resources.set(resource.key, resource);
        }
        this.entities = {
            threadsById: {
                ...this.entities.threadsById,
                ...update.entities.threadsById,
            },
            usersById: {
                ...this.entities.usersById,
                ...update.entities.usersById,
            },
            messagesById: {
                ...this.entities.messagesById,
                ...update.entities.messagesById,
            },
        };
        this.revision++;
        return {
            resources: [...this.resources.values()],
            entities: this.entities,
            revision: this.revision,
        };
    }

    async close() {}
}

function provider(
    overrides: Partial<Parameters<typeof createInboxEngine>[1]> = {},
) {
    return {
        account: async () => 'account',
        inbox: async () => page(thread('inbox')),
        history: async () => ({
            items: [],
            hasNextPage: false,
            viewerId: 'viewer',
        }),
        ...overrides,
    };
}

test('normalization scopes synthetic IDs without double encoding', () => {
    const message = {
        ...thread('one').lastMessage!,
        id: 'same',
        isSyntheticId: true as const,
    };
    assert.equal(
        normalizeMessages([message], 'one')[0].id,
        'synthetic:3:one:4:same',
    );
    assert.equal(
        normalizeMessages(normalizeMessages([message], 'one'), 'one')[0].id,
        'synthetic:3:one:4:same',
    );
    assert.notEqual(
        normalizeMessages([message], 'one')[0].id,
        normalizeMessages([message], 'two')[0].id,
    );
});

test('native repository detail hydration preserves other inbox facts during a deferred refresh', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const normalized = normalizePage(page(thread('one'), thread('two')));
    await repository.commitResources('account', {
        resources: [
            record('inbox:primary', normalized),
            {
                ...record(
                    'history:one',
                    {
                        ...normalized,
                        resource: {
                            ...normalized.resource,
                            orderedIds: ['m-one'],
                        },
                    },
                    'one',
                ),
                viewerId: 'viewer',
            },
        ],
        entities: normalized.entities,
    });
    const network = deferred<Page<Thread>>();
    const engine = createInboxEngine(
        repository,
        provider({ inbox: () => network.promise }),
    );
    t.after(engine.dispose);
    const inboxReady = deferred<void>();
    const stopInbox = engine.subscribe((value) => {
        if (value.inbox.availability === 'present') inboxReady.resolve();
    });
    await inboxReady.promise;
    const detailReady = deferred<void>();
    const stopDetail = engine.subscribe((value) => {
        if (value.histories.one?.availability === 'present') {
            assert.equal(value.entities.threadsById.two.title, 'Thread two');
            assert.ok(value.entities.messagesById['m-two']);
            detailReady.resolve();
        }
    }, 'one');
    await detailReady.promise;
    assert.equal(engine.snapshot().inbox.synchronization, 'refreshing');
    network.resolve(page(thread('one'), thread('two')));
    await engine.refresh();
    stopDetail();
    stopInbox();
    await repository.close();
});

test('new subscribers cannot observe retained facts while renewed identity is pending', async (t) => {
    const repository = new MemoryRepository();
    const identity = deferred<string>();
    let recheck = false;
    const engine = createInboxEngine(
        repository,
        provider({
            account: () =>
                recheck ? identity.promise : Promise.resolve('account'),
        }),
    );
    t.after(engine.dispose);
    const ready = deferred<void>();
    const stop = engine.subscribe((value) => {
        if (value.inbox.availability === 'present') ready.resolve();
    });
    await ready.promise;
    stop();
    recheck = true;
    const visible: string[] = [];
    const first = engine.subscribe((value) =>
        visible.push(...value.inbox.orderedIds),
    );
    const second = engine.subscribe((value) =>
        visible.push(...value.inbox.orderedIds),
    );
    assert.equal(visible.length, 0);
    identity.resolve('account');
    await engine.refresh();
    assert.ok(visible.includes('inbox'));
    first();
    second();
});

test('hydrates cached inbox and history before one deferred background inbox refresh', async (t) => {
    const repository = new MemoryRepository();
    const inbox = normalizePage(page(thread('cached')));
    const history = normalizePage(page(thread('cached')));
    repository.resources.set('inbox:primary', record('inbox:primary', inbox));
    repository.resources.set('history:cached', {
        ...record(
            'history:cached',
            {
                ...history,
                resource: { ...history.resource, orderedIds: ['m-cached'] },
            },
            'cached',
        ),
        viewerId: 'viewer',
    });
    repository.entities = inbox.entities;
    repository.revision = 1;
    const network = deferred<Page<Thread>>();
    const networkStarted = deferred<void>();
    let inboxCalls = 0;
    let historyCalls = 0;
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async () => {
                inboxCalls++;
                networkStarted.resolve();
                return network.promise;
            },
            history: async () => {
                historyCalls++;
                throw new Error('cached history must not fetch');
            },
        }),
    );
    t.after(engine.dispose);
    const cached = deferred<void>();
    engine.subscribe((value) => {
        if (value.inbox.orderedIds[0] === 'cached' && value.histories.cached)
            cached.resolve();
    }, 'cached');
    await cached.promise;
    await networkStarted.promise;
    assert.equal(inboxCalls, 1);
    assert.equal(historyCalls, 0);
    network.resolve(page(thread('fresh')));
    await engine.refresh();
    assert.deepEqual(engine.snapshot().inbox.orderedIds, ['fresh']);
});

test('a failed commit retains canonical data and never publishes fresh network data', async (t) => {
    const repository = new MemoryRepository();
    const cached = normalizePage(page(thread('safe')));
    repository.resources.set('inbox:primary', record('inbox:primary', cached));
    repository.entities = cached.entities;
    repository.revision = 1;
    repository.fail = true;
    const engine = createInboxEngine(
        repository,
        provider({ inbox: async () => page(thread('unsafe')) }),
    );
    t.after(engine.dispose);
    await engine.refresh();
    assert.deepEqual(engine.snapshot().inbox.orderedIds, ['safe']);
    assert.equal(engine.snapshot().inbox.freshness, 'stale');
    assert.equal(engine.snapshot().inbox.error?.kind, 'storage');
});

test('continuation rejects nonempty duplicates and explicit retry can advance', async (t) => {
    const repository = new MemoryRepository();
    let continuation = false;
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async (_account, cursor) => {
                if (!cursor)
                    return {
                        items: [thread('one')],
                        cursor: 'A',
                        hasNextPage: true,
                    };
                if (!continuation)
                    return {
                        items: [thread('one')],
                        cursor: 'B',
                        hasNextPage: true,
                    };
                return { items: [thread('two')], hasNextPage: false };
            },
        }),
    );
    t.after(engine.dispose);
    await engine.refresh();
    await engine.loadMoreInbox();
    assert.equal(engine.snapshot().inbox.error?.kind, 'no_progress');
    continuation = true;
    await engine.loadMoreInbox();
    assert.deepEqual(engine.snapshot().inbox.orderedIds, ['one', 'two']);
});

test('partial detail hydration keeps inbox facts and runtime data', async (t) => {
    const repository = new MemoryRepository();
    const cached = normalizePage(page(thread('thread')));
    repository.resources.set('inbox:primary', record('inbox:primary', cached));
    repository.entities = cached.entities;
    const history = normalizePage(page(thread('thread')));
    repository.resources.set('history:thread', {
        ...record(
            'history:thread',
            {
                ...history,
                resource: { ...history.resource, orderedIds: ['m-thread'] },
            },
            'thread',
        ),
        viewerId: 'viewer',
    });
    const inboxFlight = deferred<Page<Thread>>();
    const engine = createInboxEngine(
        repository,
        provider({ inbox: async () => inboxFlight.promise }),
    );
    t.after(engine.dispose);
    const cachedInbox = deferred<void>();
    engine.subscribe((value) => {
        if (value.inbox.orderedIds[0] === 'thread') cachedInbox.resolve();
    });
    await cachedInbox.promise;
    engine.subscribe(() => undefined, 'thread');
    await engine.refreshHistory('thread');
    assert.ok(engine.snapshot().entities.threadsById.thread);
    assert.ok(engine.snapshot().entities.usersById['u-thread']);
    inboxFlight.resolve(page(thread('thread')));
    await engine.refresh();
});

test('deferred inbox refresh does not block a missing cached detail fetch', async (t) => {
    const repository = new MemoryRepository();
    const cached = normalizePage(page(thread('thread')));
    repository.resources.set('inbox:primary', record('inbox:primary', cached));
    repository.entities = cached.entities;
    const inboxFlight = deferred<Page<Thread>>();
    const historyStarted = deferred<void>();
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async () => inboxFlight.promise,
            history: async () => {
                historyStarted.resolve();
                return {
                    items: [message('m-history')],
                    hasNextPage: false,
                    viewerId: 'viewer',
                };
            },
        }),
    );
    t.after(engine.dispose);
    engine.subscribe(() => undefined, 'thread');
    await historyStarted.promise;
    await engine.refreshHistory('thread');
    assert.equal(engine.snapshot().inbox.orderedIds[0], 'thread');
    assert.equal(
        engine.snapshot().histories.thread?.orderedIds[0],
        'm-history',
    );
    inboxFlight.resolve(page(thread('thread')));
    await engine.refresh();
});

test('reselecting a detail drops its old generation and sends a new request', async (t) => {
    const repository = new MemoryRepository();
    const cached = normalizePage(page(thread('thread')));
    repository.resources.set('inbox:primary', record('inbox:primary', cached));
    repository.entities = cached.entities;
    const oldResult = deferred<{
        items: Message[];
        hasNextPage: boolean;
        viewerId: string;
    }>();
    const newResult = deferred<{
        items: Message[];
        hasNextPage: boolean;
        viewerId: string;
    }>();
    const oldStarted = deferred<void>();
    const newStarted = deferred<void>();
    let calls = 0;
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async () => page(thread('thread')),
            history: async () => {
                calls++;
                if (calls === 1) {
                    oldStarted.resolve();
                    return oldResult.promise;
                }
                newStarted.resolve();
                return newResult.promise;
            },
        }),
    );
    t.after(engine.dispose);
    const first = engine.subscribe(() => undefined, 'thread');
    await oldStarted.promise;
    first();
    engine.subscribe(() => undefined, 'thread');
    await newStarted.promise;
    oldResult.resolve({
        items: [message('m-old')],
        hasNextPage: false,
        viewerId: 'viewer',
    });
    newResult.resolve({
        items: [message('m-new')],
        hasNextPage: false,
        viewerId: 'viewer',
    });
    await engine.refreshHistory('thread');
    assert.equal(engine.snapshot().entities.messagesById['m-old'], undefined);
});

test('a second listener keeps a queued shared detail flight alive', async (t) => {
    const repository = new MemoryRepository();
    const threads = Array.from({ length: 5 }, (_, index) =>
        thread(`t-${index}`),
    );
    const normalized = normalizePage(page(...threads));
    repository.resources.set(
        'inbox:primary',
        record('inbox:primary', normalized),
    );
    repository.entities = normalized.entities;
    const results = threads.map(() =>
        deferred<{
            items: Message[];
            hasNextPage: boolean;
            viewerId: string;
        }>(),
    );
    const started = threads.map(() => deferred<void>());
    const calls = threads.map(() => 0);
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async () => page(...threads),
            history: async (_account, threadId) => {
                const index = threads.findIndex(
                    (item) => item.key === threadId,
                );
                calls[index]++;
                started[index].resolve();
                return results[index].promise;
            },
        }),
    );
    t.after(engine.dispose);
    const unsubscribers = threads.map((item) =>
        engine.subscribe(() => undefined, item.key),
    );
    await Promise.all(started.slice(0, 4).map((item) => item.promise));
    const second = engine.subscribe(() => undefined, 't-4');
    for (const result of results.slice(0, 4))
        result.resolve({ items: [], hasNextPage: false, viewerId: 'viewer' });
    await started[4].promise;
    assert.equal(calls[4], 1);
    results[4].resolve({
        items: [message('m-shared')],
        hasNextPage: false,
        viewerId: 'viewer',
    });
    await engine.refreshHistory('t-4');
    second();
    for (const unsubscribe of unsubscribers) unsubscribe();
});

test('an exhausted duplicate continuation succeeds without a no-progress error', async (t) => {
    const repository = new MemoryRepository();
    let continuation = false;
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async (_account, cursor) => {
                if (!cursor)
                    return {
                        items: [thread('one')],
                        cursor: 'A',
                        hasNextPage: true,
                    };
                continuation = true;
                return { items: [thread('one')], hasNextPage: false };
            },
        }),
    );
    t.after(engine.dispose);
    await engine.refresh();
    await engine.loadMoreInbox();
    assert.equal(continuation, true);
    assert.equal(engine.snapshot().inbox.error, undefined);
    assert.equal(engine.snapshot().inbox.hasNextPage, false);
});

test('committing history does not clear an unrelated inbox error', async (t) => {
    const repository = new MemoryRepository();
    const cached = normalizePage(page(thread('thread')));
    repository.resources.set('inbox:primary', record('inbox:primary', cached));
    repository.entities = cached.entities;
    let inboxCalls = 0;
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async () => {
                inboxCalls++;
                if (inboxCalls === 1) throw new Error('network');
                return page(thread('thread'));
            },
            history: async () => ({
                items: [message('m-history')],
                hasNextPage: false,
                viewerId: 'viewer',
            }),
        }),
    );
    t.after(engine.dispose);
    await engine.refresh();
    engine.subscribe(() => undefined, 'thread');
    await engine.refreshHistory('thread');
    assert.equal(engine.snapshot().inbox.error?.kind, 'protocol');
});

test('history retention persists complete 501 rows while projecting at most 400 and admitting 20 roots', async (t) => {
    const repository = new MemoryRepository();
    const threads = Array.from({ length: 21 }, (_, index) =>
        thread(`t-${index}`),
    );
    const normalized = normalizePage(page(...threads));
    repository.resources.set(
        'inbox:primary',
        record('inbox:primary', normalized),
    );
    repository.entities = normalized.entities;
    const engine = createInboxEngine(
        repository,
        provider({
            inbox: async () => page(...threads),
            history: async (_account, threadId) => ({
                items:
                    threadId === 't-0'
                        ? Array.from({ length: 501 }, (_, index) =>
                              message(`m-${index}`),
                          )
                        : [message(`m-${threadId}`)],
                hasNextPage: false,
                viewerId: 'viewer',
            }),
        }),
    );
    t.after(engine.dispose);
    const unsubscribers = threads
        .slice(0, 20)
        .map((item) => engine.subscribe(() => undefined, item.key));
    for (const item of threads.slice(0, 20))
        await engine.refreshHistory(item.key);
    const historyRows =
        repository.resources.get('history:t-0')?.orderedIds ?? [];
    const roots = [...repository.resources.values()].filter(
        (resource) =>
            resource.threadId &&
            resource.key === `history:${resource.threadId}`,
    );
    assert.equal(historyRows.length, 501);
    assert.equal(engine.snapshot().histories['t-0'].orderedIds.length, 400);
    assert.equal(engine.snapshot().histories['t-0'].cachedOlder, true);
    assert.ok(roots.length <= 20);
    const rejected = engine.snapshot().histories['t-20'];
    assert.equal(rejected, undefined);
    for (const unsubscribe of unsubscribers) unsubscribe();
});

test('evicting inactive histories removes their runtime projections as well as durable roots', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const threads = Array.from({ length: 25 }, (_, index) =>
        thread(`visited-${index}`),
    );
    const engine = createInboxEngine(
        repository,
        provider({ inbox: async () => page(...threads) }),
    );
    t.after(engine.dispose);
    const ready = deferred<void>();
    const stopInbox = engine.subscribe((value) => {
        if (value.inbox.availability === 'present') ready.resolve();
    });
    await ready.promise;
    for (const item of threads) {
        const stopDetail = engine.subscribe(() => undefined, item.key);
        await engine.refreshHistory(item.key);
        assert.equal(
            engine.snapshot().histories[item.key]?.availability,
            'present',
        );
        assert.ok(Object.keys(engine.snapshot().histories).length <= 20);
        stopDetail();
    }
    const retained = await repository.readResources('account', ['history:*']);
    assert.equal(
        retained.resources.filter((resource) => !resource.requestCursor).length,
        20,
    );
    assert.equal(engine.snapshot().histories['visited-0'], undefined);
    stopInbox();
    await repository.close();
});

test('head refresh preserves a failed continuation until that cursor chain changes', async (t) => {
    let cursor = 'older-a';
    const engine = createInboxEngine(
        new MemoryRepository(),
        provider({
            history: async (
                _account: string,
                _thread: string,
                older?: string,
            ) => {
                if (older) throw new Error('continuation failed');
                return {
                    items: [message('m-20')],
                    viewerId: 'viewer',
                    cursor,
                    hasNextPage: true,
                };
            },
        }),
    );
    t.after(engine.dispose);
    const ready = deferred<void>();
    const stop = engine.subscribe((value) => {
        if (value.histories.inbox?.availability === 'present') ready.resolve();
    }, 'inbox');
    await ready.promise;
    await engine.loadOlderHistory('inbox');
    assert.equal(
        engine.snapshot().histories.inbox.failedOperation,
        'continuation',
    );
    await engine.refreshHistory('inbox');
    assert.equal(engine.snapshot().histories.inbox.synchronization, 'error');
    cursor = 'older-b';
    await engine.refreshHistory('inbox');
    assert.equal(engine.snapshot().histories.inbox.synchronization, 'idle');
    assert.equal(engine.snapshot().histories.inbox.error, undefined);
    stop();
});

test('a fresh client verifies the provider account before receiving existing facts', async (t) => {
    const renewal = deferred<string>();
    let renew = false;
    const engine = createInboxEngine(
        new MemoryRepository(),
        provider({
            account: () =>
                renew ? renewal.promise : Promise.resolve('account-a'),
        }),
    );
    t.after(engine.dispose);
    const loaded = deferred<void>();
    let existing!: InboxProjection;
    const stop = engine.subscribe((value) => {
        existing = value;
        if (value.inbox.availability === 'present') loaded.resolve();
    });
    await loaded.promise;
    renew = true;
    let newcomer!: InboxProjection;
    const verified = deferred<void>();
    const stopNew = engine.subscribe((value) => {
        newcomer = value;
        if (value.accountId === 'account-b') verified.resolve();
    });
    assert.equal(newcomer.accountId, null);
    assert.deepEqual(newcomer.entities, emptyEntities());
    assert.equal(existing.entities.threadsById.inbox.title, 'Thread inbox');
    renewal.resolve('account-b');
    await verified.promise;
    assert.equal(newcomer.accountId, 'account-b');
    stopNew();
    stop();
});

test('provider identity unavailability retains authorized cache but authentication failure clears it', async (t) => {
    let failure: 'provider_unavailable' | 'auth' | undefined;
    const engine = createInboxEngine(
        new MemoryRepository(),
        provider({
            account: async () => {
                if (failure) throw new InboxError(failure);
                return 'account';
            },
        }),
    );
    t.after(engine.dispose);
    const ready = deferred<void>();
    const snapshots: InboxProjection[] = [];
    const stop = engine.subscribe((value) => {
        snapshots.push(value);
        if (value.inbox.availability === 'present') ready.resolve();
    });
    await ready.promise;
    failure = 'provider_unavailable';
    await engine.refresh();
    assert.equal(engine.snapshot().inbox.error?.kind, 'provider_unavailable');
    assert.equal(
        engine.snapshot().entities.threadsById.inbox.title,
        'Thread inbox',
    );
    const retained = snapshots.at(-1)!;
    assert.equal(retained.accountId, 'account');
    assert.equal(retained.entities.threadsById.inbox.title, 'Thread inbox');
    assert.equal(retained.inbox.error?.kind, 'provider_unavailable');
    let newcomer: InboxProjection | undefined;
    const stopNewcomer = engine.subscribe((value) => {
        newcomer = value;
    });
    assert.equal(newcomer?.accountId, null);
    assert.deepEqual(newcomer?.entities, emptyEntities());
    // Drain the newcomer's unavailable renewal before changing its outcome.
    await engine.refresh();
    failure = 'auth';
    await engine.refresh();
    assert.equal(engine.snapshot().accountId, null);
    assert.equal(engine.snapshot().inbox.availability, 'absent');
    assert.equal(snapshots.at(-1)?.accountId, null);
    assert.deepEqual(snapshots.at(-1)?.entities, emptyEntities());
    stopNewcomer();
    stop();
});
