import browser from 'webextension-polyfill';
import type { InboxEngine } from './inbox.ts';
import {
    INBOX_CLIENT_PORT,
    isClientCommand,
    type SnapshotMessage,
} from './protocol.ts';

export function registerInboxClientPorts(
    port: browser.Runtime.Port,
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
            unsubscribe?.();
            unsubscribe = engine.subscribe((projection) => {
                if (closed) return;
                port.postMessage({
                    kind: 'snapshot',
                    sequence: ++sequence,
                    projection,
                } satisfies SnapshotMessage);
            }, command.threadId);
        } else if (command.kind === 'refresh') handle(engine.refresh());
        else if (command.kind === 'load-more-inbox')
            handle(engine.loadMoreInbox());
        else if (command.kind === 'refresh-history')
            handle(engine.refreshHistory(command.threadId));
        else handle(engine.loadOlderHistory(command.threadId));
    }
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(() => {
        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;
    });
}
