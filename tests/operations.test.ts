import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore, IDBIndex } from 'fake-indexeddb';
import { createInboxRepository } from '../lib/engine/db.ts';
import {
    type MutationCommand,
    projectOperations,
    isMutationCommand,
    MAX_SEND_TEXT_LENGTH,
    ACTIVE_OPERATION_LIMIT,
    retainRuntimeOperations,
} from '../lib/engine/operations.ts';
import {
    emptyEntities,
    emptyResource,
    type InboxProjection,
    type ThreadFact,
} from '../lib/engine/resources.ts';

const command: MutationCommand = {
    accountId: 'a',
    accountEpoch: 1,
    operationId: 'one',
    intent: { type: 'send', threadId: 't', text: 'hello' },
};
const request = {
    intent: command.intent,
    offlineThreadingId: 'offline',
    viewerId: 'viewer',
};

async function seedOperationThread(
    repository: ReturnType<typeof createInboxRepository>,
    accountId = 'a',
): Promise<void> {
    await repository.commitResources(accountId, {
        resources: [
            {
                ...emptyResource(),
                key: 'operation-fixture',
                refs: { threadIds: ['t'], userIds: [], messageIds: [] },
            },
        ],
        entities: {
            ...emptyEntities(),
            threadsById: {
                t: {
                    key: 't',
                    title: 't',
                    isGroup: false,
                    isMuted: false,
                    folder: 'PRIMARY',
                    lastActivityMs: 0,
                    isUnread: false,
                    serverIsPin: false,
                    userIds: [],
                },
            },
        },
    });
}

test('durable acceptance deduplicates immutable intent, partitions accounts, and survives restart', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    await seedOperationThread(repository);
    const first = await repository.acceptOperation(command, request, 10);
    const duplicate = await repository.acceptOperation(
        command,
        { ...request, offlineThreadingId: 'different' },
        20,
    );
    assert.deepEqual(duplicate, first);
    await assert.rejects(
        repository.acceptOperation(
            {
                ...command,
                intent: { ...command.intent, type: 'send', text: 'changed' },
            },
            request,
            20,
        ),
    );
    assert.deepEqual((await repository.readOperations('b')).operations, []);
    const next = await repository.updateOperation('a', {
        ...first.operation,
        status: 'dispatching',
        attempts: 1,
    });
    assert.ok(next.revision > first.revision);
    await repository.close();
    repository = createInboxRepository(factory);
    assert.equal(
        (await repository.readOperations('a')).operations[0]?.status,
        'dispatching',
    );
    await repository.close();
});

test('projector keeps failed sends, aliases receipts once, and is idempotent', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const { operation } = await repository.acceptOperation(
        command,
        request,
        10,
    );

    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'worker',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: { t: { ...emptyResource(), threadId: 't' } },
    };
    const failed = projectOperations(projection, [
        { ...operation, status: 'failed', retryable: true },
    ]);
    assert.equal(
        failed.entities.messagesById['operation:one']?.delivery?.status,
        'failed',
    );
    const receipt = {
        id: 'server',
        kind: 'text' as const,
        text: 'hello',
        senderId: 'viewer',
        ts: 11,
    };
    projection.entities.messagesById.server = receipt;
    projection.histories.t!.orderedIds = ['server'];
    const settled = {
        ...operation,
        status: 'succeeded' as const,
        receipt: { type: 'send' as const, threadFbid: 'fb', message: receipt },
    };
    const projected = projectOperations(projection, [settled]);
    assert.deepEqual(projected.histories.t!.orderedIds, ['operation:one']);
    assert.equal(
        projected.entities.messagesById['operation:one']?.serverId,
        'server',
    );
    assert.equal(projected.entities.messagesById.server, undefined);
    assert.deepEqual(projectOperations(projected, [settled]), projected);
    assert.equal(projection.entities.messagesById.server, receipt);
    await repository.close();
});

