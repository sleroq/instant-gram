import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import {
    createInboxRepository,
    adaptInboxRepository,
    InboxRepositoryService,
} from '../lib/engine/db.ts';
import {
    InboxError,
    InboxEngineService,
    normalizePage,
    emptyEntities,
    type InboxProjection,
} from '../lib/engine/inbox.ts';
import { InboxProviderService } from '../lib/provider/inbox.ts';
import { makeWorkerLayer, bindInboxEngine } from '../lib/worker/layer.ts';
import type {
    MutationCommand,
    MutationReceipt,
    MutationRequest,
} from '../lib/engine/operations.ts';
import type { Message, Thread } from '../lib/domain.ts';
import { createInboxEngine } from './engine-fixture.ts';

function deferred<A>() {
    let resolve!: (value: A) => void;
    const promise = new Promise<A>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const original: Message = {
    id: 'original',
    kind: 'text',
    senderId: 'peer',
    text: 'hello',
    ts: 10,
};
function thread(id = 'chat', lastMessage = original): Thread {
    return {
        key: id,
        threadFbid: `fb-${id}`,
        threadIgId: `ig-${id}`,
        title: id,
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: lastMessage.ts,
        isUnread: true,
        serverIsPin: false,
        users: [
            { id: 'peer', username: 'peer', fullName: 'Peer', picUrl: null },
        ],
        lastMessage,
    };
}
function command(
    snapshot: InboxProjection,
    operationId: string,
    intent: MutationCommand['intent'] = {
        type: 'send',
        threadId: 'chat',
        text: 'sent',
    },
): MutationCommand {
    assert(snapshot.accountId);
    return {
        accountId: snapshot.accountId,
        accountEpoch: snapshot.accountEpoch,
        operationId,
        intent,
    };
}
function sent(
    request: MutationRequest,
    id = 'server-message',
): MutationReceipt {
    assert.equal(request.intent.type, 'send');
    return {
        type: 'send',
        threadFbid: request.threadFbid!,
        message: {
            id,
            kind: 'text',
            text: request.intent.type === 'send' ? request.intent.text : '',
            senderId: 'viewer',
            ts: 20,
        },
    };
}
function observe(
    engine: Awaited<ReturnType<typeof createInboxEngine>>,
    threadId = 'chat',
) {
    const waiters = new Set<() => void>();
    function listener() {
        for (const waiter of waiters) waiter();
    }
    const stop = engine.subscribe(listener, threadId);
    function until(predicate: (value: InboxProjection) => boolean) {
        if (predicate(engine.snapshot())) return Promise.resolve();
        return new Promise<void>((resolve) => {
            function check() {
                if (predicate(engine.snapshot())) {
                    waiters.delete(check);
                    resolve();
                }
            }
            waiters.add(check);
        });
    }
    return { until, stop, listener };
}
function provider(
    mutate: (
        account: string,
        request: MutationRequest,
    ) => Promise<MutationReceipt>,
) {
    return {
        account: async () => 'account',
        inbox: async () => ({ items: [thread()], hasNextPage: false }),
        history: async () => ({
            items: [original],
            viewerId: 'viewer',
            hasNextPage: false,
        }),
        mutate,
    };
}

test('durable send deduplicates two clients, keeps optimistic key through receipt, and survives restart', async (t) => {
    const factory = new IDBFactory();
    const repository = createInboxRepository(factory);

    const response = deferred<MutationReceipt>();
    const started = deferred<MutationRequest>();
    let calls = 0;
    let echo: Message | undefined;
    const anchors: Array<string | undefined> = [];

    const boundary = {
        ...provider(async (_account, request) => {
            calls++;
            started.resolve(request);
            return response.promise;
        }),
        history: async () => ({
            items: [original, ...(echo ? [echo] : [])],
            viewerId: 'viewer',
            hasNextPage: false,
        }),
    };
    const engine = await createInboxEngine(
        {
            ...repository,
            readHistoryWindow: async (...args) => {
                anchors.push(args[2]?.anchorId);
                return repository.readHistoryWindow(...args);
            },
        },
        boundary,
    );
    const view = observe(engine);
    await view.until(
        (value) => value.histories.chat?.availability === 'present',
    );

    const input = command(engine.snapshot(), 'send-once');
    const [first, second] = await Promise.all([
        engine.mutate(input),
        engine.mutate(input),
    ]);
    assert(first.ok && second.ok);
    assert.equal(first.revision, second.revision);
    const request = await started.promise;
    assert.equal(calls, 1);
    assert.equal(request.viewerId, 'viewer');
    assert.notEqual(request.viewerId, input.accountId);
    const localId = engine
        .snapshot()
        .histories.chat.orderedIds.find(
            (id) =>
                engine.snapshot().entities.messagesById[id]?.delivery
                    ?.operationId === input.operationId,
        );
    assert(localId);
    response.resolve(sent(request));
    await view.until(
        (value) =>
            value.operations?.some((item) => item.status === 'succeeded') ??
            false,
    );
    assert.equal(
        engine
            .snapshot()
            .histories.chat.orderedIds.filter((id) => id === localId).length,
        1,
    );
    assert.equal(
        engine.snapshot().entities.messagesById[localId].serverId,
        'server-message',
    );

    const receipt = sent(request);
    assert(receipt.type === 'send');
    echo = receipt.message;
    await engine.refreshHistory('chat');
    assert.equal(engine.snapshot().operations?.[0]?.echoed, true);
    assert(engine.snapshot().histories.chat.orderedIds.includes(localId));
    await engine.refreshHistory('chat', undefined, localId);
    assert(anchors.includes('server-message'));
    view.stop();
    await engine.dispose();

    const reopened = await createInboxEngine(
        createInboxRepository(factory),
        boundary,
    );
    t.after(reopened.dispose);
    const restored = observe(reopened);
    await restored.until(
        (value) =>
            value.histories.chat?.availability === 'present' &&
            (value.operations?.length ?? 0) > 0,
    );
    assert.equal(calls, 1);
    assert.equal(
        reopened.snapshot().entities.messagesById[localId].serverId,
        'server-message',
    );
});

test('storage rejection preserves acceptance boundary and makes no mutation provider call', async (t) => {
    const repository = createInboxRepository(new IDBFactory());
    let calls = 0;
    const engine = await createInboxEngine(
        {
            ...repository,
            acceptOperation: async () => {
                throw new InboxError('storage');
            },
        },
        provider(async (_account, request) => {
            calls++;
            return sent(request);
        }),
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.until(
        (value) => value.histories.chat?.availability === 'present',
    );
    const result = await engine.mutate(command(engine.snapshot(), 'quota'));
    assert(!result.ok);
    assert.equal(result.error.kind, 'storage');
    assert.equal(calls, 0);
    assert.equal(engine.snapshot().operations?.length ?? 0, 0);
});

test('unknown send outcome is durable, cannot be retried, and removal never sends again', async (t) => {
    const factory = new IDBFactory();
    let calls = 0;
    const boundary = provider(async () => {
        calls++;
        throw new InboxError('unknown_outcome');
    });
    const engine = await createInboxEngine(
        createInboxRepository(factory),
        boundary,
    );
    const view = observe(engine);
    await view.until(
        (value) => value.histories.chat?.availability === 'present',
    );

    const input = command(engine.snapshot(), 'uncertain');
    assert((await engine.mutate(input)).ok);
    await view.until(
        (value) => value.operations?.[0]?.status === 'outcome_unknown',
    );
    assert(
        !(
            await engine.retryOperation(
                input.accountId,
                input.accountEpoch,
                input.operationId,
            )
        ).ok,
    );
    await engine.dispose();

    const restarted = await createInboxEngine(
        createInboxRepository(factory),
        boundary,
    );
    t.after(restarted.dispose);
    const restored = observe(restarted);
    await restored.until(
        (value) => value.operations?.[0]?.status === 'outcome_unknown',
    );
    assert.equal(calls, 1);
    const snapshot = restarted.snapshot();
    assert(
        (
            await restarted.removeOperation(
                snapshot.accountId!,
                snapshot.accountEpoch,
                input.operationId,
            )
        ).ok,
    );
    assert.equal(calls, 1);
    assert.equal(restarted.snapshot().operations?.length ?? 0, 0);
});

test('read receipt cannot mark a newly arrived message read and duplicate watermarks coalesce', async (t) => {
    const response = deferred<MutationReceipt>();
    const started = deferred<MutationRequest>();
    let latest = original;
    let calls = 0;
    const boundary = {
        ...provider(async (_account, request) => {
            calls++;
            started.resolve(request);
            return response.promise;
        }),
        inbox: async () => ({
            items: [thread('chat', latest)],
            hasNextPage: false,
        }),
    };
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
        boundary,
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.until(
        (value) => value.histories.chat?.availability === 'present',
    );

    const intent = {
        type: 'read' as const,
        threadId: 'chat',
        messageId: 'original',
        timestampMs: 10,
    };
    const first = command(engine.snapshot(), 'read-one', intent);
    assert((await engine.mutate(first)).ok);
    await started.promise;
    assert(
        (await engine.mutate(command(engine.snapshot(), 'read-two', intent)))
            .ok,
    );

    latest = { ...original, id: 'new-arrival', ts: 30 };
    await engine.refresh();
    response.resolve({
        type: 'read',
        threadIgId: 'ig-chat',
        messageId: 'original',
        timestampMs: 10,
    });
    await view.until(
        (value) =>
            value.entities.threadsById.chat.readWatermarkMs === 10 &&
            (value.operations?.length ?? 0) === 0,
    );
    assert.equal(engine.snapshot().entities.threadsById.chat.isUnread, true);
    assert.equal(calls, 1);
});

test('conflicting pin commands serialize and a stale read cannot erase accepted pin intent', async (t) => {
    const first = deferred<MutationReceipt>();
    const started = deferred<void>();
    const calls: MutationRequest[] = [];

    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
        provider(async (_account, request) => {
            calls.push(request);
            if (calls.length === 1) {
                started.resolve();
                return first.promise;
            }
            return {
                type: 'pin',
                threadFbid: request.threadFbid!,
                isPinned: false,
            };
        }),
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.until(
        (value) => value.histories.chat?.availability === 'present',
    );
    assert(
        (
            await engine.mutate(
                command(engine.snapshot(), 'pin', {
                    type: 'pin',
                    threadId: 'chat',
                    isPinned: true,
                }),
            )
        ).ok,
    );
    await started.promise;
    assert(
        (
            await engine.mutate(
                command(engine.snapshot(), 'unpin', {
                    type: 'pin',
                    threadId: 'chat',
                    isPinned: false,
                }),
            )
        ).ok,
    );
    assert.equal(calls.length, 1);

    await engine.refresh();
    assert.equal(
        engine.snapshot().entities.threadsById.chat.serverIsPin,
        false,
    );
    first.resolve({ type: 'pin', threadFbid: 'fb-chat', isPinned: true });
    await view.until(
        (value) =>
            value.operations?.every((item) => item.status === 'succeeded') ??
            false,
    );
    assert.equal(calls.length, 2);
    assert.equal(
        engine.snapshot().entities.threadsById.chat.serverIsPin,
        false,
    );
});

test('account switch rejects stale command and completion without leaking old operation state', async (t) => {
    let account = 'account';
    const response = deferred<MutationReceipt>();
    const started = deferred<MutationRequest>();
    const boundary = {
        ...provider(async (_account, request) => {
            started.resolve(request);
            return response.promise;
        }),
        account: async () => account,
    };
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
        boundary,
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.until(
        (value) => value.histories.chat?.availability === 'present',
    );
    const input = command(engine.snapshot(), 'old-account');
    await engine.mutate(input);
    const request = await started.promise;
    account = 'other-account';
    await engine.refresh();
    response.resolve(sent(request));
    assert(!(await engine.mutate(input)).ok);
    assert.equal(engine.snapshot().accountId, 'other-account');
    assert.equal(engine.snapshot().operations?.length ?? 0, 0);
});

test('one worker poll refreshes two visible clients, backs off, and stops without visible interests', async (t) => {
    let inboxCalls = 0;
    let historyCalls = 0;
    let fail = false;
    let latest = original;

    const runtime = ManagedRuntime.make(
        makeWorkerLayer(
            Layer.succeed(InboxProviderService, {
                accept: () => undefined,
                account: Effect.succeed('account'),
                mutate: () => Effect.fail(new InboxError('invalid_request')),
                inbox: () =>
                    Effect.suspend(() => {
                        inboxCalls++;
                        return fail
                            ? Effect.fail(new InboxError('offline'))
                            : Effect.succeed({
                                  items: [thread('chat', latest)],
                                  hasNextPage: false,
                              });
                    }),
                history: () =>
                    Effect.sync(() => {
                        historyCalls++;
                        return {
                            items: [
                                original,
                                ...(latest === original ? [] : [latest]),
                            ],
                            viewerId: 'viewer',
                            hasNextPage: false,
                        };
                    }),
            }),
            Layer.succeed(
                InboxRepositoryService,
                adaptInboxRepository(createInboxRepository(new IDBFactory())),
            ),
        ).pipe(Layer.provideMerge(TestClock.layer())),
    );
    t.after(() => runtime.dispose());
    const service = await runtime.runPromise(InboxEngineService);
    const engine = {
        ...bindInboxEngine(service, (work) => runtime.runPromise(work)),
        dispose: () => runtime.dispose(),
    };
    const first = observe(engine);
    await first.until(
        (value) => value.histories.chat?.availability === 'present',
    );
    const second = observe(engine);
    await second.until(
        (value) => value.histories.chat?.availability === 'present',
    );
    const initialInbox = inboxCalls;
    const initialHistory = historyCalls;
    engine.setVisible(first.listener, true);
    engine.setVisible(second.listener, true);
    latest = { ...original, id: 'incoming', ts: 30 };
    await runtime.runPromise(TestClock.adjust(5_000));
    await first.until(
        (value) => value.entities.threadsById.chat.lastMessageId === 'incoming',
    );
    await second.until((value) =>
        value.histories.chat.orderedIds.includes('incoming'),
    );
    assert.equal(inboxCalls, initialInbox + 1);
    assert.equal(historyCalls, initialHistory + 1);
    fail = true;
    await runtime.runPromise(TestClock.adjust(5_000));
    await first.until(
        (value) =>
            value.inbox.synchronization === 'error' &&
            value.histories.chat.synchronization === 'idle' &&
            value.histories.chat.fetchedAt >= 10_000,
    );
    await runtime.runPromise(TestClock.adjust(0));
    const beforeBackoff = inboxCalls;
    await runtime.runPromise(TestClock.adjust(5_000));
    assert.equal(inboxCalls, beforeBackoff);
    await runtime.runPromise(TestClock.adjust(5_000));
    assert.equal(inboxCalls, beforeBackoff + 1);
    engine.setVisible(first.listener, false);
    engine.setVisible(second.listener, false);
    const hiddenCalls = inboxCalls;
    await runtime.runPromise(TestClock.adjust(60_000));
    assert.equal(inboxCalls, hiddenCalls);
    first.stop();
    second.stop();
});

for (const stage of ['acceptance', 'dispatching', 'settlement'] as const) {
    test(`account change during ${stage} persistence cannot publish or dispatch obsolete account work`, async (t) => {
        const repository = createInboxRepository(new IDBFactory());
        const stored = deferred<void>();
        const release = deferred<void>();
        let account = 'account';
        let calls = 0;

        const engine = await createInboxEngine(
            {
                ...repository,
                acceptOperation: async (...args) => {
                    const result = await repository.acceptOperation(...args);
                    if (stage === 'acceptance') {
                        stored.resolve();
                        await release.promise;
                    }
                    return result;
                },
                updateOperation: async (...args) => {
                    const result = await repository.updateOperation(...args);
                    if (
                        (stage === 'dispatching' &&
                            args[1].status === 'dispatching') ||
                        (stage === 'settlement' &&
                            args[1].status === 'succeeded')
                    ) {
                        stored.resolve();
                        await release.promise;
                    }
                    return result;
                },
            },
            {
                ...provider(async (_account, request) => {
                    calls++;
                    return sent(request);
                }),
                account: async () => account,
            },
        );
        t.after(engine.dispose);
        const view = observe(engine);
        await view.until(
            (value) => value.histories.chat?.availability === 'present',
        );

        const input = command(engine.snapshot(), `switch-${stage}`);
        const acceptance = engine.mutate(input);
        await stored.promise;
        account = 'other';
        const stop = engine.subscribe((value) => {
            if (value.accountId === 'other') {
                assert.equal(value.operations?.length ?? 0, 0);
                assert(!value.entities.messagesById['server-message']);
            }
        });
        const refresh = engine.refresh();
        await view.until((value) => value.accountId === 'other');
        release.resolve();
        await acceptance;
        await refresh;
        assert.equal(calls, stage === 'settlement' ? 1 : 0);
        assert.equal(engine.snapshot().operations?.length ?? 0, 0);
        assert(!engine.snapshot().entities.messagesById['server-message']);
        stop();
    });
}

for (const type of ['send', 'pin', 'read'] as const) {
    test(`restart recovers an interrupted ${type} attempt without unsafe replay`, async (t) => {
        const factory = new IDBFactory();
        const repository = createInboxRepository(factory);

        const normalized = normalizePage({
            items: [thread()],
            hasNextPage: false,
        });
        await repository.commitResources('account', {
            resources: [
                {
                    ...normalized.resource,
                    key: 'inbox:primary',
                    refs: {
                        threadIds: ['chat'],
                        userIds: ['peer'],
                        messageIds: ['original'],
                    },
                },
            ],
            entities: normalized.entities,
        });

        const intent =
            type === 'send'
                ? { type, threadId: 'chat', text: 'sent' }
                : type === 'pin'
                  ? { type, threadId: 'chat', isPinned: true }
                  : {
                        type,
                        threadId: 'chat',
                        messageId: 'original',
                        timestampMs: 10,
                    };
        const accepted = await repository.acceptOperation(
            {
                accountId: 'account',
                accountEpoch: 1,
                operationId: `interrupted-${type}`,
                intent,
            },
            {
                intent,
                threadFbid: 'fb-chat',
                threadIgId: 'ig-chat',
                viewerId: 'viewer',
                offlineThreadingId: '12345',
            },
            10,
        );
        await repository.updateOperation('account', {
            ...accepted.operation,
            status: 'dispatching',
            attempts: 1,
        });
        // The accepted target is no longer in any inbox page, but the operation retains its facts.
        await repository.commitResources('account', {
            resources: [],
            deleteKeys: ['inbox:primary'],
            entities: emptyEntities(),
        });
        await repository.close();

        let calls = 0;
        const engine = await createInboxEngine(createInboxRepository(factory), {
            ...provider(async (_account, request) => {
                calls++;
                if (request.intent.type === 'pin')
                    return {
                        type: 'pin',
                        threadFbid: 'fb-chat',
                        isPinned: true,
                    };
                if (request.intent.type === 'read')
                    return {
                        type: 'read',
                        threadIgId: 'ig-chat',
                        messageId: 'original',
                        timestampMs: 10,
                    };
                return sent(request);
            }),
            inbox: async () => ({
                items: [thread('other')],
                hasNextPage: false,
            }),
        });
        t.after(engine.dispose);
        const view = observe(engine);
        await view.until(
            (value) => value.histories.chat?.availability === 'present',
        );
        if (type === 'send') {
            assert.equal(
                engine.snapshot().operations?.[0]?.status,
                'outcome_unknown',
            );
            assert.equal(calls, 0);
        } else {
            await view.until(
                (value) =>
                    !(value.operations ?? []).some(
                        (operation) => operation.intent.type === type,
                    ) &&
                    (type === 'pin'
                        ? value.entities.threadsById.chat.serverIsPin
                        : value.entities.threadsById.chat.readWatermarkMs ===
                          10),
            );
            assert.equal(calls, 1);
        }
    });
}
