import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    Message, Page, Result, SentTextMessage, SetReactionResult, Thread, ThreadMessages,
} from '../../lib/domain.ts';
import { createSerialTaskQueue } from '../../lib/errors.ts';
import type { CompleteUiRpc, UiRpc } from './rpc.ts';
import { createFrontendStore } from './store.ts';
import { computeChatWindow } from './virtual-list.ts';

test('chat window remains bounded after long scrolls', () => {
    const window = computeChatWindow(72 * 800, 1_000);
    assert.equal(window.start, 797);
    assert.equal(window.end - window.start, 31);
});

test('chat window handles the top and exact end', () => {
    assert.deepEqual(computeChatWindow(0, 10), { start: 0, end: 10 });
    assert.deepEqual(computeChatWindow(72 * 999, 1_000), { start: 969, end: 1_000 });
});

test('background mutation queue preserves invocation order through failures', async () => {
    const enqueue = createSerialTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = enqueue(async () => {
        events.push('first:start');
        await new Promise<void>(resolve => { releaseFirst = resolve; });
        events.push('first:end');
        throw new Error('denied');
    });
    const second = enqueue(async () => {
        events.push('second:start');
        events.push('second:end');
        return 'persisted';
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    await assert.rejects(first, /denied/);
    assert.equal(await second, 'persisted');
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('inbox pagination is single-flight and deduplicates overlapping IDs', async () => {
    let resolveInitial!: (result: Result<Page<Thread>>) => void;
    let resolveNext!: (result: Result<Page<Thread>>) => void;
    const inboxCalls: Array<{ cursor?: string }> = [];
    const rpc = fakeRpc(payload => {
        inboxCalls.push(payload);
        return new Promise(resolve => {
            if (payload.cursor) resolveNext = resolve;
            else resolveInitial = resolve;
        });
    });
    const store = createFrontendStore(rpc);

    store.start();
    resolveInitial({
        ok: true,
        value: { items: [thread('a'), thread('b')], cursor: 'next', hasNextPage: true },
    });
    await settle();
    store.loadNextInboxPage();
    store.loadNextInboxPage();
    assert.deepEqual(inboxCalls, [{}, { cursor: 'next' }]);

    resolveNext({
        ok: true,
        value: { items: [thread('b'), thread('c')], hasNextPage: false },
    });
    await settle();
    assert.deepEqual(store.state.inbox.orderedIds, ['a', 'b', 'c']);
    store.destroy();
});

test('inbox reads cannot regress an outgoing message while its send is pending or completed', async () => {
    installWindowTimers();
    for (const completeBeforeRead of [false, true]) {
        let resolvePage!: (result: Result<Page<Thread>>) => void;
        let resolveSend!: (result: Result<SentTextMessage>) => void;
        const rpc = fakeRpc(payload => payload.cursor
            ? new Promise(resolve => { resolvePage = resolve; })
            : Promise.resolve({
                ok: true,
                value: { items: [thread('a')], cursor: 'next', hasNextPage: true },
            }), async () => historyPage(0, 1, undefined, false), undefined, () =>
            new Promise(resolve => { resolveSend = resolve; }));
        const store = createFrontendStore(rpc);
        store.start();
        await settle();
        store.selectThread('a');
        await settle();
        store.loadNextInboxPage();
        const localId = store.sendText('a', 'new outgoing', { followNewest: true });
        assert.ok(localId);
        if (completeBeforeRead) {
            resolveSend({
                ok: true,
                value: { messageId: 'server', timestampMs: 10, clientRequestId: 'request' },
            });
            await settle();
        }
        resolvePage({
            ok: true,
            value: {
                items: [{
                    ...thread('a'),
                    lastActivityMs: 999,
                    lastMessage: {
                        kind: 'text', id: 'stale', senderId: 'sender', ts: 999, text: 'stale',
                    },
                }],
                hasNextPage: false,
            },
        });
        await settle();
        assert.equal(
            store.state.inbox.byId.a.lastMessage?.id,
            completeBeforeRead ? 'server' : localId,
        );
        if (!completeBeforeRead) {
            resolveSend({
                ok: true,
                value: { messageId: 'server', timestampMs: 10, clientRequestId: 'request' },
            });
            await settle();
            assert.equal(store.state.inbox.byId.a.lastMessage?.id, 'server');
        }
        store.destroy();
    }
});

test('selecting a cached thread does not duplicate initial history', async () => {
    installWindowTimers();
    let threadCalls = 0;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => {
        threadCalls++;
        return {
            ok: true,
            value: { items: [], hasNextPage: false, viewerId: 'viewer' },
        };
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    store.selectThread('a');
    await settle();
    assert.equal(threadCalls, 1);
    assert.equal(store.state.histories.a.status, 'ready');
    store.destroy();
});

test('failed pagination waits for an explicit retry', async () => {
    const inboxCalls: Array<{ cursor?: string }> = [];
    let pageAttempt = 0;
    const rpc = fakeRpc(async payload => {
        inboxCalls.push(payload);
        if (!payload.cursor) {
            return {
                ok: true,
                value: { items: [thread('a')], cursor: 'next', hasNextPage: true },
            };
        }
        pageAttempt++;
        if (pageAttempt === 1) return { ok: false, error: { message: 'temporary' } };
        return {
            ok: true,
            value: { items: [thread('b')], hasNextPage: false },
        };
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.loadNextInboxPage();
    await settle();
    store.loadNextInboxPage();
    await settle();
    assert.equal(inboxCalls.length, 2);

    store.retryInbox();
    await settle();
    assert.equal(inboxCalls.length, 3);
    assert.deepEqual(store.state.inbox.orderedIds, ['a', 'b']);
    store.destroy();
});

test('failed history can be retried', async () => {
    installWindowTimers();
    let attempts = 0;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => {
        attempts++;
        return attempts === 1
            ? { ok: false, error: { message: 'temporary' } }
            : emptyHistory();
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    assert.equal(store.state.histories.a.status, 'error');
    store.retryHistory('a');
    await settle();
    assert.equal(attempts, 2);
    assert.equal(store.state.histories.a.status, 'ready');
    store.destroy();
});

test('warmups follow the current visible window and stop at two chats', async () => {
    installWindowTimers();
    const warmed: string[] = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: {
            items: ['a', 'b', 'c', 'd'].map(thread),
            hasNextPage: false,
        },
    }), async payload => {
        warmed.push(payload.threadKey);
        return emptyHistory();
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.warmVisibleThreads(['a', 'b']);
    store.warmVisibleThreads(['c', 'd']);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.deepEqual(warmed, ['c', 'd']);
    store.warmVisibleThreads(['a', 'b']);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.deepEqual(warmed, ['c', 'd']);
    store.destroy();
});

test('stored pins are deduplicated before ordering', async () => {
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), undefined, async () => ({ pinned: ['b', 'b'] }));
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    assert.deepEqual(store.orderedThreadIds(), ['b', 'a']);
    store.destroy();
});

test('conversation pins are optimistic, single-flight, authoritative, and roll back visibly', async () => {
    let attempt = 0;
    let resolveFirst!: (result: Awaited<ReturnType<CompleteUiRpc['togglePin']>>) => void;
    const toggleCalls: Parameters<CompleteUiRpc['togglePin']>[0][] = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), undefined, async () => ({ pinned: ['b'] }), undefined, undefined, payload => {
        toggleCalls.push(payload);
        attempt++;
        if (attempt === 1) return new Promise(resolve => { resolveFirst = resolve; });
        return Promise.resolve({
            ok: true,
            value: {
                pinned: ['a', 'b'],
                receipt: { threadFbid: payload.threadFbid, isPinned: payload.pin },
            },
        });
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();

    const first = store.togglePin('a');
    assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
    assert.equal(store.state.pinMutations.a.status, 'pending');
    assert.equal(await store.togglePin('a'), false);
    assert.equal(toggleCalls.length, 1);
    resolveFirst({ ok: false, error: { message: 'denied' } });
    assert.equal(await first, false);
    assert.deepEqual(store.state.pinnedIds, ['b']);
    assert.deepEqual(store.state.pinMutations.a, {
        pin: true, order: 1, status: 'error', error: 'denied',
    });

    assert.equal(await store.togglePin('a'), true);
    assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
    assert.equal(store.state.pinMutations.a, undefined);
    assert.equal(toggleCalls[0]?.threadFbid, '1');
    store.destroy();
});

test('pin reads cannot overwrite a mutation whether the read or mutation finishes first', async () => {
    for (const mutationFinishesFirst of [false, true]) {
        let resolvePins!: (value: { pinned: string[] }) => void;
        let resolveToggle!: (value: Awaited<ReturnType<CompleteUiRpc['togglePin']>>) => void;
        const rpc = fakeRpc(async () => ({
            ok: true,
            value: { items: [thread('a'), thread('b')], hasNextPage: false },
        }), undefined, () => new Promise(resolve => { resolvePins = resolve; }),
        undefined, undefined, payload => new Promise(resolve => { resolveToggle = resolve; }));
        const store = createFrontendStore(rpc);
        store.start();
        await settle();
        const mutation = store.togglePin('a');
        assert.deepEqual(store.state.pinnedIds, ['a']);

        if (mutationFinishesFirst) {
            resolveToggle({
                ok: true,
                value: { pinned: ['a', 'b'], receipt: { threadFbid: '1', isPinned: true } },
            });
            await mutation;
            resolvePins({ pinned: ['b'] });
        } else {
            resolvePins({ pinned: ['b'] });
            await settle();
            assert.deepEqual(store.state.pinnedIds, ['a']);
            resolveToggle({
                ok: true,
                value: { pinned: ['a', 'b'], receipt: { threadFbid: '1', isPinned: true } },
            });
            await mutation;
        }
        await settle();
        assert.deepEqual(store.state.committedPinnedIds, ['a', 'b']);
        assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
        store.destroy();
    }
});

test('cross-thread pin completions commit in invocation order and replay failures', async () => {
    const resolvers = new Map<string, (value: Awaited<ReturnType<CompleteUiRpc['togglePin']>>) => void>();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b'), thread('c')], hasNextPage: false },
    }), undefined, async () => ({ pinned: ['c'] }), undefined, undefined, payload =>
        new Promise(resolve => { resolvers.set(payload.threadKey, resolve); }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();

    const first = store.togglePin('a');
    const second = store.togglePin('b');
    assert.deepEqual(store.state.pinnedIds, ['b', 'a', 'c']);
    resolvers.get('b')!({
        ok: true,
        value: { pinned: ['b', 'c'], receipt: { threadFbid: '2', isPinned: true } },
    });
    await settle();
    assert.deepEqual(store.state.pinnedIds, ['b', 'a', 'c']);
    resolvers.get('a')!({ ok: false, error: { message: 'first denied' } });
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(store.state.committedPinnedIds, ['b', 'c']);
    assert.deepEqual(store.state.pinnedIds, ['b', 'c']);
    assert.equal(store.state.pinMutations.a.status, 'error');
    assert.equal(store.state.pinMutations.b, undefined);
    store.destroy();
});

test('a pin read begun during a mutation refreshes only its committed baseline', async () => {
    let pinRead = 0;
    let resolveRead!: (value: { pinned: string[] }) => void;
    let resolveToggle!: (value: Awaited<ReturnType<CompleteUiRpc['togglePin']>>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), undefined, () => ++pinRead === 1
        ? Promise.resolve({ pinned: ['b'] })
        : new Promise(resolve => { resolveRead = resolve; }),
    undefined, undefined, () => new Promise(resolve => { resolveToggle = resolve; }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    const mutation = store.togglePin('a');
    store.start();
    await settle();
    resolveRead({ pinned: ['b'] });
    await settle();
    assert.deepEqual(store.state.committedPinnedIds, ['b']);
    assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
    resolveToggle({
        ok: true,
        value: { pinned: ['a', 'b'], receipt: { threadFbid: '1', isPinned: true } },
    });
    assert.equal(await mutation, true);
    assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
    store.destroy();
});

test('only the latest overlapping pin read may commit data or status', async () => {
    const reads: Array<{
        resolve: (value: { pinned: string[] }) => void;
        reject: (error: Error) => void;
    }> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), undefined, () => new Promise((resolve, reject) => reads.push({ resolve, reject })));
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.start();
    await settle();
    assert.equal(reads.length, 2);
    reads[1].resolve({ pinned: ['b'] });
    await settle();
    assert.deepEqual(store.state.committedPinnedIds, ['b']);
    assert.equal(store.state.pinsStatus, 'ready');
    reads[0].resolve({ pinned: ['a'] });
    await settle();
    assert.deepEqual(store.state.committedPinnedIds, ['b']);
    assert.equal(store.state.pinsStatus, 'ready');

    store.start();
    await settle();
    store.start();
    await settle();
    reads[3].resolve({ pinned: ['a', 'b'] });
    await settle();
    reads[2].reject(new Error('stale read failed'));
    await settle();
    assert.deepEqual(store.state.committedPinnedIds, ['a', 'b']);
    assert.equal(store.state.pinsStatus, 'ready');
    store.destroy();
});

test('destroy ignores late pin mutation and read completions', async () => {
    let resolvePins!: (value: { pinned: string[] }) => void;
    let resolveToggle!: (value: Awaited<ReturnType<CompleteUiRpc['togglePin']>>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), undefined, () => new Promise(resolve => { resolvePins = resolve; }),
    undefined, undefined, () => new Promise(resolve => { resolveToggle = resolve; }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    const mutation = store.togglePin('a');
    store.destroy();
    resolvePins({ pinned: ['stale'] });
    resolveToggle({
        ok: true,
        value: { pinned: ['a'], receipt: { threadFbid: '1', isPinned: true } },
    });
    assert.equal(await mutation, false);
    assert.deepEqual(store.state.committedPinnedIds, []);
    assert.deepEqual(store.state.pinnedIds, ['a']);
});

test('older history deduplicates overlaps, stays bounded, and preloads once', async () => {
    installWindowTimers();
    const calls: Array<{ threadKey: string; cursor?: string }> = [];
    let resolveVisible!: (result: Result<ThreadMessages>) => void;
    let resolvePreload!: (result: Result<ThreadMessages>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => {
        calls.push(payload);
        if (!payload.cursor) return Promise.resolve(historyPage(40, 60, 'c1', true));
        return new Promise(resolve => {
            if (payload.cursor === 'c1') resolveVisible = resolve;
            else resolvePreload = resolve;
        });
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.revealOlderHistory('a');
    store.revealOlderHistory('a');
    assert.deepEqual(calls.map(call => call.cursor), [undefined, 'c1']);

    resolveVisible(historyPage(20, 41, 'c2', true));
    await settle();
    await settle();
    assert.deepEqual(calls.map(call => call.cursor), [undefined, 'c1', 'c2']);
    store.revealOlderHistory('a', true);
    assert.deepEqual(store.state.histories.a.viewportIds, messageIds(20, 60));

    resolvePreload(historyPage(0, 21, undefined, false));
    await settle();
    const history = store.state.histories.a;
    assert.deepEqual(history.listedIds, messageIds(0, 60));
    assert.deepEqual(history.viewportIds, messageIds(20, 60));
    assert.equal(history.viewportIds.length <= 80, true);
    assert.equal(calls.length, 3);
    store.destroy();
});

test('reply navigation drains contiguous older pages and teleports a bounded window to the target', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async payload => {
        calls.push(payload.cursor);
        if (!payload.cursor) return historyPage(80, 120, 'c1', true);
        if (payload.cursor === 'c1') return historyPage(60, 80, 'c2', true);
        if (payload.cursor === 'c2') return historyPage(40, 60, 'c3', true);
        if (payload.cursor === 'c3') return historyPage(20, 40, 'c4', true);
        return historyPage(0, 20, undefined, false);
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    assert.equal(await store.navigateToReply('a', 'm10'), true);
    const history = store.state.histories.a;
    assert.deepEqual(calls, [undefined, 'c1', 'c2', 'c3', 'c4']);
    assert.equal(history.viewportIds.includes('m10'), true);
    assert.equal(history.viewportIds.length <= 80, true);
    assert.deepEqual(history.viewportIds, messageIds(0, 80));
    assert.equal(history.replyNavigation?.status, 'ready');

    assert.equal(await store.navigateToReply('a', 'deleted-message'), false);
    assert.equal(history.replyNavigation?.status, 'error');
    assert.equal(history.replyNavigation?.error, 'Original message is unavailable.');
    assert.equal(calls.length, 5);
    store.destroy();
});

test('reply navigation uses a local target without requesting older history', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async payload => {
        calls.push(payload.cursor);
        return historyPage(80, 120, 'c1', true);
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    assert.equal(await store.navigateToReply('a', 'm90'), true);
    assert.deepEqual(calls, [undefined]);
    assert.equal(store.state.histories.a.replyNavigation?.targetId, 'm90');
    store.destroy();
});

test('reply navigation joins an older request in flight without duplicating its cursor', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    let resolveOlder!: (result: Result<ThreadMessages>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => {
        calls.push(payload.cursor);
        if (!payload.cursor) return Promise.resolve(historyPage(80, 120, 'c1', true));
        return new Promise(resolve => { resolveOlder = resolve; });
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    store.revealOlderHistory('a', true);
    const navigation = store.navigateToReply('a', 'm65');
    assert.deepEqual(calls, [undefined, 'c1']);
    resolveOlder(historyPage(60, 80, 'c2', true));
    assert.equal(await navigation, true);
    assert.deepEqual(calls, [undefined, 'c1']);
    store.destroy();
});

test('reply navigation reports honest page and message progress while an older target loads', async () => {
    installWindowTimers();
    const resolvers: Array<(result: Result<ThreadMessages>) => void> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => !payload.cursor
        ? Promise.resolve(historyPage(80, 120, 'c1', true))
        : new Promise(resolve => { resolvers.push(resolve); }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    const navigation = store.navigateToReply('a', 'm50');
    assert.deepEqual(store.state.histories.a.replyNavigation, {
        requestId: 1, targetId: 'm50', status: 'loading', pagesLoaded: 0, messagesLoaded: 0,
    });
    resolvers.shift()!(historyPage(60, 80, 'c2', true));
    await settle();
    assert.deepEqual(store.state.histories.a.replyNavigation, {
        requestId: 1, targetId: 'm50', status: 'loading', pagesLoaded: 1, messagesLoaded: 20,
    });
    resolvers.shift()!(historyPage(40, 60, 'c3', true));
    assert.equal(await navigation, true);
    store.destroy();
});

test('visible reply prefetch is serialized, bounded, and reused by priority navigation', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    let resolveOlder!: (result: Result<ThreadMessages>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => {
        calls.push(payload.cursor);
        if (!payload.cursor) return Promise.resolve(historyPage(80, 120, 'c1', true));
        return new Promise(resolve => { resolveOlder = resolve; });
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    store.prefetchReplyTargets('a', ['m65', 'm10', 'm9', 'm8', 'm7', 'm6']);
    assert.deepEqual(calls, [undefined, 'c1']);
    const navigation = store.navigateToReply('a', 'm65', 'm119');
    assert.deepEqual(calls, [undefined, 'c1']);
    resolveOlder(historyPage(60, 80, 'c2', true));
    assert.equal(await navigation, true);
    assert.equal(store.state.histories.a.replyReturnStack.at(-1), 'm119');
    assert.deepEqual(calls, [undefined, 'c1', 'c2']);
    store.destroy();
});

test('reply prefetch spends one page per visible target and serializes the four-target cap', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    const resolvers: Array<(result: Result<ThreadMessages>) => void> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => {
        calls.push(payload.cursor);
        if (!payload.cursor) return Promise.resolve(historyPage(80, 120, 'c1', true));
        return new Promise(resolve => { resolvers.push(resolve); });
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    store.prefetchReplyTargets('a', ['missing-1', 'missing-2', 'missing-3', 'missing-4', 'missing-5']);
    assert.deepEqual(calls, [undefined, 'c1']);
    resolvers.shift()!(historyPage(60, 80, 'c2', true));
    await settle();
    assert.deepEqual(calls, [undefined, 'c1', 'c2']);
    resolvers.shift()!(historyPage(40, 60, 'c3', true));
    await settle();
    assert.deepEqual(calls, [undefined, 'c1', 'c2', 'c3']);
    resolvers.shift()!(historyPage(20, 40, 'c4', true));
    await settle();
    assert.deepEqual(calls, [undefined, 'c1', 'c2', 'c3', 'c4']);
    resolvers.shift()!(historyPage(0, 20, 'c5', true));
    await settle();
    assert.deepEqual(calls, [undefined, 'c1', 'c2', 'c3', 'c4']);

    // A single missing visible target never drains multiple cursors.
    store.prefetchReplyTargets('a', []);
    store.prefetchReplyTargets('a', ['still-missing']);
    await settle();
    assert.deepEqual(calls, [undefined, 'c1', 'c2', 'c3', 'c4', 'c5']);
    resolvers.shift()!(historyPage(0, 0, undefined, false));
    await settle();
    assert.equal(calls.length, 6);
    store.destroy();
});

test('reply prefetch cancellation prevents continuation after visibility or selection changes', async () => {
    installWindowTimers();
    for (const cancelWithSelection of [false, true]) {
        const calls: Array<{ threadKey: string; cursor?: string }> = [];
        let resolveOlder!: (result: Result<ThreadMessages>) => void;
        const rpc = fakeRpc(async () => ({
            ok: true,
            value: { items: [thread('a'), thread('b')], hasNextPage: false },
        }), payload => {
            calls.push(payload);
            if (!payload.cursor) return Promise.resolve(historyPage(80, 120, 'c1', true));
            return new Promise(resolve => { resolveOlder = resolve; });
        });
        const store = createFrontendStore(rpc);
        store.start();
        await settle();
        store.selectThread('a');
        await settle();
        store.prefetchReplyTargets('a', ['missing']);
        assert.equal(calls.filter(call => call.cursor).length, 1);
        if (cancelWithSelection) store.selectThread('b');
        else store.prefetchReplyTargets('a', []);
        resolveOlder(historyPage(60, 80, 'c2', true));
        await settle();
        assert.deepEqual(calls.filter(call => call.threadKey === 'a').map(call => call.cursor), [undefined, 'c1']);
        store.destroy();
    }
});

test('selection abandonment resolves explicit reply navigation false without UI or viewport commits', async () => {
    installWindowTimers();
    for (const abandonToInbox of [false, true]) {
        let resolveOlder!: (result: Result<ThreadMessages>) => void;
        const rpc = fakeRpc(async () => ({
            ok: true,
            value: { items: [thread('a'), thread('b')], hasNextPage: false },
        }), payload => {
            if (!payload.cursor) return Promise.resolve(historyPage(80, 120, 'c1', true));
            return new Promise(resolve => { resolveOlder = resolve; });
        });
        const store = createFrontendStore(rpc);
        store.start();
        await settle();
        store.selectThread('a');
        await settle();
        const beforeViewport = [...store.state.histories.a.viewportIds];
        const navigation = store.navigateToReply('a', 'm70', 'm119');
        if (abandonToInbox) store.showInbox();
        else store.selectThread('b');
        assert.equal(await navigation, false);
        assert.equal(store.state.histories.a.replyNavigation, undefined);
        resolveOlder(historyPage(60, 80, 'c2', true));
        await settle();
        assert.deepEqual(store.state.histories.a.viewportIds, beforeViewport);
        assert.deepEqual(store.state.histories.a.replyReturnStack, []);
        assert.equal(store.state.histories.a.replyNavigation, undefined);
        store.completeReplyNavigationPosition('a', 1);
        assert.equal(store.state.histories.a.replyNavigation, undefined);
        store.destroy();
    }
});

test('selection clears a ready reply focus intent before positioning acknowledgement', async () => {
    installWindowTimers();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), async () => historyPage(80, 120, 'c1', true));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    assert.equal(await store.navigateToReply('a', 'm90'), true);
    const requestId = store.state.histories.a.replyNavigation!.requestId;
    store.selectThread('b');
    assert.equal(store.state.histories.a.replyNavigation, undefined);
    store.completeReplyNavigationPosition('a', requestId);
    assert.equal(store.state.histories.a.replyNavigation, undefined);
    store.destroy();
});

test('reply return stack unwinds a chain before newest and failures do not corrupt it', async () => {
    installWindowTimers();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => historyPage(0, 120, undefined, false));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    assert.equal(await store.navigateToReply('a', 'm60', 'm110'), true);
    assert.equal(await store.navigateToReply('a', 'm20', 'm60'), true);
    assert.deepEqual(store.state.histories.a.replyReturnStack, ['m110', 'm60']);
    assert.equal(await store.navigateToReply('a', 'missing', 'm20'), false);
    assert.deepEqual(store.state.histories.a.replyReturnStack, ['m110', 'm60']);
    assert.equal(await store.returnFromReplyNavigation('a'), true);
    assert.equal(store.state.histories.a.replyNavigation?.targetId, 'm60');
    assert.equal(await store.returnFromReplyNavigation('a'), true);
    assert.equal(store.state.histories.a.replyNavigation?.targetId, 'm110');
    assert.deepEqual(store.state.histories.a.replyReturnStack, []);
    assert.equal(store.revealNewestHistory('a'), true);
    assert.deepEqual(store.state.histories.a.viewportIds, messageIds(80, 120));
    store.destroy();
});

test('rapid reply navigation is latest-wins while sharing older history work', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    let resolveOlder!: (result: Result<ThreadMessages>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => {
        calls.push(payload.cursor);
        if (!payload.cursor) return Promise.resolve(historyPage(80, 120, 'c1', true));
        return new Promise(resolve => { resolveOlder = resolve; });
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    const superseded = store.navigateToReply('a', 'm10');
    const latest = store.navigateToReply('a', 'm70');
    assert.deepEqual(calls, [undefined, 'c1']);
    resolveOlder(historyPage(60, 80, 'c2', true));
    assert.equal(await superseded, false);
    assert.equal(await latest, true);
    assert.deepEqual(store.state.histories.a.replyNavigation, {
        requestId: 2,
        targetId: 'm70',
        status: 'ready',
    });
    assert.deepEqual(calls, [undefined, 'c1']);
    store.destroy();
});

test('reply navigation transport failure waits for explicit retry', async () => {
    installWindowTimers();
    const calls: Array<string | undefined> = [];
    let olderAttempt = 0;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async payload => {
        calls.push(payload.cursor);
        if (!payload.cursor) return historyPage(80, 120, 'c1', true);
        olderAttempt++;
        return olderAttempt === 1
            ? { ok: false, error: { message: 'transport unavailable' } }
            : historyPage(60, 80, 'c2', true);
    });
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    assert.equal(await store.navigateToReply('a', 'm70', 'm119'), false);
    assert.deepEqual(calls, [undefined, 'c1']);
    assert.deepEqual(store.state.histories.a.replyNavigation, {
        requestId: 1,
        targetId: 'm70',
        returnId: 'm119',
        status: 'error',
        error: 'transport unavailable',
    });
    await settle();
    assert.deepEqual(calls, [undefined, 'c1']);

    assert.deepEqual(store.state.histories.a.replyReturnStack, []);
    assert.equal(await store.navigateToReply(
        'a',
        'm70',
        store.state.histories.a.replyNavigation?.returnId,
    ), true);
    assert.deepEqual(calls, [undefined, 'c1', 'c1']);
    assert.deepEqual(store.state.histories.a.replyReturnStack, ['m119']);
    store.destroy();
});

test('destroy releases reply navigation waiting on older history and ignores its completion', async () => {
    installWindowTimers();
    let resolveOlder!: (result: Result<ThreadMessages>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => !payload.cursor
        ? Promise.resolve(historyPage(80, 120, 'c1', true))
        : new Promise(resolve => { resolveOlder = resolve; }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    store.revealOlderHistory('a', true);
    const navigation = store.navigateToReply('a', 'm70');
    store.destroy();
    assert.equal(await navigation, false);
    resolveOlder(historyPage(60, 80, 'c2', true));
    await settle();
    assert.equal(store.state.histories.a.byId.m70, undefined);
});

test('destroy resolves direct-owner reply navigation even when its older RPC never settles', async () => {
    installWindowTimers();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => !payload.cursor
        ? Promise.resolve(historyPage(80, 120, 'c1', true))
        : new Promise<Result<ThreadMessages>>(() => undefined));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    const navigation = store.navigateToReply('a', 'm10');
    store.destroy();
    assert.equal(await navigation, false);
    assert.equal(store.state.histories.a.byId.m10, undefined);
});

test('optimistic send retries one row and reconciles every normalized index', async () => {
    installWindowTimers();
    let sendAttempt = 0;
    let resolveRetry!: (result: Result<SentTextMessage>) => void;
    const sendCalls: Parameters<CompleteUiRpc['sendText']>[0][] = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('p'), thread('a'), thread('b')], hasNextPage: false },
    }), async payload => payload.threadKey === 'a'
        ? historyPage(0, 80, 'server-cursor', true)
        : emptyHistory(), async () => ({ pinned: ['p'] }), async payload => {
        sendCalls.push(payload);
        sendAttempt++;
        if (sendAttempt === 1) return { ok: false, error: { message: 'offline' } };
        return new Promise(resolve => { resolveRetry = resolve; });
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.revealOlderHistory('a');
    store.completeHistoryReplacement('a');
    store.setDraft('a', '  hello  ');
    assert.equal(store.setReplyTarget('a', 'm79'), true);
    const localId = store.sendText('a', store.state.histories.a.draft, {
        followNewest: true,
    });
    assert.ok(localId);
    assert.equal(store.state.histories.a.listedIds.filter(id => id === localId).length, 1);
    assert.equal(store.state.histories.a.viewportIds.length, 80);
    assert.equal(store.state.histories.a.draft, '');
    assert.equal(store.state.histories.a.replyTargetId, undefined);
    assert.equal(store.state.histories.a.byId[localId].kind, 'text');
    assert.equal(store.state.histories.a.byId[localId].repliedTo, 'm79');
    assert.deepEqual(store.orderedThreadIds(), ['p', 'a', 'b']);
    assert.equal(store.state.inbox.byId.a.lastMessage?.id, localId);
    const offlineThreadingId = sendCalls[0].offlineThreadingId;
    assert.match(offlineThreadingId, /^\d{19}$/);
    assert.ok(BigInt(offlineThreadingId) >= 1_000_000_000_000_000_000n);
    assert.ok(BigInt(offlineThreadingId) <= 9_223_372_036_854_775_807n);

    await settle();
    assert.equal(store.state.histories.a.failedSends[localId].error, 'offline');
    assert.equal(store.retrySend('a', localId), true);
    assert.equal(sendCalls[1].offlineThreadingId, sendCalls[0].offlineThreadingId);
    assert.equal(store.state.histories.a.listedIds.filter(id => id === localId).length, 1);

    const history = store.state.histories.a;
    history.byId.server = { ...history.byId[localId], id: 'server', ts: 10 };
    const localListedIndex = history.listedIds.indexOf(localId);
    const localViewportIndex = history.viewportIds.indexOf(localId);
    history.listedIds.unshift('server');
    history.viewportIds.unshift('server');
    resolveRetry({
        ok: true,
        value: { messageId: 'server', timestampMs: 1234, clientRequestId: 'request' },
    });
    await settle();
    assert.equal(history.byId[localId], undefined);
    assert.equal(history.byId.server.ts, 1234);
    assert.equal(history.listedIds.filter(id => id === 'server').length, 1);
    assert.equal(history.viewportIds.filter(id => id === 'server').length, 1);
    assert.equal(history.listedIds.indexOf('server'), localListedIndex);
    assert.equal(history.viewportIds.indexOf('server'), localViewportIndex);
    assert.equal(history.viewportIds.length <= 80, true);
    assert.equal(history.pendingSends[localId], undefined);
    assert.equal(history.failedSends[localId], undefined);
    assert.equal(store.messageRowKey('a', 'server'), localId);
    assert.equal(store.state.inbox.byId.a.lastMessage?.id, 'server');
    assert.equal(store.state.inbox.byId.a.lastActivityMs, 1234);
    assert.deepEqual(store.state.inbox.orderedIds, ['a', 'p', 'b']);
    store.destroy();
});

test('sending while genuinely away from newest preserves the viewport and history cursor', async () => {
    installWindowTimers();
    let resolveSend!: (result: Result<SentTextMessage>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => historyPage(0, 120, 'older', true), undefined, () =>
        new Promise(resolve => { resolveSend = resolve; }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.revealOlderHistory('a');
    store.completeHistoryReplacement('a');
    store.revealOlderHistory('a');
    store.completeHistoryReplacement('a');
    const history = store.state.histories.a;
    const viewport = [...history.viewportIds];
    assert.equal(viewport.at(-1), 'm79');
    const localId = store.sendText('a', 'sent from older history', { followNewest: false });
    assert.ok(localId);
    assert.deepEqual(history.viewportIds, viewport);
    assert.equal(history.cursor, 'older');
    resolveSend({
        ok: true,
        value: { messageId: 'server-away', timestampMs: 500, clientRequestId: 'request' },
    });
    await settle();
    assert.deepEqual(history.viewportIds, viewport);
    assert.equal(history.cursor, 'older');
    assert.equal(history.viewportIds.length <= 80, true);
    assert.equal(store.messageRowKey('a', 'server-away'), localId);
    store.destroy();
});

test('sending while scrolled up in the latest full window preserves viewport and anchor', async () => {
    installWindowTimers();
    let resolveSend!: (result: Result<SentTextMessage>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => historyPage(0, 120, undefined, false), undefined, () =>
        new Promise(resolve => { resolveSend = resolve; }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.revealOlderHistory('a');
    store.completeHistoryReplacement('a');

    const history = store.state.histories.a;
    const viewport = history.viewportIds;
    const anchor = { id: 'm60', offset: 18 };
    store.saveHistoryAnchor('a', anchor);
    assert.equal(viewport.length, 80);
    assert.equal(viewport.at(-1), history.listedIds.at(-1));

    const localId = store.sendText('a', 'do not jump', { followNewest: false });
    assert.ok(localId);
    assert.equal(history.listedIds.at(-1), localId);
    assert.equal(history.viewportIds, viewport);
    assert.equal(history.scrollAnchor, anchor);

    resolveSend({
        ok: true,
        value: { messageId: 'server-no-jump', timestampMs: 500, clientRequestId: 'request' },
    });
    await settle();
    assert.equal(history.listedIds.at(-1), 'server-no-jump');
    assert.equal(history.viewportIds, viewport);
    assert.equal(history.scrollAnchor, anchor);
    store.destroy();
});

test('failed sends can be removed and late send completions after destroy are ignored', async () => {
    installWindowTimers();
    let resolveSend!: (result: Result<SentTextMessage>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), async () => historyPage(0, 1, undefined, false), undefined, async payload => {
        if (payload.text === 'from a') return { ok: false, error: { message: 'remove me' } };
        return new Promise(resolve => { resolveSend = resolve; });
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.selectThread('a');
    store.selectThread('b');
    await settle();
    store.setDraft('a', 'draft a');
    store.setDraft('b', 'draft b');
    store.setReplyTarget('a', 'm0');
    assert.equal(store.state.histories.a.draft, 'draft a');
    assert.equal(store.state.histories.b.draft, 'draft b');
    assert.equal(store.state.histories.a.replyTargetId, 'm0');
    assert.equal(store.state.histories.b.replyTargetId, undefined);
    const localId = store.sendText('a', 'from a', { followNewest: true });
    const otherLocalId = store.sendText('b', 'from b', { followNewest: true });
    assert.ok(localId && otherLocalId && localId !== otherLocalId);
    assert.match(localId, /^local:\d{19}$/);
    assert.match(otherLocalId, /^local:\d{19}$/);
    assert.notEqual(localId.slice('local:'.length), otherLocalId.slice('local:'.length));
    await settle();
    assert.equal(store.removeFailedSend('a', localId), true);
    assert.equal(store.state.histories.a.byId[localId], undefined);
    assert.equal(store.state.histories.a.listedIds.includes(localId), false);
    store.destroy();
    resolveSend({
        ok: true,
        value: { messageId: 'late', timestampMs: 99, clientRequestId: 'late' },
    });
    await settle();
    assert.equal(store.state.histories.b.byId.late, undefined);
    assert.equal(store.state.histories.a.byId[localId], undefined);
    assert.ok(store.state.histories.b.byId[otherLocalId]);
});

test('reactions are server-only, per-thread single-flight, authoritative, and rollback safely', async () => {
    installWindowTimers();
    const reactionCalls: Parameters<CompleteUiRpc['setReaction']>[0][] = [];
    const resolvers: Array<(result: Result<SetReactionResult>) => void> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), async () => ({
        ok: true,
        value: {
            items: [{
                kind: 'text', id: 'same', senderId: 'sender', ts: 1, text: 'message',
                reactions: [{ senderId: 'viewer', reaction: '❤' }],
            }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    }), undefined, undefined, async payload => {
        reactionCalls.push(payload);
        return new Promise(resolve => resolvers.push(resolve));
    });
    const store = createFrontendStore(rpc);

    store.start();
    await settle();
    store.selectThread('a');
    store.selectThread('b');
    await settle();
    const order = [...store.state.inbox.orderedIds];
    const removeFlight = store.setReaction('a', 'same', '❤');
    assert.deepEqual(store.state.histories.a.byId.same.reactions, []);
    assert.deepEqual(reactionCalls[0], {
        threadFbid: '1', messageId: 'same', emoji: '❤', remove: true,
    });
    resolvers[0]({ ok: true, value: { messageId: 'same', reactions: [] } });
    assert.equal(await removeFlight, true);
    const aFlight = store.setReaction('a', 'same', '😂');
    const duplicate = await store.setReaction('a', 'same', '😮');
    const bFlight = store.setReaction('b', 'same', '👍');
    assert.equal(duplicate, false);
    assert.equal(reactionCalls.length, 3);
    assert.equal(reactionCalls[1].remove, false);
    assert.equal(firstReaction(store.state.histories.a.byId.same), '😂');
    assert.equal(firstReaction(store.state.histories.b.byId.same), '👍');
    assert.deepEqual(store.state.inbox.orderedIds, order);

    resolvers[1]({ ok: false, error: { message: 'reaction failed' } });
    resolvers[2]({
        ok: true,
        value: {
            messageId: 'same',
            reactions: [{ senderId: 'viewer', reaction: 'SERVER' }],
        },
    });
    assert.equal(await aFlight, false);
    assert.equal(await bFlight, true);
    assert.deepEqual(store.state.histories.a.byId.same.reactions, []);
    assert.equal(store.state.histories.a.reactionMutations.same.status, 'error');
    assert.equal(firstReaction(store.state.histories.b.byId.same), 'SERVER');
    assert.equal(store.state.histories.b.reactionMutations.same, undefined);

    const retry = store.setReaction('a', 'same', '😮');
    assert.equal(firstReaction(store.state.histories.a.byId.same), '😮');
    resolvers[3]({
        ok: true,
        value: {
            messageId: 'same',
            reactions: [{ senderId: 'viewer', reaction: 'AUTHORITATIVE' }],
        },
    });
    assert.equal(await retry, true);
    assert.equal(firstReaction(store.state.histories.a.byId.same), 'AUTHORITATIVE');

    const localId = store.sendText('a', 'pending', { followNewest: true });
    assert.ok(localId);
    assert.equal(await store.setReaction('a', localId, '❤'), false);
    assert.equal(reactionCalls.length, 4);
    store.destroy();
});

test('older history reads preserve an optimistic reaction and become its rollback baseline', async () => {
    installWindowTimers();
    let resolveOlder!: (result: Result<ThreadMessages>) => void;
    let resolveReaction!: (result: Result<SetReactionResult>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => {
        if (!payload.cursor) return Promise.resolve({
            ok: true,
            value: {
                items: [{
                    kind: 'text', id: 'target', senderId: 'sender', ts: 2, text: 'target',
                    reactions: [{ senderId: 'viewer', reaction: 'OLD' }],
                }],
                cursor: 'older', hasNextPage: true, viewerId: 'viewer',
            },
        });
        return new Promise(resolve => { resolveOlder = resolve; });
    }, undefined, undefined, () =>
        new Promise(resolve => { resolveReaction = resolve; }));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    const flight = store.setReaction('a', 'target', 'OPTIMISTIC');
    store.revealOlderHistory('a');
    resolveOlder({
        ok: true,
        value: {
            items: [{
                kind: 'text', id: 'target', senderId: 'sender', ts: 2, text: 'refreshed',
                reactions: [
                    { senderId: 'other', reaction: 'OTHER' },
                    { senderId: 'viewer', reaction: 'READ' },
                ],
            }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    });
    await settle();
    assert.deepEqual(
        store.state.histories.a.byId.target.reactions?.map(reaction => reaction.reaction),
        ['OTHER', 'OPTIMISTIC'],
    );
    resolveReaction({ ok: false, error: { message: 'failed' } });
    assert.equal(await flight, false);
    assert.equal(store.state.histories.a.byId.target.kind, 'text');
    assert.equal(
        store.state.histories.a.byId.target.kind === 'text'
            ? store.state.histories.a.byId.target.text
            : undefined,
        'refreshed',
    );
    assert.deepEqual(
        store.state.histories.a.byId.target.reactions?.map(reaction => reaction.reaction),
        ['OTHER', 'READ'],
    );
    store.destroy();
});

test('pending reaction removal stays absent and a failure restores the refreshed read', async () => {
    installWindowTimers();
    let resolveOlder!: (result: Result<ThreadMessages>) => void;
    let resolveReaction!: (result: Result<SetReactionResult>) => void;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), payload => payload.cursor
        ? new Promise(resolve => { resolveOlder = resolve; })
        : Promise.resolve({
            ok: true,
            value: {
                items: [{
                    kind: 'text', id: 'target', senderId: 'sender', ts: 2, text: 'target',
                    reactions: [{ senderId: 'viewer', reaction: '❤', timestampMs: 1 }],
                }],
                cursor: 'older', hasNextPage: true, viewerId: 'viewer',
            },
        }), undefined, undefined, () =>
        new Promise(resolve => { resolveReaction = resolve; }));
    const store = createFrontendStore(rpc, { incomingSync: false });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();

    const removal = store.setReaction('a', 'target', '❤');
    store.revealOlderHistory('a', true);
    await settle();
    resolveOlder({
        ok: true,
        value: {
            items: [{
                kind: 'text', id: 'target', senderId: 'sender', ts: 2, text: 'refreshed',
                reactions: [
                    { senderId: 'peer', reaction: '🔥' },
                    { senderId: 'viewer', reaction: '❤', timestampMs: 2 },
                ],
            }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    });
    await settle();
    assert.deepEqual(
        store.state.histories.a.byId.target.reactions?.map(reaction => reaction.senderId),
        ['peer'],
    );

    resolveReaction({ ok: false, error: { message: 'failed removal' } });
    assert.equal(await removal, false);
    assert.deepEqual(
        store.state.histories.a.byId.target.reactions?.map(reaction => reaction.reaction),
        ['🔥', '❤'],
    );
    assert.equal(
        store.state.histories.a.byId.target.reactions?.find(
            reaction => reaction.senderId === 'viewer',
        )?.timestampMs,
        2,
    );
    store.destroy();
});

test('a mismatched reaction receipt rolls back, and completion after destroy is ignored', async () => {
    installWindowTimers();
    const resolvers: Array<(result: Result<SetReactionResult>) => void> = [];
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => ({
        ok: true,
        value: {
            items: [{
                kind: 'text', id: 'target', senderId: 'sender', ts: 1, text: 'target',
                reactions: [{ senderId: 'viewer', reaction: 'OLD' }],
            }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    }), undefined, undefined, () =>
        new Promise(resolve => resolvers.push(resolve)));
    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    const mismatch = store.setReaction('a', 'target', 'NEW');
    resolvers[0]({
        ok: true,
        value: { messageId: 'wrong', reactions: [{ senderId: 'viewer', reaction: 'SERVER' }] },
    });
    assert.equal(await mismatch, false);
    assert.equal(store.state.histories.a.byId.target.reactions?.[0].reaction, 'OLD');
    assert.match(store.state.histories.a.reactionMutations.target.error ?? '', /did not match/);

    const late = store.setReaction('a', 'target', 'LATE');
    assert.equal(store.state.histories.a.byId.target.reactions?.[0].reaction, 'LATE');
    store.destroy();
    resolvers[1]({
        ok: true,
        value: { messageId: 'target', reactions: [{ senderId: 'viewer', reaction: 'SERVER' }] },
    });
    assert.equal(await late, false);
    assert.equal(store.state.histories.a.byId.target.reactions?.[0].reaction, 'LATE');
});

test('reel shares preload with a bounded deduped cache while comments and mutations stay intent-driven', async () => {
    installWindowTimers();
    const mediaCalls: string[] = [];
    let commentCalls = 0;
    const reelMessages = Array.from({ length: 10 }, (_, index): Message => ({
        kind: 'reel_share',
        mediaType: 'reel',
        id: `message-${index}`,
        senderId: 'sender',
        ts: index,
        shortcode: `S${index}`,
        mediaId: String(1000 + index),
        targetUrl: `https://www.instagram.com/reel/S${index}/`,
        thumbUrl: 'https://cdn.example/thumb.jpg',
        author: 'alice',
    }));
    reelMessages.push({ ...reelMessages[0], id: 'duplicate-share' });
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => ({
        ok: true,
        value: { items: reelMessages, hasNextPage: false, viewerId: 'viewer' },
    }));
    rpc.getReelMedia = async payload => {
        mediaCalls.push(payload.shortcode);
        return {
            ok: true,
            value: {
                id: payload.mediaId!,
                shortcode: payload.shortcode,
                mediaType: 'reel',
                author: {
                    id: 'owner', username: 'alice', fullName: 'Alice', picUrl: null,
                    isVerified: false,
                },
                items: [{
                    id: payload.mediaId!, kind: 'video',
                    videoUrl: 'https://cdn.example/video.mp4',
                    variants: [{ url: 'https://cdn.example/video.mp4' }],
                    posterUrl: 'https://cdn.example/poster.jpg', durationSec: 5,
                    width: 720, height: 1280,
                    canDownload: true,
                }],
                likeCount: 4,
                commentCount: 1,
                hasLiked: false,
                hasSaved: false,
                canSave: true,
                canDownload: true,
            },
        };
    };
    rpc.getReelComments = async () => {
        commentCalls++;
        return {
            ok: true,
            value: {
                items: [{
                    id: 'comment', text: 'hello', createdAtMs: 1,
                    likeCount: 0, hasLiked: false, childCommentCount: 0,
                    author: {
                        id: 'commenter', username: 'bob', fullName: 'Bob', picUrl: null,
                        isVerified: false,
                    },
                }],
                hasNextPage: false,
            },
        };
    };
    rpc.setReelLiked = async payload => ({
        ok: true,
        value: { mediaId: payload.mediaId, hasLiked: payload.liked },
    });
    rpc.setReelSaved = async () => ({ ok: false, error: { message: 'save failed' } });

    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    for (let index = 0; index < 12; index++) await settle();

    assert.equal(mediaCalls.length, 8);
    assert.equal(new Set(mediaCalls).size, 8);
    assert.equal(commentCalls, 0);
    assert.equal(store.state.reels.byId.S0.media?.items[0]?.kind, 'video');

    assert.equal(await store.openReel('S0', '1000'), true);
    assert.equal(commentCalls, 1);
    assert.deepEqual(store.state.reels.byId.S0.comments.listedIds, ['comment']);
    assert.equal(await store.toggleReelLiked('S0'), true);
    assert.equal(store.state.reels.byId.S0.media?.hasLiked, true);
    assert.equal(store.state.reels.byId.S0.media?.likeCount, 5);
    assert.equal(await store.toggleReelSaved('S0'), false);
    assert.equal(store.state.reels.byId.S0.media?.hasSaved, false);
    assert.match(store.state.reels.byId.S0.saveMutation?.error ?? '', /save failed/);
    store.destroy();
});

test('visible reel priority moves queued media ahead without duplicating active or open requests', async () => {
    installWindowTimers();
    const reelMessages = Array.from({ length: 12 }, (_, index): Message => ({
        kind: 'reel_share',
        mediaType: 'reel',
        id: `priority-message-${index}`,
        senderId: 'sender',
        ts: index,
        shortcode: `P${index}`,
        mediaId: String(2000 + index),
        targetUrl: `https://www.instagram.com/reel/P${index}/`,
        thumbUrl: 'https://cdn.example/thumb.jpg',
        author: 'alice',
    }));
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => ({
        ok: true,
        value: { items: reelMessages, hasNextPage: false, viewerId: 'viewer' },
    }));
    const calls: string[] = [];
    const resolvers = new Map<string, (value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void>();
    rpc.getReelMedia = async payload => {
        calls.push(payload.shortcode);
        return new Promise(resolve => resolvers.set(payload.shortcode, resolve));
    };
    rpc.getReelComments = async () => ({ ok: true, value: { items: [], hasNextPage: false } });

    const store = createFrontendStore(rpc);
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    assert.deepEqual(calls, ['P0', 'P1']);

    store.prioritizeReelPreloads(['P10']);
    resolvers.get('P0')!({ ok: true, value: reelMedia('P0', '2000', 'https://cdn/P0.mp4') });
    resolvers.delete('P0');
    await settle();
    assert.deepEqual(calls, ['P0', 'P1', 'P10']);

    const opening = store.openReel('P1', '2001');
    assert.equal(calls.filter(shortcode => shortcode === 'P1').length, 1);
    resolvers.get('P1')!({ ok: true, value: reelMedia('P1', '2001', 'https://cdn/P1.mp4') });
    resolvers.delete('P1');
    assert.equal(await opening, true);
    assert.equal(calls.filter(shortcode => shortcode === 'P1').length, 1);
    assert.equal(store.state.reels.byId.P1.comments.status, 'ready');
    while (calls.length < 8) {
        const shortcode = calls.find(candidate => resolvers.has(candidate));
        assert.ok(shortcode);
        resolvers.get(shortcode)!({
            ok: true,
            value: reelMedia(shortcode, String(2000 + Number(shortcode.slice(1))), `https://cdn/${shortcode}.mp4`),
        });
        resolvers.delete(shortcode);
        await settle();
    }
    assert.equal(calls.length, 8);
    assert.ok(calls.includes('P10'));
    assert.equal(calls.includes('P7'), false, 'visible reel should displace the last unstarted preload');
    store.destroy();
});

test('reel opens join one deferred media flight and close gates comments without discarding a started page', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    let mediaCalls = 0;
    let resolveMedia!: (value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void;
    rpc.getReelMedia = async () => {
        mediaCalls++;
        return new Promise(resolve => { resolveMedia = resolve; });
    };
    let commentCalls = 0;
    let resolveComments!: (value: Awaited<ReturnType<CompleteUiRpc['getReelComments']>>) => void;
    rpc.getReelComments = async () => {
        commentCalls++;
        return new Promise(resolve => { resolveComments = resolve; });
    };
    const store = createFrontendStore(rpc);
    const first = store.openReel('ABC', '100');
    const joined = store.openReel('ABC', '100');
    assert.equal(mediaCalls, 1);
    store.closeReel();
    resolveMedia({ ok: true, value: reelMedia('ABC', '100', 'https://cdn/old.mp4') });
    assert.equal(await first, false);
    assert.equal(await joined, false);
    assert.equal(commentCalls, 0);

    const opened = store.openReel('ABC', '100');
    await settle();
    assert.equal(commentCalls, 1);
    store.closeReel();
    resolveComments({ ok: true, value: { items: [], hasNextPage: false } });
    assert.equal(await opened, true);
    assert.equal(store.state.reels.byId.ABC.comments.status, 'ready');
    store.destroy();
});

test('reel comment pagination merges pages and failure-gates a cursor until retry', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    rpc.getReelMedia = async payload => ({
        ok: true,
        value: reelMedia(payload.shortcode, payload.mediaId!, 'https://cdn/reel.mp4'),
    });
    const cursors: Array<string | undefined> = [];
    let failedPage = true;
    const comment = (id: string) => ({
        id,
        text: id,
        createdAtMs: 1,
        likeCount: 0,
        hasLiked: false,
        childCommentCount: 0,
        author: {
            id: `author-${id}`,
            username: `author_${id}`,
            fullName: id,
            picUrl: null,
            isVerified: false,
        },
    });
    rpc.getReelComments = async payload => {
        cursors.push(payload.cursor);
        if (!payload.cursor) return {
            ok: true,
            value: { items: [comment('a')], cursor: 'cursor-1', hasNextPage: true },
        };
        if (failedPage) {
            failedPage = false;
            return { ok: false, error: { message: 'page failed' } };
        }
        return {
            ok: true,
            value: { items: [comment('a'), comment('b')], hasNextPage: false },
        };
    };

    const store = createFrontendStore(rpc);
    assert.equal(await store.openReel('ABC', '100'), true);
    assert.equal(await store.loadNextReelComments('ABC'), false);
    assert.equal(store.state.reels.byId.ABC.comments.failedCursor, 'cursor-1');
    assert.equal(await store.loadNextReelComments('ABC'), false);
    assert.deepEqual(cursors, [undefined, 'cursor-1']);

    assert.equal(await store.retryReelComments('ABC'), true);
    assert.deepEqual(cursors, [undefined, 'cursor-1', 'cursor-1']);
    assert.deepEqual(store.state.reels.byId.ABC.comments.listedIds, ['a', 'b']);
    assert.equal(store.state.reels.byId.ABC.comments.hasNextPage, false);
    assert.equal(store.state.reels.byId.ABC.comments.error, undefined);
    store.destroy();
});

test('successful media retry starts comments only while that reel remains active', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    let mediaAttempt = 0;
    let resolveRetry!: (value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void;
    rpc.getReelMedia = async payload => {
        mediaAttempt++;
        if (mediaAttempt === 1 || mediaAttempt === 3)
            return { ok: false, error: { message: 'expired media' } };
        if (mediaAttempt === 4)
            return new Promise(resolve => { resolveRetry = resolve; });
        return { ok: true, value: reelMedia(payload.shortcode, payload.mediaId!, 'https://cdn/fresh.mp4') };
    };
    let commentCalls = 0;
    rpc.getReelComments = async () => {
        commentCalls++;
        return { ok: true, value: { items: [], hasNextPage: false } };
    };
    const store = createFrontendStore(rpc);

    assert.equal(await store.openReel('ABC', '100'), false);
    assert.ok(await store.retryReel('ABC'));
    assert.equal(commentCalls, 1);

    assert.equal(await store.openReel('DEF', '200'), false);
    const retry = store.retryReel('DEF');
    store.closeReel();
    resolveRetry({ ok: true, value: reelMedia('DEF', '200', 'https://cdn/fresh-2.mp4') });
    assert.ok(await retry);
    assert.equal(commentCalls, 1);
    store.destroy();
});

test('joined failed media retries do not treat retained cached media as refresh success', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    let mediaCalls = 0;
    let resolveRefresh!: (value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void;
    rpc.getReelMedia = async payload => {
        mediaCalls++;
        if (mediaCalls === 1)
            return { ok: true, value: reelMedia(payload.shortcode, payload.mediaId!, 'https://cdn/expired.mp4') };
        return new Promise(resolve => { resolveRefresh = resolve; });
    };
    let commentCalls = 0;
    rpc.getReelComments = async () => {
        commentCalls++;
        return { ok: false, error: { message: 'comments unavailable' } };
    };
    const store = createFrontendStore(rpc);
    assert.equal(await store.openReel('ABC', '100'), false);
    assert.equal(commentCalls, 1);

    const firstRetry = store.retryReel('ABC');
    const joinedRetry = store.retryReel('ABC');
    assert.equal(mediaCalls, 2);
    resolveRefresh({ ok: false, error: { message: 'still expired' } });
    assert.equal(await firstRetry, undefined);
    assert.equal(await joinedRetry, undefined);
    assert.equal(commentCalls, 1);
    assert.equal(store.state.reels.byId.ABC.media?.items[0].kind, 'video');
    assert.equal(store.state.reels.byId.ABC.status, 'error');
    store.destroy();
});

test('reel responses are identity checked, retries refresh URLs, and duplicate mutations are single-flight', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    let mediaCalls = 0;
    rpc.getReelMedia = async payload => ({
        ok: true,
        value: reelMedia(
            payload.shortcode,
            payload.mediaId!,
            mediaCalls++ === 0 ? 'https://cdn/expired.mp4' : 'https://cdn/fresh.mp4',
        ),
    });
    rpc.getReelComments = async () => ({ ok: true, value: { items: [], hasNextPage: false } });
    let likeCalls = 0;
    let resolveLike!: (value: Awaited<ReturnType<CompleteUiRpc['setReelLiked']>>) => void;
    rpc.setReelLiked = async () => {
        likeCalls++;
        return new Promise(resolve => { resolveLike = resolve; });
    };
    let saveCalls = 0;
    let resolveSave!: (value: Awaited<ReturnType<CompleteUiRpc['setReelSaved']>>) => void;
    rpc.setReelSaved = async () => {
        saveCalls++;
        return new Promise(resolve => { resolveSave = resolve; });
    };
    const store = createFrontendStore(rpc);
    assert.equal(await store.openReel('ABC', '100'), true);
    assert.equal(store.state.reels.byId.ABC.media?.items[0]?.downloadUrl, 'https://cdn/expired.mp4');
    const refresh = store.retryReel('ABC');
    const joinedRefresh = store.retryReel('ABC');
    await refresh;
    await joinedRefresh;
    assert.equal(mediaCalls, 2);
    assert.equal(store.state.reels.byId.ABC.media?.items[0]?.downloadUrl, 'https://cdn/fresh.mp4');

    const like = store.toggleReelLiked('ABC');
    assert.equal(await store.toggleReelLiked('ABC'), false);
    assert.equal(likeCalls, 1);
    resolveLike({ ok: true, value: { mediaId: '999', hasLiked: true } });
    assert.equal(await like, false);
    assert.equal(store.state.reels.byId.ABC.media?.hasLiked, false);
    const save = store.toggleReelSaved('ABC');
    assert.equal(await store.toggleReelSaved('ABC'), false);
    assert.equal(saveCalls, 1);
    resolveSave({ ok: true, value: { mediaId: '100', hasSaved: true } });
    assert.equal(await save, true);
    store.destroy();

    const mismatchRpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    mismatchRpc.getReelMedia = async () => ({
        ok: true, value: reelMedia('WRONG', '999', 'https://cdn/wrong.mp4'),
    });
    const mismatchStore = createFrontendStore(mismatchRpc);
    assert.equal(await mismatchStore.openReel('ABC', '100'), false);
    assert.equal(mismatchStore.state.reels.byId.ABC.media, undefined);
    assert.match(mismatchStore.state.reels.byId.ABC.error ?? '', /identity did not match/);
    mismatchStore.destroy();
});

test('reel refreshes reconcile pending, successful, and failed like/save mutations', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    const mediaResolvers: Array<(value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void> = [];
    let mediaCalls = 0;
    rpc.getReelMedia = async () => {
        if (mediaCalls++ === 0) {
            return {
                ok: true,
                value: { ...reelMedia('ABC', '100', 'https://cdn/initial.mp4'), likeCount: 10 },
            };
        }
        return new Promise(resolve => mediaResolvers.push(resolve));
    };
    rpc.getReelComments = async () => ({ ok: true, value: { items: [], hasNextPage: false } });

    const likeResolvers: Array<(value: Awaited<ReturnType<CompleteUiRpc['setReelLiked']>>) => void> = [];
    rpc.setReelLiked = async () => new Promise(resolve => likeResolvers.push(resolve));
    const saveResolvers: Array<(value: Awaited<ReturnType<CompleteUiRpc['setReelSaved']>>) => void> = [];
    rpc.setReelSaved = async () => new Promise(resolve => saveResolvers.push(resolve));

    const store = createFrontendStore(rpc);
    assert.equal(await store.openReel('ABC', '100'), true);

    // A receipt that wins the race remains authoritative over the older refresh response.
    const firstRefresh = store.retryReel('ABC');
    const like = store.toggleReelLiked('ABC');
    likeResolvers.shift()!({ ok: true, value: { mediaId: '100', hasLiked: true } });
    assert.equal(await like, true);
    mediaResolvers.shift()!({
        ok: true,
        value: {
            ...reelMedia('ABC', '100', 'https://cdn/refreshed-after-like.mp4'),
            likeCount: 10,
            commentCount: 20,
        },
    });
    await firstRefresh;
    assert.equal(store.state.reels.byId.ABC.media?.hasLiked, true);
    assert.equal(store.state.reels.byId.ABC.media?.likeCount, 11);
    assert.equal(store.state.reels.byId.ABC.media?.commentCount, 20);

    // A refresh that wins preserves pending save intent until its matching receipt settles.
    const save = store.toggleReelSaved('ABC');
    const secondRefresh = store.retryReel('ABC');
    mediaResolvers.shift()!({
        ok: true,
        value: {
            ...reelMedia('ABC', '100', 'https://cdn/refreshed-before-save.mp4'),
            hasLiked: true,
            likeCount: 11,
            hasSaved: false,
            commentCount: 30,
        },
    });
    await secondRefresh;
    assert.equal(store.state.reels.byId.ABC.media?.hasSaved, true);
    saveResolvers.shift()!({ ok: true, value: { mediaId: '100', hasSaved: true } });
    assert.equal(await save, true);
    assert.equal(store.state.reels.byId.ABC.media?.hasSaved, true);
    assert.equal(store.state.reels.byId.ABC.media?.commentCount, 30);

    // Failure restores the baseline supplied by the overlapping fresh read, including counts.
    const unlike = store.toggleReelLiked('ABC');
    const thirdRefresh = store.retryReel('ABC');
    mediaResolvers.shift()!({
        ok: true,
        value: {
            ...reelMedia('ABC', '100', 'https://cdn/refreshed-before-failure.mp4'),
            hasLiked: true,
            hasSaved: true,
            likeCount: 40,
            commentCount: 50,
        },
    });
    await thirdRefresh;
    assert.equal(store.state.reels.byId.ABC.media?.hasLiked, false);
    assert.equal(store.state.reels.byId.ABC.media?.likeCount, 39);
    likeResolvers.shift()!({ ok: false, error: { message: 'unlike failed' } });
    assert.equal(await unlike, false);
    assert.equal(store.state.reels.byId.ABC.media?.hasLiked, true);
    assert.equal(store.state.reels.byId.ABC.media?.likeCount, 40);
    assert.equal(store.state.reels.byId.ABC.media?.commentCount, 50);
    assert.match(store.state.reels.byId.ABC.likeMutation?.error ?? '', /unlike failed/);

    const unsave = store.toggleReelSaved('ABC');
    const fourthRefresh = store.retryReel('ABC');
    mediaResolvers.shift()!({
        ok: true,
        value: {
            ...reelMedia('ABC', '100', 'https://cdn/refreshed-before-save-failure.mp4'),
            hasLiked: true,
            hasSaved: true,
            likeCount: 40,
            commentCount: 60,
        },
    });
    await fourthRefresh;
    assert.equal(store.state.reels.byId.ABC.media?.hasSaved, false);
    saveResolvers.shift()!({ ok: false, error: { message: 'unsave failed' } });
    assert.equal(await unsave, false);
    assert.equal(store.state.reels.byId.ABC.media?.hasSaved, true);
    assert.equal(store.state.reels.byId.ABC.media?.commentCount, 60);
    assert.match(store.state.reels.byId.ABC.saveMutation?.error ?? '', /unsave failed/);
    store.destroy();
});

test('chained reel mutation failures retain receipts across older refreshes', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    const mediaResolvers: Array<(value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void> = [];
    let mediaCalls = 0;
    rpc.getReelMedia = async () => {
        if (mediaCalls++ === 0) return {
            ok: true,
            value: { ...reelMedia('ABC', '100', 'https://cdn/initial.mp4'), likeCount: 10 },
        };
        return new Promise(resolve => mediaResolvers.push(resolve));
    };
    rpc.getReelComments = async () => ({ ok: true, value: { items: [], hasNextPage: false } });
    const likeResolvers: Array<(value: Awaited<ReturnType<CompleteUiRpc['setReelLiked']>>) => void> = [];
    rpc.setReelLiked = async () => new Promise(resolve => likeResolvers.push(resolve));
    const saveResolvers: Array<(value: Awaited<ReturnType<CompleteUiRpc['setReelSaved']>>) => void> = [];
    rpc.setReelSaved = async () => new Promise(resolve => saveResolvers.push(resolve));

    const store = createFrontendStore(rpc);
    assert.equal(await store.openReel('ABC', '100'), true);

    // The refresh predates the like receipt, but settles during the unlike request.
    const likeRefresh = store.retryReel('ABC');
    const like = store.toggleReelLiked('ABC');
    likeResolvers.shift()!({ ok: true, value: { mediaId: '100', hasLiked: true } });
    assert.equal(await like, true);
    const unlike = store.toggleReelLiked('ABC');
    mediaResolvers.shift()!({
        ok: true,
        value: {
            ...reelMedia('ABC', '100', 'https://cdn/older-like-refresh.mp4'),
            likeCount: 10,
            commentCount: 70,
        },
    });
    await likeRefresh;
    assert.equal(store.state.reels.byId.ABC.media?.hasLiked, false);
    assert.equal(store.state.reels.byId.ABC.media?.likeCount, 10);
    likeResolvers.shift()!({ ok: false, error: { message: 'unlike failed' } });
    assert.equal(await unlike, false);
    assert.equal(store.state.reels.byId.ABC.media?.hasLiked, true);
    assert.equal(store.state.reels.byId.ABC.media?.likeCount, 11);
    assert.equal(store.state.reels.byId.ABC.media?.commentCount, 70);

    // Save receipts have the same ordering guarantee when an older read lands during unsave.
    const saveRefresh = store.retryReel('ABC');
    const save = store.toggleReelSaved('ABC');
    saveResolvers.shift()!({ ok: true, value: { mediaId: '100', hasSaved: true } });
    assert.equal(await save, true);
    const unsave = store.toggleReelSaved('ABC');
    mediaResolvers.shift()!({
        ok: true,
        value: {
            ...reelMedia('ABC', '100', 'https://cdn/older-save-refresh.mp4'),
            hasLiked: true,
            likeCount: 11,
            commentCount: 80,
        },
    });
    await saveRefresh;
    assert.equal(store.state.reels.byId.ABC.media?.hasSaved, false);
    saveResolvers.shift()!({ ok: false, error: { message: 'unsave failed' } });
    assert.equal(await unsave, false);
    assert.equal(store.state.reels.byId.ABC.media?.hasSaved, true);
    assert.equal(store.state.reels.byId.ABC.media?.commentCount, 80);
    store.destroy();
});

test('destroyed reel store ignores deferred completions', async () => {
    const rpc = fakeRpc(async () => ({ ok: true, value: { items: [], hasNextPage: false } }));
    let resolveMedia!: (value: Awaited<ReturnType<CompleteUiRpc['getReelMedia']>>) => void;
    rpc.getReelMedia = async () => new Promise(resolve => { resolveMedia = resolve; });
    const store = createFrontendStore(rpc);
    const opening = store.openReel('ABC', '100');
    store.destroy();
    resolveMedia({ ok: true, value: reelMedia('ABC', '100', 'https://cdn/late.mp4') });
    assert.equal(await opening, false);
    assert.equal(store.state.reels.byId.ABC.media, undefined);
});

test('incoming snapshots deduplicate, preserve pin order, reorder unpinned rows, and keep an older viewport', async () => {
    installWindowTimers();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b'), thread('c'), thread('d')], hasNextPage: false },
    }), async () => historyPage(0, 50, undefined, false), async () => ({ pinned: ['a', 'b'] }));
    const store = createFrontendStore(rpc, { incomingSync: false });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.revealOlderHistory('a');
    const history = store.state.histories.a;
    const viewport = [...history.viewportIds];
    const anchor = { id: viewport[2], offset: 17 };
    store.saveHistoryAnchor('a', anchor);

    const incoming: Message = {
        kind: 'text', id: 'incoming', senderId: 'peer', ts: 60, text: 'new',
    };
    store.applyIncomingSnapshot({
        kind: 'snapshot',
        threads: [
            { ...thread('d'), lastActivityMs: 60, lastMessage: incoming },
            { ...thread('c'), lastActivityMs: 50 },
            { ...thread('a'), lastActivityMs: 55 },
        ],
        history: {
            threadId: 'a', viewerId: 'viewer',
            messages: [incoming, { ...incoming, id: 'late-but-older', ts: 55 }],
        },
    });
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: { threadId: 'a', viewerId: 'viewer', messages: [incoming] },
    });

    assert.equal(history.listedIds.filter(id => id === 'incoming').length, 1);
    assert.deepEqual(history.listedIds.slice(-2), ['late-but-older', 'incoming']);
    assert.deepEqual(history.viewportIds, viewport);
    assert.equal(history.scrollAnchor, anchor);
    assert.deepEqual(store.orderedThreadIds(), ['a', 'b', 'd', 'c']);
    assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
    store.destroy();
});

test('incoming messages follow only a history measured at newest', async () => {
    installWindowTimers();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => historyPage(0, 80, undefined, false));
    const store = createFrontendStore(rpc, { incomingSync: false });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.setHistoryFollowingNewest('a', true);
    const history = store.state.histories.a;
    const version = history.incomingFollowVersion;
    const incoming: Message = {
        kind: 'text', id: 'incoming', senderId: 'peer', ts: 100, text: 'new',
    };
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: { threadId: 'a', viewerId: 'viewer', messages: [incoming] },
    });
    assert.equal(history.viewportIds.at(-1), 'incoming');
    assert.ok(history.viewportIds.length <= 40);
    assert.equal(history.incomingFollowVersion, version + 1);
    store.destroy();
});

test('reselecting a history requires a fresh newest measurement before following incoming data', async () => {
    installWindowTimers();
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a'), thread('b')], hasNextPage: false },
    }), async () => historyPage(0, 80, undefined, false));
    const store = createFrontendStore(rpc, { incomingSync: false });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    const history = store.state.histories.a;
    history.viewportIds = history.listedIds.slice(0, 40);
    const restoredViewport = [...history.viewportIds];
    const anchor = { id: restoredViewport[10], offset: 18 };
    store.saveHistoryAnchor('a', anchor);
    store.setHistoryFollowingNewest('a', true);

    store.selectThread('b');
    await settle();
    store.selectThread('a');
    assert.equal(history.isFollowingNewest, false);
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: {
            threadId: 'a', viewerId: 'viewer',
            messages: [{ kind: 'text', id: 'before-measure', senderId: 'peer', ts: 100, text: 'new' }],
        },
    });
    assert.deepEqual(history.viewportIds, restoredViewport);
    assert.equal(history.scrollAnchor, anchor);

    store.setHistoryFollowingNewest('a', true);
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: {
            threadId: 'a', viewerId: 'viewer',
            messages: [{ kind: 'text', id: 'after-measure', senderId: 'peer', ts: 101, text: 'newer' }],
        },
    });
    assert.equal(history.viewportIds.at(-1), 'after-measure');
    assert.ok(history.viewportIds.length <= 40);
    store.destroy();
});