test('read overlay cannot mark a newer arrival read', async () => {
    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'worker',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {},
    };
    projection.entities.threadsById.t = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 50,
        isUnread: true,
        serverIsPin: false,
        userIds: [],
    };

    const repository = createInboxRepository(new IDBFactory());
    const read = {
        ...command,
        intent: {
            type: 'read' as const,
            threadId: 't',
            messageId: 'old',
            timestampMs: 40,
        },
    };
    const { operation } = await repository.acceptOperation(
        read,
        { ...request, intent: read.intent },
        40,
    );
    const projected = projectOperations(projection, [operation]);
    assert.equal(projected.entities.threadsById.t!.isUnread, true);
    assert.equal(projected.entities.threadsById.t!.readWatermarkMs, 40);
    await repository.close();
});

test('receipt and canonical facts settle atomically without rewriting history', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await seedOperationThread(repository);
    const accepted = await repository.acceptOperation(command, request, 10);
    const message = {
        id: 'receipt',
        kind: 'text' as const,
        senderId: 'viewer',
        text: 'hello',
        ts: 11,
    };
    const operation = {
        ...accepted.operation,
        status: 'succeeded' as const,
        receipt: { type: 'send' as const, threadFbid: 'fb', message },
    };
    const settled = await repository.updateOperation('a', operation, {
        resources: [],
        entities: { ...emptyEntities(), messagesById: { receipt: message } },
    });
    assert.equal(settled.revision, accepted.revision + 1);
    assert.equal(
        (await repository.readOperations('a')).operations[0]?.receipt?.type,
        'send',
    );
    // A resource created later can reference the receipt fact installed by settlement.
    const resource = {
        ...emptyResource(),
        key: 'history:t',
        threadId: 't',
        orderedIds: ['receipt'],
        refs: { threadIds: [], userIds: [], messageIds: ['receipt'] },
    };
    await repository.commitResources('a', {
        resources: [resource],
        entities: emptyEntities(),
    });
    assert.deepEqual(
        (await repository.readResources('a', ['history:t'])).entities
            .messagesById.receipt,
        message,
    );

    const second = await repository.acceptOperation(
        { ...command, operationId: 'two' },
        request,
        12,
    );
    await assert.rejects(
        repository.updateOperation(
            'a',
            { ...second.operation, status: 'succeeded' },
            {
                resources: [
                    {
                        ...resource,
                        key: 'bad',
                        orderedIds: ['missing'],
                        refs: {
                            threadIds: [],
                            userIds: [],
                            messageIds: ['missing'],
                        },
                    },
                ],
                entities: emptyEntities(),
            },
        ),
    );
    const stored = await repository.readOperations('a');
    assert.equal(
        stored.operations.find((value) => value.operationId === 'two')?.status,
        'queued',
    );
    assert.equal(stored.revision, second.revision);
    await repository.close();
});

test('pins replay by durable acceptance order and failed pins do not apply', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const pin = {
        ...command,
        intent: { type: 'pin' as const, threadId: 't', isPinned: true },
    };

    const first = await repository.acceptOperation(
        pin,
        { ...request, intent: pin.intent },
        1,
    );
    const unpin = {
        ...pin,
        operationId: 'two',
        intent: { ...pin.intent, isPinned: false },
    };
    const second = await repository.acceptOperation(
        unpin,
        { ...request, intent: unpin.intent },
        2,
    );

    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'worker',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {},
    };
    projection.entities.threadsById.t = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 1,
        isUnread: false,
        serverIsPin: false,
        userIds: [],
    };
    assert.equal(
        projectOperations(projection, [second.operation, first.operation])
            .entities.threadsById.t!.serverIsPin,
        false,
    );
    const failed = { ...second.operation, status: 'failed' as const };
    const result = projectOperations(projection, [first.operation, failed]);
    assert.equal(result.entities.threadsById.t!.serverIsPin, true);
    assert.equal(result.entities.threadsById.t!.pinOrder, first.revision);
    await repository.close();
});

test('operation write failure rejects acceptance and rolls back revision', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await repository.readOperations('a');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
        if (this.name === 'operations')
            throw new DOMException('Quota exhausted', 'QuotaExceededError');
        return put.apply(this, args);
    };
    try {
        await assert.rejects(repository.acceptOperation(command, request, 10));
    } finally {
        IDBObjectStore.prototype.put = put;
    }
    assert.deepEqual(await repository.readOperations('a'), {
        operations: [],
        entities: emptyEntities(),
        revision: 0,
    });
    await repository.close();
});

