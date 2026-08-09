import type {
    ChangeEvent,
    CSSProperties,
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
import type { AttachedAudio, Message, ReelMediaItem, Thread, User } from '../../lib/domain';
import type {
    FrontendStore, GlobalNotification, HistoryState, PinMutation, ReadMutation, ReelState,
} from './store';
import { hasLocalNewerIds, hasLocalOlderIds } from './history-window';
import { calculateInlineMediaBox } from './inline-media-box';
import {
    readReelVolumePreference,
    type ReelVolumePreference,
    writeReelVolumePreference,
} from './reel-volume';
import {
    clampSidebarWidth,
    DEFAULT_SIDEBAR_WIDTH,
    readSidebarWidthPreference,
    removeSidebarWidthPreference,
    sidebarWidthBounds,
    writeSidebarWidthPreference,
} from './sidebar-resize';
import { computeChatWindow } from './virtual-list';
import { fuzzyMatchScore } from './fuzzy-match';

const ROW_HEIGHT = 72;
const REACTION_EMOJIS = ['❤', '😂', '😮', '😢', '😡', '👍'];
const REACTION_CATEGORIES = [
    { label: 'Faces', emojis: ['😂', '😮', '😢', '😡', '🥰', '😱'] },
    { label: 'Gestures', emojis: ['👍', '👏', '🙌', '🙏', '💪', '👎'] },
    { label: 'Symbols', emojis: ['❤', '🔥', '✨', '🎉', '💯', '💔'] },
];
const FULL_REACTION_EMOJIS = REACTION_CATEGORIES.flatMap(category => category.emojis);
const DEFAULT_REACTION = REACTION_EMOJIS[0];
let keyboardScrollSequence = 0;
let reelReturnFocus: HTMLElement | undefined;
let forwardingReturnFocus: HTMLElement | undefined;

type AppProps = { store: FrontendStore };

type SurfacePoint = { x: number; y: number; align?: 'left' | 'right' };
type ReelPlaybackState = { currentTime: number; userPaused: boolean };
type ReelPlaybackMemory = Map<string, ReelPlaybackState>;
type ReelVolumePreferenceRef = { current: ReelVolumePreference };

export default function App({ store }: AppProps) {
    useStore(store);
    useVimNavigation(store);
    const reelPlaybackMemory = useRef<ReelPlaybackMemory>(new Map());
    const [initialReelVolumePreference] = useState(readReelVolumePreference);
    const reelVolumePreference = useRef<ReelVolumePreference>(initialReelVolumePreference);
    const [initialSidebarPreference] = useState(() =>
        readSidebarWidthPreference() ?? DEFAULT_SIDEBAR_WIDTH);
    const sidebarPreferenceRef = useRef(initialSidebarPreference);
    const sidebarDragRef = useRef<{
        pointerId: number;
        startX: number;
        startWidth: number;
        target: HTMLDivElement;
    }>();
    const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
    const [sidebarWidth, setSidebarWidth] = useState(() =>
        clampSidebarWidth(initialSidebarPreference, window.innerWidth));
    const state = store.state;
    const selected = state.selectedThreadId
        ? state.inbox.byId[state.selectedThreadId]
        : undefined;

    const activeReel = state.reels.activeId
        ? state.reels.byId[state.reels.activeId]
        : undefined;

    const finishSidebarResize = (pointerId?: number, persist = false) => {
        const drag = sidebarDragRef.current;
        if (pointerId !== undefined && drag?.pointerId !== pointerId) return;
        sidebarDragRef.current = undefined;
        document.body.classList.remove('is-resizing-sidebar');
        if (!drag) return;
        if (drag.target.hasPointerCapture(drag.pointerId)) {
            drag.target.releasePointerCapture(drag.pointerId);
        }
        if (persist) writeSidebarWidthPreference(sidebarPreferenceRef.current);
    };

    useEffect(() => {
        const handleResize = () => {
            setViewportWidth(window.innerWidth);
            setSidebarWidth(clampSidebarWidth(sidebarPreferenceRef.current, window.innerWidth));
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            finishSidebarResize(undefined, true);
        };
    }, []);

    const applySidebarWidth = (width: number) => {
        const nextWidth = clampSidebarWidth(width, window.innerWidth);
        sidebarPreferenceRef.current = nextWidth;
        setSidebarWidth(nextWidth);
    };
    const sidebarBounds = sidebarWidthBounds(viewportWidth);

    return (
        <>
        <main
            className={`app-shell${selected ? ' app-shell--conversation-selected' : ''}`}
            style={`--sidebar-width: ${sidebarWidth}px` as unknown as React.CSSProperties}
        >
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
            <div
                className="sidebar-resize"
                role="separator"
                aria-label="Resize conversation list"
                aria-orientation="vertical"
                aria-valuemin={sidebarBounds.min}
                aria-valuemax={sidebarBounds.max}
                aria-valuenow={sidebarWidth}
                tabIndex={0}
                onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    sidebarDragRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startWidth: sidebarWidth,
                        target: event.currentTarget,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    document.body.classList.add('is-resizing-sidebar');
                }}
                onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
                    const drag = sidebarDragRef.current;
                    if (!drag || drag.pointerId !== event.pointerId) return;
                    applySidebarWidth(drag.startWidth + event.clientX - drag.startX);
                }}
                onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
                    finishSidebarResize(event.pointerId, true);
                }}
                onPointerCancel={(event: ReactPointerEvent<HTMLDivElement>) => {
                    finishSidebarResize(event.pointerId, true);
                }}
                onLostPointerCaptureCapture={(event: ReactPointerEvent<HTMLDivElement>) => {
                    finishSidebarResize(event.pointerId, true);
                }}
                onDoubleClick={() => {
                    sidebarPreferenceRef.current = DEFAULT_SIDEBAR_WIDTH;
                    setSidebarWidth(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, window.innerWidth));
                    removeSidebarWidthPreference();
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    let nextWidth: number | undefined;
                    const step = event.shiftKey ? 40 : 10;
                    if (event.key === 'ArrowLeft') nextWidth = sidebarWidth - step;
                    else if (event.key === 'ArrowRight') nextWidth = sidebarWidth + step;
                    else if (event.key === 'Home') nextWidth = sidebarBounds.min;
                    else if (event.key === 'End') nextWidth = sidebarBounds.max;
                    if (nextWidth === undefined) return;
                    event.preventDefault();
                    applySidebarWidth(nextWidth);
                    writeSidebarWidthPreference(clampSidebarWidth(nextWidth, window.innerWidth));
                }}
            />
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
        {activeReel && <ReelModal
            key={activeReel.shortcode}
            store={store}
            reel={activeReel}
            targetUrl={state.reels.activeUrl}
            playbackMemory={reelPlaybackMemory.current}
            volumePreference={reelVolumePreference}
        />}
        {state.forwarding?.isModalOpen && <ForwardModal key={`${state.forwarding.sourceThreadId}\u0000${state.forwarding.sourceMessageId}`} store={store} />}
        <ToastHost store={store} />
        </>
    );
}

function ToastHost({ store }: AppProps) {
    return (
        <section className="toast-host" aria-label="Notifications">
            {store.state.notifications.map(notification => (
                <Toast key={notification.id} store={store} notification={notification} />
            ))}
        </section>
    );
}

function Toast({ store, notification }: AppProps & { notification: GlobalNotification }) {
    useEffect(() => {
        const timer = window.setTimeout(
            () => store.dismissNotification(notification.id),
            notification.kind === 'error' ? 8_000 : 5_000,
        );
        return () => window.clearTimeout(timer);
    }, [notification.id]);

    return (
        <div
            className={`toast toast--${notification.kind}`}
            role={notification.kind === 'error' ? 'alert' : 'status'}
        >
            <span>{notification.message}</span>
            {notification.action && (
                <button
                    type="button"
                    onClick={() => {
                        store.dismissNotification(notification.id);
                        notification.action?.run();
                    }}
                >
                    {notification.action.label}
                </button>
            )}
            <button
                type="button"
                className="toast__close"
                aria-label="Dismiss notification"
                onClick={() => store.dismissNotification(notification.id)}
            >×</button>
        </div>
    );
}

