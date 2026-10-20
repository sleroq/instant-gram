import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore, IDBIndex } from 'fake-indexeddb';
import { createInboxRepository } from '../lib/engine/db.ts';
import {
    emptyEntities,
    type PersistedResource,
    type ResourceCommit,
} from '../lib/engine/resources.ts';

function page(
    threadId: string,
    start: number,
    count: number,
    requestCursor?: string,
    cursor?: string,
): ResourceCommit {
    const ids = Array.from(
        { length: count },
        (_, index) => `${threadId}:${start + index}`,
    );
    const entities = emptyEntities();
    for (const id of ids)
        entities.messagesById[id] = {
            id,
            kind: 'text',
            text: id,
            senderId: 'u',
            ts: 1,
        };
    return {
        returnKeys: ['inbox:*'],
        entities,
        resources: [
            {
                key: `history:${threadId}${requestCursor === undefined ? '' : `:page:${requestCursor}`}`,
                threadId,
                requestCursor,
                cursor,
                orderedIds: ids,
                fetchedAt: 10,
                hasNextPage: cursor !== undefined,
                availability: 'present',
                freshness: 'fresh',
                synchronization: 'idle',
                refs: { threadIds: [], userIds: [], messageIds: ids },
            },
        ],
    };
}

async function open(factory: IDBFactory, version = 5): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory.open('icr-successor', version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function done(tx: IDBTransaction): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
    });
}

test('complete oversized pages survive restart and bounded indexed windows traverse thousands of IDs', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    // Production commits and bounded reads must never use account-wide getAll.
    const storeAll = IDBObjectStore.prototype.getAll;
    const indexAll = IDBIndex.prototype.getAll;
    IDBObjectStore.prototype.getAll = () => {
        throw new Error('getAll forbidden');
    };
    IDBIndex.prototype.getAll = () => {
        throw new Error('index.getAll forbidden');
    };
    try {
        const committed = await repository.commitResources(
            'one',
            page('t', 3000, 501, undefined, 'older-1'),
        );
        assert.deepEqual(committed.resources, []);
        assert.deepEqual(committed.entities, emptyEntities());
        await repository.commitResources(
            'one',
            page('t', 2000, 1000, 'older-1', 'older-2'),
        );
        await repository.commitResources('one', page('t', 0, 2000, 'older-2'));
        await repository.close();
        repository = createInboxRepository(factory);
        const newest = await repository.readHistoryWindow('one', 't');
        assert.equal(newest.history?.orderedIds.length, 400);
        assert.equal(newest.history?.orderedIds[0], 't:3101');
        assert.equal(newest.history?.orderedIds.at(-1), 't:3500');
        assert.equal(newest.history?.cachedOlder, true);
        assert.equal(newest.history?.cachedNewer, false);
        assert.equal(newest.history?.hasNextPage, false);

        const older = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:3101',
            direction: 'older',
        });
        assert.equal(older.history?.orderedIds.length, 400);
        assert.equal(older.history?.orderedIds[0], 't:2781');
        assert.equal(older.history?.orderedIds.at(-1), 't:3180');

        const newer = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:2781',
            direction: 'newer',
        });
        assert.equal(newer.history?.orderedIds[0], 't:2701');
        assert.equal(newer.history?.orderedIds.at(-1), 't:3100');
        assert.equal(Object.keys(newer.entities.messagesById).length, 400);
        assert.equal('refs' in newest.history!, false);
        assert.equal('key' in newest.history!, false);
        assert.deepEqual((await repository.readHistoryInventory('one'))[0], {
            threadId: 't',
            lastAccessedAt: 10,
            segmentCount: 3,
            retainedMessageCount: 3501,
            activeMessageCount: 3501,
        });

        const db = await open(factory);
        const tx = db.transaction(['resources', 'historyChunks'], 'readonly');
        let physical = 0;
        for (const name of ['resources', 'historyChunks']) {
            await new Promise<void>((resolve, reject) => {
                const request = tx.objectStore(name).openCursor();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) {
                        resolve();
                        return;
                    }
                    const value =
                        name === 'resources'
                            ? cursor.value.value
                            : cursor.value;
                    assert.ok(value.orderedIds.length <= 400);
                    assert.ok(value.refs.messageIds.length <= 400);
                    physical += value.orderedIds.length;
                    cursor.continue();
                };
            });
        }
        assert.equal(physical, 3501);
        db.close();
    } finally {
        IDBObjectStore.prototype.getAll = storeAll;
        IDBIndex.prototype.getAll = indexAll;
        await repository.close();
    }
});

