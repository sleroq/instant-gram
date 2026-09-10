import { createStore, onCleanup, reconcile, type Store } from 'solid-js';
import browser from 'webextension-polyfill';
import type { InboxProjection } from '../../lib/engine/inbox';
import { INBOX_CLIENT_PORT, type SnapshotMessage } from '../../lib/engine/protocol';

export type InboxClient = { readonly state: Store<InboxProjection>; refresh(): void };
function empty(): InboxProjection {
    return { accountId: null, accountEpoch: 0, workerEpoch: '', commitRevision: 0,
        availability: 'absent', freshness: 'stale', synchronization: 'refreshing', inbox: null };
}

export function createInboxClient(): InboxClient {
    const [state, setState] = createStore(empty());
    let currentPort: browser.Runtime.Port | undefined;
    let removeCurrent: (() => void) | undefined;
    function connect() {
        const previousPort = currentPort;
        removeCurrent?.();
        previousPort?.disconnect();
        setState(draft => { reconcile(empty())(draft); });
        let sequence = 0;
        let workerEpoch = '';
        const port = browser.runtime.connect({ name: INBOX_CLIENT_PORT });
        currentPort = port;
        function reconnect() {
            remove();
            port.disconnect();
            if (currentPort !== port) return;
            currentPort = undefined;
            connect();
        }
        function receive(message: SnapshotMessage) {
            if (currentPort !== port || message.kind !== 'snapshot') return;
            if (workerEpoch && workerEpoch !== message.projection.workerEpoch) {
                reconnect();
                return;
            }
            if (message.sequence <= sequence) return;
            if (message.sequence > sequence + 1) {
                reconnect();
                return;
            }
            sequence = message.sequence;
            workerEpoch = message.projection.workerEpoch;
            const accountChanged = state.accountEpoch !== message.projection.accountEpoch;
            setState(draft => {
                if (accountChanged) draft.inbox = null;
                reconcile(message.projection)(draft);
            });
        }
        function remove() {
            port.onMessage.removeListener(receive);
            port.onDisconnect.removeListener(reconnect);
            if (removeCurrent === remove) removeCurrent = undefined;
        }
        removeCurrent = remove;
        port.onMessage.addListener(receive);
        port.onDisconnect.addListener(reconnect);
        port.postMessage({ kind: 'subscribe' });
    }
    connect();
    onCleanup(() => {
        removeCurrent?.();
        const port = currentPort;
        currentPort = undefined;
        port?.disconnect();
    });
    return { state, refresh: () => currentPort?.postMessage({ kind: 'refresh' }) };
}