test('v4 upgrades to v5 operations store without changing existing revision', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
        const opening = factory.open('icr-successor', 4);
        opening.onupgradeneeded = () => {
            const database = opening.result;
            for (const name of [
                'users',
                'threads',
                'messages',
                'resources',
                'refs',
                'historyInventory',
                'historyOrder',
                'historyChunks',
                'historyPrevious',
                'historyPreviousOrder',
            ])
                database.createObjectStore(name);
            const meta = database.createObjectStore('meta');
            meta.put(42, 'revision');
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
            opening.result.close();
            resolve();
        };
    });
    const repository = createInboxRepository(factory);
    assert.deepEqual(await repository.readOperations('a'), {
        operations: [],
        entities: emptyEntities(),
        revision: 42,
    });
    const accepted = await repository.acceptOperation(command, request, 10);
    assert.equal(accepted.revision, 43);
    await repository.close();
});

test('Port command validation rejects extra keys, blank identity, unsafe epochs and invalid text/read targets', () => {
    assert.equal(isMutationCommand(command), true);
    for (const value of [
        null,
        { ...command, extra: true },
        { ...command, accountId: ' ' },
        { ...command, operationId: '' },
        { ...command, accountEpoch: 1.5 },
        { ...command, intent: { ...command.intent, extra: true } },
        { ...command, intent: { type: 'send', threadId: 't', text: ' ' } },
        {
            ...command,
            intent: {
                type: 'send',
                threadId: 't',
                text: 'a'.repeat(MAX_SEND_TEXT_LENGTH + 1),
            },
        },
        {
            ...command,
            intent: {
                type: 'read',
                threadId: 't',
                messageId: 'm',
                timestampMs: Infinity,
            },
        },
    ])
        assert.equal(isMutationCommand(value), false);
});

test('send projection does not append into an older anchored history window', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const { operation } = await repository.acceptOperation(
        command,
        request,
        10,
    );
    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'worker',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {
            t: {
                ...emptyResource(),
                threadId: 't',
                cachedNewer: true,
                orderedIds: ['older'],
            },
        },
    };
    assert.deepEqual(
        projectOperations(projection, [operation]).histories.t!.orderedIds,
        ['older'],
    );
    await repository.close();
});

test('unsettled operation protects its thread and transitive facts from resource pruning', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const thread: ThreadFact = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 1,
        isUnread: false,
        serverIsPin: false,
        userIds: ['viewer'],
        lastMessageId: 'original',
    };

    const entities = {
        threadsById: { t: thread },
        usersById: {
            viewer: {
                id: 'viewer',
                username: 'viewer',
                fullName: 'Viewer',
                picUrl: null,
            },
        },
        messagesById: {
            original: {
                id: 'original',
                kind: 'text' as const,
                senderId: 'viewer',
                text: 'original',
                ts: 1,
            },
        },
    };
    const resource = {
        ...emptyResource(),
        key: 'inbox:primary',
        orderedIds: ['t'],
        refs: { threadIds: ['t'], userIds: [], messageIds: [] },
    };
    await repository.commitResources('a', { resources: [resource], entities });
    await repository.acceptOperation(command, request, 10);
    const openCursor = IDBIndex.prototype.openCursor;
    let referenceQueries = 0;
    IDBIndex.prototype.openCursor = function (
        ...args: Parameters<typeof openCursor>
    ) {
        if (this.name === 'visibility') referenceQueries++;
        return openCursor.apply(this, args);
    };
    try {
        await repository.commitResources('a', {
            resources: [],
            entities: emptyEntities(),
            deleteKeys: ['inbox:primary'],
        });
    } finally {
        IDBIndex.prototype.openCursor = openCursor;
    }
    assert.equal(
        referenceQueries,
        2,
        'active and alias references are loaded only once per transaction',
    );
    const restored = await repository.commitResources('a', {
        resources: [resource],
        entities: emptyEntities(),
    });
    assert.deepEqual(restored.entities, entities);
    await repository.close();
});

