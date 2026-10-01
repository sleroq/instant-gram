import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createInboxRepository } from '../lib/engine/db.ts';
import { createInboxEngine } from '../lib/engine/inbox.ts';
import type { InboxProjection } from '../lib/engine/resources.ts';
import type { Message, Thread, ThreadMessages } from '../lib/domain.ts';

const conversation: Thread = {
    key: 'durable',
    title: 'Durable',
    isGroup: false,
    isMuted: false,
    folder: 'PRIMARY',
    lastActivityMs: 1230,
    isUnread: false,
    serverIsPin: false,
    users: [
        { id: 'sender', username: 'sender', fullName: 'Sender', picUrl: null },
    ],
};
function item(index: number): Extract<Message, { kind: 'text' }> {
    return {
        id: `row-${index}`,
        kind: 'text',
        text: `${index}`,
        senderId: 'sender',
        ts: index,
    };
}
function ready() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test('different active threads retain complete window facts across bounded commits', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const engine = createInboxEngine(repository, {
        account: async () => 'account',
        inbox: async () => ({
            items: ['a', 'b'].map((key) => ({ ...conversation, key })),
            hasNextPage: false,
        }),
        history: async (_account, threadId) => ({
            items: Array.from({ length: 501 }, (_, index) => ({
                ...item(index),
                id: `${threadId}-${index}`,
            })),
            viewerId: 'viewer',
            hasNextPage: false,
        }),
    });
    t.after(async () => {
        await engine.dispose();
        await repository.close();
    });
    await engine.refresh();
    const projections = new Map<string, InboxProjection>();
    for (const id of ['a', 'b']) {
        const loaded = ready();
        engine.subscribe((value) => {
            projections.set(id, value);
            if (value.histories[id]?.availability === 'present')
                loaded.resolve();
        }, id);
        await loaded.promise;
    }
    await engine.refreshHistory('b');
    await engine.refresh();
    for (const id of ['a', 'b']) {
        const value = projections.get(id)!;
        assert.ok(value.histories[id].orderedIds.length > 0);
        assert.ok(value.histories[id].orderedIds.length <= 400);
        for (const messageId of value.histories[id].orderedIds)
            assert.ok(value.entities.messagesById[messageId], messageId);
    }
    assert.ok(
        Object.keys(engine.snapshot().entities.messagesById).length <= 2000,
    );
});

test('replacement owners receive one window and root credit without renewing healthy identity', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    let accounts = 0;
    const engine = createInboxEngine(repository, {
        account: async () => {
            accounts++;
            return 'account';
        },
        inbox: async () => ({
            items: Array.from({ length: 21 }, (_, index) => ({
                ...conversation,
                key: `t-${index}`,
            })),
            hasNextPage: false,
        }),
        history: async (_account, threadId) => ({
            items: [{ ...item(1), id: threadId }],
            viewerId: 'viewer',
            hasNextPage: false,
        }),
    });
    t.after(async () => {
        await engine.dispose();
        await repository.close();
    });
    await engine.refresh();
    const owners: ((value: InboxProjection) => void)[] = [];
    const releases: (() => void)[] = [];
    for (let index = 0; index < 20; index++) {
        const loaded = ready();
        const owner = (value: InboxProjection) => {
            if (value.histories[`t-${index}`]?.availability === 'present')
                loaded.resolve();
        };
        owners.push(owner);
        releases.push(engine.subscribe(owner, `t-${index}`));
        await loaded.promise;
    }
    const before = accounts;
    let same!: InboxProjection;
    const sameOwner = (value: InboxProjection) => {
        same = value;
    };
    const stopSame = engine.subscribe(sameOwner, 't-0', 't-0', owners[0]);
    assert.equal(same.accountId, 'account');
    assert.notEqual(same.histories['t-0']?.error?.kind, 'capacity');
    releases[0]();
    let different!: InboxProjection;
    const differentOwner = (value: InboxProjection) => {
        different = value;
    };
    const stopDifferent = engine.subscribe(
        differentOwner,
        't-20',
        undefined,
        sameOwner,
    );
    assert.notEqual(different.histories['t-20']?.error?.kind, 'capacity');
    stopSame();
    assert.equal(accounts, before);
    await engine.refreshHistory('t-20', differentOwner);
    assert.equal(different.histories['t-20'].availability, 'present');
    let rejected!: InboxProjection;
    const stopRejected = engine.subscribe((value) => {
        rejected = value;
    }, 't-0');
    assert.equal(rejected.histories['t-0'].error?.kind, 'capacity');
    stopRejected();
    stopDifferent();
    for (const release of releases.slice(1)) release();
});

