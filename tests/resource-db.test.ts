import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { Message, User } from '../lib/domain.ts';
import type { JsonValue } from '../lib/json.ts';
import { createInboxRepository } from '../lib/engine/db.ts';
import {
    type EntityFacts,
    type PersistedResource,
    type ThreadFact,
} from '../lib/engine/resources.ts';

const DB_NAME = 'icr-successor';

function user(id: string): User {
    return { id, username: id, fullName: id, picUrl: null };
}

function message(id: string): Message {
    return { id, kind: 'text', text: id, senderId: 'sender', ts: 1 };
}

function thread(id: string, userId: string, messageId: string): ThreadFact {
    return {
        key: id,
        title: id,
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 1,
        isUnread: false,
        serverIsPin: false,
        userIds: [userId],
        lastMessageId: messageId,
    };
}

function entities(
    ...facts: Array<readonly [ThreadFact, User, Message]>
): EntityFacts {
    const value: EntityFacts = {
        threadsById: {},
        usersById: {},
        messagesById: {},
    };
    for (const [threadFact, factUser, factMessage] of facts) {
        value.threadsById[threadFact.key] = threadFact;
        value.usersById[factUser.id] = factUser;
        value.messagesById[factMessage.id] = factMessage;
    }
    return value;
}

function resource(
    key: string,
    refs: PersistedResource['refs'],
    requestCursor?: string,
): PersistedResource {
    const value: PersistedResource = {
        key,
        orderedIds:
            refs.threadIds.length > 0 ? refs.threadIds : refs.messageIds,
        fetchedAt: 1,
        hasNextPage: false,
        availability: 'present',
        freshness: 'fresh',
        synchronization: 'idle',
        refs,
    };
    if (requestCursor !== undefined) value.requestCursor = requestCursor;
    return value;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function createV1Stores(request: IDBOpenDBRequest): void {
    request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of ['users', 'threads', 'messages']) {
            const store = database.createObjectStore(name, {
                keyPath: ['accountId', 'id'],
            });
            store.createIndex('accountId', 'accountId');
        }
        const resources = database.createObjectStore('resources', {
            keyPath: ['accountId', 'id'],
        });
        resources.createIndex('accountId', 'accountId');
        database.createObjectStore('meta');
    };
}

async function seedV1(
    factory: IDBFactory,
    resourceValue: JsonValue | undefined,
    revision: number,
): Promise<void> {
    const openRequest = factory.open(DB_NAME, 1);
    createV1Stores(openRequest);
    const database = await requestDone(openRequest);
    const transaction = database.transaction(
        ['users', 'threads', 'messages', 'resources', 'meta'],
        'readwrite',
    );
    transaction
        .objectStore('users')
        .put({ accountId: 'one', id: 'u-one', value: user('u-one') });
    transaction.objectStore('threads').put({
        accountId: 'one',
        id: 't-one',
        value: thread('t-one', 'u-one', 'm-one'),
    });
    transaction
        .objectStore('messages')
        .put({ accountId: 'one', id: 'm-one', value: message('m-one') });

    transaction
        .objectStore('users')
        .put({ accountId: 'one', id: 'u-orphan', value: user('u-orphan') });
    transaction.objectStore('threads').put({
        accountId: 'one',
        id: 't-orphan',
        value: thread('t-orphan', 'u-orphan', 'm-orphan'),
    });
    transaction.objectStore('messages').put({
        accountId: 'one',
        id: 'm-orphan',
        value: message('m-orphan'),
    });
    transaction
        .objectStore('resources')
        .put({ accountId: 'one', id: 'inbox:primary', value: resourceValue });

    transaction
        .objectStore('users')
        .put({ accountId: 'two', id: 'u-two', value: user('u-two') });
    transaction.objectStore('threads').put({
        accountId: 'two',
        id: 't-two',
        value: thread('t-two', 'u-two', 'm-two'),
    });
    transaction
        .objectStore('messages')
        .put({ accountId: 'two', id: 'm-two', value: message('m-two') });
    transaction.objectStore('resources').put({
        accountId: 'two',
        id: 'inbox:primary',
        value: { orderedIds: ['t-two'], fetchedAt: 2, hasNextPage: false },
    });

    transaction.objectStore('meta').put(revision, 'revision');
    await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    database.close();
}

async function seedV1Schema(
    factory: IDBFactory,
    value: JsonValue | undefined,
): Promise<void> {
    const openRequest = factory.open(DB_NAME, 1);
    createV1Stores(openRequest);
    const database = await requestDone(openRequest);
    const transaction = database.transaction(['resources'], 'readwrite');
    transaction
        .objectStore('resources')
        .put({ accountId: 'one', id: 'inbox:primary', value });
    await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    database.close();
}