test('settled send receipt aliases are bounded while tombstones still deduplicate', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await seedOperationThread(repository);

    for (let index = 0; index < 201; index++) {
        const { operation } = await repository.acceptOperation(
            { ...command, operationId: `send-${index}` },
            request,
            index,
        );
        const message = {
            id: `server-${index}`,
            kind: 'text' as const,
            senderId: 'viewer',
            text: 'hello',
            ts: index,
        };
        await repository.updateOperation(
            'a',
            {
                ...operation,
                status: 'succeeded',
                receipt: { type: 'send', threadFbid: 'fb', message },
            },
            {
                resources: [],
                entities: {
                    ...emptyEntities(),
                    messagesById: { [message.id]: message },
                },
            },
        );
    }
    const read = await repository.readOperations('a');
    assert.equal(read.operations.length, 200);
    assert.equal(read.operations.filter((value) => value.receipt).length, 200);
    assert.equal(
        read.operations.some((operation) => operation.operationId === 'send-0'),
        false,
    );
    const duplicate = await repository.acceptOperation(
        { ...command, operationId: 'send-0' },
        request,
        999,
    );
    assert.equal(duplicate.operation.status, 'succeeded');
    assert.equal(duplicate.revision, read.revision);
    await repository.close();
});

test('active outbox caps at 200 per account; removal releases capacity without losing dedup evidence', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await seedOperationThread(repository);
    for (let index = 0; index < ACTIVE_OPERATION_LIMIT; index++)
        await repository.acceptOperation(
            { ...command, operationId: `active-${index}` },
            request,
            index,
        );
    const full = await repository.readOperations('a');
    const first = full.operations[0]!;
    await repository.updateOperation('a', { ...first, status: 'failed' });
    const revision = (await repository.readOperations('a')).revision;
    await assert.rejects(
        repository.acceptOperation(command, request, 999),
        (error) =>
            error instanceof Error &&
            'kind' in error &&
            error.kind === 'capacity',
    );
    assert.equal((await repository.readOperations('a')).revision, revision);
    assert.equal(
        (
            await repository.acceptOperation(
                { ...command, operationId: first.operationId },
                request,
                999,
            )
        ).operation.status,
        'failed',
    );

    await repository.updateOperation('a', { ...first, status: 'removed' });
    assert.equal(
        (await repository.readOperations('a')).operations.length,
        ACTIVE_OPERATION_LIMIT - 1,
    );
    await repository.acceptOperation(command, request, 999);
    assert.equal(
        (await repository.readOperations('a')).operations.length,
        ACTIVE_OPERATION_LIMIT,
    );
    assert.equal(
        (
            await repository.acceptOperation(
                { ...command, operationId: first.operationId },
                request,
                999,
            )
        ).operation.status,
        'removed',
    );
    await seedOperationThread(repository, 'b');
    const other = { ...command, accountId: 'b' };
    await repository.acceptOperation(other, request, 999);
    assert.equal((await repository.readOperations('b')).operations.length, 1);
    await repository.close();
});

test('successful pin/read commands are dedup-only tombstones, and canonical watermarks survive without overlays', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const pin = {
        ...command,
        intent: { type: 'pin' as const, threadId: 't', isPinned: true },
    };
    const { operation } = await repository.acceptOperation(
        pin,
        { ...request, intent: pin.intent },
        1,
    );
    const settled = {
        ...operation,
        status: 'succeeded' as const,
        receipt: { type: 'pin' as const, threadFbid: 'fb', isPinned: true },
    };
    await repository.updateOperation('a', settled);
    assert.deepEqual((await repository.readOperations('a')).operations, []);
    assert.equal(
        (
            await repository.acceptOperation(
                pin,
                { ...request, intent: pin.intent },
                999,
            )
        ).operation.status,
        'succeeded',
    );
    assert.deepEqual(retainRuntimeOperations([settled]), []);

    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'w',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {},
    };
    projection.entities.threadsById.t = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 10,
        isUnread: true,
        serverIsPin: false,
        pinOrder: 1,
        readWatermarkMs: 10,
        readWatermarkMessageId: 'latest',
        lastMessageId: 'latest',
        userIds: [],
    };
    const projected = projectOperations(projection, [settled]);
    assert.equal(projected.entities.threadsById.t!.serverIsPin, false);
    assert.equal(projected.entities.threadsById.t!.pinOrder, 1);
    assert.equal(projected.entities.threadsById.t!.isUnread, false);
    projection.entities.threadsById.t!.lastActivityMs = 11;
    assert.equal(
        projectOperations(projection, []).entities.threadsById.t!.isUnread,
        true,
    );
    await repository.close();
});