function ChatList({ store }: AppProps) {
    const [scrollTop, setScrollTop] = useState(0);
    const suppressPaginationRef = useRef(false);
    const state = store.state;
    const ids = store.orderedThreadIds();
    const { start, end } = computeChatWindow(scrollTop, ids.length);
    const visibleIds = ids.slice(start, end);
    const visibleKey = visibleIds.join('\u0000');
    const selectedHistoryStatus = state.selectedThreadId
        ? state.histories[state.selectedThreadId]?.status
        : undefined;

    useEffect(() => {
        const suppressPagination = suppressPaginationRef.current;
        suppressPaginationRef.current = false;
        if (!suppressPagination && end >= ids.length - 5) store.loadNextInboxPage();
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
            onScroll={(event: UIEvent<HTMLDivElement>) => {
                if (event.currentTarget.dataset.keyboardNavigationScroll) {
                    suppressPaginationRef.current = true;
                }
                setScrollTop(event.currentTarget.scrollTop);
            }}
        >
            <div
                className="chat-list__spacer"
                style={{ height: `${ids.length * ROW_HEIGHT}px` }}
                teactFastList
            >
                {visibleIds.map((id, offset) => (
                    <ChatRow
                        key={id}
                        store={store}
                        thread={state.inbox.byId[id]}
                        index={start + offset}
                        selected={id === state.selectedThreadId}
                        pinned={state.pinnedIds.includes(id)}
                        pinMutation={state.pinMutations[id]}
                        readMutation={state.readMutations[id]}
                        onSelect={() => store.selectThread(id)}
                        onTogglePin={() => { void store.togglePin(id); }}
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
    store: FrontendStore;
    thread: Thread;
    index: number;
    selected: boolean;
    pinned: boolean;
    pinMutation?: PinMutation;
    readMutation?: ReadMutation;
    onSelect: () => void;
    onTogglePin: () => void;
};

function ChatRow({
    store, thread, index, selected, pinned, pinMutation, readMutation, onSelect, onTogglePin,
}: ChatRowProps) {
    const [menuPoint, setMenuPoint] = useState<SurfacePoint>();
    const rowRef = useRef<HTMLButtonElement>(null as unknown as HTMLButtonElement);
    const restoreFocusRef = useRef<{ frames: number[]; selectedThreadId?: string }>();
    const canPin = Boolean(thread.threadFbid);
    const longPress = useLongPress(openMenu, canPin);
    const snippet = thread.lastMessage ? messageSummary(thread.lastMessage) : 'No messages yet';
    const mutationErrors = [
        pinMutation?.status === 'error'
            ? pinMutation.error ?? 'Could not update conversation pin'
            : undefined,
        readMutation?.status === 'error'
            ? readMutation.error ?? 'Could not mark conversation as read'
            : undefined,
    ].filter((error): error is string => error !== undefined);

    function openMenu(point: SurfacePoint) {
        if (!canPin) return;
        setMenuPoint(point);
    }

    const cancelFocusRestore = () => {
        const intent = restoreFocusRef.current;
        intent?.frames.forEach(frame => cancelAnimationFrame(frame));
        restoreFocusRef.current = undefined;
    };

    const scheduleFocusRestore = () => {
        cancelFocusRestore();
        const intent = {
            frames: [] as number[],
            selectedThreadId: store.state.selectedThreadId,
        };
        restoreFocusRef.current = intent;
        const restore = (remainingAttempts: number) => {
            const frame = requestAnimationFrame(() => {
                if (restoreFocusRef.current !== intent) return;
                const active = document.activeElement;
                if (
                    store.state.selectedThreadId !== intent.selectedThreadId ||
                    (active instanceof HTMLElement && active.isConnected &&
                        active !== document.body && active !== rowRef.current)
                ) {
                    cancelFocusRestore();
                    return;
                }
                if (!restoreChatRowFocus(store, thread.key) && remainingAttempts > 0) {
                    restore(remainingAttempts - 1);
                    return;
                }
                restoreFocusRef.current = undefined;
            });
            intent.frames.push(frame);
        };
        const first = requestAnimationFrame(() => restore(2));
        intent.frames.push(first);
    };

    useEffect(() => {
        const cancelForNewFocus = (event: FocusEvent) => {
            if (restoreFocusRef.current && event.target !== rowRef.current) cancelFocusRestore();
        };
        document.addEventListener('focusin', cancelForNewFocus, true);
        return () => {
            document.removeEventListener('focusin', cancelForNewFocus, true);
            cancelFocusRestore();
        };
    }, [thread.key]);

    return (
        <div
            className={`chat-row${selected ? ' chat-row--selected' : ''}`}
            style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
        >
            <button
                ref={rowRef}
                data-thread-id={thread.key}
                type="button"
                className="chat-row__select"
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    if (!longPress.consumeSyntheticEvent(event)) onSelect();
                }}
                onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
                    if (!canPin) return;
                    event.preventDefault();
                    if (!longPress.consumeSyntheticEvent(event)) {
                        openMenu({ x: event.clientX, y: event.clientY });
                    }
                }}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                    if (!canPin) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMenu({ x: rect.left + 24, y: rect.top + rect.height / 2 });
                }}
                onPointerDown={longPress.onPointerDown}
                onPointerMove={longPress.onPointerMove}
                onPointerUp={longPress.onPointerUp}
                onPointerCancel={longPress.onPointerCancel}
                aria-pressed={selected}
                aria-busy={pinMutation?.status === 'pending' || readMutation?.status === 'pending'}
                aria-label={`${thread.title}${thread.isUnread ? ', unread' : ''}${thread.isMuted ? ', muted' : ''}${pinned ? ', pinned' : ''}`}
            >
                <ChatAvatar thread={thread} />
                    <span className="chat-row__body">
                        <span className="chat-row__topline">
                            <span className="chat-row__title">
                                <strong>{thread.title}</strong>
                                {pinned && (
                                    <span className="chat-row__pin" title="Pinned" aria-hidden="true">
                                        <svg viewBox="0 0 16 16" focusable="false">
                                            <path d="M5 2.5h6M6 2.5v4l-2 2h8l-2-2v-4M8 8.5v5" />
                                        </svg>
                                    </span>
                                )}
                            </span>
                            <time dateTime={new Date(thread.lastActivityMs).toISOString()}>
                                {formatThreadTime(thread.lastActivityMs)}
                            </time>
                    </span>
                    <span className="chat-row__bottomline">
                        <span className="chat-row__snippet">{snippet}</span>
                        <span className="chat-row__badges">
                            {thread.isMuted && <span className="chat-row__badge" title="Muted" aria-hidden="true">⌁</span>}
                            {thread.isUnread && (
                                <span className="chat-row__badge chat-row__badge--accent" title="Unread" aria-hidden="true">◆</span>
                            )}
                        </span>
                    </span>
                </span>
            </button>
            {mutationErrors.length > 0 && (
                <span className="chat-row__mutation-error" role="alert">
                    {mutationErrors.join(' · ')}
                </span>
            )}
            {menuPoint && (
                <ContextMenu
                    label={`Actions for ${thread.title}`}
                    point={menuPoint}
                    returnFocusRef={rowRef}
                    onClose={() => setMenuPoint(undefined)}
                    items={[{
                        label: (pinMutation?.pin ?? !pinned)
                            ? 'Pin conversation'
                            : 'Unpin conversation',
                        action: () => {
                            onTogglePin();
                            scheduleFocusRestore();
                        },
                        disabled: pinMutation?.status === 'pending',
                    }]}
                />
            )}
        </div>
    );
}

