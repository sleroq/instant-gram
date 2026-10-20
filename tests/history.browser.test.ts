import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import type { InboxProjection } from '../lib/engine/inbox.ts';
import type { SnapshotMessage } from '../lib/engine/protocol.ts';
import type { Message } from '../lib/domain.ts';
import type {
    MutationCommand,
    OperationResult,
} from '../lib/engine/operations';
import { buildExtension } from './browser-build.ts';

type TestProjection = InboxProjection;
type TestSnapshot =
    | SnapshotMessage
    | { kind: 'operation-result'; result: OperationResult };
type TestCommand = {
    kind: string;
    threadId?: string;
    anchorId?: string;
    command?: MutationCommand;
};
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
            settleSend(ok: boolean): void;
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
    options: { checking?: boolean; bounded?: boolean; composer?: boolean } = {},
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

        if (options.composer) {
            projection.entities.threadsById['thread-0'].threadFbid = 'fbid-0';
            projection.entities.threadsById['thread-1'].threadFbid = 'fbid-1';
        }

        let boundedStart = 1000;
        const corpus = { ...projection.entities.messagesById };
        function selectWindowFacts(next: InboxProjection) {
            const ids = new Set(
                Object.values(next.histories).flatMap(
                    (history) => history.orderedIds,
                ),
            );
            for (const thread of Object.values(next.entities.threadsById)) {
                if (thread.lastMessageId) ids.add(thread.lastMessageId);
            }
            next.entities.messagesById = Object.fromEntries(
                [...ids].map((id) => [id, corpus[id]]),
            );
        }
        if (options.bounded) {
            for (let index = 0; index < 1400; index++) {
                const id = `message-${index}`;
                corpus[id] = {
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
            selectWindowFacts(projection);
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
            settleSend(ok) {
                const command = this.commands.findLast(
                    (command) => command.kind === 'mutate',
                )!.command!;
                active?.messages.forEach((listener) =>
                    listener({
                        kind: 'operation-result',
                        result: ok
                            ? {
                                  ok: true,
                                  operationId: command.operationId,
                                  revision: 2,
                              }
                            : {
                                  ok: false,
                                  operationId: command.operationId,
                                  error: {
                                      kind: 'storage',
                                      message: 'Could not save',
                                  },
                              },
                    }),
                );
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
                                    selectWindowFacts(next);
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

test('separator exposes keyboard resizing, focus and responsive accessibility bounds', async () => {
    const page = await openHistory();
    const separator = page.getByRole('separator', {
        name: 'Resize conversations',
    });
    async function value(name = 'aria-valuenow') {
        return Number(await separator.getAttribute(name));
    }
    assert.equal(await separator.getAttribute('aria-orientation'), 'vertical');
    await separator.focus();
    const initial = await value();
    await separator.press('ArrowRight');
    assert.ok((await value()) > initial);
    await separator.press('ArrowLeft');
    assert.equal(await value(), initial);
    await separator.press('Home');
    assert.equal(await value(), await value('aria-valuemin'));
    await separator.press('ArrowLeft');
    assert.equal(await value(), await value('aria-valuemin'));
    await separator.press('End');
    assert.equal(await value(), await value('aria-valuemax'));
    await separator.press('ArrowRight');
    assert.equal(await value(), await value('aria-valuemax'));
    assert.equal(
        await separator.evaluate(
            (element) => element === document.activeElement,
        ),
        true,
    );
    await separator.press('Tab');
    assert.equal(
        await page
            .getByRole('button', { name: 'Refresh history' })
            .evaluate((element) => element === document.activeElement),
        true,
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
        await separator.evaluate(
            (element) => element === document.activeElement,
        ),
        true,
    );

    const wideMaximum = await value('aria-valuemax');
    await page.setViewportSize({ width: 700, height: 700 });
    await page.waitForFunction((maximum) => {
        const element = document.querySelector('[role="separator"]')!;
        return (
            Number(element.getAttribute('aria-valuemax')) < maximum &&
            element.getAttribute('aria-valuenow') ===
                element.getAttribute('aria-valuemax')
        );
    }, wideMaximum);
    assert.ok((await value()) >= (await value('aria-valuemin')));
    await page.setViewportSize({ width: 600, height: 700 });
    await separator.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(
        () =>
            document.activeElement?.getAttribute('data-thread-id') ===
            'thread-0',
    );
    assert.ok((await page.locator('[data-thread-id]').count()) <= 31);
    await page.close();
});

test('separator pointer capture ends on release, cancellation and owner disposal', async () => {
    const page = await openHistory();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const separator = page.getByRole('separator', {
        name: 'Resize conversations',
    });
    const listeners = await page.evaluateHandle(() => {
        const active = new Map<
            string,
            Set<EventListenerOrEventListenerObject>
        >();
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
        ) => {
            if (
                ['pointermove', 'pointerup', 'pointercancel'].includes(type) &&
                listener
            ) {
                if (!active.has(type)) active.set(type, new Set());
                active.get(type)!.add(listener);
            }
            add(type, listener, options);
        };
        window.removeEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
        ) => {
            if (listener) active.get(type)?.delete(listener);
            if (active.get(type)?.size === 0) active.delete(type);
            remove(type, listener, options);
        };
        return active;
    });
    const pointer = await separator.evaluateHandle(
        (element: HTMLButtonElement) => {
            const state = { id: 0 };
            element.addEventListener('pointerdown', (event) => {
                state.id = event.pointerId;
            });
            return state;
        },
    );
    function value() {
        return separator.getAttribute('aria-valuenow');
    }
    async function start() {
        const point = await separator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + 100 };
        });
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        return point;
    }
    const before = Number(await value());
    const point = await start();
    await page.mouse.move(point.x + 60, point.y);
    assert.ok(Number(await value()) > before);
    assert.equal(
        await separator.evaluate(
            (element, state) => element.hasPointerCapture(state.id),
            pointer,
        ),
        true,
    );
    const end = await listeners.evaluateHandle(
        (active) => [...active.get('pointercancel')!][0],
    );
    async function assertDragEnded() {
        assert.equal(
            await listeners.evaluate((active) => active.has('pointermove')),
            false,
        );
        assert.equal(
            await listeners.evaluate((active) => active.has('pointercancel')),
            false,
        );
        assert.equal(
            await listeners.evaluate(
                (active, end) => active.get('pointerup')?.has(end) ?? false,
                end,
            ),
            false,
        );
    }
    await page.mouse.up();
    assert.equal(
        await separator.evaluate(
            (element, state) => element.hasPointerCapture(state.id),
            pointer,
        ),
        false,
    );
    await assertDragEnded();
    const released = await value();
    await page.mouse.move(point.x + 100, point.y);
    assert.equal(await value(), released);

    await start();
    await separator.dispatchEvent('pointercancel');
    await assertDragEnded();
    assert.equal(
        await separator.evaluate(
            (element, state) => element.hasPointerCapture(state.id),
            pointer,
        ),
        false,
    );
    await page.mouse.move(point.x - 60, point.y);
    assert.equal(await value(), released);
    await page.mouse.up();

    await start();
    assert.equal(
        await listeners.evaluate((active) => active.has('pointermove')),
        true,
    );
    await page.setViewportSize({ width: 600, height: 700 });
    await separator.waitFor({ state: 'detached' });
    await assertDragEnded();
    await page.mouse.move(300, 100);
    await page.mouse.up();
    await page.setViewportSize({ width: 1100, height: 700 });
    await separator.waitFor();
    const remounted = await value();
    await page.mouse.move(500, 100);
    assert.equal(await value(), remounted);
    assert.deepEqual(errors, []);
    await page.close();
});