test('historical settled aliases never displace a newer full history window', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const { operation } = await repository.acceptOperation(command, request, 1);

    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'w',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: { t: { ...emptyResource(), threadId: 't', orderedIds: [] } },
    };
    for (let index = 0; index < 400; index++) {
        const id = `server-${index}`;
        projection.histories.t!.orderedIds.push(id);
        projection.entities.messagesById[id] = {
            id,
            kind: 'text',
            senderId: 'peer',
            text: id,
            ts: index + 100,
        };
    }
    const receipt = {
        type: 'send' as const,
        threadFbid: 'fb',
        message: {
            id: 'historical',
            kind: 'text' as const,
            senderId: 'viewer',
            text: 'hello',
            ts: 1,
        },
    };
    const settled = { ...operation, status: 'succeeded' as const, receipt };
    const projected = projectOperations(projection, [settled]);
    assert.deepEqual(
        projected.histories.t!.orderedIds,
        projection.histories.t!.orderedIds,
    );
    assert.deepEqual(
        projectOperations(projection, [{ ...settled, echoed: true }]).histories
            .t!.orderedIds,
        projection.histories.t!.orderedIds,
    );
    await repository.close();
});

test('fresh receipt keeps pending identity until echo, then only aliases mounted canonical messages', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await seedOperationThread(repository);
    const { operation } = await repository.acceptOperation(
        command,
        request,
        10,
    );
    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'w',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {
            t: { ...emptyResource(), threadId: 't', orderedIds: ['previous'] },
        },
    };
    projection.entities.messagesById.previous = {
        id: 'previous',
        kind: 'text',
        senderId: 'peer',
        text: 'previous',
        ts: 10,
    };
    const receipt = {
        type: 'send' as const,
        threadFbid: 'fb',
        message: {
            id: 'server',
            kind: 'text' as const,
            senderId: 'viewer',
            text: 'hello',
            ts: 10,
        },
    };
    const settled = { ...operation, status: 'succeeded' as const, receipt };
    const pending = projectOperations(projection, [operation]);
    const fresh = projectOperations(projection, [settled]);
    assert.deepEqual(
        fresh.histories.t!.orderedIds,
        pending.histories.t!.orderedIds,
    );
    assert.equal(
        fresh.entities.messagesById['operation:one']?.serverId,
        'server',
    );
    const echoed = { ...settled, echoed: true };
    assert.deepEqual(
        projectOperations(projection, [echoed]).histories.t!.orderedIds,
        ['previous'],
    );

    projection.entities.messagesById.server = receipt.message;
    projection.histories.t!.orderedIds.push('server');
    const aliased = projectOperations(projection, [echoed]);
    assert.deepEqual(aliased.histories.t!.orderedIds, [
        'previous',
        'operation:one',
    ]);
    assert.equal(aliased.entities.messagesById.server, undefined);
    assert.deepEqual(projectOperations(aliased, [echoed]), aliased);
    await repository.updateOperation('a', echoed, {
        resources: [],
        entities: {
            ...emptyEntities(),
            messagesById: { server: receipt.message },
        },
    });
    assert.equal(
        (await repository.readOperations('a')).operations[0]?.echoed,
        true,
    );
    await repository.close();
});

