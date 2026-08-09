import type {
    ForwardMessageContent,
    IncomingDmSnapshot,
    Message,
    MessageReaction,
    ReelComment,
    ReelMedia,
    ReplyPreview,
    Thread,
} from '../../lib/domain';
import type { CompleteUiRpc, UiRpc } from './rpc';
import {
    hasLocalOlderIds,
    initialHistoryWindow,
    moveHistoryWindowOlder,
    appendToHistoryWindow,
    historyWindowAroundTarget,
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
    replyNavigation?: {
        requestId: number;
        targetId: string;
        returnId?: string;
        status: 'loading' | 'ready' | 'error';
        pagesLoaded?: number;
        messagesLoaded?: number;
        isPositioned?: boolean;
        error?: string;
    };
    replyReturnStack: string[];
    pendingSends: Record<string, PendingSend>;
    failedSends: Record<string, FailedSend>;
    rowKeyByMessageId: Record<string, string>;
    reactionMutations: Record<string, ReactionMutation>;
    isFollowingNewest: boolean;
    incomingFollowVersion: number;
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

export type PinMutation = {
    pin: boolean;
    status: 'pending' | 'error';
    order: number;
    error?: string;
};

export type ReadMutation = {
    messageId: string;
    status: 'pending' | 'error';
    error?: string;
};

export type ReelMutation = {
    desired: boolean;
    status: 'pending' | 'error';
    error?: string;
    rollbackValue?: boolean;
    rollbackCount?: number;
};

export type ReelState = {
    shortcode: string;
    mediaIdHint?: string;
    media?: ReelMedia;
    status: Status;
    error?: string;
    comments: {
        byId: Record<string, ReelComment>;
        listedIds: string[];
        cursor?: string;
        hasNextPage: boolean;
        status: Status;
        isLoadingMore: boolean;
        failedCursor?: string;
        error?: string;
    };
    likeMutation?: ReelMutation;
    saveMutation?: ReelMutation;
};

export type ForwardTargetProgress = {
    commentSent: boolean;
    complete: boolean;
    targetThreadFbid?: string;
    commentOfflineThreadingId?: string;
    forwardOfflineThreadingId?: string;
    error?: string;
};

export type ForwardingState = {
    sourceThreadId: string;
    sourceMessageId: string;
    sourceThreadIgId: string;
    sourceIsViewer: boolean;
    content: ForwardMessageContent;
    isModalOpen: boolean;
    selectedTargetIds: string[];
    comment: string;
    status: 'idle' | 'submitting' | 'error' | 'success';
    progress: Record<string, ForwardTargetProgress>;
    error?: string;
};

export type GlobalNotification = {
    id: number;
    kind: 'success' | 'error' | 'info';
    message: string;
    action?: {
        label: string;
        run: () => void;
    };
};

export type FrontendStoreRpc = UiRpc & Pick<
    CompleteUiRpc,
    'sendText' | 'forwardMessage' | 'setReaction' | 'markThreadRead'
>;

type IncomingSyncEnvironment = {
    isVisible: () => boolean;
    subscribeVisibility: (listener: () => void) => () => void;
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (timer: unknown) => void;
};

export type FrontendStoreOptions = {
    incomingSync?: false | {
        intervalMs?: number;
        maxBackoffMs?: number;
        environment?: IncomingSyncEnvironment;
    };
};

export type FrontendState = {
    inbox: InboxState;
    pinnedIds: string[];
    committedPinnedIds: string[];
    pinsStatus: Status;
    pinMutations: Record<string, PinMutation>;
    readMutations: Record<string, ReadMutation>;
    selectedThreadId?: string;
    histories: Record<string, HistoryState>;
    reels: {
        activeId?: string;
        activeUrl?: string;
        byId: Record<string, ReelState>;
    };
    forwarding?: ForwardingState;
    notifications: GlobalNotification[];
};

const SIGNED_64_MAX = 9_223_372_036_854_775_807n;
const NINETEEN_DIGIT_MIN = 1_000_000_000_000_000_000n;
const OFFLINE_THREADING_RANDOM_MASK = 0x3f_ffff;

export function createFrontendStore(rpc: FrontendStoreRpc, options: FrontendStoreOptions = {}) {
    const state: FrontendState = {
        inbox: {
            orderedIds: [],
            byId: {},
            hasNextPage: false,
            status: 'idle',
            isLoadingMore: false,
        },
        pinnedIds: [],
        committedPinnedIds: [],
        pinsStatus: 'idle',
        pinMutations: {},
        readMutations: {},
        histories: {},
        reels: { byId: {} },
        notifications: [],
    };
    const listeners = new Set<() => void>();
    const historyRequests = new Map<string, symbol>();
    const olderHistoryRequests = new Map<string, symbol>();
    const olderTriggerTimes = new Map<string, number>();
    const olderTriggerTimers = new Map<string, number>();
    const olderPreloadTimers = new Set<number>();
    const olderSettledListeners = new Map<string, () => void>();
    const olderSettlementWaiters = new Map<string, Set<() => void>>();
    const replyNavigationRequests = new Map<string, symbol>();
    const replyNavigationCancellations = new Map<symbol, () => void>();
    const replyPrefetchQueue: { threadId: string; targetId: string; intent: number }[] = [];
    const queuedReplyPrefetches = new Set<string>();
    const replyPrefetchFailedCursors = new Map<string, string>();
    let activeReplyPrefetch: { threadId: string; targetId: string; intent: number } | undefined;
    let replyPrefetchIntent = 0;
    let visibleReplyPrefetchKey = '';
    const sendRequests = new Map<string, symbol>();
    const reactionRequests = new Map<string, symbol>();
    const pinRequests = new Map<string, symbol>();
    const readRequests = new Map<string, symbol>();
    const readMessageIds = new Map<string, string>();
    const pendingReads = new Map<string, { messageId: string; requireDisplayed: boolean }>();
    const reelMediaRequests = new Map<string, symbol>();
    const reelCommentRequests = new Map<string, symbol>();
    const reelLikeRequests = new Map<string, symbol>();
    const reelSaveRequests = new Map<string, symbol>();
    const reelLikeReceiptRevisions = new Map<string, number>();
    const reelSaveReceiptRevisions = new Map<string, number>();
    const reelMediaSettledListeners = new Map<string, Set<() => void>>();
    const reelPreloadQueue: { shortcode: string; mediaId?: string; budgeted: boolean }[] = [];
    const queuedReelPreloads = new Set<string>();
    let activeReelPreloads = 0;
    let reelPreloadsStarted = 0;
    type PinOperation = {
        threadId: string;
        pin: boolean;
        order: number;
        status: 'pending' | 'succeeded' | 'failed';
        authoritativeIds?: string[];
    };
    const pinOperations: PinOperation[] = [];
    let nextPinMutationOrder = 0;
    let pinRevision = 0;
    let nextPinRead = 0;
    let latestPinRead = 0;
    const openedThreadIds = new Set<string>();
    let inboxRequest: symbol | undefined;
    let generation = 0;
    let nextReplyNavigationRequestId = 0;
    let warmupGeneration = 0;
    const warmupTimers = new Set<number>();
    let warmupsStarted = 0;
    let visibleWarmupKey = '';
    let visibleWarmupIds = new Set<string>();
    const generatedOfflineThreadingIds = new Set<string>();
    let forwardRequest: symbol | undefined;
    let nextNotificationId = 1;
    let threadMutationRevision = 0;
    const threadMutationRevisions = new Map<string, number>();
    const reactionStateRevisions = new Map<string, number>();
    const sendRevisions = new Map<string, number>();
    let started = false;
    let incomingPollRequest: symbol | undefined;
    let incomingPollTimer: unknown;
    let incomingPollFailures = 0;
    let unsubscribeIncomingVisibility: (() => void) | undefined;
    const defaultIncomingEnvironment: IncomingSyncEnvironment | undefined =
        typeof document !== 'undefined' && typeof window !== 'undefined'
            ? {
                isVisible: () => document.visibilityState !== 'hidden',
                subscribeVisibility: listener => {
                    document.addEventListener('visibilitychange', listener);
                    return () => document.removeEventListener('visibilitychange', listener);
                },
                setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
                clearTimeout: timer => window.clearTimeout(timer as number),
            }
            : undefined;
    const incomingSync = options.incomingSync === false
        ? undefined
        : {
            intervalMs: options.incomingSync?.intervalMs ?? 5_000,
            maxBackoffMs: options.incomingSync?.maxBackoffMs ?? 60_000,
            environment: options.incomingSync?.environment ?? defaultIncomingEnvironment,
        };

    function emit() {
        listeners.forEach(listener => listener());
    }

    function notify(notification: Omit<GlobalNotification, 'id'>) {
        const id = nextNotificationId++;
        state.notifications.push({ id, ...notification });
        emit();
        return id;
    }

    function dismissNotification(id: number) {
        const index = state.notifications.findIndex(notification => notification.id === id);
        if (index < 0) return false;
        state.notifications.splice(index, 1);
        emit();
        return true;
    }

    function reelState(shortcode: string, mediaId?: string): ReelState {
        const existing = state.reels.byId[shortcode];
        if (existing) {
            if (!existing.mediaIdHint && mediaId && /^\d+$/.test(mediaId))
                existing.mediaIdHint = mediaId;
            return existing;
        }
        return state.reels.byId[shortcode] = {
            shortcode,
            mediaIdHint: mediaId && /^\d+$/.test(mediaId) ? mediaId : undefined,
            status: 'idle',
            comments: {
                byId: {},
                listedIds: [],
                hasNextPage: false,
                status: 'idle',
                isLoadingMore: false,
            },
        };
    }

    function waitForReelMedia(shortcode: string) {
        return new Promise<void>(resolve => {
            const listeners = reelMediaSettledListeners.get(shortcode) ?? new Set();
            listeners.add(resolve);
            reelMediaSettledListeners.set(shortcode, listeners);
        });
    }

    async function loadReelMedia(shortcode: string, mediaId?: string, force = false) {
        const reel = reelState(shortcode, mediaId);
        if (reelMediaRequests.has(shortcode)) {
            await waitForReelMedia(shortcode);
            const settled = state.reels.byId[shortcode];
            return settled?.status === 'ready' ? settled.media : undefined;
        }
        if (reel.media && !force) return reel.media;
        const request = Symbol(`reel:${shortcode}`);
        const requestGeneration = generation;
        const likeReceiptRevision = reelLikeReceiptRevisions.get(shortcode) ?? 0;
        const saveReceiptRevision = reelSaveReceiptRevisions.get(shortcode) ?? 0;
        reelMediaRequests.set(shortcode, request);
        reel.status = 'loading';
        reel.error = undefined;
        emit();
        try {
            const result = await rpc.getReelMedia({
                shortcode,
                mediaId: reel.mediaIdHint,
            });
            if (generation !== requestGeneration || reelMediaRequests.get(shortcode) !== request)
                return undefined;
            if (!result.ok) {
                reel.status = 'error';
                reel.error = result.error.message;
                return undefined;
            }
            if (
                result.value.shortcode !== shortcode ||
                !/^\d+$/.test(result.value.id) ||
                (reel.mediaIdHint !== undefined && result.value.id !== reel.mediaIdHint)
            ) {
                reel.status = 'error';
                reel.error = 'Instagram reel response identity did not match the request';
                return undefined;
            }
            let refreshedMedia = result.value;
            const currentMedia = reel.media;
            if (reel.likeMutation?.status === 'pending') {
                const receiptSettledAfterRefreshStarted =
                    (reelLikeReceiptRevisions.get(shortcode) ?? 0) !== likeReceiptRevision;
                const rollbackValue = receiptSettledAfterRefreshStarted
                    ? reel.likeMutation.rollbackValue ?? refreshedMedia.hasLiked
                    : refreshedMedia.hasLiked;
                const rollbackCount = receiptSettledAfterRefreshStarted
                    ? Math.max(0, refreshedMedia.likeCount +
                        (refreshedMedia.hasLiked === rollbackValue ? 0 : rollbackValue ? 1 : -1))
                    : refreshedMedia.likeCount;
                reel.likeMutation.rollbackValue = rollbackValue;
                reel.likeMutation.rollbackCount = rollbackCount;
                refreshedMedia = {
                    ...refreshedMedia,
                    hasLiked: reel.likeMutation.desired,
                    likeCount: Math.max(0, rollbackCount +
                        (rollbackValue === reel.likeMutation.desired
                            ? 0
                            : reel.likeMutation.desired ? 1 : -1)),
                };
            } else if (
                currentMedia &&
                (reelLikeReceiptRevisions.get(shortcode) ?? 0) !== likeReceiptRevision
            ) {
                refreshedMedia = {
                    ...refreshedMedia,
                    hasLiked: currentMedia.hasLiked,
                    likeCount: currentMedia.likeCount,
                };
            }
            if (reel.saveMutation?.status === 'pending') {
                if ((reelSaveReceiptRevisions.get(shortcode) ?? 0) === saveReceiptRevision)
                    reel.saveMutation.rollbackValue = refreshedMedia.hasSaved;
                refreshedMedia = { ...refreshedMedia, hasSaved: reel.saveMutation.desired };
            } else if (
                currentMedia &&
                (reelSaveReceiptRevisions.get(shortcode) ?? 0) !== saveReceiptRevision
            ) {
                refreshedMedia = { ...refreshedMedia, hasSaved: currentMedia.hasSaved };
            }
            reel.media = refreshedMedia;
            reel.mediaIdHint = result.value.id;
            reel.status = 'ready';
            return reel.media;
        } catch (error) {
            if (generation === requestGeneration && reelMediaRequests.get(shortcode) === request) {
                reel.status = 'error';
                reel.error = errorMessage(error);
            }
            return undefined;
        } finally {
            if (generation === requestGeneration && reelMediaRequests.get(shortcode) === request) {
                reelMediaRequests.delete(shortcode);
                emit();
                reelMediaSettledListeners.get(shortcode)?.forEach(listener => listener());
                reelMediaSettledListeners.delete(shortcode);
            }
        }
    }

    function drainReelPreloads() {
        while (activeReelPreloads < 2 && reelPreloadQueue.length) {
            const next = reelPreloadQueue.shift()!;
            queuedReelPreloads.delete(next.shortcode);
            if (state.reels.byId[next.shortcode]?.media || reelMediaRequests.has(next.shortcode)) continue;
            activeReelPreloads++;
            if (next.budgeted) reelPreloadsStarted++;
            void loadReelMedia(next.shortcode, next.mediaId).finally(() => {
                activeReelPreloads--;
                if (generation >= 0) drainReelPreloads();
            });
        }
    }

    function scheduleReelsFromMessages(messages: Message[], shouldPreload = true) {
        for (const message of [...messages].reverse()) {
            if (message.kind !== 'reel_share') continue;
            const shortcode = message.shortcode;
            reelState(shortcode, message.mediaId);
            if (
                !shouldPreload ||
                reelPreloadsStarted + reelPreloadQueue.filter(item => item.budgeted).length >= 8 ||
                queuedReelPreloads.has(shortcode) ||
                reelMediaRequests.has(shortcode) ||
                state.reels.byId[shortcode]?.media
            ) continue;
            queuedReelPreloads.add(shortcode);
            reelPreloadQueue.push({ shortcode, mediaId: message.mediaId, budgeted: true });
        }
        drainReelPreloads();
    }

    function prioritizeReelPreloads(shortcodes: string[]) {
        if (!shortcodes.length) return;
        const priority = [...new Set(shortcodes)];
        const prioritized: { shortcode: string; mediaId?: string; budgeted: boolean }[] = [];
        for (const shortcode of priority) {
            const queuedIndex = reelPreloadQueue.findIndex(item => item.shortcode === shortcode);
            if (queuedIndex >= 0) {
                prioritized.push(reelPreloadQueue.splice(queuedIndex, 1)[0]);
                continue;
            }
            const reel = state.reels.byId[shortcode];
            if (
                !reel || reel.media || reelMediaRequests.has(shortcode)
            ) continue;
            // Near-visible media is user-directed work. It remains concurrency
            // bounded, but must not be blocked by the speculative lifetime budget.
            prioritized.push({ shortcode, mediaId: reel.mediaIdHint, budgeted: false });
            queuedReelPreloads.add(shortcode);
        }
        if (!prioritized.length) return;
        reelPreloadQueue.unshift(...prioritized);
        drainReelPreloads();
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
            const merged = preserveOutgoing
                ? {
                    ...thread,
                    lastActivityMs: existing.lastActivityMs,
                    lastMessage: existing.lastMessage,
                }
                : thread;
            const locallyReadMessageId = readMessageIds.get(thread.key);
            const preserveRead = locallyReadMessageId !== undefined &&
                merged.lastMessage?.id === locallyReadMessageId;
            state.inbox.byId[thread.key] = preserveRead
                ? { ...merged, isUnread: false }
                : merged;
        }
        state.inbox.orderedIds.sort((left, right) =>
            state.inbox.byId[right].lastActivityMs - state.inbox.byId[left].lastActivityMs,
        );
        return added;
    }

    function reactionKey(threadId: string, messageId: string) {
        return `${threadId}\u0000${messageId}`;
    }

    function reactionsMatch(left?: MessageReaction[], right?: MessageReaction[]) {
        if (left === right) return true;
        if (left?.length !== right?.length) return false;
        return left?.every((reaction, index) => {
            const other = right?.[index];
            return other?.senderId === reaction.senderId &&
                other.reaction === reaction.reaction &&
                other.timestampMs === reaction.timestampMs;
        }) ?? true;
    }

    function mergeIncomingMessage(
        threadId: string,
        history: HistoryState,
        message: Message,
        reactionRevisions: Map<string, number>,
    ) {
        const existing = history.byId[message.id];
        const mutation = history.reactionMutations[message.id];
        const key = reactionKey(threadId, message.id);
        const capturedRevision = reactionRevisions.get(message.id) ?? 0;
        let merged = existing && existing.ts > message.ts
            ? { ...existing, reactions: message.reactions }
            : message;
        if (
            mutation?.status === 'pending' && history.viewerId &&
            (reactionStateRevisions.get(key) ?? 0) <= capturedRevision
        ) {
            const viewerReaction = existing?.reactions?.find(
                reaction => reaction.senderId === history.viewerId,
            );
            mutation.rollbackReactions = message.reactions ? [...message.reactions] : undefined;
            const remoteWithoutViewer = (message.reactions ?? []).filter(
                reaction => reaction.senderId !== history.viewerId,
            );
            merged = {
                ...merged,
                reactions: viewerReaction
                    ? [
                        ...remoteWithoutViewer,
                        viewerReaction,
                    ]
                    : remoteWithoutViewer,
            };
        } else if (
            existing &&
            (reactionStateRevisions.get(key) ?? 0) > capturedRevision
        ) {
            merged = { ...merged, reactions: existing.reactions };
        }
        if (existing && !reactionsMatch(existing.reactions, merged.reactions)) {
            reactionStateRevisions.set(key, (reactionStateRevisions.get(key) ?? 0) + 1);
        }
        history.byId[message.id] = merged;
        return !existing;
    }

    function applyIncomingSnapshot(
        snapshot: IncomingDmSnapshot,
        readRevision = threadMutationRevision,
        reactionRevisions?: Map<string, number>,
    ) {
        if (!started) return false;
        mergeThreads(snapshot.threads, readRevision);
        const incomingHistory = snapshot.history;
        const history = incomingHistory
            ? state.histories[incomingHistory.threadId]
            : undefined;
        if (history && history.status === 'ready') {
            const capturedReactionRevisions = reactionRevisions ?? new Map(
                incomingHistory!.messages.map(message => [
                    message.id,
                    reactionStateRevisions.get(
                        reactionKey(incomingHistory!.threadId, message.id),
                    ) ?? 0,
                ]),
            );
            const added: string[] = [];
            for (const message of incomingHistory!.messages) {
                if (mergeIncomingMessage(
                    incomingHistory!.threadId,
                    history,
                    message,
                    capturedReactionRevisions,
                )) added.push(message.id);
            }
            if (added.length) {
                const order = new Map(history.listedIds.map((id, index) => [id, index]));
                history.listedIds = [...new Set([...history.listedIds, ...added])].sort((left, right) => {
                    const delta = history.byId[left].ts - history.byId[right].ts;
                    return delta || (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
                        (order.get(right) ?? Number.MAX_SAFE_INTEGER);
                });
                if (history.isFollowingNewest && state.selectedThreadId === incomingHistory!.threadId) {
                    history.viewportIds = initialHistoryWindow(history.listedIds);
                    history.incomingFollowVersion++;
                }
                scheduleReelsFromMessages(
                    added.map(id => history.byId[id]).filter(Boolean),
                );
            }
            history.viewerId ||= incomingHistory!.viewerId;
        }
        const displayedUnreadThreadId = incomingHistory?.threadId;
        const displayedHistory = displayedUnreadThreadId
            ? state.histories[displayedUnreadThreadId]
            : undefined;
        const displayedMessageId = displayedUnreadThreadId
            ? state.inbox.byId[displayedUnreadThreadId]?.lastMessage?.id
            : undefined;
        const correlatedDisplayedMessageId = displayedMessageId !== undefined &&
            displayedHistory?.listedIds.at(-1) === displayedMessageId &&
            incomingHistory?.messages.some(message => message.id === displayedMessageId)
            ? displayedMessageId
            : undefined;
        emit();
        if (displayedUnreadThreadId && correlatedDisplayedMessageId) {
            void markThreadRead(displayedUnreadThreadId, correlatedDisplayedMessageId);
        }
        return true;
    }

    function clearIncomingPollTimer() {
        if (incomingPollTimer === undefined || !incomingSync?.environment) return;
        incomingSync.environment.clearTimeout(incomingPollTimer);
        incomingPollTimer = undefined;
    }

    function scheduleIncomingPoll(delayMs?: number) {
        clearIncomingPollTimer();
        const sync = incomingSync;
        const environment = sync?.environment;
        if (!started || !sync || !environment?.isVisible()) return;
        const delay = delayMs ?? Math.min(
            sync.intervalMs * 2 ** incomingPollFailures,
            sync.maxBackoffMs,
        );
        incomingPollTimer = environment.setTimeout(() => {
            incomingPollTimer = undefined;
            void pollIncoming();
        }, delay);
    }

    async function pollIncoming() {
        const environment = incomingSync?.environment;
        if (!started || !environment?.isVisible()) return false;
        if (incomingPollRequest) return false;
        if (inboxRequest) {
            // The consumed timer (or visibility resume) collided with the
            // ordinary inbox owner. Retain the current failure backoff and
            // install exactly one bounded retry rather than stopping the loop.
            scheduleIncomingPoll();
            return false;
        }
        const request = Symbol('incoming-poll');
        const requestGeneration = generation;
        const readRevision = threadMutationRevision;
        const selectedThreadId = state.selectedThreadId;
        const selectedThread = selectedThreadId ? state.inbox.byId[selectedThreadId] : undefined;
        const selectedHistory = selectedThreadId ? state.histories[selectedThreadId] : undefined;
        const pollHistory = Boolean(
            selectedThreadId && selectedThread && selectedHistory?.status === 'ready' &&
            !historyRequests.has(selectedThreadId) &&
            !olderHistoryRequests.has(selectedThreadId) &&
            !hasInFlightSend(selectedThreadId),
        );
        const sendRevision = selectedThreadId ? sendRevisions.get(selectedThreadId) ?? 0 : 0;
        const capturedReactionRevisions = new Map<string, number>();
        if (pollHistory) {
            for (const id of selectedHistory!.listedIds) {
                capturedReactionRevisions.set(
                    id,
                    reactionStateRevisions.get(reactionKey(selectedThreadId!, id)) ?? 0,
                );
            }
        }
        incomingPollRequest = request;
        inboxRequest = request;
        if (pollHistory) historyRequests.set(selectedThreadId!, request);
        try {
            const [inboxResult, historyResult] = await Promise.all([
                rpc.getInbox({}),
                pollHistory
                    ? rpc.getThread({ threadKey: selectedThread!.cursor ?? selectedThread!.key })
                    : Promise.resolve(undefined),
            ]);
            if (generation !== requestGeneration || incomingPollRequest !== request || !started)
                return false;
            if (!inboxResult.ok || (historyResult && !historyResult.ok)) {
                incomingPollFailures++;
                return false;
            }
            applyIncomingSnapshot({
                kind: 'snapshot',
                threads: inboxResult.value.items,
                history: historyResult && selectedThreadId &&
                    !hasInFlightSend(selectedThreadId) &&
                    (sendRevisions.get(selectedThreadId) ?? 0) === sendRevision
                    ? {
                        threadId: selectedThreadId,
                        messages: historyResult.value.items,
                        viewerId: historyResult.value.viewerId,
                    }
                    : undefined,
            }, readRevision, capturedReactionRevisions);
            incomingPollFailures = 0;
            return true;
        } catch {
            if (generation === requestGeneration && incomingPollRequest === request)
                incomingPollFailures++;
            return false;
        } finally {
            if (generation === requestGeneration && incomingPollRequest === request) {
                incomingPollRequest = undefined;
                if (inboxRequest === request) inboxRequest = undefined;
                if (selectedThreadId && historyRequests.get(selectedThreadId) === request)
                    historyRequests.delete(selectedThreadId);
                scheduleIncomingPoll();
            }
        }
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
        const readRevision = pinRevision;
        const read = ++nextPinRead;
        latestPinRead = read;
        state.pinsStatus = 'loading';
        emit();
        try {
            const result = await rpc.getPins();
            if (
                generation !== requestGeneration || latestPinRead !== read ||
                readRevision !== pinRevision
            ) return;
            state.committedPinnedIds = [...new Set(result.pinned)];
            reconcilePins();
            state.pinsStatus = 'ready';
        } catch {
            if (
                generation !== requestGeneration || latestPinRead !== read ||
                readRevision !== pinRevision
            ) return;
            state.pinsStatus = 'error';
        }
        if (
            generation === requestGeneration && latestPinRead === read &&
            readRevision === pinRevision
        ) emit();
    }

    function replayPinOperations(base: string[]) {
        const ids = [...base];
        for (const operation of pinOperations) {
            if (operation.status === 'failed') continue;
            const existing = ids.indexOf(operation.threadId);
            if (existing >= 0) ids.splice(existing, 1);
            if (operation.pin) ids.unshift(operation.threadId);
        }
        return ids;
    }

    function reconcilePins() {
        state.pinnedIds = replayPinOperations(state.committedPinnedIds);
    }

    function commitSettledPinOperations() {
        while (pinOperations[0]?.status !== 'pending') {
            const operation = pinOperations.shift();
            if (!operation) break;
            if (operation.status === 'succeeded') {
                state.committedPinnedIds = operation.authoritativeIds!;
                delete state.pinMutations[operation.threadId];
            } else {
                state.pinMutations[operation.threadId] = {
                    pin: operation.pin,
                    order: operation.order,
                    status: 'error',
                    error: state.pinMutations[operation.threadId]?.error,
                };
            }
        }
        reconcilePins();
    }

    async function togglePin(threadId: string) {
        const thread = state.inbox.byId[threadId];
        if (!thread?.threadFbid || pinRequests.has(threadId)) return false;
        const pin = !state.pinnedIds.includes(threadId);
        const request = Symbol(threadId);
        const requestGeneration = generation;
        const order = ++nextPinMutationOrder;
        const operation: PinOperation = { threadId, pin, order, status: 'pending' };
        pinRequests.set(threadId, request);
        pinOperations.push(operation);
        pinRevision++;
        state.pinMutations[threadId] = { pin, order, status: 'pending' };
        reconcilePins();
        emit();

        try {
            const result = await rpc.togglePin({
                threadKey: threadId,
                threadFbid: thread.threadFbid,
                pin,
            });
            if (generation !== requestGeneration || pinRequests.get(threadId) !== request)
                return false;
            if (!result.ok) throw new Error(result.error.message);
            if (
                result.value.receipt.threadFbid !== thread.threadFbid ||
                result.value.receipt.isPinned !== pin
            ) throw new Error('Instagram conversation pin receipt did not match the request');
            operation.status = 'succeeded';
            operation.authoritativeIds = [...new Set(result.value.pinned)];
            pinRevision++;
            commitSettledPinOperations();
            return true;
        } catch (error) {
            if (generation !== requestGeneration || pinRequests.get(threadId) !== request)
                return false;
            operation.status = 'failed';
            pinRevision++;
            state.pinMutations[threadId] = {
                pin,
                order,
                status: 'error',
                error: errorMessage(error),
            };
            commitSettledPinOperations();
            return false;
        } finally {
            if (generation === requestGeneration && pinRequests.get(threadId) === request) {
                pinRequests.delete(threadId);
                emit();
            }
        }
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
            replyReturnStack: [],
            pendingSends: {},
            failedSends: {},
            rowKeyByMessageId: {},
            reactionMutations: {},
            isFollowingNewest: false,
            incomingFollowVersion: 0,
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
            scheduleReelsFromMessages(result.value.items, !isPreloading);
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

    function nextOfflineThreadingId(history?: HistoryState) {
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
            history?.pendingSends[`local:${id}`] ||
            history?.failedSends[`local:${id}`]
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
            case 'activity': return { kind: 'unavailable', label: message.text };
            case 'unsupported': return {
                kind: 'unavailable',
                label: message.fallback.preview || message.fallback.label,
            };
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
        sendRevisions.set(threadId, (sendRevisions.get(threadId) ?? 0) + 1);
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
                sendRevisions.set(threadId, (sendRevisions.get(threadId) ?? 0) + 1);
                emit();
            }
        }
    }

    function hasInFlightSend(threadId: string) {
        const prefix = `${threadId}\u0000`;
        return [...sendRequests.keys()].some(key => key.startsWith(prefix));
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

    function forwardingContent(message: Message) {
        if (message.kind === 'text') return { kind: 'text' as const, text: message.text };
        if (message.kind === 'reel_share' && message.mediaType === 'reel' && message.mediaId) {
            return { kind: 'reel' as const, mediaId: message.mediaId };
        }
        return undefined;
    }

    async function submitForwarding() {
        const forwarding = state.forwarding;
        if (!forwarding || forwarding.status === 'submitting' || !forwarding.selectedTargetIds.length) {
            return false;
        }
        const request = Symbol('forward');
        const requestGeneration = generation;
        forwardRequest = request;
        forwarding.status = 'submitting';
        forwarding.isModalOpen = false;
        forwarding.error = undefined;
        for (const targetId of forwarding.selectedTargetIds) {
            forwarding.progress[targetId] ??= { commentSent: false, complete: false };
            forwarding.progress[targetId].error = undefined;
        }
        emit();
        const comment = forwarding.comment.trim();

        await Promise.all(forwarding.selectedTargetIds.map(async targetId => {
            const progress = forwarding.progress[targetId];
            if (progress.complete) return;
            const targetThreadFbid = progress.targetThreadFbid ?? state.inbox.byId[targetId]?.threadFbid;
            if (!targetThreadFbid) {
                progress.error = 'Conversation is not available for forwarding.';
                return;
            }
            progress.targetThreadFbid = targetThreadFbid;
            try {
                if (comment && !progress.commentSent) {
                    const commentId = progress.commentOfflineThreadingId ??= nextOfflineThreadingId();
                    const commentResult = await rpc.sendText({
                        threadFbid: targetThreadFbid,
                        text: comment,
                        offlineThreadingId: commentId,
                    });
                    if (!commentResult.ok) throw new Error(commentResult.error.message);
                    if (generation !== requestGeneration || forwardRequest !== request || state.forwarding !== forwarding) return;
                    progress.commentSent = true;
                }
                const forwardId = progress.forwardOfflineThreadingId ??= nextOfflineThreadingId();
                const result = await rpc.forwardMessage({
                    targetThreadFbid,
                    sourceThreadIgId: forwarding.sourceThreadIgId,
                    sourceIsViewer: forwarding.sourceIsViewer,
                    offlineThreadingId: forwardId,
                    content: forwarding.content,
                });
                if (!result.ok) throw new Error(result.error.message);
                if (generation !== requestGeneration || forwardRequest !== request || state.forwarding !== forwarding) return;
                progress.complete = true;
            } catch (error) {
                if (generation === requestGeneration && forwardRequest === request && state.forwarding === forwarding) {
                    progress.error = errorMessage(error);
                }
            }
        }));

        if (generation !== requestGeneration || forwardRequest !== request || state.forwarding !== forwarding) return false;
        forwardRequest = undefined;
        const failed = forwarding.selectedTargetIds.filter(id => !forwarding.progress[id]?.complete);
        if (failed.length) {
            forwarding.status = 'error';
            forwarding.error = `Could not forward to ${failed.length} ${failed.length === 1 ? 'conversation' : 'conversations'}. Retry to continue.`;
            notify({
                kind: 'error',
                message: forwarding.error,
                action: {
                    label: 'Retry',
                    run: () => {
                        if (state.forwarding === forwarding) void submitForwarding();
                    },
                },
            });
            return false;
        }
        forwarding.status = 'success';
        forwarding.error = undefined;
        notify({
            kind: 'success',
            message: `Message forwarded to ${forwarding.selectedTargetIds.length} ${forwarding.selectedTargetIds.length === 1 ? 'conversation' : 'conversations'}.`,
        });
        return true;
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
        const remove = message.reactions?.some(reaction =>
            reaction.senderId === viewerId && reaction.reaction === emoji) ?? false;
        const previous = message.reactions ? [...message.reactions] : undefined;
        const optimistic: MessageReaction[] = (message.reactions ?? [])
            .filter(reaction => reaction.senderId !== viewerId);
        if (!remove) optimistic.push({ senderId: viewerId, reaction: emoji, timestampMs: Date.now() });
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
                remove,
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
            reactionStateRevisions.set(
                reactionKey(threadId, messageId),
                (reactionStateRevisions.get(reactionKey(threadId, messageId)) ?? 0) + 1,
            );
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

    function mergeOlderMessages(
        threadId: string,
        history: HistoryState,
        items: Message[],
        reactionRevisions: Map<string, number>,
    ) {
        const olderIds: string[] = [];
        for (const message of items) {
            if (!history.byId[message.id]) olderIds.push(message.id);
            mergeIncomingMessage(threadId, history, message, reactionRevisions);
        }
        if (olderIds.length) history.listedIds = [...olderIds, ...history.listedIds];
        // Older pages can contain many offscreen shares. Normalize them now and
        // let the viewport signal which media is worth warming.
        scheduleReelsFromMessages(items, false);
        return olderIds.length;
    }

    async function requestOlderHistory(
        threadId: string,
        mode: 'visible' | 'preload' | 'fill' | 'navigate' | 'reply-prefetch',
    ) {
        const history = state.histories[threadId];
        const thread = state.inbox.byId[threadId];
        const cursor = history?.cursor;
        if (
            !history || !thread || !cursor || !history.hasOlder ||
            historyRequests.has(threadId) || olderHistoryRequests.has(threadId) ||
            history.failedOlderCursor === cursor
        ) return false;

        const request = Symbol(`older:${threadId}`);
        const requestGeneration = generation;
        const capturedReactionRevisions = new Map(history.listedIds.map(id => [
            id,
            reactionStateRevisions.get(reactionKey(threadId, id)) ?? 0,
        ]));
        olderHistoryRequests.set(threadId, request);
        if (mode === 'preload') history.isPreloadingOlder = true;
        else if (mode !== 'reply-prefetch') history.isLoadingOlder = true;
        if (mode !== 'reply-prefetch') history.error = undefined;
        if (mode !== 'reply-prefetch') emit();

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
                if (mode === 'reply-prefetch') replyPrefetchFailedCursors.set(threadId, cursor);
                else if (mode === 'navigate' && state.selectedThreadId !== threadId) {
                    // An abandoned explicit lookup may finish, but must not
                    // leave user-visible failure intent in the old thread.
                } else {
                    history.error = result.error.message;
                    history.failedOlderCursor = cursor;
                }
                return false;
            }
            const added = mergeOlderMessages(
                threadId,
                history,
                result.value.items,
                capturedReactionRevisions,
            );
            if (result.value.hasNextPage && result.value.cursor === cursor && added === 0) {
                if (mode === 'reply-prefetch') replyPrefetchFailedCursors.set(threadId, cursor);
                else if (mode === 'navigate' && state.selectedThreadId !== threadId) {
                    // Selection cancellation owns the visible state.
                } else {
                    history.error = 'History pagination made no progress';
                    history.failedOlderCursor = cursor;
                }
                return false;
            }
            history.cursor = result.value.cursor;
            history.hasOlder = result.value.hasNextPage;
            history.viewerId = history.viewerId || result.value.viewerId;
            history.failedOlderCursor = undefined;
            loaded = true;
            return true;
        } catch (error) {
            if (
                generation === requestGeneration &&
                olderHistoryRequests.get(threadId) === request
            ) {
                if (mode === 'reply-prefetch') replyPrefetchFailedCursors.set(threadId, cursor);
                else if (mode === 'navigate' && state.selectedThreadId !== threadId) {
                    // Selection cancellation owns the visible state.
                } else {
                    history.error = errorMessage(error);
                    history.failedOlderCursor = cursor;
                }
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
                olderSettlementWaiters.get(threadId)?.forEach(resolve => resolve());
                olderSettlementWaiters.delete(threadId);
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
            history.replyNavigation?.status === 'loading' ||
            (history.replyNavigation?.status === 'ready' &&
                !history.replyNavigation.isPositioned) ||
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

    function waitForOlderHistory(threadId: string) {
        if (!olderHistoryRequests.has(threadId)) return Promise.resolve();
        return new Promise<void>(resolve => {
            const waiters = olderSettlementWaiters.get(threadId) ?? new Set<() => void>();
            waiters.add(resolve);
            olderSettlementWaiters.set(threadId, waiters);
        });
    }

    function waitForReplyNavigationStep(request: symbol, step: Promise<boolean>) {
        return new Promise<{ cancelled: boolean; loaded: boolean }>(resolve => {
            let settled = false;
            const finish = (cancelled: boolean, loaded: boolean) => {
                if (settled) return;
                settled = true;
                replyNavigationCancellations.delete(request);
                resolve({ cancelled, loaded });
            };
            replyNavigationCancellations.set(request, () => finish(true, false));
            void step.then(loaded => finish(false, loaded), () => finish(false, false));
        });
    }

    function updateReplyNavigationProgress(
        threadId: string,
        history: HistoryState,
        request: symbol,
        beforeCount: number,
        beforeCursor?: string,
    ) {
        if (
            replyNavigationRequests.get(threadId) !== request ||
            state.selectedThreadId !== threadId
        ) return;
        const navigation = history.replyNavigation;
        if (!navigation || navigation.status !== 'loading') return;
        if (history.cursor === beforeCursor && history.listedIds.length === beforeCount) return;
        navigation.pagesLoaded = (navigation.pagesLoaded ?? 0) + 1;
        navigation.messagesLoaded = (navigation.messagesLoaded ?? 0) +
            Math.max(0, history.listedIds.length - beforeCount);
        emit();
    }

    async function drainReplyPrefetchQueue() {
        if (activeReplyPrefetch || replyNavigationRequests.size) return;
        const next = replyPrefetchQueue.shift();
        if (!next) return;
        queuedReplyPrefetches.delete(`${next.threadId}\u0000${next.targetId}`);
        const history = state.histories[next.threadId];
        if (
            next.intent !== replyPrefetchIntent || state.selectedThreadId !== next.threadId ||
            !history || history.status !== 'ready' || history.byId[next.targetId] ||
            !history.hasOlder || !history.cursor ||
            replyPrefetchFailedCursors.get(next.threadId) === history.cursor
        ) {
            void drainReplyPrefetchQueue();
            return;
        }
        const task = { ...next };
        activeReplyPrefetch = task;
        const requestGeneration = generation;
        try {
            // A visible target may spend at most one older page. This bounds
            // work as well as queue size; an explicit click can join this page
            // and then continue through as many cursors as necessary.
            if (olderHistoryRequests.has(next.threadId)) await waitForOlderHistory(next.threadId);
            else await requestOlderHistory(next.threadId, 'reply-prefetch');
        } finally {
            if (activeReplyPrefetch === task) activeReplyPrefetch = undefined;
            if (generation === requestGeneration) void drainReplyPrefetchQueue();
        }
    }

    function resumeReplyPrefetchQueueAfterRender() {
        const requestGeneration = generation;
        if (typeof window.requestAnimationFrame !== 'function') {
            void drainReplyPrefetchQueue();
            return;
        }
        window.requestAnimationFrame(() => {
            if (generation === requestGeneration) void drainReplyPrefetchQueue();
        });
    }

    function prefetchReplyTargets(threadId: string, targetIds: string[]) {
        const history = state.histories[threadId];
        if (!history || history.status !== 'ready' || state.selectedThreadId !== threadId) return;
        const uniqueTargets = [...new Set(targetIds.filter(Boolean))];
        const visibleKey = `${threadId}\u0000${uniqueTargets.join('\u0000')}`;
        if (visibleKey === visibleReplyPrefetchKey) {
            // Explicit navigation only pauses the queue. A post-navigation DOM
            // scan with unchanged targets resumes any still-relevant work.
            void drainReplyPrefetchQueue();
            return;
        }
        visibleReplyPrefetchKey = visibleKey;
        const intent = ++replyPrefetchIntent;
        replyPrefetchQueue.length = 0;
        queuedReplyPrefetches.clear();
        for (const targetId of uniqueTargets) {
            const key = `${threadId}\u0000${targetId}`;
            if (
                !targetId || history.byId[targetId] || queuedReplyPrefetches.has(key) ||
                (activeReplyPrefetch?.threadId === threadId && activeReplyPrefetch.targetId === targetId)
            ) continue;
            // Four is the global cap including the page currently in flight.
            if (replyPrefetchQueue.length + (activeReplyPrefetch ? 1 : 0) >= 4) break;
            replyPrefetchQueue.push({ threadId, targetId, intent });
            queuedReplyPrefetches.add(key);
        }
        void drainReplyPrefetchQueue();
    }

    async function navigateToReply(threadId: string, targetId: string, returnId?: string) {
        const history = state.histories[threadId];
        if (
            !history || history.status !== 'ready' || !targetId ||
            state.selectedThreadId !== threadId
        ) return false;
        const previousRequest = replyNavigationRequests.get(threadId);
        if (previousRequest) replyNavigationCancellations.get(previousRequest)?.();
        const request = Symbol(`reply-navigation:${threadId}`);
        const navigationRequestId = ++nextReplyNavigationRequestId;
        const requestGeneration = generation;
        replyNavigationRequests.set(threadId, request);
        history.replyNavigation = {
            requestId: navigationRequestId,
            targetId,
            ...(returnId ? { returnId } : {}),
            status: 'loading',
            pagesLoaded: 0,
            messagesLoaded: 0,
        };
        replyPrefetchFailedCursors.delete(threadId);
        history.failedOlderCursor = undefined;
        history.error = undefined;
        emit();

        while (
            generation === requestGeneration &&
            replyNavigationRequests.get(threadId) === request &&
            state.selectedThreadId === threadId
        ) {
            if (history.byId[targetId]) {
                const viewportIds = historyWindowAroundTarget(history.listedIds, targetId);
                if (!viewportIds.length) break;
                history.viewportIds = viewportIds;
                history.isReplacingViewport = false;
                history.replyNavigation = {
                    requestId: navigationRequestId,
                    targetId,
                    ...(returnId ? { returnId } : {}),
                    status: 'ready',
                };
                if (
                    returnId && returnId !== targetId && history.byId[returnId] &&
                    history.replyReturnStack.at(-1) !== returnId
                ) history.replyReturnStack.push(returnId);
                replyNavigationRequests.delete(threadId);
                emit();
                resumeReplyPrefetchQueueAfterRender();
                return true;
            }
            if (!history.hasOlder || !history.cursor) {
                history.replyNavigation = {
                    requestId: navigationRequestId,
                    targetId,
                    ...(returnId ? { returnId } : {}),
                    status: 'error',
                    error: 'Original message is unavailable.',
                };
                replyNavigationRequests.delete(threadId);
                emit();
                resumeReplyPrefetchQueueAfterRender();
                return false;
            }
            const beforeCount = history.listedIds.length;
            const beforeCursor = history.cursor;
            if (olderHistoryRequests.has(threadId)) {
                const step = await waitForReplyNavigationStep(
                    request,
                    waitForOlderHistory(threadId).then(() => true),
                );
                if (step.cancelled) return false;
                updateReplyNavigationProgress(threadId, history, request, beforeCount, beforeCursor);
                continue;
            }
            const step = await waitForReplyNavigationStep(
                request,
                requestOlderHistory(threadId, 'navigate'),
            );
            if (step.cancelled) return false;
            const loaded = step.loaded;
            if (loaded) updateReplyNavigationProgress(
                threadId,
                history,
                request,
                beforeCount,
                beforeCursor,
            );
            if (!loaded) {
                if (
                    generation !== requestGeneration ||
                    replyNavigationRequests.get(threadId) !== request
                ) return false;
                history.replyNavigation = {
                    requestId: navigationRequestId,
                    targetId,
                    ...(returnId ? { returnId } : {}),
                    status: 'error',
                    error: history.error || 'Could not load the original message.',
                };
                history.error = undefined;
                replyNavigationRequests.delete(threadId);
                emit();
                resumeReplyPrefetchQueueAfterRender();
                return false;
            }
        }
        return false;
    }

    async function returnFromReplyNavigation(threadId: string) {
        const history = state.histories[threadId];
        const targetId = history?.replyReturnStack.at(-1);
        if (!history || !targetId) return false;
        const stackLength = history.replyReturnStack.length;
        const navigated = await navigateToReply(threadId, targetId);
        if (
            !navigated || state.selectedThreadId !== threadId ||
            history.replyReturnStack.length !== stackLength ||
            history.replyReturnStack.at(-1) !== targetId
        ) return false;
        history.replyReturnStack.pop();
        emit();
        return true;
    }

    function abandonReplyNavigationExcept(selectedThreadId?: string) {
        for (const [threadId, request] of replyNavigationRequests) {
            if (threadId === selectedThreadId) continue;
            replyNavigationCancellations.get(request)?.();
            replyNavigationRequests.delete(threadId);
        }
        for (const [threadId, history] of Object.entries(state.histories)) {
            if (threadId === selectedThreadId) continue;
            const navigation = history.replyNavigation;
            if (
                navigation?.status === 'loading' ||
                (navigation?.status === 'ready' && !navigation.isPositioned)
            ) delete history.replyNavigation;
        }
        visibleReplyPrefetchKey = '';
        replyPrefetchIntent++;
        replyPrefetchQueue.length = 0;
        queuedReplyPrefetches.clear();
    }

    async function loadReelComments(shortcode: string, cursor?: string) {
        const reel = state.reels.byId[shortcode];
        const mediaId = reel?.media?.id ?? reel?.mediaIdHint;
        const isLoadingMore = cursor !== undefined;
        if (
            !reel || !mediaId || reelCommentRequests.has(shortcode) || (
                isLoadingMore
                    ? reel.comments.status !== 'ready' || !reel.comments.hasNextPage ||
                        reel.comments.cursor !== cursor || reel.comments.failedCursor === cursor
                    : reel.comments.status === 'ready'
            )
        ) return !isLoadingMore && reel?.comments.status === 'ready';
        const request = Symbol(`reel-comments:${shortcode}`);
        const requestGeneration = generation;
        reelCommentRequests.set(shortcode, request);
        if (isLoadingMore) reel.comments.isLoadingMore = true;
        else reel.comments.status = 'loading';
        reel.comments.error = undefined;
        emit();
        try {
            const result = await rpc.getReelComments({ mediaId, ...(cursor ? { cursor } : {}) });
            if (generation !== requestGeneration || reelCommentRequests.get(shortcode) !== request)
                return false;
            if (!result.ok) {
                if (isLoadingMore) reel.comments.failedCursor = cursor;
                else reel.comments.status = 'error';
                reel.comments.error = result.error.message;
                return false;
            }
            const beforeCount = reel.comments.listedIds.length;
            for (const comment of result.value.items) {
                if (!reel.comments.byId[comment.id]) reel.comments.listedIds.push(comment.id);
                reel.comments.byId[comment.id] = comment;
            }
            if (
                isLoadingMore && result.value.hasNextPage &&
                result.value.cursor === cursor && reel.comments.listedIds.length === beforeCount
            ) {
                reel.comments.failedCursor = cursor;
                reel.comments.error = 'Comment pagination made no progress.';
                return false;
            }
            reel.comments.cursor = result.value.cursor;
            reel.comments.hasNextPage = result.value.hasNextPage;
            reel.comments.status = 'ready';
            reel.comments.failedCursor = undefined;
            return true;
        } catch (error) {
            if (generation === requestGeneration && reelCommentRequests.get(shortcode) === request) {
                if (isLoadingMore) reel.comments.failedCursor = cursor;
                else reel.comments.status = 'error';
                reel.comments.error = errorMessage(error);
            }
            return false;
        } finally {
            if (generation === requestGeneration && reelCommentRequests.get(shortcode) === request) {
                reelCommentRequests.delete(shortcode);
                reel.comments.isLoadingMore = false;
                emit();
            }
        }
    }

    async function openReel(shortcode: string, mediaId?: string, targetUrl?: string) {
        const requestGeneration = generation;
        state.reels.activeId = shortcode;
        state.reels.activeUrl = targetUrl;
        reelState(shortcode, mediaId);
        emit();
        let media: ReelMedia | undefined;
        if (reelMediaRequests.has(shortcode)) {
            await waitForReelMedia(shortcode);
            const settled = state.reels.byId[shortcode];
            media = settled?.status === 'ready' ? settled.media : undefined;
        } else {
            media = await loadReelMedia(shortcode, mediaId);
        }
        if (
            generation !== requestGeneration || !media ||
            state.reels.activeId !== shortcode
        ) return false;
        return loadReelComments(shortcode);
    }

    async function setReelLiked(shortcode: string) {
        const reel = state.reels.byId[shortcode];
        const media = reel?.media;
        if (!reel || !media || reelLikeRequests.has(shortcode)) return false;
        const desired = !media.hasLiked;
        const previous = media.hasLiked;
        const previousCount = media.likeCount;
        const request = Symbol(`reel-like:${shortcode}`);
        const requestGeneration = generation;
        reelLikeRequests.set(shortcode, request);
        reel.media = {
            ...media,
            hasLiked: desired,
            likeCount: Math.max(0, media.likeCount + (desired ? 1 : -1)),
        };
        reel.likeMutation = {
            desired,
            status: 'pending',
            rollbackValue: previous,
            rollbackCount: previousCount,
        };
        emit();
        try {
            const result = await rpc.setReelLiked({ mediaId: media.id, liked: desired });
            if (generation !== requestGeneration || reelLikeRequests.get(shortcode) !== request)
                return false;
            if (!result.ok || result.value.mediaId !== media.id || result.value.hasLiked !== desired) {
                reel.media = {
                    ...reel.media!,
                    hasLiked: reel.likeMutation?.rollbackValue ?? previous,
                    likeCount: reel.likeMutation?.rollbackCount ?? previousCount,
                };
                reel.likeMutation = {
                    desired,
                    status: 'error',
                    error: result.ok ? 'Reel like receipt did not match the request' : result.error.message,
                };
                return false;
            }
            reel.media = { ...reel.media!, hasLiked: result.value.hasLiked };
            reelLikeReceiptRevisions.set(
                shortcode,
                (reelLikeReceiptRevisions.get(shortcode) ?? 0) + 1,
            );
            reel.likeMutation = undefined;
            return true;
        } catch (error) {
            if (generation === requestGeneration && reelLikeRequests.get(shortcode) === request) {
                reel.media = {
                    ...reel.media!,
                    hasLiked: reel.likeMutation?.rollbackValue ?? previous,
                    likeCount: reel.likeMutation?.rollbackCount ?? previousCount,
                };
                reel.likeMutation = { desired, status: 'error', error: errorMessage(error) };
            }
            return false;
        } finally {
            if (generation === requestGeneration && reelLikeRequests.get(shortcode) === request) {
                reelLikeRequests.delete(shortcode);
                emit();
            }
        }
    }

    async function setReelSaved(shortcode: string) {
        const reel = state.reels.byId[shortcode];
        const media = reel?.media;
        if (!reel || !media || reelSaveRequests.has(shortcode)) return false;
        const desired = !media.hasSaved;
        const previous = media.hasSaved;
        const request = Symbol(`reel-save:${shortcode}`);
        const requestGeneration = generation;
        reelSaveRequests.set(shortcode, request);
        reel.media = { ...media, hasSaved: desired };
        reel.saveMutation = { desired, status: 'pending', rollbackValue: previous };
        emit();
        try {
            const result = await rpc.setReelSaved({ mediaId: media.id, saved: desired });
            if (generation !== requestGeneration || reelSaveRequests.get(shortcode) !== request)
                return false;
            if (!result.ok || result.value.mediaId !== media.id || result.value.hasSaved !== desired) {
                reel.media = {
                    ...reel.media!,
                    hasSaved: reel.saveMutation?.rollbackValue ?? previous,
                };
                reel.saveMutation = {
                    desired,
                    status: 'error',
                    error: result.ok ? 'Reel save receipt did not match the request' : result.error.message,
                };
                return false;
            }
            reel.media = { ...reel.media!, hasSaved: result.value.hasSaved };
            reelSaveReceiptRevisions.set(
                shortcode,
                (reelSaveReceiptRevisions.get(shortcode) ?? 0) + 1,
            );
            reel.saveMutation = undefined;
            return true;
        } catch (error) {
            if (generation === requestGeneration && reelSaveRequests.get(shortcode) === request) {
                reel.media = {
                    ...reel.media!,
                    hasSaved: reel.saveMutation?.rollbackValue ?? previous,
                };
                reel.saveMutation = { desired, status: 'error', error: errorMessage(error) };
            }
            return false;
        } finally {
            if (generation === requestGeneration && reelSaveRequests.get(shortcode) === request) {
                reelSaveRequests.delete(shortcode);
                emit();
            }
        }
    }

    function cancelWarmups() {
        warmupGeneration++;
        warmupTimers.forEach(timer => window.clearTimeout(timer));
        warmupTimers.clear();
    }

    function isLatestMessageDisplayed(threadId: string, messageId: string) {
        const thread = state.inbox.byId[threadId];
        const history = state.histories[threadId];
        return started && state.selectedThreadId === threadId &&
            thread?.lastMessage?.id === messageId &&
            history?.status === 'ready' && history.isFollowingNewest &&
            history.listedIds.at(-1) === messageId &&
            history.viewportIds.includes(messageId);
    }

    async function markThreadRead(threadId: string, displayedMessageId?: string) {
        const thread = state.inbox.byId[threadId];
        const message = thread?.lastMessage;
        if (
            !thread?.isUnread || !thread.threadIgId || !message || message.ts <= 0 ||
            (displayedMessageId !== undefined &&
                !isLatestMessageDisplayed(threadId, displayedMessageId))
        ) return false;
        if (readRequests.has(threadId)) {
            if (readMessageIds.get(threadId) !== message.id) {
                pendingReads.set(threadId, {
                    messageId: message.id,
                    requireDisplayed: displayedMessageId !== undefined,
                });
            }
            return false;
        }
        const request = Symbol(`read:${threadId}`);
        const requestGeneration = generation;
        readRequests.set(threadId, request);
        readMessageIds.set(threadId, message.id);
        thread.isUnread = false;
        state.readMutations[threadId] = { messageId: message.id, status: 'pending' };
        emit();
        try {
            const result = await rpc.markThreadRead({
                threadIgId: thread.threadIgId,
                messageId: message.id,
                messageTimestampMs: message.ts,
            });
            if (generation !== requestGeneration || readRequests.get(threadId) !== request)
                return false;
            if (!result.ok) throw new Error(result.error.message);
            delete state.readMutations[threadId];
            return true;
        } catch (error) {
            if (generation === requestGeneration && readRequests.get(threadId) === request) {
                if (readMessageIds.get(threadId) === message.id) readMessageIds.delete(threadId);
                const current = state.inbox.byId[threadId];
                if (current?.lastMessage?.id === message.id) current.isUnread = true;
                state.readMutations[threadId] = {
                    messageId: message.id,
                    status: 'error',
                    error: errorMessage(error),
                };
            }
            return false;
        } finally {
            if (generation === requestGeneration && readRequests.get(threadId) === request) {
                readRequests.delete(threadId);
                const pendingRead = pendingReads.get(threadId);
                pendingReads.delete(threadId);
                emit();
                if (pendingRead) {
                    void markThreadRead(
                        threadId,
                        pendingRead.requireDisplayed ? pendingRead.messageId : undefined,
                    );
                }
            }
        }
    }

    function selectThread(threadId: string) {
        cancelWarmups();
        warmupsStarted = 0;
        visibleWarmupKey = '';
        if (state.selectedThreadId !== threadId) {
            const history = state.histories[threadId];
            if (history) history.isFollowingNewest = false;
        }
        state.selectedThreadId = threadId;
        abandonReplyNavigationExcept(threadId);
        openedThreadIds.add(threadId);
        emit();
        void markThreadRead(threadId);
        void loadInitialHistory(threadId);
    }

    function showInbox() {
        if (!state.selectedThreadId) return;
        cancelWarmups();
        warmupsStarted = 0;
        visibleWarmupKey = '';
        state.selectedThreadId = undefined;
        abandonReplyNavigationExcept();
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
        openForwarding(sourceThreadId: string, sourceMessageId: string) {
            if (state.forwarding?.status === 'submitting') {
                notify({ kind: 'info', message: 'A message is already being forwarded.' });
                return false;
            }
            const history = state.histories[sourceThreadId];
            const message = history?.byId[sourceMessageId];
            const sourceThread = state.inbox.byId[sourceThreadId];
            const content = message && forwardingContent(message);
            if (!message || !content || !history?.viewerId || !sourceThread?.threadIgId) return false;
            state.forwarding = {
                sourceThreadId,
                sourceMessageId,
                sourceThreadIgId: sourceThread.threadIgId,
                sourceIsViewer: 'senderId' in message && message.senderId === history.viewerId,
                content,
                isModalOpen: true,
                selectedTargetIds: [],
                comment: '',
                status: 'idle',
                progress: {},
            };
            emit();
            return true;
        },
        closeForwarding() {
            if (!state.forwarding || state.forwarding.status === 'submitting') return false;
            state.forwarding = undefined;
            emit();
            return true;
        },
        toggleForwardTarget(targetId: string) {
            const forwarding = state.forwarding;
            const target = state.inbox.byId[targetId];
            if (!forwarding || forwarding.status === 'submitting' || forwarding.status === 'success' ||
                !target?.threadFbid) return false;
            const selected = forwarding.selectedTargetIds.includes(targetId);
            if (!selected && forwarding.selectedTargetIds.length >= 5) return false;
            forwarding.selectedTargetIds = selected
                ? forwarding.selectedTargetIds.filter(id => id !== targetId)
                : [...forwarding.selectedTargetIds, targetId];
            forwarding.status = 'idle';
            forwarding.error = undefined;
            emit();
            return true;
        },
        setForwardComment(comment: string) {
            const forwarding = state.forwarding;
            if (!forwarding || forwarding.status === 'submitting' || forwarding.status === 'success' ||
                Object.values(forwarding.progress).some(progress => progress.commentOfflineThreadingId)) return false;
            forwarding.comment = comment;
            forwarding.error = undefined;
            if (forwarding.status === 'error') forwarding.status = 'idle';
            emit();
            return true;
        },
        notify,
        dismissNotification,
        submitForwarding,
        start() {
            const firstStart = !started;
            started = true;
            void loadInbox();
            void loadPins();
            const environment = incomingSync?.environment;
            if (firstStart && environment) {
                unsubscribeIncomingVisibility = environment.subscribeVisibility(() => {
                    clearIncomingPollTimer();
                    if (environment.isVisible()) void pollIncoming();
                });
                scheduleIncomingPoll();
            }
        },
        destroy() {
            started = false;
            generation++;
            clearIncomingPollTimer();
            unsubscribeIncomingVisibility?.();
            unsubscribeIncomingVisibility = undefined;
            incomingPollRequest = undefined;
            forwardRequest = undefined;
            replyNavigationCancellations.forEach(cancel => cancel());
            replyNavigationCancellations.clear();
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
            olderSettlementWaiters.forEach(waiters => waiters.forEach(resolve => resolve()));
            olderSettlementWaiters.clear();
            replyNavigationRequests.clear();
            replyPrefetchQueue.length = 0;
            queuedReplyPrefetches.clear();
            replyPrefetchFailedCursors.clear();
            activeReplyPrefetch = undefined;
            visibleReplyPrefetchKey = '';
            replyPrefetchIntent++;
            sendRequests.clear();
            reactionRequests.clear();
            reactionStateRevisions.clear();
            sendRevisions.clear();
            pinRequests.clear();
            readRequests.clear();
            readMessageIds.clear();
            pendingReads.clear();
            reelMediaRequests.clear();
            reelCommentRequests.clear();
            reelLikeRequests.clear();
            reelSaveRequests.clear();
            reelLikeReceiptRevisions.clear();
            reelSaveReceiptRevisions.clear();
            reelMediaSettledListeners.forEach(listeners =>
                listeners.forEach(listener => listener()),
            );
            reelMediaSettledListeners.clear();
            reelPreloadQueue.length = 0;
            queuedReelPreloads.clear();
            pinOperations.length = 0;
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
        navigateToReply,
        prefetchReplyTargets,
        returnFromReplyNavigation,
        completeReplyNavigationPosition(threadId: string, requestId: number) {
            const navigation = state.histories[threadId]?.replyNavigation;
            if (
                state.selectedThreadId !== threadId ||
                navigation?.status !== 'ready' || navigation.requestId !== requestId ||
                navigation.isPositioned
            ) return;
            navigation.isPositioned = true;
            emit();
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
        setHistoryFollowingNewest(threadId: string, following: boolean) {
            if (state.selectedThreadId !== threadId) return;
            const history = state.histories[threadId];
            if (history) history.isFollowingNewest = following;
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
        openReel,
        prioritizeReelPreloads,
        closeReel() {
            if (!state.reels.activeId) return;
            state.reels.activeId = undefined;
            state.reels.activeUrl = undefined;
            emit();
        },
        async retryReel(shortcode: string) {
            const reel = state.reels.byId[shortcode];
            if (!reel) return undefined;
            if (!reelMediaRequests.has(shortcode)) {
                reel.status = 'idle';
                reel.error = undefined;
            }
            const media = await loadReelMedia(shortcode, reel.mediaIdHint, true);
            if (media && state.reels.activeId === shortcode)
                await loadReelComments(shortcode);
            return media;
        },
        retryReelComments(shortcode: string) {
            const reel = state.reels.byId[shortcode];
            if (!reel) return Promise.resolve(false);
            if (reel.comments.failedCursor) {
                const cursor = reel.comments.failedCursor;
                reel.comments.failedCursor = undefined;
                reel.comments.error = undefined;
                return loadReelComments(shortcode, cursor);
            }
            reel.comments.status = 'idle';
            reel.comments.error = undefined;
            return loadReelComments(shortcode);
        },
        loadNextReelComments(shortcode: string) {
            const comments = state.reels.byId[shortcode]?.comments;
            if (!comments?.cursor) return Promise.resolve(false);
            return loadReelComments(shortcode, comments.cursor);
        },
        toggleReelLiked: setReelLiked,
        toggleReelSaved: setReelSaved,
        togglePin,
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
        applyIncomingSnapshot(snapshot: IncomingDmSnapshot) {
            return applyIncomingSnapshot(snapshot);
        },
        pollIncomingNow: pollIncoming,
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unexpected extension error';
}

export type FrontendStore = ReturnType<typeof createFrontendStore>;
