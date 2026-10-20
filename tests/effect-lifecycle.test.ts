import assert from 'node:assert/strict';
import test from 'node:test';
import {
    Deferred,
    Effect,
    Exit,
    Fiber,
    Layer,
    ManagedRuntime,
    Result,
} from 'effect';
import { TestClock } from 'effect/testing';
import { IDBFactory } from 'fake-indexeddb';
import type { Thread, ThreadMessages } from '../lib/domain.ts';
import {
    InboxRepositoryService,
    inboxRepositoryLive,
    makeInboxRepository,
} from '../lib/engine/db.ts';
import { InboxEngineService, InboxError } from '../lib/engine/inbox.ts';
import { bindInboxEngine, makeWorkerRuntime } from '../lib/worker/layer.ts';
import {
    InboxProviderService,
    inboxProviderLive,
    makeInboxProvider,
    type InboxProviderEffects,
    type ProviderPort,
    type ProviderResponseInput,
} from '../lib/provider/inbox.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
} from '../lib/provider/protocol.ts';
import { prepareInboxProviderPort } from '../lib/provider/startup.ts';

function signal() {
    const deferred = Deferred.makeUnsafe<void>();
    return {
        effect: Deferred.await(deferred),
        fire: () => Deferred.doneUnsafe(deferred, Effect.void),
        wait: () => Effect.runPromise(Deferred.await(deferred)),
    };
}

function portFixture() {
    const messages = new Set<(message: ProviderResponseInput) => void>();
    const disconnects = new Set<() => void>();
    const sent: ProviderRequest[] = [];
    const posted = signal();
    let disconnected = false;

    const port: ProviderPort = {
        name: PROVIDER_PORT,
        sender: {
            id: 'extension',
            frameId: 0,
            url: 'https://www.instagram.com/',
            tab: { id: 1 },
        },
        onMessage: {
            addListener: (listener) => {
                messages.add(listener);
            },
            removeListener: (listener) => {
                messages.delete(listener);
            },
        },
        onDisconnect: {
            addListener: (listener) => {
                disconnects.add(listener);
            },
            removeListener: (listener) => {
                disconnects.delete(listener);
            },
        },
        postMessage: (request) => {
            sent.push(request);
            posted.fire();
        },
        disconnect: () => {
            disconnected = true;
            for (const listener of disconnects) listener();
        },
    };

    return {
        port,
        messages,
        disconnects,
        sent,
        posted,
        disconnected: () => disconnected,
    };
}

function thread(key: string): Thread {
    return {
        key,
        title: key,
        users: [],
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 0,
        isUnread: false,
        serverIsPin: false,
    };
}

function controlledProvider(ids = ['a', 'b', 'c', 'd', 'e']) {
    const calls: Array<{
        id: string;
        result: Deferred.Deferred<ThreadMessages, InboxError>;
        interrupted: ReturnType<typeof signal>;
    }> = [];
    const starts = new Map(ids.map((id) => [id, signal()]));
    const provider: InboxProviderEffects = {
        accept: () => undefined,
        mutate: () => Effect.fail(new InboxError('invalid_request')),
        account: Effect.succeed('account'),
        inbox: () =>
            Effect.succeed({ items: ids.map(thread), hasNextPage: false }),
        history: (_account, id) =>
            Effect.suspend(() => {
                const call = {
                    id,
                    result: Deferred.makeUnsafe<ThreadMessages, InboxError>(),
                    interrupted: signal(),
                };
                calls.push(call);
                starts.get(id)?.fire();
                return Deferred.await(call.result).pipe(
                    Effect.onInterrupt(() =>
                        Effect.sync(call.interrupted.fire),
                    ),
                );
            }),
    };
    return { provider, calls, starts };
}

function history(id: string): ThreadMessages {
    return {
        items: [{ id, kind: 'text', text: id, senderId: 'sender', ts: 1 }],
        hasNextPage: false,
        viewerId: 'viewer',
    };
}

// Flush scheduled fibers, not elapsed time. All behavioral waits use explicit signals.
function checkpoint() {
    return Effect.runPromise(Effect.yieldNow);
}