test('migrates both v1 account partitions and preserves revision after reopen', async () => {
    const factory = new IDBFactory();
    await seedV1(
        factory,
        { orderedIds: ['t-one'], fetchedAt: 2, hasNextPage: false },
        17,
    );
    let repository = createInboxRepository(factory);
    const first = await repository.readResources('one', ['inbox:primary']);
    assert.equal(first.revision, 17);
    assert.deepEqual(first.resources[0]?.refs.threadIds, ['t-one']);
    assert.deepEqual(Object.keys(first.entities.threadsById), ['t-one']);
    assert.equal(first.entities.threadsById['t-orphan'], undefined);
    await repository.commitResources('one', {
        resources: first.resources,
        entities: first.entities,
    });
    const pruned = await repository.readResources('one', ['inbox:primary']);
    assert.equal(pruned.entities.threadsById['t-orphan'], undefined);
    const database = await requestDone(factory.open(DB_NAME, 4));
    const inspection = database.transaction(['threads'], 'readonly');
    const orphan = await requestDone(
        inspection.objectStore('threads').get(['one', 't-orphan']),
    );
    assert.equal(orphan, undefined);
    database.close();
    await repository.close();
    repository = createInboxRepository(factory);
    const reopened = await repository.readResources('two', ['inbox:primary']);
    assert.equal(reopened.revision, 18);
    assert.deepEqual(reopened.resources[0]?.orderedIds, ['t-two']);
    assert.equal(reopened.entities.threadsById['t-one'], undefined);
    await repository.close();
});

test('aborts malformed v1 migration without changing the v1 database', async () => {
    const factory = new IDBFactory();
    await seedV1Schema(factory, {
        orderedIds: [7],
        fetchedAt: 1,
        hasNextPage: false,
    });
    const repository = createInboxRepository(factory);
    await assert.rejects(repository.readResources('one', ['inbox:primary']));
    await repository.close();
    const database = await requestDone(factory.open(DB_NAME, 1));
    assert.equal(database.version, 1);
    const transaction = database.transaction(['resources'], 'readonly');
    const row = await requestDone(
        transaction.objectStore('resources').get(['one', 'inbox:primary']),
    );
    assert.deepEqual(row, {
        accountId: 'one',
        id: 'inbox:primary',
        value: { orderedIds: [7], fetchedAt: 1, hasNextPage: false },
    });
    database.close();
});

test('closes the v4 connection when a native v5 open requests a versionchange', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    await repository.readResources('one', ['inbox:primary']);
    const upgraded = await requestDone(factory.open(DB_NAME, 5));
    assert.equal(upgraded.version, 5);
    upgraded.close();
    await repository.close();
});

test('rejects dangling persisted references on read and commit', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    const facts = [thread('t', 'u', 'm'), user('u'), message('m')] as const;
    const head = resource('inbox:primary', {
        threadIds: ['t'],
        userIds: ['u'],
        messageIds: ['m'],
    });
    await repository.commitResources('one', {
        resources: [head],
        entities: entities(facts),
    });

    await assert.rejects(
        repository.commitResources('one', {
            resources: [
                resource('inbox:primary', {
                    threadIds: ['t'],
                    userIds: ['u'],
                    messageIds: ['missing'],
                }),
            ],
            entities: entities(facts),
        }),
    );
    await assert.rejects(
        repository.commitResources('one', {
            resources: [
                resource('inbox:primary', {
                    threadIds: ['t'],
                    userIds: [],
                    messageIds: [],
                }),
            ],
            entities: {
                threadsById: { t: thread('t', 'u', 'missing') },
                usersById: { u: user('u') },
                messagesById: {},
            },
        }),
    );
    const database = await requestDone(factory.open(DB_NAME, 4));
    const transaction = database.transaction(['messages'], 'readwrite');
    transaction.objectStore('messages').delete(['one', 'm']);
    await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    await assert.rejects(repository.readResources('one', ['inbox:primary']));
    await repository.close();
});

test('rejects unknown or incomplete persisted message variants', async () => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);
    const facts = [thread('t', 'u', 'm'), user('u'), message('m')] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t'],
                userIds: ['u'],
                messageIds: ['m'],
            }),
        ],
        entities: entities(facts),
    });
    const database = await requestDone(factory.open(DB_NAME, 4));
    const transaction = database.transaction(['messages'], 'readwrite');
    transaction.objectStore('messages').put({
        accountId: 'one',
        id: 'm',
        value: { ...facts[2], kind: 'future_variant' },
    });
    await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    await assert.rejects(repository.readResources('one', ['inbox:primary']));
    await repository.close();
});

