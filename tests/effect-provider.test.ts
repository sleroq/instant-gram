import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Fiber, Layer, Result } from 'effect';
import { TestClock } from 'effect/testing';
import {
    InboxRepositoryService,
    type InboxRepositoryEffects,
} from '../lib/engine/db.ts';
import {
    emptyEntities,
    InboxEngineService,
    InboxError,
} from '../lib/engine/inbox.ts';
import type { JsonValue } from '../lib/json.ts';
import { makeWorkerRuntime } from '../lib/worker/layer.ts';
import {
    InboxProviderService,
    makeInboxProvider,
    type InboxProviderEffects,
    type ProviderResponseInput,
} from '../lib/provider/inbox.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
} from '../lib/provider/protocol.ts';

test('InboxProviderService is independently substitutable', async () => {
    const stub: InboxProviderEffects = {
        accept: () => undefined,
        account: Effect.succeed('layer-account'),
        inbox: () => Effect.succeed({ items: [], hasNextPage: false }),
        history: () =>
            Effect.succeed({
                items: [],
                hasNextPage: false,
                viewerId: 'layer-account',
            }),
    };
    const result = await Effect.runPromise(
        InboxProviderService.pipe(
            Effect.flatMap((provider) => provider.account),
            Effect.provide(Layer.succeed(InboxProviderService, stub)),
        ),
    );
    assert.equal(result, 'layer-account');
});

test('InboxRepositoryService is independently substitutable', async () => {
    const expected = { resources: [], entities: emptyEntities(), revision: 7 };
    const stub: InboxRepositoryEffects = {
        readResources: () => Effect.succeed(expected),
        readHistoryWindow: () => Effect.die('unexpected history read'),
        touchHistory: () => Effect.die('unexpected history access'),
        commitResources: () => Effect.succeed(expected),
        close: Effect.void,
    };
    const result = await Effect.runPromise(
        InboxRepositoryService.pipe(
            Effect.flatMap((repository) =>
                repository.readResources('account', ['inbox:primary']),
            ),
            Effect.provide(Layer.succeed(InboxRepositoryService, stub)),
        ),
    );
    assert.equal(result.revision, 7);
});

test('InboxError keeps its constructor and wire error ergonomics when tagged', () => {
    const error = new InboxError('protocol');
    assert(error instanceof Error);
    assert(error instanceof InboxError);
    assert.equal(error.kind, 'protocol');
    assert.equal(error.message, 'Instagram conversations could not be loaded.');
    assert.equal(error._tag, 'InboxError');
    assert.deepEqual(
        { kind: error.kind, message: error.message },
        {
            kind: 'protocol',
            message: 'Instagram conversations could not be loaded.',
        },
    );
});

test('worker layer composes one substitutable engine from provider and repository layers', async () => {
    let inboxReads = 0;
    const provider: InboxProviderEffects = {
        accept: () => undefined,
        account: Effect.succeed('account'),
        inbox: () => {
            inboxReads++;
            return Effect.succeed({ items: [], hasNextPage: false });
        },
        history: () => Effect.die('unused'),
    };
    const repository: InboxRepositoryEffects = {
        readResources: () =>
            Effect.succeed({
                resources: [],
                entities: emptyEntities(),
                revision: 0,
            }),
        readHistoryWindow: () => Effect.die('unexpected history read'),
        touchHistory: () => Effect.die('unexpected history access'),
        commitResources: (_account, update) =>
            Effect.succeed({
                resources: update.resources,
                entities: update.entities,
                revision: 1,
            }),
        close: Effect.void,
    };
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, provider),
        Layer.succeed(InboxRepositoryService, repository),
    );
    await runtime.runPromise(
        Effect.flatMap(InboxEngineService, (engine) => engine.refresh),
    );
    assert.equal(inboxReads, 1);
    await runtime.dispose();
});

test('readiness timeout follows the Effect clock', async (t) => {
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    const result = await Effect.runPromise(
        Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(provider.account);
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;
            yield* TestClock.adjust('10 seconds');
            return yield* Effect.exit(Fiber.join(fiber));
        }).pipe(Effect.provide(TestClock.layer())),
    );
    assert.equal(result._tag, 'Failure');
});