test('runtime disposal interrupts Promise facade roots and scoped provider bootstrap requests', async (t) => {
    const anchorStarted = signal();
    const fixture = portFixture();
    const runtime = makeWorkerRuntime(
        inboxProviderLive({
            ensureAnchor: async () => {
                anchorStarted.fire();
                return 1;
            },
            extensionId: 'extension',
        }),
        inboxRepositoryLive(new IDBFactory()),
    );
    t.after(() => runtime.dispose());
    const engine = await runtime.runPromise(InboxEngineService);
    const provider = await runtime.runPromise(InboxProviderService);
    provider.accept(fixture.port);
    engine.subscribe(() => undefined);
    const facade = bindInboxEngine(engine, (command) =>
        runtime.runPromise(command),
    );
    const command = facade.refresh();
    const rejection = assert.rejects(command);
    await fixture.posted.wait();
    await runtime.dispose();
    await rejection;
    assert.equal(fixture.messages.size, 0);
    assert.equal(fixture.disconnects.size, 0);
    assert.equal(fixture.disconnected(), true);
    const before = fixture.sent.length;
    engine.subscribe(() => assert.fail('closed engine published'));
    provider.accept(fixture.port);
    assert.equal(fixture.sent.length, before);
});

test('shared history survives first release and waiter interruption; last release frees a network permit', async (t) => {
    const controlled = controlledProvider();
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, controlled.provider),
        inboxRepositoryLive(new IDBFactory()),
    );
    t.after(() => runtime.dispose());
    const engine = await runtime.runPromise(InboxEngineService);
    await runtime.runPromise(engine.refresh);
    const stopA = engine.subscribe(() => undefined, 'a');
    const stopSecondA = engine.subscribe(() => undefined, 'a');
    for (const id of ['b', 'c', 'd']) engine.subscribe(() => undefined, id);
    await Promise.all(
        ['a', 'b', 'c', 'd'].map((id) => controlled.starts.get(id)!.wait()),
    );
    engine.subscribe(() => undefined, 'e');
    const waiter = runtime.runFork(engine.refreshHistory('a'));
    await checkpoint();
    await Effect.runPromise(Fiber.interrupt(waiter));
    assert.equal(controlled.calls.filter((call) => call.id === 'a').length, 1);
    stopA();
    await checkpoint();
    assert.equal(controlled.calls.filter((call) => call.id === 'e').length, 0);
    stopSecondA();
    const old = controlled.calls.find((call) => call.id === 'a')!;
    await old.interrupted.wait();
    await controlled.starts.get('e')!.wait();
    assert.equal(controlled.calls.filter((call) => call.id === 'e').length, 1);
    assert.equal(engine.snapshot().histories.a.synchronization, 'idle');
});

test('reselection owns a new producer and late cancelled completion cannot commit', async (t) => {
    const controlled = controlledProvider(['a']);
    const repository = makeInboxRepository(new IDBFactory());
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, controlled.provider),
        Layer.succeed(InboxRepositoryService, repository),
    );
    t.after(async () => {
        await runtime.dispose();
        await Effect.runPromise(repository.close);
    });
    const engine = await runtime.runPromise(InboxEngineService);
    await runtime.runPromise(engine.refresh);
    const stop = engine.subscribe(() => undefined, 'a');
    await controlled.starts.get('a')!.wait();
    const old = controlled.calls[0]!;
    stop();
    await old.interrupted.wait();
    engine.subscribe(() => undefined, 'a');
    const waiter = runtime.runFork(engine.refreshHistory('a'));
    while (controlled.calls.length < 2) await checkpoint();
    const current = controlled.calls[1]!;
    Deferred.doneUnsafe(old.result, Effect.succeed(history('old')));
    Deferred.doneUnsafe(current.result, Effect.succeed(history('new')));
    await Effect.runPromise(Fiber.join(waiter));
    const durable = await Effect.runPromise(
        repository.readResources('account', ['history:a']),
    );
    assert.deepEqual(durable.resources[0]?.orderedIds, ['new']);
    assert.equal(durable.entities.messagesById.old, undefined);
});

