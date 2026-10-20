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

function bindInboxClientPort(port: InboxClientPort, engine: InboxEngine) {
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

    return {
        receive,
        disconnect() {
            closed = true;
            unsubscribe?.();
            unsubscribe = undefined;
            selectedListener = undefined;
        },
    };
}

/** Installs the MV3 host listener before runtime initialization can yield. */
export function prepareInboxClientPort(port: InboxClientPort) {
    const buffered: PortMessage[] = [];
    let receiver: ReturnType<typeof bindInboxClientPort> | undefined;
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
        if (receiver) receiver.receive(message);
        else buffered.push(message);
    });
    port.onDisconnect.addListener(() => {
        closed = true;
        buffered.length = 0;
        receiver?.disconnect();
    });

    return (engine: InboxEngine) => {
        if (closed) return;
        receiver = bindInboxClientPort(port, engine);
        for (const message of buffered.splice(0)) receiver.receive(message);
    };
}
