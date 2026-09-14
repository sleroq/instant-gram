import assert from 'node:assert/strict';
import test from 'node:test';
import type browser from 'webextension-polyfill';
import type { InboxEngine, InboxProjection } from '../lib/engine/inbox.ts';
import { emptyEntities, emptyResource } from '../lib/engine/resources.ts';
import {
    INBOX_CLIENT_PORT,
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
    const { registerInboxClientPorts } = await import('../lib/engine/ports.ts');
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
    let released = 0;
    let active = 0;
    const engine: InboxEngine = {
        subscribe(listener, threadId) {
            interests.push(threadId);
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
        refreshHistory: async () => undefined,
        loadOlderHistory: async () => undefined,
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
    registerInboxClientPorts(port, engine);
    for (const listener of onMessage.listeners)
        listener({ kind: 'subscribe', threadId: 'first' }, port);
    for (const listener of onMessage.listeners)
        listener({ kind: 'subscribe', threadId: 'second' }, port);
    assert.deepEqual(interests, ['first', 'second']);
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