test('started commit reconciles before lane release and repository close during disposal', async (t) => {
    const controlled = controlledProvider(['a', 'b']);
    const repository = makeInboxRepository(new IDBFactory());
    const started = signal();
    const release = signal();
    const reconciled = signal();
    let closed = false;
    let bCommits = 0;

    const wrapped = {
        ...repository,
        commitResources: (
            account: string,
            update: Parameters<typeof repository.commitResources>[1],
        ) =>
            Effect.gen(function* () {
                if (
                    update.resources.some(
                        (resource) => resource.threadId === 'a',
                    )
                ) {
                    started.fire();
                    yield* release.effect;
                }
                if (
                    update.resources.some(
                        (resource) => resource.threadId === 'b',
                    )
                )
                    bCommits++;
                assert.equal(
                    closed,
                    false,
                    'repository closed while commit still owned the lane',
                );
                const result = yield* repository.commitResources(
                    account,
                    update,
                );
                if (
                    update.resources.some(
                        (resource) => resource.threadId === 'a',
                    )
                )
                    reconciled.fire();
                return result;
            }),
        close: Effect.andThen(
            Effect.sync(() => {
                closed = true;
            }),
            repository.close,
        ),
    };

    const repositoryLayer = Layer.effect(
        InboxRepositoryService,
        Effect.acquireRelease(Effect.succeed(wrapped), (value) =>
            Effect.orDie(value.close),
        ),
    );
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, controlled.provider),
        repositoryLayer,
    );
    t.after(() => runtime.dispose());
    const engine = await runtime.runPromise(InboxEngineService);
    await runtime.runPromise(engine.refresh);
    const revision = engine.snapshot().commitRevision;

    const stopA = engine.subscribe(() => undefined, 'a');
    engine.subscribe(() => undefined, 'b');
    await Promise.all(
        [...controlled.starts.values()].map((value) => value.wait()),
    );
    Deferred.doneUnsafe(
        controlled.calls.find((call) => call.id === 'a')!.result,
        Effect.succeed(history('a-message')),
    );
    await started.wait();
    stopA();
    Deferred.doneUnsafe(
        controlled.calls.find((call) => call.id === 'b')!.result,
        Effect.succeed(history('b-message')),
    );
    await checkpoint();
    assert.equal(bCommits, 0);
    assert.equal(engine.snapshot().commitRevision, revision);

    const disposing = runtime.dispose();
    await checkpoint();
    assert.equal(closed, false);
    release.fire();
    await reconciled.wait();
    await disposing;
    assert.equal(closed, true);
    assert.equal(bCommits, 0);
    assert.equal(engine.snapshot().commitRevision, revision + 1);
});

test('provider closure fails waiting and pending requests, removes listeners, and rejects later accept', async () => {
    const waiting = makeInboxProvider({
        ensureAnchor: () => new Promise(() => undefined),
        extensionId: 'extension',
    });
    const waitingResult = Effect.runPromise(Effect.result(waiting.account));
    await checkpoint();
    waiting.dispose();
    assert.equal((await waitingResult)._tag, 'Failure');
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    const fixture = portFixture();
    provider.accept(fixture.port);
    const pending = Effect.runPromise(Effect.result(provider.account));
    await fixture.posted.wait();
    provider.dispose();
    assert.equal((await pending)._tag, 'Failure');
    assert.equal(fixture.messages.size, 0);
    assert.equal(fixture.disconnects.size, 0);
    const later = portFixture();
    provider.accept(later.port);
    assert.equal(later.disconnected(), true);
    assert.equal(
        (await Effect.runPromise(Effect.result(provider.account)))._tag,
        'Failure',
    );
});

test('provider startup captures cold-start disconnect before activation', () => {
    const fixture = portFixture();
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    const activate = prepareInboxProviderPort(fixture.port);
    fixture.port.disconnect();
    assert.equal(fixture.disconnects.size, 0);
    activate(provider);
    assert.equal(fixture.messages.size, 0);
    assert.equal(fixture.disconnects.size, 0);
    provider.dispose();
});