test('paired read watermark keeps a different same-millisecond incoming message unread and recognizes aliases', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const read = {
        ...command,
        intent: {
            type: 'read' as const,
            threadId: 't',
            messageId: 'read-message',
            timestampMs: 10,
        },
    };
    const { operation } = await repository.acceptOperation(
        read,
        { ...request, intent: read.intent },
        10,
    );
    const projection: InboxProjection = {
        accountId: 'a',
        accountEpoch: 1,
        workerEpoch: 'w',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {},
    };
    projection.entities.threadsById.t = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 10,
        lastMessageId: 'new-message',
        isUnread: true,
        serverIsPin: false,
        userIds: [],
    };
    assert.equal(
        projectOperations(projection, [operation]).entities.threadsById.t!
            .isUnread,
        true,
    );

    projection.entities.threadsById.t!.readWatermarkMs = 10;
    projection.entities.threadsById.t!.readWatermarkMessageId = 'read-message';
    assert.equal(
        projectOperations(projection, []).entities.threadsById.t!.isUnread,
        true,
    );
    projection.entities.threadsById.t!.lastMessageId = 'read-message';
    assert.equal(
        projectOperations(projection, []).entities.threadsById.t!.isUnread,
        false,
    );
    projection.entities.threadsById.t!.lastMessageId = 'local';
    projection.entities.messagesById.local = {
        id: 'local',
        serverId: 'read-message',
        ts: 10,
        kind: 'text',
        senderId: 'viewer',
        text: 'read',
    };
    assert.equal(
        projectOperations(projection, []).entities.threadsById.t!.isUnread,
        false,
    );
    projection.entities.threadsById.t!.lastActivityMs = 9;
    projection.entities.threadsById.t!.lastMessageId = 'different';
    assert.equal(
        projectOperations(projection, []).entities.threadsById.t!.isUnread,
        false,
    );
    await repository.close();
});

test('dedup-only tombstones accept missing request evidence but new commands cannot', async () => {
    const repository = createInboxRepository(new IDBFactory());
    const accepted = await repository.acceptOperation(command, request, 10);
    const removed = await repository.updateOperation('a', {
        ...accepted.operation,
        status: 'removed',
    });
    assert.deepEqual((await repository.readOperations('a')).operations, []);
    const duplicate = await repository.acceptOperation(command, undefined, 20);
    assert.deepEqual(duplicate.operation, removed.operation);
    assert.equal(duplicate.revision, removed.revision);
    await assert.rejects(
        repository.acceptOperation(
            { ...command, operationId: 'new' },
            undefined,
            20,
        ),
    );
    await assert.rejects(
        repository.acceptOperation(
            {
                ...command,
                intent: { type: 'send', threadId: 't', text: 'changed' },
            },
            undefined,
            20,
        ),
    );
    assert.equal(
        (await repository.readOperations('a')).revision,
        removed.revision,
    );
    await repository.close();
});

test('recovery hydrates normalized targets, participants, latest messages and read/reply dependencies without inbox coverage', async () => {
    const factory = new IDBFactory();
    let repository = createInboxRepository(factory);
    const entities = emptyEntities();
    entities.usersById.viewer = {
        id: 'viewer',
        username: 'viewer',
        fullName: 'Viewer',
        picUrl: null,
    };
    entities.threadsById.t = {
        key: 't',
        title: 't',
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 3,
        isUnread: true,
        serverIsPin: false,
        userIds: ['viewer'],
        lastMessageId: 'latest',
    };
    for (const id of ['latest', 'read-target', 'reply-target'])
        entities.messagesById[id] = {
            id,
            kind: 'text',
            senderId: 'viewer',
            text: id,
            ts: 1,
        };
    await repository.commitResources('a', {
        resources: [
            {
                ...emptyResource(),
                key: 'inbox:primary',
                refs: {
                    threadIds: ['t'],
                    userIds: [],
                    messageIds: ['read-target', 'reply-target'],
                },
            },
        ],
        entities,
    });
    const read = {
        ...command,
        intent: {
            type: 'read' as const,
            threadId: 't',
            messageId: 'read-target',
            timestampMs: 1,
        },
    };
    await repository.acceptOperation(
        read,
        { ...request, intent: read.intent },
        1,
    );
    const reply = {
        ...command,
        operationId: 'reply',
        intent: {
            type: 'send' as const,
            threadId: 't',
            text: 'reply',
            replyTo: 'reply-target',
        },
    };
    await repository.acceptOperation(
        reply,
        { ...request, intent: reply.intent },
        2,
    );
    await repository.commitResources('a', {
        resources: [],
        entities: emptyEntities(),
        deleteKeys: ['inbox:primary'],
    });
    const revision = (await repository.readResources('a', [])).revision;
    await repository.close();

    repository = createInboxRepository(factory);
    const recovered = await repository.readOperations('a');
    assert.equal(recovered.operations.length, 2);
    assert.equal(recovered.revision, revision);
    assert.deepEqual(recovered.entities, entities);
    assert.deepEqual(
        (await repository.readOperations('b')).entities,
        emptyEntities(),
    );
    await repository.close();
});