test('resizing preserves logical history and inbox focus within mounted-row budgets', async () => {
    const page = await openHistory();
    const viewport = page.getByLabel('Messages', { exact: true });
    await viewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight / 2;
        element.dispatchEvent(new Event('scroll'));
    });
    function visibleMessage() {
        return viewport.evaluate((element) => {
            const top = element.getBoundingClientRect().top;
            return [
                ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
            ].find((row) => row.getBoundingClientRect().bottom > top)!.dataset
                .messageId;
        });
    }
    const anchorId = await visibleMessage();
    const row = await page
        .locator(`[data-message-id="${anchorId}"]`)
        .elementHandle();

    const inbox = page.getByLabel('Primary inbox', { exact: true });
    await inbox.evaluate((element) => {
        element.scrollTop = 72 * 40;
        element.dispatchEvent(new Event('scroll'));
    });
    const thread = page.locator('[data-thread-id="thread-40"]');
    await thread.focus();

    const separator = page.getByRole('separator', {
        name: 'Resize conversations',
    });
    await separator.focus();
    await separator.press('ArrowRight');
    assert.equal(
        await separator.evaluate(
            (element) => element === document.activeElement,
        ),
        true,
    );
    await thread.focus();
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            ),
    );
    assert.equal(await visibleMessage(), anchorId);
    assert.equal(
        await thread.evaluate((element) => element === document.activeElement),
        true,
    );
    assert.equal(await row!.evaluate((element) => element.isConnected), true);
    assert.ok((await page.locator('[data-thread-id]').count()) <= 31);
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);

    const before = await page.evaluate(
        () => window.historyTest.commands.length,
    );
    await viewport.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
    });
    await page.locator('[data-message-id="message-40"]').waitFor();
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    assert.equal(
        await page.evaluate(() => window.historyTest.commands.length),
        before,
    );
    await page.close();
});

