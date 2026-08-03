import type {
    ChangeEvent,
    FormEvent,
    KeyboardEvent,
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    UIEvent,
} from 'react';
import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from '../../vendor/teact/src/teact/teact';
import type { Message, Thread, User } from '../../lib/domain';
import type { FrontendStore, HistoryState } from './store';
import { hasLocalOlderIds } from './history-window';
import { computeChatWindow } from './virtual-list';

const ROW_HEIGHT = 72;
const REACTION_EMOJIS = ['❤', '😂', '😮', '😢', '😡', '👍'];

type AppProps = { store: FrontendStore };

type SurfacePoint = { x: number; y: number; align?: 'left' | 'right' };

export default function App({ store }: AppProps) {
    useStore(store);
    const state = store.state;
    const selected = state.selectedThreadId
        ? state.inbox.byId[state.selectedThreadId]
        : undefined;

    return (
        <main className={`app-shell${selected ? ' app-shell--conversation-selected' : ''}`}>
            <aside className="sidebar">
                <header className="sidebar__header">
                    <span className="brand-mark">IC</span>
                    <div>
                        <h1>Messages</h1>
                        <p>Instagram inbox</p>
                    </div>
                </header>
                <ChatList store={store} />
            </aside>
            <section className="conversation">
                {selected ? (
                    <MessagePane
                        store={store}
                        thread={selected}
                        history={state.histories[selected.key]}
                    />
                ) : (
                    <div className="conversation-state conversation-state--welcome">
                        <div className="welcome-card">
                            <div className="welcome-icon" aria-hidden="true">✦</div>
                            <h2>Select a conversation</h2>
                            <p>Choose a chat to view its recent messages.</p>
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}

function ChatList({ store }: AppProps) {
    const [scrollTop, setScrollTop] = useState(0);
    const state = store.state;
    const ids = store.orderedThreadIds();
    const { start, end } = computeChatWindow(scrollTop, ids.length);
    const visibleIds = ids.slice(start, end);
    const visibleKey = visibleIds.join('\u0000');
    const selectedHistoryStatus = state.selectedThreadId
        ? state.histories[state.selectedThreadId]?.status
        : undefined;

    useEffect(() => {
        if (end >= ids.length - 5) store.loadNextInboxPage();
        store.warmVisibleThreads(visibleIds);
    }, [
        visibleKey,
        ids.length,
        end,
        state.inbox.status,
        state.inbox.isLoadingMore,
        state.selectedThreadId,
        selectedHistoryStatus,
    ]);

    if (state.inbox.status === 'loading' && ids.length === 0) {
        return <ListState label="Loading conversations…" spinner />;
    }
    if (state.inbox.status === 'error' && ids.length === 0) {
        return (
            <ListState
                label={state.inbox.error ?? 'Could not load inbox'}
                error
                actionLabel="Retry"
                onAction={store.retryInbox}
            />
        );
    }
    if (state.inbox.status === 'ready' && ids.length === 0) {
        return <ListState label="Your inbox is empty" />;
    }

    return (
        <div
            className="chat-list"
            onScroll={(event: UIEvent<HTMLDivElement>) =>
                setScrollTop(event.currentTarget.scrollTop)
            }
        >
            <div
                className="chat-list__spacer"
                style={{ height: `${ids.length * ROW_HEIGHT}px` }}
                teactFastList
            >
                {visibleIds.map((id, offset) => (
                    <ChatRow
                        key={id}
                        thread={state.inbox.byId[id]}
                        index={start + offset}
                        selected={id === state.selectedThreadId}
                        pinned={state.pinnedIds.includes(id)}
                        onSelect={() => store.selectThread(id)}
                    />
                ))}
            </div>
            {state.inbox.isLoadingMore && (
                <div className="chat-list__tail status-surface" role="status">
                    <span className="spinner spinner--small" aria-hidden="true" />
                    <span>Loading more…</span>
                </div>
            )}
            {state.inbox.error && ids.length > 0 && (
                <div className="chat-list__tail chat-list__tail--error status-surface" role="alert">
                    <span>{state.inbox.error}</span>
                    <button type="button" onClick={store.retryInbox}>Retry</button>
                </div>
            )}
        </div>
    );
}

type ChatRowProps = {
    thread: Thread;
    index: number;
    selected: boolean;
    pinned: boolean;
    onSelect: () => void;
};

function ChatRow({ thread, index, selected, pinned, onSelect }: ChatRowProps) {
    const [menuPoint, setMenuPoint] = useState<SurfacePoint>();
    const rowRef = useRef<HTMLButtonElement>(null as unknown as HTMLButtonElement);
    const longPress = useLongPress(openMenu, !selected);
    const user = thread.users[0];
    const snippet = thread.lastMessage ? messageSummary(thread.lastMessage) : 'No messages yet';

    function openMenu(point: SurfacePoint) {
        if (selected) return;
        setMenuPoint(point);
    }

    return (
        <div
            className={`chat-row${selected ? ' chat-row--selected' : ''}`}
            style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
        >
            <button
                ref={rowRef}
                type="button"
                className="chat-row__select"
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    if (!longPress.consumeSyntheticEvent(event)) onSelect();
                }}
                onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    if (selected) return;
                    event.preventDefault();
                    if (!longPress.consumeSyntheticEvent(event)) {
                        openMenu({ x: event.clientX, y: event.clientY });
                    }
                }}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                    if (selected) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMenu({ x: rect.left + 24, y: rect.top + rect.height / 2 });
                }}
                onPointerDown={longPress.onPointerDown}
                onPointerMove={longPress.onPointerMove}
                onPointerUp={longPress.onPointerUp}
                onPointerCancel={longPress.onPointerCancel}
                aria-pressed={selected}
                aria-label={`${thread.title}${thread.isMuted ? ', muted' : ''}${pinned ? ', pinned' : ''}`}
            >
                <span className="avatar">
                    {user?.picUrl ? (
                        <img src={user.picUrl} alt="" width="52" height="52" loading="lazy" />
                    ) : (
                        <span>{initials(thread.title)}</span>
                    )}
                </span>
                <span className="chat-row__body">
                    <span className="chat-row__topline">
                        <strong>{thread.title}</strong>
                        <time dateTime={new Date(thread.lastActivityMs).toISOString()}>
                            {formatThreadTime(thread.lastActivityMs)}
                        </time>
                    </span>
                    <span className="chat-row__bottomline">
                        <span className="chat-row__snippet">{snippet}</span>
                        <span className="chat-row__badges">
                            {thread.isMuted && <span className="chat-row__badge" title="Muted" aria-hidden="true">⌁</span>}
                            {pinned && <span className="chat-row__badge chat-row__badge--accent" title="Pinned" aria-hidden="true">◆</span>}
                        </span>
                    </span>
                </span>
            </button>
            {menuPoint && (
                <ContextMenu
                    label={`Actions for ${thread.title}`}
                    point={menuPoint}
                    returnFocusRef={rowRef}
                    onClose={() => setMenuPoint(undefined)}
                    items={[{
                        label: 'Open conversation',
                        action: onSelect,
                    }]}
                />
            )}
        </div>
    );
}