test('refresh follows exact durable cursor links, detached arrivals never certify gaps, cycles abort', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await repository.commitResources('one', page('t', 100, 2, undefined, 'a'));
    await repository.commitResources('one', page('t', 90, 2, 'a', 'b'));
    await repository.commitResources('one', page('t', 80, 2, 'b'));

    await repository.commitResources(
        'one',
        page('t', 110, 2, undefined, 'gap'),
    );
    assert.deepEqual(
        (await repository.readHistoryWindow('one', 't')).history?.orderedIds,
        ['t:110', 't:111'],
    );
    await repository.commitResources('one', page('t', 70, 2, 'late'));
    assert.deepEqual(
        (await repository.readHistoryWindow('one', 't')).history?.orderedIds,
        ['t:110', 't:111'],
    );
    await repository.commitResources('one', page('t', 110, 2, undefined, 'a'));
    assert.deepEqual(
        (await repository.readHistoryWindow('one', 't')).history?.orderedIds,
        ['t:80', 't:81', 't:90', 't:91', 't:110', 't:111'],
    );

    const before = await repository.readHistoryWindow('one', 't');
    await assert.rejects(
        repository
            .commitResources('one', page('t', 90, 2, undefined, 'cycle'))
            .then(() =>
                repository.commitResources(
                    'one',
                    page('t', 80, 2, 'cycle', 'cycle'),
                ),
            ),
        { kind: 'no_progress' },
    );

    // The failed cyclic continuation rolls back its facts and revision, not the earlier successful head.
    const after = await repository.readHistoryWindow('one', 't');
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(after.history?.orderedIds, ['t:90', 't:91']);
    await repository.close();
});

test('active segment replacement rebuilds coverage and deleting a root is an honest cache miss', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await repository.commitResources('one', page('t', 100, 2, undefined, 'a'));
    await repository.commitResources('one', page('t', 90, 2, 'a', 'b'));
    await repository.commitResources('one', page('t', 80, 2, 'b'));

    await repository.commitResources('one', page('t', 95, 2, 'a', 'gap'));
    assert.deepEqual(
        (await repository.readHistoryWindow('one', 't')).history?.orderedIds,
        ['t:95', 't:96', 't:100', 't:101'],
    );
    await repository.commitResources('one', page('t', 0, 0, 'gap'));
    assert.equal(
        (await repository.readHistoryWindow('one', 't')).history?.hasNextPage,
        false,
    );

    const resources = (await repository.readResources('one', ['history:t*']))
        .resources;
    const removed = await repository.commitResources('one', {
        resources: [],
        entities: emptyEntities(),
        deleteKeys: resources.map((resource) => resource.key),
        returnKeys: ['inbox:*'],
    });
    assert.deepEqual(removed.deletedHistoryIds, ['t']);
    assert.equal(
        (await repository.readHistoryWindow('one', 't')).history,
        undefined,
    );
    assert.deepEqual(await repository.readHistoryInventory('one'), []);
    await repository.close();
});

test('duplicate-only nonterminal continuation aborts, terminal overlap establishes exhaustion', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await repository.commitResources('one', page('t', 1, 3, undefined, 'a'));
    await assert.rejects(
        repository.commitResources('one', page('t', 1, 3, 'a', 'b')),
        /no older/,
    );
    assert.equal((await repository.readHistoryWindow('one', 't')).revision, 1);
    await repository.commitResources('one', page('t', 1, 3, 'a'));
    const window = await repository.readHistoryWindow('one', 't');
    assert.deepEqual(window.history?.orderedIds, ['t:1', 't:2', 't:3']);
    assert.equal(window.history?.hasNextPage, false);
    await repository.close();
});