// Geometry identifies a domain message, never an expected position or clearance.
async function visibleMessage(page: Page, edge: 'first' | 'last' = 'first') {
    return page
        .getByLabel('Messages', { exact: true })
        .evaluate((element, edge) => {
            const boundary = element.getBoundingClientRect();
            const rows = [
                ...element.querySelectorAll<HTMLElement>('[data-message-id]'),
            ].filter((row) => {
                const rect = row.getBoundingClientRect();
                return rect.bottom > boundary.top && rect.top < boundary.bottom;
            });
            return (edge === 'first' ? rows[0] : rows.at(-1))?.dataset
                .messageId;
        }, edge);
}

async function layoutSettled(page: Page) {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                ),
            ),
    );
}

test('floating composer keeps older message identity through edits, sends, arrivals and prepends', async () => {
    const page = await openHistory(1100, { composer: true });
    const viewport = page.getByLabel('Messages', { exact: true });
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });

    await viewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight / 2;
        element.dispatchEvent(new Event('scroll'));
    });
    await layoutSettled(page);
    const before = await visibleMessage(page);
    assert.ok(before);

    // Draft growth and reply context must not adopt the tail for an older reader.
    await editor.fill('A multiline draft\nwith another line\nand a third');
    await layoutSettled(page);
    assert.equal(await visibleMessage(page), before);
    await page
        .locator(`[data-message-id="${before}"]`)
        .getByRole('button', { name: 'Reply', exact: true })
        .click();
    await page.getByRole('button', { name: 'Cancel reply' }).waitFor();
    await layoutSettled(page);
    assert.equal(await visibleMessage(page), before);

    await editor.press('Enter');
    await page.waitForFunction(() =>
        window.historyTest.commands.some(
            (command) => command.kind === 'mutate',
        ),
    );
    await page.evaluate(() => window.historyTest.settleSend(false));
    await page
        .getByRole('alert')
        .filter({ hasText: 'Could not save' })
        .waitFor();
    await layoutSettled(page);
    assert.equal(await visibleMessage(page), before);
    assert.equal(
        await editor.inputValue(),
        'A multiline draft\nwith another line\nand a third',
    );
    await page.getByRole('button', { name: 'Cancel reply' }).click();

    // Both ends can change without replacing the reader's logical anchor.
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        next.entities.messagesById.arrival = {
            id: 'arrival',
            kind: 'text',
            text: 'Incoming tail',
            senderId: 'peer',
            ts: 1_800_000_000_000,
        };
        next.histories['thread-0'].orderedIds.push('arrival');
        next.entities.messagesById.prepend = {
            id: 'prepend',
            kind: 'text',
            text: 'Earlier history',
            senderId: 'peer',
            ts: 1,
        };
        next.histories['thread-0'].orderedIds.unshift('prepend');
        window.historyTest.send(next, 2);
    });
    await layoutSettled(page);
    assert.equal(await visibleMessage(page), before);

    await page.setViewportSize({ width: 900, height: 560 });
    await layoutSettled(page);
    assert.equal(await visibleMessage(page), before);
    await page.locator('[data-thread-id="thread-1"]').click();
    await page.getByText('Second conversation message').waitFor();
    await page.locator('[data-thread-id="thread-0"]').click();
    await editor.waitFor();
    await layoutSettled(page);
    assert.equal(await visibleMessage(page), before);
    assert.equal(
        await editor.inputValue(),
        'A multiline draft\nwith another line\nand a third',
    );
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    await page.close();
});