function MessagePane({
    store,
    thread,
    history,
}: {
    store: FrontendStore;
    thread: Thread;
    history?: HistoryState;
}) {
    const scrollerRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const sentinelRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const contentRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const pendingAnchorRef = useRef<{ id: string; top: number }>();
    const resizeAnchorRef = useRef<{ id: string; top: number }>();
    const sentinelIntersectingRef = useRef(false);
    const revealTimerRef = useRef<number>();
    const continuationTimersRef = useRef(new Set<number>());
    const activeThreadRef = useRef(thread.key);
    const openedThreadRef = useRef('');
    const followNewestThreadRef = useRef<string>();
    const viewportKey = history?.viewportIds.join('\u0000') ?? '';

    activeThreadRef.current = thread.key;

    const clearRevealTimer = () => {
        if (revealTimerRef.current !== undefined) {
            window.clearTimeout(revealTimerRef.current);
            revealTimerRef.current = undefined;
        }
    };

    const clearContinuationTimers = () => {
        continuationTimersRef.current.forEach(timer => window.clearTimeout(timer));
        continuationTimersRef.current.clear();
    };

    const scheduleThreadContinuation = (
        threadKey: string,
        callback: () => void,
        delay: number,
    ) => {
        if (
            activeThreadRef.current !== threadKey ||
            store.state.selectedThreadId !== threadKey
        ) return;
        const timer = window.setTimeout(() => {
            continuationTimersRef.current.delete(timer);
            if (
                activeThreadRef.current === threadKey &&
                store.state.selectedThreadId === threadKey
            ) callback();
        }, delay);
        continuationTimersRef.current.add(timer);
    };

    const isSentinelInRange = () => {
        const scroller = scrollerRef.current;
        const sentinel = sentinelRef.current;
        if (!scroller || !sentinel) return false;
        const rootRect = scroller.getBoundingClientRect();
        const sentinelRect = sentinel.getBoundingClientRect();
        return sentinelRect.bottom >= rootRect.top - 750 && sentinelRect.top <= rootRect.bottom;
    };

    const captureAnchor = () => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const visible = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .filter(row => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
        const row = visible[1] ?? visible[0];
        if (row?.dataset.messageId) {
            pendingAnchorRef.current = {
                id: row.dataset.messageId,
                top: row.getBoundingClientRect().top,
            };
        }
    };

    const reevaluateOlderReveal = () => {
        const originatingThreadKey = thread.key;
        if (
            activeThreadRef.current !== originatingThreadKey ||
            store.state.selectedThreadId !== originatingThreadKey
        ) return;
        sentinelIntersectingRef.current = isSentinelInRange();
        if (!sentinelIntersectingRef.current) {
            clearRevealTimer();
            return;
        }
        const currentHistory = store.state.histories[thread.key];
        const hasLocalOlder = currentHistory && hasLocalOlderIds(
            currentHistory.listedIds,
            currentHistory.viewportIds,
        );
        if (revealTimerRef.current !== undefined && !hasLocalOlder) return;
        if (hasLocalOlder) clearRevealTimer();
        captureAnchor();
        const result = store.revealOlderHistory(thread.key);
        if (result.completion) {
            void result.completion.finally(() => {
                scheduleThreadContinuation(thread.key, () => {
                    if (!isSentinelInRange()) return;
                    clearRevealTimer();
                    captureAnchor();
                    store.revealOlderHistory(thread.key, true);
                }, 0);
            });
        }
        if (result.retryAfterMs !== undefined) {
            const timer = window.setTimeout(
                () => {
                    if (revealTimerRef.current !== timer) return;
                    revealTimerRef.current = undefined;
                    if (
                        activeThreadRef.current !== originatingThreadKey ||
                        store.state.selectedThreadId !== originatingThreadKey
                    ) return;
                    reevaluateOlderReveal();
                },
                result.retryAfterMs + 1,
            );
            revealTimerRef.current = timer;
        }
    };

    useLayoutEffect(() => {
        clearRevealTimer();
        clearContinuationTimers();
        followNewestThreadRef.current = undefined;
        return () => {
            clearRevealTimer();
            clearContinuationTimers();
        };
    }, [thread.key]);

    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller || history?.status !== 'ready') return;
        if (openedThreadRef.current !== thread.key) {
            openedThreadRef.current = thread.key;
            const saved = history.scrollAnchor;
            const row = saved
                ? scroller.querySelector<HTMLElement>(`[data-message-id="${cssEscape(saved.id)}"]`)
                : undefined;
            if (row && saved) {
                const actual = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
                scroller.scrollTop += actual - saved.offset;
            } else {
                scroller.scrollTop = scroller.scrollHeight;
            }
        }
        const pending = pendingAnchorRef.current;
        if (history.isReplacingViewport) {
            if (pending) {
                const row = scroller.querySelector<HTMLElement>(
                    `[data-message-id="${cssEscape(pending.id)}"]`,
                );
                if (row) scroller.scrollTop += row.getBoundingClientRect().top - pending.top;
                pendingAnchorRef.current = undefined;
            }
            store.completeHistoryReplacement(thread.key);
            if (isSentinelInRange()) {
                clearRevealTimer();
                captureAnchor();
                store.revealOlderHistory(thread.key, true);
            }
            reevaluateOlderReveal();
            scheduleThreadContinuation(thread.key, reevaluateOlderReveal, 50);
        }
        updateResizeAnchor(scroller, resizeAnchorRef);
        if (
            scroller.scrollHeight <= scroller.clientHeight + 1 && history.hasOlder &&
            !history.isLoadingOlder && !history.isPreloadingOlder &&
            !history.isReplacingViewport && !history.failedOlderCursor
        ) {
            captureAnchor();
            const completion = store.fillSelectedHistory(thread.key);
            if (completion) {
                void completion.finally(() => scheduleThreadContinuation(thread.key, () => {
                    captureAnchor();
                    store.fillSelectedHistory(thread.key);
                }, 0));
            }
        }
    }, [
        thread.key,
        history?.status,
        viewportKey,
        history?.listedIds.length,
        history?.cursor,
        history?.isLoadingOlder,
        history?.isPreloadingOlder,
        history?.isReplacingViewport,
    ]);

    useLayoutEffect(() => {
        if (followNewestThreadRef.current !== thread.key) return;
        const scroller = scrollerRef.current;
        if (!scroller) return;
        scroller.scrollTop = scroller.scrollHeight;
        followNewestThreadRef.current = undefined;
        updateResizeAnchor(scroller, resizeAnchorRef);
    }, [thread.key, viewportKey]);

    useEffect(() => {
        const root = scrollerRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel || !history || history.status !== 'ready') return;
        const observer = new IntersectionObserver(entries => {
            sentinelIntersectingRef.current = entries.some(entry => entry.isIntersecting);
            reevaluateOlderReveal();
        }, { root, rootMargin: '750px 0px 0px' });
        observer.observe(sentinel);
        return () => {
            observer.disconnect();
            sentinelIntersectingRef.current = false;
            clearRevealTimer();
        };
    }, [thread.key, history?.status]);

    useEffect(() => {
        reevaluateOlderReveal();
    }, [
        thread.key,
        viewportKey,
        history?.listedIds.length,
        history?.cursor,
        history?.hasOlder,
        history?.isLoadingOlder,
        history?.isPreloadingOlder,
        history?.isReplacingViewport,
        history?.failedOlderCursor,
    ]);

    useEffect(() => store.subscribe(reevaluateOlderReveal), [store, thread.key]);

    useLayoutEffect(() => store.onOlderHistorySettled(thread.key, () => {
        scheduleThreadContinuation(thread.key, () => {
            if (!isSentinelInRange()) return;
            clearRevealTimer();
            captureAnchor();
            store.revealOlderHistory(thread.key, true);
        }, 50);
    }), [store, thread.key]);

    useEffect(() => {
        const scroller = scrollerRef.current;
        const content = contentRef.current;
        if (!scroller || !content || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            const anchor = resizeAnchorRef.current;
            if (!anchor || history?.isReplacingViewport) return;
            const row = scroller.querySelector<HTMLElement>(
                `[data-message-id="${cssEscape(anchor.id)}"]`,
            );
            if (!row) return;
            const top = row.getBoundingClientRect().top;
            const delta = top - anchor.top;
            if (Math.abs(delta) > 0.01) scroller.scrollTop += delta;
            updateResizeAnchor(scroller, resizeAnchorRef);
            reevaluateOlderReveal();
        });
        observer.observe(content);
        return () => observer.disconnect();
    }, [thread.key]);

    const onScroll = () => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
        if (row?.dataset.messageId) {
            store.saveHistoryAnchor(thread.key, {
                id: row.dataset.messageId,
                offset: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
            });
        }
        updateResizeAnchor(scroller, resizeAnchorRef);
    };

    const submitDraft = () => {
        const currentHistory = store.state.histories[thread.key];
        const scroller = scrollerRef.current;
        if (!currentHistory || !scroller) return false;
        // This measurement intentionally happens immediately before dispatch.
        const latestLoadedId = currentHistory.listedIds.at(-1);
        const followNewest = Boolean(
            latestLoadedId &&
            currentHistory.viewportIds.includes(latestLoadedId) &&
            isAtBottom(scroller),
        );
        const localId = store.sendText(thread.key, currentHistory.draft, {
            followNewest,
            replyToMessageId: currentHistory.replyTargetId,
        });
        if (localId && followNewest) followNewestThreadRef.current = thread.key;
        return Boolean(localId);
    };

    const showNewest = () => {
        followNewestThreadRef.current = thread.key;
        store.revealNewestHistory(thread.key);
    };

    const latestId = history?.listedIds.at(-1);
    const hasNewerMessages = Boolean(
        latestId && history && !history.viewportIds.includes(latestId),
    );
    const selectReply = useCallback((messageId: string) => {
        const scroller = scrollerRef.current;
        const visible = scroller
            ? [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
                .filter(row => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top)
            : [];
        const anchor = visible[1] ?? visible[0];
        const anchorTop = anchor?.getBoundingClientRect().top;
        if (!store.setReplyTarget(thread.key, messageId)) return;
        requestAnimationFrame(() => {
            if (scroller && anchor && anchorTop !== undefined) {
                scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
            }
            document.querySelector<HTMLTextAreaElement>('.composer textarea')
                ?.focus({ preventScroll: true });
        });
    }, [store, thread.key]);

    return (
        <>
            <header className="conversation__header">
                <button
                    type="button"
                    className="conversation__back"
                    onClick={store.showInbox}
                    aria-label="Back to inbox"
                >
                    <span aria-hidden="true">←</span>
                </button>
                <span className="avatar avatar--small">
                    {thread.users[0]?.picUrl ? (
                        <img src={thread.users[0].picUrl} alt="" width="40" height="40" />
                    ) : (
                        <span>{initials(thread.title)}</span>
                    )}
                </span>
                <div>
                    <h2>{thread.title}</h2>
                    <p>{thread.isGroup ? `${thread.users.length} members` : 'Instagram'}</p>
                </div>
            </header>
            <div className="messages" ref={scrollerRef} onScroll={onScroll}>
                {(!history || history.status === 'loading') && (
                    <ListState label="Loading recent messages…" spinner />
                )}
                {history?.status === 'error' && (
                    <ListState
                        label={history.error ?? 'Could not load messages'}
                        error
                        actionLabel="Retry"
                        onAction={() => store.retryHistory(thread.key)}
                    />
                )}
                {history?.status === 'ready' && history.viewportIds.length === 0 && (
                    <ListState label="No messages in this conversation" />
                )}
                {history?.status === 'ready' && (
                    <>
                        {(history.isLoadingOlder || history.isPreloadingOlder) && (
                            <div className="messages__loading status-surface" role="status">
                                <span className="spinner spinner--small" aria-hidden="true" />
                                <span>Loading older messages…</span>
                            </div>
                        )}
                        {history.error && history.viewportIds.length > 0 && (
                            <div className="messages__error status-surface" role="alert">
                                <span>{history.error}</span>
                                <button type="button" onClick={() => store.retryOlderHistory(thread.key)}>
                                    Retry
                                </button>
                            </div>
                        )}
                        <div className="messages__content" ref={contentRef}>
                            <div className="messages__sentinel" ref={sentinelRef} aria-hidden="true" />
                            {!history.hasOlder &&
                                !hasLocalOlderIds(history.listedIds, history.viewportIds) &&
                                history.viewportIds.length > 0 && (
                                <div className="messages__beginning status-surface">Beginning of conversation</div>
                            )}
                            <div className="messages__rows" teactFastList>
                                {buildMessageGroups(history.viewportIds, history.byId, thread, history.viewerId)
                                    .map(group => (
                                        <div
                                            key={`${thread.key}\u0000group\u0000${store.messageRowKey(thread.key, group.key)}`}
                                            className={`message-group${group.showIdentity ? ' message-group--identity' : ''}`}
                                            data-sender-id={group.senderId}
                                        >
                                            {group.showIdentity && (
                                                <span className="message-group__avatar-rail" aria-hidden="true">
                                                    <span className="avatar message-group__avatar">
                                                        {group.sender?.picUrl ? (
                                                            <img
                                                                src={group.sender.picUrl}
                                                                alt=""
                                                                width="32"
                                                                height="32"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <span>{initials(group.senderLabel)}</span>
                                                        )}
                                                    </span>
                                                </span>
                                            )}
                                            {group.ids.map((id, index) => {
                                                const message = history.byId[id];
                                                return (
                                                    <MessageRow
                                                        key={`${thread.key}\u0000${store.messageRowKey(thread.key, id)}`}
                                                        store={store}
                                                        threadId={thread.key}
                                                        message={message}
                                                        viewerId={history.viewerId}
                                                        pending={history.pendingSends[id]}
                                                        failed={history.failedSends[id]}
                                                        reactionMutation={history.reactionMutations[id]}
                                                        outgoing={group.outgoing}
                                                        senderLabel={group.senderLabel}
                                                        senderName={group.showSenderName && index === 0
                                                            ? group.senderLabel
                                                            : undefined}
                                                        grouped={index > 0}
                                                        showDate={group.showDate && index === 0}
                                                        onReply={selectReply}
                                                    />
                                                );
                                            })}
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
            {hasNewerMessages && (
                <button type="button" className="newest-message" onClick={showNewest}>
                    Go to newest message
                </button>
            )}
            {history?.status === 'ready' && (
                <Composer
                    key={thread.key}
                    history={history}
                    threadId={thread.key}
                    onDraftChange={store.setDraft}
                    onCancelReply={() => store.setReplyTarget(thread.key)}
                    onSubmit={submitDraft}
                />
            )}
        </>
    );
}

const MessageRow = memo(function MessageRow({
    store,
    threadId,
    message,
    viewerId,
    pending,
    failed,
    reactionMutation,
    outgoing,
    senderLabel,
    senderName,
    grouped,
    showDate,
    onReply,
}: {
    store: FrontendStore;
    threadId: string;
    message: Message;
    viewerId?: string;
    pending?: HistoryState['pendingSends'][string];
    failed?: HistoryState['failedSends'][string];
    reactionMutation?: HistoryState['reactionMutations'][string];
    outgoing: boolean;
    senderLabel: string;
    senderName?: string;
    grouped: boolean;
    showDate: boolean;
    onReply: (messageId: string) => void;
}) {
    const [menuPoint, setMenuPoint] = useState<SurfacePoint>();
    const [pickerPoint, setPickerPoint] = useState<SurfacePoint>();
    const rowRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const reactionRef = useRef<HTMLButtonElement>(null as unknown as HTMLButtonElement);
    const isServerMessage = !message.id.startsWith('local:');
    const eligibleForActions = isServerMessage && 'senderId' in message;
    const groupedReactions = groupReactions(message, viewerId);
    const viewerReaction = message.reactions?.find(reaction => reaction.senderId === viewerId)?.reaction;
    const hasFailedActions = Boolean(failed);
    const ownsContextMenu = eligibleForActions || hasFailedActions;

    const chooseReaction = (emoji: string) => {
        setPickerPoint(undefined);
        void store.setReaction(threadId, message.id, emoji);
    };

    const openActionsAt = (point: SurfacePoint) => {
        if (!eligibleForActions && !hasFailedActions) return;
        setPickerPoint(undefined);
        setMenuPoint(point);
    };
    const longPress = useLongPress(openActionsAt);

    const openReactionPicker = () => {
        const rect = reactionRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMenuPoint(undefined);
        setPickerPoint({
            x: outgoing ? rect.left : rect.right,
            y: rect.top,
            align: outgoing ? 'right' : 'left',
        });
    };

    const menuItems: ContextMenuItem[] = eligibleForActions ? [
        { label: 'Reply', action: () => onReply(message.id) },
        {
            label: viewerReaction ? `Change reaction ${viewerReaction}` : 'Add reaction',
            action: openReactionPicker,
            disabled: reactionMutation?.status === 'pending',
        },
    ] : failed ? [
        { label: 'Retry send', action: () => store.retrySend(threadId, message.id) },
        { label: 'Remove failed message', action: () => store.removeFailedSend(threadId, message.id), danger: true },
    ] : [];

    return (
        <div
            ref={rowRef}
            data-message-id={message.id}
            className="message-row"
            tabIndex={ownsContextMenu ? 0 : undefined}
            aria-label={ownsContextMenu
                ? messageAccessibleLabel(message, senderLabel, pending, failed)
                : undefined}
            onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
                if (!ownsContextMenu) return;
                event.preventDefault();
                if (!longPress.consumeSyntheticEvent(event)) {
                    openActionsAt({ x: event.clientX, y: event.clientY });
                }
            }}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (!ownsContextMenu || (
                    event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')
                )) return;
                event.preventDefault();
                const bubble = event.currentTarget.querySelector<HTMLElement>('.message__bubble');
                const rect = (bubble ?? event.currentTarget).getBoundingClientRect();
                openActionsAt({
                    x: outgoing ? rect.right : rect.left,
                    y: rect.top + Math.min(24, rect.height / 2),
                    align: outgoing ? 'right' : 'left',
                });
            }}
            onClickCapture={longPress.consumeSyntheticEvent}
            onPointerDown={longPress.onPointerDown}
            onPointerMove={longPress.onPointerMove}
            onPointerUp={longPress.onPointerUp}
            onPointerCancel={longPress.onPointerCancel}
        >
            {showDate && (
                <div className="message-date">
                    <time className="status-surface" dateTime={new Date(message.ts).toISOString()}>{formatMessageDate(message.ts)}</time>
                </div>
            )}
            <div className={`message${outgoing ? ' message--outgoing' : ''}${grouped ? ' message--grouped' : ''}${message.kind === 'reaction_log' ? ' message--log' : ''}`}>
                <div className="message__bubble">
                    {senderName && <strong className="message__sender-name">{senderName}</strong>}
                    {'replyPreview' in message && message.replyPreview && (
                        <ReplyPreview preview={message.replyPreview} />
                    )}
                    <div className="message__body">
                        <MessageContent message={message} />
                        <time dateTime={new Date(message.ts).toISOString()}>
                            {formatMessageTime(message.ts)}
                        </time>
                    </div>
                    {groupedReactions.length > 0 && (
                        <div className="message__reactions" aria-label="Message reactions">
                            {groupedReactions.map(reaction => (
                                <span
                                    key={reaction.emoji}
                                    className={`reaction-chip${reaction.byViewer ? ' reaction-chip--viewer' : ''}`}
                                    aria-label={`${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}${reaction.byViewer ? ', including yours' : ''}`}
                                >
                                    <span aria-hidden="true">{reaction.emoji}</span>
                                    <span>{reaction.count}</span>
                                </span>
                            ))}
                        </div>
                    )}
                    {pending && <span className="message__delivery" role="status">Sending…</span>}
                    {failed && (
                        <div className="message__failure" role="alert">
                            <span>Not sent: {failed.error}</span>
                            <button type="button" onClick={() => store.retrySend(threadId, message.id)}>Retry</button>
                            <button type="button" onClick={() => store.removeFailedSend(threadId, message.id)}>Remove</button>
                        </div>
                    )}
                    {eligibleForActions && (
                        <button
                            ref={reactionRef}
                            type="button"
                            className="message__reaction-trigger"
                            aria-label={viewerReaction ? `Change reaction ${viewerReaction}` : 'Add reaction'}
                            aria-haspopup="menu"
                            aria-expanded={Boolean(pickerPoint)}
                            aria-busy={reactionMutation?.status === 'pending'}
                            disabled={reactionMutation?.status === 'pending'}
                            onClick={openReactionPicker}
                        >
                            <span aria-hidden="true">☺</span>
                        </button>
                    )}
                    {menuPoint && (
                        <ContextMenu
                            label="Message actions"
                            point={menuPoint}
                            returnFocusRef={rowRef}
                            onClose={() => setMenuPoint(undefined)}
                            items={menuItems}
                        />
                    )}
                    {pickerPoint && (
                        <ReactionPicker
                            point={pickerPoint}
                            current={viewerReaction}
                            busy={reactionMutation?.status === 'pending'}
                            returnFocusRef={reactionRef}
                            onChoose={chooseReaction}
                            onClose={() => setPickerPoint(undefined)}
                        />
                    )}
                    {reactionMutation?.status === 'error' && (
                        <span className="message__reaction-error" role="alert">
                            Reaction failed: {reactionMutation.error}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});

type ContextMenuItem = {
    label: string;
    action: () => void;
    disabled?: boolean;
    danger?: boolean;
};

type FocusRef = { current: HTMLElement };

function ContextMenu({
    label,
    point,
    items,
    returnFocusRef,
    onClose,
}: {
    label: string;
    point: SurfacePoint;
    items: ContextMenuItem[];
    returnFocusRef: FocusRef;
    onClose: () => void;
}) {
    const surfaceRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);

    useFloatingSurface(surfaceRef, point, returnFocusRef, onClose);

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
        if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        buttons[next].focus();
    };

    return (
        <div
            ref={surfaceRef}
            className="context-menu"
            role="menu"
            aria-label={label}
            onKeyDown={moveFocus}
        >
            {items.map(item => (
                <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className={item.danger ? 'context-menu__danger' : ''}
                    disabled={item.disabled}
                    onClick={() => {
                        onClose();
                        item.action();
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

function ReactionPicker({
    point,
    current,
    busy,
    returnFocusRef,
    onChoose,
    onClose,
}: {
    point: SurfacePoint;
    current?: string;
    busy: boolean;
    returnFocusRef: FocusRef;
    onChoose: (emoji: string) => void;
    onClose: () => void;
}) {
    const surfaceRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    useFloatingSurface(surfaceRef, point, returnFocusRef, onClose);

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!buttons.length) return;
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? buttons.length - 1
                : event.key === 'ArrowLeft'
                    ? (currentIndex - 1 + buttons.length) % buttons.length
                    : (currentIndex + 1) % buttons.length;
        event.preventDefault();
        if (currentIndex >= 0) buttons[currentIndex].tabIndex = -1;
        buttons[next].tabIndex = 0;
        buttons[next].focus();
    };

    const firstEnabled = busy ? undefined : REACTION_EMOJIS.find(emoji => emoji !== current);

    return (
        <div
            ref={surfaceRef}
            className="reaction-picker"
            role="menu"
            aria-label="Choose a reaction"
            aria-busy={busy}
            onKeyDown={moveFocus}
        >
            {REACTION_EMOJIS.map(emoji => (
                <button
                    key={emoji}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current === emoji}
                    aria-label={current === emoji ? `${emoji}, current reaction` : `React with ${emoji}`}
                    className={current === emoji ? 'reaction-picker__current' : ''}
                    disabled={busy || current === emoji}
                    tabIndex={emoji === firstEnabled ? 0 : -1}
                    onClick={() => onChoose(emoji)}
                >
                    <span aria-hidden="true">{emoji}</span>
                </button>
            ))}
            {current && (
                <span className="reaction-picker__note">Choose another to change</span>
            )}
        </div>
    );
}

function useFloatingSurface(
    surfaceRef: { current: HTMLDivElement },
    point: SurfacePoint,
    returnFocusRef: FocusRef,
    onClose: () => void,
) {
    useLayoutEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        surface.setAttribute('popover', 'manual');
        surface.showPopover?.();
        const position = () => {
            const viewport = window.visualViewport;
            const viewportLeft = viewport?.offsetLeft ?? 0;
            const viewportTop = viewport?.offsetTop ?? 0;
            const viewportWidth = viewport?.width ?? window.innerWidth;
            const viewportHeight = viewport?.height ?? window.innerHeight;
            surface.style.minWidth = '0';
            surface.style.maxWidth = `${Math.max(0, viewportWidth - 16)}px`;
            surface.style.maxHeight = `${Math.max(0, viewportHeight - 16)}px`;
            surface.style.overflowY = 'auto';
            const width = surface.offsetWidth;
            const height = surface.offsetHeight;
            const requestedLeft = point.align === 'right' ? point.x - width : point.x;
            const left = Math.max(
                viewportLeft + 8,
                Math.min(requestedLeft, viewportLeft + viewportWidth - width - 8),
            );
            const top = Math.max(
                viewportTop + 8,
                Math.min(point.y, viewportTop + viewportHeight - height - 8),
            );
            surface.style.left = `${left}px`;
            surface.style.top = `${top}px`;
        };
        position();
        surface.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });

        const closeFromPointer = (event: PointerEvent) => {
            if (!surface.contains(event.target as Node)) onClose();
        };
        const closeFromKey = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onClose();
            requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
        };
        const closeFromViewport = () => onClose();
        document.addEventListener('pointerdown', closeFromPointer, true);
        document.addEventListener('keydown', closeFromKey, true);
        window.addEventListener('resize', closeFromViewport);
        window.addEventListener('scroll', closeFromViewport, true);
        window.visualViewport?.addEventListener('resize', position);
        window.visualViewport?.addEventListener('scroll', position);
        return () => {
            surface.hidePopover?.();
            document.removeEventListener('pointerdown', closeFromPointer, true);
            document.removeEventListener('keydown', closeFromKey, true);
            window.removeEventListener('resize', closeFromViewport);
            window.removeEventListener('scroll', closeFromViewport, true);
            window.visualViewport?.removeEventListener('resize', position);
            window.visualViewport?.removeEventListener('scroll', position);
        };
    }, [point.x, point.y, point.align]);
}

function useLongPress(onOpen: (point: SurfacePoint) => void, enabled = true) {
    const pressRef = useRef<{
        pointerId: number;
        x: number;
        y: number;
        timer: number;
    }>();
    const suppressUntilRef = useRef(0);
    const compatibilityCleanupRef = useRef<() => void>();

    const clear = () => {
        const press = pressRef.current;
        if (press) window.clearTimeout(press.timer);
        pressRef.current = undefined;
    };

    const clearCompatibilitySuppression = () => {
        compatibilityCleanupRef.current?.();
        compatibilityCleanupRef.current = undefined;
    };

    const suppressCompatibilityEvents = () => {
        clearCompatibilitySuppression();
        const consume = (event: Event) => {
            if (performance.now() >= suppressUntilRef.current) {
                clearCompatibilitySuppression();
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.type === 'click') {
                suppressUntilRef.current = 0;
                clearCompatibilitySuppression();
            }
        };
        const timeout = window.setTimeout(clearCompatibilitySuppression, 850);
        compatibilityCleanupRef.current = () => {
            window.clearTimeout(timeout);
            document.removeEventListener('click', consume, true);
            document.removeEventListener('contextmenu', consume, true);
        };
        document.addEventListener('click', consume, true);
        document.addEventListener('contextmenu', consume, true);
    };

    useEffect(() => () => {
        clear();
        clearCompatibilitySuppression();
    }, []);

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;
        clear();
        const x = event.clientX;
        const y = event.clientY;
        const pointerId = event.pointerId;
        const timer = window.setTimeout(() => {
            const press = pressRef.current;
            if (!press || press.pointerId !== pointerId) return;
            suppressUntilRef.current = performance.now() + 800;
            pressRef.current = undefined;
            suppressCompatibilityEvents();
            onOpen({ x, y });
        }, 500);
        pressRef.current = { pointerId, x, y, timer };
    };

    const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) clear();
    };

    const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
        if (pressRef.current?.pointerId === event.pointerId) clear();
        if (performance.now() < suppressUntilRef.current) {
            event.preventDefault();
            // Chromium can dispatch the compatibility click in a later task.
            // Keep document capture alive briefly so a newly opened popover
            // cannot become that click's target.
            window.setTimeout(clearCompatibilitySuppression, 50);
        }
    };

    const onPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
        if (pressRef.current?.pointerId === event.pointerId) clear();
    };

    const consumeSyntheticEvent = (event: {
        type?: string;
        target?: EventTarget | null;
        preventDefault: () => void;
        stopPropagation: () => void;
    }) => {
        if (performance.now() >= suppressUntilRef.current) return false;
        if (
            event.target instanceof Element &&
            event.target.closest('.context-menu, .reaction-picker')
        ) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'click') suppressUntilRef.current = 0;
        return true;
    };

    return {
        consumeSyntheticEvent,
        onPointerCancel,
        onPointerDown,
        onPointerMove,
        onPointerUp,
    };
}