test('refreshing a head retains facts referenced by another resource', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const first = [
        thread('t-head', 'u-head', 'm-head'),
        user('u-head'),
        message('m-head'),
    ] as const;
    const second = [
        thread('t-page', 'u-page', 'm-page'),
        user('u-page'),
        message('m-page'),
    ] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t-head'],
                userIds: ['u-head'],
                messageIds: ['m-head'],
            }),
            resource(
                'inbox:primary:page:1',
                {
                    threadIds: ['t-page'],
                    userIds: ['u-page'],
                    messageIds: ['m-page'],
                },
                'cursor-1',
            ),
        ],
        entities: entities(first, second),
    });

    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t-head'],
                userIds: ['u-head'],
                messageIds: ['m-head'],
            }),
        ],
        entities: entities(first),
    });

    const result = await repository.readResources('one', [
        'inbox:primary:page:*',
    ]);
    assert.deepEqual(Object.keys(result.entities.threadsById), ['t-page']);
    await repository.close();
});

test('current thread dependencies retain updated participant and latest message', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const initial = [
        thread('t', 'v-old', 'm-old'),
        user('v-old'),
        message('m-old'),
    ] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t'],
                userIds: ['v-old'],
                messageIds: ['m-old'],
            }),
            resource('history:t', {
                threadIds: ['t'],
                userIds: [],
                messageIds: [],
            }),
        ],
        entities: entities(initial),
    });

    const updated = [
        thread('t', 'v-new', 'm-new'),
        user('v-new'),
        message('m-new'),
    ] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t'],
                userIds: ['v-new'],
                messageIds: ['m-new'],
            }),
        ],
        entities: entities(updated),
        deleteKeys: ['inbox:primary'],
    });

    const result = await repository.readResources('one', ['history:t']);
    assert.ok(result.entities.threadsById.t);
    assert.ok(result.entities.usersById['v-new']);
    assert.ok(result.entities.messagesById['m-new']);
    assert.equal(result.entities.usersById['v-old'], undefined);
    await repository.close();
});

test('deleting the last resource reference prunes its facts', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const facts = [thread('t', 'u', 'm'), user('u'), message('m')] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t'],
                userIds: ['u'],
                messageIds: ['m'],
            }),
        ],
        entities: entities(facts),
    });
    await repository.commitResources('one', {
        resources: [],
        entities: { threadsById: {}, usersById: {}, messagesById: {} },
        deleteKeys: ['inbox:primary'],
    });
    const result = await repository.readResources('one', ['*']);
    assert.deepEqual(result.entities, {
        threadsById: {},
        usersById: {},
        messagesById: {},
    });
    await repository.close();
});

test('failed commit rolls back resources, facts, and revision', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const facts = [thread('t', 'u', 'm'), user('u'), message('m')] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t'],
                userIds: ['u'],
                messageIds: ['m'],
            }),
        ],
        entities: entities(facts),
    });
    const invalidMessage = Object.assign({}, facts[2], {
        notCloneable: () => 'not cloneable',
    });
    const invalidFacts = [facts[0], facts[1], invalidMessage] as const;
    await assert.rejects(
        repository.commitResources('one', {
            resources: [
                resource('inbox:primary', {
                    threadIds: ['t'],
                    userIds: ['u'],
                    messageIds: ['m'],
                }),
            ],
            entities: entities(invalidFacts),
        }),
    );
    const result = await repository.readResources('one', ['inbox:primary']);
    assert.equal(result.revision, 1);
    assert.equal(result.resources[0]?.fetchedAt, 1);
    await repository.close();
});

test('revision is global while facts remain partitioned', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const first = [
        thread('t-one', 'u-one', 'm-one'),
        user('u-one'),
        message('m-one'),
    ] as const;
    const second = [
        thread('t-two', 'u-two', 'm-two'),
        user('u-two'),
        message('m-two'),
    ] as const;
    await repository.commitResources('one', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t-one'],
                userIds: ['u-one'],
                messageIds: ['m-one'],
            }),
        ],
        entities: entities(first),
    });
    const secondCommit = await repository.commitResources('two', {
        resources: [
            resource('inbox:primary', {
                threadIds: ['t-two'],
                userIds: ['u-two'],
                messageIds: ['m-two'],
            }),
        ],
        entities: entities(second),
    });
    assert.equal(secondCommit.revision, 2);
    const firstRead = await repository.readResources('one', ['inbox:primary']);
    assert.equal(firstRead.revision, 2);
    assert.equal(firstRead.entities.threadsById['t-two'], undefined);
    await repository.close();
});
