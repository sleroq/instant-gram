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
    select(threadId?: string, anchorId?: string): void;
    rememberHistoryAnchor(threadId: string, anchorId?: string): void;
    refresh(): void;
    loadMoreInbox(): void;
    refreshHistory(threadId: string, anchorId?: string): void;
    loadOlderHistory(threadId: string): void;
    loadNewerHistory(threadId: string): void;
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
    let selectedAnchorId: string | undefined;

    function selectionCommand(): ClientCommand {
        if (!selectedThreadId) return { kind: 'subscribe' };
        return selectedAnchorId
            ? {
                  kind: 'subscribe',
                  threadId: selectedThreadId,
                  anchorId: selectedAnchorId,
              }
            : { kind: 'subscribe', threadId: selectedThreadId };
    }

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
        // Restore this window's logical position after worker reconnect as well.
        send(selectionCommand());
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
        select: (threadId, anchorId) => {
            selectedThreadId = threadId;
            selectedAnchorId = threadId ? anchorId : undefined;
            currentPort?.postMessage(selectionCommand());
        },
        rememberHistoryAnchor: (threadId, anchorId) => {
            if (selectedThreadId === threadId) selectedAnchorId = anchorId;
        },
        refresh: () => currentPort?.postMessage({ kind: 'refresh' }),
        loadMoreInbox: () =>
            currentPort?.postMessage({ kind: 'load-more-inbox' }),
        refreshHistory: (threadId, anchorId) =>
            currentPort?.postMessage(
                anchorId
                    ? { kind: 'refresh-history', threadId, anchorId }
                    : { kind: 'refresh-history', threadId },
            ),
        loadOlderHistory: (threadId) =>
            currentPort?.postMessage({ kind: 'load-older-history', threadId }),
        loadNewerHistory: (threadId) =>
            currentPort?.postMessage({ kind: 'load-newer-history', threadId }),
    };
}
