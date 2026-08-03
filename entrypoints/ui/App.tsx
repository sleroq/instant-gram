import type { UIEvent } from 'react';
import {
    memo,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from '../../vendor/teact/src/teact/teact';
import type { Message, Thread } from '../../lib/domain';
import type { FrontendStore, HistoryState } from './store';
import { hasLocalOlderIds } from './history-window';
import { computeChatWindow } from './virtual-list';

const ROW_HEIGHT = 72;

type AppProps = { store: FrontendStore };

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
    const user = thread.users[0];
    const snippet = thread.lastMessage ? messageSummary(thread.lastMessage) : 'No messages yet';
    return (
        <button
            type="button"
            className={`chat-row${selected ? ' chat-row--selected' : ''}`}
            style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
            onClick={onSelect}
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
                                {history.viewportIds.map((id, index) => {
                                    const message = history.byId[id];
                                    const previous = index ? history.byId[history.viewportIds[index - 1]] : undefined;
                                    const showDate = !previous || !sameDay(previous.ts, message.ts);
                                    const grouped = Boolean(
                                        previous && senderId(previous) === senderId(message) &&
                                        message.ts - previous.ts < 5 * 60_000 && !showDate,
                                    );
                                    return (
                                        <MessageRow
                                            key={id}
                                            message={message}
                                            outgoing={senderId(message) === history.viewerId}
                                            grouped={grouped}
                                            showDate={showDate}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}

const MessageRow = memo(function MessageRow({
    message,
    outgoing,
    grouped,
    showDate,
}: {
    message: Message;
    outgoing: boolean;
    grouped: boolean;
    showDate: boolean;
}) {
    return (
        <div data-message-id={message.id}>
            {showDate && (
                <div className="message-date">
                    <time className="status-surface" dateTime={new Date(message.ts).toISOString()}>{formatMessageDate(message.ts)}</time>
                </div>
            )}
            <div className={`message${outgoing ? ' message--outgoing' : ''}${grouped ? ' message--grouped' : ''}${message.kind === 'reaction_log' ? ' message--log' : ''}`}>
                <div className="message__bubble">
                    {'replyPreview' in message && message.replyPreview && (
                        <ReplyPreview preview={message.replyPreview} />
                    )}
                    <div className="message__body">
                        <MessageContent message={message} />
                        <time dateTime={new Date(message.ts).toISOString()}>
                            {formatMessageTime(message.ts)}
                        </time>
                    </div>
                </div>
            </div>
        </div>
    );
});

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