for (const width of [1100, 390]) {
    test(`composer preserves newest identity and accepted draft clearing at ${width}`, async () => {
        const page = await openHistory(width, { composer: true });
        const editor = page.getByRole('textbox', {
            name: 'Message',
            exact: true,
        });

        await editor.fill('First line\nSecond line\nThird line');
        await layoutSettled(page);
        assert.equal(await visibleMessage(page, 'last'), 'message-119');
        await page
            .locator('[data-message-id="message-119"]')
            .getByRole('button', { name: 'Reply', exact: true })
            .click();
        await layoutSettled(page);
        assert.equal(await visibleMessage(page, 'last'), 'message-119');

        await page.setViewportSize({ width, height: 550 });
        await layoutSettled(page);
        await page.evaluate(() => {
            const next = structuredClone(window.historyTest.current);
            next.entities.messagesById.arrival = {
                id: 'arrival',
                kind: 'text',
                text: 'Newest arrival',
                senderId: 'peer',
                ts: 1_800_000_000_000,
            };
            next.histories['thread-0'].orderedIds.push('arrival');
            window.historyTest.send(next, 2);
        });
        await page.getByText('Newest arrival', { exact: true }).waitFor();
        await layoutSettled(page);
        assert.equal(await visibleMessage(page, 'last'), 'arrival');

        await editor.press('Enter');
        await page.waitForFunction(() =>
            window.historyTest.commands.some(
                (command) => command.kind === 'mutate',
            ),
        );
        const sent = await page.evaluate(
            () =>
                window.historyTest.commands.findLast(
                    (command) => command.kind === 'mutate',
                )!.command!,
        );
        assert.deepEqual(sent.intent, {
            type: 'send',
            threadId: 'thread-0',
            text: 'First line\nSecond line\nThird line',
            replyTo: 'message-119',
        });

        await page.evaluate(() => window.historyTest.settleSend(true));
        await page.waitForFunction(
            () => document.querySelector('textarea')?.value === '',
        );
        await page
            .getByRole('button', { name: 'Cancel reply' })
            .waitFor({ state: 'detached' });
        await layoutSettled(page);
        assert.equal(
            await visibleMessage(page, 'last'),
            `operation:${sent.operationId}`,
        );
        assert.equal(
            await editor.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );
        assert.ok((await page.locator('[data-message-id]').count()) <= 80);
        await page.close();
    });
}

async function replaceMessages(page: Page, messages: Message[]) {
    await page.evaluate((messages) => {
        const next = structuredClone(window.historyTest.current);
        next.entities.threadsById['thread-0'].isGroup = true;
        next.entities.threadsById['thread-0'].threadFbid = 'fbid-group';
        Object.assign(
            next.entities.messagesById,
            Object.fromEntries(
                messages.map((message) => [message.id, message]),
            ),
        );
        next.histories['thread-0'].orderedIds = messages.map(({ id }) => id);
        window.historyTest.send(next, ++next.commitRevision);
    }, messages);
    await page.locator(`[data-message-id="${messages.at(-1)!.id}"]`).waitFor();
}

function messageRow(page: Page, id: string) {
    return page.locator(`[data-message-id="${id}"]`);
}

const authorName = 'Peer';

