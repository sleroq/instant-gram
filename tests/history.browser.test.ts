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
type TestCommand = { kind: string; threadId?: string; anchorId?: string };
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
            restart(): void;
            boundedStart?: number;
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

async function openHistory(
    width = 1100,
    options: { checking?: boolean; bounded?: boolean } = {},
): Promise<Page> {
    const page = await browser.newPage({
        viewport: { width, height: 700 },
    });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(5_000);
    await page.addInitScript((options) => {
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
        projection.entities.messagesById['thread-1-message'] = {
            id: 'thread-1-message',
            ts: 1_700_100_000_000,
            kind: 'text',
            text: 'Second conversation message',
            senderId: 'peer',
        };
        projection.histories['thread-1'] = {
            threadId: 'thread-1',
            orderedIds: ['thread-1-message'],
            fetchedAt: 1,
            hasNextPage: false,
            availability: 'present',
            freshness: 'fresh',
            synchronization: 'idle',
            viewerId: 'viewer',
        };
        let boundedStart = 1000;
        if (options.bounded) {
            for (let index = 0; index < 1400; index++) {
                const id = `message-${index}`;
                projection.entities.messagesById[id] = {
                    id,
                    ts: 1_700_000_000_000 + index * 60_000,
                    kind: 'text',
                    text: `Message ${index}`,
                    senderId: 'peer',
                };
            }
            projection.histories['thread-0'].orderedIds = Array.from(
                { length: 400 },
                (_, index) => `message-${1000 + index}`,
            );
            projection.histories['thread-0'].cachedOlder = true;
            projection.histories['thread-0'].cachedNewer = false;
        }
        const authorized = structuredClone(projection);
        if (options.checking) {
            projection.accountId = null;
            projection.accountEpoch = 0;
            projection.inbox.orderedIds = [];
            projection.histories = {};
        }
        let active: TestActivePort | undefined;
        let sequence = 1;
        window.historyTest = {
            current: projection,
            commands: [],
            boundedStart,
            restart() {
                active?.disconnects.forEach((listener) => listener());
            },
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
                        let firstSnapshot = true;
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
                                    options.bounded &&
                                    (command.kind === 'load-older-history' ||
                                        command.kind === 'load-newer-history')
                                ) {
                                    boundedStart = Math.max(
                                        0,
                                        Math.min(
                                            1000,
                                            boundedStart +
                                                (command.kind ===
                                                'load-older-history'
                                                    ? -320
                                                    : 320),
                                        ),
                                    );
                                    window.historyTest.boundedStart =
                                        boundedStart;
                                    const next = structuredClone(
                                        window.historyTest.current,
                                    );
                                    const history = next.histories['thread-0'];
                                    history.orderedIds = Array.from(
                                        { length: 400 },
                                        (_, index) =>
                                            `message-${boundedStart + index}`,
                                    );
                                    history.cachedOlder = boundedStart > 0;
                                    history.cachedNewer = boundedStart < 1000;
                                    queueMicrotask(() =>
                                        window.historyTest.send(
                                            next,
                                            ++sequence,
                                        ),
                                    );
                                }
                                if (
                                    command.kind === 'subscribe' &&
                                    (!command.threadId ||
                                        firstSnapshot ||
                                        window.historyTest.current
                                            .workerEpoch === 'worker-restarted')
                                )
                                    queueMicrotask(() => {
                                        window.historyTest.send(
                                            window.historyTest.current,
                                            firstSnapshot ? 1 : sequence,
                                        );
                                        firstSnapshot = false;
                                        if (options.checking) {
                                            options.checking = false;
                                            requestAnimationFrame(() =>
                                                window.historyTest.send(
                                                    authorized,
                                                    ++sequence,
                                                ),
                                            );
                                        }
                                    });
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
    }, options);
    await page.goto(
        `${new URL('ui.html', baseUrl).href}${options.checking ? '#/thread/thread-0' : ''}`,
    );
    if (!options.checking) {
        await page.getByText('Cached conversation').waitFor();
        await page.getByRole('button', { name: 'Cached conversation' }).click();
    }
    await page
        .getByRole('heading', { name: 'Cached conversation' })
        .waitFor({ state: 'attached' });
    assert.deepEqual(
        await page.evaluate(() =>
            window.historyTest.commands.find(
                (command) =>
                    command.kind === 'subscribe' &&
                    command.threadId === 'thread-0',
            ),
        ),
        { kind: 'subscribe', threadId: 'thread-0' },
    );
    await page
        .locator(`[data-message-id="message-${options.bounded ? 1399 : 119}"]`)
        .waitFor();
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

test('newer cached boundaries preserve the first visible row and pixel offset', async () => {
    const page = await openHistory();
    const viewport = page.locator('.solid-history__viewport');
    for (let index = 0; index < 3; index++) {
        await viewport.evaluate((element) => {
            element.scrollTop = 0;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(30);
    }
    for (let index = 0; index < 2; index++) {
        const before = await viewport.evaluate((element) => {
            element.scrollTop = element.scrollHeight - element.clientHeight;
            const boundary =
                element.getBoundingClientRect().top + element.clientTop;
            const row = [
                ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
            ].find((row) => row.getBoundingClientRect().bottom > boundary)!;
            const result = {
                id: row.dataset.messageId!,
                y: row.getBoundingClientRect().top,
            };
            element.dispatchEvent(new Event('scroll'));
            return result;
        });
        await page.waitForTimeout(30);
        const after = await page
            .locator(`[data-message-id="${before.id}"]`)
            .boundingBox();
        assert.ok(after);
        assert.ok(Math.abs(after.y - before.y) < 1);
        assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    }
    await page.close();
});

test('compact inbox waits for hydration then restores exact pixels and focus', async () => {
    const page = await openHistory(600);
    await page.evaluate(() => {
        window.location.hash = '#/';
    });
    const inbox = page.locator('.solid-inbox__viewport');
    await inbox.waitFor();
    await inbox.evaluate((element) => {
        element.scrollTop = 733;
        element.dispatchEvent(new Event('scroll'));
    });
    await page.locator('[data-thread-id="thread-11"]').click();
    await page.locator('.solid-conversation').waitFor();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.inbox.orderedIds = [];
        window.historyTest.send(next, 2);
        window.location.hash = '#/';
    });
    await inbox.waitFor();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.inbox.orderedIds = Array.from(
            { length: 100 },
            (_, index) => `thread-${index}`,
        );
        window.historyTest.send(next, 3);
    });
    await page.waitForFunction(
        () =>
            document.activeElement?.getAttribute('data-thread-id') ===
            'thread-11',
    );
    assert.equal(await inbox.evaluate((element) => element.scrollTop), 733);
    assert.ok((await page.locator('[data-thread-id]').count()) <= 31);
    await page.close();
});