test('missing durable operation target facts fail recovery rather than publish a factless command', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await repository.acceptOperation(command, request, 10);
    await assert.rejects(
        repository.readOperations('a'),
        (error) =>
            error instanceof Error &&
            'kind' in error &&
            error.kind === 'storage',
    );
    await repository.close();
});

test('settled aliases recover self-contained receipts after their target thread is pruned', async () => {
    const repository = createInboxRepository(new IDBFactory());
    await seedOperationThread(repository);
    const { operation } = await repository.acceptOperation(command, request, 1);
    const message = {
        id: 'server',
        kind: 'text' as const,
        text: 'hello',
        senderId: 'viewer',
        ts: 1,
    };
    await repository.updateOperation(
        'a',
        {
            ...operation,
            status: 'succeeded',
            receipt: { type: 'send', threadFbid: 'fb', message },
        },
        {
            resources: [],
            entities: { ...emptyEntities(), messagesById: { server: message } },
        },
    );

    await repository.commitResources('a', {
        resources: [],
        entities: emptyEntities(),
        deleteKeys: ['operation-fixture'],
    });

    const recovered = await repository.readOperations('a');
    assert.equal(recovered.operations.length, 1);
    assert.deepEqual(recovered.entities, emptyEntities());
    assert.equal(recovered.operations[0]?.receipt?.type, 'send');
    await assert.rejects(
        repository.commitResources('a', {
            resources: [
                {
                    ...emptyResource(),
                    key: 'missing-thread',
                    refs: { threadIds: ['t'], userIds: [], messageIds: [] },
                },
            ],
            entities: emptyEntities(),
        }),
    );
    await repository.close();
});

test('corrupted operation rows fail indexed recovery and keyed dedup/update at the storage boundary', async () => {
    const patches = [
        { accountId: 'other-account' },
        { operationId: 'different-id' },
        { accountEpoch: 1.5 },
        { intent: { type: 'send', threadId: '', text: 'hello' } },
        {
            request: {
                ...request,
                intent: {
                    type: 'send',
                    threadId: 't',
                    text: 'different-intent',
                },
            },
        },
        { request: { ...request, offlineThreadingId: '' } },
        { acceptedRevision: 0 },
        { createdAt: Infinity },
        { attempts: -1 },
        { status: 'invented' },
        { retryable: 'yes' },
        { receipt: { type: 'pin', threadFbid: 'target', isPinned: true } },
        {
            receipt: {
                type: 'send',
                threadFbid: 'wrong-target',
                message: {
                    id: 'server',
                    kind: 'text',
                    senderId: 'viewer',
                    text: 'hello',
                    ts: 1,
                },
            },
        },
        {
            receipt: {
                type: 'send',
                threadFbid: 'target',
                message: { id: 'server', kind: 'invented', ts: 1 },
            },
        },
    ];
    for (const patch of patches) {
        const factory = new IDBFactory();
        const repository = createInboxRepository(factory);
        await seedOperationThread(repository);
        const { operation } = await repository.acceptOperation(
            command,
            { ...request, threadFbid: 'target' },
            1,
        );
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const opening = factory.open('icr-successor', 5);
            opening.onsuccess = () => resolve(opening.result);
            opening.onerror = () => reject(opening.error);
        });
        const transaction = database.transaction('operations', 'readwrite');
        transaction
            .objectStore('operations')
            .put({
                accountId: 'a',
                id: operation.operationId,
                value: { ...operation, ...patch },
                acceptedRevision: operation.acceptedRevision,
                visibility: 'active',
            });
        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = transaction.onerror = () =>
                reject(transaction.error);
        });
        database.close();

        await assert.rejects(repository.readOperations('a'), {
            kind: 'storage',
        });
        await assert.rejects(
            repository.acceptOperation(command, undefined, 2),
            { kind: 'storage' },
        );
        await assert.rejects(repository.updateOperation('a', operation), {
            kind: 'storage',
        });
        await repository.close();
    }
});