test('rolling five-minute groups identify authors across time, sender, day and system boundaries', async () => {
    const page = await openHistory();
    const start = await page.evaluate(() =>
        new Date(2026, 9, 18, 23, 40).getTime(),
    );
    function text(id: string, minutes: number, senderId = 'peer'): Message {
        return {
            id,
            ts: start + minutes * 60_000,
            kind: 'text',
            text: `Content for ${id}`,
            senderId,
        };
    }
    const messages: Message[] = [
        text('first', 0),
        text('exact-five', 5),
        text('rolling-ten', 10),
        { ...text('over-five', 15), ts: start + 15 * 60_000 + 1 },
        text('different-sender', 16, 'other-participant'),
        text('returning-sender', 17),
        {
            id: 'activity',
            ts: start + 18 * 60_000,
            kind: 'activity',
            text: 'Someone joined',
        },
        text('after-activity', 18.5),
        {
            id: 'system',
            ts: start + 19 * 60_000,
            kind: 'reaction_log',
            fragment: 'A reaction changed',
        },
        text('before-midnight', 19.5),
        text('next-day', 20),
        text('outgoing-first', 21, 'viewer'),
        text('outgoing-second', 22, 'viewer'),
        text('incoming-again', 23),
    ];
    await replaceMessages(page, messages);

    assert.deepEqual(
        await page
            .locator('[data-message-id]')
            .evaluateAll((rows) =>
                rows.map((row) => row.getAttribute('data-message-id')),
            ),
        messages.map(({ id }) => id),
    );
    const authors = [
        'first',
        'over-five',
        'returning-sender',
        'after-activity',
        'before-midnight',
        'next-day',
        'incoming-again',
    ];
    for (const message of messages) {
        assert.equal(
            await messageRow(page, message.id)
                .getByText(authorName, { exact: true })
                .count(),
            authors.includes(message.id) ? 1 : 0,
            `Author for ${message.id}`,
        );
        if (message.kind === 'text')
            assert.equal(
                await messageRow(page, message.id)
                    .getByText(message.text, { exact: true })
                    .count(),
                1,
            );
    }
    assert.equal(
        await messageRow(page, 'different-sender')
            .getByText('other-participant', { exact: true })
            .count(),
        1,
    );
    assert.equal(
        await page.getByText('Someone joined', { exact: true }).count(),
        1,
    );
    assert.equal(
        await page.getByText('A reaction changed', { exact: true }).count(),
        1,
    );
    assert.equal(
        await page.getByLabel('Oct 19, 2026', { exact: true }).count(),
        1,
    );

    await messageRow(page, 'exact-five')
        .getByRole('button', { name: 'Reply', exact: true })
        .click();
    await page
        .getByRole('status')
        .filter({ hasText: 'Replying to Content for exact-five' })
        .waitFor();
    await page.getByRole('button', { name: 'Cancel reply' }).click();
    await messageRow(page, 'rolling-ten')
        .getByRole('button', { name: 'Reply', exact: true })
        .click();
    await page
        .getByRole('status')
        .filter({ hasText: 'Replying to Content for rolling-ten' })
        .waitFor();
    await page.close();
});

test('grouped text, share and settled send retain independent stable rows', async () => {
    const page = await openHistory();
    const ts = 1_700_000_000_000;
    await replaceMessages(page, [
        {
            id: 'text-before-share',
            ts,
            kind: 'text',
            text: 'A separate comment',
            senderId: 'peer',
        },
        {
            id: 'share',
            ts: ts + 1_000,
            kind: 'inline_share',
            title: 'A separate shared post',
            thumbUrl: '',
            targetUrl: 'https://www.instagram.com/p/fixture/',
            senderId: 'peer',
        },
        {
            id: 'local:group-send',
            ts: ts + 2_000,
            kind: 'text',
            text: 'Pending response',
            senderId: 'viewer',
            delivery: {
                operationId: 'group-send',
                status: 'dispatching',
                retryable: false,
            },
        },
    ]);

    const pending = messageRow(page, 'local:group-send');
    const node = await pending.elementHandle();
    await pending
        .getByRole('status')
        .filter({ hasText: 'dispatching' })
        .waitFor();

    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        const sent = next.entities.messagesById['local:group-send'];
        sent.serverId = 'canonical-group-send';
        sent.delivery!.status = 'succeeded';
        window.historyTest.send(next, ++next.commitRevision);
    });
    await pending.getByRole('button', { name: 'Reply', exact: true }).waitFor();
    assert.equal(
        await node!.evaluate(
            (element) =>
                element ===
                document.querySelector('[data-message-id="local:group-send"]'),
        ),
        true,
    );
    assert.equal(
        await page.getByText('Pending response', { exact: true }).count(),
        1,
    );
    assert.equal(
        await page.getByText('A separate comment', { exact: true }).count(),
        1,
    );
    assert.equal(
        await page
            .getByRole('link', { name: 'A separate shared post' })
            .getAttribute('href'),
        'https://www.instagram.com/p/fixture/',
    );
    assert.deepEqual(
        await page
            .locator('[data-message-id]')
            .evaluateAll((rows) =>
                rows.map((row) => row.getAttribute('data-message-id')),
            ),
        ['text-before-share', 'share', 'local:group-send'],
    );
    assert.equal(
        await messageRow(page, 'text-before-share')
            .getByRole('button', { name: 'Reply', exact: true })
            .count(),
        1,
    );
    assert.equal(
        await messageRow(page, 'share')
            .getByRole('button', { name: 'Reply', exact: true })
            .count(),
        1,
    );
    await page.close();
});