test('delayed image growth above the viewport preserves the message anchor', async () => {
    const page = await openHistory();
    const viewport = page.locator('.solid-history__viewport');
    const before = await viewport.evaluate((element) => {
        element.scrollTop = 500;
        element.dispatchEvent(new Event('scroll'));
        const boundary =
            element.getBoundingClientRect().top + element.clientTop;
        const row = [
            ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
        ].find((row) => row.getBoundingClientRect().bottom > boundary)!;
        const image = document.createElement('img');
        image.alt = 'Delayed image fixture';
        image.style.height = '1px';
        image.style.display = 'block';
        element.querySelector('[data-message-id]')!.append(image);
        return {
            id: row.dataset.messageId!,
            y: row.getBoundingClientRect().top,
        };
    });
    await page.waitForTimeout(30);
    await viewport.locator('img').evaluate((image) => {
        image.style.height = '240px';
    });
    await page.waitForTimeout(50);
    const after = await page
        .locator(`[data-message-id="${before.id}"]`)
        .boundingBox();
    assert.ok(after);
    assert.ok(Math.abs(after.y - before.y) < 1);
    await page.close();
});

test('malformed hash falls back to inbox', async () => {
    const page = await openHistory(600);
    await page.evaluate(() => {
        window.location.hash = '#/thread/%E0%A4%A';
    });
    await page
        .getByRole('heading', { name: 'Messages', exact: true })
        .waitFor();
    assert.equal(await page.locator('.solid-conversation').count(), 0);
    await page.close();
});