test('durable whole-history LRU protects active and two recent inactive roots, preview facts and other accounts', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    const inbox: PersistedResource = {
        ...page('t0', 0, 1).resources[0]!,
        key: 'inbox:primary',
        threadId: undefined,
        orderedIds: ['thread'],
        refs: { threadIds: ['thread'], userIds: [], messageIds: [] },
    };
    const facts = page('t0', 0, 1).entities;
    facts.usersById.u = { id: 'u', username: 'u', fullName: 'u', picUrl: null };
    facts.threadsById.thread = {
        key: 'thread',
        title: 'thread',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 1,
        isUnread: false,
        serverIsPin: false,
        userIds: ['u'],
        lastMessageId: 't0:0',
    };
    await repository.commitResources('one', {
        resources: [inbox],
        entities: facts,
        returnKeys: ['inbox:primary'],
    });
    await repository.commitResources('two', page('t0', 0, 100));
    for (let index = 0; index < 5; index++) {
        await repository.commitResources('one', page(`t${index}`, 0, 100));
        await repository.touchHistory('one', `t${index}`, 100 + index);
    }

    const revisionBefore = (await repository.readHistoryWindow('one', 't0'))
        .revision;
    await repository.touchHistory('one', 't0', 1);
    assert.equal(
        (await repository.readHistoryWindow('one', 't0')).revision,
        revisionBefore,
    );
    await repository.close();
    repository = createInboxRepository(factory);

    const update = page('active', 0, 501);
    update.retention = {
        protectedThreadIds: ['active', 't1'],
        maxHistories: 2,
        maxMessages: 200,
    };
    const committed = await repository.commitResources('one', update);
    assert.deepEqual(committed.deletedHistoryIds, ['t0', 't2']);
    assert.deepEqual(
        new Set(
            (await repository.readHistoryInventory('one')).map(
                (row) => row.threadId,
            ),
        ),
        new Set(['active', 't1', 't3', 't4']),
    );
    assert.equal(
        (await repository.readHistoryWindow('one', 't0')).history,
        undefined,
    );
    assert.equal(
        (await repository.readHistoryWindow('two', 't0')).history?.orderedIds
            .length,
        100,
    );
    assert.ok(
        (await repository.readResources('one', ['inbox:primary'])).entities
            .messagesById['t0:0'],
    );
    const db = await open(factory);
    const tx = db.transaction(['messages'], 'readonly');
    const request = tx.objectStore('messages').get(['one', 't0:1']);
    const evicted = await new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result);
    });
    assert.equal(evicted, undefined);
    db.close();
    await repository.close();
});

test('fact-only shared thread updates move transitive ownership without rewriting resources', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    const initial = emptyEntities();
    initial.usersById.old = {
        id: 'old',
        username: 'old',
        fullName: 'old',
        picUrl: null,
    };
    initial.messagesById.old = {
        id: 'old',
        kind: 'activity',
        text: 'old',
        ts: 1,
    };
    initial.threadsById.t = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 1,
        isUnread: false,
        serverIsPin: false,
        userIds: ['old'],
        lastMessageId: 'old',
    };
    const resource: PersistedResource = {
        ...page('t', 0, 0).resources[0]!,
        key: 'inbox:primary',
        threadId: undefined,
        orderedIds: ['t'],
        refs: { threadIds: ['t'], userIds: [], messageIds: [] },
    };
    await repository.commitResources('one', {
        resources: [resource],
        entities: initial,
        returnKeys: ['inbox:primary'],
    });

    const updated = emptyEntities();
    updated.usersById.new = {
        id: 'new',
        username: 'new',
        fullName: 'new',
        picUrl: null,
    };
    updated.messagesById.new = {
        id: 'new',
        kind: 'activity',
        text: 'new',
        ts: 2,
    };
    updated.threadsById.t = {
        ...initial.threadsById.t!,
        userIds: ['new'],
        lastMessageId: 'new',
    };
    const read = await repository.commitResources('one', {
        resources: [],
        entities: updated,
        returnKeys: ['inbox:primary'],
    });
    assert.deepEqual(read.resources, [resource]);
    assert.deepEqual(Object.keys(read.entities.usersById), ['new']);
    assert.deepEqual(Object.keys(read.entities.messagesById), ['new']);

    const db = await open(factory);
    for (const kind of ['users', 'messages']) {
        const tx = db.transaction(kind, 'readonly');
        const request = tx.objectStore(kind).get(['one', 'old']);
        const orphan = await new Promise((resolve) => {
            request.onsuccess = () => resolve(request.result);
        });
        assert.equal(orphan, undefined);
    }
    db.close();
    await repository.close();
});

