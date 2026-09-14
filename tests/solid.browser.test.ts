import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { buildExtension } from './browser-build.ts';
import type { InboxProjection } from '../lib/engine/inbox';
import type { SnapshotMessage } from '../lib/engine/protocol';

declare global {
    interface Window {
        solidTest: {
            autoSnapshot: boolean;
            connections: number;
            disconnections: number;
            subscriptions: number;
            subscribeThreadIds: Array<string | undefined>;
            refreshes: number;
            current: InboxProjection;
            send(projection: InboxProjection, sequence: number): void;
            workerDisconnect(): void;
        };
    }
}

let browser: Browser;
let server: PreviewServer;
let baseUrl: string;

test.before(async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const output = fileURLToPath(
        new URL('../.output/chrome-mv3', import.meta.url),
    );
    await buildExtension(root);
    const manifest = JSON.parse(
        await readFile(`${output}/manifest.json`, 'utf8'),
    );
    assert.deepEqual(manifest.permissions, ['tabs']);
    assert.deepEqual(manifest.host_permissions, [
        'https://www.instagram.com/*',
    ]);
    assert.deepEqual(manifest.content_scripts, [
        {
            matches: ['https://www.instagram.com/*'],
            run_at: 'document_idle',
            js: ['content-scripts/ig-anchor.js'],
        },
        {
            matches: ['https://www.instagram.com/*'],
            run_at: 'document_idle',
            js: ['content-scripts/ig-auth-probe.js'],
            world: 'MAIN',
        },
    ]);
    assert.deepEqual(
        (await readdir(output)).filter((file) => file.endsWith('.html')).sort(),
        ['ui.html'],
    );
    server = await preview({
        configFile: false,
        root,
        build: { outDir: output },
        preview: { port: 0, host: '127.0.0.1' },
    });
    baseUrl = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ headless: true });
});

test.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
});