test('separator End reserves conversation and separator width at 720px', async () => {
    const page = await openHistory(720);
    const separator = page.getByRole('separator');
    await separator.focus();
    await separator.press('End');
    assert.equal(await separator.getAttribute('aria-valuemax'), '392');
    assert.equal(await separator.getAttribute('aria-valuenow'), '392');
    assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= 720),
    );
    await page.setViewportSize({ width: 700, height: 700 });
    await page.waitForFunction(
        () =>
            document
                .querySelector('[role="separator"]')
                ?.getAttribute('aria-valuemax') === '372',
    );
    assert.equal(await separator.getAttribute('aria-valuemax'), '372');
    await page.close();
});

for (const accountId of [null, 'account-a']) {
    test(`account epoch reset clears route for ${accountId}`, async () => {
        const page = await openHistory(600);
        await page.evaluate((accountId) => {
            const next = structuredClone(window.historyTest.current);
            next.accountId = accountId;
            next.accountEpoch++;
            window.historyTest.send(next, 2);
        }, accountId);
        await page.waitForFunction(() => window.location.hash === '#/');
        assert.equal(await page.locator('.solid-conversation').count(), 0);
        await page.close();
    });
}

test('desktop routing switches between selected conversations', async () => {
    const page = await openHistory();
    await page.locator('[data-thread-id="thread-1"]').click();
    await page.getByRole('heading', { name: 'thread-1' }).waitFor();
    await page.getByText('Second conversation message').waitFor();
    assert.equal(
        await page.evaluate(() => window.location.hash),
        '#/thread/thread-1',
    );
    assert.deepEqual(
        await page.evaluate(() => window.historyTest.commands.at(-1)),
        { kind: 'subscribe', threadId: 'thread-1' },
    );
    await page.close();
});

test('desktop chat switching restores each conversation scroll anchor', async () => {
    const page = await openHistory();
    const viewport = page.locator('.solid-history__viewport');
    await viewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight / 2;
        element.dispatchEvent(new Event('scroll'));
    });
    const before = await viewport.evaluate((element) => {
        const boundary = element.getBoundingClientRect().top;
        const row = [
            ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
        ]
            .map((item) => ({ item, rect: item.getBoundingClientRect() }))
            .find(({ rect }) => rect.bottom > boundary)!;
        return {
            id: row.item.dataset.messageId,
            offset: boundary - row.rect.top,
        };
    });

    await page.locator('[data-thread-id="thread-1"]').click();
    await page.getByText('Second conversation message').waitFor();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        delete next.histories['thread-0'];
        window.historyTest.send(next, 2);
    });
    await page.locator('[data-thread-id="thread-0"]').click();
    await page.getByText('Loading history…').waitFor();
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.histories['thread-0'] = structuredClone(
            window.historyTest.current.histories['thread-1'],
        );
        next.histories['thread-0'].threadId = 'thread-0';
        next.histories['thread-0'].orderedIds = Array.from(
            { length: 120 },
            (_, index) => `message-${index}`,
        );
        window.historyTest.send(next, 3);
    });
    await page.locator(`[data-message-id="${before.id}"]`).waitFor();

    const after = await viewport.evaluate((element) => {
        const boundary = element.getBoundingClientRect().top;
        const row = [
            ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
        ]
            .map((item) => ({ item, rect: item.getBoundingClientRect() }))
            .find(({ rect }) => rect.bottom > boundary)!;
        return {
            id: row.item.dataset.messageId,
            offset: boundary - row.rect.top,
        };
    });
    assert.equal(after.id, before.id);
    assert.ok(
        Math.abs(after.offset - before.offset) < 1,
        `anchor offset moved ${after.offset - before.offset}px`,
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
    await page.goto(`${new URL('ui.html', baseUrl).href}#/thread/not-loaded`);
    await page.getByRole('button', { name: 'Back' }).waitFor();
    await page.getByRole('button', { name: 'Back' }).click();
    assert.equal(await page.evaluate(() => window.location.hash), '#/');
    await page.close();
});