test('quota failure while storing an oversized page atomically preserves old facts and revision', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await repository.commitResources('one', page('t', 0, 3));
    const before = await repository.readHistoryWindow('one', 't');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
        if (this.name === 'historyChunks')
            throw new DOMException('Full', 'QuotaExceededError');
        return put.apply(this, args);
    };
    try {
        await assert.rejects(
            repository.commitResources('one', page('t', 10, 501)),
            { kind: 'storage' },
        );
    } finally {
        IDBObjectStore.prototype.put = put;
    }
    assert.deepEqual(await repository.readHistoryWindow('one', 't'), before);
    assert.equal(
        (await repository.readHistoryInventory('one'))[0]?.retainedMessageCount,
        3,
    );
    await repository.close();
});

test('v2 truncated history invalidates all its segments but preserves inbox previews and revision', async () => {
    const factory = new IDBFactory();
    const request = factory.open('icr-successor', 2);
    request.onupgradeneeded = () => {
        for (const name of ['users', 'threads', 'messages', 'resources']) {
            const store = request.result.createObjectStore(name, {
                keyPath: ['accountId', 'id'],
            });
            store.createIndex('accountId', 'accountId');
        }
        request.result.createObjectStore('meta');
    };

    const db = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['messages', 'resources', 'meta'], 'readwrite');
    const head = page('t', 10, 5, undefined, 'a');
    const older = page('t', 0, 5, 'a');
    older.resources[0]!.retentionLimited = true;
    for (const update of [head, older]) {
        for (const [id, value] of Object.entries(update.entities.messagesById))
            tx.objectStore('messages').put({ accountId: 'one', id, value });
        for (const value of update.resources)
            tx.objectStore('resources').put({
                accountId: 'one',
                id: value.key,
                value,
            });
    }

    const preview = {
        ...head.resources[0]!,
        key: 'inbox:primary',
        threadId: undefined,
        cursor: undefined,
        hasNextPage: false,
        orderedIds: [],
        refs: { threadIds: [], userIds: [], messageIds: ['t:10'] },
    };
    tx.objectStore('resources').put({
        accountId: 'one',
        id: preview.key,
        value: preview,
    });
    tx.objectStore('meta').put(17, 'revision');
    await done(tx);
    db.close();

    const repository = createInboxRepository(factory);
    const missing = await repository.readHistoryWindow('one', 't');
    assert.equal(missing.history, undefined);
    assert.equal(missing.revision, 17);
    assert.deepEqual(await repository.readHistoryInventory('one'), []);
    const read = await repository.readResources('one', ['*']);
    assert.deepEqual(
        read.resources.map((resource) => resource.key),
        ['inbox:primary'],
    );
    assert.deepEqual(Object.keys(read.entities.messagesById), ['t:10']);
    await repository.close();
});