function Composer({
    history,
    threadId,
    onDraftChange,
    onCancelReply,
    onSubmit,
}: {
    history: HistoryState;
    threadId: string;
    onDraftChange: (threadId: string, draft: string) => void;
    onCancelReply: () => void;
    onSubmit: () => boolean;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null as unknown as HTMLTextAreaElement);
    const replyTarget = history.replyTargetId
        ? history.byId[history.replyTargetId]
        : undefined;
    const submit = (event?: FormEvent<HTMLFormElement>) => {
        event?.preventDefault();
        if (onSubmit() && textareaRef.current) textareaRef.current.value = '';
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        if (onSubmit()) event.currentTarget.value = '';
    };
    const changeDraft = (event: ChangeEvent<HTMLTextAreaElement>) => {
        const textarea = event.currentTarget;
        const value = textarea.value;
        onDraftChange(threadId, value);
        // Local Teact restores the previous controlled prop after an input
        // handler, before the external-store render reaches the next frame.
        // Restore the store value in a microtask without creating a second
        // draft owner so normal multi-character browser input remains intact.
        queueMicrotask(() => {
            if (
                history.draft === value && textarea.isConnected && textarea.value !== value
            ) textarea.value = value;
        });
    };

    return (
        <form className="composer" onSubmit={submit}>
            {replyTarget && (
                <div className="composer__reply">
                    <span className="composer__reply-label">Replying to</span>
                    <ReplyPreview preview={replyPreviewFor(replyTarget)} />
                    <button type="button" onClick={onCancelReply} aria-label="Cancel reply">×</button>
                </div>
            )}
            <div className="composer__controls">
                <label className="visually-hidden" htmlFor={`message-draft-${threadId}`}>Message</label>
                <textarea
                    ref={textareaRef}
                    id={`message-draft-${threadId}`}
                    rows={1}
                    value={history.draft}
                    placeholder="Message"
                    onChange={changeDraft}
                    onKeyDown={onKeyDown}
                />
                <button type="submit" disabled={!history.draft.trim()}>Send</button>
            </div>
        </form>
    );
}