for (const checkingEpoch of [0, 1])
    test(`checked-empty bootstrap and same-account worker restart preserve the logical route at checking epoch ${checkingEpoch}`, async () => {
        const page = await openHistory(600, { checking: true });
        const viewport = page.locator('.solid-history__viewport');
        const anchor = await viewport.evaluate((element) => {
            element.scrollTop = 450;
            element.dispatchEvent(new Event('scroll'));
            const top = element.getBoundingClientRect().top + element.clientTop;
            const row = [
                ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
            ].find((item) => item.getBoundingClientRect().bottom > top)!;
            return {
                id: row.dataset.messageId!,
                offset: top - row.getBoundingClientRect().top,
            };
        });
        await page.evaluate((checkingEpoch) => {
            const authorized = structuredClone(window.historyTest.current);
            authorized.workerEpoch = 'worker-restarted';
            const checking = structuredClone(authorized);
            checking.accountId = null;
            checking.accountEpoch = checkingEpoch;
            checking.entities = {
                threadsById: {},
                usersById: {},
                messagesById: {},
            };
            checking.histories = {};
            checking.inbox.orderedIds = [];
            window.historyTest.current = checking;
            const commandCount = window.historyTest.commands.length;
            window.historyTest.restart();
            const publish = () => {
                if (
                    !window.historyTest.commands
                        .slice(commandCount)
                        .some((command) => command.anchorId)
                ) {
                    requestAnimationFrame(publish);
                    return;
                }
                window.historyTest.send(authorized, 2);
            };
            requestAnimationFrame(publish);
        }, checkingEpoch);
        await page.waitForFunction(
            (id) =>
                window.historyTest.commands.some(
                    (command) =>
                        command.kind === 'subscribe' &&
                        command.threadId === 'thread-0' &&
                        command.anchorId === id,
                ),
            anchor.id,
        );
        await page.waitForFunction(
            () => window.historyTest.current.accountId === 'account-a',
        );
        await page.locator(`[data-message-id="${anchor.id}"]`).waitFor();
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() => resolve()),
                ),
        );
        assert.equal(
            await page.evaluate(() => location.hash),
            '#/thread/thread-0',
        );
        const offset = await viewport.evaluate((element, id) => {
            const row = element.querySelector<HTMLElement>(
                `[data-message-id="${id}"]`,
            )!;
            return (
                element.getBoundingClientRect().top +
                element.clientTop -
                row.getBoundingClientRect().top
            );
        }, anchor.id);
        assert.ok(
            Math.abs(offset - anchor.offset) <= 1,
            `restart offset ${anchor.offset} -> ${offset}`,
        );
        await page.close();
    });

test('a restarted worker with authoritative auth failure clears the prior route', async () => {
    const page = await openHistory(600);
    await page.locator('[data-message-id]').first().waitFor();
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                ),
            ),
    );
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.workerEpoch = 'worker-auth-missing';
        next.accountId = null;
        next.accountEpoch = 1;
        next.entities = { threadsById: {}, usersById: {}, messagesById: {} };
        next.histories = {};
        next.inbox.orderedIds = [];
        next.inbox.synchronization = 'error';
        next.inbox.error = {
            kind: 'auth',
            message: 'Authentication unavailable.',
        };
        window.historyTest.send(next, 2);
    });
    await page.waitForFunction(() => location.hash === '#/');
    assert.equal(await page.locator('.solid-conversation').count(), 0);
    await page.close();
});