function ChatAvatar({ thread }: { thread: Thread }) {
    const users = thread.isGroup ? thread.users.slice(0, 5) : thread.users.slice(0, 1);

    if (thread.isGroup && users.length > 1) {
        return (
            <span
                className={`avatar-stack avatar-stack--${users.length}`}
                aria-hidden="true"
            >
                {users.map(user => (
                    <span key={user.id} className="avatar avatar-stack__item">
                        {user.picUrl ? (
                            <img src={user.picUrl} alt="" width="30" height="30" loading="lazy" />
                        ) : (
                            <span>{initials(user.fullName || user.username)}</span>
                        )}
                    </span>
                ))}
            </span>
        );
    }

    const user = users[0];
    return (
        <span className="avatar" aria-hidden="true">
            {user?.picUrl ? (
                <img src={user.picUrl} alt="" width="52" height="52" loading="lazy" />
            ) : (
                <span>{initials(thread.title)}</span>
            )}
        </span>
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
    const pendingViewportDirectionRef = useRef<'older' | 'newer'>();
    const olderRevealSuppressedRef = useRef(false);
    const resizeAnchorRef = useRef<{ id: string; top: number }>();
    const sentinelIntersectingRef = useRef(false);
    const revealTimerRef = useRef<number>();
    const continuationTimersRef = useRef(new Set<number>());
    const activeThreadRef = useRef(thread.key);
    const openedThreadRef = useRef('');
    const followNewestThreadRef = useRef<string>();
    const handledIncomingFollowRef = useRef({
        threadId: thread.key,
        version: history?.incomingFollowVersion ?? 0,
    });
    const handledReplyNavigationRef = useRef(0);
    const [isViewportAtBottom, setIsViewportAtBottom] = useState(false);
    const lastScrollTopRef = useRef(0);
    const viewportKey = history?.viewportIds.join('\u0000') ?? '';

    activeThreadRef.current = thread.key;

    const updateBottomState = (scroller: HTMLDivElement) => {
        const atBottom = isAtBottom(scroller);
        const current = store.state.histories[thread.key];
        const latestId = current?.listedIds.at(-1);
        store.setHistoryFollowingNewest(
            thread.key,
            Boolean(atBottom && latestId && current?.viewportIds.includes(latestId)),
        );
        setIsViewportAtBottom(atBottom);
    };

    const setComponentScrollTop = (scroller: HTMLDivElement, scrollTop: number) => {
        scroller.scrollTop = scrollTop;
        // Native scroll events from an imperative write may arrive later. Keep
        // their comparison baseline at the written position without suppressing
        // a subsequent user movement beyond it.
        lastScrollTopRef.current = scroller.scrollTop;
    };

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
        if (scroller.dataset.keyboardNavigationScroll) return false;
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
        if (
            pendingViewportDirectionRef.current === 'newer' ||
            olderRevealSuppressedRef.current
        ) {
            clearRevealTimer();
            return;
        }
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
                    if (
                        pendingViewportDirectionRef.current === 'newer' ||
                        olderRevealSuppressedRef.current
                    ) return;
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
        pendingAnchorRef.current = undefined;
        pendingViewportDirectionRef.current = undefined;
        olderRevealSuppressedRef.current = false;
        lastScrollTopRef.current = scrollerRef.current?.scrollTop ?? 0;
        followNewestThreadRef.current = undefined;
        handledIncomingFollowRef.current = {
            threadId: thread.key,
            version: history?.incomingFollowVersion ?? 0,
        };
        return () => {
            clearRevealTimer();
            clearContinuationTimers();
            pendingAnchorRef.current = undefined;
            pendingViewportDirectionRef.current = undefined;
            olderRevealSuppressedRef.current = false;
            lastScrollTopRef.current = 0;
            store.completeHistoryReplacement(thread.key);
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
                setComponentScrollTop(scroller, scroller.scrollTop + actual - saved.offset);
            } else {
                setComponentScrollTop(scroller, scroller.scrollHeight);
            }
            updateBottomState(scroller);
        }
        const pending = pendingAnchorRef.current;
        if (history.isReplacingViewport) {
            const replacementDirection = pendingViewportDirectionRef.current;
            if (pending) {
                const row = scroller.querySelector<HTMLElement>(
                    `[data-message-id="${cssEscape(pending.id)}"]`,
                );
                if (row) setComponentScrollTop(
                    scroller,
                    scroller.scrollTop + row.getBoundingClientRect().top - pending.top,
                );
                pendingAnchorRef.current = undefined;
            }
            if (replacementDirection === 'newer') olderRevealSuppressedRef.current = true;
            store.completeHistoryReplacement(thread.key);
            pendingViewportDirectionRef.current = undefined;
            if (replacementDirection !== 'newer' && isSentinelInRange()) {
                clearRevealTimer();
                captureAnchor();
                store.revealOlderHistory(thread.key, true);
            }
            if (replacementDirection !== 'newer') {
                reevaluateOlderReveal();
                scheduleThreadContinuation(thread.key, reevaluateOlderReveal, 50);
            }
        }
        updateResizeAnchor(scroller, resizeAnchorRef);
        updateBottomState(scroller);
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
        setComponentScrollTop(scroller, scroller.scrollHeight);
        followNewestThreadRef.current = undefined;
        updateResizeAnchor(scroller, resizeAnchorRef);
        updateBottomState(scroller);
    }, [thread.key, viewportKey]);

    useLayoutEffect(() => {
        const version = history?.incomingFollowVersion ?? 0;
        const handled = handledIncomingFollowRef.current;
        if (handled.threadId !== thread.key) {
            handledIncomingFollowRef.current = { threadId: thread.key, version };
            return;
        }
        if (version === handled.version) return;
        handledIncomingFollowRef.current = { threadId: thread.key, version };
        const scroller = scrollerRef.current;
        if (
            !scroller || activeThreadRef.current !== thread.key ||
            store.state.selectedThreadId !== thread.key
        ) return;
        setComponentScrollTop(scroller, scroller.scrollHeight);
        updateResizeAnchor(scroller, resizeAnchorRef);
        updateBottomState(scroller);
    }, [thread.key, history?.incomingFollowVersion]);

    useLayoutEffect(() => {
        const navigation = history?.replyNavigation;
        const scroller = scrollerRef.current;
        if (
            !scroller || navigation?.status !== 'ready' ||
            activeThreadRef.current !== thread.key ||
            store.state.selectedThreadId !== thread.key ||
            handledReplyNavigationRef.current === navigation.requestId
        ) return;
        const row = scroller.querySelector<HTMLElement>(
            `[data-message-id="${cssEscape(navigation.targetId)}"]`,
        );
        if (!row) return;
        handledReplyNavigationRef.current = navigation.requestId;
        row.scrollIntoView({ block: 'center' });
        lastScrollTopRef.current = scroller.scrollTop;
        row.focus({ preventScroll: true });
        updateBottomState(scroller);
        store.saveHistoryAnchor(thread.key, {
            id: navigation.targetId,
            offset: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        });
        updateResizeAnchor(scroller, resizeAnchorRef);
        store.completeReplyNavigationPosition(thread.key, navigation.requestId);
    }, [thread.key, viewportKey, history?.replyNavigation?.requestId, history?.replyNavigation?.status]);

    useEffect(() => {
        const root = scrollerRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel || !history || history.status !== 'ready') return;
        const observer = new IntersectionObserver(entries => {
            const wasIntersecting = sentinelIntersectingRef.current;
            sentinelIntersectingRef.current = entries.some(entry => entry.isIntersecting);
            if (
                olderRevealSuppressedRef.current && !wasIntersecting &&
                sentinelIntersectingRef.current
            ) olderRevealSuppressedRef.current = false;
            reevaluateOlderReveal();
        }, { root, rootMargin: '750px 0px 0px' });
        observer.observe(sentinel);
        return () => {
            observer.disconnect();
            sentinelIntersectingRef.current = false;
            clearRevealTimer();
        };
    }, [thread.key, history?.status]);

    useLayoutEffect(() => {
        const root = scrollerRef.current;
        if (!root || !history || history.status !== 'ready') return;
        const previews = [...root.querySelectorAll<HTMLElement>('[data-reply-target-id]')];
        const prefetchVisible = () => {
            const rootRect = root.getBoundingClientRect();
            store.prefetchReplyTargets(thread.key, previews.filter(element => {
                const rect = element.getBoundingClientRect();
                return rect.bottom >= rootRect.top - 160 && rect.top <= rootRect.bottom + 160;
            }).map(element => element.dataset.replyTargetId).filter(Boolean) as string[]);
        };
        if (typeof IntersectionObserver === 'undefined') {
            prefetchVisible();
            return () => store.prefetchReplyTargets(thread.key, []);
        }
        const observer = new IntersectionObserver(entries => {
            if (entries.length) prefetchVisible();
        }, { root, rootMargin: '160px 0px' });
        previews.forEach(preview => observer.observe(preview));
        // Native observers report asynchronously. Scan the committed geometry
        // now as well so a visible reply starts warming on its first paint.
        prefetchVisible();
        return () => {
            observer.disconnect();
            store.prefetchReplyTargets(thread.key, []);
        };
    }, [store, thread.key, viewportKey, history?.status]);

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
            if (
                pendingViewportDirectionRef.current === 'newer' ||
                olderRevealSuppressedRef.current
            ) return;
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
            if (Math.abs(delta) > 0.01) {
                setComponentScrollTop(scroller, scroller.scrollTop + delta);
            }
            updateResizeAnchor(scroller, resizeAnchorRef);
            reevaluateOlderReveal();
        });
        observer.observe(content);
        return () => observer.disconnect();
    }, [thread.key]);

    const onScroll = () => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const isMovingDown = scroller.scrollTop > lastScrollTopRef.current;
        const isMovingUp = scroller.scrollTop < lastScrollTopRef.current;
        lastScrollTopRef.current = scroller.scrollTop;
        if (isMovingUp) olderRevealSuppressedRef.current = false;
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
        if (row?.dataset.messageId) {
            store.saveHistoryAnchor(thread.key, {
                id: row.dataset.messageId,
                offset: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
            });
        }
        updateResizeAnchor(scroller, resizeAnchorRef);
        updateBottomState(scroller);
        const currentHistory = store.state.histories[thread.key];
        if (
            isMovingDown && !scroller.dataset.keyboardNavigationScroll && currentHistory &&
            !currentHistory.isReplacingViewport &&
            hasLocalNewerIds(currentHistory.listedIds, currentHistory.viewportIds) &&
            scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 750
        ) {
            captureAnchor();
            pendingViewportDirectionRef.current = 'newer';
            if (!store.revealNewerHistory(thread.key)) {
                pendingViewportDirectionRef.current = undefined;
                pendingAnchorRef.current = undefined;
            }
        }
        if (isMovingUp) reevaluateOlderReveal();
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

    const useDownNavigation = () => {
        if (history?.replyReturnStack.length) {
            void store.returnFromReplyNavigation(thread.key);
            return;
        }
        followNewestThreadRef.current = thread.key;
        store.revealNewestHistory(thread.key);
        requestAnimationFrame(() => {
            if (
                activeThreadRef.current !== thread.key ||
                store.state.selectedThreadId !== thread.key
            ) return;
            const scroller = scrollerRef.current;
            if (!scroller) return;
            setComponentScrollTop(scroller, scroller.scrollHeight);
            followNewestThreadRef.current = undefined;
            updateResizeAnchor(scroller, resizeAnchorRef);
            updateBottomState(scroller);
        });
    };

    const newestWindow = history ? history.listedIds.slice(-40) : [];
    const isNewestWindow = Boolean(history) &&
        newestWindow.length === history!.viewportIds.length &&
        newestWindow.every((id, index) => history!.viewportIds[index] === id);
    const hasNewerMessages = Boolean(history && (!isNewestWindow || !isViewportAtBottom));
    const selectReply = useCallback((messageId: string) => {
        const scroller = scrollerRef.current;
        const originThreadKey = thread.key;
        const currentHistory = store.state.histories[thread.key];
        const latestId = currentHistory?.listedIds.at(-1);
        const wasFollowingNewest = Boolean(
            scroller && latestId && currentHistory?.viewportIds.includes(latestId) &&
            isAtBottom(scroller),
        );
        const visible = scroller
            ? [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
                .filter(row => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top)
            : [];
        const anchor = visible[1] ?? visible[0];
        const anchorTop = anchor?.getBoundingClientRect().top;
        if (!store.setReplyTarget(thread.key, messageId)) return;
        requestAnimationFrame(() => {
            if (
                !scroller || scrollerRef.current !== scroller ||
                activeThreadRef.current !== originThreadKey ||
                store.state.selectedThreadId !== originThreadKey
            ) return;
            if (scroller && wasFollowingNewest) {
                setComponentScrollTop(scroller, scroller.scrollHeight);
                updateResizeAnchor(scroller, resizeAnchorRef);
                updateBottomState(scroller);
            } else if (scroller && anchor && anchorTop !== undefined) {
                setComponentScrollTop(
                    scroller,
                    scroller.scrollTop + anchor.getBoundingClientRect().top - anchorTop,
                );
            }
            scroller.closest('.conversation')?.querySelector<HTMLTextAreaElement>('.composer textarea')
                ?.focus({ preventScroll: true });
        });
    }, [store, thread.key]);
    const navigateToReply = useCallback((messageId: string, returnId: string) => {
        void store.navigateToReply(thread.key, messageId, returnId);
    }, [store, thread.key]);
    const hasReplyReturn = Boolean(history?.replyReturnStack.length);
    const showDownNavigation = hasReplyReturn || hasNewerMessages;
    const downNavigationLabel = hasReplyReturn
        ? `Return to previous reply message (${history!.replyReturnStack.length} ${history!.replyReturnStack.length === 1 ? 'step' : 'steps'} remaining)`
        : 'Go to newest message';

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
            <div className="messages" data-history-thread-id={thread.key} ref={scrollerRef} onScroll={onScroll}>
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
                        {(history.isLoadingOlder || history.isPreloadingOlder) &&
                            history.replyNavigation?.status !== 'loading' && (
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
                                                const reelItem = message.kind === 'reel_share'
                                                    ? store.state.reels.byId[message.shortcode]?.media?.items[0]
                                                    : undefined;
                                                return (
                                                    <MessageRow
                                                        key={`${thread.key}\u0000${store.messageRowKey(thread.key, id)}`}
                                                        store={store}
                                                        threadId={thread.key}
                                                        message={message}
                                                        reelItem={reelItem}
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
                                                         onNavigateToReply={navigateToReply}
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
            {history?.replyNavigation?.status === 'loading' && (
                <div className="messages__reply-navigation status-surface" role="status">
                    <span className="spinner spinner--small" aria-hidden="true" />
                    <span>
                        {history.replyNavigation.pagesLoaded
                            ? `Loading original message… ${history.replyNavigation.pagesLoaded} older ${history.replyNavigation.pagesLoaded === 1 ? 'page' : 'pages'}, ${history.replyNavigation.messagesLoaded ?? 0} ${(history.replyNavigation.messagesLoaded ?? 0) === 1 ? 'message' : 'messages'} loaded.`
                            : 'Loading original message… Searching older history.'}
                    </span>
                </div>
            )}
            {history?.replyNavigation?.status === 'error' && (
                <div className="messages__reply-navigation messages__reply-navigation--error status-surface" role="alert">
                    <span>{history.replyNavigation.error}</span>
                    <button
                        type="button"
                        onClick={() => store.navigateToReply(
                            thread.key,
                            history.replyNavigation!.targetId,
                            history.replyNavigation!.returnId,
                        )}
                    >
                        Retry
                    </button>
                </div>
            )}
            {history?.replyNavigation?.status === 'ready' && (
                <span className="visually-hidden" role="status">Original message loaded</span>
            )}
            {showDownNavigation && (
                <button
                    type="button"
                    className={`newest-message${history?.replyTargetId ? ' newest-message--replying' : ''}`}
                    onClick={useDownNavigation}
                    aria-label={downNavigationLabel}
                    title={downNavigationLabel}
                    aria-busy={history?.replyNavigation?.status === 'loading'}
                    disabled={history?.replyNavigation?.status === 'loading'}
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" />
                    </svg>
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
    reelItem,
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
    onNavigateToReply,
}: {
    store: FrontendStore;
    threadId: string;
    message: Message;
    reelItem?: ReelMediaItem;
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
    onNavigateToReply: (messageId: string, returnId: string) => void;
}) {
    const [menuPoint, setMenuPoint] = useState<SurfacePoint>();
    const [pickerPoint, setPickerPoint] = useState<SurfacePoint>();
    const rowRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const reactionRef = useRef<HTMLButtonElement>(null as unknown as HTMLButtonElement);
    const isServerMessage = !message.id.startsWith('local:');
    const isSharedPost = message.kind === 'reel_share' || message.kind === 'inline_share';
    const isMediaMessage = isSharedPost || message.kind === 'image';
    const eligibleForActions = isServerMessage && 'senderId' in message;
    const groupedReactions = groupReactions(message, viewerId);
    const viewerReaction = message.reactions?.find(reaction => reaction.senderId === viewerId)?.reaction;
    const sharedPostUrl = isSharedPost ? message.targetUrl : undefined;
    const hasFailedActions = Boolean(failed);
    const ownsContextMenu = eligibleForActions || hasFailedActions;

    const handleRowShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
        const isSpace = event.key === ' ' || event.code === 'Space';
        if ((!isSpace && event.key !== 'Enter') ||
            event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof Element) || isEditableTarget(target) ||
            target.closest('button, a[href]') ||
            menuPoint || pickerPoint ||
            document.querySelector('.context-menu, .reaction-picker, [role="dialog"], [aria-modal="true"]')) return;

        if (event.key === 'Enter') {
            if (!isActionableSharedPost(message)) return;
            const action = event.currentTarget.querySelector<HTMLElement>('[data-shared-post-action]');
            if (!action) return;
            event.preventDefault();
            action.click();
            return;
        }

        const currentHistory = store.state.histories[threadId];
        if (!eligibleForActions || currentHistory?.reactionMutations[message.id]?.status === 'pending') return;
        event.preventDefault();
        void store.setReaction(threadId, message.id, DEFAULT_REACTION);
    };

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
        ...((store.state.inbox.byId[threadId]?.threadIgId &&
            (message.kind === 'text' || (message.kind === 'reel_share' && message.mediaId))) ? [{
            label: 'Forward',
            action: () => {
                forwardingReturnFocus = rowRef.current;
                store.openForwarding(threadId, message.id);
            },
        }] : []),
        ...(sharedPostUrl ? [{
            label: 'Copy post URL',
            action: () => { void navigator.clipboard.writeText(sharedPostUrl); },
        }] : []),
    ] : failed ? [
        { label: 'Retry send', action: () => store.retrySend(threadId, message.id) },
        { label: 'Remove failed message', action: () => store.removeFailedSend(threadId, message.id), danger: true },
    ] : [];

    return (
        <div
            ref={rowRef}
            data-message-id={message.id}
            className="message-row"
            tabIndex={0}
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
                if (ownsContextMenu && (
                    event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
                )) {
                    event.preventDefault();
                    const bubble = event.currentTarget.querySelector<HTMLElement>('.message__bubble');
                    const rect = (bubble ?? event.currentTarget).getBoundingClientRect();
                    openActionsAt({
                        x: outgoing ? rect.right : rect.left,
                        y: rect.top + Math.min(24, rect.height / 2),
                        align: outgoing ? 'right' : 'left',
                    });
                    return;
                }
                handleRowShortcut(event);
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
            <div className={`message${outgoing ? ' message--outgoing' : ''}${grouped ? ' message--grouped' : ''}${isMediaMessage ? ' message--media' : ''}${message.kind === 'reaction_log' || message.kind === 'activity' ? ' message--log' : ''}`}>
                <div className="message__stack">
                <div className={`message__bubble${isMediaMessage ? ' message__bubble--media' : ''}`}>
                    {senderName && <strong className="message__sender-name">{senderName}</strong>}
                    {'replyPreview' in message && message.replyPreview && (
                        <ReplyPreview
                            preview={message.replyPreview}
                            onNavigate={'repliedTo' in message && message.repliedTo
                                ? () => onNavigateToReply(message.repliedTo!, message.id)
                                : undefined}
                            targetId={'repliedTo' in message ? message.repliedTo : undefined}
                        />
                    )}
                    <div className={`message__body${isMediaMessage ? ' message__body--media' : ''}`}>
                        <MessageContent store={store} message={message} reelItem={reelItem} />
                        <time dateTime={new Date(message.ts).toISOString()}>
                            {formatMessageTime(message.ts)}
                        </time>
                    </div>
                    {pending && <span className="message__delivery" role="status">Sending…</span>}
                    {failed && (
                        <div className="message__failure" role="alert">
                            <span>Not sent: {failed.error}</span>
                            <button type="button" onClick={() => store.retrySend(threadId, message.id)}>Retry</button>
                            <button type="button" onClick={() => store.removeFailedSend(threadId, message.id)}>Remove</button>
                        </div>
                    )}
                </div>
                    {groupedReactions.length > 0 && (
                        <div className="message__reactions" aria-label="Message reactions">
                            {groupedReactions.map(reaction => (
                                <button
                                    key={reaction.emoji}
                                    className={`reaction-chip${reaction.byViewer ? ' reaction-chip--viewer' : ''}`}
                                    type="button"
                                    disabled={reactionMutation?.status === 'pending'}
                                    aria-pressed={reaction.byViewer}
                                    aria-label={`${reaction.byViewer ? 'Remove your' : 'Add'} ${reaction.emoji} reaction, ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}`}
                                    onClick={() => chooseReaction(reaction.emoji)}
                                >
                                    <span aria-hidden="true">{reaction.emoji}</span>
                                    <span>{reaction.count}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {eligibleForActions && (
                        <div className="message__reaction-rail" aria-label="Quick reactions">
                            {REACTION_EMOJIS.map(emoji => (
                                <button
                                    key={emoji}
                                    type="button"
                                    className={emoji === DEFAULT_REACTION ? 'message__reaction-default' : undefined}
                                    aria-label={viewerReaction === emoji ? `Remove reaction ${emoji}` : `React with ${emoji}`}
                                    aria-pressed={viewerReaction === emoji}
                                    disabled={reactionMutation?.status === 'pending'}
                                    onClick={() => chooseReaction(emoji)}
                                ><span aria-hidden="true">{emoji}</span></button>
                            ))}
                            <button
                                ref={reactionRef}
                                type="button"
                                className="message__reaction-expander"
                                aria-label="More reactions"
                                aria-haspopup="menu"
                                aria-expanded={Boolean(pickerPoint)}
                                aria-busy={reactionMutation?.status === 'pending'}
                                disabled={reactionMutation?.status === 'pending'}
                                onClick={openReactionPicker}
                            ><span aria-hidden="true">›</span></button>
                        </div>
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
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        const enabled = buttons.filter(button => !button.disabled);
        if (!enabled.length) return;
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = event.key === 'Home'
            ? buttons.indexOf(enabled[0])
            : event.key === 'End'
                ? buttons.indexOf(enabled[enabled.length - 1])
                : currentIndex;
        const step = event.key === 'ArrowLeft' ? -1
            : event.key === 'ArrowRight' ? 1
                : event.key === 'ArrowUp' ? -REACTION_CATEGORIES[0].emojis.length
                    : event.key === 'ArrowDown' ? REACTION_CATEGORIES[0].emojis.length
                        : 0;
        if (step) {
            do next = (next + step + buttons.length) % buttons.length;
            while (buttons[next].disabled && next !== currentIndex);
        }
        event.preventDefault();
        if (currentIndex >= 0) buttons[currentIndex].tabIndex = -1;
        buttons[next].tabIndex = 0;
        buttons[next].focus();
    };

    const firstEnabled = busy ? undefined : FULL_REACTION_EMOJIS.find(emoji => emoji !== current);

    return (
        <div
            ref={surfaceRef}
            className="reaction-picker"
        >
            <div
                className="reaction-picker__menu"
                role="menu"
                aria-label="Choose a reaction"
                aria-busy={busy}
                onKeyDown={moveFocus}
            >
                {REACTION_CATEGORIES.map(category => (
                    <div key={category.label} className="reaction-picker__category" role="group" aria-label={category.label}>
                        <strong aria-hidden="true">{category.label}</strong>
                        <span className="reaction-picker__grid">
                            {category.emojis.map(emoji => (
                                <button
                                    key={emoji}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={current === emoji}
                                    aria-label={current === emoji ? `Remove reaction ${emoji}` : `React with ${emoji}`}
                                    className={current === emoji ? 'reaction-picker__current' : ''}
                                    disabled={busy}
                                    tabIndex={emoji === firstEnabled ? 0 : -1}
                                    onClick={() => onChoose(emoji)}
                                ><span aria-hidden="true">{emoji}</span></button>
                            ))}
                        </span>
                    </div>
                ))}
            </div>
            {current && (
                <span className="reaction-picker__note">Choose the current reaction to remove it</span>
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

function InlineReel({
    store,
    message,
    item,
}: {
    store: FrontendStore;
    message: Extract<Message, { kind: 'reel_share' }>;
    item?: ReelMediaItem;
}) {
    const rootRef = useRef<HTMLButtonElement>(null as unknown as HTMLButtonElement);
    const [shouldPreloadVideo, setShouldPreloadVideo] = useState(false);
    const video = item?.kind === 'video' ? item : undefined;
    const mediaWidth = item?.width ?? message.previewWidth;
    const mediaHeight = item?.height ?? message.previewHeight;
    const mediaBox = mediaWidth && mediaHeight
        ? calculateInlineMediaBox(mediaWidth, mediaHeight)
        : undefined;
    const previewStyle = mediaBox ? {
        width: `${mediaBox.width}px`,
        maxWidth: '100%',
    } : undefined;
    const mediaStyle = mediaBox ? {
        aspectRatio: `${mediaBox.width} / ${mediaBox.height}`,
        width: '100%',
    } : undefined;

    useEffect(() => {
        const root = rootRef.current;
        const history = root?.closest('.messages');
        if (!root || !history) return;
        const checkPosition = () => {
            const rootRect = root.getBoundingClientRect();
            const historyRect = history.getBoundingClientRect();
            if (rootRect.width > 0 && rootRect.height > 0 &&
                rootRect.bottom >= historyRect.top - 160 && rootRect.top <= historyRect.bottom + 160) {
                store.prioritizeReelPreloads([message.shortcode]);
                setShouldPreloadVideo(true);
            }
        };
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                store.prioritizeReelPreloads([message.shortcode]);
                setShouldPreloadVideo(true);
            }
        }, { root: history, rootMargin: '160px 0px', threshold: 0 });
        observer.observe(root);
        history.addEventListener('scroll', checkPosition, { passive: true });
        checkPosition();
        return () => {
            observer.disconnect();
            history.removeEventListener('scroll', checkPosition);
        };
    }, [store, message.id, message.shortcode]);

    return (
        <button
            ref={rootRef}
            type="button"
            className="message-card message-reel-preview"
            style={previewStyle}
            data-shared-post-action="reel"
            aria-label={`Open ${message.mediaType} from ${message.author}`}
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                reelReturnFocus = event.currentTarget;
                void store.openReel(message.shortcode, message.mediaId, message.targetUrl);
            }}
        >
            <span className="message-reel-preview__media" style={mediaStyle}>
                <img
                    className="message-reel-preview__thumbnail"
                    src={message.thumbUrl}
                    alt=""
                    width={mediaWidth}
                    height={mediaHeight}
                    loading="lazy"
                />
                <SharedPostAuthor store={store} message={message} />
                <span className="message-reel-preview__badge" aria-hidden="true">
                    {message.mediaType === 'reel' || item?.kind === 'video' ? <PlayIcon /> : <PostIcon />}
                </span>
                {video && (
                    <video
                        key={video.id}
                        className="message-reel-preview__video-preload"
                        src={video.videoUrl}
                        poster={video.posterUrl || message.thumbUrl}
                        muted
                        loop
                        playsInline
                        preload={shouldPreloadVideo ? 'auto' : 'metadata'}
                        width={video.width}
                        height={video.height}
                        aria-hidden="true"
                    />
                )}
            </span>
            {message.caption && <span>{message.caption}</span>}
        </button>
    );
}

function ForwardModal({ store }: AppProps) {
    const forwarding = store.state.forwarding!;
    const modalRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const searchRef = useRef<HTMLInputElement>(null as unknown as HTMLInputElement);
    const [query, setQuery] = useState('');
    const close = () => store.closeForwarding();
    const selected = new Set(forwarding.selectedTargetIds);
    const targets = store.orderedThreadIds()
        .map(id => store.state.inbox.byId[id])
        .filter(thread => Boolean(thread?.threadFbid))
        .map(thread => ({
            thread,
            score: fuzzyMatchScore(
                `${thread.title} ${thread.users.map(user => `${user.fullName} ${user.username}`).join(' ')}`,
                query,
            ),
        }))
        .filter(item => item.score !== undefined)
        .sort((left, right) => query.trim()
            ? right.score! - left.score!
            : Number(selected.has(right.thread.key)) - Number(selected.has(left.thread.key)));
    const commentLocked = Object.values(forwarding.progress)
        .some(progress => Boolean(progress.commentOfflineThreadingId));

    useLayoutEffect(() => {
        const shell = document.querySelector<HTMLElement>('.app-shell');
        if (!shell) return;
        shell.setAttribute('inert', '');
        shell.setAttribute('aria-hidden', 'true');
        const previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        searchRef.current?.focus({ preventScroll: true });
        return () => {
            shell.removeAttribute('inert');
            shell.removeAttribute('aria-hidden');
            document.documentElement.style.overflow = previousOverflow;
            const target = forwardingReturnFocus;
            forwardingReturnFocus = undefined;
            requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
        };
    }, []);

    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape' && forwarding.status !== 'submitting') {
                event.preventDefault();
                close();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
            )];
            if (!focusable.length) return;
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey
                ? (current <= 0 ? focusable.length - 1 : current - 1)
                : (current === focusable.length - 1 ? 0 : current + 1);
            if (current < 0 || next !== current + (event.shiftKey ? -1 : 1)) {
                event.preventDefault();
                focusable[next].focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [forwarding.status]);

    return (
        <div
            className="forward-modal"
            role="presentation"
            onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
                if (event.target === event.currentTarget && forwarding.status !== 'submitting') close();
            }}
        >
            <section
                ref={modalRef}
                className="forward-modal__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="forward-title"
                aria-describedby="forward-description"
                aria-busy={forwarding.status === 'submitting'}
            >
                <header className="forward-modal__header">
                    <div>
                        <h2 id="forward-title">Forward message</h2>
                        <p id="forward-description">Choose up to 5 conversations.</p>
                    </div>
                    <button type="button" aria-label="Close forwarding" disabled={forwarding.status === 'submitting'} onClick={close}>×</button>
                </header>
                {forwarding.status === 'success' ? (
                    <div className="forward-modal__success" role="status">
                        <strong>Message forwarded</strong>
                        <span>Sent to {forwarding.selectedTargetIds.length} {forwarding.selectedTargetIds.length === 1 ? 'conversation' : 'conversations'}.</span>
                        <button type="button" onClick={close}>Done</button>
                    </div>
                ) : (
                    <>
                        <label className="forward-modal__search">
                            <span className="visually-hidden">Search conversations</span>
                            <input
                                ref={searchRef}
                                type="search"
                                value={query}
                                placeholder="Search chats and people"
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
                            />
                        </label>
                        <div className="forward-modal__targets" role="group" aria-label="Forwarding targets">
                            {targets.length ? targets.map(({ thread }) => {
                                const isSelected = selected.has(thread.key);
                                const progress = forwarding.progress[thread.key];
                                return (
                                    <button
                                        key={thread.key}
                                        type="button"
                                        className={isSelected ? 'forward-target forward-target--selected' : 'forward-target'}
                                        aria-pressed={isSelected}
                                        disabled={forwarding.status === 'submitting' || progress?.complete}
                                        onClick={() => store.toggleForwardTarget(thread.key)}
                                    >
                                        <span className="avatar avatar--small" aria-hidden="true">
                                            {thread.users[0]?.picUrl
                                                ? <img src={thread.users[0].picUrl} alt="" width="40" height="40" />
                                                : <span>{initials(thread.title)}</span>}
                                        </span>
                                        <span className="forward-target__label">
                                            <strong>{thread.title}</strong>
                                            <small>{thread.isGroup ? `${thread.users.length} members` : thread.users[0]?.username || 'Instagram'}</small>
                                            {progress?.error && <span role="alert">{progress.error}</span>}
                                        </span>
                                        <span className="forward-target__check" aria-hidden="true">{progress?.complete ? '✓' : isSelected ? '✓' : ''}</span>
                                    </button>
                                );
                            }) : <p className="forward-modal__empty">No matching conversations</p>}
                        </div>
                        <label className="forward-modal__comment">
                            <span>Optional message</span>
                            <textarea
                                rows={2}
                                value={forwarding.comment}
                                placeholder="Sent before the forwarded message"
                                disabled={forwarding.status === 'submitting' || commentLocked}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => store.setForwardComment(event.currentTarget.value)}
                            />
                        </label>
                        {forwarding.error && <p className="forward-modal__error" role="alert">{forwarding.error}</p>}
                        <footer className="forward-modal__footer">
                            <span aria-live="polite">{forwarding.selectedTargetIds.length} selected</span>
                            <button
                                type="button"
                                disabled={!forwarding.selectedTargetIds.length || forwarding.status === 'submitting'}
                                onClick={() => { void store.submitForwarding(); }}
                            >
                                {forwarding.status === 'submitting' ? 'Forwarding…' : forwarding.status === 'error' ? 'Retry' : 'Forward'}
                            </button>
                        </footer>
                    </>
                )}
            </section>
        </div>
    );
}

function ReelModal({
    store,
    reel,
    targetUrl,
    playbackMemory,
    volumePreference,
}: {
    store: FrontendStore;
    reel: ReelState;
    targetUrl?: string;
    playbackMemory: ReelPlaybackMemory;
    volumePreference: ReelVolumePreferenceRef;
}) {
    const modalRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const [slide, setSlide] = useState(0);
    const media = reel.media;
    const items = media?.items ?? [];
    const current = items[Math.min(slide, Math.max(0, items.length - 1))];
    const mediaLabel = media?.mediaType ?? 'reel';
    const close = () => store.closeReel();
    const move = (delta: number) => setSlide(index => Math.max(0, Math.min(items.length - 1, index + delta)));

    useLayoutEffect(() => {
        const modal = modalRef.current;
        const shell = document.querySelector<HTMLElement>('.app-shell');
        if (!modal || !shell) return;
        shell.setAttribute('inert', '');
        shell.setAttribute('aria-hidden', 'true');
        const previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        modal.querySelector<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        )?.focus({ preventScroll: true });
        return () => {
            shell.removeAttribute('inert');
            shell.removeAttribute('aria-hidden');
            document.documentElement.style.overflow = previousOverflow;
            const target = reelReturnFocus;
            reelReturnFocus = undefined;
            requestAnimationFrame(() => target?.isConnected && target.focus({ preventScroll: true }));
        };
    }, []);

    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
            }
            if (isEditableTarget(event.target as Element)) return;
            if (event.key === 'ArrowLeft' && slide > 0) {
                event.preventDefault();
                move(-1);
            } else if (event.key === 'ArrowRight' && slide < items.length - 1) {
                event.preventDefault();
                move(1);
            } else if (event.key === 'Tab') {
                const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
                )];
                if (!focusable.length) return;
                const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
                const next = event.shiftKey
                    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                    : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
                if (currentIndex < 0 || next !== currentIndex + (event.shiftKey ? -1 : 1)) {
                    event.preventDefault();
                    focusable[next].focus();
                }
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [slide, items.length]);

    return (
        <div
            className="reel-modal"
            role="presentation"
            onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <div
                ref={modalRef}
                className={`reel-modal__dialog${current ? ' reel-modal__dialog--media' : ''}`}
                style={current
                    ? `--reel-aspect-width: ${current.width}; --reel-aspect-height: ${current.height}` as unknown as CSSProperties
                    : undefined}
                role="dialog"
                aria-modal="true"
                aria-label={media ? `${mediaLabel === 'reel' ? 'Reel' : 'Post'} by ${media.author.fullName || media.author.username}` : 'Instagram media'}
            >
                <button type="button" className="reel-modal__close" onClick={close} aria-label={`Close ${mediaLabel}`}>×</button>
                {!media && reel.status === 'loading' && <ListState label="Loading Instagram media…" spinner />}
                {!media && reel.status === 'error' && (
                    <ListState
                        label={reel.error ?? 'Could not load Instagram media'}
                        error
                        actionLabel="Retry"
                        onAction={() => { void store.retryReel(reel.shortcode); }}
                    />
                )}
                {media && current && (
                    <>
                        <section className={`reel-stage${media.attachedAudio ? ' reel-stage--soundtrack' : ''}`} aria-label={`Slide ${slide + 1} of ${items.length}`}>
                            <ReelMediaPlayer
                                key={current.id}
                                item={current}
                                mediaLabel={mediaLabel}
                                playbackKey={`${reel.shortcode}:${current.id}`}
                                playbackMemory={playbackMemory}
                                volumePreference={volumePreference}
                                refreshing={reel.status === 'loading'}
                                soundtrackActive={Boolean(media.attachedAudio)}
                                onRetry={() => { void store.retryReel(reel.shortcode); }}
                            />
                            {media.attachedAudio && <AttachedAudioPlayer
                                audio={media.attachedAudio}
                                volumePreference={volumePreference}
                            />}
                            {slide > 0 && (
                                <button type="button" className="reel-stage__previous" onClick={() => move(-1)} aria-label="Previous slide">‹</button>
                            )}
                            {slide < items.length - 1 && (
                                <button type="button" className="reel-stage__next" onClick={() => move(1)} aria-label="Next slide">›</button>
                            )}
                            {items.length > 1 && (
                                <div className="reel-stage__position" role="status">{slide + 1} / {items.length}</div>
                            )}
                        </section>
                        <aside
                            className="reel-details"
                            onScroll={(event: UIEvent<HTMLElement>) => {
                                const details = event.currentTarget;
                                const remaining = details.scrollHeight - details.scrollTop - details.clientHeight;
                                if (details.scrollTop > 0 && remaining <= 240)
                                    void store.loadNextReelComments(reel.shortcode);
                            }}
                        >
                            <header className="reel-author">
                                {media.author.picUrl ? <img src={media.author.picUrl} alt="" width="42" height="42" /> : <span className="avatar avatar--small">{initials(media.author.username)}</span>}
                                <a href={`https://www.instagram.com/${encodeURIComponent(media.author.username)}/`} target="_blank" rel="noreferrer">
                                    <strong>{media.author.fullName || media.author.username}</strong>
                                    <span>@{media.author.username}{media.author.isVerified ? ' · Verified' : ''}</span>
                                </a>
                            </header>
                            {media.caption && <p className="reel-details__caption">{media.caption}</p>}
                            <div className="reel-actions">
                                <button
                                    type="button"
                                    aria-label={media.hasLiked ? `Unlike ${mediaLabel}` : `Like ${mediaLabel}`}
                                    aria-pressed={media.hasLiked}
                                    aria-busy={reel.likeMutation?.status === 'pending'}
                                    disabled={reel.likeMutation?.status === 'pending'}
                                    onClick={() => { void store.toggleReelLiked(reel.shortcode); }}
                                >{media.hasLiked ? '♥' : '♡'} {media.likeCount.toLocaleString()}</button>
                                {media.canSave && <button
                                    type="button"
                                    className="reel-actions__icon"
                                    aria-label={media.hasSaved ? `Unsave ${mediaLabel}` : `Save ${mediaLabel}`}
                                    title={media.hasSaved ? `Unsave ${mediaLabel}` : `Save ${mediaLabel}`}
                                    aria-pressed={media.hasSaved}
                                    aria-busy={reel.saveMutation?.status === 'pending'}
                                    disabled={reel.saveMutation?.status === 'pending'}
                                    onClick={() => { void store.toggleReelSaved(reel.shortcode); }}
                                >
                                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                        <path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.75L6 21V4.75z" />
                                    </svg>
                                </button>}
                                {targetUrl && <button
                                    type="button"
                                    className="reel-actions__icon"
                                    aria-label="Copy post URL"
                                    title="Copy post URL"
                                    onClick={() => { void navigator.clipboard.writeText(targetUrl); }}
                                >
                                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                        <rect x="8" y="8" width="11" height="11" rx="2" />
                                        <path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" />
                                    </svg>
                                </button>}
                                {current.canDownload && current.downloadUrl && (
                                    <a
                                        className="reel-actions__icon"
                                        href={current.downloadUrl}
                                        download
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label="Download"
                                        title="Download"
                                    >
                                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                            <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" />
                                        </svg>
                                    </a>
                                )}
                            </div>
                            {reel.likeMutation?.status === 'error' && <p role="alert" className="reel-error">Like failed: {reel.likeMutation.error}</p>}
                            {reel.saveMutation?.status === 'error' && <p role="alert" className="reel-error">Save failed: {reel.saveMutation.error}</p>}
                            <section className="reel-comments" aria-label="Comments">
                                <h3>Comments <span>{media.commentCount.toLocaleString()}</span></h3>
                                {reel.comments.status === 'loading' && <p role="status">Loading comments…</p>}
                                {(reel.comments.status === 'error' || reel.comments.failedCursor) && <div role="alert" className="reel-error">
                                    <span>{reel.comments.error ?? 'Could not load comments'}</span>
                                    <button type="button" onClick={() => { void store.retryReelComments(reel.shortcode); }}>
                                        {reel.comments.failedCursor ? 'Retry more comments' : 'Retry comments'}
                                    </button>
                                </div>}
                                {reel.comments.status === 'ready' && reel.comments.listedIds.length === 0 && <p>No comments yet</p>}
                                {reel.comments.listedIds.map(id => {
                                    const comment = reel.comments.byId[id];
                                    return <article key={id} className="reel-comment"><strong>@{comment.author.username}</strong><p>{comment.text}</p></article>;
                                })}
                                {reel.comments.isLoadingMore && <p role="status">Loading more comments…</p>}
                            </section>
                        </aside>
                    </>
                )}
            </div>
        </div>
    );
}