test('prepared provider Port cancellation cleans up before activation and failed provisioning', async () => {
    const fixture = portFixture();
    const activate = prepareInboxProviderPort(fixture.port);
    activate.dispose();
    activate.dispose();
    assert.equal(fixture.disconnects.size, 0);
    assert.equal(fixture.disconnected(), true);
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    activate({
        ...provider,
        accept: () => assert.fail('cancelled startup activated'),
    });
    provider.dispose();

    const failed = portFixture();
    const prepared = prepareInboxProviderPort(failed.port);
    const runtime = ManagedRuntime.make(
        Layer.effect(InboxProviderService, Effect.die('failed provisioning')),
    );
    const cleaned = signal();
    const fiber = runtime.runFork(Effect.map(InboxProviderService, prepared));
    fiber.addObserver((exit) => {
        if (Exit.isFailure(exit)) {
            prepared.dispose();
            cleaned.fire();
        }
    });
    await cleaned.wait();
    assert.equal(failed.disconnects.size, 0);
    assert.equal(failed.disconnected(), true);
    await runtime.dispose();
});

test('runtime disposal interrupts deferred hydration without waiting for repository read completion', async (t) => {
    const controlled = controlledProvider(['a']);
    const started = signal();
    const interrupted = signal();
    const repository = makeInboxRepository(new IDBFactory());
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, controlled.provider),
        Layer.succeed(InboxRepositoryService, {
            ...repository,
            readResources: () =>
                Effect.andThen(Effect.sync(started.fire), Effect.never).pipe(
                    Effect.onInterrupt(() => Effect.sync(interrupted.fire)),
                ),
        }),
    );
    t.after(async () => {
        await runtime.dispose();
        await Effect.runPromise(repository.close);
    });
    const engine = await runtime.runPromise(InboxEngineService);
    const command = runtime.runPromise(engine.refresh);
    const rejection = assert.rejects(command);
    await started.wait();
    await runtime.dispose();
    await interrupted.wait();
    await rejection;
    assert.equal(engine.snapshot().commitRevision, 0);
});

test('shared history hydration survives one detach and last detach frees the lane', async (t) => {
    const controlled = controlledProvider(['a', 'b']);
    const started = signal();
    const interrupted = signal();
    const repository = makeInboxRepository(new IDBFactory());
    let reads = 0;
    let cancelled = false;
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, controlled.provider),
        Layer.succeed(InboxRepositoryService, {
            ...repository,
            readHistoryWindow: (account, threadId, request) => {
                if (threadId === 'a') {
                    reads++;
                    return Effect.andThen(
                        Effect.sync(started.fire),
                        Effect.never,
                    ).pipe(
                        Effect.onInterrupt(() =>
                            Effect.sync(() => {
                                cancelled = true;
                                interrupted.fire();
                            }),
                        ),
                    );
                }
                return repository.readHistoryWindow(account, threadId, request);
            },
        }),
    );
    t.after(async () => {
        await runtime.dispose();
        await Effect.runPromise(repository.close);
    });
    const engine = await runtime.runPromise(InboxEngineService);
    await runtime.runPromise(engine.refresh);

    const first = engine.subscribe(() => undefined, 'a');
    await started.wait();
    const second = engine.subscribe(() => undefined, 'a');
    await checkpoint();

    first();
    await checkpoint();
    assert.equal(reads, 1);
    assert.equal(cancelled, false);
    engine.subscribe(() => undefined, 'b');
    second();
    await interrupted.wait();
    await controlled.starts.get('b')!.wait();
    assert.equal(reads, 1);
    const call = controlled.calls.find((item) => item.id === 'b')!;
    Deferred.doneUnsafe(call.result, Effect.succeed(history('b-message')));
    await runtime.runPromise(engine.refresh);
});

test('account reset interrupts obsolete history hydration before new-account work', async (t) => {
    const repository = makeInboxRepository(new IDBFactory());
    const controlled = controlledProvider(['a']);
    const started = signal();
    const interrupted = signal();
    let account = 'old';
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, {
            ...controlled.provider,
            account: Effect.sync(() => account),
        }),
        Layer.succeed(InboxRepositoryService, {
            ...repository,
            readHistoryWindow: (id, threadId, request) =>
                id === 'old' && threadId === 'a'
                    ? Effect.andThen(
                          Effect.sync(started.fire),
                          Effect.never,
                      ).pipe(
                          Effect.onInterrupt(() =>
                              Effect.sync(interrupted.fire),
                          ),
                      )
                    : repository.readHistoryWindow(id, threadId, request),
        }),
    );
    t.after(async () => {
        await runtime.dispose();
        await Effect.runPromise(repository.close);
    });
    const engine = await runtime.runPromise(InboxEngineService);
    await runtime.runPromise(engine.refresh);
    engine.subscribe(() => undefined, 'a');
    await started.wait();
    account = 'new';
    await runtime.runPromise(engine.refresh);
    await interrupted.wait();
    assert.equal(engine.snapshot().accountId, 'new');
    assert.deepEqual(engine.snapshot().entities.messagesById, {});
});

