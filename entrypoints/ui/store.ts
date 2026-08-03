import type { Message, MessageReaction, ReplyPreview, Thread } from '../../lib/domain';
import type { CompleteUiRpc, UiRpc } from './rpc';
import {
    hasLocalOlderIds,
    initialHistoryWindow,
    moveHistoryWindowOlder,
    appendToHistoryWindow,
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
    draft: string;
    replyTargetId?: string;
    pendingSends: Record<string, PendingSend>;
    failedSends: Record<string, FailedSend>;
    rowKeyByMessageId: Record<string, string>;
    reactionMutations: Record<string, ReactionMutation>;
    error?: string;
};

export type PendingSend = {
    localId: string;
    offlineThreadingId: string;
    text: string;
    replyToMessageId?: string;
};

export type FailedSend = PendingSend & { error: string };

export type SendTextOptions = {
    followNewest: boolean;
    replyToMessageId?: string;
};

export type ReactionMutation = {
    emoji: string;
    status: 'pending' | 'error';
    error?: string;
    rollbackReactions?: MessageReaction[];
};

export type FrontendStoreRpc = UiRpc & Pick<CompleteUiRpc, 'sendText' | 'setReaction'>;

export type FrontendState = {
    inbox: InboxState;
    pinnedIds: string[];
    pinsStatus: Status;
    selectedThreadId?: string;
    histories: Record<string, HistoryState>;
};

const SIGNED_64_MAX = 9_223_372_036_854_775_807n;
const NINETEEN_DIGIT_MIN = 1_000_000_000_000_000_000n;
const OFFLINE_THREADING_RANDOM_MASK = 0x3f_ffff;