test('selected-thread polling suppresses a server copy until an optimistic send settles', async () => {
    installWindowTimers();
    let resolveSend!: (value: Result<SentTextMessage>) => void;
    let resolvePoll!: (value: Result<ThreadMessages>) => void;
    let threadCalls = 0;
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => {
        threadCalls++;
        if (threadCalls === 1) return emptyHistory();
        if (threadCalls === 2) return new Promise(resolve => { resolvePoll = resolve; });
        return {
            ok: true,
            value: {
                items: [{ kind: 'text', id: 'server', senderId: 'viewer', ts: 20, text: 'hello' }],
                hasNextPage: false,
                viewerId: 'viewer',
            },
        };
    }, undefined, async () =>
        new Promise(resolve => { resolveSend = resolve; }));
    const store = createFrontendStore(rpc, {
        incomingSync: {
            environment: {
                isVisible: () => true,
                subscribeVisibility: () => () => undefined,
                setTimeout: () => 1,
                clearTimeout: () => undefined,
            },
        },
    });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    const poll = store.pollIncomingNow();
    await settle();
    const localId = store.sendText('a', 'hello', { followNewest: true });
    assert.ok(localId);
    resolvePoll({
        ok: true,
        value: {
            items: [{ kind: 'text', id: 'server', senderId: 'viewer', ts: 20, text: 'hello' }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    });
    await poll;
    let history = store.state.histories.a;
    assert.deepEqual(history.listedIds, [localId]);
    assert.equal(Object.keys(history.byId).length, 1);
    resolveSend({
        ok: true,
        value: { messageId: 'server', timestampMs: 20, clientRequestId: 'request' },
    });
    await settle();
    history = store.state.histories.a;
    assert.equal(history.listedIds.filter(id => id === 'server').length, 1);
    assert.equal(Object.keys(history.byId).length, 1);
    assert.ok(!history.listedIds.includes(localId));
    assert.equal(store.messageRowKey('a', 'server'), localId);
    assert.equal(await store.pollIncomingNow(), true);
    assert.equal(threadCalls, 3);
    store.destroy();
});

test('a polling read started before a reaction receipt cannot regress it', async () => {
    installWindowTimers();
    let inboxCalls = 0;
    let threadCalls = 0;
    let resolvePoll!: (value: Result<ThreadMessages>) => void;
    const baseMessage: Message = {
        kind: 'text', id: 'target', senderId: 'peer', ts: 1, text: 'hello', reactions: [],
    };
    const rpc = fakeRpc(async () => {
        inboxCalls++;
        return { ok: true, value: { items: [thread('a')], hasNextPage: false } };
    }, async () => {
        threadCalls++;
        if (threadCalls === 1) return {
            ok: true,
            value: { items: [baseMessage], hasNextPage: false, viewerId: 'viewer' },
        };
        return new Promise(resolve => { resolvePoll = resolve; });
    }, undefined, undefined, async () => ({
        ok: true,
        value: {
            messageId: 'target',
            reactions: [{ senderId: 'viewer', reaction: '❤', timestampMs: 20 }],
        },
    }));
    // Enable only the explicit lifecycle-safe poll; no timers are installed.
    const pollStore = createFrontendStore(rpc, {
        incomingSync: {
            environment: {
                isVisible: () => true,
                subscribeVisibility: () => () => undefined,
                setTimeout: () => 1,
                clearTimeout: () => undefined,
            },
        },
    });
    pollStore.start();
    await settle();
    pollStore.selectThread('a');
    await settle();
    const poll = pollStore.pollIncomingNow();
    await settle();
    await pollStore.setReaction('a', 'target', '❤');
    resolvePoll({
        ok: true,
        value: { items: [baseMessage], hasNextPage: false, viewerId: 'viewer' },
    });
    await poll;
    assert.equal(firstReaction(pollStore.state.histories.a.byId.target), '❤');
    assert.equal(inboxCalls, 2);
    pollStore.destroy();
});

test('polling shares inbox and per-thread read flights with initial and older reads', async () => {
    installWindowTimers();
    let inboxCalls = 0;
    let threadCalls = 0;
    let resolveInitialInbox!: (value: Result<Page<Thread>>) => void;
    let resolveNextInbox!: (value: Result<Page<Thread>>) => void;
    let resolveInitialHistory!: (value: Result<ThreadMessages>) => void;
    let resolveOlderHistory!: (value: Result<ThreadMessages>) => void;
    const rpc = fakeRpc(async payload => {
        inboxCalls++;
        if (inboxCalls === 1) return new Promise(resolve => { resolveInitialInbox = resolve; });
        if (payload.cursor) return new Promise(resolve => { resolveNextInbox = resolve; });
        return { ok: true, value: { items: [thread('a')], hasNextPage: false } };
    }, async payload => {
        threadCalls++;
        if (!payload.cursor) return new Promise(resolve => { resolveInitialHistory = resolve; });
        return new Promise(resolve => { resolveOlderHistory = resolve; });
    });
    const store = createFrontendStore(rpc, {
        incomingSync: {
            environment: {
                isVisible: () => true,
                subscribeVisibility: () => () => undefined,
                setTimeout: () => 1,
                clearTimeout: () => undefined,
            },
        },
    });

    store.start();
    assert.equal(await store.pollIncomingNow(), false);
    assert.equal(inboxCalls, 1);
    resolveInitialInbox({
        ok: true,
        value: { items: [thread('a')], cursor: 'next', hasNextPage: true },
    });
    await settle();

    store.loadNextInboxPage();
    assert.equal(await store.pollIncomingNow(), false);
    assert.equal(inboxCalls, 2);
    resolveNextInbox({ ok: true, value: { items: [], hasNextPage: false } });
    await settle();

    store.selectThread('a');
    await settle();
    assert.equal(threadCalls, 1);
    assert.equal(await store.pollIncomingNow(), true);
    assert.equal(threadCalls, 1);
    resolveInitialHistory({
        ok: true,
        value: {
            items: [{ kind: 'text', id: 'target', senderId: 'peer', ts: 10, text: 'newest' }],
            cursor: 'older',
            hasNextPage: true,
            viewerId: 'viewer',
        },
    });
    await settle();

    store.revealOlderHistory('a', true);
    await settle();
    assert.equal(threadCalls, 2);
    assert.equal(await store.pollIncomingNow(), true);
    assert.equal(threadCalls, 2);
    resolveOlderHistory({
        ok: true,
        value: {
            items: [{ kind: 'text', id: 'older', senderId: 'peer', ts: 1, text: 'older' }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    });
    await settle();
    assert.deepEqual(store.state.histories.a.listedIds, ['older', 'target']);
    store.destroy();
});

test('a consumed poll timer retries after initial and paginated inbox read collisions', async () => {
    let timer: { callback: () => void; delay: number } | undefined;
    let inboxCalls = 0;
    let resolveInitial!: (value: Result<Page<Thread>>) => void;
    let resolvePage!: (value: Result<Page<Thread>>) => void;
    const takeTimer = () => {
        assert.ok(timer);
        const callback = timer.callback;
        timer = undefined;
        return callback;
    };
    const rpc = fakeRpc(payload => {
        inboxCalls++;
        if (inboxCalls === 1) return new Promise(resolve => { resolveInitial = resolve; });
        if (payload.cursor) return new Promise(resolve => { resolvePage = resolve; });
        return Promise.resolve({
            ok: true,
            value: { items: [thread('a')], cursor: 'next', hasNextPage: true },
        });
    });
    const store = createFrontendStore(rpc, {
        incomingSync: {
            intervalMs: 5,
            environment: {
                isVisible: () => true,
                subscribeVisibility: () => () => undefined,
                setTimeout: (callback, delay) => (timer = { callback, delay }),
                clearTimeout: value => { if (timer === value) timer = undefined; },
            },
        },
    });

    store.start();
    assert.equal(inboxCalls, 1);
    takeTimer()();
    assert.equal(inboxCalls, 1);
    assert.equal((timer as { callback: () => void; delay: number } | undefined)?.delay, 5);
    resolveInitial({
        ok: true,
        value: { items: [thread('a')], cursor: 'next', hasNextPage: true },
    });
    await settle();
    takeTimer()();
    await settle();
    assert.equal(inboxCalls, 2);

    store.loadNextInboxPage();
    assert.equal(inboxCalls, 3);
    takeTimer()();
    assert.equal(inboxCalls, 3);
    assert.equal((timer as { callback: () => void; delay: number } | undefined)?.delay, 5);
    resolvePage({ ok: true, value: { items: [], hasNextPage: false } });
    await settle();
    takeTimer()();
    await settle();
    assert.equal(inboxCalls, 4);
    store.destroy();
});

test('visibility resume during an inbox read schedules a later poll', async () => {
    let visibilityListener: () => void = () => undefined;
    let timer: { callback: () => void; delay: number } | undefined;
    let inboxCalls = 0;
    let resolveInitial!: (value: Result<Page<Thread>>) => void;
    const rpc = fakeRpc(() => {
        inboxCalls++;
        if (inboxCalls === 1) return new Promise(resolve => { resolveInitial = resolve; });
        return Promise.resolve({ ok: true, value: { items: [thread('a')], hasNextPage: false } });
    });
    const store = createFrontendStore(rpc, {
        incomingSync: {
            intervalMs: 7,
            environment: {
                isVisible: () => true,
                subscribeVisibility: listener => {
                    visibilityListener = listener;
                    return () => undefined;
                },
                setTimeout: (callback, delay) => (timer = { callback, delay }),
                clearTimeout: value => { if (timer === value) timer = undefined; },
            },
        },
    });

    store.start();
    visibilityListener();
    assert.equal(inboxCalls, 1);
    assert.equal(timer?.delay, 7);
    resolveInitial({ ok: true, value: { items: [thread('a')], hasNextPage: false } });
    await settle();
    const retry = timer!.callback;
    timer = undefined;
    retry();
    await settle();
    assert.equal(inboxCalls, 2);
    store.destroy();
});

test('sequential authoritative reaction snapshots may remove and replace timestamp-less reactions', async () => {
    installWindowTimers();
    const base: Message = {
        kind: 'text', id: 'target', senderId: 'peer', ts: 1, text: 'hello', reactions: [],
    };
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => ({
        ok: true,
        value: { items: [base], hasNextPage: false, viewerId: 'viewer' },
    }));
    const store = createFrontendStore(rpc, { incomingSync: false });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    const timestamped = {
        ...base,
        reactions: [{ senderId: 'peer-2', reaction: '🔥', timestampMs: 20 }],
    };
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: { threadId: 'a', viewerId: 'viewer', messages: [timestamped] },
    });
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: { threadId: 'a', viewerId: 'viewer', messages: [{ ...base, reactions: [] }] },
    });
    assert.deepEqual(store.state.histories.a.byId.target.reactions, []);
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: {
            threadId: 'a', viewerId: 'viewer',
            messages: [{ ...base, reactions: [{ senderId: 'peer-2', reaction: '👍' }] }],
        },
    });
    assert.equal(firstReaction(store.state.histories.a.byId.target), '👍');
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: {
            threadId: 'a', viewerId: 'viewer',
            messages: [{ ...base, reactions: [{ senderId: 'peer-2', reaction: '😂' }] }],
        },
    });
    assert.equal(firstReaction(store.state.histories.a.byId.target), '😂');
    store.destroy();
});