function ReelMediaPlayer({
    item,
    mediaLabel,
    playbackKey,
    playbackMemory,
    volumePreference,
    refreshing,
    soundtrackActive,
    onRetry,
}: {
    item: ReelMediaItem;
    mediaLabel: 'reel' | 'post';
    playbackKey: string;
    playbackMemory: ReelPlaybackMemory;
    volumePreference: ReelVolumePreferenceRef;
    refreshing: boolean;
    soundtrackActive: boolean;
    onRetry: () => void;
}) {
    const wrapperRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);
    const videoRef = useRef<HTMLVideoElement>(null as unknown as HTMLVideoElement);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(soundtrackActive || volumePreference.current.muted);
    const [volume, setVolume] = useState(volumePreference.current.volume);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(item.kind === 'video' ? item.durationSec : 0);
    const [quality, setQuality] = useState('auto');
    const [failedSource, setFailedSource] = useState<string>();
    const [isFullscreen, setIsFullscreen] = useState(false);
    const spaceRef = useRef<{
        video: HTMLVideoElement;
        timer: number;
        isHold: boolean;
        wasPaused: boolean;
        playbackRate: number;
    }>();
    const sourceSwitchRef = useRef<{
        currentTime: number;
        wasPlaying: boolean;
        volume: number;
        muted: boolean;
        playbackRate: number;
    }>();

    useEffect(() => {
        const updateFullscreen = () => {
            setIsFullscreen(document.fullscreenElement === wrapperRef.current);
        };
        document.addEventListener('fullscreenchange', updateFullscreen);
        updateFullscreen();
        return () => document.removeEventListener('fullscreenchange', updateFullscreen);
    }, []);

    const finishSpace = (toggleTap = false) => {
        const interaction = spaceRef.current;
        if (!interaction) return;
        spaceRef.current = undefined;
        window.clearTimeout(interaction.timer);
        if (interaction.isHold) {
            interaction.video.playbackRate = interaction.playbackRate;
        } else if (toggleTap && interaction.video.isConnected) {
            toggleVideoPlayback(interaction.video, playbackKey, playbackMemory);
        }
    };

    useEffect(() => {
        if (item.kind !== 'video') return;
        const video = videoRef.current;
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (isEditableTarget(event.target as Element)) return;
            if (event.code === 'Space') {
                event.preventDefault();
                if (event.repeat || spaceRef.current) return;
                const interaction = {
                    video,
                    timer: 0,
                    isHold: false,
                    wasPaused: video.paused,
                    playbackRate: video.playbackRate,
                };
                interaction.timer = window.setTimeout(() => {
                    if (spaceRef.current !== interaction || interaction.wasPaused || video.paused) return;
                    interaction.isHold = true;
                    video.playbackRate = 2;
                }, 250);
                spaceRef.current = interaction;
            } else if ((event.key === ',' || event.key === '.') && video.paused) {
                event.preventDefault();
                // Instagram does not expose frame-rate metadata here; 30fps is
                // the documented fallback for deterministic frame stepping.
                video.currentTime = Math.max(0, Math.min(video.duration || item.durationSec, video.currentTime + (event.key === ',' ? -1 : 1) / 30));
                setCurrentTime(video.currentTime);
            }
        };
        const onKeyUp = (event: globalThis.KeyboardEvent) => {
            if (event.code === 'Space' && spaceRef.current) {
                event.preventDefault();
                finishSpace(true);
            }
        };
        const onBlur = () => finishSpace();
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur);
        return () => {
            finishSpace();
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
        };
    }, [item.id]);

    const sourceUrl = item.kind === 'image'
        ? item.imageUrl
        : quality === 'auto'
            ? item.videoUrl
            : item.variants[Number(quality)]?.url ?? item.videoUrl;
    const mediaStyle = {
        aspectRatio: `${item.width} / ${item.height}`,
        width: `min(100%, calc(100cqh * ${item.width} / ${item.height}))`,
        height: `min(100%, calc(100cqw * ${item.height} / ${item.width}))`,
    };

    const errorNotice = failedSource === sourceUrl && (
        <div className="reel-media__error" role="alert">
            <span>This {mediaLabel} media could not be loaded.</span>
            <button
                type="button"
                aria-busy={refreshing}
                disabled={refreshing}
                onClick={onRetry}
            >{refreshing ? 'Refreshing…' : `Retry ${mediaLabel} media`}</button>
        </div>
    );

    if (item.kind === 'image') {
        return <div ref={wrapperRef} className="reel-media" style={mediaStyle}>
            <img
                src={sourceUrl}
                alt={`${mediaLabel === 'reel' ? 'Reel' : 'Post'} image`}
                width={item.width}
                height={item.height}
                onError={() => setFailedSource(sourceUrl)}
            />
            {errorNotice}
        </div>;
    }

    const togglePlayback = () => {
        toggleVideoPlayback(videoRef.current, playbackKey, playbackMemory);
    };
    const setVideoVolume = (value: number) => {
        const video = videoRef.current;
        video.volume = value;
        video.muted = value === 0;
        setVolume(value);
        setMuted(value === 0);
        volumePreference.current = { volume: value, muted: value === 0 };
        writeReelVolumePreference(volumePreference.current);
    };
    const toggleFullscreen = () => {
        if (document.fullscreenElement === wrapperRef.current) {
            void document.exitFullscreen();
        } else if (!document.fullscreenElement) {
            void wrapperRef.current.requestFullscreen?.();
        }
    };
    useEffect(() => {
        const snapshot = sourceSwitchRef.current;
        const video = videoRef.current;
        if (!snapshot || !video) return;
        sourceSwitchRef.current = undefined;
        const restore = () => {
            video.volume = snapshot.volume;
            video.muted = snapshot.muted;
            video.playbackRate = snapshot.playbackRate;
            try { video.currentTime = Math.min(snapshot.currentTime, video.duration || snapshot.currentTime); }
            catch { /* Some browsers require loaded metadata before seeking. */ }
            if (snapshot.wasPlaying) void video.play().catch(() => undefined);
        };
        if (video.readyState >= 1) restore();
        else video.addEventListener('loadedmetadata', restore, { once: true });
        return () => video.removeEventListener('loadedmetadata', restore);
    }, [sourceUrl]);

    useLayoutEffect(() => {
        const video = videoRef.current;
        video.volume = volumePreference.current.volume;
        video.muted = soundtrackActive || volumePreference.current.muted;
        setVolume(video.volume);
        setMuted(video.muted);
        const remembered = playbackMemory.get(playbackKey);
        if (!remembered) playbackMemory.set(playbackKey, { currentTime: 0, userPaused: false });
        const restore = () => {
            if (remembered && Number.isFinite(remembered.currentTime)) {
                const knownDuration = Number.isFinite(video.duration) && video.duration > 0
                    ? video.duration
                    : item.durationSec;
                try { video.currentTime = Math.max(0, Math.min(remembered.currentTime, knownDuration)); }
                catch { /* Seeking is only legal after metadata in some browsers. */ }
            }
            if (!remembered?.userPaused) void video.play().catch(() => undefined);
        };
        if (video.readyState >= 1) restore();
        else video.addEventListener('loadedmetadata', restore, { once: true });
        return () => {
            video.removeEventListener('loadedmetadata', restore);
            finishSpace();
            const state = playbackMemory.get(playbackKey) ?? { currentTime: 0, userPaused: false };
            playbackMemory.set(playbackKey, {
                currentTime: Number.isFinite(video.currentTime) ? video.currentTime : state.currentTime,
                userPaused: state.userPaused,
            });
        };
    }, [item.id, playbackKey]);

    useLayoutEffect(() => {
        const video = videoRef.current;
        const nextMuted = soundtrackActive || volumePreference.current.muted;
        video.volume = volumePreference.current.volume;
        video.muted = nextMuted;
        setMuted(nextMuted);
        setVolume(volumePreference.current.volume);
    }, [soundtrackActive]);

    return (
        <div ref={wrapperRef} className="reel-media reel-media--video" style={mediaStyle}>
            <video
                ref={videoRef}
                src={sourceUrl}
                poster={item.posterUrl}
                autoPlay={!playbackMemory.get(playbackKey)?.userPaused}
                muted={soundtrackActive || volumePreference.current.muted}
                playsInline
                preload="auto"
                width={item.width}
                height={item.height}
                onClick={togglePlayback}
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); finishSpace(); }}
                onTimeUpdate={() => {
                    const time = videoRef.current.currentTime;
                    setCurrentTime(time);
                    const state = playbackMemory.get(playbackKey) ?? { currentTime: 0, userPaused: false };
                    playbackMemory.set(playbackKey, { ...state, currentTime: time });
                }}
                onDurationChange={() => setDuration(videoRef.current.duration || item.durationSec)}
                onError={() => setFailedSource(sourceUrl)}
            />
            {errorNotice}
            <div className="reel-player">
                <input
                    className="reel-player__timeline"
                    type="range"
                    min="0"
                    max={duration || 0.01}
                    step="0.01"
                    value={Math.min(currentTime, duration || 0)}
                    aria-label={`Seek ${mediaLabel}`}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const value = Number(event.currentTarget.value);
                        videoRef.current.currentTime = value;
                        setCurrentTime(value);
                    }}
                />
                <div className="reel-player__row">
                    <button
                        type="button"
                        className="reel-player__playback"
                        onClick={togglePlayback}
                        aria-label={playing ? `Pause ${mediaLabel}` : `Play ${mediaLabel}`}
                    >{playing ? <PauseIcon /> : <PlayIcon />}</button>
                    {!soundtrackActive && <button type="button" onClick={() => {
                        const next = !videoRef.current.muted;
                        videoRef.current.muted = next;
                        setMuted(next);
                        volumePreference.current = { volume: videoRef.current.volume, muted: next };
                        writeReelVolumePreference(volumePreference.current);
                    }} aria-label={muted ? `Unmute ${mediaLabel}` : `Mute ${mediaLabel}`} className="reel-player__mute">
                        <SpeakerIcon muted={muted} />
                    </button>}
                    {!soundtrackActive && <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label={`${mediaLabel === 'reel' ? 'Reel' : 'Post'} volume`} onChange={(event: ChangeEvent<HTMLInputElement>) => setVideoVolume(Number(event.currentTarget.value))} />}
                    {item.variants.length > 1 && <label className="reel-player__quality">
                        <span>Quality</span>
                        <select
                            value={quality}
                            aria-label={`${mediaLabel === 'reel' ? 'Reel' : 'Post'} quality`}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                const video = videoRef.current;
                                sourceSwitchRef.current = {
                                    currentTime: video.currentTime,
                                    wasPlaying: !video.paused,
                                    volume: video.volume,
                                    muted: video.muted,
                                    playbackRate: video.playbackRate,
                                };
                                setQuality(event.currentTarget.value);
                            }}
                        >
                            <option value="auto">Auto</option>
                            {item.variants.map((variant, index) => (
                                <option key={variant.url} value={String(index)}>
                                    {variant.height ? `${variant.height}p` : `Variant ${index + 1}`}
                                    {variant.type ? ` · format ${variant.type}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>}
                    <time>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</time>
                    <button
                        type="button"
                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        onClick={toggleFullscreen}
                    >⛶</button>
                </div>
            </div>
        </div>
    );
}

function AttachedAudioPlayer({
    audio,
    volumePreference,
}: {
    audio: AttachedAudio;
    volumePreference: ReelVolumePreferenceRef;
}) {
    const audioRef = useRef<HTMLAudioElement>(null as unknown as HTMLAudioElement);
    const lifecycleRef = useRef(0);
    const playAttemptRef = useRef(0);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(volumePreference.current.muted);
    const [volume, setVolume] = useState(volumePreference.current.volume);
    const [failure, setFailure] = useState<{ message: string; alert: boolean }>();

    const attemptPlayback = (element: HTMLAudioElement, lifecycle: number, userInitiated: boolean) => {
        const attempt = ++playAttemptRef.current;
        setFailure(undefined);
        let result: Promise<void>;
        try {
            result = element.play();
        } catch {
            if (lifecycleRef.current === lifecycle && audioRef.current === element) {
                setPlaying(false);
                setFailure({ message: 'Post music could not be played.', alert: userInitiated });
            }
            return;
        }
        void result.then(() => {
            if (
                lifecycleRef.current === lifecycle && playAttemptRef.current === attempt &&
                audioRef.current === element && !element.paused
            ) setPlaying(true);
        }, () => {
            if (
                lifecycleRef.current !== lifecycle || playAttemptRef.current !== attempt ||
                audioRef.current !== element
            ) return;
            setPlaying(false);
            setFailure(userInitiated
                ? { message: 'Post music could not be played.', alert: true }
                : { message: 'Post music is paused. Select Play post music to start it.', alert: false });
        });
    };

    useLayoutEffect(() => {
        const element = audioRef.current;
        const lifecycle = ++lifecycleRef.current;
        const start = audio.startTimeSec;
        const begin = () => {
            try { element.currentTime = start; }
            catch { /* Seeking is only legal after metadata in some browsers. */ }
            attemptPlayback(element, lifecycle, false);
        };
        element.volume = volumePreference.current.volume;
        element.muted = volumePreference.current.muted;
        element.src = audio.url;
        element.load();
        setPlaying(false);
        setVolume(element.volume);
        setMuted(element.muted);
        setFailure(undefined);
        if (element.readyState >= 1) begin();
        else element.addEventListener('loadedmetadata', begin, { once: true });
        return () => {
            lifecycleRef.current++;
            playAttemptRef.current++;
            element.removeEventListener('loadedmetadata', begin);
            element.pause();
        };
    }, [audio.id, audio.url, audio.startTimeSec, audio.playDurationSec, audio.durationSec]);

    return <>
        <audio
            ref={audioRef}
            preload="auto"
            onPlay={() => {
                setPlaying(true);
                setFailure(undefined);
            }}
            onPause={() => setPlaying(false)}
            onVolumeChange={() => {
                setVolume(audioRef.current.volume);
                setMuted(audioRef.current.muted);
            }}
            onError={() => {
                setPlaying(false);
                setFailure({ message: 'Post music could not be loaded.', alert: true });
            }}
            onTimeUpdate={() => {
                const element = audioRef.current;
                if (audio.playDurationSec && element.currentTime >= audio.startTimeSec + audio.playDurationSec) {
                    element.currentTime = audio.startTimeSec;
                    attemptPlayback(element, lifecycleRef.current, false);
                }
            }}
        />
        <div className="reel-stage__soundtrack-controls">
            <button
                type="button"
                className="reel-stage__soundtrack"
                aria-label={!playing ? 'Play post music' : muted ? 'Unmute post music' : 'Mute post music'}
                aria-pressed={playing ? muted : undefined}
                title={[audio.title, audio.artist].filter(Boolean).join(' · ') || 'Post music'}
                onClick={() => {
                    const element = audioRef.current;
                    if (element.paused) {
                        attemptPlayback(element, lifecycleRef.current, true);
                        return;
                    }
                    element.muted = !element.muted;
                    setMuted(element.muted);
                    volumePreference.current = { volume: element.volume, muted: element.muted };
                    writeReelVolumePreference(volumePreference.current);
                }}
            ><SpeakerIcon muted={muted} /></button>
            <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                aria-label="Post music volume"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const element = audioRef.current;
                    const value = Number(event.currentTarget.value);
                    element.volume = value;
                    element.muted = value === 0;
                    setVolume(value);
                    setMuted(element.muted);
                    volumePreference.current = { volume: value, muted: element.muted };
                    writeReelVolumePreference(volumePreference.current);
                }}
            />
        </div>
        {failure && <p className="reel-stage__soundtrack-error" role={failure.alert ? 'alert' : 'status'}>{failure.message}</p>}
    </>;
}

function toggleVideoPlayback(
    video: HTMLVideoElement,
    playbackKey: string,
    playbackMemory: ReelPlaybackMemory,
) {
    const state = playbackMemory.get(playbackKey) ?? { currentTime: 0, userPaused: false };
    if (video.paused) {
        playbackMemory.set(playbackKey, { ...state, userPaused: false });
        void video.play().catch(() => undefined);
    } else {
        playbackMemory.set(playbackKey, { ...state, userPaused: true });
        video.pause();
    }
}

function SpeakerIcon({ muted }: { muted: boolean }) {
    return (
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            {muted
                ? <path d="m16 9 5 6m0-6-5 6" />
                : <path d="M16 9.5c1.4 1.4 1.4 3.6 0 5m2-7c2.5 2.5 2.5 6.5 0 9" />}
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg className="playback-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg className="playback-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
        </svg>
    );
}

function PostIcon() {
    return (
        <svg className="playback-icon" viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
    );
}

function formatMediaTime(seconds: number) {
    if (!Number.isFinite(seconds)) return '0:00';
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function MessageContent({
    store,
    message,
    reelItem,
}: {
    store: FrontendStore;
    message: Message;
    reelItem?: ReelMediaItem;
}) {
    switch (message.kind) {
        case 'text': return <span>{message.text}</span>;
        case 'reaction_log': return <span>{message.fragment}</span>;
        case 'activity': return <span>{message.text}</span>;
        case 'reel_share': return <InlineReel store={store} message={message} item={reelItem} />;
        case 'inline_share': {
            const content = (
                <>
                    <span className="message-card__media">
                        <img src={message.thumbUrl} alt="" loading="lazy" />
                        <SharedPostAuthor store={store} message={message} />
                    </span>
                    {message.subtitle && <span>{message.subtitle}</span>}
                </>
            );
            return message.targetUrl ? (
                <a
                    className="message-card"
                    data-shared-post-action="link"
                    href={message.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                >
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
        case 'unsupported': return (
            <span className="message__unsupported">
                {message.fallback.label}
                {message.fallback.preview && message.fallback.preview !== message.fallback.label
                    ? `: ${message.fallback.preview}`
                    : undefined}
            </span>
        );
    }
}

function SharedPostAuthor({
    store,
    message,
}: {
    store: FrontendStore;
    message: Extract<Message, { kind: 'reel_share' | 'inline_share' }>;
}) {
    const label = message.kind === 'reel_share' ? message.author : message.title;
    const picUrl = message.kind === 'reel_share'
        ? store.state.reels.byId[message.shortcode]?.media?.author.picUrl
        : undefined;

    return (
        <span className="shared-post__author">
            <span className="shared-post__author-avatar" aria-hidden="true">
                {picUrl
                    ? <img src={picUrl} alt="" width="20" height="20" />
                    : <span>{initials(label)}</span>}
            </span>
            <strong>{label}</strong>
        </span>
    );
}

function isActionableSharedPost(message: Message) {
    return (message.kind === 'reel_share' && Boolean(message.targetUrl)) ||
        (message.kind === 'inline_share' && Boolean(message.targetUrl));
}

function ReplyPreview({
    preview,
    onNavigate,
    targetId,
}: {
    preview: NonNullable<Extract<Message, { kind: 'text' }>['replyPreview']>;
    onNavigate?: () => void;
    targetId?: string;
}) {
    const previewLabel = preview.kind === 'text'
        ? preview.text
        : preview.kind === 'media'
            ? preview.title
            : preview.label;
    const content = (
        <>
            {preview.kind === 'media' && preview.thumbUrl && <img src={preview.thumbUrl} alt="" loading="lazy" />}
            <span>{previewLabel}</span>
        </>
    );
    return onNavigate ? (
        <button
            type="button"
            className="message__reply message__reply--action"
            onClick={onNavigate}
            aria-label={`Go to original message: ${previewLabel}`}
            data-reply-target-id={targetId}
        >
            {content}
        </button>
    ) : <span className="message__reply">{content}</span>;
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

function useVimNavigation(store: FrontendStore) {
    const activePaneRef = useRef<'chats' | 'history'>('chats');
    const lastMessageByThreadRef = useRef(new Map<string, string>());
    const navigationTokenRef = useRef(0);

    useEffect(() => {
        const focusChat = (threadId: string, select: boolean) => {
            const navigationToken = ++navigationTokenRef.current;
            const ids = store.orderedThreadIds();
            const index = ids.indexOf(threadId);
            if (index < 0) return;
            activePaneRef.current = 'chats';
            if (select) store.selectThread(threadId);
            const scroller = document.querySelector<HTMLElement>('.chat-list');
            if (scroller) {
                const top = index * ROW_HEIGHT;
                if (top < scroller.scrollTop) setKeyboardScrollTop(scroller, top);
                else if (top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
                    setKeyboardScrollTop(scroller, top + ROW_HEIGHT - scroller.clientHeight);
                }
            }
            const focus = () => {
                if (navigationTokenRef.current !== navigationToken) return true;
                const row = document.querySelector<HTMLElement>(
                    `[data-thread-id="${cssEscape(threadId)}"]`,
                );
                row?.focus({ preventScroll: true });
                return Boolean(row);
            };
            if (!focus()) requestAnimationFrame(() => requestAnimationFrame(focus));
        };

        const focusHistory = (navigationToken = ++navigationTokenRef.current) => {
            if (navigationTokenRef.current !== navigationToken) return;
            const threadId = store.state.selectedThreadId;
            if (!threadId) return;
            const pane = document.querySelector<HTMLElement>('.messages');
            if (pane?.dataset.historyThreadId !== threadId) {
                requestAnimationFrame(() => requestAnimationFrame(() => focusHistory(navigationToken)));
                return;
            }
            const rows = [...document.querySelectorAll<HTMLElement>('.messages [data-message-id]')];
            if (!rows.length) return;
            const remembered = lastMessageByThreadRef.current.get(threadId);
            const row = remembered
                ? rows.find(item => item.dataset.messageId === remembered) ?? rows.at(-1)
                : rows.at(-1);
            activePaneRef.current = 'history';
            row?.focus({ preventScroll: true });
            if (row && pane) revealInScroller(pane, row);
        };

        const onFocus = (event: FocusEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            navigationTokenRef.current++;
            const chat = target.closest<HTMLElement>('[data-thread-id]');
            if (chat) {
                activePaneRef.current = 'chats';
                return;
            }
            const message = target.closest<HTMLElement>('[data-message-id]');
            const threadId = store.state.selectedThreadId;
            if (message?.dataset.messageId && threadId) {
                activePaneRef.current = 'history';
                lastMessageByThreadRef.current.set(threadId, message.dataset.messageId);
            }
        };

        const onKey = (event: globalThis.KeyboardEvent) => {
            if (!['j', 'k', 'h', 'l'].includes(event.key) ||
                event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const target = event.target;
            if (target instanceof Element && (
                isEditableTarget(target) ||
                target.closest('.context-menu, .reaction-picker, [role="dialog"], [aria-modal="true"]')
            )) return;
            if (document.querySelector('.context-menu, .reaction-picker, [role="dialog"], [aria-modal="true"]')) return;

            if (event.key === 'h') {
                const selected = store.state.selectedThreadId;
                if (!selected || activePaneRef.current === 'chats') return;
                event.preventDefault();
                focusChat(selected, false);
                return;
            }
            if (event.key === 'l') {
                if (activePaneRef.current !== 'chats') return;
                event.preventDefault();
                focusHistory();
                return;
            }

            event.preventDefault();
            if (activePaneRef.current === 'chats') {
                const ids = store.orderedThreadIds();
                if (!ids.length) return;
                const focused = document.activeElement instanceof HTMLElement
                    ? document.activeElement.closest<HTMLElement>('[data-thread-id]')?.dataset.threadId
                    : undefined;
                const current = focused ?? store.state.selectedThreadId;
                const currentIndex = current ? ids.indexOf(current) : -1;
                const nextIndex = currentIndex < 0 ? 0 : Math.max(0, Math.min(
                    ids.length - 1, currentIndex + (event.key === 'j' ? 1 : -1),
                ));
                focusChat(ids[nextIndex], ids[nextIndex] !== store.state.selectedThreadId);
                return;
            }

            const rows = [...document.querySelectorAll<HTMLElement>('.messages [data-message-id]')];
            if (!rows.length) return;
            const threadId = store.state.selectedThreadId;
            const focusedIndex = rows.indexOf(document.activeElement as HTMLElement);
            const remembered = threadId ? lastMessageByThreadRef.current.get(threadId) : undefined;
            const rememberedIndex = remembered
                ? rows.findIndex(row => row.dataset.messageId === remembered)
                : -1;
            const currentIndex = focusedIndex >= 0
                ? focusedIndex
                : rememberedIndex >= 0 ? rememberedIndex : rows.length - 1;
            const nextIndex = Math.max(0, Math.min(
                rows.length - 1,
                currentIndex + (event.key === 'j' ? 1 : -1),
            ));
            const row = rows[nextIndex];
            row.focus({ preventScroll: true });
            const pane = row.closest<HTMLElement>('.messages');
            if (pane) revealInScroller(pane, row);
        };

        document.addEventListener('focusin', onFocus, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('focusin', onFocus, true);
            document.removeEventListener('keydown', onKey, true);
            lastMessageByThreadRef.current.clear();
        };
    }, [store]);
}

function restoreChatRowFocus(store: FrontendStore, threadId: string) {
    const index = store.orderedThreadIds().indexOf(threadId);
    const scroller = document.querySelector<HTMLElement>('.chat-list');
    if (index < 0 || !scroller) return false;
    const top = index * ROW_HEIGHT;
    if (top < scroller.scrollTop) setKeyboardScrollTop(scroller, top);
    else if (top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
        setKeyboardScrollTop(scroller, top + ROW_HEIGHT - scroller.clientHeight);
    }
    const row = document.querySelector<HTMLElement>(
        `[data-thread-id="${cssEscape(threadId)}"]`,
    );
    row?.focus({ preventScroll: true });
    return Boolean(row);
}

function isEditableTarget(target: Element) {
    if (target.closest('input, textarea, select')) return true;
    const htmlTarget = target instanceof HTMLElement ? target : target.parentElement;
    return Boolean(htmlTarget?.isContentEditable);
}

function setKeyboardScrollTop(scroller: HTMLElement, scrollTop: number) {
    const token = String(++keyboardScrollSequence);
    scroller.dataset.keyboardNavigationScroll = token;
    scroller.scrollTop = scrollTop;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (scroller.dataset.keyboardNavigationScroll === token) {
            delete scroller.dataset.keyboardNavigationScroll;
        }
    }));
}

function revealInScroller(scroller: HTMLElement, row: HTMLElement) {
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < scrollerRect.top) {
        setKeyboardScrollTop(scroller, scroller.scrollTop + rowRect.top - scrollerRect.top);
    } else if (rowRect.bottom > scrollerRect.bottom) {
        setKeyboardScrollTop(scroller, scroller.scrollTop + rowRect.bottom - scrollerRect.bottom);
    }
}

function messageSummary(message: Message) {
    switch (message.kind) {
        case 'text': return message.text;
        case 'reaction_log': return message.fragment;
        case 'activity': return message.text;
        case 'reel_share': return message.caption || `Reel from ${message.author}`;
        case 'inline_share': return message.title;
        case 'image': return message.images.length === 1 ? 'Photo' : `${message.images.length} photos`;
        case 'unsupported': return message.fallback.preview || message.fallback.label;
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
        case 'activity': return { kind: 'unavailable', label: message.text };
        case 'unsupported': return {
            kind: 'unavailable',
            label: message.fallback.preview || message.fallback.label,
        };
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