test('request timeout removes pending state and ignores a late response', async (t) => {
    const inbound = { receive(_message: ProviderResponseInput) {} };
    const sent: ProviderRequest[] = [];
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    provider.accept({
        name: PROVIDER_PORT,
        sender: {
            id: 'extension',
            frameId: 0,
            url: 'https://www.instagram.com/direct/inbox/',
            tab: { id: 1 },
        },
        onMessage: {
            addListener: (listener) => (inbound.receive = listener),
            removeListener: () => {
                inbound.receive = () => undefined;
            },
        },
        onDisconnect: {
            addListener: () => undefined,
            removeListener: () => undefined,
        },
        postMessage: (message) => sent.push(message),
        disconnect: () => undefined,
    });

    const result = await Effect.runPromise(
        Effect.gen(function* () {
            const first = yield* Effect.forkChild(provider.account);
            while (sent.length < 1) yield* Effect.yieldNow;
            yield* TestClock.adjust('15 seconds');
            const firstExit = yield* Effect.exit(Fiber.join(first));
            inbound.receive({
                kind: 'response',
                id: sent[0]!.id,
                method: 'account',
                result: { ok: true, value: 'late' },
            });
            const second = yield* Effect.forkChild(provider.account);
            while (sent.length < 2) yield* Effect.yieldNow;
            inbound.receive({
                kind: 'response',
                id: sent[1]!.id,
                method: 'account',
                result: { ok: true, value: 'current' },
            });
            return [firstExit, yield* Fiber.join(second)] as const;
        }).pipe(Effect.provide(TestClock.layer())),
    );

    assert.equal(result[0]._tag, 'Failure');
    assert.equal(result[1], 'current');
    assert.deepEqual(
        sent.map((request) => request.id),
        [1, 2],
    );
});

test('interruption removes a provider request and malformed envelopes are ignored', async (t) => {
    const inbound = { receive(_message: ProviderResponseInput) {} };
    const sent: ProviderRequest[] = [];
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    provider.accept({
        name: PROVIDER_PORT,
        sender: {
            id: 'extension',
            frameId: 0,
            url: 'https://www.instagram.com/',
            tab: { id: 1 },
        },
        onMessage: {
            addListener: (listener) => (inbound.receive = listener),
            removeListener: () => {
                inbound.receive = () => undefined;
            },
        },
        onDisconnect: {
            addListener: () => undefined,
            removeListener: () => undefined,
        },
        postMessage: (message) => sent.push(message),
        disconnect: () => undefined,
    });

    const value = await Effect.runPromise(
        Effect.gen(function* () {
            const interrupted = yield* Effect.forkChild(provider.account);
            while (sent.length < 1) yield* Effect.yieldNow;
            yield* Fiber.interrupt(interrupted);
            inbound.receive({
                kind: 'response',
                id: 1,
                method: 'account',
                result: null,
            });
            inbound.receive({
                kind: 'response',
                id: 1,
                method: 'account',
                result: { ok: true, value: 'late' },
            });
            const current = yield* Effect.forkChild(provider.account);
            while (sent.length < 2) yield* Effect.yieldNow;
            inbound.receive({
                kind: 'response',
                id: 2,
                method: 'account',
                result: { ok: true, value: 'ok' },
            });
            return yield* Fiber.join(current);
        }),
    );

    assert.equal(value, 'ok');
    assert.deepEqual(
        sent.map((request) => request.id),
        [1, 2],
    );
});

test('matching malformed provider results fail immediately as protocol errors', async (t) => {
    const inbound = { receive(_message: ProviderResponseInput) {} };
    const sent: ProviderRequest[] = [];
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    provider.accept({
        name: PROVIDER_PORT,
        sender: {
            id: 'extension',
            frameId: 0,
            url: 'https://www.instagram.com/',
            tab: { id: 1 },
        },
        onMessage: {
            addListener: (listener) => (inbound.receive = listener),
            removeListener: () => {
                inbound.receive = () => undefined;
            },
        },
        onDisconnect: {
            addListener: () => undefined,
            removeListener: () => undefined,
        },
        postMessage: (message) => sent.push(message),
        disconnect: () => undefined,
    });

    const cases: Array<[Effect.Effect<void, InboxError>, JsonValue]> = [
        [
            Effect.asVoid(provider.account),
            { ok: false, error: { kind: 'future', message: 'bad' } },
        ],
        [Effect.asVoid(provider.account), { ok: true, value: '' }],
        [
            Effect.asVoid(provider.inbox('account')),
            { ok: true, value: { items: {}, hasNextPage: false } },
        ],
        [
            Effect.asVoid(provider.inbox('account')),
            {
                ok: true,
                value: {
                    items: [
                        {
                            key: 'thread',
                            title: 'thread',
                            isGroup: false,
                            isMuted: false,
                            folder: 'PRIMARY',
                            lastActivityMs: 0,
                            isUnread: false,
                            serverIsPin: false,
                            users: [
                                {
                                    id: 'user',
                                    username: 'user',
                                    fullName: 'User',
                                    picUrl: null,
                                },
                            ],
                            lastMessage: {
                                id: 'message',
                                kind: 'text',
                                text: 1,
                                senderId: 'user',
                                ts: 0,
                            },
                        },
                    ],
                    hasNextPage: false,
                },
            },
        ],
        [
            Effect.asVoid(provider.history('account', 'thread')),
            {
                ok: true,
                value: { items: [], hasNextPage: false, viewerId: '' },
            },
        ],
        [
            Effect.asVoid(provider.history('account', 'thread')),
            {
                ok: true,
                value: {
                    items: [
                        {
                            id: 'message',
                            kind: 'image',
                            ts: 0,
                            senderId: 'user',
                            images: [
                                {
                                    url: 'https://example.test/image',
                                    width: 'wide',
                                },
                            ],
                        },
                    ],
                    hasNextPage: false,
                    viewerId: 'viewer',
                },
            },
        ],
    ];

    for (const [operation, result] of cases) {
        const running = Effect.runPromise(Effect.result(operation));
        while (sent.length === 0) await Promise.resolve();
        const request = sent.shift()!;
        inbound.receive({
            kind: 'response',
            id: request.id,
            method: request.method,
            result,
        });
        const outcome = await running;
        assert.equal(outcome._tag, 'Failure');
        if (Result.isFailure(outcome))
            assert.equal(outcome.failure.kind, 'protocol');
    }
});