test('an older-page completion cannot overwrite a newer peer reaction', async () => {
    installWindowTimers();
    let resolveOlder!: (value: Result<ThreadMessages>) => void;
    let calls = 0;
    const base: Message = {
        kind: 'text', id: 'target', senderId: 'peer', ts: 10, text: 'hello',
        reactions: [{ senderId: 'peer-2', reaction: '👍', timestampMs: 10 }],
    };
    const rpc = fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    }), async () => ++calls === 1 ? {
        ok: true,
        value: { items: [base], cursor: 'older', hasNextPage: true, viewerId: 'viewer' },
    } : new Promise(resolve => { resolveOlder = resolve; }));
    const store = createFrontendStore(rpc, { incomingSync: false });
    store.start();
    await settle();
    store.selectThread('a');
    await settle();
    store.revealOlderHistory('a', true);
    await settle();
    store.applyIncomingSnapshot({
        kind: 'snapshot', threads: [],
        history: {
            threadId: 'a', viewerId: 'viewer',
            messages: [{
                ...base,
                reactions: [{ senderId: 'peer-2', reaction: '🔥' }],
            }],
        },
    });
    resolveOlder({
        ok: true,
        value: {
            items: [{
                ...base,
                reactions: [{ senderId: 'peer-2', reaction: '👍', timestampMs: 999 }],
            }, { kind: 'text', id: 'older', senderId: 'peer', ts: 1, text: 'old' }],
            hasNextPage: false,
            viewerId: 'viewer',
        },
    });
    await settle();
    assert.equal(firstReaction(store.state.histories.a.byId.target), '🔥');
    store.destroy();
});