function MessageContent({ message }: { message: Message }) {
    switch (message.kind) {
        case 'text': return <span>{message.text}</span>;
        case 'reaction_log': return <span>{message.fragment}</span>;
        case 'reel_share': return (
            <a className="message-card" href={message.targetUrl} target="_blank" rel="noreferrer">
                <img src={message.thumbUrl} alt={`Reel from ${message.author}`} loading="lazy" />
                <strong>{message.author}</strong>
                {message.caption && <span>{message.caption}</span>}
            </a>
        );
        case 'inline_share': {
            const content = (
                <>
                    <img src={message.thumbUrl} alt="" loading="lazy" />
                    <strong>{message.title}</strong>
                    {message.subtitle && <span>{message.subtitle}</span>}
                </>
            );
            return message.targetUrl ? (
                <a className="message-card" href={message.targetUrl} target="_blank" rel="noreferrer">
                    {content}
                </a>
            ) : <span className="message-card">{content}</span>;
        }
        case 'image': return (
            <span className="message-images" aria-label={message.images.length === 1 ? 'Shared image' : 'Shared images'}>
                {message.images.map((image, index) => (
                    <img
                        key={`${image.url}:${index}`}
                        src={image.url}
                        alt={message.images.length === 1 ? 'Shared image' : `Shared image ${index + 1}`}
                        width={image.width ?? 400}
                        height={image.height ?? 400}
                        loading="lazy"
                    />
                ))}
            </span>
        );
        case 'unsupported': return <span className="message__unsupported">Unsupported message ({message.contentType})</span>;
    }
}