function anchorFixture() {
    const acquisitions: Array<(tabId: number) => void> = [];
    const provider = makeInboxProvider({
        ensureAnchor: () =>
            new Promise<number>((resolve) => acquisitions.push(resolve)),
        extensionId: 'extension',
    });
    let requests = 0;
    let disconnects = 0;

    function accept(tabId: number) {
        const inbound = { receive(_message: ProviderResponseInput) {} };
        provider.accept({
            name: PROVIDER_PORT,
            sender: {
                id: 'extension',
                frameId: 0,
                url: 'https://www.instagram.com/',
                tab: { id: tabId },
            },
            onMessage: {
                addListener: (listener) => {
                    inbound.receive = listener;
                },
                removeListener: () => {
                    inbound.receive = () => undefined;
                },
            },
            onDisconnect: {
                addListener: () => undefined,
                removeListener: () => undefined,
            },
            postMessage: (message) => {
                requests++;
                inbound.receive({
                    kind: 'response',
                    id: message.id,
                    method: 'account',
                    result: { ok: true, value: 'current' },
                });
            },
            disconnect: () => {
                disconnects++;
            },
        });
    }

    return {
        provider,
        acquisitions,
        accept,
        requests: () => requests,
        disconnects: () => disconnects,
    };
}

test('expired anchor acquisition retries and late settlement cannot retire its replacement', async (t) => {
    const fixture = anchorFixture();
    t.after(() => fixture.provider.dispose());
    await Effect.runPromise(
        Effect.gen(function* () {
            const first = yield* Effect.forkChild(fixture.provider.account);
            while (fixture.acquisitions.length < 1) yield* Effect.yieldNow;
            yield* TestClock.adjust('10 seconds');
            const failure = yield* Effect.result(Fiber.join(first));
            assert(Result.isFailure(failure));
            assert.equal(failure.failure.kind, 'provider_unavailable');
            const retry = yield* Effect.forkChild(fixture.provider.account);
            while (fixture.acquisitions.length < 2) yield* Effect.yieldNow;
            fixture.acquisitions[0]!(99);
            // Let the retired Promise's settlement handlers run before another owner joins.
            yield* Effect.promise(() => Promise.resolve());
            const concurrent = yield* Effect.forkChild(
                fixture.provider.account,
            );
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;
            assert.equal(fixture.acquisitions.length, 2);
            fixture.accept(1);
            fixture.acquisitions[1]!(1);
            assert.equal(yield* Fiber.join(retry), 'current');
            assert.equal(yield* Fiber.join(concurrent), 'current');
            assert.equal(fixture.requests(), 2);
        }).pipe(Effect.provide(TestClock.layer())),
    );
});

test('shared anchor acquisition survives one owner interruption', async (t) => {
    const fixture = anchorFixture();
    t.after(() => fixture.provider.dispose());
    await Effect.runPromise(
        Effect.gen(function* () {
            const first = yield* Effect.forkChild(fixture.provider.account);
            while (fixture.acquisitions.length < 1) yield* Effect.yieldNow;
            const second = yield* Effect.forkChild(fixture.provider.account);
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;
            yield* Fiber.interrupt(first);
            const third = yield* Effect.forkChild(fixture.provider.account);
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;
            assert.equal(fixture.acquisitions.length, 1);
            fixture.accept(1);
            fixture.acquisitions[0]!(1);
            assert.equal(yield* Fiber.join(second), 'current');
            assert.equal(yield* Fiber.join(third), 'current');
            assert.equal(fixture.requests(), 2);
        }).pipe(Effect.provide(TestClock.layer())),
    );
});

test('disposal retires hanging acquisition and disconnects only once', async () => {
    const fixture = anchorFixture();
    await Effect.runPromise(
        Effect.gen(function* () {
            const root = yield* Effect.forkChild(fixture.provider.account);
            while (fixture.acquisitions.length < 1) yield* Effect.yieldNow;
            fixture.accept(1);
            fixture.provider.dispose();
            fixture.provider.dispose();
            assert.equal(
                (yield* Effect.result(Fiber.join(root)))._tag,
                'Failure',
            );
            fixture.acquisitions[0]!(1);
            yield* Effect.promise(() => Promise.resolve());
            assert.equal(
                (yield* Effect.result(fixture.provider.account))._tag,
                'Failure',
            );
            assert.equal(fixture.acquisitions.length, 1);
            assert.equal(fixture.disconnects(), 1);
            assert.equal(fixture.requests(), 0);
        }).pipe(Effect.provide(TestClock.layer())),
    );
});