test('replacing an active head collects obsolete order generations without touching another history', async (t) => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    t.after(() => repository.close());
    await repository.commitResources('one', page('other', 0, 1));
    for (let index = 0; index < 25; index++)
        await repository.commitResources('one', page('t', index, 1));
    const current = await repository.readHistoryWindow('one', 't');
    const other = await repository.readHistoryWindow('one', 'other');
    assert.deepEqual(current.history?.orderedIds, ['t:24']);
    assert.deepEqual(other.history?.orderedIds, ['other:0']);
    const database = await open(factory);
    t.after(() => database.close());
    const transaction = database.transaction(
        ['historyOrder', 'messages', 'resources'],
        'readonly',
    );
    const counts = await Promise.all(
        ['historyOrder', 'messages', 'resources'].map(
            (name) =>
                new Promise<number>((resolve, reject) => {
                    const request = transaction.objectStore(name).count();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                }),
        ),
    );
    // Current orders are bounded; durable archives intentionally retain each distinct old head.
    assert.deepEqual(counts, [2, 26, 28]);
    await done(transaction);
});

test('covered single-head refresh skips proof maintenance but changed cursor captures coverage', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    try {
        await repository.commitResources(
            'one',
            page('t', 1200, 501, undefined, 'a'),
        );
        await repository.commitResources('one', page('t', 0, 1200, 'a', 'b'));
        await repository.commitResources(
            'one',
            page('t', 1200, 502, undefined, 'a'),
        );
        assert.deepEqual(
            (
                await repository.readResources('one', [
                    'history-archive:t:*',
                    'history-previous:t*',
                ])
            ).resources,
            [],
        );
        assert.equal(
            (await repository.readHistoryInventory('one'))[0]?.segmentCount,
            2,
        );

        await repository.commitResources(
            'one',
            page('t', 1200, 502, undefined, 'changed'),
        );
        const old = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:0',
            direction: 'at',
        });
        assert.equal(old.history?.orderedIds[0], 't:0');
        assert.equal(old.history?.cursor, 'b');
        assert.equal(old.history?.newerCoverageAvailable, true);
        const database = await open(factory);
        try {
            const transaction = database.transaction(
                ['historyChunks'],
                'readonly',
            );
            let copied = 0;
            await new Promise<void>((resolve, reject) => {
                const request = transaction
                    .objectStore('historyChunks')
                    .openCursor();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) {
                        resolve();
                        return;
                    }
                    const chunk = cursor.value;
                    if (chunk.resourceKey === 'history-previous:t:orders') {
                        assert.ok(chunk.orderedIds.length <= 400);
                        assert.ok(chunk.refs.messageIds.length <= 400);
                        copied += chunk.orderedIds.length;
                    }
                    cursor.continue();
                };
            });
            assert.equal(copied, 1302);
            await done(transaction);
        } finally {
            database.close();
        }
    } finally {
        await repository.close();
    }
});

test('pressure evicts previous ownership, archives and indexes with the whole root', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    try {
        await repository.commitResources('one', page('old', 0, 500));
        await repository.commitResources('one', page('old', 1000, 2));
        await repository.commitResources('one', page('recent-a', 0, 2));
        await repository.commitResources('one', page('recent-b', 0, 2));
        await repository.touchHistory('one', 'recent-a', 20);
        await repository.touchHistory('one', 'recent-b', 30);

        const update = page('active', 0, 2);
        update.retention = {
            maxHistories: 3,
            maxMessages: 6,
            protectedThreadIds: ['active'],
        };
        const result = await repository.commitResources('one', update);
        assert.ok(result.deletedHistoryIds?.includes('old'));
        assert.equal(
            (
                await repository.readHistoryWindow('one', 'old', {
                    anchorId: 'old:0',
                    coverageGeneration: 1,
                })
            ).history,
            undefined,
        );
        const database = await open(factory);
        try {
            const transaction = database.transaction(
                [
                    'historyPrevious',
                    'historyPreviousOrder',
                    'messages',
                    'resources',
                ],
                'readonly',
            );
            for (const name of ['historyPrevious', 'historyPreviousOrder']) {
                const count = await new Promise<number>((resolve, reject) => {
                    const request = transaction.objectStore(name).count();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                assert.equal(count, 0);
            }
            await done(transaction);
        } finally {
            database.close();
        }
        assert.deepEqual(
            (
                await repository.readResources('one', [
                    'history-previous:old*',
                    'history-archive:old:*',
                ])
            ).resources,
            [],
        );
    } finally {
        await repository.close();
    }
});

test('full overlap retires previous proof and pinned anchors fall back to current', async () => {
    const repository = createInboxRepository(new IDBFactory());
    try {
        await repository.commitResources('one', page('t', 0, 500));
        const generation = (await repository.readHistoryWindow('one', 't'))
            .history!.coverageGeneration;
        await repository.commitResources(
            'one',
            page('t', 1000, 2, undefined, 'join'),
        );
        await repository.commitResources('one', page('t', 0, 500, 'join'));
        const joined = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:0',
            direction: 'at',
            coverageGeneration: generation,
        });
        assert.equal(joined.history?.orderedIds[0], 't:0');
        assert.notEqual(joined.history?.coverageGeneration, generation);
        assert.equal(joined.history?.newerCoverageAvailable, false);
        assert.deepEqual(
            (await repository.readResources('one', ['history-previous:t*']))
                .resources,
            [],
        );
        assert.equal(
            (await repository.readHistoryInventory('one'))[0]
                ?.retainedMessageCount,
            502,
        );
    } finally {
        await repository.close();
    }
});