test('complete 30-page history survives restart with independent bounded cached windows', async (t) => {
    const factory = new IDBFactory();
    let requests = 0;
    const provider = {
        account: async () => 'retention-account',
        inbox: async () => ({ items: [conversation], hasNextPage: false }),
        history: async (_account: string, _thread: string, cursor?: string) => {
            requests++;
            const page = cursor ? Number(cursor) : 0;
            const result: ThreadMessages = {
                items: Array.from({ length: 41 }, (_, offset) =>
                    item(1190 - page * 41 + offset),
                ),
                viewerId: 'viewer',
                hasNextPage: page < 29,
            };
            if (page < 29) result.cursor = String(page + 1);
            return result;
        },
    };
    const repository = createInboxRepository(factory);
    const engine = createInboxEngine(repository, provider);
    t.after(engine.dispose);
    const initial = ready();
    const stop = engine.subscribe((value) => {
        if (value.histories.durable?.availability === 'present')
            initial.resolve();
    }, 'durable');
    await initial.promise;
    for (let attempt = 0; attempt < 100 && requests < 30; attempt++)
        await engine.loadOlderHistory('durable');
    assert.equal(requests, 30);
    assert.ok(engine.snapshot().histories.durable.orderedIds.length <= 400);
    assert.ok(
        Object.keys(engine.snapshot().entities.messagesById).length <= 800,
    );
    assert.equal(
        (await repository.readHistoryInventory('retention-account'))[0]
            .activeMessageCount,
        1230,
    );
    stop();
    await engine.dispose();
    await repository.close();

    const reopened = createInboxRepository(factory);
    const restarted = createInboxEngine(reopened, provider);
    t.after(async () => {
        await restarted.dispose();
        await reopened.close();
    });
    const olderReady = ready();
    const newerReady = ready();
    let older!: InboxProjection;
    let newer!: InboxProjection;
    function oldListener(value: InboxProjection) {
        older = value;
        if (value.histories.durable?.availability === 'present')
            olderReady.resolve();
    }
    function newListener(value: InboxProjection) {
        newer = value;
        if (value.histories.durable?.availability === 'present')
            newerReady.resolve();
    }
    restarted.subscribe(oldListener, 'durable', 'row-1');
    restarted.subscribe(newListener, 'durable', 'row-900');
    await Promise.all([olderReady.promise, newerReady.promise]);
    assert.equal(requests, 30);
    assert.equal(older.histories.durable.orderedIds[0], 'row-1');
    assert(newer.histories.durable.orderedIds.includes('row-900'));
    assert.equal(newer.histories.durable.orderedIds[0], 'row-820');
    const untouched = [...newer.histories.durable.orderedIds];
    await restarted.loadNewerHistory('durable', oldListener);
    assert.deepEqual(newer.histories.durable.orderedIds, untouched);
    assert.ok(older.histories.durable.orderedIds.length <= 400);
    assert.ok(newer.histories.durable.orderedIds.length <= 400);
    assert.ok(
        Object.keys(restarted.snapshot().entities.messagesById).length <= 1200,
    );
    await restarted.loadOlderHistory('durable', newListener);
    assert.equal(requests, 30);
});

test('only 20 granted windows contribute detail interest and rejected listeners can retry a released slot', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    let requests = 0;
    const engine = createInboxEngine(repository, {
        account: async () => 'window-account',
        inbox: async () => ({ items: [conversation], hasNextPage: false }),
        history: async () => {
            requests++;
            return {
                items: Array.from({ length: 501 }, (_, index) =>
                    item(index + 1),
                ),
                viewerId: 'viewer',
                hasNextPage: false,
            };
        },
    });
    t.after(async () => {
        await engine.dispose();
        await repository.close();
    });
    await engine.refresh();
    const hydrated = ready();
    const admitted = Array.from({ length: 20 }, () =>
        engine.subscribe((value) => {
            if (value.histories.durable?.availability === 'present')
                hydrated.resolve();
        }, 'durable'),
    );
    await hydrated.promise;

    let rejected!: InboxProjection;
    function rejectedListener(value: InboxProjection) {
        rejected = value;
    }
    const releaseRejected = engine.subscribe(
        rejectedListener,
        'durable',
        'row-1',
    );
    const before = requests;
    await engine.refreshHistory('wrong-thread', rejectedListener);
    assert.equal(requests, before);
    assert.equal(rejected.histories.durable.error?.kind, 'capacity');
    assert.equal(rejected.histories.durable.orderedIds.length, 0);
    assert.ok(
        Object.keys(engine.snapshot().entities.messagesById).length <=
            20 * 400 + 3 * 400,
    );
    admitted[0]();
    await engine.refreshHistory('durable', rejectedListener, 'row-1');
    assert.equal(rejected.histories.durable.availability, 'present');
    assert.equal(rejected.histories.durable.orderedIds[0], 'row-1');
    assert.ok(
        Object.keys(engine.snapshot().entities.messagesById).length <=
            20 * 400 + 3 * 400,
    );
    for (const release of admitted.slice(1)) release();
    releaseRejected();
});

