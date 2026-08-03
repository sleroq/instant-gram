import type { Message, Thread } from '../../lib/domain';
import type { UiRpc } from './rpc';
import {
    hasLocalOlderIds,
    initialHistoryWindow,
    moveHistoryWindowOlder,
} from './history-window.ts';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export type InboxState = {
    orderedIds: string[];
    byId: Record<string, Thread>;
    cursor?: string;
    hasNextPage: boolean;
    status: Status;
    isLoadingMore: boolean;
    error?: string;
    failedCursor?: string;
};

export type HistoryState = {
    byId: Record<string, Message>;
    listedIds: string[];
    viewportIds: string[];
    cursor?: string;
    hasOlder: boolean;
    viewerId?: string;
    status: Status;
    isPreloading: boolean;
    isLoadingOlder: boolean;
    isPreloadingOlder: boolean;
    isReplacingViewport: boolean;
    failedOlderCursor?: string;
    scrollAnchor?: { id: string; offset: number };
    error?: string;
};

export type FrontendState = {
    inbox: InboxState;
    pinnedIds: string[];
    pinsStatus: Status;
    selectedThreadId?: string;
    histories: Record<string, HistoryState>;
};

export function createFrontendStore(rpc: UiRpc) {
    const state: FrontendState = {
        inbox: {
            orderedIds: [],
            byId: {},
            hasNextPage: false,
            status: 'idle',
            isLoadingMore: false,
        },
        pinnedIds: [],
        pinsStatus: 'idle',
        histories: {},
    };
    const listeners = new Set<() => void>();
    const historyRequests = new Map<string, symbol>();
    const olderHistoryRequests = new Map<string, symbol>();
    const olderTriggerTimes = new Map<string, number>();
    const olderTriggerTimers = new Map<string, number>();
    const olderPreloadTimers = new Set<number>();
    const olderSettledListeners = new Map<string, () => void>();
    const openedThreadIds = new Set<string>();
    let inboxRequest: symbol | undefined;
    let generation = 0;
    let warmupGeneration = 0;
    const warmupTimers = new Set<number>();
    let warmupsStarted = 0;
    let visibleWarmupKey = '';
    let visibleWarmupIds = new Set<string>();

    function emit() {
        listeners.forEach(listener => listener());
    }

    function mergeThreads(items: Thread[]) {
        let added = 0;
        for (const thread of items) {
            if (!state.inbox.byId[thread.key]) {
                state.inbox.orderedIds.push(thread.key);
                added++;
            }
            state.inbox.byId[thread.key] = thread;
        }
        return added;
    }

    async function loadInbox(cursor?: string) {
        if (inboxRequest || (cursor && cursor !== state.inbox.cursor)) return;
        const request = Symbol('inbox');
        const requestGeneration = generation;
        inboxRequest = request;
        if (cursor) {
            state.inbox.isLoadingMore = true;
            state.inbox.error = undefined;
        } else {
            state.inbox.status = 'loading';
        }
        emit();

        try {
            const result = await rpc.getInbox(cursor ? { cursor } : {});
            if (generation !== requestGeneration || inboxRequest !== request)
                return;
            if (!result.ok) {
                state.inbox.error = result.error.message;
                if (cursor) state.inbox.failedCursor = cursor;
                else state.inbox.status = 'error';
                return;
            }
            const added = mergeThreads(result.value.items);
            if (
                cursor &&
                result.value.hasNextPage &&
                result.value.cursor === cursor &&
                added === 0
            ) {
                state.inbox.error = 'Inbox pagination made no progress';
                state.inbox.failedCursor = cursor;
                return;
            }
            state.inbox.cursor = result.value.cursor;
            state.inbox.hasNextPage = result.value.hasNextPage;
            state.inbox.status = 'ready';
            state.inbox.failedCursor = undefined;
        } catch (error) {
            if (generation !== requestGeneration || inboxRequest !== request)
                return;
            state.inbox.error = errorMessage(error);
            if (cursor) state.inbox.failedCursor = cursor;
            else state.inbox.status = 'error';
        } finally {
            if (generation === requestGeneration && inboxRequest === request) {
                inboxRequest = undefined;
                state.inbox.isLoadingMore = false;
                emit();
            }
        }
    }

    async function loadPins() {
        const requestGeneration = generation;
        state.pinsStatus = 'loading';
        emit();
        try {
            const result = await rpc.getPins();
            if (generation !== requestGeneration) return;
            state.pinnedIds = [...new Set(result.pinned)];
            state.pinsStatus = 'ready';
        } catch {
            if (generation !== requestGeneration) return;
            state.pinsStatus = 'error';
        }
        emit();
    }

    async function loadInitialHistory(threadId: string, isPreloading = false) {
        const existing = state.histories[threadId];
        if (historyRequests.has(threadId) || (existing && existing.status !== 'error')) return;
        const thread = state.inbox.byId[threadId];
        if (!thread) return;

        const history: HistoryState = existing ?? {
            byId: {},
            listedIds: [],
            viewportIds: [],
            hasOlder: false,
            status: 'idle',
            isPreloading: false,
            isLoadingOlder: false,
            isPreloadingOlder: false,
            isReplacingViewport: false,
        };
        history.status = 'loading';
        history.isPreloading = isPreloading;
        history.error = undefined;
        const request = Symbol(threadId);
        const requestGeneration = generation;
        state.histories[threadId] = history;
        historyRequests.set(threadId, request);
        emit();

        try {
            const result = await rpc.getThread({
                threadKey: thread.cursor ?? thread.key,
            });
            if (
                generation !== requestGeneration ||
                historyRequests.get(threadId) !== request
            )
                return;
            if (!result.ok) {
                history.status = 'error';
                history.error = result.error.message;
                return;
            }
            for (const message of result.value.items) {
                if (!history.byId[message.id]) history.listedIds.push(message.id);
                history.byId[message.id] = message;
            }
            history.cursor = result.value.cursor;
            history.hasOlder = result.value.hasNextPage;
            history.viewerId = result.value.viewerId;
            history.viewportIds = initialHistoryWindow(history.listedIds);
            history.status = 'ready';
        } catch (error) {
            if (
                generation !== requestGeneration ||
                historyRequests.get(threadId) !== request
            )
                return;
            history.status = 'error';
            history.error = errorMessage(error);
        } finally {
            if (
                generation === requestGeneration &&
                historyRequests.get(threadId) === request
            ) {
                history.isPreloading = false;
                historyRequests.delete(threadId);
                emit();
            }
        }
    }

    function mergeOlderMessages(history: HistoryState, items: Message[]) {
        const olderIds: string[] = [];
        for (const message of items) {
            if (!history.byId[message.id]) olderIds.push(message.id);
            history.byId[message.id] = message;
        }
        if (olderIds.length) history.listedIds = [...olderIds, ...history.listedIds];
        return olderIds.length;
    }

    async function requestOlderHistory(
        threadId: string,
        mode: 'visible' | 'preload' | 'fill',
    ) {
        const history = state.histories[threadId];
        const thread = state.inbox.byId[threadId];
        const cursor = history?.cursor;
        if (
            !history || !thread || !cursor || !history.hasOlder ||
            olderHistoryRequests.has(threadId) || history.failedOlderCursor === cursor
        ) return false;

        const request = Symbol(`older:${threadId}`);
        const requestGeneration = generation;
        olderHistoryRequests.set(threadId, request);
        if (mode === 'preload') history.isPreloadingOlder = true;
        else history.isLoadingOlder = true;
        history.error = undefined;
        emit();

        let loaded = false;
        try {
            const result = await rpc.getThread({
                threadKey: thread.cursor ?? thread.key,
                cursor,
            });
            if (
                generation !== requestGeneration ||
                olderHistoryRequests.get(threadId) !== request
            ) return false;
            if (!result.ok) {
                history.error = result.error.message;
                history.failedOlderCursor = cursor;
                return false;
            }
            const added = mergeOlderMessages(history, result.value.items);
            if (result.value.hasNextPage && result.value.cursor === cursor && added === 0) {
                history.error = 'History pagination made no progress';
                history.failedOlderCursor = cursor;
                return false;
            }
            history.cursor = result.value.cursor;
            history.hasOlder = result.value.hasNextPage;
            history.viewerId = result.value.viewerId || history.viewerId;
            history.failedOlderCursor = undefined;
            loaded = true;
            return true;
        } catch (error) {
            if (
                generation === requestGeneration &&
                olderHistoryRequests.get(threadId) === request
            ) {
                history.error = errorMessage(error);
                history.failedOlderCursor = cursor;
            }
            return false;
        } finally {
            if (
                generation === requestGeneration &&
                olderHistoryRequests.get(threadId) === request
            ) {
                olderHistoryRequests.delete(threadId);
                history.isLoadingOlder = false;
                history.isPreloadingOlder = false;
                emit();
                olderSettledListeners.get(threadId)?.();
                if (loaded && mode === 'visible' && history.hasOlder) {
                    const timer = window.setTimeout(() => {
                        olderPreloadTimers.delete(timer);
                        void requestOlderHistory(threadId, 'preload');
                    }, 0);
                    olderPreloadTimers.add(timer);
                }
            }
        }
    }

    function revealOlderHistory(threadId: string, bypassDebounce = false) {
        const history = state.histories[threadId];
        if (
            !history || history.status !== 'ready' || history.isReplacingViewport ||
            (history.failedOlderCursor !== undefined && history.failedOlderCursor === history.cursor)
        ) return {};
        if (hasLocalOlderIds(history.listedIds, history.viewportIds)) {
            history.viewportIds = moveHistoryWindowOlder(history.listedIds, history.viewportIds);
            history.isReplacingViewport = true;
            emit();
            return { replaced: true };
        }
        const now = Date.now();
        const lastTrigger = olderTriggerTimes.get(threadId) ?? -Infinity;
        if (!bypassDebounce && now - lastTrigger < 1_000) {
            const retryAfterMs = 1_000 - (now - lastTrigger);
            if (!olderTriggerTimers.has(threadId)) {
                const timer = window.setTimeout(() => {
                    olderTriggerTimers.delete(threadId);
                    emit();
                }, retryAfterMs + 1);
                olderTriggerTimers.set(threadId, timer);
            }
            return { retryAfterMs };
        }
        if (
            !history.hasOlder || !history.cursor || olderHistoryRequests.has(threadId)
        ) return {};
        olderTriggerTimes.set(threadId, now);
        return { requested: true, completion: requestOlderHistory(threadId, 'visible') };
    }

    function cancelWarmups() {
        warmupGeneration++;
        warmupTimers.forEach(timer => window.clearTimeout(timer));
        warmupTimers.clear();
    }

    function selectThread(threadId: string) {
        cancelWarmups();
        warmupsStarted = 0;
        visibleWarmupKey = '';
        state.selectedThreadId = threadId;
        openedThreadIds.add(threadId);
        emit();
        void loadInitialHistory(threadId);
    }

    function showInbox() {
        if (!state.selectedThreadId) return;
        cancelWarmups();
        warmupsStarted = 0;
        visibleWarmupKey = '';
        state.selectedThreadId = undefined;
        emit();
    }

    function warmVisibleThreads(visibleIds: string[]) {
        const visibleKey = visibleIds.join('\u0000');
        if (visibleKey !== visibleWarmupKey) {
            cancelWarmups();
            visibleWarmupKey = visibleKey;
            visibleWarmupIds = new Set(visibleIds);
        }
        if (warmupTimers.size || warmupsStarted >= 2) return;
        if (state.inbox.status !== 'ready' || state.inbox.isLoadingMore) return;
        const selectedHistory = state.selectedThreadId
            ? state.histories[state.selectedThreadId]
            : undefined;
        if (selectedHistory?.status === 'loading') return;

        const candidates = visibleIds.filter(id =>
            id !== state.selectedThreadId &&
            !openedThreadIds.has(id) &&
            !state.histories[id] &&
            !historyRequests.has(id),
        ).slice(0, 2 - warmupsStarted);
        const currentWarmupGeneration = warmupGeneration;
        candidates.forEach((id, index) => {
            const timer = window.setTimeout(() => {
                warmupTimers.delete(timer);
                if (
                    warmupGeneration !== currentWarmupGeneration ||
                    !visibleWarmupIds.has(id) ||
                    id === state.selectedThreadId ||
                    openedThreadIds.has(id) ||
                    state.histories[id] ||
                    historyRequests.has(id) ||
                    state.inbox.status !== 'ready' ||
                    state.inbox.isLoadingMore
                ) return;
                warmupsStarted++;
                void loadInitialHistory(id, true);
            }, (index + 1) * 100);
            warmupTimers.add(timer);
        });
    }

    function orderedThreadIds() {
        const loaded = new Set(state.inbox.orderedIds);
        const pinned = state.pinnedIds.filter(id => loaded.has(id));
        const pinnedSet = new Set(pinned);
        return [...pinned, ...state.inbox.orderedIds.filter(id => !pinnedSet.has(id))];
    }

    return {
        state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start() {
            void loadInbox();
            void loadPins();
        },
        destroy() {
            generation++;
            cancelWarmups();
            listeners.clear();
            historyRequests.clear();
            olderHistoryRequests.clear();
            olderTriggerTimes.clear();
            olderTriggerTimers.forEach(timer => window.clearTimeout(timer));
            olderTriggerTimers.clear();
            olderPreloadTimers.forEach(timer => window.clearTimeout(timer));
            olderPreloadTimers.clear();
            olderSettledListeners.clear();
            inboxRequest = undefined;
        },
        loadNextInboxPage() {
            if (
                state.inbox.hasNextPage &&
                state.inbox.cursor &&
                state.inbox.failedCursor !== state.inbox.cursor
            )
                void loadInbox(state.inbox.cursor);
        },
        retryInbox() {
            state.inbox.error = undefined;
            if (state.inbox.orderedIds.length && state.inbox.cursor) {
                state.inbox.failedCursor = undefined;
                void loadInbox(state.inbox.cursor);
            } else {
                void loadInbox();
            }
        },
        retryHistory(threadId: string) {
            void loadInitialHistory(threadId);
        },
        revealOlderHistory,
        fillSelectedHistory(threadId: string) {
            if (state.selectedThreadId !== threadId) return;
            const history = state.histories[threadId];
            if (!history || history.isReplacingViewport) return;
            if (hasLocalOlderIds(history.listedIds, history.viewportIds)) {
                history.viewportIds = moveHistoryWindowOlder(history.listedIds, history.viewportIds);
                history.isReplacingViewport = true;
                emit();
                return undefined;
            } else {
                return requestOlderHistory(threadId, 'fill');
            }
        },
        retryOlderHistory(threadId: string) {
            const history = state.histories[threadId];
            if (!history) return;
            history.failedOlderCursor = undefined;
            history.error = undefined;
            revealOlderHistory(threadId, true);
        },
        completeHistoryReplacement(threadId: string) {
            const history = state.histories[threadId];
            if (!history?.isReplacingViewport) return;
            history.isReplacingViewport = false;
            emit();
        },
        saveHistoryAnchor(threadId: string, anchor: { id: string; offset: number }) {
            const history = state.histories[threadId];
            if (history) history.scrollAnchor = anchor;
        },
        onOlderHistorySettled(threadId: string, listener: () => void) {
            olderSettledListeners.set(threadId, listener);
            return () => {
                if (olderSettledListeners.get(threadId) === listener) {
                    olderSettledListeners.delete(threadId);
                }
            };
        },
        selectThread,
        showInbox,
        warmVisibleThreads,
        orderedThreadIds,
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unexpected extension error';
}

export type FrontendStore = ReturnType<typeof createFrontendStore>;
