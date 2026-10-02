import browser from 'webextension-polyfill';
import type { InboxEngine, InboxProjection } from './inbox.ts';
import {
    INBOX_CLIENT_PORT,
    isClientCommand,
    type SnapshotMessage,
} from './protocol.ts';

type PortMessage = Parameters<
    Parameters<browser.Runtime.Port['onMessage']['addListener']>[0]
>[0];

export interface InboxClientPort {
    readonly name: string;
    readonly sender?: { readonly url?: string };
    readonly onMessage: {
        addListener(listener: (message: PortMessage) => void): void;
    };
    readonly onDisconnect: { addListener(listener: () => void): void };
    postMessage(message: SnapshotMessage): void;
    disconnect(): void;
}

export function registerInboxClientPorts(
    port: InboxClientPort,
    engine: InboxEngine,
) {
    const own = new URL(browser.runtime.getURL('/'));
    if (port.name !== INBOX_CLIENT_PORT || !port.sender?.url) return;
    const sender = new URL(port.sender.url);
    if (sender.origin !== own.origin || sender.pathname !== '/ui.html') {
        port.disconnect();
        return;
    }

    let sequence = 0;
    let unsubscribe: (() => void) | undefined;
    let selectedListener: ((projection: InboxProjection) => void) | undefined;
    let closed = false;
    function handle(operation: Promise<void>) {
        void operation.catch(() => undefined);
    }
    function receive(
        unknownCommand: Parameters<
            Parameters<typeof port.onMessage.addListener>[0]
        >[0],
    ) {
        if (closed) return;
        if (!isClientCommand(unknownCommand)) {
            port.disconnect();
            return;
        }

        const command = unknownCommand;
        if (command.kind === 'subscribe') {
            // Acquire the replacement interest first so a route change cannot
            // transiently cancel a shared detail flight needed by both routes.
            const previous = unsubscribe;
            const previousListener = selectedListener;
            selectedListener = (projection) => {
                if (closed) return;
                port.postMessage({
                    kind: 'snapshot',
                    sequence: ++sequence,
                    projection,
                } satisfies SnapshotMessage);
            };
            unsubscribe = engine.subscribe(
                selectedListener,
                command.threadId,
                command.anchorId,
                previousListener,
            );
            previous?.();
        } else if (command.kind === 'refresh') handle(engine.refresh());
        else if (command.kind === 'load-more-inbox')
            handle(engine.loadMoreInbox());
        else if (command.kind === 'refresh-history')
            handle(
                engine.refreshHistory(
                    command.threadId,
                    selectedListener,
                    command.anchorId,
                ),
            );
        else if (command.kind === 'load-older-history')
            handle(engine.loadOlderHistory(command.threadId, selectedListener));
        else
            handle(engine.loadNewerHistory(command.threadId, selectedListener));
    }

    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(() => {
        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;
        selectedListener = undefined;
    });
}

/** Installs the MV3 host listener before runtime initialization can yield. */
export function prepareInboxClientPort(port: InboxClientPort) {
    const buffered: PortMessage[] = [];
    let receive: ((message: PortMessage) => void) | undefined;
    let closed = false;
    const own = new URL(browser.runtime.getURL('/'));
    const sender = port.sender?.url ? new URL(port.sender.url) : undefined;
    if (
        port.name !== INBOX_CLIENT_PORT ||
        sender?.origin !== own.origin ||
        sender.pathname !== '/ui.html'
    ) {
        port.disconnect();
        return (_engine: InboxEngine) => undefined;
    }

    port.onMessage.addListener((message) => {
        if (closed) return;
        if (receive) receive(message);
        else buffered.push(message);
    });
    port.onDisconnect.addListener(() => {
        closed = true;
        buffered.length = 0;
    });

    return (engine: InboxEngine) => {
        if (closed) return;
        const adapter: InboxClientPort = {
            name: port.name,
            sender: port.sender,
            onMessage: {
                addListener(listener: (message: PortMessage) => void) {
                    receive = listener;
                },
            },
            onDisconnect: port.onDisconnect,
            postMessage: (message) => port.postMessage(message),
            disconnect: () => port.disconnect(),
        };
        registerInboxClientPorts(adapter, engine);
        if (!receive) return;
        for (const message of buffered.splice(0)) receive(message);
    };
}