export function createFrontendStore(rpc: FrontendStoreRpc) {
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
    const sendRequests = new Map<string, symbol>();
    const reactionRequests = new Map<string, symbol>();
    const openedThreadIds = new Set<string>();
    let inboxRequest: symbol | undefined;
    let generation = 0;
    let warmupGeneration = 0;
    const warmupTimers = new Set<number>();
    let warmupsStarted = 0;
    let visibleWarmupKey = '';
    let visibleWarmupIds = new Set<string>();
    const generatedOfflineThreadingIds = new Set<string>();
    let threadMutationRevision = 0;
    const threadMutationRevisions = new Map<string, number>();

    function emit() {
        listeners.forEach(listener => listener());
    }

    function mergeThreads(items: Thread[], readRevision: number) {
        let added = 0;
        for (const thread of items) {
            const existing = state.inbox.byId[thread.key];
            if (!existing) {
                state.inbox.orderedIds.push(thread.key);
                added++;
            }
            const preserveOutgoing = existing && (
                (threadMutationRevisions.get(thread.key) ?? 0) > readRevision ||
                existing.lastActivityMs > thread.lastActivityMs
            );
            state.inbox.byId[thread.key] = preserveOutgoing
                ? {
                    ...thread,
                    lastActivityMs: existing.lastActivityMs,
                    lastMessage: existing.lastMessage,
                }
                : thread;
        }
        return added;
    }

    async function loadInbox(cursor?: string) {
        if (inboxRequest || (cursor && cursor !== state.inbox.cursor)) return;
        const request = Symbol('inbox');
        const requestGeneration = generation;
        const readRevision = threadMutationRevision;
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
            const added = mergeThreads(result.value.items, readRevision);
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
            draft: '',
            pendingSends: {},
            failedSends: {},
            rowKeyByMessageId: {},
            reactionMutations: {},
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

    function nextOfflineThreadingId(history: HistoryState) {
        let id: string;
        do {
            const random = new Uint32Array(1);
            globalThis.crypto.getRandomValues(random);
            const timestampAndRandom = (BigInt(Date.now()) << 22n) |
                BigInt(random[0] & OFFLINE_THREADING_RANDOM_MASK);
            const value = timestampAndRandom >= NINETEEN_DIGIT_MIN &&
                timestampAndRandom <= SIGNED_64_MAX
                ? timestampAndRandom
                : NINETEEN_DIGIT_MIN + (
                    timestampAndRandom % (SIGNED_64_MAX - NINETEEN_DIGIT_MIN + 1n)
                );
            id = value.toString();
        } while (
            generatedOfflineThreadingIds.has(id) ||
            history.pendingSends[`local:${id}`] ||
            history.failedSends[`local:${id}`]
        );
        generatedOfflineThreadingIds.add(id);
        return id;
    }

    function moveThreadToFront(threadId: string) {
        if (state.pinnedIds.includes(threadId)) return;
        const index = state.inbox.orderedIds.indexOf(threadId);
        if (index <= 0) return;
        state.inbox.orderedIds.splice(index, 1);
        state.inbox.orderedIds.unshift(threadId);
    }

    function updateThreadForOutgoing(threadId: string, message: Message) {
        const thread = state.inbox.byId[threadId];
        if (!thread) return;
        state.inbox.byId[threadId] = {
            ...thread,
            lastActivityMs: message.ts,
            lastMessage: message,
        };
        threadMutationRevisions.set(threadId, ++threadMutationRevision);
        moveThreadToFront(threadId);
    }

    function replaceId(ids: string[], localId: string, serverId: string) {
        if (!ids.includes(localId)) return ids;
        return ids
            .filter(id => id !== serverId || id === localId)
            .map(id => id === localId ? serverId : id);
    }

    function replyPreviewFor(message: Message): ReplyPreview {
        switch (message.kind) {
            case 'text': return { kind: 'text', text: message.text };
            case 'reel_share': return {
                kind: 'media',
                title: message.caption || `Reel from ${message.author}`,
                thumbUrl: message.thumbUrl,
            };
            case 'inline_share': return {
                kind: 'media',
                title: message.title,
                thumbUrl: message.thumbUrl,
                subtitle: message.subtitle,
            };
            case 'image': return {
                kind: 'media',
                title: message.images.length === 1 ? 'Photo' : `${message.images.length} photos`,
                thumbUrl: message.images[0]?.previewUrl ?? message.images[0]?.url,
            };
            case 'reaction_log': return { kind: 'unavailable', label: message.fragment };
            case 'unsupported': return { kind: 'unavailable', label: message.fallback.label };
        }
    }

    async function runSend(threadId: string, send: PendingSend) {
        const history = state.histories[threadId];
        const thread = state.inbox.byId[threadId];
        const key = `${threadId}\u0000${send.localId}`;
        if (!history || !thread?.threadFbid || sendRequests.has(key)) return;
        const request = Symbol(`send:${send.localId}`);
        const requestGeneration = generation;
        sendRequests.set(key, request);
        history.pendingSends[send.localId] = send;
        delete history.failedSends[send.localId];
        emit();

        try {
            const result = await rpc.sendText({
                threadFbid: thread.threadFbid,
                text: send.text,
                replyToMessageId: send.replyToMessageId,
                offlineThreadingId: send.offlineThreadingId,
            });
            if (
                generation !== requestGeneration ||
                sendRequests.get(key) !== request ||
                state.histories[threadId] !== history
            ) return;
            if (!result.ok) {
                delete history.pendingSends[send.localId];
                history.failedSends[send.localId] = { ...send, error: result.error.message };
                return;
            }

            const localMessage = history.byId[send.localId];
            if (!localMessage) return;
            const serverId = result.value.messageId;
            const existing = history.byId[serverId];
            const serverMessage: Message = {
                ...localMessage,
                id: serverId,
                ts: result.value.timestampMs,
                reactions: existing?.reactions ?? localMessage.reactions,
            };
            delete history.byId[send.localId];
            history.byId[serverId] = serverMessage;
            history.listedIds = replaceId(history.listedIds, send.localId, serverId);
            history.viewportIds = replaceId(history.viewportIds, send.localId, serverId);
            delete history.pendingSends[send.localId];
            delete history.failedSends[send.localId];
            delete history.rowKeyByMessageId[send.localId];
            history.rowKeyByMessageId[serverId] = send.localId;
            if (state.inbox.byId[threadId]?.lastMessage?.id === send.localId) {
                updateThreadForOutgoing(threadId, serverMessage);
            }
        } catch (error) {
            if (
                generation === requestGeneration &&
                sendRequests.get(key) === request &&
                state.histories[threadId] === history
            ) {
                delete history.pendingSends[send.localId];
                history.failedSends[send.localId] = { ...send, error: errorMessage(error) };
            }
        } finally {
            if (generation === requestGeneration && sendRequests.get(key) === request) {
                sendRequests.delete(key);
                emit();
            }
        }
    }

    function sendText(threadId: string, text: string, options: SendTextOptions) {
        const history = state.histories[threadId];
        const thread = state.inbox.byId[threadId];
        const trimmed = text.trim();
        if (!history || history.status !== 'ready' || !history.viewerId || !thread?.threadFbid || !trimmed) {
            return undefined;
        }
        const replyId = options.replyToMessageId ?? history.replyTargetId;
        const reply = replyId ? history.byId[replyId] : undefined;
        if (replyId && (!reply || history.pendingSends[replyId] || history.failedSends[replyId])) {
            return undefined;
        }
        const offlineThreadingId = nextOfflineThreadingId(history);
        const localId = `local:${offlineThreadingId}`;
        const message: Message = {
            kind: 'text',
            id: localId,
            senderId: history.viewerId,
            ts: Date.now(),
            text: trimmed,
            repliedTo: replyId,
            replyPreview: reply ? replyPreviewFor(reply) : undefined,
        };
        history.byId[localId] = message;
        history.listedIds.push(localId);
        if (options.followNewest) {
            history.viewportIds = appendToHistoryWindow(history.viewportIds, localId);
        }
        history.rowKeyByMessageId[localId] = localId;
        const send = { localId, offlineThreadingId, text: trimmed, replyToMessageId: replyId };
        history.pendingSends[localId] = send;
        history.draft = '';
        history.replyTargetId = undefined;
        updateThreadForOutgoing(threadId, message);
        emit();
        void runSend(threadId, send);
        return localId;
    }

    async function runReaction(threadId: string, messageId: string, emoji: string) {
        const history = state.histories[threadId];
        const thread = state.inbox.byId[threadId];
        const message = history?.byId[messageId];
        const viewerId = history?.viewerId;
        const key = `${threadId}\u0000${messageId}`;
        if (!history || !thread?.threadFbid || !message || !viewerId || reactionRequests.has(key)) {
            return false;
        }
        if (history.pendingSends[messageId] || history.failedSends[messageId] || messageId.startsWith('local:')) {
            return false;
        }
        const previous = message.reactions ? [...message.reactions] : undefined;
        const optimistic: MessageReaction[] = [
            ...(message.reactions ?? []).filter(reaction => reaction.senderId !== viewerId),
            { senderId: viewerId, reaction: emoji, timestampMs: Date.now() },
        ];
        const request = Symbol(`reaction:${key}`);
        const requestGeneration = generation;
        reactionRequests.set(key, request);
        history.byId[messageId] = { ...message, reactions: optimistic };
        history.reactionMutations[messageId] = {
            emoji,
            status: 'pending',
            rollbackReactions: previous,
        };
        emit();

        try {
            const result = await rpc.setReaction({
                threadFbid: thread.threadFbid,
                messageId,
                emoji,
            });
            if (
                generation !== requestGeneration ||
                reactionRequests.get(key) !== request ||
                state.histories[threadId] !== history
            ) return false;
            if (!result.ok) {
                const mutation = history.reactionMutations[messageId];
                history.byId[messageId] = {
                    ...history.byId[messageId],
                    reactions: mutation?.rollbackReactions,
                };
                history.reactionMutations[messageId] = {
                    emoji,
                    status: 'error',
                    error: result.error.message,
                };
                return false;
            }
            if (result.value.messageId !== messageId) {
                const mutation = history.reactionMutations[messageId];
                history.byId[messageId] = {
                    ...history.byId[messageId],
                    reactions: mutation?.rollbackReactions,
                };
                history.reactionMutations[messageId] = {
                    emoji,
                    status: 'error',
                    error: 'Reaction receipt did not match the target message',
                };
                return false;
            }
            history.byId[messageId] = {
                ...history.byId[messageId],
                reactions: result.value.reactions,
            };
            delete history.reactionMutations[messageId];
            return true;
        } catch (error) {
            if (
                generation === requestGeneration &&
                reactionRequests.get(key) === request &&
                state.histories[threadId] === history
            ) {
                const mutation = history.reactionMutations[messageId];
                history.byId[messageId] = {
                    ...history.byId[messageId],
                    reactions: mutation?.rollbackReactions,
                };
                history.reactionMutations[messageId] = {
                    emoji,
                    status: 'error',
                    error: errorMessage(error),
                };
            }
            return false;
        } finally {
            if (generation === requestGeneration && reactionRequests.get(key) === request) {
                reactionRequests.delete(key);
                emit();
            }
        }
    }

    function mergeOlderMessages(history: HistoryState, items: Message[]) {
        const olderIds: string[] = [];
        for (const message of items) {
            if (!history.byId[message.id]) olderIds.push(message.id);
            const mutation = history.reactionMutations[message.id];
            if (mutation?.status === 'pending' && history.viewerId) {
                const optimisticViewerReaction = history.byId[message.id]?.reactions?.find(
                    reaction => reaction.senderId === history.viewerId,
                );
                mutation.rollbackReactions = message.reactions
                    ? [...message.reactions]
                    : undefined;
                history.byId[message.id] = {
                    ...message,
                    reactions: optimisticViewerReaction
                        ? [
                            ...(message.reactions ?? []).filter(
                                reaction => reaction.senderId !== history.viewerId,
                            ),
                            optimisticViewerReaction,
                        ]
                        : message.reactions,
                };
            } else {
                history.byId[message.id] = message;
            }
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
            sendRequests.clear();
            reactionRequests.clear();
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
        revealNewestHistory(threadId: string) {
            const history = state.histories[threadId];
            if (!history || history.status !== 'ready') return false;
            const newest = initialHistoryWindow(history.listedIds);
            if (
                newest.length === history.viewportIds.length &&
                newest.every((id, index) => id === history.viewportIds[index])
            ) return true;
            history.viewportIds = newest;
            history.isReplacingViewport = false;
            emit();
            return true;
        },
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
        setDraft(threadId: string, draft: string) {
            const history = state.histories[threadId];
            if (!history || history.draft === draft) return;
            history.draft = draft;
            emit();
        },
        setReplyTarget(threadId: string, messageId?: string) {
            const history = state.histories[threadId];
            if (!history) return false;
            if (messageId) {
                if (
                    !history.byId[messageId] || messageId.startsWith('local:') ||
                    history.pendingSends[messageId] || history.failedSends[messageId]
                ) return false;
            }
            if (history.replyTargetId === messageId) return true;
            history.replyTargetId = messageId;
            emit();
            return true;
        },
        sendText,
        retrySend(threadId: string, localId: string) {
            const failed = state.histories[threadId]?.failedSends[localId];
            if (!failed) return false;
            void runSend(threadId, failed);
            return true;
        },
        removeFailedSend(threadId: string, localId: string) {
            const history = state.histories[threadId];
            if (!history?.failedSends[localId]) return false;
            delete history.failedSends[localId];
            delete history.pendingSends[localId];
            delete history.byId[localId];
            delete history.rowKeyByMessageId[localId];
            history.listedIds = history.listedIds.filter(id => id !== localId);
            history.viewportIds = history.viewportIds.filter(id => id !== localId);
            const thread = state.inbox.byId[threadId];
            if (thread?.lastMessage?.id === localId) {
                const latestId = history.listedIds.at(-1);
                const latest = latestId ? history.byId[latestId] : undefined;
                state.inbox.byId[threadId] = {
                    ...thread,
                    lastActivityMs: latest?.ts ?? 0,
                    lastMessage: latest,
                };
            }
            emit();
            return true;
        },
        setReaction(threadId: string, messageId: string, emoji: string) {
            if (!emoji) return Promise.resolve(false);
            return runReaction(threadId, messageId, emoji);
        },
        messageRowKey(threadId: string, messageId: string) {
            return state.histories[threadId]?.rowKeyByMessageId[messageId] ?? messageId;
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