test('the incoming snapshot boundary is inert after destroy', async () => {
    const store = createFrontendStore(fakeRpc(async () => ({
        ok: true,
        value: { items: [thread('a')], hasNextPage: false },
    })), { incomingSync: false });
    store.start();
    await settle();
    let emissions = 0;
    store.subscribe(() => { emissions++; });
    store.destroy();
    const before = JSON.stringify(store.state);
    assert.equal(store.applyIncomingSnapshot({
        kind: 'snapshot',
        threads: [{ ...thread('b'), lastActivityMs: 20 }],
    }), false);
    assert.equal(JSON.stringify(store.state), before);
    assert.equal(emissions, 0);
});

test('incoming polling is visible, single-flight, backed off, and stale after destroy', async () => {
    let visible = true;
    let visibilityListener: () => void = () => undefined;
    let subscribed = false;
    let timer: { callback: () => void; delay: number } | undefined;
    let inboxCalls = 0;
    let resolveDeferred!: (value: Result<Page<Thread>>) => void;
    const rpc = fakeRpc(async () => {
        inboxCalls++;
        if (inboxCalls === 1) return {
            ok: true,
            value: { items: [thread('a')], hasNextPage: false },
        };
        if (inboxCalls <= 6) return { ok: false, error: { message: 'offline' } };
        return new Promise(resolve => { resolveDeferred = resolve; });
    });
    const store = createFrontendStore(rpc, {
        incomingSync: {
            intervalMs: 5,
            maxBackoffMs: 60,
            environment: {
                isVisible: () => visible,
                subscribeVisibility: listener => {
                    subscribed = true;
                    visibilityListener = listener;
                    return () => { subscribed = false; };
                },
                setTimeout: (callback, delay) => {
                    timer = { callback, delay };
                    return timer;
                },
                clearTimeout: value => {
                    if (timer === value) timer = undefined;
                },
            },
        },
    });
    store.start();
    await settle();
    assert.equal((timer as { callback: () => void; delay: number } | undefined)?.delay, 5);
    const firstPoll = timer!.callback;
    timer = undefined;
    firstPoll();
    await settle();
    assert.equal((timer as { callback: () => void; delay: number } | undefined)?.delay, 10);
    for (const expectedDelay of [20, 40, 60]) {
        const retry = timer!.callback;
        timer = undefined;
        retry();
        await settle();
        assert.equal(
            (timer as { callback: () => void; delay: number } | undefined)?.delay,
            expectedDelay,
        );
    }
    const cappedRetry = timer!.callback;
    timer = undefined;
    cappedRetry();
    await settle();
    assert.equal((timer as { callback: () => void; delay: number } | undefined)?.delay, 60);

    visible = false;
    visibilityListener();
    assert.equal(timer, undefined);
    visible = true;
    visibilityListener();
    await settle();
    visibilityListener();
    assert.equal(inboxCalls, 7);
    store.destroy();
    assert.equal(subscribed, false);
    resolveDeferred({
        ok: true,
        value: { items: [thread('b')], hasNextPage: false },
    });
    await settle();
    assert.deepEqual(store.state.inbox.orderedIds, ['a']);
    assert.equal(timer, undefined);
});

