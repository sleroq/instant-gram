import assert from 'node:assert/strict';
import test from 'node:test';
import type browser from 'webextension-polyfill';
import { registerInboxProvider } from '../lib/provider/inbox-content.ts';

test('existing complete Instagram tab is recovered without navigating it', async () => {
    let tabs: Array<{
        id: number;
        status: string;
        url: string;
        pendingUrl?: string;
    }> = [];
    const injections: unknown[] = [];
    let created = 0;
    const fakeBrowser = {
        runtime: { id: 'test' },
        tabs: {
            async query() {
                return tabs;
            },
            async create() {
                created += 1;
                return { id: 2 };
            },
        },
        scripting: {
            async executeScript(options: unknown) {
                injections.push(options);
            },
        },
    };
    Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: fakeBrowser,
    });
    Object.defineProperty(globalThis, 'browser', {
        configurable: true,
        value: fakeBrowser,
    });
    try {
        const { ensureAnchorTab } = await import('../lib/provider/anchor.ts');
        tabs = [
            {
                id: 1,
                status: 'complete',
                url: 'https://www.instagram.com/direct/inbox/',
            },
        ];
        assert.equal(await ensureAnchorTab(), 1);
        assert.deepEqual(injections, [
            {
                target: { tabId: 1 },
                world: 'MAIN',
                files: ['content-scripts/ig-auth-probe.js'],
            },
            {
                target: { tabId: 1 },
                world: 'ISOLATED',
                files: ['content-scripts/ig-anchor.js'],
            },
        ]);
        injections.length = 0;
        await ensureAnchorTab((tabId) => tabId === 1);
        assert.deepEqual(injections, []);
        tabs[0].status = 'loading';
        await ensureAnchorTab();
        tabs[0].status = 'complete';
        tabs[0].pendingUrl = 'https://www.instagram.com/';
        await ensureAnchorTab();
        tabs = [];
        assert.equal(await ensureAnchorTab(), 2);
        assert.equal(created, 1);
        assert.deepEqual(injections, []);
    } finally {
        Reflect.deleteProperty(globalThis, 'chrome');
        Reflect.deleteProperty(globalThis, 'browser');
    }
});

test('provider reconnects after worker stop and disposal removes listeners and late replies', async () => {
    const ports: ReturnType<typeof makePort>[] = [];
    function makePort() {
        const messages = new Set<(request: unknown) => void>();
        const disconnects = new Set<() => void>();
        const sent: unknown[] = [];
        return {
            messages,
            disconnects,
            sent,
            onMessage: {
                addListener: (fn: (request: unknown) => void) =>
                    messages.add(fn),
                removeListener: (fn: (request: unknown) => void) =>
                    messages.delete(fn),
            },
            onDisconnect: {
                addListener: (fn: () => void) => disconnects.add(fn),
                removeListener: (fn: () => void) => disconnects.delete(fn),
            },
            postMessage: (value: unknown) => sent.push(value),
            disconnect() {
                for (const fn of disconnects) fn();
            },
        };
    }
    const runtime = {
        connect() {
            const port = makePort();
            ports.push(port);
            return port;
        },
    } as unknown as Pick<browser.Runtime.Static, 'connect'>;
    const reads = {
        async inbox() {
            throw new Error('unused');
        },
        async history() {
            throw new Error('unused');
        },
    };
    const dispose = registerInboxProvider(runtime, reads);
    ports[0].disconnect();
    assert.equal(ports.length, 2);
    assert.equal(ports[0].messages.size, 0);
    for (const receive of ports[1].messages)
        receive({ kind: 'request', id: 'late', method: 'account' });
    dispose();
    dispose();
    await Promise.resolve();
    assert.equal(ports[1].messages.size, 0);
    assert.equal(ports[1].disconnects.size, 0);
    assert.deepEqual(ports[1].sent, []);
    ports[1].disconnect();
    assert.equal(ports.length, 2);
    assert.doesNotThrow(() =>
        registerInboxProvider(
            {
                connect() {
                    throw new Error('Extension context invalidated');
                },
            },
            reads,
        )(),
    );
});