test('new account inbox callbacks restore scroll and focus after identity reset', async () => {
    const page = await openHistory(600);
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.accountId = 'account-b';
        next.accountEpoch++;
        window.historyTest.send(next, 2);
    });
    await page.waitForFunction(() => location.hash === '#/');
    const inbox = page.locator('.solid-inbox__viewport');
    await inbox.evaluate((element) => {
        element.scrollTop = 720;
        element.dispatchEvent(new Event('scroll'));
    });
    await page.locator('[data-thread-id="thread-10"]').click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(
        () =>
            document.activeElement?.getAttribute('data-thread-id') ===
            'thread-10',
    );
    assert.equal(await inbox.evaluate((element) => element.scrollTop), 720);
    await page.close();
});

test('bounded worker windows traverse exhausted cached history without cursor or request loops', async () => {
    const page = await openHistory(1100, { bounded: true });
    const viewport = page.locator('.solid-history__viewport');
    for (const direction of ['older', 'newer'] as const) {
        const target = direction === 'older' ? 0 : 1000;
        for (let step = 0; step < 60; step++) {
            const start = await page.evaluate(
                () => window.historyTest.boundedStart,
            );
            if (start === target) break;
            const before = await viewport.evaluate((element, direction) => {
                element.scrollTop =
                    direction === 'older'
                        ? 0
                        : element.scrollHeight - element.clientHeight;
                const top =
                    element.getBoundingClientRect().top + element.clientTop;
                const row = [
                    ...element.querySelectorAll<HTMLElement>(
                        '[data-message-id]',
                    ),
                ].find((item) => item.getBoundingClientRect().bottom > top)!;
                const result = {
                    id: row.dataset.messageId!,
                    offset: top - row.getBoundingClientRect().top,
                    commands: window.historyTest.commands.length,
                    first: element.querySelector<HTMLElement>(
                        '[data-message-id]',
                    )!.dataset.messageId,
                };
                element.dispatchEvent(new Event('scroll'));
                return result;
            }, direction);
            await page.waitForFunction((before) => {
                const first =
                    document.querySelector<HTMLElement>('[data-message-id]')
                        ?.dataset.messageId;
                return (
                    first !== before.first ||
                    window.historyTest.commands.length > before.commands
                );
            }, before);
            await page.evaluate(
                () =>
                    new Promise<void>((resolve) =>
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolve()),
                        ),
                    ),
            );
            const afterStart = await page.evaluate(
                () => window.historyTest.boundedStart,
            );
            if (afterStart !== start) {
                const offset = await viewport.evaluate((element, id) => {
                    const row = element.querySelector<HTMLElement>(
                        `[data-message-id="${id}"]`,
                    );
                    if (!row) throw new Error(`lost boundary ${id}`);
                    return (
                        element.getBoundingClientRect().top +
                        element.clientTop -
                        row.getBoundingClientRect().top
                    );
                }, before.id);
                assert.ok(
                    Math.abs(offset - before.offset) <= 1,
                    `shift lost ${before.id} offset ${before.offset} -> ${offset}`,
                );
                assert.equal(
                    await page.evaluate(
                        (count) => window.historyTest.commands.length - count,
                        before.commands,
                    ),
                    1,
                );
            }
            assert.ok((await page.locator('[data-message-id]').count()) <= 80);
            assert.equal(
                await page.evaluate(
                    () =>
                        window.historyTest.current.histories['thread-0']
                            .orderedIds.length,
                ),
                400,
            );
        }
        assert.equal(
            await page.evaluate(() => window.historyTest.boundedStart),
            target,
        );
    }
    const commands = await page.evaluate(() =>
        window.historyTest.commands.filter((command) =>
            command.kind.startsWith('load-'),
        ),
    );
    assert.ok(
        commands.some((command) => command.kind === 'load-older-history'),
    );
    assert.ok(
        commands.some((command) => command.kind === 'load-newer-history'),
    );
    for (const command of commands)
        assert.deepEqual(command, { kind: command.kind, threadId: 'thread-0' });
    assert.equal(
        await page.evaluate(
            () => window.historyTest.current.histories['thread-0'].hasNextPage,
        ),
        false,
    );
    await page.close();
});