function fakeRpc(
    getInbox: UiRpc['getInbox'],
    getThread: UiRpc['getThread'] = async () => emptyHistory(),
    getPins: UiRpc['getPins'] = async () => ({ pinned: [] }),
    sendText: CompleteUiRpc['sendText'] = async () => ({
        ok: false,
        error: { message: 'not used' },
    }),
    setReaction: CompleteUiRpc['setReaction'] = async () => ({
        ok: false,
        error: { message: 'not used' },
    }),
    togglePin: CompleteUiRpc['togglePin'] = async payload => ({
        ok: true,
        value: {
            pinned: payload.pin ? [payload.threadKey] : [],
            receipt: { threadFbid: payload.threadFbid, isPinned: payload.pin },
        },
    }),
): CompleteUiRpc {
    return {
        getInbox,
        getThread,
        getPins,
        togglePin,
        sendText,
        setReaction,
        getReelMedia: async () => ({
            ok: false,
            error: { message: 'not used' },
        }),
        getReelComments: async () => ({
            ok: false,
            error: { message: 'not used' },
        }),
        setReelLiked: async () => ({ ok: false, error: { message: 'not used' } }),
        setReelSaved: async () => ({ ok: false, error: { message: 'not used' } }),
    };
}

function emptyHistory(): Result<ThreadMessages> {
    return { ok: true, value: { items: [], hasNextPage: false, viewerId: 'viewer' } };
}

