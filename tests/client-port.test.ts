import assert from 'node:assert/strict';
import test from 'node:test';
import type browser from 'webextension-polyfill';
import type { InboxEngine, InboxProjection } from '../lib/engine/inbox.ts';
import type { InboxClientPort } from '../lib/engine/ports.ts';
import { emptyEntities, emptyResource } from '../lib/engine/resources.ts';
import {
    INBOX_CLIENT_PORT,
    type ClientCommandInput,
    type SnapshotMessage,
} from '../lib/engine/protocol.ts';

function event<Listener extends (...args: never[]) => void>() {
    const listeners = new Set<Listener>();
    return {
        addListener(listener: Listener) {
            listeners.add(listener);
        },
        removeListener(listener: Listener) {
            listeners.delete(listener);
        },
        hasListener(listener: Listener) {
            return listeners.has(listener);
        },
        hasListeners() {
            return listeners.size > 0;
        },
        listeners,
    };
}

test('real client Port forwards detail interest, keeps sequence across routes, and releases it on disconnect', async () => {
    Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: {
            runtime: {
                id: 'test-extension',
                getURL: (path: string) =>
                    `chrome-extension://test-extension${path}`,
            },
        },
    });
    const { prepareInboxClientPort } = await import('../lib/engine/ports.ts');
    const projection: InboxProjection = {
        accountId: 'account',
        accountEpoch: 1,
        workerEpoch: 'worker',
        commitRevision: 1,
        entities: emptyEntities(),
        inbox: emptyResource(),
        histories: {},
    };
    const interests: Array<string | undefined> = [];
    const anchors: Array<string | undefined> = [];
    const projectionListeners: Array<(value: InboxProjection) => void> = [];
    const replacements: Array<((value: InboxProjection) => void) | undefined> =
        [];
    const historyCommands: Array<{
        kind: string;
        threadId: string;
        listener?: (value: InboxProjection) => void;
        anchorId?: string;
    }> = [];
    let released = 0;
    let active = 0;
    const engine: InboxEngine = {
        subscribe(listener, threadId, anchorId, replaceListener) {
            interests.push(threadId);
            anchors.push(anchorId);
            projectionListeners.push(listener);
            replacements.push(replaceListener);
            listener({
                ...projection,
                inbox: {
                    ...projection.inbox,
                    synchronization: active === 0 ? 'refreshing' : 'idle',
                },
            });
            active++;
            return () => {
                active--;
                released++;
            };
        },
        refresh: async () => undefined,
        loadMoreInbox: async () => undefined,
        refreshHistory: async (threadId, listener, anchorId) => {
            historyCommands.push({
                kind: 'refresh',
                threadId,
                listener,
                anchorId,
            });
        },
        loadOlderHistory: async (threadId, listener) => {
            historyCommands.push({ kind: 'older', threadId, listener });
        },
        loadNewerHistory: async (threadId, listener) => {
            historyCommands.push({ kind: 'newer', threadId, listener });
        },
        snapshot: () => projection,
    };

    const onMessage =
        event<
            Parameters<browser.Runtime.Port['onMessage']['addListener']>[0]
        >();
    const onDisconnect =
        event<
            Parameters<browser.Runtime.Port['onDisconnect']['addListener']>[0]
        >();
    const sent: SnapshotMessage[] = [];
    const port: browser.Runtime.Port = {
        name: INBOX_CLIENT_PORT,
        sender: { url: 'chrome-extension://test-extension/ui.html' },
        onMessage,
        onDisconnect,
        postMessage(message) {
            // SAFETY: registerInboxClientPorts posts only the closed snapshot envelope.
            sent.push(message as SnapshotMessage);
        },
        disconnect() {
            for (const listener of onDisconnect.listeners) listener(port);
        },
    };

    const activate = prepareInboxClientPort(port);
    for (const listener of onMessage.listeners)
        listener({ kind: 'subscribe', threadId: 'first' }, port);
    // Simulate delayed ManagedRuntime layer initialization.
    activate(engine);
    for (const listener of onMessage.listeners)
        listener(
            {
                kind: 'subscribe',
                threadId: 'second',
                anchorId: 'second-message',
            },
            port,
        );

    for (const listener of onMessage.listeners) {
        listener({ kind: 'load-older-history', threadId: 'second' }, port);
        listener({ kind: 'load-newer-history', threadId: 'second' }, port);
        listener(
            {
                kind: 'refresh-history',
                threadId: 'second',
                anchorId: 'visible',
            },
            port,
        );
    }

    assert.deepEqual(interests, ['first', 'second']);
    assert.deepEqual(anchors, [undefined, 'second-message']);
    assert.deepEqual(replacements, [undefined, projectionListeners[0]]);
    assert.deepEqual(
        historyCommands.map((command) => command.kind),
        ['older', 'newer', 'refresh'],
    );
    assert(
        historyCommands.every(
            (command) => command.listener === projectionListeners[1],
        ),
    );
    assert.equal(historyCommands[2].anchorId, 'visible');
    assert.deepEqual(
        sent.map((value) => value.sequence),
        [1, 2],
    );
    assert.deepEqual(
        sent.map((value) => value.projection.inbox.synchronization),
        ['refreshing', 'idle'],
    );
    assert.equal(released, 1);

    port.disconnect();
    assert.equal(released, 2);
    for (const listener of onMessage.listeners)
        listener({ kind: 'subscribe', threadId: 'closed' }, port);
    assert.equal(interests.length, 2);
});

test('startup buffering supports prototype-backed ports and rejects invalid senders immediately', async () => {
    const { prepareInboxClientPort } = await import('../lib/engine/ports.ts');
    const messages = event<(message: ClientCommandInput) => void>();
    const disconnects = event<() => void>();
    let subscriptions = 0;
    const prototype = {
        name: INBOX_CLIENT_PORT,
        sender: { url: 'chrome-extension://test-extension/ui.html' },
        onMessage: messages,
        onDisconnect: disconnects,
        postMessage() {},
        disconnect() {},
    };
    const port: InboxClientPort = Object.create(prototype);
    const activate = prepareInboxClientPort(port);
    for (const listener of messages.listeners) listener({ kind: 'subscribe' });
    activate({
        subscribe: () => {
            subscriptions++;
            return () => undefined;
        },
        refresh: async () => undefined,
        loadMoreInbox: async () => undefined,
        refreshHistory: async () => undefined,
        loadOlderHistory: async () => undefined,
        loadNewerHistory: async () => undefined,
        snapshot(): never {
            throw new Error('snapshot is not used by subscription setup');
        },
    });
    assert.equal(subscriptions, 1);

    let rejected = 0;
    const invalid: InboxClientPort = Object.create({
        ...prototype,
        sender: { url: 'https://example.com/ui.html' },
        disconnect: () => rejected++,
    });
    prepareInboxClientPort(invalid);
    assert.equal(rejected, 1);
});