for (const outcome of ['switch', 'auth'] as const) {
    test(`capacity rejection hides retained facts during renewal and ${outcome}`, async (t) => {
        const repository = makeInboxRepository(new IDBFactory());
        const renewal = Deferred.makeUnsafe<string, InboxError>();
        const started = signal();
        let renew = false;
        const provider: InboxProviderEffects = {
            accept: () => undefined,
            mutate: () => Effect.fail(new InboxError('invalid_request')),
            account: Effect.suspend(() =>
                renew
                    ? Effect.andThen(
                          Effect.sync(started.fire),
                          Deferred.await(renewal),
                      )
                    : Effect.succeed('old-account'),
            ),
            inbox: () =>
                Effect.succeed({
                    items: [thread('private')],
                    hasNextPage: false,
                }),
            history: () =>
                Effect.succeed({
                    items: [],
                    hasNextPage: false,
                    viewerId: 'viewer',
                }),
        };
        const runtime = makeWorkerRuntime(
            Layer.succeed(InboxProviderService, provider),
            Layer.succeed(InboxRepositoryService, repository),
        );
        t.after(async () => {
            await runtime.dispose();
            await Effect.runPromise(repository.close);
        });
        const engine = await runtime.runPromise(InboxEngineService);
        await runtime.runPromise(engine.refresh);
        const releases = Array.from({ length: 20 }, (_, index) =>
            engine.subscribe(() => undefined, `detail-${index}`),
        );
        await checkpoint();

        renew = true;
        const refresh = runtime.runPromise(engine.refresh);
        await started.wait();
        const values: ReturnType<typeof engine.snapshot>[] = [];
        engine.subscribe((value) => values.push(value), 'rejected');
        assert(values.length > 0);
        for (const value of values) {
            assert.equal(value.accountId, null);
            assert.deepEqual(value.entities.threadsById, {});
            assert.equal(value.histories.rejected.error?.kind, 'capacity');
        }

        Deferred.doneUnsafe(
            renewal,
            outcome === 'switch'
                ? Effect.succeed('new-account')
                : Effect.fail(new InboxError('auth')),
        );
        await refresh;
        await checkpoint();
        assert(values.every((value) => value.accountId !== 'old-account'));
        if (outcome === 'auth') {
            assert(values.every((value) => value.accountId === null));
        } else {
            assert.equal(values.at(-1)?.accountId, 'new-account');
            releases[0]();
            await runtime.runPromise(engine.refreshHistory('rejected'));
            assert.notEqual(
                values.at(-1)?.histories.rejected?.error?.kind,
                'capacity',
            );
        }
    });
}

test('whole anchor acquisition is timed out, concurrent acquisition is single-flight but not permanently cached', async () => {
    let anchorCalls = 0;
    const anchorStarted = signal();
    const provider = makeInboxProvider({
        ensureAnchor: () => {
            anchorCalls++;
            anchorStarted.fire();
            return new Promise(() => undefined);
        },
        extensionId: 'extension',
    });
    const results = await Effect.runPromise(
        Effect.gen(function* () {
            const first = yield* Effect.forkChild(
                Effect.result(provider.account),
            );
            const second = yield* Effect.forkChild(
                Effect.result(provider.account),
            );
            yield* anchorStarted.effect;
            yield* TestClock.adjust('10 seconds');
            return yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
        }).pipe(Effect.provide(TestClock.layer())),
    );
    assert.equal(anchorCalls, 1);
    assert(results.every(Result.isFailure));
    provider.dispose();

    let readyCalls = 0;
    const ready = makeInboxProvider({
        ensureAnchor: async () => {
            readyCalls++;
            return 1;
        },
        extensionId: 'extension',
    });
    const fixture = portFixture();
    // A synchronous reply proves message listeners were installed before requests wake.
    fixture.port.postMessage = (request) => {
        for (const receive of fixture.messages)
            receive({
                kind: 'response',
                id: request.id,
                method: 'account',
                result: { ok: true, value: 'account' },
            });
    };
    const first = Effect.runPromise(ready.account);
    await checkpoint();
    ready.accept(fixture.port);
    assert.equal(await first, 'account');
    assert.equal(await Effect.runPromise(ready.account), 'account');
    assert.equal(readyCalls, 2);
    ready.dispose();
});

