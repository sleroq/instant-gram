import {
    createStore,
    onCleanup,
    onSettled,
    reconcile,
    type Store,
} from 'solid-js';
import browser from 'webextension-polyfill';
import {
    projectOperations,
    type MutationIntent,
    type Operation,
    type OperationResult,
} from '../../lib/engine/operations';
import type { InboxProjection } from '../../lib/engine/inbox';
import {
    INBOX_CLIENT_PORT,
    type ClientCommand,
    type SnapshotMessage,
} from '../../lib/engine/protocol';

export type InboxClient = {
    readonly state: Store<InboxProjection>;
    mutate(intent: MutationIntent): Promise<OperationResult>;
    retryOperation(operationId: string): Promise<OperationResult>;
    removeOperation(operationId: string): Promise<OperationResult>;
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
    let base = emptyProjection();
    const local = new Map<string, Operation>();
    const awaiting = new Map<string, (result: OperationResult) => void>();
    const controls = new Map<string, (result: OperationResult) => void>();
    function control(
        kind: 'retry-operation' | 'remove-operation',
        operationId: string,
    ): Promise<OperationResult> {
        if (!state.accountId || !currentPort)
            return Promise.resolve({
                ok: false,
                operationId,
                error: { kind: 'offline', message: 'Not connected' },
            });
        const command = {
            kind,
            operationId,
            accountId: state.accountId,
            accountEpoch: state.accountEpoch,
        };
        return new Promise((resolve) => {
            controls.set(operationId, resolve);
            currentPort?.postMessage(command);
        });
    }
    function publish() {
        const accepted = new Set(base.operations?.map((op) => op.operationId));
        const pending = [...local.values()].filter(
            (op) => !accepted.has(op.operationId),
        );
        const projected = pending.length
            ? projectOperations({ ...base, operations: [] }, pending)
            : base;
        setState(
            reconcile({
                ...projected,
                operations: [...(base.operations ?? []), ...pending],
            }),
        );
    }
    function settle(result: OperationResult) {
        if (controls.has(result.operationId)) {
            controls.get(result.operationId)?.(result);
            controls.delete(result.operationId);
            return;
        }
        if (!result.ok) local.delete(result.operationId);
        awaiting.get(result.operationId)?.(result);
        awaiting.delete(result.operationId);
        publish();
    }
    function visibility() {
        currentPort?.postMessage({
            kind: 'visibility',
            visible: document.visibilityState === 'visible',
        });
    }
    document.addEventListener('visibilitychange', visibility);
    onCleanup(() =>
        document.removeEventListener('visibilitychange', visibility),
    );
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
        let redeliver = true;
        const port = browser.runtime.connect({ name: INBOX_CLIENT_PORT });
        currentPort = port;

        function reconnect() {
            remove();
            port.disconnect();
            if (currentPort !== port) return;
            currentPort = undefined;
            for (const operationId of controls.keys())
                settle({
                    ok: false,
                    operationId,
                    error: {
                        kind: 'offline',
                        message:
                            'Connection lost. Check the operation before retrying.',
                    },
                });
            connect();
        }

        function receive(
            message:
                | SnapshotMessage
                | { kind: 'operation-result'; result: OperationResult },
        ) {
            if (currentPort !== port) return;
            if (message.kind === 'operation-result') {
                settle(message.result);
                return;
            }

            if (message.kind !== 'snapshot') return;
            if (workerEpoch && workerEpoch !== message.projection.workerEpoch) {
                reconnect();
                return;
            }
            if (message.sequence <= sequence) return;
            if (message.sequence > sequence + 1) {
                reconnect();
                return;
            }

            const identityKnown =
                message.projection.accountId !== null ||
                message.projection.inbox.error?.kind === 'auth';
            const accountChanged =
                identityKnown &&
                [...local.values()].some(
                    (operation) =>
                        operation.accountId !== message.projection.accountId ||
                        operation.accountEpoch !==
                            message.projection.accountEpoch,
                );
            sequence = message.sequence;
            workerEpoch = message.projection.workerEpoch;
            if (accountChanged) {
                local.clear();
                for (const operationId of awaiting.keys())
                    settle({
                        ok: false,
                        operationId,
                        error: { kind: 'auth', message: 'Account changed' },
                    });
            }
            base = message.projection;
            for (const operation of base.operations ?? []) {
                local.delete(operation.operationId);
                if (awaiting.has(operation.operationId))
                    settle({
                        ok: true,
                        operationId: operation.operationId,
                        revision: operation.acceptedRevision,
                    });
            }
            publish();
            if (redeliver && message.projection.accountId !== null) {
                redeliver = false;
                for (const operation of local.values()) {
                    const { accountId, accountEpoch, operationId, intent } =
                        operation;
                    port.postMessage({
                        kind: 'mutate',
                        command: {
                            accountId,
                            accountEpoch,
                            operationId,
                            intent,
                        },
                    });
                }
            }
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
        visibility();
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
        mutate: (intent) => {
            const operationId = crypto.randomUUID();
            if (!state.accountId || !currentPort)
                return Promise.resolve({
                    ok: false,
                    operationId,
                    error: { kind: 'offline', message: 'Not connected' },
                });

            if (local.size >= 80)
                return Promise.resolve({
                    ok: false,
                    operationId,
                    error: {
                        kind: 'invalid_request',
                        message: 'Wait for pending commands to be accepted.',
                    },
                });

            const command = {
                accountId: state.accountId,
                accountEpoch: state.accountEpoch,
                operationId,
                intent,
            };
            local.set(operationId, {
                ...command,
                request: {
                    intent,
                    offlineThreadingId: operationId,
                    viewerId: state.histories[intent.threadId]?.viewerId,
                },
                createdAt: Date.now(),
                acceptedRevision: 0,
                status: 'queued',
                attempts: 0,
                retryable: false,
            });
            publish();
            return new Promise((resolve) => {
                awaiting.set(operationId, resolve);
                currentPort?.postMessage({ kind: 'mutate', command });
            });
        },
        retryOperation: (operationId) =>
            control('retry-operation', operationId),
        removeOperation: (operationId) =>
            control('remove-operation', operationId),
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
