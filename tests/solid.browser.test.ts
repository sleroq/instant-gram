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
            historyRefreshes: number;
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
    assert.deepEqual(manifest.permissions, ['tabs', 'scripting', 'storage']);
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
        threadsById['thread-20'].serverIsPin = true;
        threadsById['thread-1'].isUnread = true;
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
            historyRefreshes: 0,
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
                storage: {
                    local: {
                        get: (
                            _key: string,
                            callback: (value: { motion?: boolean }) => void,
                        ) => callback({}),
                        set: (
                            _value: { motion: boolean },
                            callback: () => void,
                        ) => callback(),
                    },
                    onChanged: { addListener() {}, removeListener() {} },
                },
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
                                if (message.kind === 'refresh-history')
                                    window.solidTest.historyRefreshes++;
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
    await page
        .getByRole('button', { name: 'Sync status: Fresh', exact: true })
        .waitFor();
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
    await page
        .getByRole('button', { name: 'Sync status: Sync failed', exact: true })
        .waitFor();
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

test('pinned conversations lead the inbox and rows expose their status', async () => {
    const { page, errors } = await openInbox();

    const rows = page.locator('[data-thread-id]');
    await assert.doesNotReject(() => rows.first().waitFor());
    assert.equal(
        await rows.first().getAttribute('data-thread-id'),
        'thread-20',
    );
    assert.equal(
        await rows.first().locator('[aria-label="Pinned"]').count(),
        1,
    );

    const unread = page.locator('[data-thread-id="thread-1"]');
    assert.equal(await unread.locator('[aria-label="Unread"]').count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
});

test('sequence gaps and worker disconnects replace exactly one port and reset checking state', async () => {
    const { page, errors } = await openInbox();
    await page.evaluate(() => {
        window.solidTest.autoSnapshot = false;
        window.solidTest.send(window.solidTest.current, 3);
    });
    await page
        .getByRole('button', { name: 'Sync status: Loading', exact: true })
        .waitFor();
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
    await page
        .getByRole('button', { name: 'Sync status: Fresh', exact: true })
        .waitFor();

    await page.evaluate(() => window.solidTest.workerDisconnect());
    await page
        .getByRole('button', { name: 'Sync status: Loading', exact: true })
        .waitFor();
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

test('one shared sync description combines resources and survives navigation without announcing polls', async () => {
    const { page, errors } = await openInbox();
    page.setDefaultTimeout(5_000);
    try {
        const sync = page.getByRole('button', { name: /^Sync status:/ });
        const tooltip = page.getByRole('tooltip');
        const original = await sync.elementHandle();
        assert.equal(await sync.count(), 1);
        assert.equal(await tooltip.count(), 0);

        await page.getByRole('tab', { name: 'Chats', exact: true }).focus();
        await sync.hover();
        await tooltip.waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await tooltip.count(), 0);
        await page
            .getByRole('heading', { name: 'Messages', exact: true })
            .hover();
        await sync.hover();
        await tooltip.filter({ hasText: 'Inbox: Fresh' }).waitFor();
        assert.equal(
            await sync.getAttribute('aria-describedby'),
            await tooltip.getAttribute('id'),
        );
        await tooltip.hover();
        await tooltip
            .filter({ hasText: 'Loaded conversations are up to date.' })
            .waitFor();
        await page
            .getByRole('heading', { name: 'Messages', exact: true })
            .hover();
        assert.equal(await tooltip.count(), 0);

        await sync.focus();
        await tooltip.waitFor();
        await sync.press('Escape');
        assert.equal(await tooltip.count(), 0);
        assert.equal(
            await sync.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );
        await sync.press('Tab');
        assert.equal(await tooltip.count(), 0);

        await page.locator('[data-thread-id="thread-0"]').click();
        await page
            .getByRole('button', { name: 'Sync status: Loading', exact: true })
            .waitFor();
        await sync.focus();
        await tooltip.filter({ hasText: 'Inbox: Fresh' }).waitFor();
        await tooltip
            .filter({ hasText: 'Selected history: Loading' })
            .waitFor();
        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.inbox.freshness = 'stale';
            projection.inbox.synchronization = 'refreshing';
            projection.histories['thread-0'] = {
                threadId: 'thread-0',
                orderedIds: [],
                fetchedAt: 1,
                hasNextPage: false,
                availability: 'present',
                freshness: 'stale',
                synchronization: 'idle',
            };
            window.solidTest.send(projection, 2);
        });
        await page
            .getByRole('button', {
                name: 'Sync status: Refreshing',
                exact: true,
            })
            .waitFor();
        await tooltip.filter({ hasText: 'Inbox: Refreshing' }).waitFor();
        await tooltip
            .filter({ hasText: 'Selected history: Retained content' })
            .waitFor();
        await tooltip
            .filter({
                hasText: 'It does not establish current or complete coverage.',
            })
            .waitFor();
        assert.equal(
            await sync.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );
        assert.equal(await sync.count(), 1);
        assert.equal(await page.getByRole('status').count(), 0);

        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.inbox.synchronization = 'idle';
            projection.histories['thread-0'].freshness = 'fresh';
            projection.histories['thread-0'].newerCoverageAvailable = true;
            window.solidTest.send(projection, 3);
        });
        await page
            .getByRole('button', {
                name: 'Sync status: Retained content',
                exact: true,
            })
            .waitFor();
        await tooltip.filter({ hasText: 'Inbox: Retained content' }).waitFor();
        await tooltip
            .filter({ hasText: 'Selected history: Retained content' })
            .waitFor();
        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.inbox.freshness = 'fresh';
            projection.histories['thread-0'].newerCoverageAvailable = false;
            window.solidTest.send(projection, 4);
        });
        await page
            .getByRole('button', { name: 'Sync status: Fresh', exact: true })
            .waitFor();
        await tooltip
            .filter({ hasText: 'More messages may exist outside this window.' })
            .waitFor();

        await page.locator('[data-thread-id="thread-1"]').click();
        await page
            .getByRole('button', { name: 'Sync status: Loading', exact: true })
            .waitFor();
        await sync.focus();
        await tooltip
            .filter({ hasText: 'Selected history: Loading' })
            .waitFor();
        await page.locator('[data-thread-id="thread-0"]').click();
        await page
            .getByRole('button', { name: 'Sync status: Fresh', exact: true })
            .waitFor();

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await sync.focus();
        await page.getByRole('tab', { name: 'Settings', exact: true }).click();
        assert.equal(await tooltip.count(), 0);
        await page
            .getByRole('switch', { name: 'Animations', checked: false })
            .waitFor();
        assert.equal(await sync.count(), 1);
        assert.equal(
            await original!.evaluate((element) => element.isConnected),
            true,
        );
        await sync.focus();
        await tooltip.filter({ hasText: 'Selected history: Fresh' }).waitFor();
        await page.getByRole('switch', { name: 'Animations' }).click();
        await page
            .getByRole('switch', { name: 'Animations', checked: true })
            .waitFor();
        assert.equal(await tooltip.count(), 0);
        await page.getByRole('tab', { name: 'Chats', exact: true }).click();
        await page
            .getByRole('button', { name: 'Sync status: Fresh', exact: true })
            .waitFor();
        assert.equal(
            await page.evaluate(() => window.solidTest.connections),
            1,
        );
        assert.equal(await page.evaluate(() => window.solidTest.refreshes), 0);
        assert.deepEqual(errors, []);
    } finally {
        await page.close();
    }
});

