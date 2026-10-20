import { createInboxEngine } from './engine-fixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createInboxRepository } from '../lib/engine/db.ts';
import type { Message, Page, Thread } from '../lib/domain.ts';
import {
    InboxError,
    normalizeMessages,
    normalizePage,
    emptyEntities,
    type InboxProjection,
    type PersistedResource,
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
    const engine = await createInboxEngine(
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
            assert.ok(value.entities.threadsById.one);
            assert.ok(value.entities.usersById['u-one']);
            detailReady.resolve();
        }
    }, 'one');
    await detailReady.promise;
    assert.equal(engine.snapshot().inbox.synchronization, 'refreshing');

    network.resolve(page(thread('one'), thread('two')));
    await engine.refresh();
    stopDetail();
    stopInbox();
});

test('new subscribers cannot observe retained facts while renewed identity is pending', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const identity = deferred<string>();
    let recheck = false;
    const engine = await createInboxEngine(
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
    const repository = createInboxRepository(new IDBFactory());
    const inbox = normalizePage(page(thread('cached')));
    const history = normalizePage(page(thread('cached')));
    await repository.commitResources('account', {
        resources: [
            record('inbox:primary', inbox),
            {
                ...record(
                    'history:cached',
                    {
                        ...history,
                        resource: {
                            ...history.resource,
                            orderedIds: ['m-cached'],
                        },
                    },
                    'cached',
                ),
                viewerId: 'viewer',
            },
        ],
        entities: inbox.entities,
    });

    const network = deferred<Page<Thread>>();
    const networkStarted = deferred<void>();
    let inboxCalls = 0;
    let historyCalls = 0;
    const engine = await createInboxEngine(
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
    const repository = createInboxRepository(new IDBFactory());
    const cached = normalizePage(page(thread('safe')));
    await repository.commitResources('account', {
        resources: [record('inbox:primary', cached)],
        entities: cached.entities,
    });
    const engine = await createInboxEngine(
        {
            ...repository,
            commitResources: async () => {
                throw new Error('disk');
            },
        },
        provider({ inbox: async () => page(thread('unsafe')) }),
    );
    t.after(engine.dispose);
    await engine.refresh();
    assert.deepEqual(engine.snapshot().inbox.orderedIds, ['safe']);
    assert.equal(engine.snapshot().inbox.freshness, 'stale');
    assert.equal(engine.snapshot().inbox.error?.kind, 'storage');
});

test('continuation rejects nonempty duplicates and explicit retry can advance', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    let continuation = false;
    const engine = await createInboxEngine(
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

test('deferred inbox refresh does not block a missing cached detail fetch', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const cached = normalizePage(page(thread('thread')));
    await repository.commitResources('account', {
        resources: [record('inbox:primary', cached)],
        entities: cached.entities,
    });
    const inboxFlight = deferred<Page<Thread>>();
    const historyStarted = deferred<void>();
    const engine = await createInboxEngine(
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
    const repository = createInboxRepository(new IDBFactory());
    const cached = normalizePage(page(thread('thread')));
    await repository.commitResources('account', {
        resources: [record('inbox:primary', cached)],
        entities: cached.entities,
    });
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
    const engine = await createInboxEngine(
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
    const repository = createInboxRepository(new IDBFactory());
    const threads = Array.from({ length: 5 }, (_, index) =>
        thread(`t-${index}`),
    );
    const normalized = normalizePage(page(...threads));
    await repository.commitResources('account', {
        resources: [record('inbox:primary', normalized)],
        entities: normalized.entities,
    });
    const results = threads.map(() =>
        deferred<{
            items: Message[];
            hasNextPage: boolean;
            viewerId: string;
        }>(),
    );
    const started = threads.map(() => deferred<void>());
    const calls = threads.map(() => 0);
    const engine = await createInboxEngine(
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
    const repository = createInboxRepository(new IDBFactory());
    let continuation = false;
    const engine = await createInboxEngine(
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
    const repository = createInboxRepository(new IDBFactory());
    const cached = normalizePage(page(thread('thread')));
    await repository.commitResources('account', {
        resources: [record('inbox:primary', cached)],
        entities: cached.entities,
    });
    let inboxCalls = 0;
    const engine = await createInboxEngine(
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

test('evicting inactive histories removes their runtime projections as well as durable roots', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const threads = Array.from({ length: 25 }, (_, index) =>
        thread(`visited-${index}`),
    );
    const engine = await createInboxEngine(
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
});

test('head refresh preserves a failed continuation until that cursor chain changes', async (t) => {
    let cursor = 'older-a';
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
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
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
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
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
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