function ReplyPreview({ preview }: { preview: NonNullable<Extract<Message, { kind: 'text' }>['replyPreview']> }) {
    return (
        <span className="message__reply">
            {preview.kind === 'media' && preview.thumbUrl && <img src={preview.thumbUrl} alt="" loading="lazy" />}
            <span>{preview.kind === 'text' ? preview.text : preview.kind === 'media' ? preview.title : preview.label}</span>
        </span>
    );
}

function ListState({
    label,
    spinner,
    error,
    actionLabel,
    onAction,
}: {
    label: string;
    spinner?: boolean;
    error?: boolean;
    actionLabel?: string;
    onAction?: () => void;
}) {
    return (
        <div
            className={`list-state${error ? ' list-state--error' : ''}`}
            role={error ? 'alert' : spinner ? 'status' : undefined}
        >
            <div className="list-state__surface status-surface">
                {spinner && <span className="spinner" aria-hidden="true" />}
                <span>{label}</span>
                {actionLabel && onAction && (
                    <button type="button" onClick={onAction}>{actionLabel}</button>
                )}
            </div>
        </div>
    );
}

function useStore(store: FrontendStore) {
    const [, setVersion] = useState(0);
    useEffect(() => {
        const unsubscribe = store.subscribe(() => setVersion(value => value + 1));
        store.start();
        return () => {
            unsubscribe();
            store.destroy();
        };
    }, [store]);
}