test('shared sync status prioritizes failures and unavailable resources without removing recovery', async () => {
    const { page, errors } = await openInbox();

    try {
        await page.locator('[data-thread-id="thread-0"]').click();
        const sync = page.getByRole('button', { name: /^Sync status:/ });
        const tooltip = page.getByRole('tooltip');
        const conversation = page.getByRole('region', {
            name: 'Conversation',
            exact: true,
        });
        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.inbox.availability = 'absent';
            projection.histories['thread-0'] = {
                threadId: 'thread-0',
                orderedIds: [],
                fetchedAt: 0,
                hasNextPage: false,
                availability: 'absent',
                freshness: 'stale',
                synchronization: 'refreshing',
            };
            window.solidTest.send(projection, 2);
        });
        await page
            .getByRole('button', {
                name: 'Sync status: Unavailable',
                exact: true,
            })
            .waitFor();
        await sync.focus();
        await tooltip.filter({ hasText: 'Inbox: Unavailable' }).waitFor();
        await tooltip
            .filter({ hasText: 'Selected history: Loading' })
            .waitFor();
        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.inbox.synchronization = 'refreshing';
            projection.histories['thread-0'].synchronization = 'error';
            projection.histories['thread-0'].error = {
                kind: 'offline',
                message: 'History connection unavailable',
            };
            window.solidTest.send(projection, 3);
        });
        await page
            .getByRole('button', {
                name: 'Sync status: Sync failed',
                exact: true,
            })
            .waitFor();
        await tooltip.filter({ hasText: 'Inbox: Loading' }).waitFor();
        await tooltip
            .filter({ hasText: 'Selected history: Sync failed' })
            .waitFor();
        await tooltip.filter({ hasText: 'Content is unavailable.' }).waitFor();
        await conversation
            .getByRole('alert')
            .filter({ hasText: 'History connection unavailable' })
            .waitFor();
        await conversation
            .getByRole('button', { name: 'Retry', exact: true })
            .click();
        assert.equal(
            await page.evaluate(() => window.solidTest.historyRefreshes),
            1,
        );

        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.histories['thread-0'].availability = 'present';
            window.solidTest.send(projection, 4);
        });
        await sync.focus();
        await tooltip
            .filter({ hasText: 'Loaded content remains available.' })
            .waitFor();
        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.inbox.availability = 'present';
            projection.inbox.synchronization = 'idle';
            delete projection.histories['thread-0'].error;
            projection.histories['thread-0'].synchronization = 'refreshing';
            window.solidTest.send(projection, 5);
        });
        await page
            .getByRole('button', {
                name: 'Sync status: Refreshing',
                exact: true,
            })
            .waitFor();
        assert.equal(await conversation.getByRole('alert').count(), 0);
        await page.evaluate(() => {
            const projection = structuredClone(window.solidTest.current);
            projection.histories['thread-0'].availability = 'absent';
            projection.histories['thread-0'].synchronization = 'idle';
            window.solidTest.send(projection, 6);
        });
        await page
            .getByRole('button', {
                name: 'Sync status: Unavailable',
                exact: true,
            })
            .waitFor();
        await page.getByRole('tab', { name: 'Settings', exact: true }).click();
        await page
            .getByRole('button', {
                name: 'Sync status: Unavailable',
                exact: true,
            })
            .waitFor();
        await page.getByRole('tab', { name: 'Chats', exact: true }).click();
        await page.evaluate(() => {
            window.location.hash = '#/';
        });
        await page
            .getByRole('button', { name: 'Sync status: Fresh', exact: true })
            .waitFor();
        await sync.focus();
        assert.equal(await tooltip.getByText(/Selected history:/).count(), 0);
        assert.deepEqual(errors, []);
    } finally {
        await page.close();
    }
});
