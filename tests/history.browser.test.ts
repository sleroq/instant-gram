import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import type { InboxProjection } from '../lib/engine/inbox.ts';
import type { SnapshotMessage } from '../lib/engine/protocol.ts';
import type { Message } from '../lib/domain.ts';
import { buildExtension } from './browser-build.ts';

type TestProjection = InboxProjection;
type TestSnapshot = SnapshotMessage;
type TestCommand = { kind: string; threadId?: string };
type TestActivePort = {
    messages: Set<(value: TestSnapshot) => void>;
    disconnects: Set<() => void>;
};

declare global {
    interface Window {
        historyTest: {
            current: TestProjection;
            commands: TestCommand[];
            send(next: TestProjection, sequence: number): void;
        };
    }
}

let browser: Browser;
let server: PreviewServer;
let baseUrl: string;
let historyOutput: string;

test.before(async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    historyOutput = `${root}/.output/history-browser`;
    await buildExtension(root, historyOutput);
    server = await preview({
        configFile: false,
        root,
        build: { outDir: historyOutput },
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

async function openHistory(width = 1100): Promise<Page> {
    const page = await browser.newPage({
        viewport: { width, height: 700 },
    });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(5_000);
    await page.addInitScript(() => {
        const ids = Array.from(
            { length: 120 },
            (_, index) => `message-${index}`,
        );
        const messagesById: Record<string, Message> = Object.fromEntries(
            ids.map((id, index) => [
                id,
                {
                    id,
                    ts: 1_700_000_000_000 + index * 60_000,
                    kind: 'text',
                    text: `Message ${index}`,
                    senderId: index % 2 ? 'viewer' : 'peer',
                },
            ]),
        );
        const projection: InboxProjection = {
            accountId: 'account-a',
            accountEpoch: 1,
            workerEpoch: 'worker-a',
            commitRevision: 1,
            entities: {
                threadsById: {
                    'thread-0': {
                        key: 'thread-0',
                        title: 'Cached conversation',
                        isGroup: false,
                        isMuted: false,
                        folder: 'PRIMARY',
                        lastActivityMs: 1,
                        isUnread: false,
                        serverIsPin: false,
                        userIds: ['peer', 'viewer'],
                    },
                },
                usersById: {
                    peer: {
                        id: 'peer',
                        username: 'peer',
                        fullName: 'Peer',
                        picUrl: null,
                    },
                    viewer: {
                        id: 'viewer',
                        username: 'viewer',
                        fullName: 'Viewer',
                        picUrl: null,
                    },
                },
                messagesById,
            },
            inbox: {
                orderedIds: ['thread-0'],
                fetchedAt: 1,
                hasNextPage: false,
                availability: 'present',
                freshness: 'fresh',
                synchronization: 'idle',
            },
            histories: {
                'thread-0': {
                    threadId: 'thread-0',
                    orderedIds: ids,
                    fetchedAt: 1,
                    hasNextPage: false,
                    availability: 'present',
                    freshness: 'fresh',
                    synchronization: 'idle',
                    viewerId: 'viewer',
                },
            },
        };
        const inboxIds = Array.from(
            { length: 100 },
            (_, index) => `thread-${index}`,
        );
        projection.inbox.orderedIds = inboxIds;
        projection.entities.threadsById = Object.fromEntries(
            inboxIds.map((id) => [
                id,
                {
                    key: id,
                    title: id === 'thread-0' ? 'Cached conversation' : id,
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
        let active: TestActivePort | undefined;
        let sequence = 1;
        window.historyTest = {
            current: projection,
            commands: [],
            send(next, nextSequence) {
                this.current = next;
                sequence = nextSequence;
                active?.messages.forEach((listener) =>
                    listener({ kind: 'snapshot', sequence, projection: next }),
                );
            },
        };
        Object.assign(globalThis, {
            chrome: {
                runtime: {
                    id: 'test',
                    lastError: undefined,
                    connect: () => {
                        const connection: TestActivePort = {
                            messages: new Set(),
                            disconnects: new Set(),
                        };
                        active = connection;
                        return {
                            onMessage: {
                                addListener: (
                                    listener: (value: TestSnapshot) => void,
                                ) => connection.messages.add(listener),
                                removeListener: (
                                    listener: (value: TestSnapshot) => void,
                                ) => connection.messages.delete(listener),
                            },
                            onDisconnect: {
                                addListener: (listener: () => void) =>
                                    connection.disconnects.add(listener),
                                removeListener: (listener: () => void) =>
                                    connection.disconnects.delete(listener),
                            },
                            postMessage: (command: TestCommand) => {
                                window.historyTest.commands.push(command);
                                if (
                                    command.kind === 'subscribe' &&
                                    !command.threadId
                                )
                                    queueMicrotask(() =>
                                        window.historyTest.send(
                                            window.historyTest.current,
                                            command.threadId
                                                ? sequence + 1
                                                : sequence,
                                        ),
                                    );
                            },
                            disconnect() {
                                connection.disconnects.forEach((listener) =>
                                    listener(),
                                );
                            },
                        };
                    },
                },
            },
        });
    });
    await page.goto(`${baseUrl}/ui.html`);
    await page.getByText('Cached conversation').waitFor();
    await page.getByRole('button', { name: 'Cached conversation' }).click();
    await page
        .getByRole('heading', { name: 'Cached conversation' })
        .waitFor({ state: 'attached' });
    assert.deepEqual(
        await page.evaluate(() => window.historyTest.commands.at(-1)),
        { kind: 'subscribe', threadId: 'thread-0' },
    );
    await page.locator('[data-message-id="message-119"]').waitFor();
    return page;
}

test('cached history stays bounded and local traversal sends no older request', async () => {
    const page = await openHistory();
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    const before = await page.evaluate(
        () => window.historyTest.commands.length,
    );
    await page.locator('.solid-history__viewport').evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
    });
    assert.equal(
        await page.evaluate(() => window.historyTest.commands.length),
        before,
    );
    await page.close();
});

test('prepending cached history keeps the logical first visible message anchored', async () => {
    const page = await openHistory();
    const viewport = page.locator('.solid-history__viewport');
    await viewport.evaluate((element) => {
        element.scrollTop = 10;
        element.dispatchEvent(new Event('scroll'));
    });
    const before = await page
        .locator('[data-message-id="message-80"]')
        .boundingBox();
    assert.ok(before);
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        const oldIds = next.histories['thread-0'].orderedIds;
        const older = Array.from(
            { length: 40 },
            (_, index) => `older-${index}`,
        );
        next.histories['thread-0'].orderedIds = [...older, ...oldIds];
        for (const [index, id] of older.entries()) {
            const template = next.entities.messagesById['message-0'];
            if (template && template.kind === 'text')
                next.entities.messagesById[id] = {
                    ...template,
                    id,
                    ts: 1_699_000_000_000 + index * 60_000,
                    text: `Older ${index}`,
                };
        }
        window.historyTest.send(next, 2);
    });
    await page.waitForTimeout(30);
    const after = await page
        .locator('[data-message-id="message-80"]')
        .boundingBox();
    assert.ok(after);
    assert.ok(
        Math.abs(after.y - before.y) < 1,
        `anchor moved ${after.y - before.y}px`,
    );
    await page.close();
});

test(
    'cached selection survives compact navigation and browser history traversal',
    { timeout: 30_000 },
    async () => {
        const page = await openHistory(600);
        await page.evaluate(() => {
            window.location.hash = '#/';
        });
        await page
            .getByRole('button', { name: 'Cached conversation' })
            .waitFor();
        await page.evaluate(() => {
            const inbox = document.querySelector<HTMLElement>(
                '[aria-label="Primary inbox"]',
            );
            if (!inbox) throw new Error('inbox not mounted');
            inbox.scrollTop = 50;
            inbox.dispatchEvent(new Event('scroll'));
        });
        await page.waitForFunction(() =>
            Boolean(document.querySelector('[data-thread-id="thread-0"]')),
        );
        await page.evaluate(() =>
            document
                .querySelector<HTMLButtonElement>('[data-thread-id="thread-0"]')
                ?.click(),
        );
        await page.waitForFunction(
            () => window.location.hash === '#/thread/thread-0',
        );
        await page.evaluate(() => {
            document
                .querySelector<HTMLButtonElement>('.solid-conversation button')
                ?.click();
        });
        await page.waitForFunction(() => window.location.hash === '#/');
        assert.equal(await page.evaluate(() => window.location.hash), '#/');
        assert.equal(
            await page.evaluate(() =>
                document.activeElement?.getAttribute('data-thread-id'),
            ),
            'thread-0',
        );
        await page.evaluate(() =>
            document
                .querySelector<HTMLButtonElement>('[data-thread-id="thread-0"]')
                ?.click(),
        );
        await page.waitForFunction(
            () => window.location.hash === '#/thread/thread-0',
        );
        await page.evaluate(() => window.history.back());
        await page.waitForFunction(() => window.location.hash === '#/');
        await page.evaluate(() => window.history.forward());
        await page.waitForFunction(
            () => window.location.hash === '#/thread/thread-0',
        );
        await page.close({ runBeforeUnload: false });
    },
);

test('message variants remain accessible and do not create provider work', async () => {
    const page = await openHistory();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        const base = next.entities.messagesById['message-80'];
        if (!base || base.kind !== 'text')
            throw new Error('text fixture missing');
        const image =
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        next.entities.messagesById['message-80'] = {
            ...base,
            kind: 'image',
            images: [{ url: image, width: 1, height: 1 }],
        };
        next.entities.messagesById['message-81'] = {
            ...base,
            id: 'message-81',
            kind: 'reel_share',
            mediaType: 'reel',
            shortcode: 'abc',
            targetUrl: 'https://www.instagram.com/reel/abc/',
            thumbUrl: image,
            author: 'Peer',
            caption: 'Shared reel',
        };
        next.entities.messagesById['message-82'] = {
            ...base,
            id: 'message-82',
            kind: 'inline_share',
            thumbUrl: image,
            title: 'Shared post',
            targetUrl: 'https://www.instagram.com/p/abc/',
        };
        next.entities.messagesById['message-83'] = {
            ...base,
            id: 'message-83',
            kind: 'unsupported',
            contentType: 'future',
            fallback: {
                label: 'Unavailable attachment',
                preview: 'Not available',
            },
        };
        next.entities.messagesById['message-84'] = {
            ...base,
            id: 'message-84',
            kind: 'text',
            text: 'Reply body',
            replyPreview: { kind: 'text', text: 'Original message' },
        };
        window.historyTest.send(next, 2);
    });
    await page.getByText('Shared a reel').waitFor();
    await page.getByText('Shared post').waitFor();
    await page.getByText('Unavailable attachment').waitFor();
    await page.getByLabel('Reply preview').waitFor();
    assert.equal(await page.locator('a[target="_blank"]').count(), 2);
    assert.equal(
        await page.evaluate(
            () =>
                window.historyTest.commands.filter(
                    (command) => command.kind !== 'subscribe',
                ).length,
        ),
        0,
    );
    await page.close();
});

test('missing history mounts late and short fill requests once without retrying errors', async () => {
    const page = await openHistory();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.histories = {};
        window.historyTest.send(next, 2);
    });
    await page.getByText('Loading history…').waitFor();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        const ids = Array.from(
            { length: 120 },
            (_, index) => `message-${index}`,
        );
        next.histories['thread-0'] = {
            threadId: 'thread-0',
            orderedIds: ids,
            fetchedAt: 2,
            hasNextPage: false,
            availability: 'present',
            freshness: 'fresh',
            synchronization: 'idle',
            viewerId: 'viewer',
        };
        window.historyTest.send(next, 3);
    });
    await page.locator('[data-message-id="message-119"]').waitFor();

    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.histories['thread-0'].orderedIds = ['message-0', 'message-1'];
        next.histories['thread-0'].hasNextPage = true;
        next.histories['thread-0'].synchronization = 'idle';
        window.historyTest.send(next, 4);
    });
    function loadCount() {
        return page.evaluate(
            () =>
                window.historyTest.commands.filter(
                    (command) => command.kind === 'load-older-history',
                ).length,
        );
    }
    await page.waitForFunction(() =>
        window.historyTest.commands.some(
            (command) => command.kind === 'load-older-history',
        ),
    );
    assert.equal(await loadCount(), 1);
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.histories['thread-0'].synchronization = 'error';
        next.histories['thread-0'].error = {
            kind: 'protocol',
            message: 'Older history failed.',
        };
        window.historyTest.send(next, 5);
    });
    await page.getByText('Older history failed.').waitFor();
    await page.waitForTimeout(30);
    assert.equal(await loadCount(), 1);
    await page.close();
});