test('bounded history reselection carries the saved logical anchor to the worker', async () => {
    const page = await openHistory(1100, { bounded: true });
    const viewport = page.locator('.solid-history__viewport');
    const anchor = await viewport.evaluate((element) => {
        element.scrollTop = 450;
        element.dispatchEvent(new Event('scroll'));
        const top = element.getBoundingClientRect().top + element.clientTop;
        const row = [
            ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
        ].find((item) => item.getBoundingClientRect().bottom > top)!;
        return {
            id: row.dataset.messageId!,
            offset: top - row.getBoundingClientRect().top,
        };
    });
    await page.locator('[data-thread-id="thread-1"]').click();
    await page.getByText('Second conversation message').waitFor();
    await page.locator('[data-thread-id="thread-0"]').click();
    await page.locator(`[data-message-id="${anchor.id}"]`).waitFor();
    const command = await page.evaluate(() =>
        window.historyTest.commands.findLast(
            (item) => item.kind === 'subscribe' && item.threadId === 'thread-0',
        ),
    );
    assert.deepEqual(command, {
        kind: 'subscribe',
        threadId: 'thread-0',
        anchorId: anchor.id,
    });
    const offset = await viewport.evaluate((element, id) => {
        const row = element.querySelector<HTMLElement>(
            `[data-message-id="${id}"]`,
        )!;
        return (
            element.getBoundingClientRect().top +
            element.clientTop -
            row.getBoundingClientRect().top
        );
    }, anchor.id);
    assert.ok(Math.abs(offset - anchor.offset) <= 1);
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    await page.close();
});

test('a previous cached range preserves its boundary and only explicitly jumps to latest', async () => {
    const page = await openHistory();
    const viewport = page.locator('.solid-history__viewport');
    const before = await viewport.evaluate((element) => {
        element.scrollTop = 450;
        element.dispatchEvent(new Event('scroll'));
        const top = element.getBoundingClientRect().top + element.clientTop;
        const row = [
            ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
        ].find((item) => item.getBoundingClientRect().bottom > top)!;
        return {
            id: row.dataset.messageId!,
            offset: top - row.getBoundingClientRect().top,
        };
    });
    await page.evaluate(() => {
        const current = structuredClone(window.historyTest.current);
        current.histories['thread-0'].coverageGeneration = 1;
        current.histories['thread-0'].newerCoverageAvailable = true;
        current.histories['thread-0'].cachedNewer = false;
        current.histories['thread-0'].freshness = 'stale';
        window.historyTest.send(current, 2);
    });
    const latest = page.getByRole('button', { name: 'Show latest messages' });
    await latest.waitFor();
    const offset = await viewport.evaluate((element, id) => {
        const row = element.querySelector<HTMLElement>(
            `[data-message-id="${id}"]`,
        )!;
        return (
            element.getBoundingClientRect().top +
            element.clientTop -
            row.getBoundingClientRect().top
        );
    }, before.id);
    assert.ok(Math.abs(offset - before.offset) <= 1);
    assert.equal(
        await page.evaluate(() =>
            window.historyTest.commands.some(
                (c) => c.kind === 'load-newer-history',
            ),
        ),
        false,
    );
    await latest.click();
    assert.deepEqual(
        await page.evaluate(() => window.historyTest.commands.at(-1)),
        { kind: 'load-newer-history', threadId: 'thread-0' },
    );
    await page.evaluate(() => {
        const current = structuredClone(window.historyTest.current);
        current.histories['thread-0'].coverageGeneration = 2;
        current.histories['thread-0'].newerCoverageAvailable = false;
        current.histories['thread-0'].orderedIds = ['thread-1-message'];
        current.histories['thread-0'].freshness = 'fresh';
        window.historyTest.send(current, 3);
    });
    await page.locator('[data-message-id="thread-1-message"]').waitFor();
    assert.equal(await latest.count(), 0);
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    await page.close();
});
