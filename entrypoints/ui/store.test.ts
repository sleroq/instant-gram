import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    Message, Page, Result, SentTextMessage, SetReactionResult, Thread, ThreadMessages,
} from '../../lib/domain.ts';
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
        pin: true, status: 'error', error: 'denied',
    });

    assert.equal(await store.togglePin('a'), true);
    assert.deepEqual(store.state.pinnedIds, ['a', 'b']);
    assert.equal(store.state.pinMutations.a, undefined);
    assert.equal(toggleCalls[0]?.threadFbid, 'a');
    store.destroy();
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
    const aFlight = store.setReaction('a', 'same', '😂');
    const duplicate = await store.setReaction('a', 'same', '😮');
    const bFlight = store.setReaction('b', 'same', '👍');
    assert.equal(duplicate, false);
    assert.equal(reactionCalls.length, 2);
    assert.equal(store.state.histories.a.byId.same.reactions?.[0].reaction, '😂');
    assert.equal(store.state.histories.b.byId.same.reactions?.[0].reaction, '👍');
    assert.deepEqual(store.state.inbox.orderedIds, order);

    resolvers[0]({ ok: false, error: { message: 'reaction failed' } });
    resolvers[1]({
        ok: true,
        value: {
            messageId: 'same',
            reactions: [{ senderId: 'viewer', reaction: 'SERVER' }],
        },
    });
    assert.equal(await aFlight, false);
    assert.equal(await bFlight, true);
    assert.equal(store.state.histories.a.byId.same.reactions?.[0].reaction, '❤');
    assert.equal(store.state.histories.a.reactionMutations.same.status, 'error');
    assert.equal(store.state.histories.b.byId.same.reactions?.[0].reaction, 'SERVER');
    assert.equal(store.state.histories.b.reactionMutations.same, undefined);

    const retry = store.setReaction('a', 'same', '😮');
    assert.equal(store.state.histories.a.byId.same.reactions?.[0].reaction, '😮');
    resolvers[2]({
        ok: true,
        value: {
            messageId: 'same',
            reactions: [{ senderId: 'viewer', reaction: 'AUTHORITATIVE' }],
        },
    });
    assert.equal(await retry, true);
    assert.equal(store.state.histories.a.byId.same.reactions?.[0].reaction, 'AUTHORITATIVE');

    const localId = store.sendText('a', 'pending', { followNewest: true });
    assert.ok(localId);
    assert.equal(await store.setReaction('a', localId, '❤'), false);
    assert.equal(reactionCalls.length, 3);
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
    };
}

function emptyHistory(): Result<ThreadMessages> {
    return { ok: true, value: { items: [], hasNextPage: false, viewerId: 'viewer' } };
}

function thread(key: string): Thread {
    return {
        key,
        threadFbid: key,
        title: key,
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: 0,
        serverIsPin: false,
        users: [],
    };
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