test('desktop separator responds to keyboard and pointer bounds', async () => {
    const page = await openHistory();
    const separator = page.getByRole('separator', {
        name: 'Resize conversations',
    });
    await separator.press('Home');
    assert.equal(await separator.getAttribute('aria-valuenow'), '280');
    await separator.press('ArrowRight');
    assert.equal(await separator.getAttribute('aria-valuenow'), '296');
    await separator.press('End');
    assert.equal(await separator.getAttribute('aria-valuenow'), '520');
    const box = await separator.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + 3, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(420, box.y + 100);
    await page.mouse.up();
    assert.equal(await separator.getAttribute('aria-valuenow'), '420');
    assert.ok(
        await page.locator('.solid-layout').evaluate((element) => {
            const columns =
                getComputedStyle(element).gridTemplateColumns.split(' ');
            return Number.parseFloat(columns[2]) >= 320;
        }),
    );
    await page.close();
});

test('a direct compact route has a safe in-app Back destination', async () => {
    const page = await browser.newPage({
        viewport: { width: 600, height: 700 },
    });
    await page.addInitScript(() => {
        Object.assign(globalThis, {
            chrome: {
                runtime: {
                    id: 'test',
                    lastError: undefined,
                    connect: () => {
                        const messages = new Set<
                            (value: TestSnapshot) => void
                        >();
                        const disconnects = new Set<() => void>();
                        return {
                            onMessage: {
                                addListener: (
                                    listener: (value: TestSnapshot) => void,
                                ) => messages.add(listener),
                                removeListener: (
                                    listener: (value: TestSnapshot) => void,
                                ) => messages.delete(listener),
                            },
                            onDisconnect: {
                                addListener: (listener: () => void) =>
                                    disconnects.add(listener),
                                removeListener: (listener: () => void) =>
                                    disconnects.delete(listener),
                            },
                            postMessage() {},
                            disconnect() {
                                disconnects.forEach((listener) => listener());
                            },
                        };
                    },
                },
            },
        });
    });
    await page.goto(`${baseUrl}/ui.html#/thread/not-loaded`);
    await page.getByRole('button', { name: 'Back' }).waitFor();
    await page.getByRole('button', { name: 'Back' }).click();
    assert.equal(await page.evaluate(() => window.location.hash), '#/');
    await page.close();
});