test('previous proven coverage survives unmatched heads, restart and matching frontier continuation', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    await repository.commitResources(
        'one',
        page('t', 1200, 400, undefined, 'a'),
    );
    await repository.commitResources('one', page('t', 400, 800, 'a', 'b'));
    const generation = (await repository.readHistoryWindow('one', 't')).history!
        .coverageGeneration;

    await repository.commitResources(
        'one',
        page('t', 2000, 2, undefined, 'new'),
    );
    await repository.commitResources(
        'one',
        page('t', 3000, 2, undefined, 'newer'),
    );
    await repository.close();
    repository = createInboxRepository(factory);
    try {
        const old = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:1200',
            direction: 'older',
            coverageGeneration: generation,
        });
        assert.equal(old.history?.orderedIds[0], 't:880');
        assert.equal(old.history?.cursor, 'b');
        assert.equal(old.history?.coverageGeneration, generation);
        assert.equal(old.history?.newerCoverageAvailable, true);

        await repository.commitResources('one', page('t', 0, 400, 'b'));
        const oldest = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:0',
            direction: 'at',
            coverageGeneration: generation,
        });
        assert.equal(oldest.history?.orderedIds[0], 't:0');
        assert.equal(oldest.history?.hasNextPage, false);
        assert.equal(oldest.history?.cachedOlder, false);
        assert.deepEqual(
            (await repository.readHistoryWindow('one', 't')).history
                ?.orderedIds,
            ['t:3000', 't:3001'],
        );
        const archive = await repository.readResources('one', [
            'history-archive:t:t:1200',
        ]);
        assert.equal(Object.keys(archive.entities.messagesById).length, 400);

        const before = await repository.readHistoryWindow('one', 't', {
            anchorId: 't:0',
            coverageGeneration: generation,
        });
        const invalid = page('t', 4000, 2);
        invalid.resources[0]!.refs.messageIds.push('missing');
        await assert.rejects(repository.commitResources('one', invalid));
        assert.deepEqual(
            (
                await repository.readHistoryWindow('one', 't', {
                    anchorId: 't:0',
                    coverageGeneration: generation,
                })
            ).history,
            before.history,
        );
    } finally {
        await repository.close();
    }
});

test('retained anchors include preceding layout context while exact boundary rereads remain fixed', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    t.after(() => repository.close());
    await repository.commitResources('one', page('t', 0, 1000));
    const around = await repository.readHistoryWindow('one', 't', {
        anchorId: 't:980',
    });
    assert.equal(around.history?.orderedIds[0], 't:900');
    assert.equal(around.history?.orderedIds.indexOf('t:980'), 80);
    assert.equal(around.history?.cachedNewer, false);
    assert.equal(around.history?.cachedOlder, true);
    assert.ok(around.history!.orderedIds.length <= 400);
    const fixed = await repository.readHistoryWindow('one', 't', {
        anchorId: around.history!.orderedIds[0],
        direction: 'at',
    });
    assert.deepEqual(fixed.history?.orderedIds, around.history?.orderedIds);
});