test('older in-flight facts cannot replace newer durable facts after their runtime window is evicted', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    const started = ready();
    let complete!: (history: ThreadMessages) => void;
    const pending = new Promise<ThreadMessages>((resolve) => {
        complete = resolve;
    });
    const engine = createInboxEngine(repository, {
        account: async () => 'account',
        inbox: async () => ({
            items: ['a', 'b', 'c', 'd', 'e'].map((key) => ({
                ...conversation,
                key,
            })),
            hasNextPage: false,
        }),
        history: async (_account, threadId) => {
            if (threadId === 'a') {
                started.resolve();
                return pending;
            }
            return {
                items: [
                    {
                        ...item(1),
                        id: threadId === 'b' ? 'shared' : threadId,
                        text: 'newer',
                    },
                ],
                viewerId: 'viewer',
                hasNextPage: false,
            };
        },
    });
    t.after(async () => {
        await engine.dispose();
        await repository.close();
    });
    const aReady = ready();
    engine.subscribe((value) => {
        if (value.histories.a?.availability === 'present') aReady.resolve();
    }, 'a');
    await started.promise;

    for (const id of ['b', 'c', 'd', 'e']) {
        const hydrated = ready();
        const stop = engine.subscribe((value) => {
            if (value.histories[id]?.availability === 'present')
                hydrated.resolve();
        }, id);
        await hydrated.promise;
        stop();
    }
    assert.equal(engine.snapshot().entities.messagesById.shared, undefined);
    complete({
        items: [{ ...item(1), id: 'shared', text: 'older' }],
        viewerId: 'viewer',
        hasNextPage: false,
    });
    await aReady.promise;
    const runtimeMessage = engine.snapshot().entities.messagesById.shared;
    assert.ok(runtimeMessage.kind === 'text');
    assert.equal(runtimeMessage.text, 'newer');
    const durable = await repository.readHistoryWindow('account', 'a');
    const durableMessage = durable.entities.messagesById.shared;
    assert.ok(durableMessage.kind === 'text');
    assert.equal(durableMessage.text, 'newer');
});

test('changed heads preserve independent previous coverage and use its own older frontier', async (t) => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    let changed = false;
    const calls: string[] = [];
    const provider = {
        account: async () => 'account',
        inbox: async () => ({ items: [conversation], hasNextPage: false }),
        history: async (_account: string, _thread: string, cursor?: string) => {
            calls.push(cursor ?? 'head');
            if (cursor === 'old-tail')
                return {
                    items: Array.from({ length: 40 }, (_, i) => item(i - 39)),
                    hasNextPage: false,
                    viewerId: 'viewer',
                };
            assert.equal(
                cursor,
                undefined,
                'an old reader must not request the new frontier',
            );
            return changed
                ? {
                      items: [item(2000), item(2001)],
                      cursor: 'new-tail',
                      hasNextPage: true,
                      viewerId: 'viewer',
                  }
                : {
                      items: Array.from({ length: 1230 }, (_, i) =>
                          item(i + 1),
                      ),
                      cursor: 'old-tail',
                      hasNextPage: true,
                      viewerId: 'viewer',
                  };
        },
    };
    const engine = createInboxEngine(repository, provider);
    t.after(async () => {
        await engine.dispose();
        await repository.close();
    });
    const loaded = ready();
    let old!: InboxProjection;
    const oldOwner = (value: InboxProjection) => {
        old = value;
        if (value.histories.durable?.availability === 'present')
            loaded.resolve();
    };
    engine.subscribe(oldOwner, 'durable', 'row-1');
    await loaded.promise;
    changed = true;
    await engine.refreshHistory('durable', oldOwner, 'row-1');
    assert.equal(old.histories.durable.orderedIds[0], 'row-1');
    assert.equal(old.histories.durable.newerCoverageAvailable, true);
    assert.equal(old.histories.durable.freshness, 'stale');
    const latestReady = ready();
    let latest!: InboxProjection;
    const latestOwner = (value: InboxProjection) => {
        latest = value;
        if (value.histories.durable?.orderedIds.includes('row-2001'))
            latestReady.resolve();
    };
    engine.subscribe(latestOwner, 'durable');
    await latestReady.promise;
    const latestIds = [...latest.histories.durable.orderedIds];
    assert.notEqual(
        latest.histories.durable.coverageGeneration,
        old.histories.durable.coverageGeneration,
    );
    await engine.loadOlderHistory('durable', oldOwner);
    assert.equal(calls.at(-1), 'old-tail');
    assert.equal(old.histories.durable.orderedIds[0], 'row--39');
    assert.deepEqual(latest.histories.durable.orderedIds, latestIds);
    for (let step = 0; old.histories.durable.cachedNewer && step < 10; step++)
        await engine.loadNewerHistory('durable', oldOwner);
    assert.equal(old.histories.durable.cachedNewer, false);
    assert.equal(old.histories.durable.newerCoverageAvailable, true);
    const beforeLatest = calls.length;
    await engine.loadNewerHistory('durable', oldOwner);
    assert.deepEqual(old.histories.durable.orderedIds, latestIds);
    assert.equal(calls.length, beforeLatest);
    assert.ok(
        Object.keys(engine.snapshot().entities.messagesById).length <= 1200,
    );
});