function messageSummary(message: Message) {
    switch (message.kind) {
        case 'text': return message.text;
        case 'reaction_log': return message.fragment;
        case 'reel_share': return message.caption || `Reel from ${message.author}`;
        case 'inline_share': return message.title;
        case 'image': return message.images.length === 1 ? 'Photo' : `${message.images.length} photos`;
        case 'unsupported': return `Unsupported message (${message.contentType})`;
    }
}

type MessageRenderGroup = {
    key: string;
    ids: string[];
    senderId?: string;
    sender?: User;
    senderLabel: string;
    outgoing: boolean;
    showDate: boolean;
    showIdentity: boolean;
    showSenderName: boolean;
};

function buildMessageGroups(
    ids: string[],
    byId: Record<string, Message>,
    thread: Thread,
    viewerId?: string,
): MessageRenderGroup[] {
    const groups: MessageRenderGroup[] = [];
    const knownNonViewerUsers = thread.users.filter(user => user.id !== viewerId);
    const keyedPeer = knownNonViewerUsers.find(user => user.id === thread.key);
    const primaryPeerId = !thread.isGroup
        ? (keyedPeer ?? (
            knownNonViewerUsers.length === 1 ? knownNonViewerUsers[0] : undefined
        ))?.id
        : undefined;

    for (const [index, id] of ids.entries()) {
        const message = byId[id];
        const messageSenderId = senderId(message);
        const previous = index ? byId[ids[index - 1]] : undefined;
        const showDate = !previous || !sameDay(previous.ts, message.ts);
        const previousGroup = groups.at(-1);
        const continuesGroup = Boolean(
            previousGroup && previous && messageSenderId &&
            senderId(previous) === messageSenderId &&
            message.ts - previous.ts < 5 * 60_000 && !showDate,
        );
        if (continuesGroup) {
            previousGroup!.ids.push(id);
            // The newest ID stays stable when older same-sender messages prepend.
            previousGroup!.key = id;
            continue;
        }

        const outgoing = Boolean(messageSenderId && messageSenderId === viewerId);
        const sender = thread.users.find(user => user.id === messageSenderId);
        const senderLabel = messageSenderLabel(message, thread, viewerId);
        const showIdentity = Boolean(
            sender && messageSenderId && !outgoing && (
                thread.isGroup || (primaryPeerId && messageSenderId !== primaryPeerId)
            ),
        );
        groups.push({
            key: id,
            ids: [id],
            senderId: messageSenderId,
            sender,
            senderLabel,
            outgoing,
            showDate,
            showIdentity,
            showSenderName: showIdentity && thread.isGroup,
        });
    }
    return groups;
}

