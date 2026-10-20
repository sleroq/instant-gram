import type { SnapshotMessage } from '../lib/engine/protocol';
import type { InboxProjection } from '../lib/engine/inbox';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { buildExtension } from './browser-build';
import type {
    MutationCommand,
    OperationResult,
    Operation,
} from '../lib/engine/operations';

test('composer preserves newer drafts on acceptance and supports IME and replies', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    await buildExtension(root);

    const server = await preview({
        configFile: false,
        root,
        build: { outDir: '.output/chrome-mv3' },
        preview: { port: 0, host: '127.0.0.1' },
    });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(5_000);
        await page.addInitScript(() => {
            const commands: MutationCommand[] = [];
            type ServerMessage =
                | SnapshotMessage
                | { kind: 'operation-result'; result: OperationResult };
            const listeners = new Set<(message: ServerMessage) => void>();

            const disconnects = new Set<() => void>();
            const visibility: boolean[] = [];
            const controlCommands: Array<{
                kind: string;
                operationId: string;
            }> = [];
            let sequence = 0;
            let visible = true;
            Object.defineProperty(document, 'visibilityState', {
                get: () => (visible ? 'visible' : 'hidden'),
            });
            function snapshot() {
                sequence++;
                listeners.forEach((listener) =>
                    listener({
                        kind: 'snapshot',
                        sequence,
                        projection: structuredClone(projection),
                    }),
                );
            }

            const resource = {
                orderedIds: ['m'],
                fetchedAt: 1,
                hasNextPage: false,
                availability: 'present' as const,
                freshness: 'fresh' as const,
                synchronization: 'idle' as const,
            };
            const projection: InboxProjection = {
                accountId: '1',
                accountEpoch: 1,
                workerEpoch: 'w',
                commitRevision: 1,
                entities: {
                    threadsById: {
                        t: {
                            key: 't',
                            threadFbid: 'fbid-t',
                            threadIgId: 'igid-t',
                            title: 'Thread',
                            isGroup: false,
                            isMuted: false,
                            folder: 'PRIMARY',
                            lastActivityMs: 1,
                            isUnread: false,
                            serverIsPin: false,
                            userIds: [],
                        },
                    },
                    usersById: {},
                    messagesById: {
                        m: {
                            id: 'm',
                            kind: 'text',
                            text: 'Hello',
                            senderId: 'peer',
                            ts: 1,
                        },
                    },
                },
                inbox: { ...resource, orderedIds: ['t'] },
                histories: {
                    t: { ...resource, threadId: 't', viewerId: 'me' },
                },
            };
            Object.assign(window, {
                r2: {
                    commands,
                    visibility,
                    controlCommands,
                    rejectControl() {
                        const command = controlCommands.at(-1)!;
                        listeners.forEach((listener) =>
                            listener({
                                kind: 'operation-result',
                                result: {
                                    ok: false,
                                    operationId: command.operationId,
                                    error: {
                                        kind: 'storage',
                                        message: 'Control failed',
                                    },
                                },
                            }),
                        );
                    },
                    setVisible(next: boolean) {
                        visible = next;
                        document.dispatchEvent(new Event('visibilitychange'));
                    },
                    unread() {
                        projection.entities.threadsById.t.isUnread = true;
                        snapshot();
                    },
                    settleRead() {
                        projection.entities.threadsById.t.isUnread = false;
                        projection.operations = (
                            projection.operations ?? []
                        ).filter(
                            (operation) => operation.intent.type !== 'read',
                        );
                        snapshot();
                    },
                    readCanonical() {
                        projection.entities.threadsById.t.isUnread = false;
                        snapshot();
                    },
                    restart() {
                        projection.workerEpoch += '-restart';
                        [...disconnects].forEach((listener) => listener());
                    },
                    commit() {
                        const command = commands.findLast(
                            (command) => command.intent.type === 'send',
                        )!;
                        const operation: Operation = {
                            ...command,
                            createdAt: 3,
                            acceptedRevision: 3,
                            attempts: 0,
                            retryable: false,
                            status: 'queued',
                            request: {
                                intent: command.intent,
                                viewerId: 'me',
                                offlineThreadingId: command.operationId,
                            },
                        };
                        projection.operations = [
                            ...(projection.operations ?? []),
                            operation,
                        ];
                    },
                    fail() {
                        const command = commands.at(-1)!;
                        const operation: Operation = {
                            ...command,
                            createdAt: 3,
                            acceptedRevision: 3,
                            attempts: 1,
                            retryable: true,
                            status: 'failed',
                            error: {
                                kind: 'offline',
                                message: 'Provider failed',
                            },
                            request: {
                                intent: command.intent,
                                viewerId: 'me',
                                offlineThreadingId: command.operationId,
                            },
                        };
                        projection.operations = [
                            ...(projection.operations ?? []).filter(
                                (op) => op.operationId !== command.operationId,
                            ),
                            operation,
                        ];
                        snapshot();
                    },
                    echo() {
                        const command = commands.at(-1)!;
                        if (command.intent.type !== 'send')
                            throw new Error('send expected');

                        const id = `operation:${command.operationId}`;
                        const operation: Operation = {
                            ...command,
                            createdAt: 2,
                            acceptedRevision: 2,
                            attempts: 1,
                            retryable: false,
                            status: 'succeeded',
                            request: {
                                intent: command.intent,
                                viewerId: 'me',
                                offlineThreadingId: command.operationId,
                            },
                            receipt: {
                                type: 'send',
                                threadFbid: 'fbid-t',
                                message: {
                                    id: 'server-message',
                                    kind: 'text',
                                    text: command.intent.text,
                                    senderId: 'me',
                                    ts: 2,
                                },
                            },
                        };
                        projection.operations = [operation];
                        projection.entities.messagesById[id] = {
                            id,
                            serverId: 'server-message',
                            kind: 'text',
                            text: command.intent.text,
                            senderId: 'me',
                            ts: 2,
                            delivery: {
                                operationId: command.operationId,
                                status: 'succeeded',
                                retryable: false,
                            },
                        };
                        projection.histories.t.orderedIds.push(id);
                        snapshot();
                    },
                    reject() {
                        const command = commands.at(-1)!;
                        const result: OperationResult = {
                            ok: false,
                            operationId: command.operationId,
                            error: {
                                kind: 'storage',
                                message: 'Could not save',
                            },
                        };
                        listeners.forEach((listener) =>
                            listener({ kind: 'operation-result', result }),
                        );
                    },
                    accept() {
                        const command = commands.at(-1)!;
                        const result: OperationResult = {
                            ok: true,
                            operationId: command.operationId,
                            revision: 2,
                        };
                        listeners.forEach((listener) =>
                            listener({ kind: 'operation-result', result }),
                        );
                    },
                },
            });
            Object.assign(globalThis, {
                chrome: {
                    storage: {
                        local: {
                            get: (
                                _key: string,
                                callback: (value: { motion?: string }) => void,
                            ) => callback({}),
                            set: (
                                _value: { motion: string },
                                callback: () => void,
                            ) => callback(),
                        },
                        onChanged: { addListener() {}, removeListener() {} },
                    },
                    runtime: {
                        id: 'test',
                        connect: () => {
                            sequence = 0;

                            return {
                                onMessage: {
                                    addListener: (
                                        listener: (
                                            message: ServerMessage,
                                        ) => void,
                                    ) => listeners.add(listener),
                                    removeListener: (
                                        listener: (
                                            message: ServerMessage,
                                        ) => void,
                                    ) => listeners.delete(listener),
                                },
                                onDisconnect: {
                                    addListener(listener: () => void) {
                                        disconnects.add(listener);
                                    },
                                    removeListener(listener: () => void) {
                                        disconnects.delete(listener);
                                    },
                                },
                                disconnect() {},
                                postMessage(message: {
                                    kind: string;
                                    command?: MutationCommand;
                                    operationId?: string;
                                    visible?: boolean;
                                }) {
                                    if (message.kind === 'subscribe') {
                                        const checking = {
                                            ...structuredClone(projection),
                                            accountId: null,
                                            accountEpoch: 0,
                                        };
                                        queueMicrotask(() => {
                                            sequence++;
                                            listeners.forEach((listener) =>
                                                listener({
                                                    kind: 'snapshot',
                                                    sequence,
                                                    projection: checking,
                                                }),
                                            );
                                            queueMicrotask(snapshot);
                                        });
                                    }
                                    if (message.kind === 'visibility')
                                        visibility.push(message.visible!);
                                    if (
                                        message.kind === 'retry-operation' ||
                                        message.kind === 'remove-operation'
                                    )
                                        controlCommands.push({
                                            kind: message.kind,
                                            operationId: message.operationId!,
                                        });
                                    if (message.kind === 'mutate')
                                        commands.push(message.command!);
                                },
                            };
                        },
                    },
                },
            });
        });
        await page.goto(`${server.resolvedUrls!.local[0]}ui.html#/thread/t`);
        const editor = page.getByRole('textbox', {
            name: 'Message',
            exact: true,
        });
        assert.equal(await editor.getAttribute('maxlength'), '1000');
        await editor.fill('   ');
        assert.equal(
            await page
                .getByRole('button', { name: 'Send', exact: true })
                .isDisabled(),
            true,
        );
        await editor.press('Enter');
        assert.equal(await page.evaluate('window.r2.commands.length'), 0);
        // Exercise submit validation for a restored over-limit draft, not typing past maxlength.
        await editor.evaluate((element: HTMLTextAreaElement) => {
            element.value = 'x'.repeat(1001);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await editor.press('Enter');
        await page
            .getByRole('alert')
            .filter({ hasText: '1000 characters or fewer' })
            .waitFor();
        assert.equal(await page.evaluate('window.r2.commands.length'), 0);
        assert.equal((await editor.inputValue()).length, 1001);
        await editor.fill('first');
        await editor.press('End');
        await editor.press('Shift+Enter');
        assert.equal(await editor.inputValue(), 'first\n');
        assert.equal(await page.evaluate('window.r2.commands.length'), 0);
        await editor.dispatchEvent('compositionstart');
        await editor.press('Enter');
        assert.equal(await page.evaluate('window.r2.commands.length'), 0);
        await editor.dispatchEvent('compositionend');
        await editor.fill('submitted');
        await editor.press('Enter');
        await page.waitForFunction('window.r2.commands.length === 1');
        await editor.press('Enter');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        assert.equal(await page.evaluate('window.r2.commands.length'), 1);
        assert.equal(await editor.inputValue(), 'submitted');
        assert.equal(
            await page.locator('[data-message-id^="operation:"]').count(),
            1,
        );
        const speculativeRow = await page
            .locator('[data-message-id^="operation:"]')
            .getAttribute('data-message-id');
        await editor.fill('newer');
        await page.getByRole('link', { name: 'Settings', exact: true }).click();
        await page
            .getByRole('heading', { name: 'Settings', exact: true })
            .waitFor();
        await page.evaluate('window.r2.accept()');
        await page.goBack();
        await editor.waitFor();
        assert.equal(await editor.inputValue(), 'newer');
        assert.equal(
            await page
                .locator('[data-message-id^="operation:"]')
                .getAttribute('data-message-id'),
            speculativeRow,
        );
        await page.getByRole('button', { name: 'Reply', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel reply' }).click();
        assert.equal(await editor.inputValue(), 'newer');
        assert.equal(
            await page.getByRole('button', { name: 'Cancel reply' }).count(),
            0,
        );
        await page.getByRole('button', { name: 'Reply', exact: true }).click();
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction('window.r2.commands.length === 2');
        assert.equal(
            await page.evaluate('window.r2.commands[1].intent.replyTo'),
            'm',
        );
        await page.evaluate('window.r2.accept()');
        await page.waitForFunction(
            'document.querySelector("textarea").value === ""',
        );
        await editor.fill('keep on rejection');
        await editor.press('Enter');
        await page.waitForFunction('window.r2.commands.length === 3');
        await page.evaluate('window.r2.reject()');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not save' })
            .waitFor();
        assert.equal(await editor.inputValue(), 'keep on rejection');
        assert.equal(
            await page.locator('[data-message-id^="operation:"]').count(),
            2,
        );

        await page
            .getByRole('button', { name: 'Pin conversation', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Unpin conversation', exact: true })
            .waitFor();
        assert.equal(
            await page.evaluate('window.r2.commands.at(-1).intent.isPinned'),
            true,
        );
        await page.evaluate('window.r2.fail()');
        await page
            .getByRole('button', { name: 'Retry pin', exact: true })
            .click();
        await page.evaluate('window.r2.rejectControl()');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Control failed' })
            .waitFor();
        await page
            .getByRole('button', { name: 'Remove pin', exact: true })
            .click();
        await page.evaluate('window.r2.rejectControl()');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Control failed' })
            .waitFor();
        await editor.fill('lost acknowledgement');
        await editor.press('Enter');
        const operationId = await page.evaluate<string>(
            'window.r2.commands.at(-1).operationId',
        );
        await page.evaluate('window.r2.restart()');
        await page.waitForFunction(
            `window.r2.commands.filter(command => command.operationId === ${JSON.stringify(operationId)}).length === 2`,
        );
        assert.equal(await editor.inputValue(), 'lost acknowledgement');
        await editor.fill('newer after reconnect');
        const alias = page.locator(
            `[data-message-id="operation:${operationId}"]`,
        );
        await alias.evaluate((element) => {
            element.setAttribute('data-probe', 'retained');
        });
        await page.evaluate('window.r2.echo()');
        await page.waitForFunction(
            'document.querySelector("[data-probe=retained]")?.textContent.includes("lost acknowledgement")',
        );
        assert.equal(await alias.getAttribute('data-probe'), 'retained');
        assert.equal(await editor.inputValue(), 'newer after reconnect');
        assert.equal(
            await editor.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );
        assert.equal(
            await page
                .getByText('lost acknowledgement', { exact: true })
                .count(),
            1,
        );
        const beforeRead = await page.evaluate<number>(
            'window.r2.commands.length',
        );
        await page.evaluate('window.r2.setVisible(false); window.r2.unread()');
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.equal(
            await page.evaluate('window.r2.commands.length'),
            beforeRead,
        );
        assert.equal(await page.evaluate('window.r2.visibility.at(-1)'), false);
        await page.evaluate('window.r2.setVisible(true)');
        await page.waitForFunction(
            'window.r2.commands.at(-1).intent.type === "read"',
        );
        assert.equal(
            await page.evaluate('window.r2.commands.at(-1).intent.messageId'),
            'server-message',
        );
        assert.equal(
            await page.evaluate('window.r2.commands.at(-1).intent.timestampMs'),
            2,
        );
        await page.evaluate('window.r2.setVisible(true)');
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.equal(
            await page.evaluate('window.r2.commands.length'),
            beforeRead + 1,
        );
        await page.evaluate('window.r2.reject()');
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .waitFor();
        const rejectedCount = await page.evaluate<number>(
            'window.r2.commands.length',
        );
        await page.evaluate('window.r2.setVisible(true); window.r2.unread()');
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.equal(
            await page.evaluate('window.r2.commands.length'),
            rejectedCount,
        );
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .click();
        await page.waitForFunction(
            `window.r2.commands.length === ${rejectedCount + 1}`,
        );
        await page.evaluate('window.r2.reject()');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not save' })
            .waitFor();
        await page.evaluate('window.r2.fail()');
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .waitFor();
        assert.equal(
            await page
                .getByRole('button', { name: 'Retry read', exact: true })
                .count(),
            1,
        );
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not save' })
            .waitFor({ state: 'hidden' });
        // Canonical read evidence must not hide a durable failure before settlement.
        await page.evaluate('window.r2.readCanonical()');
        await page
            .getByRole('button', { name: 'Remove read', exact: true })
            .waitFor();
        const durableCount = await page.evaluate<number>(
            'window.r2.commands.length',
        );
        await page.evaluate('window.r2.setVisible(true); window.r2.unread()');
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.equal(
            await page.evaluate('window.r2.commands.length'),
            durableCount,
        );
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .click();
        assert.equal(
            await page.evaluate('window.r2.controlCommands.at(-1).kind'),
            'retry-operation',
        );
        await page.evaluate('window.r2.rejectControl()');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Control failed' })
            .waitFor();
        await page
            .getByRole('button', { name: 'Remove read', exact: true })
            .click();
        await page.evaluate('window.r2.rejectControl()');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Control failed' })
            .waitFor();

        await page.evaluate('window.r2.settleRead()');
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .waitFor({ state: 'hidden' });
        assert.equal(
            await page
                .getByRole('button', { name: 'Remove read', exact: true })
                .count(),
            0,
        );

        await page.evaluate('window.r2.unread()');
        await page.waitForFunction(
            `window.r2.commands.length === ${durableCount + 1}`,
        );
        await page.evaluate('window.r2.reject()');
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .waitFor();
        await page.evaluate('window.r2.readCanonical()');
        await page
            .getByRole('button', { name: 'Retry read', exact: true })
            .waitFor({ state: 'hidden' });

        await editor.fill('pending draft version one');
        await editor.press('Enter');
        const priorSendId = await page.evaluate<string>(
            'window.r2.commands.findLast(command => command.intent.type === "send").operationId',
        );
        await editor.fill('pending draft version two');
        await editor.press('Enter');
        const editedSendId = await page.evaluate<string>(
            'window.r2.commands.findLast(command => command.intent.type === "send").operationId',
        );
        assert.notEqual(editedSendId, priorSendId);
        await editor.fill('durably committed');
        await editor.press('Enter');
        const committedId = await page.evaluate<string>(
            'window.r2.commands.findLast(command => command.intent.type === "send").operationId',
        );
        await page.evaluate('window.r2.commit(); window.r2.restart()');
        await page.waitForFunction(
            'document.querySelector("textarea")?.value === ""',
        );
        assert.equal(
            await page.evaluate(
                `window.r2.commands.filter(command => command.operationId === ${JSON.stringify(committedId)}).length`,
            ),
            1,
        );
        assert.ok((await page.locator('[data-message-id]').count()) <= 80);
    } finally {
        await browser.close();
        await server.close();
    }
});
