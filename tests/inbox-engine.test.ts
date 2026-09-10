import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { Page, Thread } from '../lib/domain.ts';
import { createInboxRepository } from '../lib/engine/db.ts';
import {
    createInboxEngine,
    InboxError,
    normalizeInbox,
    type InboxProjection,
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
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test('repository reopens, replaces one partition, and keeps global revision monotonic', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    const first = normalizeInbox(page(thread('a'), thread('a')));
    assert.deepEqual(first.orderedIds, ['a']);
    assert.equal(await repository.replaceInbox('1', first), 1);
    assert.equal(
        await repository.replaceInbox('2', normalizeInbox(page(thread('b')))),
        2,
    );
    await repository.close();
    repository = createInboxRepository(factory);
    assert.deepEqual((await repository.readInbox('1')).data?.orderedIds, ['a']);
    assert.equal(
        await repository.replaceInbox('1', normalizeInbox(page(thread('c')))),
        3,
    );
    assert.equal(
        (await repository.readInbox('1')).data?.threadsById.a,
        undefined,
    );
    assert.deepEqual((await repository.readInbox('2')).data?.orderedIds, ['b']);
    await repository.close();
});

test('reopened cache reaches two subscribers before one deferred provider refresh', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    await repository.replaceInbox('1', normalizeInbox(page(thread('cached'))));
    await repository.close();
    repository = createInboxRepository(factory);
    const network = deferred<Page<Thread>>();
    const cached = deferred<void>();
    let calls = 0;
    const engine = createInboxEngine(repository, {
        account: async () => '1',
        inbox: async () => {
            calls++;
            return network.promise;
        },
    });
    const one: InboxProjection[] = [];
    const two: InboxProjection[] = [];
    engine.subscribe((value) => {
        one.push(value);
        if (value.inbox?.orderedIds[0] === 'cached') cached.resolve();
    });
    engine.subscribe((value) => two.push(value));
    await cached.promise;
    assert.equal(calls, 1);
    assert.equal(one.at(-1)?.inbox?.orderedIds[0], 'cached');
    assert.equal(two.at(-1)?.inbox?.orderedIds[0], 'cached');
    network.resolve(page(thread('fresh')));
    await engine.refresh();
    assert.deepEqual(one.at(-1)?.inbox?.orderedIds, ['fresh']);
    assert.deepEqual(two.at(-1)?.inbox?.orderedIds, ['fresh']);
    await repository.close();
});

test('subscriber joining a verified refresh receives cached state immediately', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    await repository.replaceInbox('1', normalizeInbox(page(thread('cached'))));
    const network = deferred<Page<Thread>>();
    const cached = deferred<void>();
    let calls = 0;
    const engine = createInboxEngine(repository, {
        account: async () => '1',
        inbox: async () => {
            calls++;
            return network.promise;
        },
    });
    engine.subscribe((value) => {
        if (value.inbox) cached.resolve();
    });
    await cached.promise;
    const values: InboxProjection[] = [];
    engine.subscribe((value) => values.push(value));
    assert.equal(values[0].inbox?.orderedIds[0], 'cached');
    assert.equal(calls, 1);
    network.resolve(page(thread('fresh')));
    await engine.refresh();
    await repository.close();
});

test('subscriber starting a new flight stays blank until account verification', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const account = deferred<string>();
    let first = true;
    const engine = createInboxEngine(repository, {
        account: async () => (first ? ((first = false), '1') : account.promise),
        inbox: async () => page(thread('fresh')),
    });
    engine.subscribe(() => undefined);
    await engine.refresh();
    const values: InboxProjection[] = [];
    engine.subscribe((value) => values.push(value));
    assert.equal(values[0].inbox, null);
    assert.equal(values[0].accountId, null);
    account.resolve('1');
    await engine.refresh();
    assert.equal(values.at(-1)?.inbox?.orderedIds[0], 'fresh');
    await repository.close();
});

test('protocol failures retain verified cache while auth and account changes clear or partition it', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    await repository.replaceInbox('1', normalizeInbox(page(thread('one'))));
    let account = '1';
    let failure: InboxError | undefined = new InboxError('protocol');
    const engine = createInboxEngine(repository, {
        account: async () => account,
        inbox: async () => {
            if (failure) throw failure;
            return page(thread('two'));
        },
    });
    engine.subscribe(() => undefined);
    await engine.refresh();
    assert.equal(engine.snapshot().inbox?.orderedIds[0], 'one');
    assert.equal(engine.snapshot().error?.kind, 'protocol');
    failure = new InboxError('auth');
    await engine.refresh();
    assert.equal(engine.snapshot().inbox, null);
    account = '2';
    failure = undefined;
    await engine.refresh();
    assert.deepEqual(engine.snapshot().inbox?.orderedIds, ['two']);
    assert.equal((await repository.readInbox('1')).data?.orderedIds[0], 'one');
    await repository.close();
});

test('repository failures are classified storage and never publish false fresh state', async () => {
    const rejected = Promise.reject(new Error('disk'));
    rejected.catch(() => undefined);
    const engine = createInboxEngine(
        {
            readInbox: () => rejected,
            replaceInbox: async () => {
                throw new Error('disk');
            },
            close: async () => undefined,
        },
        { account: async () => '1', inbox: async () => page(thread('a')) },
    );
    engine.subscribe(() => undefined);
    await engine.refresh();
    assert.equal(engine.snapshot().error?.kind, 'storage');
    assert.notEqual(engine.snapshot().freshness, 'fresh');
});

test('failed replacement aborts prior deletes and preserves revision', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    await repository.replaceInbox('1', normalizeInbox(page(thread('safe'))));
    const invalid = normalizeInbox(page(thread('invalid')));
    Object.assign(invalid.usersById['u-invalid'], {
        uncloneable: () => 'not cloneable',
    });
    await assert.rejects(repository.replaceInbox('1', invalid));
    await repository.close();
    repository = createInboxRepository(factory);
    const retained = await repository.readInbox('1');
    assert.deepEqual(retained.data?.orderedIds, ['safe']);
    assert.equal(retained.revision, 1);
    await repository.close();
});

test('plain repository write failures are storage errors', async () => {
    const engine = createInboxEngine(
        {
            readInbox: async () => ({ data: null, revision: 0 }),
            replaceInbox: async () => {
                throw new Error('disk');
            },
            close: async () => undefined,
        },
        { account: async () => '1', inbox: async () => page(thread('a')) },
    );
    engine.subscribe(() => undefined);
    await engine.refresh();
    assert.equal(engine.snapshot().error?.kind, 'storage');
    assert.notEqual(engine.snapshot().freshness, 'fresh');
});