function messageSenderLabel(message: Message, thread: Thread, viewerId?: string) {
    if (!('senderId' in message)) return 'Conversation update';
    if (message.senderId === viewerId) return 'You';
    const user = thread.users.find(candidate => candidate.id === message.senderId);
    return user?.fullName || user?.username || 'Participant';
}

function messageAccessibleLabel(
    message: Message,
    senderLabel: string,
    pending?: HistoryState['pendingSends'][string],
    failed?: HistoryState['failedSends'][string],
) {
    const summary = messageSummary(message).replace(/\s+/g, ' ').trim().slice(0, 160);
    const delivery = failed ? 'Not sent' : pending ? 'Sending' : 'Delivered';
    return `${senderLabel}: ${summary || 'Message'}. ${delivery}`;
}

function replyPreviewFor(message: Message): Parameters<typeof ReplyPreview>[0]['preview'] {
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

function groupReactions(message: Message, viewerId?: string) {
    const groups = new Map<string, { emoji: string; count: number; byViewer: boolean }>();
    for (const reaction of message.reactions ?? []) {
        const group = groups.get(reaction.reaction) ?? {
            emoji: reaction.reaction,
            count: 0,
            byViewer: false,
        };
        group.count++;
        if (reaction.senderId === viewerId) group.byViewer = true;
        groups.set(reaction.reaction, group);
    }
    return [...groups.values()];
}

function initials(title: string) {
    return title.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function formatThreadTime(timestamp: number) {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString())
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMessageDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function sameDay(left: number, right: number) {
    return new Date(left).toDateString() === new Date(right).toDateString();
}

function senderId(message: Message) {
    return 'senderId' in message ? message.senderId : undefined;
}

function cssEscape(value: string) {
    return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function isAtBottom(scroller: HTMLDivElement) {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
}

function updateResizeAnchor(
    scroller: HTMLDivElement,
    ref: { current: { id: string; top: number } | undefined },
) {
    const top = scroller.getBoundingClientRect().top;
    const rows = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')];
    const visible = rows.filter(row => row.getBoundingClientRect().bottom > top);
    const row = visible[1] ?? visible[0];
    if (row?.dataset.messageId) {
        ref.current = { id: row.dataset.messageId, top: row.getBoundingClientRect().top };
    }
}
