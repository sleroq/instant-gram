import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, Page, Result, Thread, ThreadMessages } from '../../lib/domain.ts';
import type { UiRpc } from './rpc.ts';
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

function fakeRpc(
    getInbox: UiRpc['getInbox'],
    getThread: UiRpc['getThread'] = async () => emptyHistory(),
    getPins: UiRpc['getPins'] = async () => ({ pinned: [] }),
): UiRpc {
    return {
        getInbox,
        getThread,
        getPins,
        togglePin: async () => ({ pinned: [] }),
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