function reelMedia(shortcode: string, id: string, url: string) {
    return {
        id,
        shortcode,
        mediaType: 'reel' as const,
        author: { id: 'owner', username: 'alice', fullName: 'Alice', picUrl: null, isVerified: false },
        items: [{
            id,
            kind: 'video' as const,
            videoUrl: url,
            variants: [{ url }],
            posterUrl: url,
            width: 720,
            height: 1280,
            durationSec: 1,
            canDownload: true,
            downloadUrl: url,
        }],
        likeCount: 0,
        commentCount: 0,
        hasLiked: false,
        hasSaved: false,
        canSave: true,
        canDownload: true,
    };
}

function thread(key: string): Thread {
    return {
        key,
        threadFbid: String(key.charCodeAt(0) - 96),
        title: key,
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 0,
        serverIsPin: false,
        users: [],
    };
}

function firstReaction(message: Message) {
    return message.reactions?.[0]?.reaction;
}

function historyPage(
    start: number,
    end: number,
    cursor: string | undefined,
    hasNextPage: boolean,
): Result<ThreadMessages> {
    return {
        ok: true,
        value: {
            items: messageIds(start, end).map((id, index): Message => ({
                kind: 'text',
                id,
                senderId: 'sender',
                ts: start + index,
                text: id,
            })),
            cursor,
            hasNextPage,
            viewerId: 'viewer',
        },
    };
}

function messageIds(start: number, end: number) {
    return Array.from({ length: end - start }, (_, index) => `m${start + index}`);
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function installWindowTimers() {
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: globalThis,
    });
}