test('interrupted identity waiters leave one scoped identity/bootstrap producer for later commands', async (t) => {
    const identity = Deferred.makeUnsafe<string>();
    const identityStarted = signal();
    const repository = makeInboxRepository(new IDBFactory());
    let identityCalls = 0;
    let inboxCalls = 0;
    let hydrations = 0;
    const provider: InboxProviderEffects = {
        accept: () => undefined,
        mutate: () => Effect.fail(new InboxError('invalid_request')),
        account: Effect.andThen(
            Effect.sync(() => {
                identityCalls++;
                identityStarted.fire();
            }),
            Deferred.await(identity),
        ),
        inbox: () =>
            Effect.sync(() => {
                inboxCalls++;
                return { items: [], hasNextPage: false };
            }),
        history: () => Effect.die('unused'),
    };
    const wrapped = {
        ...repository,
        readResources: (account: string, keys: string[]) =>
            Effect.andThen(
                Effect.sync(() => {
                    hydrations++;
                }),
                repository.readResources(account, keys),
            ),
    };
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, provider),
        Layer.succeed(InboxRepositoryService, wrapped),
    );
    t.after(async () => {
        await runtime.dispose();
        await Effect.runPromise(repository.close);
    });
    const engine = await runtime.runPromise(InboxEngineService);

    const first = runtime.runFork(engine.refresh);
    await identityStarted.wait();
    await Effect.runPromise(Fiber.interrupt(first));
    const second = runtime.runPromise(engine.refresh);
    const third = runtime.runPromise(engine.refresh);
    Deferred.doneUnsafe(identity, Effect.succeed('account'));
    await Promise.all([second, third]);
    assert.equal(identityCalls, 1);
    assert.equal(hydrations, 1);
    assert.equal(inboxCalls, 1);
});

test('obsolete identity evidence cannot resurrect an account after concurrent authentication reset', async (t) => {
    const controlled = controlledProvider(['a']);
    const identityStarted = signal();
    const oldIdentity = Deferred.makeUnsafe<string>();
    const identityInterrupted = signal();
    let deferIdentity = false;
    const provider = {
        ...controlled.provider,
        account: Effect.suspend(() => {
            if (!deferIdentity) return Effect.succeed('account');
            identityStarted.fire();
            return Deferred.await(oldIdentity).pipe(
                Effect.onInterrupt(() => Effect.sync(identityInterrupted.fire)),
            );
        }),
    };
    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, provider),
        inboxRepositoryLive(new IDBFactory()),
    );
    t.after(() => runtime.dispose());
    const engine = await runtime.runPromise(InboxEngineService);
    await runtime.runPromise(engine.refresh);

    const reset = signal();
    engine.subscribe((snapshot) => {
        if (
            snapshot.accountId === null &&
            snapshot.inbox.error?.kind === 'auth'
        )
            reset.fire();
    }, 'a');
    await controlled.starts.get('a')!.wait();

    deferIdentity = true;
    const refreshing = runtime.runPromise(engine.refresh);
    const rejection = assert.rejects(refreshing);
    await identityStarted.wait();
    Deferred.doneUnsafe(
        controlled.calls[0]!.result,
        Effect.fail(new InboxError('auth')),
    );
    await reset.wait();
    await identityInterrupted.wait();
    await rejection;

    assert.equal(engine.snapshot().accountId, null);
    assert.equal(engine.snapshot().inbox.error?.kind, 'auth');
    assert.deepEqual(engine.snapshot().entities.threadsById, {});
});
