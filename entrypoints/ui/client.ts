import {
    createStore,
    onCleanup,
    onSettled,
    reconcile,
    type Store,
} from 'solid-js';
import browser from 'webextension-polyfill';
import type { InboxProjection } from '../../lib/engine/inbox';
import {
    INBOX_CLIENT_PORT,
    type ClientCommand,
    type SnapshotMessage,
} from '../../lib/engine/protocol';

export type InboxClient = {
    readonly state: Store<InboxProjection>;
    select(threadId?: string): void;
    refresh(): void;
    loadMoreInbox(): void;
    refreshHistory(threadId: string): void;
    loadOlderHistory(threadId: string): void;
};

export function emptyProjection(): InboxProjection {
    return {
        accountId: null,
        accountEpoch: 0,
        workerEpoch: '',
        commitRevision: 0,
        entities: { threadsById: {}, usersById: {}, messagesById: {} },
        inbox: {
            orderedIds: [],
            fetchedAt: 0,
            hasNextPage: false,
            availability: 'absent',
            freshness: 'stale',
            synchronization: 'refreshing',
        },
        histories: {},
    };
}

export function createInboxClient(): InboxClient {
    const [state, setState] = createStore(emptyProjection());
    let currentPort: browser.Runtime.Port | undefined;
    let removeCurrent: (() => void) | undefined;
    let selectedThreadId: string | undefined;

    function connect() {
        const previousPort = currentPort;
        removeCurrent?.();
        previousPort?.disconnect();
        setState(reconcile(emptyProjection()));

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
            const accountChanged =
                state.accountId !== message.projection.accountId ||
                state.accountEpoch !== message.projection.accountEpoch;
            sequence = message.sequence;
            workerEpoch = message.projection.workerEpoch;
            setState((draft) => {
                if (accountChanged) {
                    reconcile(emptyProjection())(draft);
                }
                return reconcile(message.projection)(draft);
            });
        }

        // SAFETY: this named client port receives only SnapshotMessage values from its worker counterpart.
        const receiveListener = receive as Parameters<
            typeof port.onMessage.addListener
        >[0];
        function remove() {
            port.onMessage.removeListener(receiveListener);
            port.onDisconnect.removeListener(reconnect);
            if (removeCurrent === remove) removeCurrent = undefined;
        }
        removeCurrent = remove;
        port.onMessage.addListener(receiveListener);
        port.onDisconnect.addListener(reconnect);

        function send(command: ClientCommand) {
            port.postMessage(command);
        }
        function subscribe(threadId?: string) {
            selectedThreadId = threadId;
            if (threadId) send({ kind: 'subscribe', threadId });
            else send({ kind: 'subscribe' });
        }
        // The worker returns a complete retained projection for each interest change.
        subscribe(selectedThreadId);
    }

    onSettled(connect);
    onCleanup(() => {
        removeCurrent?.();
        const port = currentPort;
        currentPort = undefined;
        port?.disconnect();
    });

    return {
        state,
        select: (threadId) => {
            selectedThreadId = threadId;
            const port = currentPort;
            if (!port) return;
            port.postMessage(
                threadId
                    ? { kind: 'subscribe', threadId }
                    : { kind: 'subscribe' },
            );
        },
        refresh: () => currentPort?.postMessage({ kind: 'refresh' }),
        loadMoreInbox: () =>
            currentPort?.postMessage({ kind: 'load-more-inbox' }),
        refreshHistory: (threadId) =>
            currentPort?.postMessage({ kind: 'refresh-history', threadId }),
        loadOlderHistory: (threadId) =>
            currentPort?.postMessage({ kind: 'load-older-history', threadId }),
    };
}
