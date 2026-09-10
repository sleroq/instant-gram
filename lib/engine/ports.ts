import browser from 'webextension-polyfill';
import type { InboxEngine } from './inbox';
import { INBOX_CLIENT_PORT, type ClientCommand, type SnapshotMessage } from './protocol';

export function registerInboxClientPorts(port: browser.Runtime.Port, engine: InboxEngine) {
    const own = new URL(browser.runtime.getURL('/'));
    if (port.name !== INBOX_CLIENT_PORT || !port.sender?.url) return;
    const sender = new URL(port.sender.url);
    if (sender.origin !== own.origin || sender.pathname !== '/solid.html') { port.disconnect(); return; }
    let sequence = 0; let unsubscribe: (() => void) | undefined;
    port.onMessage.addListener((command: ClientCommand) => {
        if (command?.kind === 'subscribe') {
            unsubscribe?.();
            unsubscribe = engine.subscribe(projection => port.postMessage({ kind: 'snapshot', sequence: ++sequence, projection } satisfies SnapshotMessage));
        } else if (command?.kind === 'refresh') void engine.refresh();
        else port.disconnect();
    });
    port.onDisconnect.addListener(() => unsubscribe?.());
}