test('author context uses the retained predecessor without fetching history at a mounted boundary', async () => {
    const page = await openHistory();
    const messages: Message[] = Array.from({ length: 45 }, (_, index) => ({
        id: `group-window-${index}`,
        ts: 1_700_000_000_000 + index * 60_000 + (index >= 5 ? 5 * 60_000 : 0),
        kind: 'text',
        text: `Grouped message ${index}`,
        senderId: 'peer',
    }));
    await replaceMessages(page, messages);

    const head = messageRow(page, 'group-window-5');
    await head
        .getByText(authorName, { exact: true })
        .waitFor({ state: 'attached' });
    const node = await head.elementHandle();

    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        // A retained predecessor arrives with corrected time, on the five-minute boundary.
        next.entities.messagesById['group-window-4'].ts += 60_000;
        window.historyTest.send(next, ++next.commitRevision);
    });
    await head
        .getByText(authorName, { exact: true })
        .waitFor({ state: 'detached' });
    assert.equal(
        await node!.evaluate(
            (element) =>
                element ===
                document.querySelector('[data-message-id="group-window-5"]'),
        ),
        true,
    );

    await page.getByLabel('Messages', { exact: true }).evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
    });
    await messageRow(page, 'group-window-0')
        .getByText(authorName, { exact: true })
        .waitFor({ state: 'attached' });
    assert.deepEqual(
        await page
            .locator('[data-message-id]')
            .evaluateAll((rows) =>
                rows.map((row) => row.getAttribute('data-message-id')),
            ),
        messages.map(({ id }) => id),
    );
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    assert.equal(
        await page.evaluate(() =>
            window.historyTest.commands.some((command) =>
                command.kind.startsWith('load-'),
            ),
        ),
        false,
    );
    await page.close();
});

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

test('compact inbox waits for hydration then restores selection focus', async () => {
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
    assert.ok((await page.locator('[data-thread-id]').count()) <= 31);
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
        };
    });
    assert.equal(after.id, before.id);
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

test('message variants remain accessible with capability-gated composer and no provider work', async () => {
    const page = await openHistory();
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Message', exact: true })
            .count(),
        0,
    );
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        const base = next.entities.messagesById['message-80'];
        if (!base || base.kind !== 'text')
            throw new Error('text fixture missing');
        const image =
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        next.entities.threadsById['thread-0'].threadFbid = 'fbid-0';
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

    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    await page.getByText('Shared a reel').waitFor();
    await page.getByText('Shared post').waitFor();
    await page.getByText('Unavailable attachment').waitFor();
    await page.getByLabel('Reply preview').waitFor();
    assert.equal(await page.locator('a[target="_blank"]').count(), 2);
    assert.equal(
        await page.evaluate(
            () =>
                window.historyTest.commands.filter(
                    (command) =>
                        command.kind !== 'subscribe' &&
                        command.kind !== 'visibility',
                ).length,
        ),
        0,
    );
    await page.evaluate(() => {
        const next = structuredClone(window.historyTest.current);
        delete next.histories['thread-0'].viewerId;
        window.historyTest.send(next, 3);
    });
    await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .waitFor({ state: 'detached' });
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
            function publish() {
                if (
                    !window.historyTest.commands
                        .slice(commandCount)
                        .some((command) => command.anchorId)
                ) {
                    requestAnimationFrame(publish);
                    return;
                }
                window.historyTest.send(authorized, 2);
            }
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

test('new account inbox restores selection focus after identity reset', async () => {
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
                const result = {
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
                        Object.keys(
                            window.historyTest.current.entities.messagesById,
                        ).length,
                ),
                401,
            );
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
    assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    await page.close();
});

test('a previous cached range only jumps to latest on request', async () => {
    const page = await openHistory();
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