async function openInbox(): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage();
    await page.addInitScript(() => {
        const ids = Array.from(
            { length: 1_000 },
            (_, index) => `thread-${index}`,
        );
        const threadsById = Object.fromEntries(
            ids.map((id) => [
                id,
                {
                    key: id,
                    title: id,
                    isGroup: false,
                    isMuted: false,
                    folder: 'PRIMARY' as const,
                    lastActivityMs: 1,
                    isUnread: false,
                    serverIsPin: false,
                    userIds: [],
                },
            ]),
        );
        const current: InboxProjection = {
            accountId: '1',
            accountEpoch: 1,
            workerEpoch: 'worker',
            commitRevision: 1,
            entities: { threadsById, usersById: {}, messagesById: {} },
            inbox: {
                orderedIds: ids,
                fetchedAt: 1,
                hasNextPage: false,
                availability: 'present',
                freshness: 'fresh',
                synchronization: 'idle',
            },
            histories: {},
        };
        let active:
            | {
                  messages: Set<(message: SnapshotMessage) => void>;
                  disconnects: Set<() => void>;
                  disconnected: boolean;
              }
            | undefined;
        let lastSequence = 1;
        window.solidTest = {
            autoSnapshot: true,
            connections: 0,
            disconnections: 0,
            subscriptions: 0,
            subscribeThreadIds: [],
            refreshes: 0,
            current,
            send(projection, sequence) {
                this.current = projection;
                lastSequence = sequence;
                active?.messages.forEach((listener) =>
                    listener({ kind: 'snapshot', sequence, projection }),
                );
            },
            workerDisconnect() {
                const port = active;
                if (!port || port.disconnected) return;
                port.disconnected = true;
                this.disconnections++;
                port.disconnects.forEach((listener) => listener());
                port.messages.clear();
                port.disconnects.clear();
            },
        };
        Object.assign(globalThis, {
            chrome: {
                runtime: {
                    id: 'test',
                    lastError: undefined,
                    connect: () => {
                        window.solidTest.connections++;
                        const connection = {
                            messages: new Set<
                                (message: SnapshotMessage) => void
                            >(),
                            disconnects: new Set<() => void>(),
                            disconnected: false,
                        };
                        active = connection;
                        return {
                            onMessage: {
                                addListener: (
                                    listener: (
                                        message: SnapshotMessage,
                                    ) => void,
                                ) => connection.messages.add(listener),
                                removeListener: (
                                    listener: (
                                        message: SnapshotMessage,
                                    ) => void,
                                ) => connection.messages.delete(listener),
                            },
                            onDisconnect: {
                                addListener: (listener: () => void) =>
                                    connection.disconnects.add(listener),
                                removeListener: (listener: () => void) =>
                                    connection.disconnects.delete(listener),
                            },
                            postMessage(message: {
                                kind: string;
                                threadId?: string;
                            }) {
                                if (message.kind === 'refresh')
                                    window.solidTest.refreshes++;
                                if (message.kind === 'subscribe') {
                                    window.solidTest.subscriptions++;
                                    window.solidTest.subscribeThreadIds.push(
                                        message.threadId,
                                    );
                                    if (window.solidTest.autoSnapshot)
                                        queueMicrotask(() =>
                                            window.solidTest.send(
                                                window.solidTest.current,
                                                lastSequence,
                                            ),
                                        );
                                }
                            },
                            disconnect() {
                                if (connection.disconnected) return;
                                connection.disconnected = true;
                                window.solidTest.disconnections++;
                                connection.disconnects.forEach((listener) =>
                                    listener(),
                                );
                                connection.messages.clear();
                                connection.disconnects.clear();
                            },
                        };
                    },
                },
            },
        });
    });
    const errors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/ui.html`);
    await page.getByRole('heading', { name: 'Messages' }).waitFor();
    await page.getByText('thread-0').waitFor();
    return { page, errors };
}

test('snapshots preserve rows, cached errors remain usable, and virtualization stays bounded', async () => {
    const { page, errors } = await openInbox();
    assert.equal(await page.getByRole('status').textContent(), 'Up to date');
    assert.ok((await page.getByRole('listitem').count()) <= 31);
    const original = await page.getByText('thread-0').elementHandle();
    await page.evaluate(() => {
        const projection = structuredClone(window.solidTest.current);
        projection.entities.threadsById['thread-1'].title = 'changed title';
        window.solidTest.send(projection, 2);
    });
    await page.getByText('changed title').waitFor();
    const updated = await page.getByText('thread-0').elementHandle();
    assert.ok(
        original &&
            updated &&
            (await original.evaluate(
                (node, next) => node.isSameNode(next),
                updated,
            )),
    );

    await page.evaluate(() => {
        const projection = structuredClone(window.solidTest.current);
        projection.inbox.freshness = 'stale';
        projection.inbox.synchronization = 'error';
        projection.inbox.error = {
            kind: 'protocol',
            message: 'Instagram inbox request failed.',
        };
        window.solidTest.send(projection, 3);
    });
    assert.equal(
        await page.getByRole('status').textContent(),
        'Showing cached conversations',
    );
    await page.getByRole('alert').waitFor();
    assert.equal((await page.getByRole('listitem').count()) > 0, true);
    await page.getByRole('button', { name: 'Retry' }).click();
    assert.equal(await page.evaluate(() => window.solidTest.refreshes), 1);

    await page.evaluate(() =>
        window.solidTest.send(
            {
                ...window.solidTest.current,
                entities: {
                    ...window.solidTest.current.entities,
                    threadsById: {
                        ...window.solidTest.current.entities.threadsById,
                        'thread-1': {
                            ...window.solidTest.current.entities.threadsById[
                                'thread-1'
                            ],
                            title: 'duplicate ignored',
                        },
                    },
                },
            },
            3,
        ),
    );
    assert.equal(await page.getByText('duplicate ignored').count(), 0);
    assert.equal(await page.evaluate(() => window.solidTest.connections), 1);
    await page.locator('[aria-label="Primary inbox"]').evaluate((element) => {
        element.scrollTop = 72 * 800;
        element.dispatchEvent(new Event('scroll'));
    });
    await page.getByText('thread-800').waitFor();
    assert.ok((await page.getByRole('listitem').count()) <= 31);
    assert.equal(await page.evaluate(() => window.solidTest.refreshes), 1);
    assert.deepEqual(errors, []);
    await page.close();
});

test('sequence gaps and worker disconnects replace exactly one port and reset checking state', async () => {
    const { page, errors } = await openInbox();
    await page.evaluate(() => {
        window.solidTest.autoSnapshot = false;
        window.solidTest.send(window.solidTest.current, 3);
    });
    await page.getByText('Checking Instagram…').waitFor();
    assert.deepEqual(
        await page.evaluate(() => [
            window.solidTest.connections,
            window.solidTest.disconnections,
            window.solidTest.subscriptions,
        ]),
        [2, 1, 2],
    );
    await page.evaluate(() =>
        window.solidTest.send(
            { ...window.solidTest.current, workerEpoch: 'worker-2' },
            1,
        ),
    );
    await page.getByText('thread-0').waitFor();
    assert.equal(await page.getByRole('status').textContent(), 'Up to date');

    await page.evaluate(() => window.solidTest.workerDisconnect());
    await page.getByText('Checking Instagram…').waitFor();
    assert.equal(await page.getByText('thread-0').count(), 0);
    assert.deepEqual(
        await page.evaluate(() => [
            window.solidTest.connections,
            window.solidTest.disconnections,
            window.solidTest.subscriptions,
        ]),
        [3, 2, 3],
    );
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.solidTest.connections), 3);
    assert.deepEqual(errors, []);
    await page.close();
});
